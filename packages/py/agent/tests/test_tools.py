from uuid import UUID, uuid4

from majorana_agent import (
    AgentState,
    AgentPolicy,
    CircuitToolset,
    ExecutionOutput,
    ExecutionFailureKind,
    MemoryAgentStore,
    PublishedArtifact,
    ToolBroker,
    ToolCall,
    ToolName,
    VerificationOutput,
    CandidateStatus,
)
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    VerifierDecision,
    VerificationMethod,
)
from majorana_contracts.plan import Plan


def _plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Create and measure a Bell state",
            "algorithm_rationale": "Entanglement demonstrates the requested circuit",
            "parameters": {"shots": 1000},
            "qubits_estimate": 2,
            "expected_runtime_sec": 2,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
            "verification_plan": {"methods": [VerificationMethod.RETURN_CONTRACT]},
        }
    )


class Planner:
    async def create_plan(self, _run_id):
        return _plan()


class Executor:
    async def run_candidate(self, _candidate, _plan):
        return ExecutionOutput(
            environment_fingerprint="1" * 64,
            sandbox_provider="test",
            exit_code=0,
            duration_ms=2,
            result={"counts": {"00": 500, "11": 500}},
            observation={"interchange_qasm": "OPENQASM 3.0;\nqubit[2] q;"},
        )


class Verifier:
    async def verify(self, _candidate, _execution, _plan):
        return VerificationOutput(
            decision=VerifierDecision.PASS,
            deterministic_checks=[{"method": "return_contract", "result": "pass"}],
        )


class Converter:
    async def convert(self, _candidate, execution):
        return execution.observation.get("interchange_qasm"), None


class Publisher:
    async def publish(self, candidate, _execution, _verification, _conversion, _plan):
        return PublishedArtifact(
            artifact_id=uuid4(),
            version_id=uuid4(),
            version_seq=1,
            candidate_id=candidate.candidate_id,
            framework=candidate.framework,
            source_fingerprint=candidate.source_fingerprint,
        )


async def test_tools_bind_execution_verification_conversion_and_publish():
    store = MemoryAgentStore()
    run_id = uuid4()
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=Executor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT),
        handlers=tools.handlers(),
    )
    plan = await broker.dispatch(run_id, ToolCall(tool_call_id="1", name=ToolName.REQUEST_PLAN))
    assert plan.ok
    source = "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(2)\n"
    simulation = await broker.dispatch(
        run_id,
        ToolCall(tool_call_id="2", name=ToolName.SIMULATE_QISKIT, arguments={"source": source}),
    )
    candidate_id = simulation.payload["candidate_id"]
    assert simulation.payload["result_keys"] == ["counts"]
    assert "result" not in simulation.payload
    verification = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="3",
            name=ToolName.VERIFY_INTENT_ALIGNMENT,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert verification.payload["decision"] == "pass"
    assert "deterministic_checks" not in verification.payload
    conversion = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="4",
            name=ToolName.CONVERT_TO_OPENQASM,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert conversion.payload["status"] == "available"
    published = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="5",
            name=ToolName.PUBLISH_ARTIFACT,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert published.ok
    assert UUID(published.payload["candidate_id"]) == UUID(candidate_id)


class CrashAfterCandidateStore(MemoryAgentStore):
    def __init__(self):
        super().__init__()
        self.crash_once = True

    async def add_candidate(self, candidate):
        await super().add_candidate(candidate)
        if self.crash_once:
            self.crash_once = False
            raise RuntimeError("worker crashed after candidate commit")


async def test_simulate_resumes_same_candidate_after_partial_commit():
    store = CrashAfterCandidateStore()
    run_id = uuid4()
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=Executor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT),
        handlers=tools.handlers(),
    )
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    call = ToolCall(
        tool_call_id="simulate",
        name=ToolName.SIMULATE_QISKIT,
        arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'0': 1}}"},
    )
    import pytest

    with pytest.raises(RuntimeError, match="candidate commit"):
        await broker.dispatch(run_id, call)
    resumed = await broker.dispatch(run_id, call)
    assert resumed.ok
    assert len(await store.list_candidates(run_id)) == 1


