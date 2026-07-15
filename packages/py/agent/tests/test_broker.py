from uuid import UUID, uuid4

from majorana_agent import (
    AgentPolicy,
    AgentState,
    CandidateRevision,
    ExecutionEvidence,
    MemoryAgentStore,
    ToolBroker,
    ToolCall,
    ToolName,
    VerificationEvidence,
)
from majorana_contracts.enums import Framework, VerifierDecision
from majorana_frameworks import FrameworkProgram


async def _ok(_run_id: UUID, call: ToolCall):
    return call.arguments | {"decision": call.arguments.get("decision", "pass")}


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


async def test_publish_requires_matching_verified_latest_candidate():
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
            name=ToolName.PUBLISH_ARTIFACT,
            arguments={"candidate_id": str(candidate_id)},
        ),
    )
    assert unverified.error_code == "candidate_unverified"

    await store.add_verification(
        VerificationEvidence(
            verification_id=uuid4(),
            candidate_id=candidate_id,
            execution_id=execution.execution_id,
            source_fingerprint=fingerprint,
            decision=VerifierDecision.PASS,
        )
    )
    published = await _broker(store).dispatch(
        run_id,
        ToolCall(
            tool_call_id="publish",
            name=ToolName.PUBLISH_ARTIFACT,
            arguments={"candidate_id": str(candidate_id)},
        ),
    )
    assert published.ok
    assert published.state is AgentState.PUBLISHED


async def test_memory_evidence_is_append_only():
    store = MemoryAgentStore()
    run_id, candidate_id = uuid4(), uuid4()
    source = "FINAL_CIRCUIT = object()\n"
    fingerprint = FrameworkProgram(Framework.QISKIT, source).fingerprint
    await store.add_candidate(
        CandidateRevision(
            candidate_id=candidate_id,
            run_id=run_id,
            tool_call_id="simulate",
            revision=1,
            plan_id=uuid4(),
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
