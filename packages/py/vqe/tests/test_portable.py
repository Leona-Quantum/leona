from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_vqe.models import ComponentType
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentSemanticBinding,
    ParameterSlotValue,
    PortableScientificExperimentSpec,
    RegistryComponentResolution,
    RegistryResolution,
    float_to_ieee754_hex,
    ieee754_hex_to_float,
    portable_scientific_spec_digest,
    registry_resolution_digest,
    workflow_semantic_digest,
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
