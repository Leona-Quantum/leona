from uuid import uuid4

import pytest
from majorana_agent import CandidateRevision, SemanticReviewEvidence
from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
)
from majorana_frameworks import FrameworkProgram
from pydantic import ValidationError


def test_candidate_binds_framework_source_to_fingerprint():
    run_id, plan_id = uuid4(), uuid4()
    source = "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(1)\n"
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="simulate-1",
        revision=1,
        plan_id=plan_id,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )
    assert candidate.source_fingerprint == FrameworkProgram(Framework.QISKIT, source).fingerprint


def test_candidate_rejects_fingerprint_from_different_source():
    source = "FINAL_CIRCUIT = object()\n"
    with pytest.raises(ValidationError, match="fingerprint"):
        CandidateRevision(
            candidate_id=uuid4(),
            run_id=uuid4(),
            tool_call_id="simulate-1",
            revision=1,
            plan_id=uuid4(),
            framework=Framework.CIRQ,
            source=source,
            source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
        )


def _review(**overrides) -> SemanticReviewEvidence:
    payload = {
        "review_id": uuid4(),
        "candidate_id": uuid4(),
        "execution_id": uuid4(),
        "source_fingerprint": "a" * 64,
        "attempt_seq": 1,
        "decision": SemanticReviewDecision.CODE_REPAIR,
        "severity": "minor",
        "reason_code": "intent_code_mismatch",
        "failure_class": VerificationFailureClass.CANDIDATE_DEFECT,
        "retry_target": RetryTarget.CODE_GENERATION,
        "feedback": {"basic_checks": [{"method": "success_criteria", "result": "pass"}]},
    }
    return SemanticReviewEvidence(**{**payload, **overrides})


def test_a_review_the_model_merely_disliked_is_still_deliverable():
    """The durable stores refused anything but READY, so the best-effort delivery the
    orchestrator performs on budget exhaustion raised inside the store and destroyed
    the artifact at export instead. One definition now backs both."""

    review = _review()

    assert review.decision is not SemanticReviewDecision.READY
    assert review.evidence_is_complete()
    assert review.is_deliverable()


def test_a_blocking_defect_is_not_deliverable():
    assert not _review(severity="blocking").is_deliverable()
    assert not _review(severity="major").is_deliverable()


def test_a_failed_deterministic_check_is_not_deliverable():
    review = _review(
        feedback={
            "basic_checks": [
                {"method": "success_criteria", "result": "pass"},
                {"method": "exact_diag", "result": "fail"},
            ]
        }
    )

    assert not review.is_deliverable()


def test_a_review_without_recorded_checks_is_not_deliverable():
    """Absent evidence is not passing evidence."""

    assert not _review(feedback={}).is_deliverable()
    assert not _review(feedback={"basic_checks": []}).is_deliverable()


def test_an_accepted_review_still_requires_complete_trusted_evidence():
    review = _review(
        decision=SemanticReviewDecision.READY,
        failure_class=None,
        retry_target=RetryTarget.NONE,
        feedback={},
    )

    assert not review.is_deliverable()
