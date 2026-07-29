import dataclasses

import pytest

from majorana_vqe.models import ComponentType
from majorana_vqe.standard_catalog import (
    CONTROLLED_COMPARISON_SPECS,
    STANDARD_COMPONENTS,
    STANDARD_IMPLEMENTATIONS,
    STANDARD_WORKFLOWS,
    BindingKind,
    EvidenceLevel,
    RoleApplicability,
    StandardWorkflowTemplate,
    WorkflowStatus,
    WorkflowComponentSelection,
    build_controlled_comparison,
    check_workflow_compatibility,
    migrate_selection_configuration,
    workflow_by_key,
)


def test_seed_identities_are_unique_and_relationships_are_nonempty():
    assert STANDARD_COMPONENTS
    assert STANDARD_IMPLEMENTATIONS
    assert STANDARD_WORKFLOWS
    assert CONTROLLED_COMPARISON_SPECS
    assert len({item.semantic_key for item in STANDARD_COMPONENTS}) == len(STANDARD_COMPONENTS)
    assert len({item.binding_key for item in STANDARD_IMPLEMENTATIONS}) == len(
        STANDARD_IMPLEMENTATIONS
    )
    assert len({item.workflow_key for item in STANDARD_WORKFLOWS}) == len(STANDARD_WORKFLOWS)


def test_only_runtime_qualified_h2_workflow_is_marked_executable():
    executable = [item for item in STANDARD_WORKFLOWS if item.status is WorkflowStatus.EXECUTABLE]
    assert [item.workflow_key for item in executable] == ["workflow.h2.fixed_excitation.v1"]
    assert executable[0].supported_evaluator_providers == ("qiskit", "pennylane")
    assert executable[0].registry_semantic_key == "h2.sto3g.actual_vqe.workflow.v0_2"
    assert all(
        item.registry_semantic_key is None
        for item in STANDARD_WORKFLOWS
        if item.status is not WorkflowStatus.EXECUTABLE
    )


def test_bindings_do_not_misattribute_cross_provider_components():
    by_component = {
        component: [
            item for item in STANDARD_IMPLEMENTATIONS if item.component_semantic_key == component
        ]
        for component in {item.component_semantic_key for item in STANDARD_IMPLEMENTATIONS}
    }
    assert {item.provider for item in by_component["preparation.pyscf.rhf.v1"]} == {"pyscf"}
    assert {item.provider for item in by_component["optimizer.scipy_bounded_scalar.v1"]} == {
        "scipy"
    }
    neutral = by_component["compression.none.v1"]
    assert len(neutral) == 1
    assert neutral[0].provider == "atlas"
    assert neutral[0].binding_kind is BindingKind.NEUTRAL_PROTOCOL
    assert neutral[0].evidence_level is EvidenceLevel.ADAPTER_TESTED


def test_cobyla_binding_records_private_runtime_qualification_without_public_claim():
    cobyla = next(
        item
        for item in STANDARD_IMPLEMENTATIONS
        if item.component_semantic_key == "optimizer.cobyla.v1"
    )
    assert cobyla.provider == "scipy"
    assert cobyla.evidence_level is EvidenceLevel.RUNTIME_QUALIFIED
    assert cobyla.known_incompatibilities == ()
    assert "docs/atlas/evidence/phase78/s6_private_oci_e2e.json" in cobyla.evidence_locators

    workflow = workflow_by_key("workflow.h2.fixed_excitation.cobyla.v1")
    assert workflow.status is WorkflowStatus.STRUCTURED
    assert workflow.registry_semantic_key is None


def test_executable_h2_workflow_is_compatible():
    result = check_workflow_compatibility(workflow_by_key("workflow.h2.fixed_excitation.v1"))
    assert result.compatible is True
    assert result.issues == ()
    assert "observation:energy_exact" in result.accumulated_contracts
    assert result.contract_version == "2.0.0"


