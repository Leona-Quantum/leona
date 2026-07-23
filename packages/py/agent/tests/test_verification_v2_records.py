import hashlib
import json
from uuid import uuid4

import pytest
from majorana_agent import (
    CandidateRevision,
    ExecutionEvidence,
    MemoryAgentStore,
    PlanRevision,
    SemanticReviewEvidence,
    StrictVerificationAttempt,
)
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from pydantic import ValidationError


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


def _plan_revision(run_id, revision=1, parent_plan_id=None) -> PlanRevision:
    plan = _plan()
    canonical = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return PlanRevision(
        plan_id=uuid4(),
        run_id=run_id,
        revision=revision,
        parent_plan_id=parent_plan_id,
        plan=plan,
        plan_fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        replan_reason="clarify request" if revision > 1 else None,
    )


def _candidate(run_id, plan_id) -> CandidateRevision:
    source = "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}\n"
    return CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="simulate-1",
        revision=1,
        plan_id=plan_id,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )


def _execution(candidate) -> ExecutionEvidence:
    return ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="e" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
    )


def _review(candidate, execution, attempt_seq=1) -> SemanticReviewEvidence:
    return SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=attempt_seq,
        decision=SemanticReviewDecision.READY,
        reason_code="semantic_ready",
        retry_target=RetryTarget.NONE,
    )


async def test_current_plan_is_explicit_and_reads_are_idempotent() -> None:
    store = MemoryAgentStore()
    run_id = uuid4()
    first = _plan_revision(run_id)
    second = _plan_revision(run_id, revision=2, parent_plan_id=first.plan_id)

    await store.append_plan_revision(first)
    await store.append_plan_revision(second)
    assert await store.current_plan_revision(run_id) is None

    await store.select_current_plan(run_id, first.plan_id)
    assert await store.current_plan_revision(run_id) == first
    assert await store.current_plan_revision(run_id) == first


async def test_plan_parent_must_be_the_preceding_revision_in_the_same_run() -> None:
    store = MemoryAgentStore()
    first_run_plan = _plan_revision(uuid4())
    second_run_id = uuid4()
    second_run_plan = _plan_revision(second_run_id)
    await store.append_plan_revision(first_run_plan)
    await store.append_plan_revision(second_run_plan)

    cross_run_parent = _plan_revision(
        second_run_id, revision=2, parent_plan_id=first_run_plan.plan_id
    )
    with pytest.raises(ValueError, match="preceding revision"):
        await store.append_plan_revision(cross_run_parent)


async def test_semantic_and_strict_attempts_are_immutable_sequences() -> None:
    store = MemoryAgentStore()
    plan = _plan_revision(uuid4())
    candidate = _candidate(plan.run_id, plan.plan_id)
    execution = _execution(candidate)
    review = _review(candidate, execution)
    strict = StrictVerificationAttempt(
        attempt_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        semantic_review_id=review.review_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        decision=VerifierDecision.PASS,
        reason_code="strict_pass",
        candidate_defect_observed=False,
        retry_target=RetryTarget.NONE,
        verifier_version="test-v1",
    )

    await store.append_plan_revision(plan)
    await store.select_current_plan(plan.run_id, plan.plan_id)
    await store.add_candidate(candidate)
    await store.add_execution(execution)
    await store.append_semantic_review(review)
    await store.append_strict_verification(strict)

    assert await store.latest_semantic_review(plan.run_id, candidate.candidate_id) == review
    assert await store.latest_strict_verification(plan.run_id, candidate.candidate_id) == strict
    with pytest.raises(ValueError, match="sequence already exists"):
        await store.append_semantic_review(review)
    with pytest.raises(ValueError, match="sequence already exists"):
        await store.append_strict_verification(strict)


async def test_stale_fingerprint_is_rejected_before_persistence() -> None:
    store = MemoryAgentStore()
    plan = _plan_revision(uuid4())
    candidate = _candidate(plan.run_id, plan.plan_id)
    execution = _execution(candidate)
    stale = _review(candidate, execution).model_copy(update={"source_fingerprint": "f" * 64})

    await store.append_plan_revision(plan)
    await store.select_current_plan(plan.run_id, plan.plan_id)
    await store.add_candidate(candidate)
    await store.add_execution(execution)
    with pytest.raises(ValueError, match="fingerprint mismatch"):
        await store.append_semantic_review(stale)


async def test_candidate_requires_the_explicitly_selected_plan_revision() -> None:
    store = MemoryAgentStore()
    run_id = uuid4()
    first = _plan_revision(run_id)
    second = _plan_revision(run_id, revision=2, parent_plan_id=first.plan_id)
    await store.append_plan_revision(first)
    await store.append_plan_revision(second)
    await store.select_current_plan(run_id, second.plan_id)

    with pytest.raises(ValueError, match="selected Plan revision"):
        await store.add_candidate(_candidate(run_id, first.plan_id))
    selected = _candidate(run_id, second.plan_id)
    await store.add_candidate(selected)
    assert await store.latest_candidate(run_id) == selected


def test_inconclusive_strict_attempt_cannot_claim_a_candidate_defect() -> None:
    with pytest.raises(ValidationError, match="cannot establish a candidate defect"):
        StrictVerificationAttempt(
            attempt_id=uuid4(),
            candidate_id=uuid4(),
            execution_id=uuid4(),
            semantic_review_id=uuid4(),
            source_fingerprint="a" * 64,
            attempt_seq=1,
            decision=VerifierDecision.INCONCLUSIVE,
            reason_code="insufficient_evidence",
            candidate_defect_observed=True,
            retry_target=RetryTarget.NONE,
            verifier_version="test-v1",
        )


@pytest.mark.parametrize(
    ("failure_class", "retry_target", "observed"),
    [
        (VerificationFailureClass.PLAN_DEFECT, RetryTarget.CODE_GENERATION, False),
        (VerificationFailureClass.CANDIDATE_DEFECT, RetryTarget.PLANNING, True),
        (VerificationFailureClass.CANDIDATE_DEFECT, RetryTarget.CODE_GENERATION, False),
        (VerificationFailureClass.VERIFIER_FAILURE, RetryTarget.VERIFICATION, False),
    ],
)
def test_strict_fail_rejects_inconsistent_typed_routing(
    failure_class, retry_target, observed
) -> None:
    with pytest.raises(ValidationError, match="inconsistent typed routing"):
        StrictVerificationAttempt(
            attempt_id=uuid4(),
            candidate_id=uuid4(),
            execution_id=uuid4(),
            semantic_review_id=uuid4(),
            source_fingerprint="a" * 64,
            attempt_seq=1,
            decision=VerifierDecision.FAIL,
            reason_code="strict_failure",
            candidate_defect_observed=observed,
            failure_class=failure_class,
            retry_target=retry_target,
            verifier_version="test-v1",
        )
