from uuid import uuid4

from majorana_agent import CandidateRevision, ExecutionEvidence
from majorana_contracts.enums import Algorithm, Framework, VerifierDecision
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_llm import LLMResponse
from majorana_sandbox import SandboxResult
from majorana_worker.agent_ports import (
    EvidenceVerifier,
    SandboxCandidateExecutor,
    TrustedOpenQASMConverter,
)


def _plan(*, expected_keys=None) -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build and verify a Bell circuit",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": expected_keys or ["counts"],
        }
    )


def _candidate() -> CandidateRevision:
    source = "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}\n"
    return CandidateRevision(
        candidate_id=uuid4(),
        run_id=uuid4(),
        tool_call_id="simulate-1",
        revision=1,
        plan_id=uuid4(),
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )


def _execution(candidate, *, result=None, observation=None):
    return ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="1" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result=result or {"counts": {"00": 1}},
        observation=(
            observation
            if observation is not None
            else {
                "resource_metrics": {
                    "qubits": 2,
                    "depth": 2,
                    "gate_count": 2,
                    "two_qubit_gate_count": 1,
                    "measurement_count": 2,
                }
            }
        ),
    )


class MustNotRunLLM:
    async def complete(self, *_args, **_kwargs):
        raise AssertionError("critic must not override deterministic failure")


async def test_deterministic_failure_short_circuits_semantic_critic():
    candidate = _candidate()
    verifier = EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state")
    output = await verifier.verify(
        candidate,
        _execution(candidate, result={"wrong": True}),
        _plan(expected_keys=["counts"]),
    )
    assert output.decision is VerifierDecision.FAIL
    assert output.repair is not None
    assert output.repair.category == "deterministic_verification_failed"


class PassingCriticLLM:
    async def complete(self, request, *, on_delta=None):
        return LLMResponse(
            text='{"decision":"pass","findings":[],"repairs":[]}',
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


async def test_semantic_critic_runs_only_after_deterministic_pass():
    candidate = _candidate()
    output = await EvidenceVerifier(llm=PassingCriticLLM(), task_prompt="Bell state").verify(
        candidate, _execution(candidate), _plan()
    )
    assert output.decision is VerifierDecision.PASS
    assert all(check["result"] == "pass" for check in output.deterministic_checks)


class MismatchedSandbox:
    provider = "test-sandbox"

    async def _execute(self, _spec):
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=1,
            stdout="",
            stderr="",
            provider=self.provider,
            protected_result={
                "source_fingerprint": "f" * 64,
                "result": {"counts": {"00": 1}},
            },
        )


async def test_executor_rejects_sidecar_for_different_source():
    candidate = _candidate()
    output = await SandboxCandidateExecutor(MismatchedSandbox()).run_candidate(candidate, _plan())
    assert output.exit_code == 3
    assert output.observation == {"evidence_error": "source_fingerprint_mismatch"}


async def test_openqasm_converter_never_uses_stdout_or_reexecutes():
    candidate = _candidate()
    qasm, reason = await TrustedOpenQASMConverter().convert(
        candidate,
        _execution(candidate, observation={"model_stdout": "OPENQASM 3.0;"}),
    )
    assert qasm is None
    assert reason == "framework export unavailable"
