import json

import pytest
from pydantic import ValidationError

from majorana_contracts import (
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationResultKind,
    VerificationSummary,
)
from majorana_contracts.export import build_document


def _summary(**updates) -> VerificationSummary:
    payload = {
        "decision": "pass",
        "evidence_strength": "physical",
        "reason_code": "trusted_checks_passed",
        "candidate_defect_observed": False,
        "failure_class": None,
        "retry_target": "none",
        "unverified_claims": [],
    }
    payload.update(updates)
    return VerificationSummary.model_validate(payload)


def test_all_new_taxonomy_values_survive_json_round_trips():
    enum_types = (
        SemanticReviewDecision,
        VerificationFailureClass,
        RetryTarget,
        VerificationResultKind,
    )
    for enum_type in enum_types:
        for member in enum_type:
            assert enum_type(json.loads(json.dumps(member.value))) is member


def test_new_taxonomy_values_are_exported_to_openapi():
    schemas = build_document()["components"]["schemas"]
    assert schemas["SemanticReviewDecision"]["enum"] == [
        member.value for member in SemanticReviewDecision
    ]
    assert schemas["VerificationFailureClass"]["enum"] == [
        member.value for member in VerificationFailureClass
    ]
    assert schemas["RetryTarget"]["enum"] == [member.value for member in RetryTarget]
    assert set(schemas["VerificationResultKind"]["enum"]) >= {"unavailable", "error"}


def test_verification_summary_round_trips():
    summary = _summary()
    assert VerificationSummary.model_validate_json(summary.model_dump_json()) == summary


def test_inconclusive_requires_candidate_defect_observed_false():
    with pytest.raises(ValidationError) as exc:
        _summary(
            decision="inconclusive",
            candidate_defect_observed=True,
            failure_class="capability_limit",
        )
    assert "candidate_defect_observed=false" in str(exc.value)


def test_unverified_claims_are_bounded():
    with pytest.raises(ValidationError):
        _summary(unverified_claims=[f"claim-{index}" for index in range(51)])
