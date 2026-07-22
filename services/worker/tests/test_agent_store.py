import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

from majorana_contracts.enums import Algorithm
from majorana_contracts.plan import Plan
from majorana_worker.agent_store import RepoAgentStore


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


def test_repo_store_maps_plan_revision_without_legacy_inference() -> None:
    plan = _plan()
    plan_json = plan.model_dump(mode="json")
    fingerprint = hashlib.sha256(
        json.dumps(plan_json, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    row = SimpleNamespace(
        id=uuid4(),
        run_id=uuid4(),
        revision=2,
        parent_plan_id=uuid4(),
        plan=plan_json,
        plan_fingerprint=fingerprint,
        replan_reason="clarify request",
    )

    record = RepoAgentStore._plan_revision(row)

    assert record.plan_id == row.id
    assert record.revision == 2
    assert record.parent_plan_id == row.parent_plan_id
    assert record.plan_fingerprint == fingerprint


def test_repo_store_maps_typed_semantic_and_strict_attempts() -> None:
    candidate_id = uuid4()
    execution_id = uuid4()
    review_id = uuid4()
    fingerprint = "a" * 64
    review_row = SimpleNamespace(
        id=review_id,
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint=fingerprint,
        attempt_seq=2,
        decision="ready",
        confidence="high",
        severity="none",
        reason_code="semantic_ready",
        failure_class=None,
        retry_target="none",
        feedback={"summary": "aligned"},
    )
    strict_row = SimpleNamespace(
        id=uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        semantic_review_id=review_id,
        source_fingerprint=fingerprint,
        attempt_seq=3,
        checks=[{"method": "structural", "result": "pass"}],
        decision="inconclusive",
        evidence_strength="structural",
        claim_coverage=[],
        reason_code="physical_check_unavailable",
        candidate_defect_observed=False,
        failure_class="capability_limit",
        retry_target="none",
        unverified_claims=["Bell phase"],
        verifier_version="test-v1",
    )

    review = RepoAgentStore._semantic_review(review_row)
    strict = RepoAgentStore._strict_verification(strict_row)

    assert review.decision.value == "ready"
    assert review.retry_target.value == "none"
    assert strict.semantic_review_id == review.review_id
    assert strict.decision.value == "inconclusive"
    assert strict.failure_class.value == "capability_limit"
