from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from majorana_vqe.executable import (
    H2_SLSQP_SEMANTIC_KEYS,
    H2_UCCSD_APPLICABLE_ROLES,
    H2_UCCSD_SEMANTIC_KEYS,
    H2SemanticSelection,
    build_h2_scientific_identity,
    build_h2_uccsd_scientific_identity,
)
from majorana_vqe.migration import (
    ControlledAnsatzMigrationV01,
    build_h2_fixed_to_uccsd_migration,
)
from majorana_vqe.models import ComponentType
from majorana_vqe.portable import (
    ComponentRoleBindingV03,
    PortableScientificExperimentSpecV03,
    portable_scientific_spec_digest,
    workflow_semantic_digest_v03,
)

ROOT = Path(__file__).resolve().parents[4]
FIXTURE_DIR = ROOT / "docs/atlas/fixtures/h2_sto3g"
HAMILTONIAN_DIGEST = "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"


def _identities():
    baseline_specs = {
        ComponentType(role): spec
        for role, spec in json.loads(
            (FIXTURE_DIR / "executable_components_v0.2.json").read_text()
        ).items()
    }
    uccsd_specs = {
        ComponentType(role): spec
        for role, spec in json.loads(
            (FIXTURE_DIR / "executable_components_uccsd_v0.3.json").read_text()
        ).items()
    }
    # The comparison baseline uses the same vector SLSQP scientific component
    # as UCCSD, avoiding an optimizer confound.
    baseline_specs[ComponentType.PARAMETER_OPTIMIZER] = uccsd_specs[
        ComponentType.PARAMETER_OPTIMIZER
    ]
    baseline = build_h2_scientific_identity(
        selections=[
            H2SemanticSelection(role=role, component_semantic_key=key)
            for role, key in H2_SLSQP_SEMANTIC_KEYS.items()
        ],
        specs=baseline_specs,
        hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
    )
    candidate = build_h2_uccsd_scientific_identity(
        semantic_keys=H2_UCCSD_SEMANTIC_KEYS,
        specs={role: uccsd_specs[role] for role in H2_UCCSD_APPLICABLE_ROLES},
        hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
    )
    return baseline, candidate


def _project_baseline_to_v03(baseline) -> PortableScientificExperimentSpecV03:
    """Normalize the legacy baseline into the candidate digest protocol."""

    bindings = [
        ComponentRoleBindingV03(
            role=binding.role,
            component_type=binding.component_type,
            component_semantic_key=binding.component_semantic_key,
            component_spec_sha256=binding.component_spec_sha256,
        )
        for binding in baseline.portable_spec.component_bindings
    ]
    return PortableScientificExperimentSpecV03(
        workflow_semantic_digest=workflow_semantic_digest_v03(bindings),
        component_bindings=bindings,
        dataset_snapshot_sha256=baseline.portable_spec.dataset_snapshot_sha256,
        initial_parameter_slots=baseline.portable_spec.initial_parameter_slots,
        seed=baseline.portable_spec.seed,
    )


def _migration() -> ControlledAnsatzMigrationV01:
    baseline, candidate = _identities()
    return build_h2_fixed_to_uccsd_migration(
        baseline_spec=_project_baseline_to_v03(baseline),
        baseline_source_spec_v02_sha256=portable_scientific_spec_digest(
            baseline.portable_spec
        ),
        candidate_spec=candidate.portable_spec,
        baseline_hamiltonian_sha256=baseline.hamiltonian_digest_sha256,
        candidate_hamiltonian_sha256=candidate.hamiltonian_digest_sha256,
        baseline_reference_energy_float64_hex=baseline.reference_energy_float64_hex,
        candidate_reference_energy_float64_hex=candidate.reference_energy_float64_hex,
    )


def test_uccsd_migration_is_not_misreported_as_one_component_swap():
    migration = _migration()
    assert migration.comparison_class == ("controlled_capability_migration_not_one_component_swap")
    assert migration.primary_changed_role is ComponentType.ANSATZ
    assert migration.dependent_changed_roles == [ComponentType.COMPILATION_BACKEND]
    assert {item.role for item in migration.applicability_transitions} == {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
    assert ComponentType.PARAMETER_OPTIMIZER in migration.preserved_roles


def test_uccsd_migration_resets_even_the_shared_double_slot_id():
    migration = _migration()
    shared = "theta.double.occ0_occ2.to.virt1_virt3"
    assert shared in migration.parameter_reset.baseline_slots_ignored
    assert shared in {slot.slot_id for slot in migration.parameter_reset.candidate_initial_slots}
    assert migration.parameter_reset.reused_slot_ids == []


def test_hidden_optimizer_change_fails_closed():
    payload = _migration().model_dump(mode="json")
    candidate = payload["candidate_spec"]
    optimizer = next(
        item
        for item in candidate["component_bindings"]
        if item["role"] == ComponentType.PARAMETER_OPTIMIZER.value
    )
    optimizer["component_semantic_key"] = "optimizer.cobyla.v1"
    with pytest.raises(
        ValidationError,
        match="workflow_semantic_digest|exactly ansatz plus",
    ):
        ControlledAnsatzMigrationV01.model_validate(payload)


def test_parameter_reuse_claim_fails_closed():
    payload = _migration().model_dump(mode="json")
    payload["parameter_reset"]["reused_slot_ids"] = ["theta.double.occ0_occ2.to.virt1_virt3"]
    with pytest.raises(ValidationError):
        ControlledAnsatzMigrationV01.model_validate(payload)


def test_changed_hamiltonian_fails_closed():
    payload = _migration().model_dump(mode="json")
    payload["candidate_hamiltonian_sha256"] = "0" * 64
    with pytest.raises(ValidationError, match="Hamiltonian"):
        ControlledAnsatzMigrationV01.model_validate(payload)
