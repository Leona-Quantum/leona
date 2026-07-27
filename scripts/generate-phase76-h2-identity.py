#!/usr/bin/env python3
"""Generate the Phase 7.6 H2 baseline scientific-identity golden fixture."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "py" / "vqe" / "src"))

from majorana_vqe.executable import (  # noqa: E402
    H2SemanticSelection,
    build_h2_scientific_identity,
    executable_h2_scientific_identity_digest,
    load_h2_executable_component_specs,
)
from majorana_vqe.standard_catalog import workflow_by_key  # noqa: E402

COMPONENT_FIXTURE = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "executable_components_v0.2.json"
)
MANIFEST = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json"
OUTPUT = (
    ROOT
    / "docs"
    / "atlas"
    / "evidence"
    / "phase76"
    / "h2_baseline_scientific_identity_v0.1.json"
)


def build_output() -> dict[str, object]:
    workflow = workflow_by_key("workflow.h2.fixed_excitation.v1")
    manifest = json.loads(MANIFEST.read_text())
    identity = build_h2_scientific_identity(
        selections=[
            H2SemanticSelection(
                role=selection.role,
                component_semantic_key=selection.component_semantic_key,
            )
            for selection in workflow.selections
        ],
        specs=load_h2_executable_component_specs(COMPONENT_FIXTURE),
        hamiltonian_digest_sha256=manifest["hamiltonian_digest_sha256"],
        seed=0,
    )
    return {
        "record_kind": "phase76_h2_baseline_scientific_identity",
        "identity": identity.model_dump(mode="json"),
        "identity_sha256": executable_h2_scientific_identity_digest(identity),
        "review_status": "machine_validated_not_independent_human_reviewed",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build_output(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            print(f"{OUTPUT} is stale", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_text(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
