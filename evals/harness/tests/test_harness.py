"""Harness tests for scoring helpers plus an explicitly gated live-provider run."""

import json
import os
import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, VerifierDecision
from majorana_llm import default_llm, missing_provider_keys
from majorana_sandbox import LocalSubprocessSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals import (
    CaseAggregate,
    CaseResult,
    CorpusCase,
    Expect,
    Report,
    RoutingOutcome,
    load_corpus,
    load_seeded_corpus,
    run_case,
    run_corpus,
    score_seeded_corpus,
    summarize_results,
    top_measured_bitstring,
)
from majorana_evals.runner import (
    _latest_export_event,
    _latest_sandbox_event,
    _latest_trusted_result,
    _recorded_llm_usage,
    _score_artifact_expectations,
    _score_result_expectations,
    _score_terminal_expectations,
)
from majorana_evals.schema import CaseEvidence

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="harness self-test needs DATABASE_URL"
)


#: This used to hand-list the keys and demanded BOTH OPENAI_API_KEY and
#: DEEPSEEK_API_KEY for the openai profile — true when gpt-5.5 planned and
#: verified, false since every role moved to a deepseek model. A DeepSeek-only
#: environment is a complete profile, and this skipped a run that would work.
#: `missing_provider_keys` derives the set from the role→model→endpoint chain
#: instead, so it cannot drift from the models table again.
_MISSING_KEYS = sorted(missing_provider_keys())

requires_live_llm = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_LIVE_LLM") != "1" or bool(_MISSING_KEYS),
    reason=(
        "live provider test requires MAJORANA_RUN_LIVE_LLM=1"
        + (f" and these unset variables: {', '.join(_MISSING_KEYS)}" if _MISSING_KEYS else "")
    ),
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


def test_latest_export_event_prefers_current_finalized_projection():
    legacy = SimpleNamespace(type="export.classified", payload={"status": "partial"})
    finalized = SimpleNamespace(type="code.finalized", payload={"export_status": "lossless"})
    unrelated = SimpleNamespace(type="artifact.saved", payload={})

    assert _latest_export_event([legacy, finalized, unrelated]) is finalized


def test_recorded_llm_usage_counts_only_durable_nonnegative_integer_usage():
    events = [
        SimpleNamespace(type="llm.call", payload={"input_tokens": 100, "output_tokens": 20}),
        SimpleNamespace(type="llm.call", payload={"input_tokens": 80, "output_tokens": 10}),
        SimpleNamespace(type="llm.call", payload={"input_tokens": True, "output_tokens": -1}),
        SimpleNamespace(type="sandbox.result", payload={"input_tokens": 999}),
    ]

    assert _recorded_llm_usage(events) == (3, 180, 30)


def test_summary_exposes_first_candidate_efficiency_and_oracle_errors():
    results = [
        CaseResult(
            id="case-a",
            category="holdout",
            split="holdout",
            difficulty="basic",
            workload="educational",
            trial=1,
            passed=True,
            run_status="succeeded",
            product_accepted=True,
            oracle_passed=True,
            first_candidate_passed=True,
            evidence=CaseEvidence(
                candidates_considered=1,
                recorded_llm_calls=3,
                recorded_input_tokens=100,
                recorded_output_tokens=20,
            ),
        ),
        CaseResult(
            id="case-a",
            category="holdout",
            split="holdout",
            difficulty="basic",
            workload="educational",
            trial=2,
            passed=False,
            run_status="succeeded",
            product_accepted=True,
            oracle_passed=False,
            false_positive=True,
            evidence=CaseEvidence(candidates_considered=2),
        ),
        CaseResult(
            id="case-b",
            category="holdout",
            split="holdout",
            difficulty="research",
            workload="scientific",
            passed=False,
            run_status="failed",
            oracle_passed=True,
            false_negative=True,
            evidence=CaseEvidence(candidates_considered=3),
        ),
    ]

    report = summarize_results(results, unique_cases=2, repetitions=2)

    assert report.total == 3
    assert report.passed == 1
    assert report.pass_rate_ci95_low < report.pass_rate < report.pass_rate_ci95_high
    assert report.stable_passed_cases == 0
    assert report.product_accepted == 2
    assert report.oracle_cases == 3
    assert report.oracle_passed == 2
    assert report.false_positives == 1
    assert report.false_negatives == 1
    assert report.first_candidate_passed == 1
    assert report.candidate_revisions == 6
    assert report.mean_candidates == pytest.approx(2.0)
    assert report.recorded_llm_calls == 3
    assert report.recorded_input_tokens == 100
    assert report.recorded_output_tokens == 20
    assert report.by_case[0] == CaseAggregate(
        id="case-a",
        category="holdout",
        split="holdout",
        difficulty="basic",
        workload="educational",
        trials=2,
        passed=1,
        pass_rate=0.5,
        product_accepted=2,
        oracle_trials=2,
        oracle_passed=1,
        false_positives=1,
        false_negatives=0,
        first_candidate_passed=1,
        mean_candidates=1.5,
    )
    assert [(item.name, item.trials, item.passed) for item in report.by_difficulty] == [
        ("basic", 2, 1),
        ("research", 1, 0),
    ]
    assert [(item.name, item.trials) for item in report.by_workload] == [
        ("educational", 2),
        ("scientific", 1),
    ]


