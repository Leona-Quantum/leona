from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from majorana_vqe.executable import (
    H2_UCCSD_APPLICABLE_ROLES,
    H2_UCCSD_SEMANTIC_KEYS,
    ExecutableCompositionError,
    UccsdAnsatzDefinitionSpec,
    build_h2_uccsd_scientific_identity,
    load_packaged_h2_uccsd_executable_component_specs,
    validate_h2_uccsd_executable_composition,
)
from majorana_vqe.models import ComponentType

ROOT = Path(__file__).resolve().parents[4]
FIXTURE = ROOT / "docs/atlas/fixtures/h2_sto3g/executable_components_uccsd_v0.3.json"
IDENTITY = ROOT / "docs/atlas/fixtures/h2_sto3g/uccsd_scientific_identity_v0.3.json"
HAMILTONIAN_DIGEST = "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"


def _specs() -> dict[ComponentType, dict[str, object]]:
    payload = json.loads(FIXTURE.read_text())
    return {role: payload[role.value] for role in H2_UCCSD_APPLICABLE_ROLES}


def test_uccsd_composition_has_three_slots_and_no_adaptive_roles():
    workflow = validate_h2_uccsd_executable_composition(_specs())
    assert workflow.ansatz.expected_parameter_count == 3
    assert len(workflow.ansatz.parameter_slots) == 3
    assert set(_specs()) == set(H2_UCCSD_APPLICABLE_ROLES)
    assert ComponentType.OPERATOR_POOL not in H2_UCCSD_APPLICABLE_ROLES
    assert ComponentType.SEARCH_SELECTION not in H2_UCCSD_APPLICABLE_ROLES
    assert ComponentType.GROWTH_BATCHING not in H2_UCCSD_APPLICABLE_ROLES


def test_uccsd_rejects_old_half_angle_orientation():
    ansatz = dict(_specs()[ComponentType.ANSATZ])
    ansatz["parameter_orientation"] = "exp_theta_over_2_generator"
    with pytest.raises(ValidationError):
        UccsdAnsatzDefinitionSpec.model_validate(ansatz)


def test_uccsd_rejects_reordered_generators():
    ansatz = dict(_specs()[ComponentType.ANSATZ])
    ansatz["generator_order"] = list(reversed(ansatz["generator_order"]))
    with pytest.raises(ValidationError, match="double then"):
        UccsdAnsatzDefinitionSpec.model_validate(ansatz)


def test_uccsd_rejects_placeholder_pool_role():
    specs = _specs()
    specs[ComponentType.OPERATOR_POOL] = {
        "schema_version": "0.2.0",
        "kind": "operator_pool",
        "name": "h2_singleton_double_pool",
        "generator_ids": ["double.occ0_occ2.to.virt1_virt3"],
        "ordering": "canonical_generator_id",
    }
    with pytest.raises(ExecutableCompositionError, match="extra=.*operator_pool"):
        validate_h2_uccsd_executable_composition(specs)


def test_uccsd_identity_fixture_is_current_and_marks_na_roles():
    identity = build_h2_uccsd_scientific_identity(
        semantic_keys=H2_UCCSD_SEMANTIC_KEYS,
        specs=_specs(),
        hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
    )
    assert identity.model_dump(mode="json") == json.loads(IDENTITY.read_text())
    not_applicable = {
        binding.role
        for binding in identity.portable_spec.component_bindings
        if binding.applicability == "not_applicable"
    }
    assert not_applicable == {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
    assert len(identity.portable_spec.initial_parameter_slots) == 3


def test_packaged_uccsd_seed_matches_authored_fixture():
    packaged = load_packaged_h2_uccsd_executable_component_specs()
    assert packaged == _specs()
