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


def test_a_review_the_model_merely_disliked_has_complete_evidence():
    """The durable stores refused anything but READY, so the best-effort delivery the
    orchestrator performs on budget exhaustion raised inside the store and destroyed
    the artifact at export instead. One definition now backs both."""

    review = _review()

    assert review.decision is not SemanticReviewDecision.READY
    assert review.evidence_is_complete()


def test_the_deliverability_gate_is_gone_rather_than_relaxed():
    """A tested predicate one import from the guards it used to gate is how the old
    policy comes back. `evidence_is_complete` survives because it RANKS; nothing
    named for admitting or refusing a candidate does."""

    assert not hasattr(SemanticReviewEvidence, "is_deliverable")


def test_a_blocking_defect_leaves_evidence_incomplete():
    assert not _review(severity="blocking").evidence_is_complete()
    assert not _review(severity="major").evidence_is_complete()


def test_a_failed_deterministic_check_leaves_evidence_incomplete():
    review = _review(
        feedback={
            "basic_checks": [
                {"method": "success_criteria", "result": "pass"},
                {"method": "exact_diag", "result": "fail"},
            ]
        }
    )

    assert not review.evidence_is_complete()


def test_a_review_without_recorded_checks_has_incomplete_evidence():
    """Absent evidence is not passing evidence."""

    assert not _review(feedback={}).evidence_is_complete()
    assert not _review(feedback={"basic_checks": []}).evidence_is_complete()


def test_the_record_gate_is_false_wherever_the_projection_would_be_empty():
    """`has_recorded_checks` is the durable stores' promise that something is there
    to label. The worker's projection keeps only mapping-shaped entries, so a gate
    admitting a non-empty list of non-mappings would guarantee a record the
    projection then empties — two readers of one predicate, disagreeing."""

    assert not _review(feedback={}).has_recorded_checks()
    assert not _review(feedback={"basic_checks": []}).has_recorded_checks()
    assert not _review(feedback={"basic_checks": "structural"}).has_recorded_checks()
    assert not _review(feedback={"basic_checks": ["structural", 7]}).has_recorded_checks()
    assert _review(
        feedback={"basic_checks": [{"method": "structural", "result": "fail"}]}
    ).has_recorded_checks()


def test_an_accepted_review_is_still_graded_on_its_trusted_evidence():
    review = _review(
        decision=SemanticReviewDecision.READY,
        failure_class=None,
        retry_target=RetryTarget.NONE,
        feedback={},
    )

    assert not review.evidence_is_complete()