def test_fixed_ansatz_and_adapt_roles_have_explicit_applicability():
    uccsd = workflow_by_key("workflow.h2.uccsd.v1")
    not_applicable = {
        selection.role
        for selection in uccsd.selections
        if selection.applicability is RoleApplicability.NOT_APPLICABLE
    }
    assert not_applicable == {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
    assert all(
        selection.component_semantic_key is None
        for selection in uccsd.selections
        if selection.role in not_applicable
    )
    assert check_workflow_compatibility(uccsd).compatible is False
    assert {issue.missing_contract for issue in check_workflow_compatibility(uccsd).issues} == {
        "parameters:1"
    }
    adapt = workflow_by_key("workflow.h2.adapt.v1")
    assert all(
        selection.applicability is RoleApplicability.REQUIRED
        for selection in adapt.selections
        if selection.role
        in {
            ComponentType.OPERATOR_POOL,
            ComponentType.SEARCH_SELECTION,
            ComponentType.GROWTH_BATCHING,
        }
    )


def test_component_on_not_applicable_role_fails_closed():
    uccsd = workflow_by_key("workflow.h2.uccsd.v1")
    invalid = dataclasses.replace(
        uccsd,
        selections=tuple(
            dataclasses.replace(
                selection,
                component_semantic_key="pool.h2.singleton_double.v1",
            )
            if selection.role is ComponentType.OPERATOR_POOL
            else selection
            for selection in uccsd.selections
        ),
    )
    result = check_workflow_compatibility(invalid)
    assert "component_present_for_inapplicable_role" in {issue.code for issue in result.issues}


def test_configuration_migration_never_silently_discards_fields():
    result = migrate_selection_configuration(
        (
            ("lower_bound_float64_hex", "c00921fb54442d18"),
            ("bounded_scalar_xatol", "3d719799812dea11"),
        ),
        candidate_component_key="optimizer.slsqp.v1",
    )
    assert result.migrated == (("lower_bound_float64_hex", "c00921fb54442d18"),)
    assert result.dropped == (("bounded_scalar_xatol", "3d719799812dea11"),)
    assert result.requires_explicit_acceptance is True


def test_cobyla_configuration_keeps_trust_region_distinct_from_energy_tolerance():
    configuration = (
        ("energy_tolerance_float64_hex", "3d719799812dea11"),
        ("final_trust_region_radius_float64_hex", "3e45798ee2308c3a"),
        ("constraint_tolerance_float64_hex", "3d719799812dea11"),
    )
    result = migrate_selection_configuration(
        configuration,
        candidate_component_key="optimizer.cobyla.v1",
    )
    assert result.migrated == configuration
    assert result.dropped == ()
    assert result.requires_explicit_acceptance is False


def test_missing_and_wrong_role_components_fail_closed():
    baseline = workflow_by_key("workflow.h2.fixed_excitation.v1")
    wrong = StandardWorkflowTemplate(
        workflow_key="workflow.invalid.v1",
        display_name="Invalid",
        status=WorkflowStatus.STRUCTURED,
        selections=(
            WorkflowComponentSelection(
                role=ComponentType.ANSATZ,
                component_semantic_key="problem.h2.sto3g.v1",
            ),
        ),
        supported_evaluator_providers=(),
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
    for comparison in CONTROLLED_COMPARISON_SPECS:
        assert comparison.baseline_component_key != comparison.candidate_component_key

    baseline = workflow_by_key("workflow.h2.fixed_excitation.v1")
    with pytest.raises(ValueError, match="exactly one"):
        build_controlled_comparison("bad", baseline, baseline)


def test_optimizer_comparison_does_not_change_other_configuration():
    comparison = next(
        item
        for item in CONTROLLED_COMPARISON_SPECS
        if item.changed_role is ComponentType.PARAMETER_OPTIMIZER
    )
    assert comparison.baseline_component_key == "optimizer.slsqp.v1"
    assert comparison.candidate_component_key == "optimizer.cobyla.v1"
