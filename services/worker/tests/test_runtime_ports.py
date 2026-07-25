from uuid import uuid4
import signal

from majorana_agent import CandidateRevision, ExecutionEvidence, ExecutionFailureKind
from majorana_contracts.enums import Algorithm, Framework
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_sandbox import SandboxResult
from majorana_worker.runtime_ports import SandboxCandidateExecutor, TrustedOpenQASMConverter


def _plan(*, qubits: int = 2) -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build a Bell circuit",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {},
            "qubits_estimate": qubits,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
        }
    )


def _candidate(source: str | None = None) -> CandidateRevision:
    source = source or "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}\n"
    return CandidateRevision(
        candidate_id=uuid4(),
        run_id=uuid4(),
        tool_call_id="simple:generate:1",
        revision=1,
        plan_id=uuid4(),
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )


class RecordingSandbox:
    provider = "recording"
    environment_id = "recording:v1"

    def __init__(
        self,
        *,
        fingerprint: str | None = None,
        result: object = None,
        stdout: str = "",
        stderr: str = "",
    ) -> None:
        self.fingerprint = fingerprint
        self.result = {"counts": {"00": 1}} if result is None else result
        self.stdout = stdout
        self.stderr = stderr
        self.calls = 0
        self.last_spec = None

    async def _execute(self, spec):
        self.calls += 1
        self.last_spec = spec
        protected = {"source_fingerprint": self.fingerprint or spec.source_fingerprint}
        if self.result is not ...:
            protected["result"] = self.result
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=4,
            stdout=self.stdout,
            stderr=self.stderr,
            provider=self.provider,
            protected_result=protected,
        )


async def test_executor_runs_once_and_returns_protected_result():
    candidate = _candidate()
    sandbox = RecordingSandbox(stdout="hello", stderr="warning")

    output = await SandboxCandidateExecutor(sandbox).run_candidate(candidate, _plan())

    assert sandbox.calls == 1
    assert output.exit_code == 0
    assert output.failure_kind is None
    assert output.result == {"counts": {"00": 1}}
    assert output.observation["sandbox_stdout"] == "hello"
    assert output.observation["sandbox_stderr"] == "warning"
    assert output.observation["sandbox_runs"] == 1
    assert "_majorana_native_evidence" not in sandbox.last_spec.trusted_setup
    assert "_majorana_native_evidence" not in sandbox.last_spec.trusted_observer
    assert "resource_metrics" in sandbox.last_spec.trusted_observer


def test_sigxcpu_is_a_timeout_not_a_code_regeneration_signal():
    assert (
        SandboxCandidateExecutor._classify_failure(-signal.SIGXCPU, "")
        is ExecutionFailureKind.TIMEOUT
    )


async def test_executor_rejects_a_result_bound_to_different_source():
    output = await SandboxCandidateExecutor(RecordingSandbox(fingerprint="f" * 64)).run_candidate(
        _candidate(), _plan()
    )

    assert output.failure_kind is ExecutionFailureKind.CODE_ERROR
    assert output.observation == {"evidence_error": "source_fingerprint_mismatch"}


async def test_executor_distinguishes_missing_and_unserializable_result():
    missing = await SandboxCandidateExecutor(RecordingSandbox(result=...)).run_candidate(
        _candidate(),
        _plan(),
    )
    unserializable_sandbox = RecordingSandbox(result=...)

    async def execute_with_error(spec):
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=1,
            stdout="",
            stderr="",
            provider=unserializable_sandbox.provider,
            protected_result={
                "source_fingerprint": spec.source_fingerprint,
                "result_error": "not_json_serializable",
            },
        )

    unserializable_sandbox._execute = execute_with_error
    unserializable = await SandboxCandidateExecutor(unserializable_sandbox).run_candidate(
        _candidate(),
        _plan(),
    )

    assert missing.observation["evidence_error"] == "RESULT_missing"
    assert unserializable.observation["evidence_error"] == "RESULT_not_json_serializable"


class MustNotCreateSandbox:
    provider = "must-not-run"

    async def _execute(self, _spec):
        raise AssertionError("memory preflight must run before sandbox creation")


async def test_executor_rejects_oversized_statevector_before_provider_creation():
    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(),
        _plan(qubits=27),
    )

    assert output.failure_kind is ExecutionFailureKind.RESOURCE_LIMIT
    assert output.observation["estimated_memory_mb"] == 4096
    assert output.observation["sandbox_runs"] == 0


async def test_converter_uses_only_trusted_observation():
    candidate = _candidate()
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="1" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result={"counts": {"00": 1}},
        observation={"sandbox_stdout": "OPENQASM 3.0;"},
    )

    qasm, reason = await TrustedOpenQASMConverter().convert(candidate, execution)

    assert qasm is None
    assert reason == "framework export unavailable"
