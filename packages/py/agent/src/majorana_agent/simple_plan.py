"""Small LLM-facing plan contract for the fixed circuit pipeline.

The durable repository still stores the historical ``majorana_contracts.Plan`` so
old runs remain readable.  The model must not author that legacy object directly:
it carries strict-verifier fields and cross-field validators that the simple path
does not use.  This module is the intentionally smaller translation boundary.
"""

from __future__ import annotations

import json
from typing import Any

from majorana_contracts.enums import Algorithm, Framework, Optimizer
from majorana_contracts.plan import Plan, PlanParameters, SuccessCriteria
from majorana_llm import StageOutputError, extract_json
from pydantic import BaseModel, ConfigDict, Field


class _SimplePlanModel(BaseModel):
    # Zod objects in namekoQ strip unknown keys by default.  Matching that behavior
    # keeps a harmless legacy field from killing a run while every consumed field
    # remains typed below.
    model_config = ConfigDict(extra="ignore")


class SimpleExpectedRange(_SimplePlanModel):
    min: float | None = None
    max: float | None = None


class SimpleSuccessCriteria(_SimplePlanModel):
    primary_metric: str = Field(min_length=1)
    expected_range: SimpleExpectedRange | None = None
    additional_notes: list[str] | None = None


class SimplePlanParameters(_SimplePlanModel):
    shots: int | None = Field(default=None, ge=1, le=20_000)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    optimizer: Optimizer | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=500)
    custom: dict[str, Any] | None = None


class SimplePlan(_SimplePlanModel):
    """Only the information generation and bounded execution actually consume."""

    domain: str = Field(min_length=2)
    framework: Framework
    algorithm: Algorithm
    problem_summary: str = Field(min_length=5)
    algorithm_rationale: str = Field(min_length=5)
    parameters: SimplePlanParameters = Field(default_factory=SimplePlanParameters)
    qubits_estimate: int = Field(ge=1, le=27)
    expected_runtime_sec: int = Field(ge=1, le=300)
    success_criteria: SimpleSuccessCriteria
    expected_output_keys: list[str] = Field(min_length=1)

    def to_durable_plan(
        self,
        *,
        selected_framework: Framework,
        requested_shots: int | None,
        requested_seed: int | None,
    ) -> Plan:
        """Translate into the compatible storage model without strict-plan fields."""

        keys = list(dict.fromkeys(key.strip() for key in self.expected_output_keys if key.strip()))
        metric = self.success_criteria.primary_metric.strip()
        if metric not in keys:
            # The simple contract checks RESULT keys after execution.  Normalizing
            # this harmless planner inconsistency is more useful than another model
            # round trip, and the generator sees the normalized durable Plan.
            keys.append(metric)
        parameters = self.parameters.model_dump(mode="python")
        if requested_shots is not None:
            parameters["shots"] = requested_shots
        if requested_seed is not None:
            parameters["seed"] = requested_seed
        expected_range = (
            self.success_criteria.expected_range.model_dump(exclude_none=True)
            if self.success_criteria.expected_range is not None
            else None
        )
        return Plan(
            domain=self.domain,
            framework=selected_framework,
            algorithm=self.algorithm,
            problem_summary=self.problem_summary,
            algorithm_rationale=self.algorithm_rationale,
            parameters=PlanParameters.model_validate(parameters),
            qubits_estimate=self.qubits_estimate,
            expected_runtime_sec=self.expected_runtime_sec,
            success_criteria=SuccessCriteria(
                primary_metric=metric,
                expected_range=expected_range,
                additional_notes=self.success_criteria.additional_notes,
            ),
            expected_output_keys=keys,
            artifact_contract=None,
            verification_plan=None,
        )


def parse_simple_plan(text: str) -> SimplePlan:
    """Parse one tolerant JSON object, leaving typed validation errors intact."""

    raw = extract_json(text)
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise StageOutputError(f"invalid JSON object: {exc}") from exc
    if isinstance(payload, dict):
        criteria = payload.get("success_criteria")
        if isinstance(criteria, dict) and isinstance(criteria.get("additional_notes"), str):
            payload = {
                **payload,
                "success_criteria": {
                    **criteria,
                    "additional_notes": [criteria["additional_notes"]],
                },
            }
    return SimplePlan.model_validate(payload)
