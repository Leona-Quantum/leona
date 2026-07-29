"""Harness tests for scoring helpers plus an explicitly gated live-provider run."""

import json
import os
import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, VerifierDecision
from majorana_llm import default_llm
from majorana_sandbox import LocalSubprocessSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals import (
    CorpusCase,
    Expect,
    RoutingOutcome,
    load_corpus,
    load_seeded_corpus,
    run_case,
    run_corpus,
    score_seeded_corpus,
    top_measured_bitstring,
)
from majorana_evals.runner import (
    _latest_sandbox_event,
    _latest_trusted_result,
    _score_result_expectations,
    _score_terminal_expectations,
)

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="harness self-test needs DATABASE_URL"
)


def _live_provider_ready() -> bool:
    provider = os.environ.get("MAJORANA_LLM_PROVIDER", "").strip().lower()
    if provider == "anthropic":
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    if provider == "openai":
        return bool(os.environ.get("OPENAI_API_KEY") and os.environ.get("DEEPSEEK_API_KEY"))
    return bool(os.environ.get("ANTHROPIC_API_KEY")) or bool(
        os.environ.get("OPENAI_API_KEY") and os.environ.get("DEEPSEEK_API_KEY")
    )


requires_live_llm = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_LIVE_LLM") != "1" or not _live_provider_ready(),
    reason="live provider test requires MAJORANA_RUN_LIVE_LLM=1 and configured credentials",
)


def test_top_measured_bitstring_picks_dominant_state():
    # dominant state wins from the trusted result mapping
    result = {"counts": {"1100": 970, "0000": 12, "1000": 18}}
    assert top_measured_bitstring(result) == "1100"
    # register-separator spaces are stripped so it compares to a plain target
    assert top_measured_bitstring({"counts": {"11 00": 900, "00 11": 5}}) == "1100"
    # no counts / absent evidence → None, not a crash
    assert top_measured_bitstring({"energy": -1.137}) is None
    assert top_measured_bitstring(None) is None


def test_latest_sandbox_event_uses_repaired_terminal_attempt():
    first = SimpleNamespace(type="sandbox.result", payload={"stdout": ""})
    final = SimpleNamespace(
        type="sandbox.result", payload={"stdout": '{"ground_state_energy_Ha": -1.1}'}
    )
    unrelated = SimpleNamespace(type="stage.started", payload={})
    assert _latest_sandbox_event([first, unrelated, final]) is final


async def test_latest_trusted_result_requires_candidate_fingerprint_binding():
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    candidate = SimpleNamespace(candidate_id=candidate_id, source_fingerprint="a" * 64)
    execution = SimpleNamespace(
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint="a" * 64,
        result={"counts": {"11": 8}},
    )

    class Store:
        async def latest_candidate(self, _run_id):
            return candidate

        async def execution_for(self, _run_id, _candidate_id):
            return execution

    result, got_candidate_id, got_execution_id = await _latest_trusted_result(Store(), uuid.uuid4())
    assert result == {"counts": {"11": 8}}
    assert got_candidate_id == str(candidate_id)
    assert got_execution_id == str(execution_id)

    execution.source_fingerprint = "b" * 64
    with pytest.raises(ValueError, match="not bound"):
        await _latest_trusted_result(Store(), uuid.uuid4())


def test_value_check_catches_endianness_bit_reversal():
    # The Grover-1100 failure mode: circuit is well-formed and the verifier passes it,
    # but the recovered top state is the bit-reversal 0011. The value-level check must
    # reject it even though verifier_decision would say pass. Guards NEXT.md's warning
    # that a naive bench-30 gives false comfort on a wrong answer.
    bit_reversed = {"counts": {"0011": 973, "0000": 27}}
    assert top_measured_bitstring(bit_reversed) == "0011"
    assert top_measured_bitstring(bit_reversed) != "1100"

    correct = {"counts": {"1100": 973, "0000": 27}}
    assert top_measured_bitstring(correct) == "1100"


