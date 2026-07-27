import dataclasses

import pytest

from majorana_vqe.models import ComponentType
from majorana_vqe.standard_catalog import (
    CONTROLLED_COMPARISONS,
    STANDARD_COMPONENTS,
    STANDARD_IMPLEMENTATIONS,
    STANDARD_WORKFLOWS,
    CapabilityStatus,
    StandardWorkflowTemplate,
    WorkflowComponentSelection,
    build_controlled_comparison,
    check_workflow_compatibility,
    workflow_by_key,
)


def test_mvp_seed_counts_and_identities_are_unique():
    assert len(STANDARD_COMPONENTS) >= 18
    assert len(STANDARD_IMPLEMENTATIONS) >= 12
    assert len(STANDARD_WORKFLOWS) >= 4
    assert len(CONTROLLED_COMPARISONS) >= 3
    assert len({item.semantic_key for item in STANDARD_COMPONENTS}) == len(STANDARD_COMPONENTS)
    assert len({item.binding_key for item in STANDARD_IMPLEMENTATIONS}) == len(
        STANDARD_IMPLEMENTATIONS
    )
    assert len({item.workflow_key for item in STANDARD_WORKFLOWS}) == len(STANDARD_WORKFLOWS)


def test_only_runtime_qualified_h2_workflow_is_marked_executable():
    executable = [item for item in STANDARD_WORKFLOWS if item.status is CapabilityStatus.EXECUTABLE]
    assert [item.workflow_key for item in executable] == ["workflow.h2.fixed_excitation.v1"]
    assert executable[0].supported_providers == ("qiskit", "pennylane")
    assert executable[0].registry_semantic_key == "h2.sto3g.actual_vqe.workflow.v0_2"
    assert all(
        item.registry_semantic_key is None
        for item in STANDARD_WORKFLOWS
        if item.status is not CapabilityStatus.EXECUTABLE
    )


def test_executable_h2_workflow_is_compatible():
    result = check_workflow_compatibility(workflow_by_key("workflow.h2.fixed_excitation.v1"))
    assert result.compatible is True
    assert result.issues == ()
    assert "observation:energy_exact" in result.accumulated_contracts


def test_missing_and_wrong_role_components_fail_closed():
    baseline = workflow_by_key("workflow.h2.fixed_excitation.v1")
    wrong = StandardWorkflowTemplate(
        workflow_key="workflow.invalid.v1",
        display_name="Invalid",
        status=CapabilityStatus.STRUCTURED,
        selections=(
            WorkflowComponentSelection(
                role=ComponentType.ANSATZ,
                component_semantic_key="problem.h2.sto3g.v1",
            ),
        ),
        supported_providers=(),
    )
    result = check_workflow_compatibility(wrong)
    assert result.compatible is False
    assert {issue.code for issue in result.issues} == {"role_type_mismatch"}

    unknown = dataclasses.replace(
        baseline,
        selections=(
            *baseline.selections[:-1],
            WorkflowComponentSelection(
                role=ComponentType.COMPILATION_BACKEND,
                component_semantic_key="unknown.component",
            ),
        ),
    )
    assert check_workflow_compatibility(unknown).issues[-1].code == "unknown_component"


def test_comparison_changes_exactly_one_component():
    for comparison in CONTROLLED_COMPARISONS:
        assert comparison.baseline_component_key != comparison.candidate_component_key

    baseline = workflow_by_key("workflow.h2.fixed_excitation.v1")
    with pytest.raises(ValueError, match="exactly one"):
        build_controlled_comparison("bad", baseline, baseline)


def test_optimizer_comparison_does_not_change_other_configuration():
    comparison = next(
        item
        for item in CONTROLLED_COMPARISONS
        if item.changed_role is ComponentType.PARAMETER_OPTIMIZER
    )
    assert comparison.baseline_component_key == "optimizer.slsqp.v1"
    assert comparison.candidate_component_key == "optimizer.cobyla.v1"
