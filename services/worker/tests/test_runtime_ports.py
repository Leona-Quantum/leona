from uuid import uuid4
import signal

import pytest

from majorana_agent import CandidateRevision, ExecutionEvidence, ExecutionFailureKind
from majorana_contracts.enums import Algorithm, Framework
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_api.tiers import TIER_LIMITS, limits_for
from majorana_sandbox import DEFAULT_MEMORY_MB, MAX_MEMORY_MB, SandboxResult
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


async def test_executor_collects_native_evidence_for_supported_result_profiles():
    payload = _plan().model_dump(mode="json")
    payload.update(
        {
            "qubits_estimate": 1,
            "success_criteria": {"primary_metric": "probability_one"},
            "expected_output_keys": [
                "bloch_x",
                "bloch_y",
                "bloch_z",
                "probability_one",
            ],
        }
    )
    plan = Plan.model_validate(payload)
    source = (
        "from qiskit import QuantumCircuit\n"
        "FINAL_CIRCUIT = QuantumCircuit(1)\n"
        "RESULT = {'bloch_x': 0.0, 'bloch_y': 0.0, 'bloch_z': 1.0, "
        "'probability_one': 0.0}\n"
    )
    sandbox = RecordingSandbox(result={"probability_one": 0.0})

    await SandboxCandidateExecutor(sandbox).run_candidate(_candidate(source), plan)

    assert "_majorana_native_evidence" in sandbox.last_spec.trusted_setup
    assert "_majorana_native_evidence" in sandbox.last_spec.trusted_observer
    assert sandbox.last_spec.timeout_s == 61


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


async def test_executor_marks_oversized_statevector_not_run_before_provider_creation():
    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(),
        _plan(qubits=27),
    )

    assert output.failure_kind is ExecutionFailureKind.RESOURCE_LIMIT
    assert output.observation["estimated_memory_mb"] == 4096
    assert output.observation["sandbox_runs"] == 0
    assert output.observation["execution_status"] == "not_run"
    assert output.observation["execution_reason_code"] == ("local_statevector_capacity_exceeded")
    assert output.observation["target_backend"] == "unassigned_external"


async def test_industrial_scale_source_is_delivered_before_local_contract_checks():
    """The module-scope FINAL_CIRCUIT contract is what artifact-only delivery relaxes.

    A `run(backend)` entry point is the shape the generator prompt promises for a
    circuit too large to build at import, and it is deliverable without ever
    satisfying the contract the local lane would have checked by executing it.
    """
    source = (
        "from qiskit import QuantumCircuit\n\n"
        "def run(backend):\n"
        "    return {'counts': backend.run(QuantumCircuit(480)).result()}\n"
    )

    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(source),
        _plan(qubits=480),
    )

    assert output.failure_kind is ExecutionFailureKind.RESOURCE_LIMIT
    assert output.observation["qubits"] == 480
    assert output.observation["execution_status"] == "not_run"
    assert output.observation["sandbox_runs"] == 0


async def test_artifact_only_delivery_refuses_source_with_no_entry_point():
    """UNKNOWN source is not published as a backend-ready artifact.

    `roles.classify_source` calls source that binds neither FINAL_CIRCUIT nor
    RESULT "something this product cannot execute". Nothing can be lifted from
    it, so an artifact holding it could never be exported, submitted, or run
    when a backend that fits it connects. The check is pure AST and must run
    BEFORE the resource preflight returns not_run — after it, the candidates it
    catches are exactly the ones no execution will catch instead.
    """
    source = "from qiskit import QuantumCircuit\n\ndef build():\n    return QuantumCircuit(480)\n"

    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(source),
        _plan(qubits=480),
    )

    assert output.failure_kind is ExecutionFailureKind.CODE_ERROR
    assert output.observation["contract_diagnostics"] == [
        "contract:qiskit source delivered without execution must bind FINAL_CIRCUIT "
        "or define a module-scope run(backend) entry point"
    ]
    # Routed to the repair loop, not published: a not_run observation here is
    # what would make it artifact-only eligible downstream.
    assert "execution_status" not in output.observation


async def test_artifact_only_delivery_accepts_a_bound_final_circuit():
    source = "from qiskit import QuantumCircuit\n\nFINAL_CIRCUIT = QuantumCircuit(480)\n"

    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(source),
        _plan(qubits=480),
    )

    assert output.failure_kind is ExecutionFailureKind.RESOURCE_LIMIT
    assert output.observation["execution_status"] == "not_run"


