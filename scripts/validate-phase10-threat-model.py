#!/usr/bin/env python3
"""Validate the Phase 10 S1 threat inventory without running hostile code."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/atlas/evidence/phase10/threat_control_matrix_v1.json"

REQUIRED_TOP_LEVEL = {
    "schema_version",
    "classification",
    "phase10_external_fetch_enabled",
    "phase10_external_execution_enabled",
    "s0_owner_decision",
    "s1_status",
    "owner_roles",
    "control_states",
    "threats",
}
REQUIRED_THREAT_FIELDS = {
    "id",
    "category",
    "severity",
    "attack",
    "preventive_control",
    "detective_control",
    "failure_code",
    "fixture_id",
    "test_locator",
    "control_state",
    "target_stage",
    "owner_role",
    "residual_risk",
}
SEVERITIES = {"critical", "high", "medium", "low"}
TARGET_STAGES = {f"S{stage}" for stage in range(13)}


def fail(message: str) -> None:
    raise SystemExit(f"phase10 threat model invalid: {message}")


def main() -> None:
    data = json.loads(MATRIX.read_text(encoding="utf-8"))
    missing_top = REQUIRED_TOP_LEVEL - data.keys()
    if missing_top:
        fail(f"missing top-level keys: {sorted(missing_top)}")
    if data["phase10_external_fetch_enabled"] is not False:
        fail("external fetch must remain disabled at S1")
    if data["phase10_external_execution_enabled"] is not False:
        fail("external execution must remain disabled at S1")
    if data["s0_owner_decision"] != "pending":
        fail("S0 owner decision must stay pending until a dated owner record exists")

    owner_roles = data["owner_roles"]
    control_states = set(data["control_states"])
    threats = data["threats"]
    if not isinstance(threats, list) or not threats:
        fail("threats must be a non-empty list")

    ids: set[str] = set()
    fixtures: set[str] = set()
    for index, threat in enumerate(threats):
        if not isinstance(threat, dict):
            fail(f"threat {index} is not an object")
        missing = REQUIRED_THREAT_FIELDS - threat.keys()
        if missing:
            fail(f"threat {index} missing fields: {sorted(missing)}")
        threat_id = threat["id"]
        if threat_id in ids:
            fail(f"duplicate threat id: {threat_id}")
        ids.add(threat_id)
        fixture_id = threat["fixture_id"]
        if fixture_id in fixtures:
            fail(f"duplicate fixture id: {fixture_id}")
        fixtures.add(fixture_id)
        if threat["severity"] not in SEVERITIES:
            fail(f"invalid severity for {threat_id}")
        if threat["control_state"] not in control_states:
            fail(f"invalid control state for {threat_id}")
        if threat["target_stage"] not in TARGET_STAGES:
            fail(f"invalid target stage for {threat_id}")
        if threat["owner_role"] not in owner_roles:
            fail(f"unknown owner role for {threat_id}")
        for field in REQUIRED_THREAT_FIELDS - {"id"}:
            value = threat[field]
            if not isinstance(value, str) or not value.strip():
                fail(f"{threat_id} has an empty {field}")
        if threat["control_state"] == "implemented_existing" and threat["test_locator"].startswith(
            "planned:"
        ):
            fail(f"{threat_id} claims implementation with only a planned test")

    critical_or_high = [threat for threat in threats if threat["severity"] in {"critical", "high"}]
    if len(critical_or_high) != len(threats):
        fail("S1 baseline currently expects every row to be release-blocking")

    print(
        json.dumps(
            {
                "matrix": str(MATRIX.relative_to(ROOT)),
                "threat_count": len(threats),
                "critical_count": sum(threat["severity"] == "critical" for threat in threats),
                "high_count": sum(threat["severity"] == "high" for threat in threats),
                "external_fetch_enabled": False,
                "external_execution_enabled": False,
                "validation_scope": "schema_and_completeness_only",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
