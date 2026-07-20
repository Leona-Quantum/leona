from uuid import uuid4

import pytest
from majorana_agent import (
    AgentPolicy,
    AgentRuntime,
    AgentState,
    CircuitToolset,
    ExecutionFailureKind,
    ExecutionOutput,
    MemoryAgentStore,
    PublishedArtifact,
    ToolBroker,
    ToolCall,
    ToolName,
    VerificationOutput,
)
from majorana_contracts.enums import Algorithm, Framework, VerifierDecision
from majorana_contracts.plan import Plan


def _plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build a Bell circuit",
            "algorithm_rationale": "The requested state is entangled",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
        }
    )


class Planner:
    async def create_plan(self, _run_id):
        return _plan()


class RepairingExecutor:
    async def run_candidate(self, candidate, _plan):
        broken = "BROKEN" in candidate.source
        return ExecutionOutput(
            environment_fingerprint="1" * 64,
            sandbox_provider="test",
            exit_code=1 if broken else 0,
            failure_kind=ExecutionFailureKind.CODE_ERROR if broken else None,
            duration_ms=1,
            result={} if broken else {"counts": {"00": 5, "11": 5}},
            observation={
                "evidence_error": "NameError" if broken else None,
                "interchange_qasm": "OPENQASM 3.0;\nqubit[2] q;",
                "sandbox_runs": 1,
            },
        )


class Verifier:
    async def verify(self, _candidate, _execution, _plan):
        return VerificationOutput(
            decision=VerifierDecision.PASS,
            deterministic_checks=[{"method": "return_contract", "result": "pass"}],
        )


class Converter:
    async def convert(self, _candidate, execution):
        return execution.observation["interchange_qasm"], None


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


class RepairModel:
    async def next_tool(self, *, state, history, **_kwargs):
        number = len(history) + 1
        if state is AgentState.NEW:
            return ToolCall(tool_call_id=str(number), name=ToolName.REQUEST_PLAN)
        if state is AgentState.PLANNED:
            return ToolCall(
                tool_call_id=str(number),
                name=ToolName.SIMULATE_QISKIT,
                arguments={"source": "BROKEN = unknown\nFINAL_CIRCUIT = object()\n"},
            )
        if state is AgentState.REPAIR_REQUIRED:
            return ToolCall(
                tool_call_id=str(number),
                name=ToolName.SIMULATE_QISKIT,
                arguments={
                    "source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 5, '11': 5}}\n"
                },
            )
        candidate_id = history[-1].payload.get("candidate_id")
        if candidate_id is None:
            candidate_id = next(
                item.payload["candidate_id"]
                for item in reversed(history)
                if "candidate_id" in item.payload
            )
        arguments = {"candidate_id": candidate_id}
        if state is AgentState.EXECUTED:
            return ToolCall(
                tool_call_id=str(number),
                name=ToolName.VERIFY_INTENT_ALIGNMENT,
                arguments=arguments,
            )
        if state is AgentState.VERIFIED:
            return ToolCall(
                tool_call_id=str(number),
                name=ToolName.CONVERT_TO_OPENQASM,
                arguments=arguments,
            )
        return ToolCall(
            tool_call_id=str(number), name=ToolName.PUBLISH_ARTIFACT, arguments=arguments
        )


async def test_runtime_repairs_with_new_candidate_revision_then_publishes():
    store = MemoryAgentStore()
    run_id = uuid4()
    toolset = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=RepairingExecutor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    runtime = AgentRuntime(
        store=store,
        broker=ToolBroker(
            store=store,
            policy=AgentPolicy(framework=Framework.QISKIT),
            handlers=toolset.handlers(),
        ),
        model=RepairModel(),
    )

    assert await runtime.run(run_id) is AgentState.PUBLISHED
    candidates = await store.list_candidates(run_id)
    assert [candidate.revision for candidate in candidates] == [1, 2]
    assert candidates[1].parent_candidate_id == candidates[0].candidate_id
    assert store.publications[0].candidate_id == candidates[1].candidate_id


class OneCallModel:
    async def next_tool(self, **_kwargs):
        return ToolCall(tool_call_id="stable-id", name=ToolName.REQUEST_PLAN)


