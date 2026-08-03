"""Fail closed if the Phase 10 S1 security inventory becomes incomplete."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "scripts/validate-phase10-threat-model.py"


def test_phase10_threat_inventory_is_complete_but_does_not_enable_execution() -> None:
    completed = subprocess.run(
        [sys.executable, str(VALIDATOR)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    summary = json.loads(completed.stdout)

    assert summary["threat_count"] >= 26
    assert summary["critical_count"] >= 1
    assert summary["high_count"] >= 1
    assert summary["external_fetch_enabled"] is False
    assert summary["external_execution_enabled"] is False
    assert summary["validation_scope"] == "schema_and_completeness_only"
