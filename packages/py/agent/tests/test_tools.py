from uuid import UUID, uuid4

from majorana_agent import (
    AgentBudget,
    AgentState,
    AgentPolicy,
    AgentRuntime,
    CircuitToolset,
    ExecutionOutput,
    ExecutionFailureKind,
    MemoryAgentStore,
    PublishedArtifact,
    SemanticReviewOutput,
    ToolBroker,
    ToolCall,
    ToolName,
    VerificationOutput,
    CandidateStatus,
)
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
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

    async def revise_plan(self, _run_id, previous, _plan_defect_feedback):
        payload = previous.model_dump(mode="json")
        payload["problem_summary"] = "Create and measure a corrected Bell state"
        return Plan.model_validate(payload)


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


class Reviewer:
    async def review(self, _candidate, _execution, _plan):
        return SemanticReviewOutput(
            decision=SemanticReviewDecision.READY,
            feedback={},
            reason_code="semantic_ready",
            retry_target=RetryTarget.NONE,
        )


class StrictVerifier:
    async def verify_strict(self, _candidate, _execution, _plan, _review):
        return VerificationOutput(
            decision=VerifierDecision.PASS,
            deterministic_checks=[{"method": "return_contract", "result": "pass"}],
            reason_code="strict_pass",
            retry_target=RetryTarget.NONE,
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
        reviewer=Reviewer(),
        strict_verifier=StrictVerifier(),
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
    review = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="3",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert review.payload["decision"] == "ready"
    verification = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="4",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert verification.payload["decision"] == "pass"
    assert "deterministic_checks" not in verification.payload
    conversion = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="5",
            name=ToolName.CONVERT_TO_OPENQASM,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert conversion.payload["status"] == "available"
    published = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="6",
            name=ToolName.MATERIALIZE_ARTIFACT,
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


class ReplanningPlanner(Planner):
    def __init__(self, *, change_shots: bool = False, fail: bool = False):
        self.revisions = 0
        self.change_shots = change_shots
        self.fail = fail

    async def create_plan(self, _run_id):
        if self.fail:
            raise RuntimeError("provider unavailable")
        return _plan()

    async def revise_plan(self, _run_id, previous, _plan_defect_feedback):
        self.revisions += 1
        if self.fail:
            raise RuntimeError("provider unavailable")
        payload = previous.model_dump(mode="json")
        payload["problem_summary"] = f"Corrected Bell plan revision {self.revisions + 1}"
        if self.change_shots:
            payload["parameters"]["shots"] += 1
        return Plan.model_validate(payload)


class PlanDefectVerifier:
    async def review(self, _candidate, _execution, _plan):
        return SemanticReviewOutput(
            decision=SemanticReviewDecision.REPLAN,
            feedback={"repair": {"category": "plan_defect"}},
            failure_class=VerificationFailureClass.PLAN_DEFECT,
            retry_target=RetryTarget.PLANNING,
            reason_code="semantic_plan_mismatch",
        )


class CodeDefectVerifier:
    async def review(self, _candidate, _execution, _plan):
        return SemanticReviewOutput(
            decision=SemanticReviewDecision.CODE_REPAIR,
            feedback={"repair": {"category": "candidate_defect"}},
            failure_class=VerificationFailureClass.CANDIDATE_DEFECT,
            retry_target=RetryTarget.CODE_GENERATION,
            reason_code="semantic_code_mismatch",
        )


def _replan_stack(store, planner, verifier, *, budget=AgentBudget()):
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=planner,
        executor=Executor(),
        reviewer=verifier,
        strict_verifier=StrictVerifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT, budget=budget),
        handlers=tools.handlers(),
    )
    return tools, broker


async def _reach_replan_required(store, broker, run_id):
    plan_result = await broker.dispatch(
        run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN)
    )
    simulation = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="candidate-1",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}"},
        ),
    )
    verification = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="verify-1",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": simulation.payload["candidate_id"]},
        ),
    )
    assert verification.state is AgentState.REPLAN_REQUIRED
    assert verification.payload["failure_class"] == "plan_defect"
    return plan_result, simulation


async def test_plan_defect_creates_revision_two_and_new_candidate_binds_to_it():
    store = MemoryAgentStore()
    planner = ReplanningPlanner()
    _tools, broker = _replan_stack(store, planner, PlanDefectVerifier())
    run_id = uuid4()
    first_plan, first_simulation = await _reach_replan_required(store, broker, run_id)

    replanned = await broker.dispatch(
        run_id, ToolCall(tool_call_id="replan-1", name=ToolName.REPLAN)
    )
    assert replanned.ok
    assert replanned.payload["revision"] == 2
    assert replanned.payload["parent_plan_id"] == first_plan.payload["plan_id"]

    second_simulation = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="candidate-2",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'11': 1}}"},
        ),
    )
    first_candidate = await store.candidate(run_id, UUID(first_simulation.payload["candidate_id"]))
    second_candidate = await store.candidate(
        run_id, UUID(second_simulation.payload["candidate_id"])
    )
    assert first_candidate.plan_id == UUID(first_plan.payload["plan_id"])
    assert second_candidate.plan_id == UUID(replanned.payload["plan_id"])
    assert (await store.plan(run_id, first_candidate.plan_id)).plan.problem_summary == (
        "Create and measure a Bell state"
    )
    assert (await store.plan(run_id, second_candidate.plan_id)).plan.problem_summary.startswith(
        "Corrected Bell plan"
    )


