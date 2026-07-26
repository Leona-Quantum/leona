import hashlib
import json

import pytest
from datetime import UTC, datetime
from uuid import uuid4

from majorana_agent import (
    AgentState,
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    MaterializedArtifact,
    MemoryAgentStore,
    PlanRevision,
    SemanticReviewEvidence,
    ToolName,
    ToolResult,
)
from majorana_contracts.enums import (
    Algorithm,
    ExportStatus,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
)
from majorana_contracts.events import run_event_adapter
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_worker.simple_events import SimpleEventObserver


class ValidatingSink:
    def __init__(self, run_id):
        self.run_id = run_id
        self.events = {}

    async def emit(self, event_type, payload, *, event_id):
        event = run_event_adapter.validate_python(
            {
                "run_id": self.run_id,
                "seq": len(self.events),
                "ts": datetime.now(UTC),
                "type": event_type,
                **payload,
            }
        )
        self.events.setdefault(event_id, event)


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


async def _store_with_candidate():
    store = MemoryAgentStore()
    run_id = uuid4()
    plan_id = uuid4()
    source = "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}\n"
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="simple:generate:1",
        revision=1,
        plan_id=plan_id,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="e" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=7,
        result={"counts": {"00": 1}},
        observation={
            "sandbox_stdout": "done\n",
            "sandbox_stderr": "",
            "sandbox_runs": 1,
        },
    )
    review = SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        decision=SemanticReviewDecision.READY,
        reason_code="intent_aligned",
        retry_target=RetryTarget.NONE,
        feedback={
            "critic": {"summary": "Aligned."},
            "basic_checks": [
                {"method": "structural", "result": "pass"},
                {"method": "return_contract", "result": "pass"},
                {"method": "success_criteria", "result": "pass"},
            ],
        },
    )
    plan = _plan()
    canonical = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    await store.append_plan_revision(
        PlanRevision(
            plan_id=plan_id,
            run_id=run_id,
            revision=1,
            plan=plan,
            plan_fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        )
    )
    await store.select_current_plan(run_id, plan_id)
    await store.add_candidate(candidate)
    await store.add_execution(execution)
    await store.append_semantic_review(review)
    return store, run_id, candidate, execution, review


async def test_simple_observer_emits_plan_execution_and_review_once():
    store, run_id, candidate, _execution, review = await _store_with_candidate()
    sink = ValidatingSink(run_id)
    observer = SimpleEventObserver(store=store, sink=sink)
    results = [
        ToolResult(
            tool_call_id="simple:plan:1",
            name=ToolName.REQUEST_PLAN,
            ok=True,
            state=AgentState.PLANNED,
            payload={"plan_id": str(candidate.plan_id), "plan": _plan().model_dump(mode="json")},
        ),
        ToolResult(
            tool_call_id=candidate.tool_call_id,
            name=ToolName.SIMULATE_QISKIT,
            ok=True,
            state=AgentState.EXECUTED,
            payload={"candidate_id": str(candidate.candidate_id)},
        ),
        ToolResult(
            tool_call_id="simple:review:1",
            name=ToolName.REVIEW_CANDIDATE,
            ok=True,
            state=AgentState.REVIEWED,
            payload={
                "candidate_id": str(candidate.candidate_id),
                "review_id": str(review.review_id),
            },
        ),
    ]

    for result in results:
        await observer.tool_finished(run_id, result)
        await observer.tool_finished(run_id, result)

    assert [event.type for event in sink.events.values()] == [
        "plan.produced",
        "code.generated",
        "sandbox.result",
        "verification.semantic_review",
    ]
    sandbox_event = next(event for event in sink.events.values() if event.type == "sandbox.result")
    assert sandbox_event.result == {"counts": {"00": 1}}


async def test_candidate_event_is_available_before_execution_and_replay_safe():
    store, run_id, candidate, _execution, _review = await _store_with_candidate()
    sink = ValidatingSink(run_id)
    observer = SimpleEventObserver(store=store, sink=sink)

    await observer.candidate_generated(run_id, candidate)
    await observer.recover(run_id)

    assert [event.type for event in sink.events.values()] == ["code.generated"]