def test_summary_reports_trial_aligned_metamorphic_robustness_and_consistency():
    def result(
        group: str,
        variant: str,
        trial: int,
        passed: bool,
        *,
        candidates: int = 1,
    ) -> CaseResult:
        return CaseResult(
            id=f"{group}-{variant}",
            category="metamorphic holdout",
            split="holdout",
            difficulty="advanced",
            workload="scientific",
            semantic_group_id=group,
            prompt_variant=variant,
            trial=trial,
            passed=passed,
            run_status="succeeded" if passed else "failed",
            evidence=CaseEvidence(candidates_considered=candidates),
        )

    results = [
        result("robust", "base", 1, True),
        result("robust", "surface-02", 1, True),
        result("robust", "base", 2, True),
        result("robust", "surface-02", 2, True),
        result("wording-sensitive", "base", 1, True),
        result("wording-sensitive", "surface-02", 1, False, candidates=2),
        result("wording-sensitive", "base", 2, False),
        result("wording-sensitive", "surface-02", 2, True, candidates=2),
    ]

    report = summarize_results(results, unique_cases=4, repetitions=2)

    assert report.metamorphic_groups == 2
    assert report.metamorphic_robust_groups == 1
    assert report.metamorphic_consistent_groups == 1
    assert report.metamorphic_robustness == 0.5
    assert report.metamorphic_consistency == 0.5
    robust, sensitive = report.by_semantic_group
    assert robust.semantic_group_id == "robust"
    assert robust.trial_matrix_complete
    assert robust.all_variants_passed
    assert robust.outcome_consistent
    assert robust.variant_pass_rates == {"base": 1.0, "surface-02": 1.0}
    assert sensitive.semantic_group_id == "wording-sensitive"
    assert sensitive.trial_matrix_complete
    assert not sensitive.all_variants_passed
    assert not sensitive.outcome_consistent
    assert sensitive.variant_pass_rates == {"base": 0.5, "surface-02": 0.5}
    assert sensitive.mean_candidates == 1.5
    assert [(item.name, item.trials, item.pass_rate) for item in report.by_prompt_variant] == [
        ("base", 4, 0.75),
        ("surface-02", 4, 0.75),
    ]


def test_summary_never_calls_an_incomplete_metamorphic_matrix_robust():
    results = [
        CaseResult(
            id="base",
            category="metamorphic holdout",
            semantic_group_id="group",
            prompt_variant="base",
            trial=1,
            passed=True,
            run_status="succeeded",
        ),
        CaseResult(
            id="variant",
            category="metamorphic holdout",
            semantic_group_id="group",
            prompt_variant="surface-02",
            trial=2,
            passed=True,
            run_status="succeeded",
        ),
    ]

    report = summarize_results(results, unique_cases=2, repetitions=2)

    aggregate = report.by_semantic_group[0]
    assert not aggregate.trial_matrix_complete
    assert not aggregate.all_variants_passed
    assert not aggregate.outcome_consistent


def test_metamorphic_provenance_is_atomic_and_old_reports_remain_loadable():
    with pytest.raises(ValueError, match="must be set together"):
        CorpusCase(
            id="invalid-case",
            category="validation",
            semantic_group_id="group",
            prompt="Run a circuit.",
        )
    with pytest.raises(ValueError, match="must be set together"):
        CaseResult(
            id="invalid-result",
            category="validation",
            prompt_variant="base",
            passed=True,
            run_status="succeeded",
        )

    legacy = Report.model_validate({"total": 0, "passed": 0, "pass_rate": 0.0, "cases": []})
    assert legacy.metamorphic_groups == 0
    assert legacy.by_semantic_group == []
    assert legacy.by_prompt_variant == []