class CrashAfterExecutionStore(MemoryAgentStore):
    def __init__(self):
        super().__init__()
        self.crash_once = True

    async def add_execution(self, evidence):
        await super().add_execution(evidence)
        if self.crash_once:
            self.crash_once = False
            raise RuntimeError("worker crashed after evidence commit")


async def test_simulate_retry_reconciles_status_after_evidence_commit():
    store = CrashAfterExecutionStore()
    run_id = uuid4()
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=Executor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT),
        handlers=tools.handlers(),
    )
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    call = ToolCall(
        tool_call_id="simulate",
        name=ToolName.SIMULATE_QISKIT,
        arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'0': 1}}"},
    )
    import pytest

    with pytest.raises(RuntimeError, match="evidence commit"):
        await broker.dispatch(run_id, call)
    assert (await store.latest_candidate(run_id)).status is CandidateStatus.CREATED
    assert (await broker.dispatch(run_id, call)).ok
    assert (await store.latest_candidate(run_id)).status is CandidateStatus.EXECUTED


class ResourceExhaustedExecutor:
    async def run_candidate(self, _candidate, _plan):
        return ExecutionOutput(
            environment_fingerprint="1" * 64,
            sandbox_provider="test",
            exit_code=75,
            duration_ms=0,
            result={},
            observation={"estimated_memory_mb": 4096, "memory_limit_mb": 2048},
            failure_kind=ExecutionFailureKind.RESOURCE_LIMIT,
        )


async def test_resource_exhaustion_is_terminal_without_candidate_repair():
    store = MemoryAgentStore()
    run_id = uuid4()
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=ResourceExhaustedExecutor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT),
        handlers=tools.handlers(),
    )
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    result = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="simulate",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {}"},
        ),
    )

    assert result.state is AgentState.RESOURCE_EXHAUSTED
    assert result.payload["resource_exhausted"] is True
    assert "repair" not in result.payload
    assert (await store.latest_candidate(run_id)).status is CandidateStatus.RESOURCE_EXHAUSTED


class ContractRejectedExecutor:
    """A candidate rejected by contract_diagnostics never reaches the sandbox, so it
    has no stderr and no sandbox_error — the diagnostics are its only evidence."""

    async def run_candidate(self, _candidate, _plan):
        return ExecutionOutput(
            environment_fingerprint="1" * 64,
            sandbox_provider="test",
            exit_code=2,
            duration_ms=0,
            result={},
            observation={
                "contract_diagnostics": [
                    "contract:qiskit `c_if` was removed in Qiskit 2.0 and raises "
                    "AttributeError at runtime. Use `with circuit.if_test((creg, value)):` instead."
                ]
            },
            failure_kind=ExecutionFailureKind.CODE_ERROR,
        )


async def test_a_pre_sandbox_contract_rejection_tells_the_model_what_was_wrong():
    """The diagnostics path bypasses the sandbox, so `evidence_error` and
    `sandbox_error` are both absent and the repair used to read, in full, "sandbox exit
    was non-zero" — strictly LESS than the traceback the code would have produced by
    being allowed to run. Teleportation regressed exactly that way on production run
    019f7dd4-c3c6: the Qiskit 2.0 `c_if` diagnostic fired correctly on all four
    candidates and told the model nothing, so it rewrote the same broken call."""
    store = MemoryAgentStore()
    run_id = uuid4()
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=ContractRejectedExecutor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT),
        handlers=tools.handlers(),
    )
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    result = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="simulate",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "qc.x(2).c_if(qc.clbits[0], 1)\nFINAL_CIRCUIT = qc\nRESULT = {}"},
        ),
    )

    evidence = result.payload["repair"]["evidence"]
    assert any("c_if" in item and "if_test" in item for item in evidence), evidence
