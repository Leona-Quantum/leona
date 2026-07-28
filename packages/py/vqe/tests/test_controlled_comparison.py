from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from majorana_vqe.controlled_comparison import (
    ControlledComparisonRunV1,
    ControlledComparisonSpecV1,
    ControlledComparisonStatus,
)
from majorana_vqe.models import ComponentType


def _spec() -> ControlledComparisonSpecV1:
    return ControlledComparisonSpecV1(
        baseline_workflow_artifact_version_id=uuid.uuid4(),
        candidate_workflow_artifact_version_id=uuid.uuid4(),
        changed_role=ComponentType.PARAMETER_OPTIMIZER,
        fixed_component_digests={ComponentType.PROBLEM: "a" * 64},
        baseline_configuration={"algorithm": "bounded"},
        candidate_configuration={"algorithm": "slsqp"},
        metric_protocol_sha256="b" * 64,
        budget_protocol_sha256="c" * 64,
    )


def test_plan_is_not_a_result_and_changed_role_cannot_be_fixed() -> None:
    spec = _spec()
    assert not hasattr(spec, "metric_observations")
    with pytest.raises(ValidationError, match="declared fixed"):
        ControlledComparisonSpecV1(
            **{
                **spec.model_dump(),
                "fixed_component_digests": {ComponentType.PARAMETER_OPTIMIZER: "d" * 64},
            }
        )


def test_comparable_run_requires_every_invariant() -> None:
    run_args = {
        "comparison_spec_id": uuid.uuid4(),
        "baseline_execution_id": uuid.uuid4(),
        "candidate_execution_id": uuid.uuid4(),
        "status": ControlledComparisonStatus.COMPARABLE,
        "invariant_audit": {"same_problem": True, "same_circuit": True},
        "metric_observations": {"objective_calls": {"baseline": 13, "candidate": 8}},
    }
    assert ControlledComparisonRunV1(**run_args).status is ControlledComparisonStatus.COMPARABLE
    with pytest.raises(ValidationError, match="every invariant"):
        ControlledComparisonRunV1(**{**run_args, "invariant_audit": {"same_problem": False}})


def test_comparability_failure_requires_reason_and_failed_invariant() -> None:
    with pytest.raises(ValidationError, match="terminal reason"):
        ControlledComparisonRunV1(
            comparison_spec_id=uuid.uuid4(),
            baseline_execution_id=uuid.uuid4(),
            candidate_execution_id=uuid.uuid4(),
            status=ControlledComparisonStatus.COMPARABILITY_FAILED,
            invariant_audit={"same_problem": False},
        )
