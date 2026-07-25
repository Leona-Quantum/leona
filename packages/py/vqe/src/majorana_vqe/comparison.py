"""Comparison dimension model (plan Part III §14).

`classify_comparison()` is an MVP heuristic, not a claim of scientific
ground truth -- the plan is explicit that the first curated comparison
reports (Phase 2/4) are human-authored gold, and this function "自動判定を
装ってはならない" (must not be dressed up as automatic judgment). It exists
so the schema has *a* deterministic, testable default and so later phases
have something concrete to validate or override against real curated
reports, not because Phase 1 is asserting it is correct VQE-comparison
methodology.
"""

from __future__ import annotations

from enum import Enum
from typing import Self

from pydantic import Field, model_validator

from .models import SCHEMA_VERSION, VqeBaseModel, reject_path_module_or_code


class ComparisonDimensionName(str, Enum):
    """The fixed set of dimensions a comparison must address before
    producing a classification (plan Part III §14: "比較は次を固定してから
    行う"). Closed set -- a comparison that can't be expressed in these
    dimensions is exactly the "比較不能理由の明示" case the MVP requires,
    not a reason to add an ad hoc dimension."""

    PROBLEM_DIGEST = "problem_digest"
    PROBLEM_PREPARATION = "problem_preparation"
    BASIS_ACTIVE_SPACE = "basis_active_space"
    HAMILTONIAN_DIGEST_OR_EQUIVALENCE = "hamiltonian_digest_or_equivalence"
    MAPPING = "mapping"
    QUBIT_WIRE_ORDER = "qubit_wire_order"
    REFERENCE_STATE = "reference_state"
    ANSATZ_SEMANTIC_DEFINITION = "ansatz_semantic_definition"
    OPERATOR_POOL = "operator_pool"
    OPERATOR_POOL_ORDERING = "operator_pool_ordering"
    SEARCH_SCORING = "search_scoring"
    SELECTION_RULE = "selection_rule"
    GROWTH_BATCHING = "growth_batching"
    COMPRESSION = "compression"
    INITIAL_POINT = "initial_point"
    OPTIMIZER_CONFIGURATION = "optimizer_configuration"
    GRADIENT_ESTIMATOR = "gradient_estimator"
    SEED = "seed"
    ESTIMATOR = "estimator"
    MEASUREMENT_GROUPING = "measurement_grouping"
    SHOT_ALLOCATION = "shot_allocation"
    MEASUREMENT_COST_MODEL = "measurement_cost_model"
    STOPPING_RULE = "stopping_rule"
    METRIC_STAGE = "metric_stage"
    COMPILATION_PROTOCOL = "compilation_protocol"
    BACKEND_NOISE = "backend_noise"
    DATASET = "dataset"
    TRAINING_SPLIT = "training_split"
    LEARNED_MODEL_CHECKPOINT = "learned_model_checkpoint"


# Dimensions whose mismatch makes a comparison INVALID outright (the two
# workflows are not solving the same problem, or their Hamiltonians are not
# known to be equivalent) rather than merely CONTROLLED/PARTIAL.
_BLOCKING_DIMENSIONS = frozenset(
    {
        ComparisonDimensionName.PROBLEM_DIGEST,
        ComparisonDimensionName.HAMILTONIAN_DIGEST_OR_EQUIVALENCE,
    }
)


class ComparisonDimensionStatus(str, Enum):
    FIXED = "fixed"
    CHANGED = "changed"
    UNKNOWN = "unknown"
    NOT_APPLICABLE = "not_applicable"


class ComparisonClassification(str, Enum):
    STRICT = "strict"
    CONTROLLED = "controlled"
    PARTIAL = "partial"
    INVALID = "invalid"


class ComparisonDimension(VqeBaseModel):
    name: ComparisonDimensionName
    status: ComparisonDimensionStatus
    detail: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _detail_is_a_safe_label(self) -> Self:
        if self.detail is not None:
            reject_path_module_or_code(self.detail, field_path="detail")
        return self


class ComparisonResult(VqeBaseModel):
    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    dimensions: list[ComparisonDimension] = Field(min_length=1)
    classification: ComparisonClassification

    @model_validator(mode="after")
    def _covers_every_fixed_dimension_exactly_once(self) -> Self:
        names = [d.name for d in self.dimensions]
        if len(names) != len(set(names)):
            raise ValueError("duplicate ComparisonDimensionName in dimensions")
        missing = set(ComparisonDimensionName) - set(names)
        if missing:
            raise ValueError(
                f"comparison must address every fixed dimension; missing: {sorted(m.value for m in missing)}"
            )
        return self


def classify_comparison(dimensions: list[ComparisonDimension]) -> ComparisonClassification:
    """MVP heuristic (see module docstring for its limits):

    - INVALID   if a blocking dimension (problem identity / Hamiltonian
                equivalence) is CHANGED -- not the same physical problem.
    - STRICT    if every dimension is FIXED.
    - PARTIAL   if any dimension is UNKNOWN (plan: "unknown fieldがある場合は
                strictにしない" -- unknown must never upgrade to strict, and
                is treated here as weaker than a known CHANGED).
    - CONTROLLED otherwise (no UNKNOWN, no blocking CHANGED, but >=1
                non-blocking CHANGED).
    """
    by_name = {d.name: d for d in dimensions}
    for blocking_name in _BLOCKING_DIMENSIONS:
        dim = by_name.get(blocking_name)
        if dim is not None and dim.status is ComparisonDimensionStatus.CHANGED:
            return ComparisonClassification.INVALID

    statuses = [d.status for d in dimensions]
    if any(s is ComparisonDimensionStatus.UNKNOWN for s in statuses):
        return ComparisonClassification.PARTIAL
    if all(
        s in (ComparisonDimensionStatus.FIXED, ComparisonDimensionStatus.NOT_APPLICABLE)
        for s in statuses
    ):
        return ComparisonClassification.STRICT
    return ComparisonClassification.CONTROLLED
