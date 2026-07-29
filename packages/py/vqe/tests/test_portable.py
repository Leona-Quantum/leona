from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_vqe.models import ComponentType
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentRoleBindingV03,
    ComponentSemanticBinding,
    ParameterSlotValue,
    PortableScientificExperimentSpec,
    PortableScientificExperimentSpecV03,
    RegistryComponentResolution,
    RegistryResolution,
    RegistryResolutionV02,
    ResolvedPortableExperimentV03,
    float_to_ieee754_hex,
    ieee754_hex_to_float,
    portable_scientific_spec_digest,
    registry_resolution_digest,
    workflow_semantic_digest,
    workflow_semantic_digest_v03,
)


def _bindings() -> list[ComponentSemanticBinding]:
    return [
        ComponentSemanticBinding(
            role=role,
            component_type=role,
            component_semantic_key=f"h2-{role.value}-v1",
            component_spec_sha256=f"{index + 1:064x}",
        )
        for index, role in enumerate(PORTABLE_SCIENTIFIC_ROLES)
    ]


def _spec() -> PortableScientificExperimentSpec:
    bindings = _bindings()
    return PortableScientificExperimentSpec(
        workflow_semantic_digest=workflow_semantic_digest(bindings),
        component_bindings=bindings,
        dataset_snapshot_sha256="a" * 64,
        initial_parameter_slots=[
            ParameterSlotValue(
                slot_id="theta.double.occ0_occ2.to.virt1_virt3",
                float64_hex=float_to_ieee754_hex(0.0),
            )
        ],
        seed=0,
    )


def test_float64_hex_round_trip_is_exact():
    value = -0.125
    assert ieee754_hex_to_float(float_to_ieee754_hex(value)) == value


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_float64_hex_rejects_non_finite_values(value):
    with pytest.raises(ValueError):
        float_to_ieee754_hex(value)


def test_portable_spec_requires_problem_preparation_and_compilation():
    bindings = [
        binding for binding in _bindings() if binding.role is not ComponentType.PROBLEM_PREPARATION
    ]
    with pytest.raises(ValidationError, match="problem_preparation"):
        PortableScientificExperimentSpec(
            workflow_semantic_digest=workflow_semantic_digest(bindings),
            component_bindings=bindings,
            seed=0,
        )


def test_portable_spec_rejects_a_forged_workflow_digest():
    with pytest.raises(ValidationError, match="workflow_semantic_digest"):
        PortableScientificExperimentSpec(
            workflow_semantic_digest="f" * 64,
            component_bindings=_bindings(),
            seed=0,
        )


def test_scientific_digest_survives_registry_uuid_changes():
    spec = _spec()
    resolution_a = RegistryResolution(
        workflow_artifact_version_id=uuid4(),
        components=[
            RegistryComponentResolution(
                role=binding.role,
                artifact_version_id=uuid4(),
                component_semantic_key=binding.component_semantic_key,
                component_spec_sha256=binding.component_spec_sha256,
            )
            for binding in spec.component_bindings
        ],
    )
    resolution_b = RegistryResolution(
        workflow_artifact_version_id=uuid4(),
        components=[
            item.model_copy(update={"artifact_version_id": uuid4()})
            for item in resolution_a.components
        ],
    )

    assert portable_scientific_spec_digest(spec) == portable_scientific_spec_digest(spec)
    assert registry_resolution_digest(resolution_a) != registry_resolution_digest(resolution_b)


def test_parameter_slot_ids_must_be_unique():
    bindings = _bindings()
    slot = ParameterSlotValue(slot_id="theta.0", float64_hex=float_to_ieee754_hex(0.0))
    with pytest.raises(ValidationError, match="duplicate initial parameter"):
        PortableScientificExperimentSpec(
            workflow_semantic_digest=workflow_semantic_digest(bindings),
            component_bindings=bindings,
            initial_parameter_slots=[slot, slot],
            seed=0,
        )


def _v03_bindings() -> list[ComponentRoleBindingV03]:
    not_applicable = {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
    return [
        ComponentRoleBindingV03(
            role=role,
            component_type=role,
            component_semantic_key=None if role in not_applicable else f"h2-uccsd-{role.value}-v1",
            component_spec_sha256=None if role in not_applicable else f"{index + 1:064x}",
            applicability="not_applicable" if role in not_applicable else "required",
        )
        for index, role in enumerate(PORTABLE_SCIENTIFIC_ROLES)
    ]


def test_v03_represents_fixed_ansatz_roles_without_fake_components():
    bindings = _v03_bindings()
    spec = PortableScientificExperimentSpecV03(
        workflow_semantic_digest=workflow_semantic_digest_v03(bindings),
        component_bindings=bindings,
        initial_parameter_slots=[
            ParameterSlotValue(
                slot_id=f"theta.uccsd.{index}",
                float64_hex=float_to_ieee754_hex(0.0),
            )
            for index in range(3)
        ],
        seed=0,
    )

    absent = {
        binding.role
        for binding in spec.component_bindings
        if binding.applicability == "not_applicable"
    }
    assert absent == {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
    assert all(
        binding.component_semantic_key is None and binding.component_spec_sha256 is None
        for binding in spec.component_bindings
        if binding.applicability == "not_applicable"
    )


def test_v03_not_applicable_role_rejects_fake_component_identity():
    with pytest.raises(ValidationError, match="must not invent"):
        ComponentRoleBindingV03(
            role=ComponentType.OPERATOR_POOL,
            component_type=ComponentType.OPERATOR_POOL,
            component_semantic_key="pool.none.fake.v1",
            component_spec_sha256="a" * 64,
            applicability="not_applicable",
        )


def test_v03_required_role_rejects_missing_component_identity():
    with pytest.raises(ValidationError, match="required role must include"):
        ComponentRoleBindingV03(
            role=ComponentType.ANSATZ,
            component_type=ComponentType.ANSATZ,
        )


def test_v03_registry_resolves_only_applicable_roles():
    bindings = _v03_bindings()
    spec = PortableScientificExperimentSpecV03(
        workflow_semantic_digest=workflow_semantic_digest_v03(bindings),
        component_bindings=bindings,
        seed=0,
    )
    resolution = RegistryResolutionV02(
        workflow_artifact_version_id=uuid4(),
        components=[
            RegistryComponentResolution(
                role=binding.role,
                artifact_version_id=uuid4(),
                component_semantic_key=binding.component_semantic_key,
                component_spec_sha256=binding.component_spec_sha256,
            )
            for binding in bindings
            if binding.applicability == "required"
            and binding.component_semantic_key is not None
            and binding.component_spec_sha256 is not None
        ],
    )

    resolved = ResolvedPortableExperimentV03(
        scientific_spec=spec,
        registry_resolution=resolution,
    )
    assert len(resolved.registry_resolution.components) == 11

    forged = resolution.model_copy(
        update={"components": resolution.components[:-1]},
    )
    with pytest.raises(ValidationError, match="match exactly"):
        ResolvedPortableExperimentV03(
            scientific_spec=spec,
            registry_resolution=forged,
        )
