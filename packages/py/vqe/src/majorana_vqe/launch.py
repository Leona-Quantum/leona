"""Pure launch-eligibility contracts for component-first VQE workflows.

The registry, experiment API, worker, and UI must not invent independent
meanings for "available".  This module deliberately separates scientific
validity, execution policy, implementation resolution, historical runtime
qualification, and live runtime readiness.  It has no framework, database,
or HTTP imports so every adapter can use the same deterministic decision.
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from .models import VqeBaseModel


class DefinitionState(str, Enum):
    AVAILABLE = "available"
    MISSING = "missing"
    CONFLICTING = "conflicting"


class CompositionState(str, Enum):
    MACHINE_VALIDATED = "machine_validated"
    UNVALIDATED = "unvalidated"
    VALIDATION_FAILED = "validation_failed"


class ExecutionPolicyState(str, Enum):
    PERMITTED_PRIVATE = "permitted_private"
    OWNER_WAIVED_PRIVATE = "owner_waived_private"
    REVIEW_REQUIRED = "review_required"
    DENIED = "denied"


class ImplementationResolutionState(str, Enum):
    RESOLVED = "resolved"
    UNRESOLVED = "unresolved"
    AMBIGUOUS = "ambiguous"


class RuntimeQualificationState(str, Enum):
    QUALIFIED = "qualified"
    UNQUALIFIED = "unqualified"


class LiveReadinessState(str, Enum):
    READY = "ready"
    UNAVAILABLE = "unavailable"
    STALE = "stale"
    UNKNOWN = "unknown"


class LaunchMode(str, Enum):
    DIRECT = "direct"
    VALIDATED_DRAFT_REQUIRED = "validated_draft_required"
    BLOCKED = "blocked"


class ExperimentCreationDecision(str, Enum):
    ELIGIBLE = "eligible"
    DRAFT_REQUIRED = "draft_required"
    BLOCKED = "blocked"


class ExecutionStartDecision(str, Enum):
    ELIGIBLE = "eligible"
    BLOCKED = "blocked"


class LaunchReasonCode(str, Enum):
    DEFINITION_MISSING = "vqe_definition_missing"
    DEFINITION_CONFLICTING = "vqe_definition_conflicting"
    COMPOSITION_UNVALIDATED = "vqe_composition_unvalidated"
    COMPOSITION_VALIDATION_FAILED = "vqe_composition_validation_failed"
    VALIDATED_DRAFT_REQUIRED = "vqe_validated_draft_required"
    EXECUTION_POLICY_REVIEW_REQUIRED = "vqe_execution_policy_review_required"
    EXECUTION_POLICY_DENIED = "vqe_execution_policy_denied"
    IMPLEMENTATION_UNRESOLVED = "vqe_implementation_unresolved"
    IMPLEMENTATION_AMBIGUOUS = "vqe_implementation_ambiguous"
    RUNTIME_UNQUALIFIED = "vqe_runtime_unqualified"
    RUNTIME_UNAVAILABLE = "vqe_runtime_unavailable"
    RUNTIME_READINESS_STALE = "vqe_runtime_readiness_stale"
    RUNTIME_READINESS_UNKNOWN = "vqe_runtime_readiness_unknown"


class LaunchBlocker(VqeBaseModel):
    reason_code: LaunchReasonCode
    field: str = Field(min_length=1, max_length=100)
    retryable: bool = False


class FrameworkLaunchInput(VqeBaseModel):
    framework: str = Field(min_length=1, max_length=40)
    implementation_resolution: ImplementationResolutionState
    runtime_qualification: RuntimeQualificationState
    live_readiness: LiveReadinessState


class WorkflowLaunchInput(VqeBaseModel):
    definition_state: DefinitionState
    composition_state: CompositionState
    execution_policy_state: ExecutionPolicyState
    validated_draft_supported: bool = False
    frameworks: tuple[FrameworkLaunchInput, ...] = ()


class ExperimentCreationProjection(VqeBaseModel):
    decision: ExperimentCreationDecision
    launch_mode: LaunchMode
    primary_reason_code: LaunchReasonCode | None = None
    blockers: tuple[LaunchBlocker, ...] = ()


class FrameworkLaunchProjection(VqeBaseModel):
    framework: str
    decision: ExecutionStartDecision
    primary_reason_code: LaunchReasonCode | None = None
    blockers: tuple[LaunchBlocker, ...] = ()


class WorkflowLaunchProjection(VqeBaseModel):
    experiment_creation: ExperimentCreationProjection
    frameworks: tuple[FrameworkLaunchProjection, ...]


def _definition_blocker(state: DefinitionState) -> LaunchBlocker | None:
    if state is DefinitionState.MISSING:
        return LaunchBlocker(
            reason_code=LaunchReasonCode.DEFINITION_MISSING,
            field="definition_state",
        )
    if state is DefinitionState.CONFLICTING:
        return LaunchBlocker(
            reason_code=LaunchReasonCode.DEFINITION_CONFLICTING,
            field="definition_state",
        )
    return None


def _composition_blocker(state: CompositionState) -> LaunchBlocker | None:
    if state is CompositionState.UNVALIDATED:
        return LaunchBlocker(
            reason_code=LaunchReasonCode.COMPOSITION_UNVALIDATED,
            field="composition_state",
        )
    if state is CompositionState.VALIDATION_FAILED:
        return LaunchBlocker(
            reason_code=LaunchReasonCode.COMPOSITION_VALIDATION_FAILED,
            field="composition_state",
        )
    return None


def _policy_blocker(state: ExecutionPolicyState) -> LaunchBlocker | None:
    if state is ExecutionPolicyState.REVIEW_REQUIRED:
        return LaunchBlocker(
            reason_code=LaunchReasonCode.EXECUTION_POLICY_REVIEW_REQUIRED,
            field="execution_policy_state",
        )
    if state is ExecutionPolicyState.DENIED:
        return LaunchBlocker(
            reason_code=LaunchReasonCode.EXECUTION_POLICY_DENIED,
            field="execution_policy_state",
        )
    return None


def _framework_blockers(value: FrameworkLaunchInput) -> tuple[LaunchBlocker, ...]:
    blockers: list[LaunchBlocker] = []
    if value.implementation_resolution is ImplementationResolutionState.UNRESOLVED:
        blockers.append(
            LaunchBlocker(
                reason_code=LaunchReasonCode.IMPLEMENTATION_UNRESOLVED,
                field="implementation_resolution",
            )
        )
    elif value.implementation_resolution is ImplementationResolutionState.AMBIGUOUS:
        blockers.append(
            LaunchBlocker(
                reason_code=LaunchReasonCode.IMPLEMENTATION_AMBIGUOUS,
                field="implementation_resolution",
            )
        )
    if value.runtime_qualification is RuntimeQualificationState.UNQUALIFIED:
        blockers.append(
            LaunchBlocker(
                reason_code=LaunchReasonCode.RUNTIME_UNQUALIFIED,
                field="runtime_qualification",
            )
        )
    readiness_reasons = {
        LiveReadinessState.UNAVAILABLE: LaunchReasonCode.RUNTIME_UNAVAILABLE,
        LiveReadinessState.STALE: LaunchReasonCode.RUNTIME_READINESS_STALE,
        LiveReadinessState.UNKNOWN: LaunchReasonCode.RUNTIME_READINESS_UNKNOWN,
    }
    readiness_reason = readiness_reasons.get(value.live_readiness)
    if readiness_reason is not None:
        blockers.append(
            LaunchBlocker(
                reason_code=readiness_reason,
                field="live_readiness",
                retryable=True,
            )
        )
    return tuple(blockers)


def evaluate_workflow_launch(value: WorkflowLaunchInput) -> WorkflowLaunchProjection:
    """Return a stable, fail-closed launch projection with every blocker.

    Blocker ordering is part of the wire contract: definition, composition,
    policy, implementation, qualification, readiness.  The first blocker is
    therefore a deterministic primary reason suitable for UI and telemetry.
    """

    creation_blockers = tuple(
        blocker
        for blocker in (
            _definition_blocker(value.definition_state),
            _composition_blocker(value.composition_state),
            _policy_blocker(value.execution_policy_state),
        )
        if blocker is not None
    )
    if (
        value.definition_state is DefinitionState.AVAILABLE
        and value.composition_state is CompositionState.UNVALIDATED
        and value.validated_draft_supported
        and value.execution_policy_state
        in {
            ExecutionPolicyState.PERMITTED_PRIVATE,
            ExecutionPolicyState.OWNER_WAIVED_PRIVATE,
        }
    ):
        draft_blocker = LaunchBlocker(
            reason_code=LaunchReasonCode.VALIDATED_DRAFT_REQUIRED,
            field="composition_state",
        )
        creation = ExperimentCreationProjection(
            decision=ExperimentCreationDecision.DRAFT_REQUIRED,
            launch_mode=LaunchMode.VALIDATED_DRAFT_REQUIRED,
            primary_reason_code=draft_blocker.reason_code,
            blockers=(draft_blocker,),
        )
    elif creation_blockers:
        creation = ExperimentCreationProjection(
            decision=ExperimentCreationDecision.BLOCKED,
            launch_mode=LaunchMode.BLOCKED,
            primary_reason_code=creation_blockers[0].reason_code,
            blockers=creation_blockers,
        )
    else:
        creation = ExperimentCreationProjection(
            decision=ExperimentCreationDecision.ELIGIBLE,
            launch_mode=LaunchMode.DIRECT,
        )

    framework_projections: list[FrameworkLaunchProjection] = []
    for framework in sorted(value.frameworks, key=lambda item: item.framework):
        blockers = creation.blockers + _framework_blockers(framework)
        framework_projections.append(
            FrameworkLaunchProjection(
                framework=framework.framework,
                decision=(
                    ExecutionStartDecision.ELIGIBLE
                    if not blockers
                    else ExecutionStartDecision.BLOCKED
                ),
                primary_reason_code=blockers[0].reason_code if blockers else None,
                blockers=blockers,
            )
        )
    return WorkflowLaunchProjection(
        experiment_creation=creation,
        frameworks=tuple(framework_projections),
    )
