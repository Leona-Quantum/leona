"""Harness tests for scoring helpers plus an explicitly gated live-provider run."""

import json
import os
import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_llm import default_llm
from majorana_sandbox import LocalSubprocessSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals import (
    CorpusCase,
    Expect,
    load_corpus,
    run_case,
    run_corpus,
    top_measured_bitstring,
)
from majorana_evals.runner import _last_json_object, _latest_sandbox_event

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
    # dominant state wins; the last JSON line is the one parsed
    stdout = 'noise\n{"counts": {"1100": 970, "0000": 12, "1000": 18}}'
    assert top_measured_bitstring(stdout) == "1100"
    # register-separator spaces are stripped so it compares to a plain target
    assert top_measured_bitstring('{"counts": {"11 00": 900, "00 11": 5}}') == "1100"
    # no counts / unparseable → None, not a crash
    assert top_measured_bitstring('{"energy": -1.137}') is None
    assert top_measured_bitstring("not json at all") is None
    assert top_measured_bitstring("") is None


def test_top_measured_bitstring_ignores_appended_qasm_epilogue():
    stdout = """{\"counts\": {\"1100\": 973, \"0000\": 27}}
__MAJORANA_FINAL_QASM_BEGIN__
OPENQASM 2.0;
include \"qelib1.inc\";
qreg q[4];
creg c[4];
measure q[0] -> c[0];
__MAJORANA_FINAL_QASM_END__"""
    assert top_measured_bitstring(stdout) == "1100"


def test_latest_sandbox_event_uses_repaired_terminal_attempt():
    first = SimpleNamespace(type="sandbox.result", payload={"stdout": ""})
    final = SimpleNamespace(
        type="sandbox.result", payload={"stdout": '{"ground_state_energy_Ha": -1.1}'}
    )
    unrelated = SimpleNamespace(type="stage.started", payload={})
    assert _latest_sandbox_event([first, unrelated, final]) is final


def test_last_json_object_reads_pretty_result_before_qasm_epilogue():
    stdout = """{
  \"ground_state_energy_Ha\": -1.1373,
  \"counts\": {\"00\": 10}
}
__MAJORANA_FINAL_QASM_BEGIN__
OPENQASM 2.0;
__MAJORANA_FINAL_QASM_END__"""
    assert _last_json_object(stdout)["ground_state_energy_Ha"] == -1.1373


def test_value_check_catches_endianness_bit_reversal():
    # The Grover-1100 failure mode: circuit is well-formed and the verifier passes it,
    # but the recovered top state is the bit-reversal 0011. The value-level check must
    # reject it even though verifier_decision would say pass. Guards NEXT.md's warning
    # that a naive bench-30 gives false comfort on a wrong answer.
    bit_reversed = '{"counts": {"0011": 973, "0000": 27}}'
    assert top_measured_bitstring(bit_reversed) == "0011"
    assert top_measured_bitstring(bit_reversed) != "1100"

    correct = '{"counts": {"1100": 973, "0000": 27}}'
    assert top_measured_bitstring(correct) == "1100"


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
    # every case pins an honest expectation
    assert all(c.expect.verifier_decision for c in corpus)


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
        assert result.verifier_decision == "pass"
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
