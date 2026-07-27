from __future__ import annotations

import dataclasses

import pytest

from majorana_vqe.executable_plan import (
    ExecutablePlanResolutionError,
    resolve_executable_plan,
)
from majorana_vqe.models import ComponentType
from majorana_vqe.standard_catalog import (
    STANDARD_IMPLEMENTATIONS,
    workflow_by_key,
)


@pytest.mark.parametrize("evaluator", ["qiskit", "pennylane"])
def test_baseline_plan_resolves_role_specific_providers(evaluator: str):
    plan = resolve_executable_plan(
        workflow_by_key("workflow.h2.fixed_excitation.v1"),
        evaluator_provider=evaluator,
    )
    by_role = {binding.role: binding for binding in plan.role_bindings}
    assert by_role[ComponentType.PROBLEM_PREPARATION].provider == "pyscf"
    assert by_role[ComponentType.PARAMETER_OPTIMIZER].provider == "scipy"
    assert by_role[ComponentType.ANSATZ].provider == evaluator
    assert by_role[ComponentType.MEASUREMENT].provider == evaluator
    assert plan.runtime_profile_id.startswith(f"h2-{evaluator}-")


def test_unqualified_slsqp_candidate_fails_closed():
    with pytest.raises(
        ExecutablePlanResolutionError,
        match="insufficient_binding_evidence",
    ):
        resolve_executable_plan(
            workflow_by_key("workflow.h2.fixed_excitation.slsqp.v1"),
            evaluator_provider="qiskit",
        )


def test_unsupported_evaluator_and_ambiguous_binding_fail_closed():
    workflow = workflow_by_key("workflow.h2.fixed_excitation.v1")
    with pytest.raises(
        ExecutablePlanResolutionError,
        match="unsupported_evaluator_provider",
    ):
        resolve_executable_plan(workflow, evaluator_provider="client-package-choice")

    duplicate = dataclasses.replace(
        next(
            item
            for item in STANDARD_IMPLEMENTATIONS
            if item.component_semantic_key == "optimizer.scipy_bounded_scalar.v1"
        ),
        binding_key="optimizer.scipy_bounded_scalar.v1:scipy:duplicate",
    )
    with pytest.raises(ExecutablePlanResolutionError, match="ambiguous_binding"):
        resolve_executable_plan(
            workflow,
            evaluator_provider="qiskit",
            implementations=(*STANDARD_IMPLEMENTATIONS, duplicate),
        )