async def test_run_corpus_repeats_every_case_and_preserves_trial_numbers(monkeypatch):
    calls: list[tuple[str, int]] = []

    async def fake_run_case(case, *, trial, **_kwargs):
        calls.append((case.id, trial))
        return CaseResult(
            id=case.id,
            category=case.category,
            split="holdout",
            difficulty=case.difficulty,
            workload=case.workload,
            trial=trial,
            passed=True,
            run_status="succeeded",
            product_accepted=True,
            first_candidate_passed=True,
            evidence=CaseEvidence(candidates_considered=1),
        )

    monkeypatch.setattr("majorana_evals.runner.run_case", fake_run_case)
    cases = [
        SimpleNamespace(
            id="case-a",
            category="basic",
            difficulty="basic",
            workload="educational",
        ),
        SimpleNamespace(
            id="case-b",
            category="research",
            difficulty="research",
            workload="scientific",
        ),
    ]

    report = await run_corpus(
        cases,
        factory=None,
        scope=None,
        llm=None,
        sandbox=None,
        repetitions=3,
    )

    assert calls == [
        ("case-a", 1),
        ("case-b", 1),
        ("case-a", 2),
        ("case-b", 2),
        ("case-a", 3),
        ("case-b", 3),
    ]
    assert report.total == 6
    assert report.unique_cases == 2
    assert report.repetitions == 3
    assert report.stable_passed_cases == 2
    assert all(case.trials == 3 and case.pass_rate == 1.0 for case in report.by_case)


async def test_run_corpus_rejects_nonpositive_repetitions():
    with pytest.raises(ValueError, match="at least 1"):
        await run_corpus(
            [],
            factory=None,
            scope=None,
            llm=None,
            sandbox=None,
            repetitions=0,
        )


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
        async def list_candidates(self, _run_id):
            return [candidate]

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
    assert top_measured_bitstring({"counts": {"0": -1, "1": 2}}) is None
    assert top_measured_bitstring({"counts": {"0": 0, "1": 0}}) is None


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


def test_numeric_range_expectations_are_inclusive_and_reject_nonfinite_values():
    expect = Expect(
        expected_value_ranges={
            "sampled_probability": {"minimum": 0.4, "maximum": 0.6},
        }
    )

    assert _score_result_expectations(expect, {"sampled_probability": 0.4}) == []
    assert _score_result_expectations(expect, {"sampled_probability": 0.6}) == []
    assert _score_result_expectations(expect, {"sampled_probability": 0.6001}) == [
        "RESULT field 'sampled_probability' 0.6001 is outside expected inclusive range [0.4, 0.6]"
    ]
    assert _score_result_expectations(expect, {"sampled_probability": float("nan")}) == [
        "RESULT field 'sampled_probability' is not finite"
    ]
    assert _score_result_expectations(
        Expect(expected_values={"energy": -1.0}),
        {"energy": float("inf")},
    ) == ["RESULT field 'energy' is not finite"]


def test_numeric_range_schema_rejects_reversed_nonfinite_and_overlapping_expectations():
    with pytest.raises(ValueError, match="minimum must not exceed maximum"):
        Expect(expected_value_ranges={"sample": {"minimum": 0.7, "maximum": 0.6}})
    with pytest.raises(ValueError, match="finite number"):
        Expect(expected_value_ranges={"sample": {"minimum": 0.0, "maximum": float("inf")}})
    with pytest.raises(ValueError, match="both exact and range expectations"):
        Expect(
            expected_values={"sample": 0.5},
            expected_value_ranges={"sample": {"minimum": 0.4, "maximum": 0.6}},
        )


def test_count_marginals_are_computed_from_protected_displayed_bitstrings():
    expect = Expect(
        expected_count_marginals=[
            {
                "result_key": "counts",
                "bit_indices": [0],
                "expected_bits": "0",
                "probability_range": {"minimum": 1.0, "maximum": 1.0},
            },
            {
                "result_key": "counts",
                "bit_indices": [1],
                "expected_bits": "1",
                "probability_range": {"minimum": 0.2, "maximum": 0.3},
            },
        ]
    )

    assert _score_result_expectations(expect, {"counts": {"00": 75, "01": 25}}) == []
    assert _score_result_expectations(
        expect,
        {"counts": {"00": 60, "01": 20, "10": 20}},
    ) == [
        "counts marginal 'counts'[0]='0' has probability 0.8, outside expected "
        "inclusive range [1.0, 1.0]"
    ]
    assert _score_result_expectations(expect, {"counts": {"0": 100}}) == [
        "count marginal indices [1] exceed displayed key width 1 in RESULT field 'counts'"
    ]
    assert _score_result_expectations(expect, {"counts": {"00": -1, "01": 2}}) == [
        "expected nonnegative nonempty counts RESULT field 'counts' was not found",
        "expected nonnegative nonempty counts RESULT field 'counts' was not found",
    ]


