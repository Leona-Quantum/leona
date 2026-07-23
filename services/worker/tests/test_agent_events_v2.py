from datetime import UTC, datetime
from uuid import uuid4

import pytest
from majorana_agent import (
    AgentState,
    CandidateRevision,
    ExecutionEvidence,
    MemoryAgentStore,
    PlanRecord,
    SemanticReviewEvidence,
    StrictVerificationAttempt,
    ToolName,
    ToolResult,
)
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_contracts.events import run_event_adapter
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_worker.agent_events import AgentEventObserver


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


def _plan():
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


async def _evidence_stack(
    checks,
    *,
    review_decision=SemanticReviewDecision.INCONCLUSIVE,
    strict_decision=VerifierDecision.INCONCLUSIVE,
):
    store = MemoryAgentStore()
    run_id = uuid4()
    plan_id = uuid4()
    source = "FINAL_CIRCUIT = object()\nRESULT = {'counts': {}}\n"
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="candidate",
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
        duration_ms=1,
    )
    review_routing = {
        SemanticReviewDecision.READY: (None, RetryTarget.NONE),
        SemanticReviewDecision.CODE_REPAIR: (
            VerificationFailureClass.CANDIDATE_DEFECT,
            RetryTarget.CODE_GENERATION,
        ),
        SemanticReviewDecision.REPLAN: (
            VerificationFailureClass.PLAN_DEFECT,
            RetryTarget.PLANNING,
        ),
        SemanticReviewDecision.INCONCLUSIVE: (
            VerificationFailureClass.EVIDENCE_GAP,
            RetryTarget.VERIFICATION,
        ),
    }
    review_failure, review_retry = review_routing[review_decision]
    review = SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        decision=review_decision,
        reason_code=f"semantic_{review_decision.value}",
        failure_class=review_failure,
        retry_target=review_retry,
        feedback={"critic": {"summary": "Intent evidence is incomplete."}},
    )
    strict_routing = {
        VerifierDecision.PASS: (None, RetryTarget.NONE, False),
        VerifierDecision.FAIL: (
            VerificationFailureClass.CANDIDATE_DEFECT,
            RetryTarget.CODE_GENERATION,
            True,
        ),
        VerifierDecision.INCONCLUSIVE: (
            VerificationFailureClass.VERIFIER_FAILURE,
            RetryTarget.VERIFICATION,
            False,
        ),
    }
    strict_failure, strict_retry, defect_observed = strict_routing[strict_decision]
    strict = StrictVerificationAttempt(
        attempt_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        semantic_review_id=review.review_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        checks=checks,
        decision=strict_decision,
        reason_code=f"strict_{strict_decision.value}",
        candidate_defect_observed=defect_observed,
        failure_class=strict_failure,
        retry_target=strict_retry,
        unverified_claims=["Bell phase"],
        verifier_version="verification-v2",
    )
    await store.add_plan(PlanRecord(plan_id=plan_id, run_id=run_id, plan=_plan()))
    await store.add_candidate(candidate)
    await store.add_execution(execution)
    await store.append_semantic_review(review)
    await store.append_strict_verification(strict)
    return store, run_id, candidate, review, strict


async def test_replay_emits_typed_review_strict_attempt_and_every_check_once():
    checks = [
        {"method": "structural", "result": result, "details": {"case": result}}
        for result in ("pass", "fail", "skipped", "unavailable", "error")
    ]
    store, run_id, candidate, review, strict = await _evidence_stack(checks)
    sink = ValidatingSink(run_id)
    observer = AgentEventObserver(store=store, sink=sink)
    review_result = ToolResult(
        tool_call_id="review",
        name=ToolName.REVIEW_CANDIDATE,
        ok=True,
        state=AgentState.REVIEWED,
        payload={"candidate_id": str(candidate.candidate_id), "review_id": str(review.review_id)},
    )
    strict_result = ToolResult(
        tool_call_id="strict",
        name=ToolName.STRICT_VERIFY,
        ok=True,
        state=AgentState.REVIEWED,
        payload={
            "candidate_id": str(candidate.candidate_id),
            "attempt_id": str(strict.attempt_id),
        },
    )

    await observer.tool_finished(run_id, review_result)
    await observer.tool_finished(run_id, strict_result)
    await observer.tool_finished(run_id, review_result)
    await observer.tool_finished(run_id, strict_result)

    events = list(sink.events.values())
    assert len(events) == 7
    assert sum(event.type == "verification.semantic_review" for event in events) == 1
    assert sum(event.type == "verification.strict_attempt" for event in events) == 1
    emitted_checks = [event for event in events if event.type == "verification.result"]
    assert [event.result.value for event in emitted_checks] == [
        "pass",
        "fail",
        "skipped",
        "unavailable",
        "error",
    ]
    assert all(event.attempt_id == strict.attempt_id for event in emitted_checks)


