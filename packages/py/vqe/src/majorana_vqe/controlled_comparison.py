"""Typed plan/result split for one-component VQE comparisons."""

from __future__ import annotations

from enum import Enum
from typing import Self
from uuid import UUID

from pydantic import Field, model_validator

from .models import ComponentType, VqeBaseModel

SHA256_PATTERN = r"^[0-9a-f]{64}$"


class ControlledComparisonStatus(str, Enum):
    PLANNED = "planned"
    RUNNING = "running"
    COMPARABLE = "comparable"
    COMPARABILITY_FAILED = "comparability_failed"
    INCONCLUSIVE = "inconclusive"
    FAILED = "failed"


class ControlledComparisonSpecV1(VqeBaseModel):
    schema_version: str = "1.0.0"
    baseline_workflow_artifact_version_id: UUID
    candidate_workflow_artifact_version_id: UUID
    changed_role: ComponentType
    fixed_component_digests: dict[ComponentType, str] = Field(min_length=1)
    baseline_configuration: dict[str, str] = Field(default_factory=dict, max_length=32)
    candidate_configuration: dict[str, str] = Field(default_factory=dict, max_length=32)
    metric_protocol_sha256: str = Field(pattern=SHA256_PATTERN)
    budget_protocol_sha256: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def _single_role_contract(self) -> Self:
        if self.changed_role in self.fixed_component_digests:
            raise ValueError("changed_role cannot also be declared fixed")
        if (
            self.baseline_workflow_artifact_version_id
            == self.candidate_workflow_artifact_version_id
        ):
            raise ValueError("comparison requires distinct immutable Workflow versions")
        if self.baseline_configuration == self.candidate_configuration:
            raise ValueError("comparison configurations must expose the component change")
        return self


class ControlledComparisonRunV1(VqeBaseModel):
    schema_version: str = "1.0.0"
    comparison_spec_id: UUID
    baseline_execution_id: UUID
    candidate_execution_id: UUID
    status: ControlledComparisonStatus
    invariant_audit: dict[str, bool] = Field(min_length=1, max_length=64)
    metric_observations: dict[str, object] = Field(default_factory=dict, max_length=128)
    terminal_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _status_matches_audit(self) -> Self:
        all_invariants_hold = all(self.invariant_audit.values())
        if self.status is ControlledComparisonStatus.COMPARABLE:
            if not all_invariants_hold:
                raise ValueError("comparable result requires every invariant to hold")
            if self.terminal_reason is not None:
                raise ValueError("comparable result cannot carry a terminal reason")
        elif self.status is ControlledComparisonStatus.COMPARABILITY_FAILED:
            if all_invariants_hold:
                raise ValueError("comparability_failed requires a failed invariant")
            if not self.terminal_reason:
                raise ValueError("comparability_failed requires a terminal reason")
        return self
