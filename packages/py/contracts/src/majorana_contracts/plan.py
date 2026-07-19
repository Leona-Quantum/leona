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
    VerificationMethod,
)


class _PlanBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


# Key names that promise a measurement distribution in the result dict, and so
# can satisfy a statistical check. The first four mirror
# majorana_verification.methods._COUNTS_FALLBACK_KEYS — the names extract_counts
# looks under after the plan's own keys. They are duplicated rather than imported
# because verification depends on contracts, not the other way round;
# packages/py/verification/tests pins the two lists against drift.
_DISTRIBUTION_KEY_NAMES = frozenset({"counts", "measurement_counts", "results", "samples"})
_DISTRIBUTION_KEY_TOKENS = ("counts", "distribution", "histogram", "probabilities")


def _promises_distribution(key: str) -> bool:
    """Whether an expected_output_key names a measurement distribution.

    Name-based by necessity: at plan time there is no result dict to inspect, only
    the keys the plan promises to print.
    """
    normalized = key.strip().lower()
    if normalized in _DISTRIBUTION_KEY_NAMES:
        return True
    return any(token in normalized for token in _DISTRIBUTION_KEY_TOKENS)


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
    methods: list[VerificationMethod] = Field(
        min_length=1,
        description="Verification primitives to run against the generated code",
        # Narrow the *schema* the planner decodes against without narrowing the
        # runtime type: the worker's dispatch loop compares these with `is`
        # against VerificationMethod members, and a member of a different enum —
        # even one with an equal value — would fail every identity check and
        # report every result as "required evidence unavailable".
        json_schema_extra={
            "items": {"enum": [method.value for method in PlannableVerificationMethod]}
        },
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
        # Return VerificationMethod members, never PlannableVerificationMethod
        # ones — see the json_schema_extra note above.
        kept = [VerificationMethod(item) for item in value if str(item) in plannable]
        if kept or not value:
            # A genuinely empty list is still a contract violation; min_length
            # rejects it. Only a list emptied by normalization gets a fallback.
            return kept
        # Everything the planner asked for was retired; fall back to the contract
        # check that runs unconditionally anyway rather than emitting an empty list.
        return [VerificationMethod.RETURN_CONTRACT]


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

    @model_validator(mode="after")
    def _statistical_needs_distribution_evidence(self) -> "Plan":
        """Reject a plan that asks for a statistical check it cannot possibly satisfy.

        The statistical method compares two measurement-count dicts pulled out of the
        result by extract_counts. When expected_output_keys promises only scalars —
        a 2026-07-20 production QAOA run promised optimal_cut/qaoa_cut/
        approximation_ratio — there is no distribution to extract, so the check
        reports "required evidence unavailable" and fails.

        That failure is a property of the plan, not of the code, so it reproduces
        identically on every regenerated candidate: the repair loop cannot converge
        and the run dies with candidate_budget_exhausted after burning the whole
        budget. Raising here costs one planner re-emit instead.

        Deliberately a hard error rather than the silent normalization used above for
        retired methods: those were dead fields nothing read, whereas dropping
        statistical would quietly delete a verification the plan asked for, which is
        exactly the fail-closed guarantee the verifier exists to make.
        """
        methods = self.verification_plan.methods if self.verification_plan else []
        if VerificationMethod.STATISTICAL not in methods:
            return self
        if any(_promises_distribution(key) for key in self.expected_output_keys):
            return self
        raise ValueError(
            "verification_plan.methods includes 'statistical', which compares two "
            "measurement-count distributions, but expected_output_keys "
            f"({', '.join(self.expected_output_keys)}) promises no distribution. "
            "Either add the result key holding the raw {bitstring: count} mapping "
            "(e.g. 'counts') to expected_output_keys, or drop 'statistical' and "
            "verify the scalars some other way."
        )