async def test_a_nested_run_is_not_an_entry_point():
    """Module scope only — a `run` a caller cannot reach is not one."""
    source = (
        "from qiskit import QuantumCircuit\n\n"
        "def build():\n"
        "    def run(backend):\n"
        "        return {}\n"
        "    return run\n"
    )

    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(source),
        _plan(qubits=480),
    )

    assert output.failure_kind is ExecutionFailureKind.CODE_ERROR
    assert "execution_status" not in output.observation


async def test_artifact_only_source_still_obeys_selected_framework_boundary():
    source = "import cirq\n\ndef build():\n    return cirq.Circuit()\n"

    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(source),
        _plan(qubits=480),
    )

    assert output.failure_kind is ExecutionFailureKind.CODE_ERROR
    assert output.observation["contract_diagnostics"] == [
        "contract:qiskit source imports foreign quantum framework `cirq`"
    ]
    assert "execution_status" not in output.observation


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


def test_a_statevector_estimate_stays_a_number_a_json_reader_can_hold():
    """The figure is copied into resource_metrics and parsed by a browser.

    `qubits_estimate` lost its upper bound when authoring stopped being capped by
    local capacity, so this estimate is `2**n` scaled — at 1,024 qubits about
    10^300, and above roughly 1,038 beyond the IEEE 754 double range, where
    `JSON.parse` yields Infinity and every arithmetic use downstream is poisoned.
    """
    executor = SandboxCandidateExecutor(MustNotCreateSandbox())
    ceiling = SandboxCandidateExecutor._MAX_REPORTABLE_STATEVECTOR_QUBITS

    at_ceiling = executor._statevector_memory_mb(ceiling)
    assert isinstance(at_ceiling, int)
    # Representable as a double, which is what every consumer of this field uses.
    assert float(at_ceiling) != float("inf")

    # And one qubit past a double's range is exactly the case the cap exists for:
    # the arithmetic still works in Python and stops being reportable.
    huge = executor._statevector_memory_mb(1_100)
    with pytest.raises(OverflowError):
        float(huge)


async def test_the_spec_carries_the_tier_allowance_not_the_default():
    """ai-ops#171: a paid run asks for the paid lane, and it must reach the spec.

    Before this the executor set no `memory_mb` at all, so every run in the
    product — free and paid alike — took `DEFAULT_MEMORY_MB`. The assertion that
    matters is on `last_spec`, not on the executor's attribute: the field is only
    a bound if it reaches the object the provider is handed.
    """
    sandbox = RecordingSandbox()

    await SandboxCandidateExecutor(sandbox, memory_mb=4096).run_candidate(_candidate(), _plan())

    assert sandbox.last_spec.memory_mb == 4096


async def test_a_forgotten_tier_under_provisions_rather_than_over_provisions():
    """The default is the free lane, and that direction is the whole point.

    `memory_mb` is a vCPU request one call away — `vercel._create_kwargs` derives
    `(memory_mb + 2047) // 2048` — so a construction site that omits the tier
    must cost the operator less, not more. A default of `MAX_MEMORY_MB` would
    have handed every un-threaded call site two vCPUs on a free account's run,
    and nothing would have failed.
    """
    sandbox = RecordingSandbox()

    await SandboxCandidateExecutor(sandbox).run_candidate(_candidate(), _plan())

    assert sandbox.last_spec.memory_mb == DEFAULT_MEMORY_MB
    assert DEFAULT_MEMORY_MB <= limits_for("free").sandbox_memory_mb


def test_no_tier_may_exceed_the_sandbox_ceiling():
    """The tier table feeds `ExecutionSpec.memory_mb`, which refuses above the cap.

    A tier row edited to 8192 would not fail in any obvious place — it would fail
    at the first execute run of an account on that tier, inside a job, as a
    pydantic ValidationError. This is the only suite that can check it: the API
    owns the allowance and does not depend on `majorana-sandbox`, the sandbox
    owns the ceiling and does not know about tiers, and the worker imports both.
    """
    for tier, limits in TIER_LIMITS.items():
        assert 64 <= limits.sandbox_memory_mb <= MAX_MEMORY_MB, (
            f"{tier} asks for {limits.sandbox_memory_mb} MB, outside "
            f"[64, {MAX_MEMORY_MB}] — ExecutionSpec would refuse it at run time"
        )