def test_count_marginal_schema_rejects_ambiguous_or_invalid_selections():
    common = {
        "result_key": "counts",
        "probability_range": {"minimum": 0.0, "maximum": 1.0},
    }
    with pytest.raises(ValueError, match="must be unique"):
        Expect(
            expected_count_marginals=[
                {**common, "bit_indices": [0, 0], "expected_bits": "00"},
            ]
        )
    with pytest.raises(ValueError, match="length must match"):
        Expect(
            expected_count_marginals=[
                {**common, "bit_indices": [0, 1], "expected_bits": "0"},
            ]
        )
    with pytest.raises(ValueError, match="within 0..1"):
        Expect(
            expected_count_marginals=[
                {
                    **common,
                    "bit_indices": [0],
                    "expected_bits": "0",
                    "probability_range": {"minimum": 0.0, "maximum": 1.1},
                },
            ]
        )


def test_artifact_expectations_use_trusted_state_qasm_and_optimization_evidence():
    amplitude = 2**-0.5
    expect = Expect(
        expected_native_statevector=[
            (amplitude, 0.0),
            (0.0, 0.0),
            (0.0, 0.0),
            (amplitude, 0.0),
        ],
        native_statevector_tolerance=1e-12,
        allowed_qasm_gate_names=["rz", "sx", "x", "cx"],
        requires_native_optimization=True,
    )
    observation = {
        # The observed Bell state differs by global phase i, which is physically equal.
        "native_statevector": {"amplitudes": [0.0, amplitude, 0.0, 0.0, 0.0, 0.0, 0.0, amplitude]},
        "interchange_qasm": (
            'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\n'
            "rz(0.5) q[0];\nsx q[0];\ncx q[0], q[1];\n"
        ),
        "native_optimization": {"applied": True},
    }

    assert _score_artifact_expectations(expect, observation) == []

    observation["native_statevector"] = {
        "amplitudes": [amplitude, 0.0, 0.0, 0.0, amplitude, 0.0, 0.0, 0.0]
    }
    observation["interchange_qasm"] += "h q[1];\n"
    reasons = _score_artifact_expectations(expect, observation)
    assert "native statevector differs" in reasons[0]
    assert reasons[1] == ("trusted FINAL_CIRCUIT QASM contains gates outside the allowed basis: h")


def test_artifact_state_oracle_falls_back_to_independent_trusted_qasm_simulation():
    amplitude = 2**-0.5
    expect = Expect(
        expected_native_statevector=[
            (amplitude, 0.0),
            (0.0, 0.0),
            (0.0, 0.0),
            (amplitude, 0.0),
        ],
        native_statevector_tolerance=1e-12,
    )
    observation = {
        "interchange_qasm": (
            'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n'
        )
    }

    assert _score_artifact_expectations(expect, observation) == []


def test_artifact_expectation_schema_rejects_invalid_statevectors_and_gate_names():
    with pytest.raises(ValueError, match="power of two"):
        Expect(expected_native_statevector=[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0)])
    with pytest.raises(ValueError, match="normalized"):
        Expect(expected_native_statevector=[(1.0, 0.0), (1.0, 0.0)])
    with pytest.raises(ValueError, match="lowercase identifiers"):
        Expect(allowed_qasm_gate_names=["RZ"])
    with pytest.raises(ValueError, match="must be unique"):
        Expect(allowed_qasm_gate_names=["rz", "rz"])


def test_structured_result_subset_checks_unique_assignment_and_allows_extra_fields():
    expect = Expect(
        expected_result_subset={
            "assignment": {"worker_0": 1, "worker_1": 0},
            "selected_projects": [0, 2, 5],
            "diagnostics": {"feasible": True, "gap": 0.0},
        },
        expected_value_tolerance=1e-6,
    )

    assert (
        _score_result_expectations(
            expect,
            {
                "assignment": {"worker_0": 1, "worker_1": 0, "worker_2": 2},
                "selected_projects": [0, 2, 5],
                "diagnostics": {"feasible": True, "gap": 5e-7, "iterations": 12},
                "counts": {"010101": 100},
            },
        )
        == []
    )


