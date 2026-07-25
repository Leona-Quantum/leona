"""Capability-specific immutable execution evidence contracts.

Success is not a generic status bit.  Each capability has a discriminated
success payload whose scientifically necessary fields are mandatory.
"""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import Field, TypeAdapter, model_validator

from .models import (
    JSONValue,
    SHA256_HEX_PATTERN,
    FailureCode,
    Framework,
    TrajectoryOverflowRef,
    VqeBaseModel,
    walk_and_validate_json_value,
)
from .portable import FLOAT64_HEX_PATTERN


class EvidenceCommon(VqeBaseModel):
    schema_version: Literal["0.2.0"] = "0.2.0"
    scientific_spec_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    registry_resolution_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    framework: Framework
    runtime_profile_id: str = Field(min_length=1, max_length=200)
    runtime_image_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    adapter_release_id: str = Field(min_length=1, max_length=200)
    provider_versions: dict[str, str] = Field(min_length=1, max_length=32)
    hamiltonian_exact_digest: str = Field(pattern=SHA256_HEX_PATTERN)
    seed: int = Field(ge=0)


class ResourceObservation(VqeBaseModel):
    stage: Literal["logical", "synthesized", "compiled", "routed"]
    metric_protocol_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    qubits: int = Field(ge=0)
    depth: int | None = Field(default=None, ge=0)
    gate_count: int | None = Field(default=None, ge=0)
    two_qubit_gate_count: int | None = Field(default=None, ge=0)
    parameter_count: int = Field(ge=0)
    basis_gates: list[str] | None = Field(default=None, max_length=50)
    compiler: str | None = Field(default=None, max_length=100)
    compiler_version: str | None = Field(default=None, max_length=50)
    compiler_seed: int | None = Field(default=None, ge=0)


class ExecutionFailureResult(EvidenceCommon):
    status: Literal["failed"]
    result_kind: Literal["execution_failure"] = "execution_failure"
    failure_code: FailureCode
    failure_detail: str = Field(min_length=1, max_length=500)


class ExactEnergySuccessResult(EvidenceCommon):
    status: Literal["succeeded"]
    result_kind: Literal["exact_energy_success"] = "exact_energy_success"
    capability: Literal["h2_sto3g_exact_energy"]
    exact_energy_ha: float
    reference_energy_ha: float
    absolute_error_ha: float = Field(ge=0)
    qubits: int = Field(gt=0)
    reference_convention: str = Field(min_length=1, max_length=200)


class ParameterValue(VqeBaseModel):
    slot_id: str = Field(min_length=1, max_length=200)
    float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)


class OptimizerWork(VqeBaseModel):
    iterations: int = Field(ge=0)
    energy_evaluations: int = Field(ge=0)
    gradient_evaluations: int = Field(ge=0)
    hessian_evaluations: int = Field(ge=0)


class VqeOptimizationSuccessResult(EvidenceCommon):
    status: Literal["succeeded"]
    result_kind: Literal["vqe_optimization_success"] = "vqe_optimization_success"
    capability: Literal["h2_sto3g_actual_vqe_v1"]
    best_energy_ha: float
    reference_energy_ha: float
    absolute_error_ha: float = Field(ge=0)
    final_state_fidelity: float = Field(ge=0, le=1)
    converged: bool
    optimizer_work: OptimizerWork
    initial_parameters: list[ParameterValue] = Field(min_length=1, max_length=256)
    final_parameters: list[ParameterValue] = Field(min_length=1, max_length=256)
    initial_parameters_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    final_parameters_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    ansatz_semantic_digest: str = Field(pattern=SHA256_HEX_PATTERN)
    energy_trajectory: list[float] | None = Field(default=None, min_length=1, max_length=200)
    energy_trajectory_overflow: TrajectoryOverflowRef | None = None
    resources: list[ResourceObservation] = Field(min_length=1, max_length=4)
    supplementary_evidence: JSONValue | None = None

    @model_validator(mode="after")
    def _success_evidence_is_complete(self) -> Self:
        if self.energy_trajectory is None and self.energy_trajectory_overflow is None:
            raise ValueError("VQE success requires an inline or external energy trajectory")
        if self.energy_trajectory is not None and self.energy_trajectory_overflow is not None:
            raise ValueError("inline and external energy trajectories are mutually exclusive")
        initial_slots = [parameter.slot_id for parameter in self.initial_parameters]
        final_slots = [parameter.slot_id for parameter in self.final_parameters]
        if initial_slots != final_slots:
            raise ValueError("initial and final parameter slot order must match")
        stages = [resource.stage for resource in self.resources]
        if len(stages) != len(set(stages)):
            raise ValueError("duplicate resource observation stage")
        if "logical" not in stages:
            raise ValueError("VQE success requires logical resource metrics")
        if self.supplementary_evidence is not None:
            walk_and_validate_json_value(
                self.supplementary_evidence,
                field_path="supplementary_evidence",
            )
        return self


ExecutionEvidence = Annotated[
    ExecutionFailureResult | ExactEnergySuccessResult | VqeOptimizationSuccessResult,
    Field(discriminator="result_kind"),
]
EXECUTION_EVIDENCE_ADAPTER = TypeAdapter(ExecutionEvidence)
