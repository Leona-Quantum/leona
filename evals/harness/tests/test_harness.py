"""Harness self-test (db-gated): proves the harness drives the pipeline and scores
a case correctly, using a prompt-aware FakeLLM + LocalSubprocessSandbox so no paid
provider is needed. The real baseline run (real providers, full corpus) is the
owner-gated number the nightly workflow produces."""

import json
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_llm import FakeLLM, LLMRequest
from majorana_llm.models import model_for
from majorana_sandbox import LocalSubprocessSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals import CorpusCase, Expect, load_corpus, run_case, run_corpus

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="harness self-test needs DATABASE_URL"
)

_PLAN = {
    "domain": "education",
    "framework": "qiskit",
    "algorithm": "Bell",
    "problem_summary": "Prepare a Bell state and measure both qubits",
    "algorithm_rationale": "Hadamard then CX entangles the two qubits",
    "parameters": {},
    "qubits_estimate": 2,
    "expected_runtime_sec": 5,
    "success_criteria": {"primary_metric": "fidelity"},
    "expected_output_keys": ["counts"],
}

_CODE = """```python
import json
from qiskit import QuantumCircuit

FINAL_CIRCUIT = QuantumCircuit(2)
FINAL_CIRCUIT.h(0)
FINAL_CIRCUIT.cx(0, 1)
FINAL_CIRCUIT.measure_all()
print(json.dumps({"counts": {"00": 512, "11": 512}}))
```"""


def _fake() -> FakeLLM:
    def plan(_req: LLMRequest) -> str:
        return json.dumps(_PLAN)

    return FakeLLM({model_for("plan"): plan, model_for("generate"): _CODE})


def test_corpus_loads_from_yaml():
    from pathlib import Path

    corpus = load_corpus(Path(__file__).parents[3] / "evals" / "corpus")
    assert corpus, "starter corpus should be non-empty"
    assert any(c.id == "bench-01" for c in corpus)
    # every case pins an honest expectation
    assert all(c.expect.verifier_decision for c in corpus)


@requires_db
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
            case, factory=factory, scope=scope, llm=_fake(), sandbox=LocalSubprocessSandbox()
        )
        assert result.passed, result.reasons
        assert result.verifier_decision == "pass"
        assert result.export_status == "lossless"
        assert result.saved
        assert result.evidence.qasm_source == "sandbox_epilogue"
        assert result.evidence.qasm_epilogue_applied is True

        report = await run_corpus(
            [case], factory=factory, scope=scope, llm=_fake(), sandbox=LocalSubprocessSandbox()
        )
        assert report.pass_rate == 1.0
        # report serializes to the report.json the nightly workflow writes
        assert json.loads(report.model_dump_json())["passed"] == 1
    finally:
        await engine.dispose()