def test_structured_result_subset_reports_nested_mismatches():
    expect = Expect(
        expected_result_subset={
            "assignment": [2, 0, 1],
            "diagnostics": {"feasible": True, "gap": 0.0},
        },
        expected_value_tolerance=1e-6,
    )

    assert _score_result_expectations(
        expect,
        {
            "assignment": [2, 1, 0],
            "diagnostics": {"feasible": False, "gap": 0.01},
        },
    ) == [
        "RESULT.assignment[1] 1 is outside expected 0 ± 1e-06",
        "RESULT.assignment[2] 0 is outside expected 1 ± 1e-06",
        "RESULT.diagnostics.feasible False != expected True",
        "RESULT.diagnostics.gap 0.01 is outside expected 0.0 ± 1e-06",
    ]


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
    references = {
        "bench-14",
        "bench-15",
        "bench-16",
        "bench-17",
        "bench-18",
        "bench-19",
        "bench-20",
        "bench-31",
    }
    assert all(
        c.expect.terminal_reason
        == ("ai_review_aligned_with_reference_check" if c.id in references else "ai_review_aligned")
        for c in corpus
    )
    assert all(c.expect.verifier_decision is None for c in corpus)


def test_end_to_end_holdout_is_frozen_and_balanced_by_difficulty():
    from pathlib import Path

    root = Path(__file__).parents[3] / "evals"
    calibration = load_corpus(root / "corpus")
    holdout = load_corpus(root / "holdout-v1")

    assert len(holdout) == 8
    assert {case.id for case in calibration}.isdisjoint(case.id for case in holdout)
    assert all(case.split == "holdout" for case in holdout)
    assert {
        difficulty: sum(case.difficulty == difficulty for case in holdout)
        for difficulty in {case.difficulty for case in holdout}
    } == {"basic": 2, "intermediate": 2, "advanced": 2, "research": 2}
    assert {case.workload for case in holdout} == {
        "educational",
        "practical",
        "scientific",
    }
    assert all(
        case.expect.expected_values or case.expect.expected_top_bitstring for case in holdout
    )


def test_mixed_stability_holdout_v9_is_frozen_and_has_value_oracles():
    from pathlib import Path

    root = Path(__file__).parents[3] / "evals"
    holdout = load_corpus(root / "holdout-v9")

    assert len(holdout) == 10
    assert [case.id for case in holdout] == [f"holdout-v9-{index:02d}" for index in range(1, 11)]
    assert all(case.split == "holdout" for case in holdout)
    assert {case.difficulty for case in holdout} == {
        "basic",
        "intermediate",
        "advanced",
        "research",
    }
    assert {case.workload for case in holdout} == {
        "educational",
        "practical",
        "scientific",
    }
    assert all(
        case.expect.expected_values
        or case.expect.expected_result_subset
        or case.expect.expected_top_bitstring
        for case in holdout
    )
    assert holdout[2].expect.expected_result_subset["selected_projects"] == [1, 4, 5, 6, 8]
    assert holdout[3].expect.expected_result_subset["jobs_by_worker"] == [1, 2, 0]


def test_unseen_mixed_holdout_v14_is_frozen_before_provider_execution():
    """Pin the cohort and independent oracles before its first model outcome exists."""
    from pathlib import Path

    root = Path(__file__).parents[3] / "evals"
    holdout = load_corpus(root / "holdout-v14")

    assert [case.id for case in holdout] == [f"holdout-v14-{index:02d}" for index in range(1, 11)]
    assert all(case.split == "holdout" for case in holdout)
    assert {
        difficulty: sum(case.difficulty == difficulty for case in holdout)
        for difficulty in {case.difficulty for case in holdout}
    } == {"basic": 1, "intermediate": 1, "advanced": 3, "research": 5}
    assert {
        workload: sum(case.workload == workload for case in holdout)
        for workload in {case.workload for case in holdout}
    } == {"educational": 2, "practical": 2, "scientific": 6}
    assert all(
        case.expect.expected_values
        or case.expect.expected_result_subset
        or case.expect.expected_top_bitstring
        for case in holdout
    )
    assert holdout[3].expect.expected_result_subset["jobs_by_technician"] == [1, 0, 2, 3]
    assert holdout[4].expect.expected_values["ansatz_expectation"] == pytest.approx(
        -0.8815390432246132
    )
    assert holdout[6].expect.expected_values["target_observable"] == pytest.approx(
        -0.39622224286802227
    )
    assert holdout[7].expect.expected_values["state_purity"] == pytest.approx(0.7934244820273426)
    assert holdout[8].expect.expected_values["zero_over_one"] == pytest.approx(4.684782608695656)


