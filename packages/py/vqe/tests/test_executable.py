from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from majorana_vqe.executable import (
    AnsatzDefinitionSpec,
    ExecutableCompositionError,
    H2SemanticSelection,
    build_h2_scientific_identity,
    executable_component_scientific_payload,
    executable_h2_scientific_identity_digest,
    load_h2_executable_component_specs,
    parse_executable_component,
    validate_h2_executable_composition,
)
from majorana_vqe.models import ComponentType
from majorana_vqe.standard_catalog import workflow_by_key

ROOT = Path(__file__).resolve().parents[4]
COMPONENT_FIXTURE = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "executable_components_v0.2.json"
)


def _fixture() -> dict[ComponentType, dict[str, object]]:
    raw = json.loads(COMPONENT_FIXTURE.read_text())
    return {ComponentType(role): value for role, value in raw.items()}


def _selections() -> list[H2SemanticSelection]:
    workflow = workflow_by_key("workflow.h2.fixed_excitation.v1")
    return [
        H2SemanticSelection(
            role=selection.role,
            component_semantic_key=selection.component_semantic_key,
        )
        for selection in workflow.selections
    ]


def test_review_candidate_h2_components_form_one_executable_workflow():
    workflow = validate_h2_executable_composition(_fixture())

    assert workflow.problem.molecule == "H2"
    assert workflow.reference_state.bitstring_qubit0_first == "1010"
    assert workflow.ansatz.expected_parameter_count == 1
    assert workflow.operator_pool.generator_ids == [workflow.ansatz.generator_id]
    assert workflow.compilation.primary_resource_stages == [
        "canonical_logical",
        "common_basis_compiled",
    ]
    assert workflow.compilation.expected_common_basis_cnot_count == 48
    assert workflow.compilation.expected_common_basis_depth == 83


def test_component_type_and_payload_kind_must_agree():
    problem = _fixture()[ComponentType.PROBLEM]
    with pytest.raises(ExecutableCompositionError, match="requires AnsatzDefinitionSpec"):
        parse_executable_component(ComponentType.ANSATZ, problem)


def test_unknown_fields_fail_closed():
    ansatz = dict(_fixture()[ComponentType.ANSATZ])
    ansatz["undeclared_generator_magic"] = True
    with pytest.raises(ValidationError, match="undeclared_generator_magic"):
        AnsatzDefinitionSpec.model_validate(ansatz)


def test_qubit_width_mismatch_fails_before_execution():
    fixture = _fixture()
    fixture[ComponentType.REFERENCE_STATE] = {
        **fixture[ComponentType.REFERENCE_STATE],
        "bitstring_qubit0_first": "1000",
    }
    with pytest.raises(ValidationError, match="active_electrons"):
        validate_h2_executable_composition(fixture)


def test_parameter_slot_must_bind_the_declared_generator():
    ansatz = dict(_fixture()[ComponentType.ANSATZ])
    slots = [dict(ansatz["parameter_slots"][0])]
    slots[0]["generator_id"] = "double.other"
    ansatz["parameter_slots"] = slots
    with pytest.raises(ValidationError, match="parameter slot"):
        AnsatzDefinitionSpec.model_validate(ansatz)


def test_missing_compilation_protocol_fails_closed():
    fixture = _fixture()
    del fixture[ComponentType.COMPILATION_BACKEND]
    with pytest.raises(ExecutableCompositionError, match="compilation_backend"):
        validate_h2_executable_composition(fixture)


def test_catalog_seed_resolves_to_one_typed_scientific_identity():
    identity = build_h2_scientific_identity(
        selections=_selections(),
        specs=load_h2_executable_component_specs(COMPONENT_FIXTURE),
        hamiltonian_digest_sha256=(
            "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
        ),
    )
    assert identity.hamiltonian_digest_sha256.startswith("d9dd24eb")
    assert len(identity.portable_spec.component_bindings) == 14
    assert len(executable_h2_scientific_identity_digest(identity)) == 64


def test_identity_digest_is_order_independent_and_semantic_changes_are_visible():
    kwargs = {
        "specs": _fixture(),
        "hamiltonian_digest_sha256": (
            "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
        ),
    }
    left = build_h2_scientific_identity(selections=_selections(), **kwargs)
    right = build_h2_scientific_identity(
        selections=list(reversed(_selections())),
        **kwargs,
    )
    assert executable_h2_scientific_identity_digest(left) == (
        executable_h2_scientific_identity_digest(right)
    )

    changed_specs = _fixture()
    changed_specs[ComponentType.PARAMETER_OPTIMIZER] = {
        **changed_specs[ComponentType.PARAMETER_OPTIMIZER],
        "max_function_evaluations": 255,
    }
    changed_specs[ComponentType.STOPPING_PROTOCOL] = {
        **changed_specs[ComponentType.STOPPING_PROTOCOL],
        "max_function_evaluations": 255,
    }
    changed = build_h2_scientific_identity(
        selections=_selections(),
        specs=changed_specs,
        hamiltonian_digest_sha256=kwargs["hamiltonian_digest_sha256"],
    )
    assert executable_h2_scientific_identity_digest(left) != (
        executable_h2_scientific_identity_digest(changed)
    )


