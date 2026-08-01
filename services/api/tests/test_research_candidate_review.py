"""DB-free scientific and lifecycle gates for Phase 9 S9 reviews."""

from __future__ import annotations

import copy

import pytest

from majorana_api.repos import research_candidates


def _candidate(*, with_unknown: bool = False) -> dict:
    return {
        "local_id": "candidate_mapper",
        "candidate_type": "implementation",
        "fields": [
            {
                "field": "name",
                "value": "JordanWignerMapper",
                "evidence_ids": ["ev_mapper"],
            }
        ],
        "unknowns": (
            [{"topic": "license", "reason": "not declared", "evidence_ids": []}]
            if with_unknown
            else []
        ),
        "conflicts": [],
    }


def _field_decision(decision: str = "accept", edited_value=None) -> dict:
    return {
        "subject_id": "field:name",
        "decision": decision,
        "edited_value": edited_value,
        "rationale": "Compared the proposal directly with the cited immutable source.",
    }


def test_accepted_review_preserves_source_candidate() -> None:
    candidate = _candidate()
    original = copy.deepcopy(candidate)

    decisions, reviewed = research_candidates._validate_review_decisions(
        candidate,
        [_field_decision()],
        disposition="accepted",
    )

    assert candidate == original
    assert reviewed == original
    assert decisions[0]["evidence_ids"] == ["ev_mapper"]


def test_edit_creates_a_new_human_provenance_version() -> None:
    _, reviewed = research_candidates._validate_review_decisions(
        _candidate(),
        [_field_decision("edit", "Jordan-Wigner mapper")],
        disposition="accepted",
    )

    assert reviewed["fields"][0]["value"] == "Jordan-Wigner mapper"
    assert reviewed["fields"][0]["review_provenance"] == "workspace_human_edit"


def test_unknown_prevents_false_acceptance() -> None:
    decisions = [
        _field_decision(),
        {
            "subject_id": "unknown:0",
            "decision": "acknowledge",
            "edited_value": None,
            "rationale": "The source does not establish the license expression.",
        },
    ]

    with pytest.raises(
        research_candidates.ResearchCandidateReviewError,
        match="open_issues",
    ):
        research_candidates._validate_review_decisions(
            _candidate(with_unknown=True),
            decisions,
            disposition="accepted",
        )

    _, reviewed = research_candidates._validate_review_decisions(
        _candidate(with_unknown=True),
        decisions,
        disposition="needs_resolution",
    )
    assert reviewed["unknowns"]


def test_incomplete_and_invented_review_subjects_fail_closed() -> None:
    with pytest.raises(
        research_candidates.ResearchCandidateReviewError,
        match="incomplete",
    ):
        research_candidates._validate_review_decisions(
            _candidate(),
            [],
            disposition="accepted",
        )

    invented = _field_decision()
    invented["subject_id"] = "field:invented"
    with pytest.raises(
        research_candidates.ResearchCandidateReviewError,
        match="invalid_review_subject",
    ):
        research_candidates._validate_review_decisions(
            _candidate(),
            [invented],
            disposition="accepted",
        )