async def test_simple_observer_finalizes_without_strict_verification_lookup():
    store, run_id, candidate, execution, _review = await _store_with_candidate()
    conversion = ConversionEvidence(
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        status="unavailable",
        reason="framework export unavailable",
    )
    artifact = MaterializedArtifact(
        artifact_id=uuid4(),
        version_id=uuid4(),
        version_seq=1,
        candidate_id=candidate.candidate_id,
        framework=candidate.framework,
        source_fingerprint=candidate.source_fingerprint,
    )
    await store.add_conversion(conversion)
    await store.add_materialization(artifact)
    sink = ValidatingSink(run_id)
    observer = SimpleEventObserver(store=store, sink=sink)

    await observer.tool_finished(
        run_id,
        ToolResult(
            tool_call_id="simple:save:1",
            name=ToolName.MATERIALIZE_ARTIFACT,
            ok=True,
            state=AgentState.MATERIALIZED,
            payload={
                "candidate_id": str(candidate.candidate_id),
                "artifact_id": str(artifact.artifact_id),
                "version_id": str(artifact.version_id),
                "version_seq": artifact.version_seq,
            },
        ),
    )

    finalized, saved = sink.events.values()
    assert finalized.type == "code.finalized"
    assert finalized.finalization_reason.startswith("Executed candidate aligned")
    assert finalized.export_status is ExportStatus.UNSUPPORTED
    assert saved.type == "artifact.saved"


async def test_simple_observer_ignores_non_simple_tool_records():
    store, run_id, candidate, _execution, _review = await _store_with_candidate()
    sink = ValidatingSink(run_id)
    observer = SimpleEventObserver(store=store, sink=sink)

    await observer.tool_finished(
        run_id,
        ToolResult(
            tool_call_id="legacy-simulate",
            name=ToolName.SIMULATE_QISKIT,
            ok=True,
            state=AgentState.EXECUTED,
            payload={"candidate_id": str(candidate.candidate_id)},
        ),
    )

    assert sink.events == {}


def _plan_revision(run_id) -> PlanRevision:
    plan = _plan()
    canonical = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return PlanRevision(
        plan_id=uuid4(),
        run_id=run_id,
        revision=1,
        plan=plan,
        plan_fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
    )


async def _seed_reviewed_candidate(store, *, decision, severity="minor"):
    """A stored candidate that executed and was reviewed, with the given verdict."""

    run_id = uuid4()
    plan_revision = _plan_revision(run_id)
    await store.append_plan_revision(plan_revision)
    await store.select_current_plan(run_id, plan_revision.plan_id)
    source = "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}\n"
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="simple:generate:1",
        revision=1,
        plan_id=plan_revision.plan_id,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="e" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result={"counts": {"00": 1}},
        observation={},
    )
    await store.add_candidate(candidate)
    await store.add_execution(execution)
    await store.append_semantic_review(
        SemanticReviewEvidence(
            review_id=uuid4(),
            candidate_id=candidate.candidate_id,
            execution_id=execution.execution_id,
            source_fingerprint=candidate.source_fingerprint,
            attempt_seq=1,
            decision=decision,
            severity=severity,
            reason_code="intent_code_mismatch",
            failure_class=VerificationFailureClass.CANDIDATE_DEFECT,
            retry_target=RetryTarget.CODE_GENERATION,
            feedback={"basic_checks": [{"method": "success_criteria", "result": "pass"}]},
        )
    )
    return run_id, candidate, execution


async def test_memory_store_writes_a_conversion_for_a_review_the_model_disliked():
    """Both durable stores gate conversion and materialization on the review. They
    demanded READY, so the orchestrator's best-effort delivery raised inside the store
    and the run died at export with the artifact discarded — after the pipeline had
    already decided to deliver it. The guard now enforces deliverability, not a policy
    the orchestrator has since changed."""

    from majorana_agent import ConversionEvidence

    store = MemoryAgentStore()
    run_id, candidate, execution = await _seed_reviewed_candidate(
        store, decision=SemanticReviewDecision.CODE_REPAIR
    )

    await store.add_conversion(
        ConversionEvidence(
            candidate_id=candidate.candidate_id,
            execution_id=execution.execution_id,
            source_fingerprint=candidate.source_fingerprint,
            status="unavailable",
            reason="framework export unsupported",
        )
    )

    assert await store.conversion_for(run_id, candidate.candidate_id) is not None


async def test_memory_store_still_refuses_a_blocking_review():
    from majorana_agent import ConversionEvidence

    store = MemoryAgentStore()
    run_id, candidate, execution = await _seed_reviewed_candidate(
        store, decision=SemanticReviewDecision.CODE_REPAIR, severity="blocking"
    )

    with pytest.raises(ValueError, match="deliverable"):
        await store.add_conversion(
            ConversionEvidence(
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                status="unavailable",
                reason="framework export unsupported",
            )
        )