def test_provider_version_is_not_part_of_scientific_component_payload():
    optimizer = parse_executable_component(
        ComponentType.PARAMETER_OPTIMIZER,
        _fixture()[ComponentType.PARAMETER_OPTIMIZER],
    )
    payload = executable_component_scientific_payload(
        ComponentType.PARAMETER_OPTIMIZER,
        optimizer,
    )
    assert "provider" not in payload
    assert "provider_version" not in payload
    assert payload["algorithm"] == "scipy_minimize_scalar_bounded"


def test_slsqp_swap_changes_only_optimizer_scientific_binding():
    baseline_specs = _fixture()
    candidate_specs = _fixture()
    candidate_specs[ComponentType.PARAMETER_OPTIMIZER] = {
        **candidate_specs[ComponentType.PARAMETER_OPTIMIZER],
        "algorithm": "scipy_slsqp",
    }
    baseline = build_h2_scientific_identity(
        selections=_selections(),
        specs=baseline_specs,
        hamiltonian_digest_sha256=(
            "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
        ),
    )
    candidate_workflow = workflow_by_key("workflow.h2.fixed_excitation.slsqp.v1")
    candidate = build_h2_scientific_identity(
        selections=[
            H2SemanticSelection(
                role=selection.role,
                component_semantic_key=selection.component_semantic_key,
            )
            for selection in candidate_workflow.selections
        ],
        specs=candidate_specs,
        hamiltonian_digest_sha256=baseline.hamiltonian_digest_sha256,
    )

    baseline_bindings = {
        binding.role: binding for binding in baseline.portable_spec.component_bindings
    }
    candidate_bindings = {
        binding.role: binding for binding in candidate.portable_spec.component_bindings
    }
    changed_roles = [
        role for role in baseline_bindings if baseline_bindings[role] != candidate_bindings[role]
    ]
    assert changed_roles == [ComponentType.PARAMETER_OPTIMIZER]
    assert baseline.portable_spec.dataset_snapshot_sha256 == (
        candidate.portable_spec.dataset_snapshot_sha256
    )
    assert baseline.hamiltonian_digest_sha256 == candidate.hamiltonian_digest_sha256


def test_cobyla_swap_changes_only_optimizer_and_requires_explicit_settings():
    baseline_specs = _fixture()
    candidate_specs = _fixture()
    candidate_specs[ComponentType.PARAMETER_OPTIMIZER] = {
        **candidate_specs[ComponentType.PARAMETER_OPTIMIZER],
        "algorithm": "scipy_cobyla",
        "initial_trust_region_radius_float64_hex": "3ff0000000000000",
        "final_trust_region_radius_float64_hex": "3e45798ee2308c3a",
        "constraint_tolerance_float64_hex": "3d719799812dea11",
    }
    baseline = build_h2_scientific_identity(
        selections=_selections(),
        specs=baseline_specs,
        hamiltonian_digest_sha256=(
            "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
        ),
    )
    candidate_workflow = workflow_by_key("workflow.h2.fixed_excitation.cobyla.v1")
    candidate = build_h2_scientific_identity(
        selections=[
            H2SemanticSelection(
                role=selection.role,
                component_semantic_key=selection.component_semantic_key,
            )
            for selection in candidate_workflow.selections
        ],
        specs=candidate_specs,
        hamiltonian_digest_sha256=baseline.hamiltonian_digest_sha256,
    )
    changed_roles = [
        role
        for role, binding in {
            item.role: item for item in baseline.portable_spec.component_bindings
        }.items()
        if binding != {item.role: item for item in candidate.portable_spec.component_bindings}[role]
    ]
    assert changed_roles == [ComponentType.PARAMETER_OPTIMIZER]

    missing_settings = dict(candidate_specs[ComponentType.PARAMETER_OPTIMIZER])
    del missing_settings["final_trust_region_radius_float64_hex"]
    with pytest.raises(ValidationError, match="COBYLA requires explicit"):
        parse_executable_component(ComponentType.PARAMETER_OPTIMIZER, missing_settings)


def test_non_cobyla_optimizer_rejects_cobyla_specific_settings():
    payload = {
        **_fixture()[ComponentType.PARAMETER_OPTIMIZER],
        "initial_trust_region_radius_float64_hex": "3ff0000000000000",
    }
    with pytest.raises(ValidationError, match="forbidden"):
        parse_executable_component(ComponentType.PARAMETER_OPTIMIZER, payload)


def test_unknown_or_mismatched_seed_selection_fails_closed():
    selections = _selections()
    selections[-1] = H2SemanticSelection(
        role=selections[-1].role,
        component_semantic_key="stopping.unknown.v1",
    )
    with pytest.raises(ExecutableCompositionError, match="mismatched"):
        build_h2_scientific_identity(
            selections=selections,
            specs=_fixture(),
            hamiltonian_digest_sha256=(
                "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
            ),
        )
