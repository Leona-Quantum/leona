#!/usr/bin/env python3
"""Fail closed when the frozen Phase 5 audit snapshot or its evidence drifts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "atlas" / "evidence"


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} is not a JSON object")
    return value


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_repository_locator(locator: str) -> Path:
    prefix = "git:"
    if not locator.startswith(prefix):
        raise RuntimeError("Phase 5 exception locator must use the explicit git: scheme")
    path = (ROOT / locator.removeprefix(prefix)).resolve()
    if not path.is_relative_to(ROOT):
        raise RuntimeError("SBOM locator escapes the repository")
    return path


def main() -> None:
    sbom_manifest_path = EVIDENCE / "phase5b_runtime_sbom_manifest_v1.json"
    sbom_manifest = load(sbom_manifest_path)
    for item in sbom_manifest.get("sboms", []):
        if not isinstance(item, dict):
            raise RuntimeError("SBOM manifest entry is not an object")
        path = resolve_repository_locator(str(item["object_locator"]))
        if path.stat().st_size != item["byte_count"] or sha256(path) != item["sha256"]:
            raise RuntimeError(f"SBOM object drift: {path}")

    snapshot = load(EVIDENCE / "atlas_vqe_phase5_local_candidate_v1.json")
    if (
        snapshot.get("snapshot_kind") != "non-release"
        or snapshot.get("human_scientific_review") != "unreviewed"
        or snapshot.get("production_runtime_status") != "unqualified"
        or snapshot.get("public_execution") != "blocked"
        or snapshot.get("oci_manifest_digest") is not None
    ):
        raise RuntimeError("Phase 5 snapshot claim boundary was widened")

    for key in ("qualification", "sbom_manifest"):
        reference = snapshot[key]
        path = (ROOT / reference["artifact"]).resolve()
        if not path.is_relative_to(ROOT) or sha256(path) != reference["artifact_sha256"]:
            raise RuntimeError(f"Phase 5 {key} artifact drift")

    qualification = load(ROOT / snapshot["qualification"]["artifact"])
    provenance = qualification.get("provenance_commits", {})
    if (
        provenance.get("audited_branch_head") != snapshot["audited_implementation_head"]
        or provenance.get("qualification_tool_commit") != snapshot["closure_change_commit"]
        or provenance.get("evidence_generated_at_commit") != snapshot["closure_change_commit"]
        or provenance.get("runtime_payload_source_commit")
        != [sbom_manifest["runtime_payload_source_commit"]]
    ):
        raise RuntimeError("Phase 5 commit provenance is inconsistent")


if __name__ == "__main__":
    main()
