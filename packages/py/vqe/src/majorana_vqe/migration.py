"""Fail-closed scientific workflow migration contracts.

An ansatz replacement can force changes to dependent resource protocols and
to the applicability of adaptive-only roles.  Such a migration must not be
reported as a controlled one-component swap.  This module records the primary
scientific factor, every dependent change, and the parameter reset boundary.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import Field, model_validator

from .models import SHA256_HEX_PATTERN, ComponentType, VqeBaseModel
from .portable import (
    FLOAT64_HEX_PATTERN,
    ParameterSlotValue,
    PortableScientificExperimentSpecV03,
)

H2_FIXED_TO_UCCSD_NA_ROLES = frozenset(
    {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
)


class RoleApplicabilityTransition(VqeBaseModel):
    role: ComponentType
    baseline: Literal["required"]
    candidate: Literal["not_applicable"]


class ParameterResetBoundary(VqeBaseModel):
    """Explicitly forbids parameter reuse across incompatible orientations."""

    schema_version: Literal["0.1.0"] = "0.1.0"
    policy: Literal["reset_all"]
    reason: Literal["ansatz_parameter_orientation_and_dimension_changed"]
    baseline_orientation: Literal["exp_theta_over_2_generator"]
    candidate_orientation: Literal["exp_theta_generator"]
    baseline_slots_ignored: list[str] = Field(min_length=1, max_length=256)
    candidate_initial_slots: list[ParameterSlotValue] = Field(min_length=1, max_length=256)
    reused_slot_ids: list[str] = Field(default_factory=list, max_length=0)

    @model_validator(mode="after")
    def _slots_are_unique(self) -> Self:
        baseline_ids = self.baseline_slots_ignored
        candidate_ids = [slot.slot_id for slot in self.candidate_initial_slots]
        if len(baseline_ids) != len(set(baseline_ids)):
            raise ValueError("baseline parameter slots must be unique")
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("candidate parameter slots must be unique")
        return self


class ControlledAnsatzMigrationV01(VqeBaseModel):
    """Fixed-excitation to UCCSD scientific migration for the bounded H₂ slice.

    The primary research factor is the ansatz.  The compilation protocol is a
    declared dependent change because it measures a different canonical
    circuit.  Pool/search/growth become genuinely inapplicable.  All remaining
    roles, including SLSQP, must be byte-for-byte scientifically identical.
    """

    schema_version: Literal["0.1.0"] = "0.1.0"
    comparison_class: Literal["controlled_capability_migration_not_one_component_swap"]
    primary_changed_role: Literal[ComponentType.ANSATZ]
    dependent_changed_roles: list[ComponentType] = Field(min_length=1, max_length=1)
    applicability_transitions: list[RoleApplicabilityTransition] = Field(
        min_length=3,
        max_length=3,
    )
    preserved_roles: list[ComponentType] = Field(min_length=1, max_length=14)
    baseline_spec: PortableScientificExperimentSpecV03
    baseline_source_spec_v02_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    candidate_spec: PortableScientificExperimentSpecV03
    baseline_hamiltonian_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    candidate_hamiltonian_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    baseline_reference_energy_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    candidate_reference_energy_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    parameter_reset: ParameterResetBoundary

    @model_validator(mode="after")
    def _migration_is_complete_and_controlled(self) -> Self:
        if self.dependent_changed_roles != [ComponentType.COMPILATION_BACKEND]:
            raise ValueError(
                "H2 UCCSD migration must declare compilation_backend as its sole "
                "dependent changed role"
            )
        transition_roles = {item.role for item in self.applicability_transitions}
        if transition_roles != H2_FIXED_TO_UCCSD_NA_ROLES:
            raise ValueError(
                "H2 UCCSD migration must declare operator_pool, search_selection, "
                "and growth_batching as required-to-not_applicable"
            )
        if len(transition_roles) != len(self.applicability_transitions):
            raise ValueError("duplicate applicability transition role")

        baseline = {item.role: item for item in self.baseline_spec.component_bindings}
        candidate = {item.role: item for item in self.candidate_spec.component_bindings}
        changed_required_roles: set[ComponentType] = set()
        actual_transition_roles: set[ComponentType] = set()
        actual_preserved_roles: set[ComponentType] = set()

        for role, baseline_binding in baseline.items():
            candidate_binding = candidate[role]
            if candidate_binding.applicability == "not_applicable":
                actual_transition_roles.add(role)
                continue
            if (
                baseline_binding.component_semantic_key != candidate_binding.component_semantic_key
                or baseline_binding.component_spec_sha256 != candidate_binding.component_spec_sha256
            ):
                changed_required_roles.add(role)
            else:
                actual_preserved_roles.add(role)

        if changed_required_roles != {
            ComponentType.ANSATZ,
            ComponentType.COMPILATION_BACKEND,
        }:
            raise ValueError(
                "H2 UCCSD migration must change exactly ansatz plus its dependent "
                "compilation protocol among applicable roles"
            )
        if actual_transition_roles != transition_roles:
            raise ValueError("declared applicability transitions do not match the specs")
        if len(self.preserved_roles) != len(set(self.preserved_roles)):
            raise ValueError("duplicate preserved role")
        if set(self.preserved_roles) != actual_preserved_roles:
            raise ValueError("preserved_roles do not match scientifically identical bindings")

        if (
            self.baseline_spec.dataset_snapshot_sha256
            != self.candidate_spec.dataset_snapshot_sha256
        ):
            raise ValueError("dataset snapshot must remain fixed")
        if self.baseline_spec.seed != self.candidate_spec.seed:
            raise ValueError("scientific seed must remain fixed")
        if self.baseline_hamiltonian_sha256 != self.candidate_hamiltonian_sha256:
            raise ValueError("Hamiltonian content digest must remain fixed")
        if (
            self.baseline_reference_energy_float64_hex
            != self.candidate_reference_energy_float64_hex
        ):
            raise ValueError("reference energy must remain fixed")

        baseline_slot_ids = [slot.slot_id for slot in self.baseline_spec.initial_parameter_slots]
        if self.parameter_reset.baseline_slots_ignored != baseline_slot_ids:
            raise ValueError("parameter reset must ignore every baseline slot")
        if (
            self.parameter_reset.candidate_initial_slots
            != self.candidate_spec.initial_parameter_slots
        ):
            raise ValueError("parameter reset must initialize every candidate slot")
        if len(baseline_slot_ids) != 1 or len(self.parameter_reset.candidate_initial_slots) != 3:
            raise ValueError("bounded H2 migration requires one baseline and three UCCSD slots")
        return self


def build_h2_fixed_to_uccsd_migration(
    *,
    baseline_spec: PortableScientificExperimentSpecV03,
    baseline_source_spec_v02_sha256: str,
    candidate_spec: PortableScientificExperimentSpecV03,
    baseline_hamiltonian_sha256: str,
    candidate_hamiltonian_sha256: str,
    baseline_reference_energy_float64_hex: str,
    candidate_reference_energy_float64_hex: str,
) -> ControlledAnsatzMigrationV01:
    """Derive the change manifest; validation rejects every hidden difference."""

    baseline = {item.role: item for item in baseline_spec.component_bindings}
    candidate = {item.role: item for item in candidate_spec.component_bindings}
    preserved = [
        role
        for role in baseline
        if candidate[role].applicability == "required"
        and baseline[role].component_semantic_key == candidate[role].component_semantic_key
        and baseline[role].component_spec_sha256 == candidate[role].component_spec_sha256
    ]
    return ControlledAnsatzMigrationV01(
        comparison_class="controlled_capability_migration_not_one_component_swap",
        primary_changed_role=ComponentType.ANSATZ,
        dependent_changed_roles=[ComponentType.COMPILATION_BACKEND],
        applicability_transitions=[
            RoleApplicabilityTransition(
                role=role,
                baseline="required",
                candidate="not_applicable",
            )
            for role in sorted(H2_FIXED_TO_UCCSD_NA_ROLES, key=lambda item: item.value)
        ],
        preserved_roles=preserved,
        baseline_spec=baseline_spec,
        baseline_source_spec_v02_sha256=baseline_source_spec_v02_sha256,
        candidate_spec=candidate_spec,
        baseline_hamiltonian_sha256=baseline_hamiltonian_sha256,
        candidate_hamiltonian_sha256=candidate_hamiltonian_sha256,
        baseline_reference_energy_float64_hex=baseline_reference_energy_float64_hex,
        candidate_reference_energy_float64_hex=candidate_reference_energy_float64_hex,
        parameter_reset=ParameterResetBoundary(
            policy="reset_all",
            reason="ansatz_parameter_orientation_and_dimension_changed",
            baseline_orientation="exp_theta_over_2_generator",
            candidate_orientation="exp_theta_generator",
            baseline_slots_ignored=[slot.slot_id for slot in baseline_spec.initial_parameter_slots],
            candidate_initial_slots=candidate_spec.initial_parameter_slots,
            reused_slot_ids=[],
        ),
    )