def test_untrusted_stdout_cannot_satisfy_result_expectations():
    expect = Expect(
        output_keys=["counts", "energy"],
        expected_top_bitstring="1100",
        expected_values={"energy": -1.137},
    )
    malicious_stdout = '{"counts": {"1100": 999}, "energy": -1.137}'

    # The scorer has no stdout argument. Model-controlled diagnostics cannot supply
    # a missing RESULT field or value, even if they contain plausible JSON.
    reasons = _score_result_expectations(expect, None)
    assert malicious_stdout
    assert reasons == [
        "expected top bitstring '1100' but no measurement counts were found in RESULT",
        "expected numeric RESULT field 'energy' was not found",
        "RESULT missing promised key 'counts'",
        "RESULT missing promised key 'energy'",
    ]


def test_result_expectations_use_exact_protected_result_fields():
    expect = Expect(
        output_keys=["counts", "energy"],
        expected_top_bitstring="1100",
        expected_values={"energy": -1.137},
        expected_value_tolerance=0.001,
    )
    assert (
        _score_result_expectations(
            expect,
            {"counts": {"1100": 999, "0000": 1}, "energy": -1.137},
        )
        == []
    )


def test_simple_terminal_scoring_requires_alignment_without_strict_verdict():
    expect = Expect()

    assert (
        _score_terminal_expectations(
            expect,
            run_status="succeeded",
            terminal_reason="ai_review_aligned",
            verifier_decision=None,
        )
        == []
    )
    assert _score_terminal_expectations(
        expect,
        run_status="failed",
        terminal_reason="intent_review_inconclusive",
        verifier_decision=None,
    ) == [
        "run_status 'failed' != expected 'succeeded'",
        "terminal_reason 'intent_review_inconclusive' != expected 'ai_review_aligned'",
    ]


def test_legacy_terminal_scoring_checks_verifier_only_when_explicit():
    expect = Expect(
        terminal_reason=None,
        verifier_decision=VerifierDecision.PASS,
    )

    assert _score_terminal_expectations(
        expect,
        run_status="succeeded",
        terminal_reason="strict_pass",
        verifier_decision="fail",
    ) == ["verifier_decision 'fail' != expected 'pass'"]


def test_bench_30_corpus_case_pins_the_target():
    from pathlib import Path

    corpus = load_corpus(Path(__file__).parents[3] / "evals" / "corpus")
    bench_30 = next((c for c in corpus if c.id == "bench-30"), None)
    assert bench_30 is not None, "bench-30 Grover recovery case should be in the corpus"
    assert bench_30.expect.expected_top_bitstring == "1100"


def test_corpus_loads_from_yaml():
    from pathlib import Path

    corpus = load_corpus(Path(__file__).parents[3] / "evals" / "corpus")
    assert corpus, "starter corpus should be non-empty"
    assert any(c.id == "bench-01" for c in corpus)
    # The default product path is AI-reviewed and explicitly does not fabricate
    # a strict-verifier verdict.
    assert all(c.expect.run_status.value == "succeeded" for c in corpus)
    assert all(c.expect.terminal_reason == "ai_review_aligned" for c in corpus)
    assert all(c.expect.verifier_decision is None for c in corpus)


def _seeded_corpus():
    from pathlib import Path

    return load_seeded_corpus(Path(__file__).parents[3] / "evals" / "seeded-mistakes")


def test_seeded_corpus_covers_every_verification_v2_regression():
    corpus = _seeded_corpus()
    assert len(corpus) == 16
    assert {case.id for case in corpus} == {
        "v2-01-bell-ghz-pass",
        "v2-02-wrong-relative-phase",
        "v2-03-fabricated-counts",
        "v2-04-plan-mismatch",
        "v2-05-critic-malformed-twice",
        "v2-06-dynamic-unsupported",
        "v2-07-structural-only",
        "v2-08-resource-exhaustion",
        "v2-09-maxcut-pass",
        "v2-10-maxcut-objective-fail",
        "v2-11a-vqe-energy-pass",
        "v2-11b-vqe-energy-fail",
        "v2-12-qasm-conversion-neutral",
        "v2-13-private-inconclusive",
        "v2-14-source-mutation-stale",
        "v2-15-historical-replay",
    }
    assert all(
        not case.expected.public_eligible or case.expected.decision == "pass" for case in corpus
    )
    assert all(
        case.expected.decision != "inconclusive" or case.expected.candidate_revisions_consumed == 1
        for case in corpus
    )