async def test_started_tool_call_resumes_after_infrastructure_failure():
    store = MemoryAgentStore()
    run_id = uuid4()
    attempts = 0

    async def flaky(_run_id, _call):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("worker lost after durable begin")
        return {"plan_id": str(uuid4())}

    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT),
        handlers={ToolName.REQUEST_PLAN: flaky},
    )
    runtime = AgentRuntime(store=store, broker=broker, model=OneCallModel())
    with pytest.raises(RuntimeError, match="worker lost"):
        await runtime.run(run_id)

    # Same durable tool_call_id is retried once; after completion the scripted
    # one-call model cannot continue, so inspect the recovered boundary directly.
    # The runtime dispatched under the step-suffixed id, so resume with that.
    recovered = await broker.dispatch(
        run_id, ToolCall(tool_call_id="stable-id-s0", name=ToolName.REQUEST_PLAN)
    )
    assert recovered.ok
    assert recovered.state is AgentState.PLANNED
    assert attempts == 2


async def test_model_stuck_on_one_call_exhausts_the_step_budget_not_the_replay_guard():
    """Before step-suffixed ids this died instantly as `replayed tool call`.
    Now the repeated proposal is dispatched each time as a distinct step, the
    broker rejects the ones the state disallows, and the run ends on the step
    budget — bounded feedback, not an infrastructure verdict."""
    store = MemoryAgentStore()
    run_id = uuid4()

    async def plan(_run_id, _call):
        return {"plan_id": str(uuid4())}

    runtime = AgentRuntime(
        store=store,
        broker=ToolBroker(
            store=store,
            policy=AgentPolicy(framework=Framework.QISKIT),
            handlers={ToolName.REQUEST_PLAN: plan},
        ),
        model=OneCallModel(),
    )
    assert await runtime.run(run_id) is AgentState.FAILED
    assert runtime.failure_reason == "step_budget_exhausted"


class ConstantIdModel(RepairModel):
    """The RepairModel's full happy path, but every proposal reuses one id."""

    async def next_tool(self, *, state, history, **kwargs):
        call = await super().next_tool(state=state, history=history, **kwargs)
        return call.model_copy(update={"tool_call_id": "dup"})


async def test_model_reusing_tool_call_ids_cannot_kill_a_run():
    """Live run 019f7f7c-5ac2: publish_artifact was rejected once for bad
    arguments, the model retried it under the same id, and the replay guard
    failed a run whose candidate had passed every check. The id is the loop's
    bookkeeping, not the model's — reuse must never end a run."""
    store = MemoryAgentStore()
    run_id = uuid4()
    toolset = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=RepairingExecutor(),
        verifier=Verifier(),
        converter=Converter(),
        publisher=Publisher(),
    )
    runtime = AgentRuntime(
        store=store,
        broker=ToolBroker(
            store=store,
            policy=AgentPolicy(framework=Framework.QISKIT),
            handlers=toolset.handlers(),
        ),
        model=ConstantIdModel(),
    )
    assert await runtime.run(run_id) is AgentState.PUBLISHED


async def test_runtime_rejects_completed_call_id_from_an_older_state():
    store = MemoryAgentStore()
    run_id = uuid4()
    call = ToolCall(tool_call_id="old-plan", name=ToolName.REQUEST_PLAN)
    await store.begin_tool_call(run_id, call)
    from majorana_agent import ToolResult

    await store.finish_tool_call(
        run_id,
        ToolResult(
            tool_call_id=call.tool_call_id,
            name=call.name,
            ok=True,
            state=AgentState.PLANNED,
        ),
    )
    await store.set_state(run_id, AgentState.EXECUTED)

    class ReplaysOldCall:
        async def next_tool(self, **_kwargs):
            return call

    runtime = AgentRuntime(
        store=store,
        broker=ToolBroker(
            store=store,
            policy=AgentPolicy(framework=Framework.QISKIT),
            handlers={ToolName.REQUEST_PLAN: lambda *_args: None},
        ),
        model=ReplaysOldCall(),
    )
    assert await runtime.run(run_id) is AgentState.FAILED
