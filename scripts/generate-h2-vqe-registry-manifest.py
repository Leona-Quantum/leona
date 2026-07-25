"""Generate the deterministic, non-UUID H2 registry promotion manifest.

This is deliberately not a publisher.  It proves machine-valid typed content
and pins the two independent runtime-spike evidence files, while leaving
human_review_state=unreviewed.  A later operator-only importer may consume the
manifest only after the normal Artifact provenance/license/human-review gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from majorana_vqe.executable import validate_h2_executable_composition
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentSemanticBinding,
    normalized_component_spec_digest,
    workflow_semantic_digest,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g"
COMPONENTS_PATH = FIXTURE_DIR / "executable_components_v0.2.json"
OUTPUT_PATH = FIXTURE_DIR / "registry_manifest_v0.2.json"
RAW_PATHS = (
    FIXTURE_DIR / "raw" / "qiskit_vqe_v0.2.json",
    FIXTURE_DIR / "raw" / "pennylane_vqe_v0.2.json",
)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode()


def build_manifest() -> dict[str, object]:
    components = json.loads(COMPONENTS_PATH.read_text())
    typed = {role: components[role.value] for role in PORTABLE_SCIENTIFIC_ROLES}
    # Cross-role semantic checks (qubits, occupation, generator, slots,
    # optimizer/measurement budgets) must pass before any digest is emitted.
    validate_h2_executable_composition(typed)

    bindings: list[ComponentSemanticBinding] = []
    records: list[dict[str, object]] = []
    for role in PORTABLE_SCIENTIFIC_ROLES:
        spec_json = typed[role]
        digest = normalized_component_spec_digest(
            component_type=role,
            spec_json=spec_json,
        )
        semantic_key = f"h2.sto3g.actual_vqe.v0_2.{role.value}"
        bindings.append(
            ComponentSemanticBinding(
                role=role,
                component_type=role,
                component_semantic_key=semantic_key,
                component_spec_sha256=digest,
            )
        )
        records.append(
            {
                "role": role.value,
                "component_type": role.value,
                "semantic_key": semantic_key,
                "normalized_spec_sha256": digest,
                "machine_validation_state": "machine_validated",
                "human_review_state": "unreviewed",
                "spec_json": spec_json,
            }
        )

    evidence: list[dict[str, object]] = []
    for path in RAW_PATHS:
        payload = json.loads(path.read_text())
        if payload.get("status") != "succeeded":
            raise ValueError(f"{path.name} is not successful evidence")
        evidence.append(
            {
                "framework": payload["framework"],
                "path": str(path.relative_to(ROOT)),
                "sha256": _sha256_bytes(path.read_bytes()),
                "best_energy_ha": payload["optimization"]["best_energy_ha"],
                "exact_energy_ha": payload["optimization"]["exact_energy_ha"],
                "absolute_error_ha": payload["optimization"]["absolute_error_ha"],
                "final_parameter": payload["optimization"]["final_parameter"],
            }
        )

    return {
        "schema_version": "0.2.0",
        "manifest_kind": "vqe_review_candidate",
        "publication_state": "blocked_pending_human_review",
        "scientific_claim_scope": (
            "H2 STO-3G noiseless actual-VQE semantic parity; "
            "provider-native compiled resource metrics excluded"
        ),
        "workflow": {
            "semantic_key": "h2.sto3g.actual_vqe.workflow.v0_2",
            "semantic_digest": workflow_semantic_digest(bindings),
            "machine_validation_state": "machine_validated",
            "human_review_state": "unreviewed",
            "required_roles": [role.value for role in PORTABLE_SCIENTIFIC_ROLES],
        },
        "components": records,
        "runtime_spike_evidence": evidence,
        "review_gate": {
            "required": True,
            "reviewer_identity": None,
            "reviewed_at": None,
            "decision": None,
            "note": (
                "Generated machine evidence is not human review. "
                "Do not import as executable/public until an independent reviewer "
                "approves the scientific definitions and evidence."
            ),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = _canonical_bytes(build_manifest())
    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_bytes() != generated:
            raise SystemExit(f"{OUTPUT_PATH} is stale; regenerate without --check")
        print(f"{OUTPUT_PATH.relative_to(ROOT)} is current")
        return
    OUTPUT_PATH.write_bytes(generated)
    print(f"wrote {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