def test_seeded_scorer_reports_each_required_metric_without_inventing_observations():
    corpus = _seeded_corpus()
    report = score_seeded_corpus(corpus, {})
    assert report.passed == 0
    assert report.pass_rate == 0
    assert report.missing_observations == [case.id for case in corpus]
    assert report.metrics.decision_accuracy == 0
    assert report.metrics.inconclusive_calibration == 0

    observations = {
        case.id: RoutingOutcome.model_validate(case.expected.model_dump()) for case in corpus
    }
    report = score_seeded_corpus(corpus, observations)
    assert report.passed == report.total == 16
    assert report.pass_rate == 1
    assert report.metrics.decision_accuracy == 1
    assert report.metrics.failure_class_accuracy == 1
    assert report.metrics.retry_target_accuracy == 1
    assert report.metrics.candidate_revision_accuracy == 1
    assert report.metrics.candidate_revisions_consumed == 15
    assert report.metrics.false_negative_rate == 0
    assert report.metrics.false_positive_rate == 0
    assert report.metrics.inconclusive_calibration == 1
    assert report.metrics.evidence_strength_honesty == 1
    assert report.metrics.materialization_behavior_accuracy == 1
    assert report.metrics.publication_behavior_accuracy == 1


def test_seeded_scorer_separates_false_positive_and_false_negative_rates():
    corpus = _seeded_corpus()
    observations = {
        case.id: RoutingOutcome.model_validate(case.expected.model_dump()) for case in corpus
    }
    observations["v2-01-bell-ghz-pass"] = observations["v2-01-bell-ghz-pass"].model_copy(
        update={"decision": VerifierDecision.INCONCLUSIVE}
    )
    observations["v2-02-wrong-relative-phase"] = observations[
        "v2-02-wrong-relative-phase"
    ].model_copy(update={"decision": VerifierDecision.PASS})

    report = score_seeded_corpus(corpus, observations)
    assert report.passed == 14
    assert report.metrics.false_negative_rate == pytest.approx(1 / 4)
    assert report.metrics.false_positive_rate == pytest.approx(1 / 12)


@requires_db
@requires_live_llm
async def test_harness_scores_a_passing_bell_case():
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            user, ws = await system.get_or_provision_user(
                session,
                workos_user_id=f"harness-{uuid.uuid4()}",
                email=f"harness-{uuid.uuid4().hex[:8]}@eval.test",
            )
            await session.commit()
            scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)

        case = CorpusCase(
            id="selftest-bell",
            category="A — Bell/GHZ state prep",
            prompt="prepare a bell state and measure both qubits",
            expect=Expect(output_keys=["counts"]),
        )
        result = await run_case(
            case, factory=factory, scope=scope, llm=default_llm(), sandbox=LocalSubprocessSandbox()
        )
        assert result.passed, result.reasons
        assert result.verifier_decision is None
        assert result.terminal_reason == "ai_review_aligned"
        assert result.export_status == "lossless"
        assert result.saved
        assert result.evidence.qasm_source == "sandbox_epilogue"
        assert result.evidence.qasm_epilogue_applied is True

        report = await run_corpus(
            [case],
            factory=factory,
            scope=scope,
            llm=default_llm(),
            sandbox=LocalSubprocessSandbox(),
        )
        assert report.pass_rate == 1.0
        # report serializes to the report.json the nightly workflow writes
        assert json.loads(report.model_dump_json())["passed"] == 1
    finally:
        await engine.dispose()
