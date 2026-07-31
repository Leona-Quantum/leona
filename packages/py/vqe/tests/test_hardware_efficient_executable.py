from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from majorana_vqe.executable import (
    H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES,
    H2_HARDWARE_EFFICIENT_MIGRATED_SEMANTIC_KEYS,
    H2_HARDWARE_EFFICIENT_SEMANTIC_KEYS,
    ExecutableCompositionError,
    HardwareEfficientAnsatzDefinitionSpec,
    build_h2_hardware_efficient_scientific_identity,
    load_packaged_h2_hardware_efficient_executable_component_specs,
    validate_h2_hardware_efficient_executable_composition,
)
from majorana_vqe.models import ComponentType

ROOT = Path(__file__).resolve().parents[4]
FIXTURE = ROOT / "docs/atlas/fixtures/h2_sto3g/executable_components_hardware_efficient_v0.4.json"
IDENTITY = ROOT / "docs/atlas/fixtures/h2_sto3g/hardware_efficient_scientific_identity_v0.4.json"
HAMILTONIAN_DIGEST = "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"


def _specs() -> dict[ComponentType, dict[str, object]]:
    payload = json.loads(FIXTURE.read_text())
    return {role: payload[role.value] for role in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES}


def test_hardware_efficient_composition_has_eight_slots_and_no_adaptive_roles():
    workflow = validate_h2_hardware_efficient_executable_composition(_specs())

    assert workflow.ansatz.expected_parameter_count == 8
    assert len(workflow.ansatz.parameter_slots) == 8
    assert workflow.compilation.expected_common_basis_cnot_count == 6
    assert workflow.compilation.expected_common_basis_depth == 7
    assert set(_specs()) == set(H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES)
    assert ComponentType.OPERATOR_POOL not in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES
    assert ComponentType.SEARCH_SELECTION not in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES
    assert ComponentType.GROWTH_BATCHING not in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES


def test_hardware_efficient_rejects_reordered_parameter_slots():
    ansatz = dict(_specs()[ComponentType.ANSATZ])
    ansatz["parameter_slots"] = list(reversed(ansatz["parameter_slots"]))

    with pytest.raises(ValidationError, match="frozen layer order"):
        HardwareEfficientAnsatzDefinitionSpec.model_validate(ansatz)


def test_hardware_efficient_rejects_fake_adaptive_role():
    specs = _specs()
    specs[ComponentType.OPERATOR_POOL] = {
        "schema_version": "0.2.0",
        "kind": "operator_pool",
        "name": "h2_singleton_double_pool",
        "generator_ids": ["double.occ0_occ2.to.virt1_virt3"],
        "ordering": "canonical_generator_id",
    }

    with pytest.raises(ExecutableCompositionError, match="extra=.*operator_pool"):
        validate_h2_hardware_efficient_executable_composition(specs)


def test_hardware_efficient_identity_fixture_is_current_and_marks_na_roles():
    identity = build_h2_hardware_efficient_scientific_identity(
        semantic_keys=H2_HARDWARE_EFFICIENT_SEMANTIC_KEYS,
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
    assert len(identity.portable_spec.initial_parameter_slots) == 8


def test_hardware_efficient_identity_accepts_only_the_exact_migrated_key_set():
    migrated = build_h2_hardware_efficient_scientific_identity(
        semantic_keys=H2_HARDWARE_EFFICIENT_MIGRATED_SEMANTIC_KEYS,
        specs=_specs(),
        hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
    )
    required = {
        binding.role: binding.component_semantic_key
        for binding in migrated.portable_spec.component_bindings
        if binding.applicability == "required"
    }
    assert required == H2_HARDWARE_EFFICIENT_MIGRATED_SEMANTIC_KEYS

    drifted = dict(H2_HARDWARE_EFFICIENT_MIGRATED_SEMANTIC_KEYS)
    drifted[ComponentType.MEASUREMENT] = "measurement.unreviewed.v1"
    with pytest.raises(ExecutableCompositionError, match="unsupported H2 hardware-efficient"):
        build_h2_hardware_efficient_scientific_identity(
            semantic_keys=drifted,
            specs=_specs(),
            hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
        )


def test_packaged_hardware_efficient_seed_matches_authored_fixture():
    packaged = load_packaged_h2_hardware_efficient_executable_component_specs()
    assert packaged == _specs()
