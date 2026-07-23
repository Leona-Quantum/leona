from uuid import UUID, uuid4

from majorana_agent import (
    AgentPolicy,
    AgentState,
    CandidateRevision,
    ExecutionEvidence,
    MemoryAgentStore,
    PlanRecord,
    SemanticReviewEvidence,
    StrictVerificationAttempt,
    ToolBroker,
    ToolCall,
    ToolName,
)
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerifierDecision,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram


async def _ok(_run_id: UUID, call: ToolCall):
    return call.arguments | {"decision": call.arguments.get("decision", "pass")}


def _plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build a Bell state",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
        }
    )


def _broker(store, framework=Framework.QISKIT):
    return ToolBroker(
        store=store,
        policy=AgentPolicy(framework=framework),
        handlers={name: _ok for name in ToolName},
    )


async def test_broker_enforces_state_and_selected_framework():
    store = MemoryAgentStore()
    run_id = uuid4()
    broker = _broker(store)

    invalid = await broker.dispatch(
        run_id, ToolCall(tool_call_id="early", name=ToolName.SIMULATE_QISKIT)
    )
    assert not invalid.ok
    assert invalid.error_code == "invalid_transition"

    planned = await broker.dispatch(
        run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN)
    )
    assert planned.state is AgentState.PLANNED
    wrong = await broker.dispatch(
        run_id, ToolCall(tool_call_id="cirq", name=ToolName.SIMULATE_CIRQ)
    )
    assert not wrong.ok
    assert wrong.error_code == "framework_mismatch"


async def test_tool_call_id_is_idempotent():
    store = MemoryAgentStore()
    run_id = uuid4()
    broker = _broker(store)
    call = ToolCall(tool_call_id="same", name=ToolName.REQUEST_PLAN)
    assert await broker.dispatch(run_id, call) == await broker.dispatch(run_id, call)
    assert len(await store.list_tool_results(run_id)) == 1


async def test_tool_call_id_cannot_be_reused_with_new_arguments():
    store = MemoryAgentStore()
    run_id = uuid4()
    broker = _broker(store)
    await broker.dispatch(run_id, ToolCall(tool_call_id="same", name=ToolName.REQUEST_PLAN))
    from majorana_agent import ToolPolicyError

    try:
        await broker.dispatch(
            run_id,
            ToolCall(
                tool_call_id="same",
                name=ToolName.REQUEST_PLAN,
                arguments={"unexpected": True},
            ),
        )
    except ToolPolicyError as exc:
        assert exc.code == "idempotency_conflict"
    else:
        raise AssertionError("idempotency conflict was not rejected")


async def test_materialize_requires_terminal_strict_latest_candidate():
    store = MemoryAgentStore()
    run_id, plan_id, candidate_id = uuid4(), uuid4(), uuid4()
    source = "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(1)\n"
    fingerprint = FrameworkProgram(Framework.QISKIT, source).fingerprint
    candidate = CandidateRevision(
        candidate_id=candidate_id,
        run_id=run_id,
        tool_call_id="simulate-1",
        revision=1,
        plan_id=plan_id,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=fingerprint,
    )
    await store.add_plan(PlanRecord(plan_id=plan_id, run_id=run_id, plan=_plan()))
    await store.add_candidate(candidate)
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate_id,
        source_fingerprint=fingerprint,
        environment_fingerprint="0" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
    )
    await store.add_execution(execution)
    await store.set_state(run_id, AgentState.VERIFIED)

    unverified = await _broker(store).dispatch(
        run_id,
        ToolCall(
            tool_call_id="publish-early",
            name=ToolName.MATERIALIZE_ARTIFACT,
            arguments={"candidate_id": str(candidate_id)},
        ),
    )
    assert unverified.error_code == "candidate_not_materializable"

    review = SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=fingerprint,
        attempt_seq=1,
        decision=SemanticReviewDecision.READY,
        reason_code="semantic_ready",
        retry_target=RetryTarget.NONE,
    )
    await store.append_semantic_review(review)
    await store.append_strict_verification(
        StrictVerificationAttempt(
            attempt_id=uuid4(),
            candidate_id=candidate_id,
            execution_id=execution.execution_id,
            semantic_review_id=review.review_id,
            source_fingerprint=fingerprint,
            attempt_seq=1,
            decision=VerifierDecision.PASS,
            reason_code="strict_pass",
            candidate_defect_observed=False,
            retry_target=RetryTarget.NONE,
            verifier_version="test",
        )
    )
    published = await _broker(store).dispatch(
        run_id,
        ToolCall(
            tool_call_id="publish",
            name=ToolName.MATERIALIZE_ARTIFACT,
            arguments={"candidate_id": str(candidate_id)},
        ),
    )
    assert published.ok
    assert published.state is AgentState.MATERIALIZED


async def test_memory_evidence_is_append_only():
    store = MemoryAgentStore()
    run_id, plan_id, candidate_id = uuid4(), uuid4(), uuid4()
    source = "FINAL_CIRCUIT = object()\n"
    fingerprint = FrameworkProgram(Framework.QISKIT, source).fingerprint
    await store.add_plan(PlanRecord(plan_id=plan_id, run_id=run_id, plan=_plan()))
    await store.add_candidate(
        CandidateRevision(
            candidate_id=candidate_id,
            run_id=run_id,
            tool_call_id="simulate",
            revision=1,
            plan_id=plan_id,
            framework=Framework.QISKIT,
            source=source,
            source_fingerprint=fingerprint,
        )
    )
    evidence = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate_id,
        source_fingerprint=fingerprint,
        environment_fingerprint="0" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
    )
    await store.add_execution(evidence)
    await store.add_execution(evidence)
    import pytest

    with pytest.raises(ValueError, match="immutable"):
        await store.add_execution(evidence.model_copy(update={"duration_ms": 2}))
