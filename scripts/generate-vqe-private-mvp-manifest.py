#!/usr/bin/env python3
"""Generate the immutable Private Component-First VQE MVP capability manifest.

The standard catalog says what is defined.  This manifest says what the
repository can currently demonstrate, with explicit claim and publication
boundaries.  It is deterministic: timestamps, mutable database identifiers,
and local environment state are deliberately excluded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "py" / "vqe" / "src"))
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))

from majorana_api.vqe_runtime_profiles import (  # noqa: E402
    hardware_efficient_production_runtime_profiles,
    production_runtime_profiles,
    uccsd_production_runtime_profiles,
)
from majorana_vqe.models import ComponentType  # noqa: E402
from majorana_vqe.standard_catalog import (  # noqa: E402
    CATALOG_SCHEMA_VERSION,
    CONTROLLED_COMPARISON_SPECS,
    STANDARD_COMPONENTS,
    STANDARD_IMPLEMENTATIONS,
    STANDARD_WORKFLOWS,
    EvidenceLevel,
    WorkflowStatus,
    workflow_by_key,
)

SCHEMA_VERSION = "1.0.0"
OUTPUTS = (
    ROOT / "docs" / "atlas" / "private_mvp" / "capability_manifest_v1.json",
    ROOT / "apps" / "web" / "lib" / "atlas-vqe" / "private-mvp-capability.generated.json",
)

EVIDENCE = {
    "fixed_runtime": "docs/atlas/evidence/phase76/s12_phase_close_audit.json",
    "optimizer_private_e2e": "docs/atlas/evidence/phase78/s6_private_oci_e2e.json",
    "uccsd_private_oci": "docs/atlas/evidence/phase78/uccsd_private_oci_qualification.json",
    "hardware_efficient_private_oci": (
        "docs/atlas/evidence/phase78/hardware_efficient_private_oci_qualification.json"
    ),
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _runtime_bindings(profiles: tuple[Any, ...]) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for profile in profiles:
        binding = profile.binding
        if binding.production_runtime_status != "qualified":
            raise RuntimeError(
                f"manifest received unqualified profile {binding.runtime_profile_id}"
            )
        if binding.container_digest_kind != "oci_manifest_digest":
            raise RuntimeError(f"manifest received non-OCI profile {binding.runtime_profile_id}")
        result[binding.framework.value] = {
            "runtime_qualification": "qualified_private",
            "runtime_profile_id": binding.runtime_profile_id,
            "runtime_digest": binding.container_digest,
            "architecture": binding.architecture,
            "protocol_version": binding.protocol_version,
        }
    return dict(sorted(result.items()))


def _assert_scientific_boundaries() -> None:
    comparisons = list(CONTROLLED_COMPARISON_SPECS)
    if len(comparisons) != 1:
        raise RuntimeError("Private MVP admits exactly one controlled comparison specification")
    comparison = comparisons[0]
    if comparison.changed_role is not ComponentType.PARAMETER_OPTIMIZER:
        raise RuntimeError("Private MVP comparison must change only parameter_optimizer")
    if comparison.baseline_component_key != "optimizer.slsqp.v1":
        raise RuntimeError("Private MVP comparison baseline must be SLSQP")
    if comparison.candidate_component_key != "optimizer.cobyla.v1":
        raise RuntimeError("Private MVP comparison candidate must be COBYLA")

    expected_statuses = {
        "workflow.h2.fixed_excitation.v1": WorkflowStatus.EXECUTABLE,
        "workflow.h2.fixed_excitation.slsqp.v1": WorkflowStatus.COMPATIBLE,
        "workflow.h2.fixed_excitation.cobyla.v1": WorkflowStatus.EXECUTED,
        "workflow.h2.uccsd.v1": WorkflowStatus.EXECUTED,
        "workflow.h2.hardware_efficient.v1": WorkflowStatus.EXECUTED,
    }
    for key, status in expected_statuses.items():
        if workflow_by_key(key).status is not status:
            raise RuntimeError(f"{key} must remain {status.value}")

    slsqp = next(
        item
        for item in STANDARD_IMPLEMENTATIONS
        if item.component_semantic_key == "optimizer.slsqp.v1"
    )
    if slsqp.evidence_level is not EvidenceLevel.ADAPTER_TESTED:
        raise RuntimeError("Fixed-Excitation + SLSQP must not be promoted before private E2E")


def build_manifest() -> dict[str, Any]:
    _assert_scientific_boundaries()
    evidence = {
        key: {
            "locator": locator,
            "sha256": _sha256(ROOT / locator),
        }
        for key, locator in EVIDENCE.items()
    }
    evidence_counts = {
        level.value: sum(binding.evidence_level is level for binding in STANDARD_IMPLEMENTATIONS)
        for level in EvidenceLevel
    }
    fixed_bindings = _runtime_bindings(production_runtime_profiles())
    return {
        "schema_version": SCHEMA_VERSION,
        "release_scope": "private_technical_mvp",
        "product_model": "component_first_vqe",
        "authority": {
            "catalog_schema_version": CATALOG_SCHEMA_VERSION,
            "source_order": [
                "immutable_registry_records",
                "committed_runtime_evidence",
                "committed_review_evidence",
                "committed_deployment_evidence",
            ],
        },
        "status_vocabulary": {
            "scientific_review": [
                "unreviewed",
                "workspace_reviewed",
                "independently_reviewed",
            ],
            "execution_policy": [
                "review_required",
                "owner_waived_private",
            ],
            "runtime_qualification": [
                "unqualified",
                "adapter_tested",
                "qualified_private",
            ],
            "deployment": [
                "local_dev",
                "private_ci",
                "private_preview",
                "permanent_private",
            ],
            "authentication_evidence": [
                "synthetic_contract",
                "live_workos_staging",
                "live_workos_production",
            ],
            "publication": ["blocked", "private_only", "approved"],
        },
        "claim_boundary": {
            "scientific_review": "unreviewed",
            "execution_policy": "owner_waived_private",
            "publication": "blocked",
            "public_execution": "blocked",
            "scientific_superiority_claim": "blocked",
            "external_repository_execution": "blocked",
            "statement": (
                "Executable interoperability and private persistence only; "
                "no optimizer, ansatz, or provider superiority claim."
            ),
        },
        "catalog_inventory": {
            "schema_valid_seed_candidates": len(STANDARD_COMPONENTS),
            "generated_implementation_projections": len(STANDARD_IMPLEMENTATIONS),
            "workflow_templates": len(STANDARD_WORKFLOWS),
            "controlled_comparison_specifications": len(CONTROLLED_COMPARISON_SPECS),
            "implementation_evidence_levels": evidence_counts,
            "is_qualification_kpi": False,
        },
        "capabilities": {
            "h2_fixed_excitation_runtime": {
                "component_definition": "ansatz.h2.fixed_excitation.v1",
                "runtime_qualification": "qualified_private",
                "implementations": fixed_bindings,
                "evidence": ["fixed_runtime"],
            },
            "h2_fixed_excitation_slsqp": {
                "workflow": "workflow.h2.fixed_excitation.slsqp.v1",
                "runtime_qualification": "adapter_tested",
                "implementations": fixed_bindings,
                "evidence": [],
                "blocking_reason": (
                    "No committed private E2E evidence executes Fixed Excitation with SLSQP."
                ),
            },
            "h2_fixed_excitation_cobyla": {
                "workflow": "workflow.h2.fixed_excitation.cobyla.v1",
                "runtime_qualification": "qualified_private",
                "implementations": fixed_bindings,
                "evidence": ["optimizer_private_e2e"],
            },
            "h2_uccsd": {
                "workflow": "workflow.h2.uccsd.v1",
                "runtime_qualification": "qualified_private",
                "implementations": _runtime_bindings(uccsd_production_runtime_profiles()),
                "evidence": ["uccsd_private_oci"],
                "comparison_class": "secondary_private_smoke",
            },
            "h2_hardware_efficient": {
                "workflow": "workflow.h2.hardware_efficient.v1",
                "runtime_qualification": "qualified_private",
                "implementations": _runtime_bindings(
                    hardware_efficient_production_runtime_profiles()
                ),
                "evidence": ["hardware_efficient_private_oci"],
                "comparison_class": "capability_migration_not_one_component_swap",
            },
        },
        "golden_journeys": {
            "primary_fixed_excitation_slsqp": {
                "status": "NOT_RUN",
                "go_decision": "unavailable",
                "frameworks": ["qiskit", "pennylane"],
                "required_evidence": "private_ci_execution_save_reopen",
            },
            "controlled_slsqp_to_cobyla": {
                "status": "NOT_RUN",
                "go_decision": "unavailable",
                "changed_roles": ["parameter_optimizer"],
                "required_evidence": "private_ci_comparison_run_save_reopen",
            },
            "secondary_uccsd_smoke": {
                "status": "qualified_private",
                "go_decision": "private_only",
                "frameworks": ["qiskit", "pennylane"],
            },
            "tertiary_hardware_efficient_smoke": {
                "status": "qualified_private",
                "go_decision": "private_only",
                "frameworks": ["qiskit", "pennylane"],
            },
            "live_workos_same_account_reopen": {
                "status": "NOT_RUN",
                "go_decision": "unavailable",
                "required_evidence": "live_workos_staging_same_subject_reopen",
            },
        },
        "evidence": evidence,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build_manifest(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        stale = [path for path in OUTPUTS if not path.exists() or path.read_text() != rendered]
        if stale:
            for path in stale:
                print(f"{path} is stale", file=sys.stderr)
            return 1
        return 0
    for path in OUTPUTS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