async def test_unknown_check_method_fails_loudly_instead_of_disappearing():
    store, run_id, candidate, _review, strict = await _evidence_stack(
        [{"method": "unregistered_check", "result": "error"}]
    )
    observer = AgentEventObserver(store=store, sink=ValidatingSink(run_id))
    result = ToolResult(
        tool_call_id="strict",
        name=ToolName.STRICT_VERIFY,
        ok=True,
        state=AgentState.REVIEWED,
        payload={
            "candidate_id": str(candidate.candidate_id),
            "attempt_id": str(strict.attempt_id),
        },
    )
    with pytest.raises(ValueError, match="unregistered verification method"):
        await observer.tool_finished(run_id, result)


@pytest.mark.parametrize(
    ("decision", "failure_class", "retry_target"),
    [
        (
            SemanticReviewDecision.CODE_REPAIR,
            VerificationFailureClass.CANDIDATE_DEFECT,
            RetryTarget.CODE_GENERATION,
        ),
        (
            SemanticReviewDecision.REPLAN,
            VerificationFailureClass.PLAN_DEFECT,
            RetryTarget.PLANNING,
        ),
    ],
)
async def test_replay_preserves_semantic_repair_and_replan_routing(
    decision, failure_class, retry_target
):
    store, run_id, candidate, review, _strict = await _evidence_stack(
        [{"method": "structural", "result": "fail"}],
        review_decision=decision,
    )
    sink = ValidatingSink(run_id)
    observer = AgentEventObserver(store=store, sink=sink)

    await observer.tool_finished(
        run_id,
        ToolResult(
            tool_call_id=f"review-{decision.value}",
            name=ToolName.REVIEW_CANDIDATE,
            ok=True,
            state=AgentState.REVIEWED,
            payload={
                "candidate_id": str(candidate.candidate_id),
                "review_id": str(review.review_id),
            },
        ),
    )

    event = next(iter(sink.events.values()))
    assert event.decision is decision
    assert event.failure_class is failure_class
    assert event.retry_target is retry_target


@pytest.mark.parametrize("decision", [VerifierDecision.PASS, VerifierDecision.FAIL])
async def test_replay_preserves_strict_pass_and_fail(decision):
    result = "pass" if decision is VerifierDecision.PASS else "fail"
    store, run_id, candidate, _review, strict = await _evidence_stack(
        [{"method": "structural", "result": result}],
        review_decision=SemanticReviewDecision.READY,
        strict_decision=decision,
    )
    sink = ValidatingSink(run_id)
    observer = AgentEventObserver(store=store, sink=sink)

    await observer.tool_finished(
        run_id,
        ToolResult(
            tool_call_id=f"strict-{decision.value}",
            name=ToolName.STRICT_VERIFY,
            ok=True,
            state=AgentState.REVIEWED,
            payload={
                "candidate_id": str(candidate.candidate_id),
                "attempt_id": str(strict.attempt_id),
            },
        ),
    )

    event = next(event for event in sink.events.values() if event.type.endswith("strict_attempt"))
    assert event.decision is decision


async def test_replan_tool_result_replays_the_exact_plan_revision():
    store = MemoryAgentStore()
    run_id = uuid4()
    sink = ValidatingSink(run_id)
    observer = AgentEventObserver(store=store, sink=sink)
    revised = _plan().model_copy(update={"problem_summary": "Revised Bell-state task"})

    await observer.tool_finished(
        run_id,
        ToolResult(
            tool_call_id="replan-2",
            name=ToolName.REPLAN,
            ok=True,
            state=AgentState.PLANNED,
            payload={"plan_id": str(uuid4()), "revision": 2, "plan": revised.model_dump()},
        ),
    )

    event = next(iter(sink.events.values()))
    assert event.type == "plan.produced"
    assert event.plan.problem_summary == "Revised Bell-state task"