async def test_code_defect_cannot_trigger_replan():
    store = MemoryAgentStore()
    _tools, broker = _replan_stack(store, ReplanningPlanner(), CodeDefectVerifier())
    run_id = uuid4()
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    simulation = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="candidate",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}"},
        ),
    )
    verification = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="verify",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": simulation.payload["candidate_id"]},
        ),
    )
    assert verification.state is AgentState.REPAIR_REQUIRED
    rejected = await broker.dispatch(
        run_id, ToolCall(tool_call_id="illegal-replan", name=ToolName.REPLAN)
    )
    assert rejected.error_code == "invalid_transition"


async def test_replan_requires_durable_typed_plan_defect_feedback():
    store = MemoryAgentStore()
    _tools, broker = _replan_stack(store, ReplanningPlanner(), PlanDefectVerifier())
    run_id = uuid4()
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    await store.set_state(run_id, AgentState.REPLAN_REQUIRED)

    rejected = await broker.dispatch(
        run_id, ToolCall(tool_call_id="replan-without-evidence", name=ToolName.REPLAN)
    )

    assert rejected.error_code == "replan_not_authorized"


async def test_replan_cannot_change_framework_seed_or_shots():
    store = MemoryAgentStore()
    _tools, broker = _replan_stack(
        store, ReplanningPlanner(change_shots=True), PlanDefectVerifier()
    )
    run_id = uuid4()
    await _reach_replan_required(store, broker, run_id)

    rejected = await broker.dispatch(
        run_id, ToolCall(tool_call_id="replan-changed-shots", name=ToolName.REPLAN)
    )

    assert rejected.error_code == "shots_mismatch"
    assert (await store.current_plan_revision(run_id)).revision == 1


async def test_plan_failures_exhaust_plan_attempts_without_consuming_candidates():
    store = MemoryAgentStore()
    _tools, broker = _replan_stack(
        store,
        ReplanningPlanner(fail=True),
        PlanDefectVerifier(),
        budget=AgentBudget(max_plan_attempts=2),
    )
    run_id = uuid4()

    first = await broker.dispatch(
        run_id, ToolCall(tool_call_id="plan-fail-1", name=ToolName.REQUEST_PLAN)
    )
    second = await broker.dispatch(
        run_id, ToolCall(tool_call_id="plan-fail-2", name=ToolName.REQUEST_PLAN)
    )
    exhausted = await broker.dispatch(
        run_id, ToolCall(tool_call_id="plan-fail-3", name=ToolName.REQUEST_PLAN)
    )

    assert first.error_code == second.error_code == "plan_attempt_failed"
    assert exhausted.error_code == "plan_attempt_budget_exhausted"
    assert await store.list_candidates(run_id) == []


async def test_plan_revision_budget_exhaustion_is_explicit():
    store = MemoryAgentStore()
    _tools, broker = _replan_stack(
        store,
        ReplanningPlanner(),
        PlanDefectVerifier(),
        budget=AgentBudget(max_plan_revisions=1),
    )
    run_id = uuid4()
    await _reach_replan_required(store, broker, run_id)

    exhausted = await broker.dispatch(
        run_id, ToolCall(tool_call_id="replan-over-budget", name=ToolName.REPLAN)
    )

    assert exhausted.error_code == "plan_revision_budget_exhausted"

    class ReplanModel:
        async def next_tool(self, **_kwargs):
            return ToolCall(tool_call_id="runtime-replan", name=ToolName.REPLAN)

    runtime = AgentRuntime(store=store, broker=broker, model=ReplanModel())
    assert await runtime.run(run_id) is AgentState.FAILED
    assert runtime.failure_reason == "plan_revision_budget_exhausted"


class CrashAfterPlanSelectionStore(MemoryAgentStore):
    def __init__(self):
        super().__init__()
        self.crash_once = True

    async def select_current_plan(self, run_id, plan_id):
        await super().select_current_plan(run_id, plan_id)
        revision = await self.plan_revision(run_id, plan_id)
        if revision.revision > 1 and self.crash_once:
            self.crash_once = False
            raise RuntimeError("worker crashed after Plan selection")


async def test_replan_crash_replay_does_not_duplicate_plan_revision():
    import pytest

    store = CrashAfterPlanSelectionStore()
    planner = ReplanningPlanner()
    _tools, broker = _replan_stack(store, planner, PlanDefectVerifier())
    run_id = uuid4()
    await _reach_replan_required(store, broker, run_id)
    call = ToolCall(tool_call_id="replan-crash", name=ToolName.REPLAN)

    with pytest.raises(RuntimeError, match="Plan selection"):
        await broker.dispatch(run_id, call)
    resumed = await broker.dispatch(run_id, call)

    assert resumed.ok
    assert resumed.payload["revision"] == 2
    assert planner.revisions == 1
    current = await store.current_plan_revision(run_id)
    assert current is not None and current.revision == 2
