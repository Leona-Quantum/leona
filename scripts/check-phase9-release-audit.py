#!/usr/bin/env python3
"""Validate the immutable and incremental Phase 9 release-audit boundaries."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from alembic.config import Config
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = ROOT / "docs/atlas/evidence/phase9/release_audit_2026-08-03.json"
AUDIT_PATH = ROOT / "docs/atlas/evidence/phase9/incremental_release_audit_2026-08-04.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def _fail(message: str) -> None:
    raise SystemExit(f"phase9 release-audit check failed: {message}")


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=lambda token: _fail(f"non-finite JSON number: {token}"),
        )
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"cannot read {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        _fail(f"{path.relative_to(ROOT)} must contain one JSON object")
    return value


def _require_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        _fail(f"{label}: expected {expected!r}, got {actual!r}")


def _require_positive_count(value: Any, label: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        _fail(f"{label} must be a positive integer")


def check() -> None:
    base = _load_json(BASE_PATH)
    audit = _load_json(AUDIT_PATH)

    _require_equal(
        audit.get("schema_version"),
        "atlas.phase9.incremental_release_audit.v1",
        "schema_version",
    )
    _require_equal(
        audit.get("classification"),
        "code_and_private_schema_requalification_not_scientific_result",
        "classification",
    )

    supersedes = audit.get("supersedes")
    if not isinstance(supersedes, dict):
        _fail("supersedes must be an object")
    _require_equal(
        supersedes.get("path"),
        str(BASE_PATH.relative_to(ROOT)),
        "supersedes.path",
    )
    expected_base_digest = hashlib.sha256(BASE_PATH.read_bytes()).hexdigest()
    _require_equal(supersedes.get("sha256"), expected_base_digest, "supersedes.sha256")
    if not SHA256_RE.fullmatch(expected_base_digest):
        _fail("base audit digest is not canonical lowercase SHA-256")
    _require_equal(
        base.get("classification"),
        "code_and_private_schema_release_audit_not_scientific_result",
        "base classification",
    )

    source = audit.get("audited_source")
    if not isinstance(source, dict):
        _fail("audited_source must be an object")
    for field in ("commit", "origin_dev_commit"):
        value = source.get(field)
        if not isinstance(value, str) or not GIT_SHA_RE.fullmatch(value):
            _fail(f"audited_source.{field} must be a full lowercase Git SHA")
    divergence = source.get("origin_dev_divergence")
    if not isinstance(divergence, dict):
        _fail("audited_source.origin_dev_divergence must be an object")
    _require_equal(divergence.get("behind"), 0, "origin_dev_divergence.behind")
    _require_positive_count(
        divergence.get("feature_only_commits"),
        "origin_dev_divergence.feature_only_commits",
    )
    _require_equal(source.get("merge_conflict_check"), "passed", "merge check")
    _require_equal(source.get("feature_branch_push"), "passed", "push check")

    github_ci = audit.get("github_ci")
    if not isinstance(github_ci, dict):
        _fail("github_ci must be an object")
    for name in ("standard", "vqe_production_e2e"):
        run = github_ci.get(name)
        if not isinstance(run, dict):
            _fail(f"github_ci.{name} must be an object")
        _require_positive_count(run.get("run_id"), f"github_ci.{name}.run_id")
        _require_equal(run.get("conclusion"), "success", f"github_ci.{name}")
        _require_equal(run.get("head_sha"), source["commit"], f"github_ci.{name}.head_sha")
        expected_url = f"https://github.com/EshMis/majorana/actions/runs/{run['run_id']}"
        _require_equal(run.get("url"), expected_url, f"github_ci.{name}.url")

    _require_equal(
        github_ci["standard"].get("jobs"),
        {"py": "success", "ts": "success", "db": "success", "ui_visual": "success"},
        "github_ci.standard.jobs",
    )

    local = audit.get("local_gates")
    if not isinstance(local, dict):
        _fail("local_gates must be an object")
    _require_equal(local.get("alembic_up_down_up"), "passed", "alembic cycle")
    alembic_config = Config(str(ROOT / "db/alembic.ini"))
    script_directory = ScriptDirectory.from_config(alembic_config)
    current_heads = sorted(script_directory.get_heads())
    if len(current_heads) != 1:
        _fail(f"current migration graph must have exactly one head, got {current_heads!r}")
    recorded_heads = local.get("alembic_heads")
    if not isinstance(recorded_heads, list) or not recorded_heads:
        _fail("alembic_heads must record at least one historical revision")
    for recorded_head in recorded_heads:
        if not isinstance(recorded_head, str) or not recorded_head:
            _fail("every recorded alembic head must be a non-empty revision string")
        if script_directory.get_revision(recorded_head) is None:
            _fail(f"historical alembic head no longer resolves: {recorded_head!r}")
    for group in (
        "phase9_db_free_contracts",
        "phase9_live_private_transactions",
        "python_full",
        "web_tests",
    ):
        value = local.get(group)
        if not isinstance(value, dict):
            _fail(f"local_gates.{group} must be an object")
        _require_positive_count(value.get("passed"), f"local_gates.{group}.passed")
    _require_equal(local.get("typecheck"), "passed", "typecheck")
    _require_equal(local.get("raw_query_scan"), "passed", "raw_query_scan")
    _require_equal(local.get("generated_openapi"), "current", "generated_openapi")
    _require_equal(
        local.get("phase9_offline_evaluation"),
        "current",
        "phase9_offline_evaluation",
    )
    _require_equal(local.get("import_linter"), {"kept": 5, "broken": 0}, "imports")

    steps = audit.get("phase9_steps")
    if not isinstance(steps, dict) or len(steps) != 13:
        _fail("phase9_steps must contain exactly S0 through S12")
    if any(not str(value).startswith("complete") for value in steps.values()):
        _fail("every Phase 9 step must be recorded as complete")

    review = audit.get("human_review_boundary")
    if not isinstance(review, dict):
        _fail("human_review_boundary must be an object")
    _require_equal(
        review.get("phase_completion_policy"),
        "owner_waived_private_qualification",
        "human review policy",
    )
    _require_equal(review.get("independent_human_review_claimed"), False, "review claim")
    _require_equal(review.get("s7_live_candidate_review_state"), "unreviewed", "S7 review")
    _require_equal(
        review.get("owner_waiver_relabelled_as_independent_review"),
        False,
        "waiver relabelling",
    )

    boundaries = audit.get("scientific_and_release_boundaries")
    if not isinstance(boundaries, dict) or not boundaries:
        _fail("scientific_and_release_boundaries must be a non-empty object")
    if any(value is not False for value in boundaries.values()):
        _fail("all scientific/public/performance release claims must remain false")

    _require_equal(
        audit.get("phase9_completion"),
        {
            "s0_through_s12_complete": True,
            "code_and_private_schema_boundary_complete": True,
            "public_scientific_release_complete": False,
            "public_performance_release_complete": False,
        },
        "phase9_completion",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate the checked-in Phase 9 release-audit evidence",
    )
    args = parser.parse_args()
    if not args.check:
        _fail("only --check is supported")
    check()
    print("Phase 9 incremental release audit is internally consistent.")


if __name__ == "__main__":
    main()
