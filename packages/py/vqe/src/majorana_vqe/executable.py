"""Typed executable-component contracts for the Phase 4.5 H2 capability.

The literature corpus may retain free-form annotations.  Execution cannot:
every role used by the approved H2 workflow is parsed into one of these
closed models and checked as a composition before a scientific identity is
persisted.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Annotated, Iterable, Literal, Self

from pydantic import Field, TypeAdapter, model_validator

from .models import SHA256_HEX_PATTERN, ComponentType, VqeBaseModel, walk_and_validate_json_value
from .portable import (
    FLOAT64_HEX_PATTERN,
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentSemanticBinding,
    ParameterSlotValue,
    PortableScientificExperimentSpec,
    normalized_component_spec_digest,
    workflow_semantic_digest,
)

EXECUTABLE_COMPONENT_SCHEMA_VERSION = "0.2.0"


class ExecutableSpecBase(VqeBaseModel):
    schema_version: Literal["0.2.0"] = EXECUTABLE_COMPONENT_SCHEMA_VERSION

    @model_validator(mode="after")
    def _all_text_is_safe_scientific_metadata(self) -> Self:
        walk_and_validate_json_value(
            self.model_dump(mode="json"),
            field_path=type(self).__name__,
        )
        return self


class AtomCoordinate(ExecutableSpecBase):
    element: Literal["H"]
    x_angstrom: float
    y_angstrom: float
    z_angstrom: float


class H2ProblemSpec(ExecutableSpecBase):
    kind: Literal["electronic_structure_problem"]
    molecule: Literal["H2"]
    geometry: list[AtomCoordinate] = Field(min_length=2, max_length=2)
    charge: Literal[0]
    multiplicity: Literal[1]
    basis: Literal["sto-3g"]
    active_electrons: Literal[2]
    spin_orbitals: Literal[4]
    frozen_core: Literal[False]
    dataset_snapshot_sha256: str = Field(pattern=SHA256_HEX_PATTERN)


class ElectronicStructurePreparationSpec(ExecutableSpecBase):
    kind: Literal["electronic_structure_preparation"]
    provider: Literal["pyscf"]
    provider_version: str = Field(min_length=1, max_length=50)
    mean_field: Literal["rhf"]
    scf_convergence_tolerance_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    scf_max_cycles: int = Field(gt=0, le=10_000)
    symmetry: Literal["off"]
    orbital_convention: Literal["canonical_rhf_spin_orbitals_alpha_then_beta"]
    nuclear_repulsion_convention: Literal["stored_separately_added_to_total_energy"]
    integral_zero_threshold_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)


class QubitRepresentationSpec(ExecutableSpecBase):
    kind: Literal["qubit_representation"]
    mapping: Literal["jordan_wigner"]
    num_qubits: Literal[4]
    qubit_order: Literal["canonical_qubit0_first_alpha_then_beta"]
    tapering: Literal[False]


class ReferenceStateSpec(ExecutableSpecBase):
    kind: Literal["reference_state"]
    state: Literal["hartree_fock"]
    num_qubits: Literal[4]
    bitstring_qubit0_first: str = Field(pattern=r"^[01]{4}$")


class ParameterSlotDefinition(ExecutableSpecBase):
    slot_id: str = Field(min_length=1, max_length=200)
    generator_id: str = Field(min_length=1, max_length=200)
    initial_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)


class AnsatzDefinitionSpec(ExecutableSpecBase):
    kind: Literal["ansatz_definition"]
    name: Literal["h2_canonical_single_double_excitation"]
    num_qubits: Literal[4]
    generator_id: Literal["double.occ0_occ2.to.virt1_virt3"]
    generator_definition: Literal["fermionic_double_excitation_0_2_to_1_3"]
    generator_convention: Literal["antihermitian_tau_minus_tau_dagger"]
    parameter_orientation: Literal["exp_theta_over_2_generator"]
    generator_order: list[str] = Field(min_length=1, max_length=1)
    trotter_order: Literal[1]
    trotter_steps: Literal[1]
    parameter_sharing: Literal["none"]
    canonical_circuit_id: Literal["h2.double.occ0_occ2.to.virt1_virt3.jw.v1"]
    canonical_circuit_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    parameter_slots: list[ParameterSlotDefinition] = Field(min_length=1, max_length=1)
    expected_parameter_count: Literal[1]

    @model_validator(mode="after")
    def _slot_targets_the_generator(self) -> Self:
        if self.generator_order != [self.generator_id]:
            raise ValueError("generator_order must contain the canonical H2 generator exactly once")
        if self.parameter_slots[0].generator_id != self.generator_id:
            raise ValueError("parameter slot must bind the canonical H2 generator")
        return self


class OperatorPoolSpec(ExecutableSpecBase):
    kind: Literal["operator_pool"]
    name: Literal["h2_singleton_double_pool"]
    generator_ids: list[str] = Field(min_length=1, max_length=1)
    ordering: Literal["canonical_generator_id"]


class SelectionProtocolSpec(ExecutableSpecBase):
    kind: Literal["selection_protocol"]
    mode: Literal["fixed_singleton"]
    scoring: Literal["not_applicable"]


class GrowthProtocolSpec(ExecutableSpecBase):
    kind: Literal["growth_protocol"]
    mode: Literal["fixed_ansatz"]
    batch_size: Literal[1]


class OptimizerSpec(ExecutableSpecBase):
    kind: Literal["optimizer"]
    algorithm: Literal[
        "scipy_minimize_scalar_bounded",
        "scipy_slsqp",
        "scipy_cobyla",
    ]
    provider: Literal["scipy"]
    provider_version: str = Field(min_length=1, max_length=50)
    initial_point_policy: Literal["component_parameter_slot_defaults"]
    lower_bound_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    upper_bound_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    energy_tolerance_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    max_function_evaluations: int = Field(gt=0, le=100_000)
    deterministic: Literal[True]
    initial_trust_region_radius_float64_hex: str | None = Field(
        default=None,
        pattern=FLOAT64_HEX_PATTERN,
    )
    final_trust_region_radius_float64_hex: str | None = Field(
        default=None,
        pattern=FLOAT64_HEX_PATTERN,
    )
    constraint_tolerance_float64_hex: str | None = Field(
        default=None,
        pattern=FLOAT64_HEX_PATTERN,
    )

    @model_validator(mode="after")
    def _algorithm_specific_fields_are_explicit(self) -> Self:
        cobyla_fields = (
            self.initial_trust_region_radius_float64_hex,
            self.final_trust_region_radius_float64_hex,
            self.constraint_tolerance_float64_hex,
        )
        if self.algorithm == "scipy_cobyla":
            if any(value is None for value in cobyla_fields):
                raise ValueError(
                    "COBYLA requires explicit initial/final trust-region radii "
                    "and constraint tolerance"
                )
        elif any(value is not None for value in cobyla_fields):
            raise ValueError("COBYLA-specific settings are forbidden for other optimizers")
        return self


class CompressionProtocolSpec(ExecutableSpecBase):
    kind: Literal["compression_protocol"]
    mode: Literal["none"]


class MeasurementProtocolSpec(ExecutableSpecBase):
    kind: Literal["measurement_protocol"]
    estimator: Literal["exact_statevector"]
    shots: None = None
    grouping: Literal["none_exact_expectation"]
    observable_num_qubits: Literal[4]


class CompilationMetricProtocolSpec(ExecutableSpecBase):
    kind: Literal["compilation_metric_protocol"]
    protocol_id: Literal["majorana.h2.common_cnot_depth.v2"]
    compilation_protocol_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    canonical_circuit_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    input_stage: Literal["canonical_logical_pauli_rotations"]
    primary_resource_stages: list[Literal["canonical_logical", "common_basis_compiled"]]
    diagnostic_resource_stage: Literal["provider_native_diagnostic"]
    logical_block_definition: Literal["canonical_double_excitation_block"]
    parameter_binding: Literal["same_float64_theta_for_all_rotations"]
    basis_gates: list[str] = Field(min_length=5, max_length=5)
    topology: Literal["four_qubit_all_to_all"]
    initial_layout: list[int] = Field(min_length=4, max_length=4)
    routing_policy: Literal["none"]
    optimization_level: Literal[0]
    compiler: Literal["majorana_deterministic_pauli_rotation_compiler"]
    compiler_version: Literal["0.2.0"]
    compiler_seed: Literal[0]
    metric_scope: Literal["ansatz_only"]
    reference_state_inclusion_policy: Literal["excluded"]
    measurement_inclusion_policy: Literal["excluded"]
    hardware_optimization_inclusion_policy: Literal["excluded"]
    depth_definition: Literal["asap_dependency_layers_each_gate_duration_one"]
    cnot_definition: Literal["count_gate_name_cx"]
    expected_common_basis_cnot_count: Literal[48]
    expected_common_basis_depth: Literal[83]


class EvaluationProtocolV2(ExecutableSpecBase):
    kind: Literal["evaluation_protocol"]
    reference: Literal["fci_total_energy_offline_acceptance_only"]
    reference_energy_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    accepted_absolute_error_tolerance_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    fidelity_tolerance_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)


class StoppingProtocolV2(ExecutableSpecBase):
    kind: Literal["stopping_protocol"]
    criterion: Literal["optimizer_bounded_convergence"]
    max_function_evaluations: int = Field(gt=0, le=100_000)
    energy_tolerance_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)


ExecutableComponentSpec = Annotated[
    H2ProblemSpec
    | ElectronicStructurePreparationSpec
    | QubitRepresentationSpec
    | ReferenceStateSpec
    | AnsatzDefinitionSpec
    | OperatorPoolSpec
    | SelectionProtocolSpec
    | GrowthProtocolSpec
    | OptimizerSpec
    | CompressionProtocolSpec
    | MeasurementProtocolSpec
    | CompilationMetricProtocolSpec
    | EvaluationProtocolV2
    | StoppingProtocolV2,
    Field(discriminator="kind"),
]

_EXECUTABLE_ADAPTERS: dict[ComponentType, TypeAdapter[ExecutableComponentSpec]] = {
    role: TypeAdapter(ExecutableComponentSpec) for role in PORTABLE_SCIENTIFIC_ROLES
}

_EXPECTED_MODEL_BY_ROLE = {
    ComponentType.PROBLEM: H2ProblemSpec,
    ComponentType.PROBLEM_PREPARATION: ElectronicStructurePreparationSpec,
    ComponentType.REPRESENTATION: QubitRepresentationSpec,
    ComponentType.REFERENCE_STATE: ReferenceStateSpec,
    ComponentType.ANSATZ: AnsatzDefinitionSpec,
    ComponentType.OPERATOR_POOL: OperatorPoolSpec,
    ComponentType.SEARCH_SELECTION: SelectionProtocolSpec,
    ComponentType.GROWTH_BATCHING: GrowthProtocolSpec,
    ComponentType.PARAMETER_OPTIMIZER: OptimizerSpec,
    ComponentType.COMPRESSION: CompressionProtocolSpec,
    ComponentType.MEASUREMENT: MeasurementProtocolSpec,
    ComponentType.COMPILATION_BACKEND: CompilationMetricProtocolSpec,
    ComponentType.EVALUATION_PROTOCOL: EvaluationProtocolV2,
    ComponentType.STOPPING_PROTOCOL: StoppingProtocolV2,
}


class ExecutableCompositionError(ValueError):
    pass


class H2SemanticSelection(VqeBaseModel):
    """A Definition selection, deliberately free of Registry/runtime identity."""

    role: ComponentType
    component_semantic_key: str = Field(min_length=1, max_length=200)


class ExecutableH2ScientificIdentity(VqeBaseModel):
    """Scientific identity envelope for the bounded H2 executable slice.

    The existing typed component models remain authoritative. This envelope
    only connects their portable digests to the canonical Hamiltonian content
    digest, which the v0.2 problem model intentionally did not carry.
    """

    schema_version: Literal["0.1.0"] = "0.1.0"
    portable_spec: PortableScientificExperimentSpec
    hamiltonian_digest_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    reference_energy_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)


H2_BASELINE_SEMANTIC_KEYS: dict[ComponentType, str] = {
    ComponentType.PROBLEM: "problem.h2.sto3g.v1",
    ComponentType.PROBLEM_PREPARATION: "preparation.pyscf.rhf.v1",
    ComponentType.REPRESENTATION: "mapping.jordan_wigner.v1",
    ComponentType.REFERENCE_STATE: "reference.hartree_fock.v1",
    ComponentType.ANSATZ: "ansatz.h2.fixed_excitation.v1",
    ComponentType.OPERATOR_POOL: "pool.h2.singleton_double.v1",
    ComponentType.SEARCH_SELECTION: "search.fixed.none.v1",
    ComponentType.GROWTH_BATCHING: "growth.fixed_singleton.v1",
    ComponentType.PARAMETER_OPTIMIZER: "optimizer.scipy_bounded_scalar.v1",
    ComponentType.COMPRESSION: "compression.none.v1",
    ComponentType.MEASUREMENT: "measurement.exact_statevector.v1",
    ComponentType.COMPILATION_BACKEND: "compilation.canonical_logical.v2",
    ComponentType.EVALUATION_PROTOCOL: "evaluation.exact_reference.v1",
    ComponentType.STOPPING_PROTOCOL: "stopping.optimizer_convergence.v1",
}
H2_SLSQP_SEMANTIC_KEYS: dict[ComponentType, str] = {
    **H2_BASELINE_SEMANTIC_KEYS,
    ComponentType.PARAMETER_OPTIMIZER: "optimizer.slsqp.v1",
}
H2_COBYLA_SEMANTIC_KEYS: dict[ComponentType, str] = {
    **H2_BASELINE_SEMANTIC_KEYS,
    ComponentType.PARAMETER_OPTIMIZER: "optimizer.cobyla.v1",
}
H2_SUPPORTED_SEMANTIC_KEY_SETS = (
    H2_BASELINE_SEMANTIC_KEYS,
    H2_SLSQP_SEMANTIC_KEYS,
    H2_COBYLA_SEMANTIC_KEYS,
)


def parse_executable_component(
    component_type: ComponentType,
    spec_json: dict[str, object],
) -> ExecutableComponentSpec:
    if component_type not in _EXECUTABLE_ADAPTERS:
        raise ExecutableCompositionError(
            f"component_type={component_type.value} is not executable by the H2 capability"
        )
    parsed = _EXECUTABLE_ADAPTERS[component_type].validate_python(spec_json)
    expected_model = _EXPECTED_MODEL_BY_ROLE[component_type]
    if not isinstance(parsed, expected_model):
        raise ExecutableCompositionError(
            f"component_type={component_type.value} requires {expected_model.__name__}, "
            f"got {type(parsed).__name__}"
        )
    return parsed


class ExecutableH2Workflow(VqeBaseModel):
    problem: H2ProblemSpec
    problem_preparation: ElectronicStructurePreparationSpec
    representation: QubitRepresentationSpec
    reference_state: ReferenceStateSpec
    ansatz: AnsatzDefinitionSpec
    operator_pool: OperatorPoolSpec
    selection: SelectionProtocolSpec
    growth: GrowthProtocolSpec
    optimizer: OptimizerSpec
    compression: CompressionProtocolSpec
    measurement: MeasurementProtocolSpec
    compilation: CompilationMetricProtocolSpec
    evaluation: EvaluationProtocolV2
    stopping: StoppingProtocolV2

    @model_validator(mode="after")
    def _cross_component_invariants_hold(self) -> Self:
        if self.reference_state.bitstring_qubit0_first.count("1") != self.problem.active_electrons:
            raise ValueError("reference-state occupation does not match active_electrons")
        if self.representation.num_qubits != self.problem.spin_orbitals:
            raise ValueError("representation width does not match problem spin orbitals")
        if self.ansatz.num_qubits != self.representation.num_qubits:
            raise ValueError("ansatz width does not match representation")
        if self.measurement.observable_num_qubits != self.representation.num_qubits:
            raise ValueError("measurement width does not match representation")
        if self.operator_pool.generator_ids != [self.ansatz.generator_id]:
            raise ValueError("operator pool and ansatz generator definitions disagree")
        if self.compilation.canonical_circuit_sha256 != self.ansatz.canonical_circuit_sha256:
            raise ValueError("ansatz and compilation canonical circuit digests disagree")
        if self.optimizer.max_function_evaluations != self.stopping.max_function_evaluations:
            raise ValueError("optimizer and stopping evaluation budgets disagree")
        if (
            self.optimizer.energy_tolerance_float64_hex
            != self.stopping.energy_tolerance_float64_hex
        ):
            raise ValueError("optimizer and stopping energy tolerances disagree")
        return self


def validate_h2_executable_composition(
    specs: dict[ComponentType, dict[str, object]],
) -> ExecutableH2Workflow:
    expected = set(PORTABLE_SCIENTIFIC_ROLES)
    missing = expected - set(specs)
    extra = set(specs) - expected
    if missing or extra:
        raise ExecutableCompositionError(
            "H2 executable composition role mismatch; "
            f"missing={sorted(role.value for role in missing)}, "
            f"extra={sorted(role.value for role in extra)}"
        )
    parsed = {
        role: parse_executable_component(role, spec_json) for role, spec_json in specs.items()
    }
    return ExecutableH2Workflow(
        problem=parsed[ComponentType.PROBLEM],
        problem_preparation=parsed[ComponentType.PROBLEM_PREPARATION],
        representation=parsed[ComponentType.REPRESENTATION],
        reference_state=parsed[ComponentType.REFERENCE_STATE],
        ansatz=parsed[ComponentType.ANSATZ],
        operator_pool=parsed[ComponentType.OPERATOR_POOL],
        selection=parsed[ComponentType.SEARCH_SELECTION],
        growth=parsed[ComponentType.GROWTH_BATCHING],
        optimizer=parsed[ComponentType.PARAMETER_OPTIMIZER],
        compression=parsed[ComponentType.COMPRESSION],
        measurement=parsed[ComponentType.MEASUREMENT],
        compilation=parsed[ComponentType.COMPILATION_BACKEND],
        evaluation=parsed[ComponentType.EVALUATION_PROTOCOL],
        stopping=parsed[ComponentType.STOPPING_PROTOCOL],
    )


def executable_component_scientific_payload(
    component_type: ComponentType,
    spec: ExecutableComponentSpec,
) -> dict[str, object]:
    """Project a typed Component spec onto scientific, provider-neutral data.

    Provider/package versions belong to an Implementation Binding. They must
    not change the scientific digest of otherwise identical preparation or
    optimizer semantics.
    """

    payload = spec.model_dump(mode="json")
    payload.pop("schema_version", None)
    if component_type in (
        ComponentType.PROBLEM_PREPARATION,
        ComponentType.PARAMETER_OPTIMIZER,
    ):
        payload.pop("provider", None)
        payload.pop("provider_version", None)
    return payload


def build_h2_scientific_identity(
    *,
    selections: Iterable[H2SemanticSelection],
    specs: dict[ComponentType, dict[str, object]],
    hamiltonian_digest_sha256: str,
    seed: int = 0,
) -> ExecutableH2ScientificIdentity:
    """Validate and canonicalize one H2 Definition composition.

    This is the fail-closed legacy-seed-to-typed-payload bridge. Unknown,
    duplicate, missing, or role-mismatched seed entries are never defaulted.
    """

    selected: dict[ComponentType, str] = {}
    for selection in selections:
        if selection.role in selected:
            raise ExecutableCompositionError(
                f"duplicate semantic selection role={selection.role.value}"
            )
        selected[selection.role] = selection.component_semantic_key
    if selected not in H2_SUPPORTED_SEMANTIC_KEY_SETS:
        missing = set(H2_BASELINE_SEMANTIC_KEYS) - set(selected)
        extra = set(selected) - set(H2_BASELINE_SEMANTIC_KEYS)
        mismatched = sorted(
            role.value
            for role in set(selected) & set(H2_BASELINE_SEMANTIC_KEYS)
            if selected[role] != H2_BASELINE_SEMANTIC_KEYS[role]
        )
        raise ExecutableCompositionError(
            "unsupported H2 semantic selection set; "
            f"missing={sorted(role.value for role in missing)}, "
            f"extra={sorted(role.value for role in extra)}, "
            f"mismatched={mismatched}"
        )

    workflow = validate_h2_executable_composition(specs)
    bindings: list[ComponentSemanticBinding] = []
    for role in PORTABLE_SCIENTIFIC_ROLES:
        parsed = parse_executable_component(role, specs[role])
        scientific_payload = executable_component_scientific_payload(role, parsed)
        bindings.append(
            ComponentSemanticBinding(
                role=role,
                component_type=role,
                component_semantic_key=selected[role],
                component_spec_sha256=normalized_component_spec_digest(
                    component_type=role,
                    spec_json=scientific_payload,
                ),
            )
        )

    parameter_slots = [
        ParameterSlotValue(slot_id=slot.slot_id, float64_hex=slot.initial_float64_hex)
        for slot in workflow.ansatz.parameter_slots
    ]
    portable_spec = PortableScientificExperimentSpec(
        workflow_semantic_digest=workflow_semantic_digest(bindings),
        component_bindings=bindings,
        dataset_snapshot_sha256=workflow.problem.dataset_snapshot_sha256,
        initial_parameter_slots=parameter_slots,
        seed=seed,
    )
    return ExecutableH2ScientificIdentity(
        portable_spec=portable_spec,
        hamiltonian_digest_sha256=hamiltonian_digest_sha256,
        reference_energy_float64_hex=workflow.evaluation.reference_energy_float64_hex,
    )


def executable_h2_scientific_identity_digest(
    identity: ExecutableH2ScientificIdentity,
) -> str:
    encoded = json.dumps(
        identity.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_h2_executable_component_specs(
    fixture_path: Path,
) -> dict[ComponentType, dict[str, object]]:
    """Read the legacy seed fixture without inventing missing role payloads."""

    raw = json.loads(fixture_path.read_text())
    if not isinstance(raw, dict):
        raise ExecutableCompositionError("H2 executable component fixture must be an object")
    if any(not isinstance(value, dict) for value in raw.values()):
        raise ExecutableCompositionError("every H2 component payload must be an object")
    try:
        return {ComponentType(role): value for role, value in raw.items()}
    except ValueError as exc:
        raise ExecutableCompositionError("fixture contains an unknown component role") from exc