def test_qae_family_holdout_is_frozen_before_provider_execution():
    """Pin different widths, predicates, output names, and independent grid oracles."""
    from pathlib import Path

    root = Path(__file__).parents[3] / "evals"
    holdout = load_corpus(root / "diagnostic-qae-family")

    assert [case.id for case in holdout] == [
        f"diagnostic-qae-family-{index:02d}" for index in range(1, 4)
    ]
    assert all(case.split == "holdout" for case in holdout)
    assert [case.difficulty for case in holdout] == ["advanced", "research", "research"]
    assert all(case.workload == "scientific" for case in holdout)
    assert holdout[0].expect.expected_values == {
        "folded_phase_bin": 5.0,
        "estimated_good_weight": pytest.approx(0.22221488349019888),
        "symmetric_peak_mass": 1.0,
    }
    assert holdout[1].expect.expected_values == {
        "decoded_fold": 3.0,
        "finite_grid_probability": pytest.approx(0.08426519384872735),
        "paired_support": pytest.approx(0.9931061446753955),
    }
    assert holdout[2].expect.expected_values == {
        "folded_register_index": 9.0,
        "grid_amplitude": pytest.approx(0.5975451610080641),
        "mirror_pair_probability": 1.0,
    }


def test_teleport_family_holdout_is_frozen_before_provider_execution():
    """Pin distinct input states and RESULT names before any provider outcome."""
    from pathlib import Path

    root = Path(__file__).parents[3] / "evals"
    holdout = load_corpus(root / "diagnostic-teleport-family")

    assert [case.id for case in holdout] == [
        f"diagnostic-teleport-family-{index:02d}" for index in range(1, 4)
    ]
    assert all(case.split == "holdout" for case in holdout)
    assert [case.difficulty for case in holdout] == ["advanced", "intermediate", "basic"]
    assert all(case.workload == "educational" for case in holdout)
    assert holdout[0].expect.expected_values == {
        "receiver_x": pytest.approx(-0.35707688781634755),
        "receiver_y": pytest.approx(-0.8267832327924862),
        "receiver_z": pytest.approx(0.434655705312373),
        "transfer_fidelity": 1.0,
    }
    assert holdout[1].expect.expected_values == {
        "final_bloch_x": pytest.approx(0.7068679154415649),
        "final_bloch_y": pytest.approx(0.4940433192408096),
        "final_bloch_z": pytest.approx(0.5062202572327784),
        "reduced_state_fidelity": 1.0,
    }
    assert holdout[2].expect.expected_values == {
        "output_x": 0.0,
        "output_y": 1.0,
        "output_z": 0.0,
        "teleport_fidelity": 1.0,
    }


def test_dynamics_family_holdout_is_frozen_before_provider_execution():
    """Pin different widths, complex supports, and RESULT names before provider use."""
    from pathlib import Path

    root = Path(__file__).parents[3] / "evals"
    holdout = load_corpus(root / "diagnostic-dynamics-family")

    assert [case.id for case in holdout] == [
        f"diagnostic-dynamics-family-{index:02d}" for index in range(1, 4)
    ]
    assert all(case.split == "holdout" for case in holdout)
    assert [case.difficulty for case in holdout] == ["advanced", "research", "intermediate"]
    assert all(case.workload == "scientific" for case in holdout)
    assert holdout[0].expect.expected_values == {
        "mixed_pauli_signal": pytest.approx(0.20503414905900022),
        "basis_return_weight": pytest.approx(0.9835338666014788),
    }
    assert holdout[1].expect.expected_values == {
        "six_body_readout": pytest.approx(-0.38518831651352387),
        "initial_overlap_squared": pytest.approx(0.9810865580893054),
    }
    assert holdout[2].expect.expected_values == {
        "rotated_observable": pytest.approx(0.4184634483473595),
        "survival_mass": pytest.approx(0.7963317010493219),
    }


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
