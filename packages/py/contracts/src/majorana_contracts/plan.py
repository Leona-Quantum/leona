"""Plan model — the planner LLM's structured output, verified before execution.
Modernized from the legacy nameko plan-schema (Archive); qubit ceiling is the
27-qubit default sandbox lane (memory/DECISIONS.md 2026-07-09)."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .enums import (
    Algorithm,
    ArtifactType,
    BaselineKind,
    Framework,
    MeasurementPolicy,
    Optimizer,
    TopLevelExecution,
    VerificationMethod,
)


class _PlanBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SuccessCriteria(_PlanBase):
    primary_metric: str = Field(
        description="Key extracted from the run's result dict, e.g. ground_state_energy_Ha"
    )
    expected_range: dict[str, float] | None = Field(
        default=None, description="Acceptable {min, max} range for primary_metric"
    )
    additional_notes: list[str] | None = None


class PlanParameters(_PlanBase):
    shots: int | None = Field(default=None, ge=1, le=20000)
    optimizer: Optimizer | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=500)
    custom: dict[str, Any] | None = Field(
        default=None,
        description="Domain-specific free parameters, e.g. {molecule: 'H2', bond_length: 0.735}",
    )


class ArtifactContract(_PlanBase):
    artifact_type: ArtifactType
    entry_point: str | None = Field(
        default=None, description="Function/class name to implement, if requested"
    )
    expected_return_type: str | None = Field(
        default=None, description="e.g. QuantumCircuit, dict[str, int], Statevector"
    )
    return_shape: str | None = Field(
        default=None, description="Structural constraints: keys, array length, bitstring format"
    )
    measurement_policy: MeasurementPolicy
    top_level_execution: TopLevelExecution


class VerificationPlan(_PlanBase):
    methods: list[VerificationMethod] = Field(
        min_length=1, description="Verification primitives to run against the generated code"
    )
    expected_metrics: list[str] | None = Field(
        default=None, description="Metrics the verification result dict must contain"
    )
    thresholds: dict[str, float] | None = Field(
        default=None, description="Pass thresholds per metric, e.g. {fidelity_min: 0.999}"
    )
    reference_method: str | None = Field(
        default=None, description="Independent reference, e.g. exact diagonalization"
    )
    feedback_policy: str | None = Field(
        default=None, description="What to minimally fix and re-verify on failure"
    )
    forbidden_operations: list[str] | None = Field(
        default=None, description="APIs/side effects the code must not use"
    )
    required_invariants: list[str] | None = Field(
        default=None, description="Invariants that must survive any repair iteration"
    )


class BaselinePlan(_PlanBase):
    kind: BaselineKind
    reason: str = Field(
        min_length=3, description="Why this classical baseline applies, or why none does"
    )


class Plan(_PlanBase):
    domain: str = Field(min_length=2, description="Problem domain: chemistry, finance, ...")
    framework: Framework
    algorithm: Algorithm
    problem_summary: str = Field(min_length=5)
    algorithm_rationale: str = Field(min_length=5)
    parameters: PlanParameters
    qubits_estimate: int = Field(
        ge=1, le=27, description="Planned qubit count; 27 is the default sandbox lane ceiling"
    )
    expected_runtime_sec: int = Field(ge=1, le=300)
    success_criteria: SuccessCriteria
    expected_output_keys: list[str] = Field(
        min_length=1, description="Keys the executed code prints in its result dict"
    )
    artifact_contract: ArtifactContract | None = None
    verification_plan: VerificationPlan | None = None
    baseline_plan: BaselinePlan | None = None
