from majorana_vqe.launch import (
    CompositionState,
    DefinitionState,
    ExecutionPolicyState,
    ExecutionStartDecision,
    ExperimentCreationDecision,
    FrameworkLaunchInput,
    ImplementationResolutionState,
    LaunchMode,
    LaunchReasonCode,
    LiveReadinessState,
    RuntimeQualificationState,
    WorkflowLaunchInput,
    evaluate_workflow_launch,
)


def _framework(**overrides):
    values = {
        "framework": "qiskit",
        "implementation_resolution": ImplementationResolutionState.RESOLVED,
        "runtime_qualification": RuntimeQualificationState.QUALIFIED,
        "live_readiness": LiveReadinessState.READY,
    }
    values.update(overrides)
    return FrameworkLaunchInput(**values)


def test_direct_launch_requires_every_independent_gate():
    projection = evaluate_workflow_launch(
        WorkflowLaunchInput(
            definition_state=DefinitionState.AVAILABLE,
            composition_state=CompositionState.MACHINE_VALIDATED,
            execution_policy_state=ExecutionPolicyState.PERMITTED_PRIVATE,
            frameworks=(_framework(),),
        )
    )
    assert projection.experiment_creation.decision is ExperimentCreationDecision.ELIGIBLE
    assert projection.experiment_creation.launch_mode is LaunchMode.DIRECT
    assert projection.frameworks[0].decision is ExecutionStartDecision.ELIGIBLE
    assert projection.frameworks[0].blockers == ()


def test_unvalidated_seed_is_a_draft_action_not_an_executable_workflow():
    projection = evaluate_workflow_launch(
        WorkflowLaunchInput(
            definition_state=DefinitionState.AVAILABLE,
            composition_state=CompositionState.UNVALIDATED,
            execution_policy_state=ExecutionPolicyState.PERMITTED_PRIVATE,
            validated_draft_supported=True,
            frameworks=(_framework(),),
        )
    )
    assert projection.experiment_creation.decision is ExperimentCreationDecision.DRAFT_REQUIRED
    assert projection.experiment_creation.launch_mode is LaunchMode.VALIDATED_DRAFT_REQUIRED
    assert projection.frameworks[0].decision is ExecutionStartDecision.BLOCKED
    assert projection.frameworks[0].primary_reason_code is LaunchReasonCode.VALIDATED_DRAFT_REQUIRED


def test_all_runtime_blockers_are_returned_in_stable_order():
    projection = evaluate_workflow_launch(
        WorkflowLaunchInput(
            definition_state=DefinitionState.AVAILABLE,
            composition_state=CompositionState.MACHINE_VALIDATED,
            execution_policy_state=ExecutionPolicyState.PERMITTED_PRIVATE,
            frameworks=(
                _framework(
                    implementation_resolution=ImplementationResolutionState.UNRESOLVED,
                    runtime_qualification=RuntimeQualificationState.UNQUALIFIED,
                    live_readiness=LiveReadinessState.STALE,
                ),
            ),
        )
    )
    assert [blocker.reason_code for blocker in projection.frameworks[0].blockers] == [
        LaunchReasonCode.IMPLEMENTATION_UNRESOLVED,
        LaunchReasonCode.RUNTIME_UNQUALIFIED,
        LaunchReasonCode.RUNTIME_READINESS_STALE,
    ]
    assert projection.frameworks[0].blockers[-1].retryable is True


def test_owner_waiver_is_policy_not_scientific_review():
    assert ExecutionPolicyState.OWNER_WAIVED_PRIVATE.value == "owner_waived_private"


def test_framework_projection_order_is_deterministic():
    projection = evaluate_workflow_launch(
        WorkflowLaunchInput(
            definition_state=DefinitionState.AVAILABLE,
            composition_state=CompositionState.MACHINE_VALIDATED,
            execution_policy_state=ExecutionPolicyState.PERMITTED_PRIVATE,
            frameworks=(
                _framework(framework="pennylane"),
                _framework(framework="qiskit"),
            ),
        )
    )
    assert [item.framework for item in projection.frameworks] == ["pennylane", "qiskit"]
