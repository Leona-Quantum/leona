"""Strict projection from internal JSON evidence to public typed trust state."""

from typing import Any

from majorana_contracts import VerificationSummary
from pydantic import ValidationError


def parse_verification_summary(raw: Any) -> VerificationSummary | None:
    """Return None for absent/legacy/malformed summaries; never infer PASS."""
    if not isinstance(raw, dict):
        return None
    checks = raw.get("checks")
    checks = checks if isinstance(checks, list) else []
    unverified_claims = raw.get("unverified_claims")
    unverified_claims = unverified_claims if isinstance(unverified_claims, list) else []
    payload = {
        "decision": raw.get("decision"),
        "semantic_review_decision": raw.get("semantic_review_decision"),
        "evidence_strength": raw.get("evidence_strength"),
        "reason_code": raw.get("reason_code"),
        "candidate_defect_observed": raw.get("candidate_defect_observed"),
        "failure_class": raw.get("failure_class"),
        "retry_target": raw.get("retry_target"),
        "unverified_claims": unverified_claims[:50],
        "checks": [
            {"method": check.get("method"), "result": check.get("result")}
            for check in checks[:50]
            if isinstance(check, dict)
        ],
    }
    try:
        return VerificationSummary.model_validate(payload)
    except ValidationError:
        return None
