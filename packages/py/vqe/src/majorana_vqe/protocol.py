"""EvaluationProtocol v0.1 and StoppingProtocol -- typed content models for
the `spec_json` payload of ComponentSpecs whose `component_type` is
`evaluation_protocol` or `stopping_protocol`. Kept
separate from the generic, storage-shaped ComponentSpec.spec_json
(`dict[str, JSONValue]`) in models.py so callers that care about evaluation-
protocol semantics get real typed validation instead of hand-rolled dict
access.
"""

from __future__ import annotations

from enum import Enum
from typing import Self

from pydantic import Field, model_validator

from .models import SCHEMA_VERSION, ComponentSpec, ComponentType, EvidenceStage, VqeBaseModel


class EvaluationProtocol(VqeBaseModel):
    """What kind of evidence a result represents and, for finite-shot
    evidence, how many shots. ADR-0025: finite-shot is never by itself
    sufficient for a scientific pass condition -- enforced downstream by
    whatever consumes `estimator`, not by this model (this model only
    records what was asked for)."""

    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    estimator: EvidenceStage
    shots: int | None = Field(default=None, gt=0)
    exact_diagonalization_tolerance_ha: float | None = Field(default=None, gt=0)
    vqe_accepted_tolerance_ha: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _shots_matches_estimator(self) -> Self:
        if self.estimator is EvidenceStage.FINITE_SHOT and self.shots is None:
            raise ValueError("estimator=finite_shot requires an explicit shots count")
        if self.estimator is EvidenceStage.EXACT and self.shots is not None:
            raise ValueError("shots is only meaningful for the finite_shot estimator")
        return self


class StoppingCriterion(str, Enum):
    MAX_ITERATIONS = "max_iterations"
    ENERGY_CONVERGENCE = "energy_convergence"
    GRADIENT_NORM = "gradient_norm"


class StoppingProtocol(VqeBaseModel):
    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    criterion: StoppingCriterion
    max_iterations: int | None = Field(default=None, gt=0)
    energy_convergence_tolerance_ha: float | None = Field(default=None, gt=0)
    gradient_norm_tolerance: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _threshold_matches_criterion(self) -> Self:
        required_field = {
            StoppingCriterion.MAX_ITERATIONS: "max_iterations",
            StoppingCriterion.ENERGY_CONVERGENCE: "energy_convergence_tolerance_ha",
            StoppingCriterion.GRADIENT_NORM: "gradient_norm_tolerance",
        }[self.criterion]
        if getattr(self, required_field) is None:
            raise ValueError(f"criterion={self.criterion.value} requires {required_field}")
        return self


class ComponentTypeMismatchError(ValueError):
    pass


def parse_evaluation_protocol(component: ComponentSpec) -> EvaluationProtocol:
    """Validate `component.spec_json` as an EvaluationProtocol, refusing to
    parse a component that isn't actually typed `evaluation_protocol` --
    catches the class of bug where the wrong ArtifactVersion is wired into a
    workflow's evaluation-protocol role."""
    if component.component_type is not ComponentType.EVALUATION_PROTOCOL:
        raise ComponentTypeMismatchError(
            f"expected component_type=evaluation_protocol, got {component.component_type.value}"
        )
    return EvaluationProtocol.model_validate(component.spec_json)


def parse_stopping_protocol(component: ComponentSpec) -> StoppingProtocol:
    """Parse an independently versioned stopping rule (ADR-0028).

    Stopping rules are comparison-critical: changing a gradient threshold or
    iteration cap can change both accuracy and resource cost. Keeping them as
    their own ArtifactVersion prevents an evaluation/measurement protocol
    revision from silently changing convergence semantics.
    """
    if component.component_type is not ComponentType.STOPPING_PROTOCOL:
        raise ComponentTypeMismatchError(
            f"expected component_type=stopping_protocol, got {component.component_type.value}"
        )
    return StoppingProtocol.model_validate(component.spec_json)
