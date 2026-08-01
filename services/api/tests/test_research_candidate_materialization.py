"""DB-free scientific and lifecycle gates for Phase 9 S10 materialization."""

from __future__ import annotations

import uuid

import pytest

from majorana_api.orm import VqeResearchCandidateReviewRow
from majorana_api.repos import research_candidates

SOURCE_URL = "https://github.com/Qiskit/qiskit-nature"
SOURCE_COMMIT = "a" * 40


def _review() -> VqeResearchCandidateReviewRow:
    values = {
        "name": "UCCSD implementation",
        "component_type": "ansatz",
        "provider": "qiskit",
        "package": "qiskit-nature",
        "module": "qiskit_nature.second_q.circuit.library",
        "symbol": "UCCSD",
        "version": "0.8.0",
        "license_expression": "Apache-2.0",
        "repository_url": SOURCE_URL,
        "commit_sha": SOURCE_COMMIT,
    }
    fields = [
        {
            "field": key,
            "value": value,
            "evidence_ids": ["ev_license" if key == "license_expression" else "ev_identity"],
        }
        for key, value in values.items()
    ]
    decisions = [
        {
            "subject_id": f"field:{field['field']}",
            "decision": "accept",
            "edited_value": None,
            "rationale": "Checked against immutable source evidence.",
            "evidence_ids": field["evidence_ids"],
        }
        for field in fields
    ]
    return VqeResearchCandidateReviewRow(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        envelope_id=uuid.uuid4(),
        previous_review_id=None,
        reviewer_user_id=uuid.uuid4(),
        candidate_local_id="candidate_uccsd",
        review_kind="workspace_human_review",
        independence_state="not_asserted",
        disposition="accepted",
        source_snapshot_sha256="b" * 64,
        evidence_bundle_sha256="c" * 64,
        base_candidate_sha256="d" * 64,
        reviewed_candidate_json={
            "local_id": "candidate_uccsd",
            "candidate_type": "implementation",
            "fields": fields,
            "unknowns": [],
            "conflicts": [],
        },
        reviewed_candidate_sha256="e" * 64,
        decisions_json=decisions,
        rationale="The required source facts are directly evidenced.",
        review_sha256="f" * 64,
    )


def _evidence() -> tuple[dict, ...]:
    return (
        {
            "evidence_id": "ev_license",
            "declared_value": "Apache-2.0",
        },
        {
            "evidence_id": "ev_identity",
            "declared_value": "identity evidence",
        },
    )


def test_accepted_review_builds_only_private_structured_metadata() -> None:
    license_expression, compatibility, bundle = (
        research_candidates._build_private_materialization_contract(
            _review(),
            evidence=_evidence(),
            source_repository_url=SOURCE_URL,
            source_commit_sha=SOURCE_COMMIT,
        )
    )

    assert license_expression == "Apache-2.0"
    assert compatibility["component_type"] == "ansatz"
    assert compatibility["execution_eligible"] is False
    assert compatibility["publication_eligible"] is False
    assert compatibility["registry_promotion"] == "blocked"
    assert bundle["license"]["publication_authority"] is False


def test_human_edited_license_cannot_create_its_own_license_authority() -> None:
    review = _review()
    decision = next(
        item for item in review.decisions_json if item["subject_id"] == "field:license_expression"
    )
    decision["decision"] = "edit"

    with pytest.raises(
        research_candidates.ResearchCandidateMaterializationError,
        match="license_gate_not_satisfied",
    ):
        research_candidates._build_private_materialization_contract(
            review,
            evidence=_evidence(),
            source_repository_url=SOURCE_URL,
            source_commit_sha=SOURCE_COMMIT,
        )


def test_license_must_equal_declared_source_evidence() -> None:
    evidence = list(_evidence())
    evidence[0] = {"evidence_id": "ev_license", "declared_value": "unknown"}

    with pytest.raises(
        research_candidates.ResearchCandidateMaterializationError,
        match="license_evidence_not_exact",
    ):
        research_candidates._build_private_materialization_contract(
            _review(),
            evidence=tuple(evidence),
            source_repository_url=SOURCE_URL,
            source_commit_sha=SOURCE_COMMIT,
        )


def test_implementation_source_identity_cannot_be_human_rewritten() -> None:
    review = _review()
    repository_field = next(
        item
        for item in review.reviewed_candidate_json["fields"]
        if item["field"] == "repository_url"
    )
    repository_field["value"] = "https://github.com/example/fork"

    with pytest.raises(
        research_candidates.ResearchCandidateMaterializationError,
        match="source_identity_field_mismatch",
    ):
        research_candidates._build_private_materialization_contract(
            review,
            evidence=_evidence(),
            source_repository_url=SOURCE_URL,
            source_commit_sha=SOURCE_COMMIT,
        )


def test_open_scientific_issue_still_fails_after_acceptance_row() -> None:
    review = _review()
    review.reviewed_candidate_json["unknowns"] = [
        {"topic": "mapping", "reason": "not evidenced", "evidence_ids": []}
    ]

    with pytest.raises(
        research_candidates.ResearchCandidateMaterializationError,
        match="open_issues",
    ):
        research_candidates._build_private_materialization_contract(
            review,
            evidence=_evidence(),
            source_repository_url=SOURCE_URL,
            source_commit_sha=SOURCE_COMMIT,
        )
