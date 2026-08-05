from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/atlas/evidence/phase10/release_audit_no_go_v1.json"
HOSTILE = ROOT / "docs/atlas/evidence/phase10/hostile_corpus_manifest_v1.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_release_audit_is_fail_closed_and_has_no_public_transition():
    audit = _load(EVIDENCE)

    assert audit["decision"] == "NO-GO"
    assert audit["automatic_public_transition"] is False
    assert set(audit["feature_flags"].values()) == {False}
    assert audit["stage_status"]["s11_private_canary"] == "not_run_blocked"
    assert audit["stage_status"]["s12_release_audit"] == "no_go_recorded"
    assert audit["human_review_policy"] == {
        "independent_scientific_review_required_for_this_code_audit": False,
        "independent_scientific_review_claimed": False,
        "security_and_operations_approval_waived": False,
    }


def test_release_audit_blockers_are_unique_and_complete_for_live_gaps():
    audit = _load(EVIDENCE)
    blockers = audit["blocking_reasons"]

    assert len(blockers) == len(set(blockers))
    assert {
        "owner_security_decision_pending",
        "exact_executor_deployment_not_live_qualified",
        "live_hostile_corpus_not_run",
        "private_canary_not_run",
    }.issubset(blockers)

    missing = {
        key for key, value in audit["required_artifacts"].items() if value.startswith("missing")
    }
    assert {
        "accepted_owner_security_decision",
        "sbom",
        "signature_and_attestation",
        "vulnerability_scan",
        "live_hostile_corpus_report",
        "private_canary_evidence",
    }.issubset(missing)


def test_every_release_audit_evidence_locator_exists():
    audit = _load(EVIDENCE)

    for locator in audit["evidence"]:
        assert (ROOT / locator).is_file(), locator


def test_live_blocked_hostile_fixtures_forbid_go_decision():
    audit = _load(EVIDENCE)
    hostile = _load(HOSTILE)
    live_blocked = [
        fixture
        for fixture in hostile["fixtures"]
        if fixture["execution_state"] in {"live_blocked", "recorded_only"}
    ]

    assert live_blocked
    assert audit["decision"] == "NO-GO"
    assert audit["feature_flags"]["external_execution_enabled"] is False
