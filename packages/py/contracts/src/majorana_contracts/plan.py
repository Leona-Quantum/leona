"""Plan model — the planner LLM's structured output, verified before execution.
Modernized from the legacy nameko plan-schema (Archive); qubit ceiling is the
27-qubit default sandbox lane (memory/DECISIONS.md 2026-07-09)."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .enums import (
    Algorithm,
    ArtifactType,
    Framework,
    MeasurementPolicy,
    Optimizer,
    PlannableVerificationMethod,
    TopLevelExecution,
)


class _PlanBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SuccessCriteria(_PlanBase):
    primary_metric: str = Field(
        description="Key extracted from the run's result dict, e.g. ground_state_energy_Ha"
    )
    expected_range: dict[str, float] | None = Field(
        default=None,
        description=(
            "Bound on primary_metric's value, checked with the literal keys "
            '"min" and/or "max", e.g. {"min": 0.99} or {"min": 0.0, "max": 0.15}. '
            "Either key may be omitted to leave that side unbounded; any other "
            "key is ignored by the evaluator, so do not invent named bounds."
        ),
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
    methods: list[PlannableVerificationMethod] = Field(
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

    @field_validator("methods", mode="before")
    @classmethod
    def _drop_unplannable_methods(cls, value: Any) -> Any:
        """Silently discard retired methods instead of failing the whole run.

        Nothing downstream reads them — the worker's dispatch loop only branches on
        return_contract and statistical, and every other value falls through to an
        automatic "required evidence unavailable" failure. A planner that asks for
        one anyway (or a stored plan from before they were retired) is normalized
        here rather than raising, which is what dead-lettered 11 of 12 failed jobs.
        """
        if not isinstance(value, list):
            return value
        plannable = {method.value for method in PlannableVerificationMethod}
        kept = [item for item in value if str(item) in plannable]
        if kept or not value:
            # A genuinely empty list is still a contract violation; min_length
            # rejects it. Only a list emptied by normalization gets a fallback.
            return kept
        # Everything the planner asked for was retired; fall back to the contract
        # check that runs unconditionally anyway rather than emitting an empty list.
        return [PlannableVerificationMethod.RETURN_CONTRACT]


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

    @model_validator(mode="before")
    @classmethod
    def _drop_retired_baseline_plan(cls, value: Any) -> Any:
        """Accept and discard a `baseline_plan` the planner should not have sent.

        The field is no longer part of the schema the model is shown, and no code
        ever consumed it. Because the model config is extra="forbid", a planner that
        emits it regardless would otherwise fail validation and kill the run, so it
        is dropped here instead.
        """
        if isinstance(value, dict) and "baseline_plan" in value:
            value = {key: item for key, item in value.items() if key != "baseline_plan"}
        return value
