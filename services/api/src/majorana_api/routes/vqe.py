"""Atlas VQE registry, comparisons, and portable experiments (Phase 4.5).

GET /v1/atlas/comparisons/{id} reads directly from the bundled
docs/atlas/corpus/comparisons/*.json files rather than a DB table: the
plan's own Phase 3 DB-responsibilities list has no comparisons table, and
Phase 2's comparison reports are versioned, machine-generated corpus data
(ADR-0027), not per-workspace mutable state.

Phase 5A candidate execution is available only when a local-development
feature gate is enabled. It reuses durable runs/jobs/events while public
capability and scientific promotion remain blocked.
"""

import datetime as dt
import hmac
import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi import Path as PathParam
from majorana_contracts.enums import Algorithm, ExportStatus, RunMode, RunStatus
from majorana_contracts.enums import Framework as ContractFramework
from majorana_vqe.models import (
    Capability,
    ComponentType,
    Framework,
    MachineValidationState,
    ReviewState,
)
from majorana_vqe.launch import (
    CompositionState,
    DefinitionState,
    ExecutionPolicyState,
    FrameworkLaunchInput,
    ImplementationResolutionState,
    LiveReadinessState,
    RuntimeQualificationState,
    WorkflowLaunchInput,
    evaluate_workflow_launch,
)
from majorana_vqe.controlled_comparison import ControlledComparisonSpecV1
from majorana_vqe.executable import (
    H2_HARDWARE_EFFICIENT_SUPPORTED_SEMANTIC_KEY_SETS,
    H2_SUPPORTED_SEMANTIC_KEY_SETS,
    H2_UCCSD_SUPPORTED_SEMANTIC_KEY_SETS,
)
from majorana_vqe.portable import (
    PortableScientificExperimentSpec,
    PortableScientificExperimentSpecV03,
    normalized_component_spec_digest,
)
from pydantic import BaseModel, ConfigDict, Field
from opentelemetry import metrics

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..jobs import VQE_EXECUTE_JOB_KIND
from ..orm import VqeComponentSpec as VqeComponentSpecRow
from ..orm import VqeExperiment as VqeExperimentRow
from ..orm import VqeExecution as VqeExecutionRow
from ..orm import VqeObservation as VqeObservationRow
from ..orm import VqeControlledComparisonRun as VqeControlledComparisonRunRow
from ..orm import VqeControlledComparisonSpec as VqeControlledComparisonSpecRow
from ..orm import VqeWorkflowComponent as VqeWorkflowComponentRow
from ..repos import artifacts as artifacts_repo
from ..repos import research_candidates as research_candidates_repo
from ..repos import runs as runs_repo
from ..repos import system
from ..repos import vqe as vqe_repo
from ..request_models import RequestModel
from ..settings import Settings
from ..standard_vqe_materializer import standard_component_payload
from ..tiers import limits_for, tier_of
from ..vqe_runtime_profiles import (
    hardware_efficient_production_runtime_profile,
    hardware_efficient_production_runtime_profiles,
    production_runtime_profile,
    production_runtime_profiles,
    uccsd_production_runtime_profile,
    uccsd_production_runtime_profiles,
)

router = APIRouter()

log = logging.getLogger("majorana_api.vqe_launch")
_launch_meter = metrics.get_meter("majorana.vqe.launch")
_launch_decisions = _launch_meter.create_counter(
    "majorana.vqe.launch.decisions",
    description="VQE launch-gate decisions by action and stable reason code",
)
_launch_invariant_failures = _launch_meter.create_counter(
    "majorana.vqe.launch.invariant_failures",
    description=(
        "Scientific or registry contradictions observed after a launch projection "
        "was declared eligible"
    ),
)

_COMPARISON_ID_PATTERN = r"^[a-zA-Z0-9_]+$"


def _observe_launch_decision(
    *,
    action: str,
    decision: str,
    reason_code: str | None,
    request_id: str,
    workflow_artifact_version_id: uuid.UUID,
    projection_sha256: str,
    framework: str | None = None,
    experiment_id: uuid.UUID | None = None,
    invariant_failure: bool = False,
) -> None:
    """Record a bounded launch decision without identity or secret material.

    Metric attributes deliberately contain only stable, low-cardinality enums.
    UUIDs and the projection prefix are useful for an operator trace, so they
    are present only in the structured log line and never as metric labels.
    """

    metric_attributes = {
        "action": action,
        "decision": decision,
        "reason_code": reason_code or "none",
        "framework": framework or "none",
    }
    _launch_decisions.add(1, metric_attributes)
    if invariant_failure:
        _launch_invariant_failures.add(1, metric_attributes)
    payload = {
        "event": "vqe_launch_decision",
        "action": action,
        "decision": decision,
        "reason_code": reason_code,
        "request_id": request_id,
        "workflow_artifact_version_id": str(workflow_artifact_version_id),
        "experiment_id": str(experiment_id) if experiment_id else None,
        "framework": framework,
        "projection_sha256_prefix": projection_sha256[:12],
        "invariant_failure": invariant_failure,
    }
    level = logging.ERROR if invariant_failure else logging.INFO
    log.log(level, "%s", json.dumps(payload, sort_keys=True, separators=(",", ":")))


async def _file_private_artifact(
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Settings,
    artifact_id: uuid.UUID,
) -> None:
    """File one explicitly saved VQE result through the normal Vault cap."""

    user, _workspace = identity
    limits = limits_for(tier_of(user, settings))
    try:
        await artifacts_repo.keep_artifact(
            scope,
            session,
            artifact_id,
            workspace_artifact_limit=limits.private_artifacts,
        )
    except artifacts_repo.ArtifactCapReached as full:
        raise HTTPException(
            status_code=429,
            detail={
                "error": (
                    f"Your Studio holds {full.held} of {full.limit} artifacts on this plan. "
                    "Archive an artifact you no longer need and this VQE result will file."
                ),
                "reason": "artifact_allowance_exhausted",
                "used": full.held,
                "limit": full.limit,
            },
        ) from full


def _catalog_workspace_id(settings: Settings) -> uuid.UUID | None:
    """Return only the server-owned catalog workspace identifier.

    A request body or query parameter must never be able to choose the
    authority against which public registry entries are resolved.
    """
    return (
        settings.catalog_authority.workspace_id if settings.catalog_authority.configured else None
    )


def _matches_h2_uccsd_component_identity(scientific_spec_json: dict[str, Any]) -> bool:
    semantic_keys = _semantic_keys_for_scientific_spec(scientific_spec_json)
    if semantic_keys is None:
        return False
    return any(
        semantic_keys == supported_keys for supported_keys in H2_UCCSD_SUPPORTED_SEMANTIC_KEY_SETS
    )


def _matches_h2_hardware_efficient_component_identity(
    scientific_spec_json: dict[str, Any],
) -> bool:
    semantic_keys = _semantic_keys_for_scientific_spec(scientific_spec_json)
    if semantic_keys is None:
        return False
    return any(
        semantic_keys == supported_keys
        for supported_keys in H2_HARDWARE_EFFICIENT_SUPPORTED_SEMANTIC_KEY_SETS
    )


def _semantic_keys_for_scientific_spec(
    scientific_spec_json: dict[str, Any],
) -> dict[ComponentType, str] | None:
    """Parse either admitted portable identity version without weakening it."""

    try:
        if scientific_spec_json.get("schema_version") == "0.2.0":
            scientific_spec = PortableScientificExperimentSpec.model_validate(
                scientific_spec_json
            )
            return {
                binding.role: binding.component_semantic_key
                for binding in scientific_spec.component_bindings
            }
        scientific_spec_v03 = PortableScientificExperimentSpecV03.model_validate(
            scientific_spec_json
        )
        return {
            binding.role: binding.component_semantic_key
            for binding in scientific_spec_v03.component_bindings
            if binding.applicability == "required"
            and binding.component_semantic_key is not None
        }
    except (TypeError, ValueError):
        return None


def _capability_for_scientific_spec(
    scientific_spec_json: dict[str, Any],
) -> Capability | None:
    """Derive the executable capability from the frozen scientific identity."""

    semantic_keys = _semantic_keys_for_scientific_spec(scientific_spec_json)
    if semantic_keys is None:
        return None
    if semantic_keys in H2_UCCSD_SUPPORTED_SEMANTIC_KEY_SETS:
        return Capability.H2_STO3G_UCCSD_VQE
    if semantic_keys in H2_HARDWARE_EFFICIENT_SUPPORTED_SEMANTIC_KEY_SETS:
        return Capability.H2_STO3G_HARDWARE_EFFICIENT_VQE
    if semantic_keys in H2_SUPPORTED_SEMANTIC_KEY_SETS:
        return Capability.H2_STO3G_ACTUAL_VQE
    return None


# --- resource shapes ---------------------------------------------------


class ComponentSpecResource(BaseModel):
    artifact_version_id: uuid.UUID
    schema_version: str
    component_type: str
    semantic_key: str
    spec_json: dict[str, Any]
    normalized_spec_sha256: str
    machine_validation_state: str
    review_state: str
    created_at: dt.datetime | None


class ComponentSpecListResponse(BaseModel):
    components: list[ComponentSpecResource]
    next_cursor: uuid.UUID | None


class WorkflowComponentResource(BaseModel):
    id: uuid.UUID
    workflow_artifact_version_id: uuid.UUID
    component_role: str
    component_artifact_version_id: uuid.UUID
    ordinal: int
    binding_metadata: dict[str, Any] | None
    created_at: dt.datetime | None


class WorkflowResource(BaseModel):
    workflow_artifact_version_id: uuid.UUID
    schema_version: str
    spec_json: dict[str, Any]
    machine_validation_state: str
    review_state: str
    components: list[WorkflowComponentResource]


class CreateWorkflowSwapRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    baseline_workflow_artifact_version_id: uuid.UUID
    baseline_template_key: Literal["workflow.h2.fixed_excitation.v1"]
    changed_role: Literal["parameter_optimizer"]
    candidate_component_semantic_key: Literal[
        "optimizer.slsqp.v1",
        "optimizer.cobyla.v1",
    ]
    candidate_component_spec_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    configuration: dict[str, str] = Field(default_factory=dict, max_length=16)
    evaluator_provider: Literal["qiskit", "pennylane"]


class CreateAnsatzMigrationRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    baseline_workflow_artifact_version_id: uuid.UUID
    migration: Literal[
        "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
        "h2_uccsd_slsqp_to_hardware_efficient_slsqp",
    ]
    evaluator_provider: Literal["qiskit", "pennylane"]


class ResearchReviewDecisionRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, max_length=160)
    decision: Literal["accept", "reject", "edit", "acknowledge"]
    edited_value: Any = None
    rationale: str = Field(min_length=1, max_length=1000)


class CreateResearchCandidateReviewRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    candidate_local_id: str = Field(pattern=r"^candidate_[a-z0-9][a-z0-9_.-]{0,63}$")
    expected_envelope_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_candidate_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_evidence_bundle_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    disposition: Literal["accepted", "rejected", "needs_resolution"]
    decisions: list[ResearchReviewDecisionRequest] = Field(min_length=1, max_length=120)
    rationale: str = Field(min_length=1, max_length=2000)


class ResearchCandidateReviewRecordResource(BaseModel):
    id: uuid.UUID
    previous_review_id: uuid.UUID | None
    reviewer_user_id: uuid.UUID
    review_kind: Literal["workspace_human_review"]
    independence_state: Literal["not_asserted"]
    disposition: Literal["accepted", "rejected", "needs_resolution"]
    source_snapshot_sha256: str
    evidence_bundle_sha256: str
    base_candidate_sha256: str
    reviewed_candidate: dict[str, Any]
    reviewed_candidate_sha256: str
    decisions: list[dict[str, Any]]
    rationale: str
    review_sha256: str
    created_at: dt.datetime | None


class ResearchCandidateReviewViewResource(BaseModel):
    envelope_id: uuid.UUID
    envelope_sha256: str
    candidate: dict[str, Any]
    candidate_sha256: str
    source_snapshot_sha256: str
    evidence_bundle_sha256: str
    evidence: list[dict[str, Any]]
    latest_review: ResearchCandidateReviewRecordResource | None


class ResearchCandidateEnvelopeSummaryResource(BaseModel):
    id: uuid.UUID
    source_snapshot_id: uuid.UUID
    envelope_sha256: str
    input_bundle_sha256: str
    provider: str
    requested_model: str
    served_model: str
    machine_validation_state: str
    human_review_state: Literal["unreviewed"]
    publication_eligible: Literal[False]
    materialization_eligible: Literal[False]
    candidates: list[dict[str, Any]]
    created_at: dt.datetime | None


class ResearchCandidateEnvelopeListResponse(BaseModel):
    envelopes: list[ResearchCandidateEnvelopeSummaryResource]
    next_cursor: uuid.UUID | None


class CreateResearchCandidateReviewResponse(BaseModel):
    review: ResearchCandidateReviewRecordResource
    request_id: uuid.UUID
    replayed_review: bool
    replayed_request: bool


class MaterializeResearchCandidateReviewRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    expected_review_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_reviewed_candidate_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_evidence_bundle_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ResearchCandidateMaterializationResource(BaseModel):
    id: uuid.UUID
    envelope_id: uuid.UUID
    review_id: uuid.UUID
    artifact_id: uuid.UUID
    artifact_version_id: uuid.UUID
    materialization_schema_version: Literal["atlas.research-candidate-materialization.v1"]
    source_snapshot_sha256: str
    evidence_bundle_sha256: str
    review_sha256: str
    reviewed_candidate_sha256: str
    license_expression: str
    license_gate: Literal["source_declared_spdx_private_metadata_only_v1"]
    compatibility_contract: dict[str, Any]
    compatibility_contract_sha256: str
    materialized_bundle_sha256: str
    publication_eligible: Literal[False]
    execution_eligible: Literal[False]
    created_at: dt.datetime | None


class MaterializeResearchCandidateReviewResponse(BaseModel):
    materialization: ResearchCandidateMaterializationResource
    request_id: uuid.UUID
    replayed_materialization: bool
    replayed_request: bool


class WorkflowSwapResource(BaseModel):
    artifact_id: uuid.UUID
    workflow_artifact_version_id: uuid.UUID
    workflow_semantic_key: str
    request_sha256: str
    replayed: bool
    execution_status: Literal[
        "blocked_until_runtime_qualified",
        "private_qualification_candidate",
    ]
    visibility: Literal["private"] = "private"


class CapabilityStatus(BaseModel):
    capability: str
    available: bool
    reason: str | None


class CapabilitiesResponse(BaseModel):
    capabilities: list[CapabilityStatus]


class CreateExperimentRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    workflow_artifact_version_id: uuid.UUID
    expected_projection_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class CreateValidatedWorkflowDraftRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    source_workflow_artifact_version_id: uuid.UUID
    expected_projection_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    evaluator_provider: Literal["qiskit", "pennylane"] = "qiskit"


class LaunchBlockerResource(BaseModel):
    reason_code: str
    field: str
    retryable: bool


class ExperimentCreationProjectionResource(BaseModel):
    decision: Literal["eligible", "draft_required", "blocked"]
    launch_mode: Literal["direct", "validated_draft_required", "blocked"]
    primary_reason_code: str | None
    blockers: list[LaunchBlockerResource]


class FrameworkLaunchProjectionResource(BaseModel):
    framework: Literal["qiskit", "pennylane"]
    runtime_profile_id: str | None
    implementation_resolution: str
    runtime_qualification: str
    live_readiness: str
    readiness_generation: uuid.UUID | None
    readiness_expires_at: dt.datetime | None
    decision: Literal["eligible", "blocked"]
    primary_reason_code: str | None
    blockers: list[LaunchBlockerResource]


class WorkflowLaunchProjectionResource(BaseModel):
    workflow_artifact_version_id: uuid.UUID
    workflow_semantic_key: str
    registry_semantic_key: str | None
    machine_validation_state: str
    review_state: str
    definition_state: str
    composition_state: str
    execution_policy_state: str
    validated_draft_supported: bool
    experiment_creation: ExperimentCreationProjectionResource
    frameworks: list[FrameworkLaunchProjectionResource]
    projection_sha256: str
    registry_snapshot_sha256: str
    evaluated_at: dt.datetime
    expires_at: dt.datetime


class WorkflowLaunchProjectionListResponse(BaseModel):
    workflows: list[WorkflowLaunchProjectionResource]
    next_cursor: uuid.UUID | None


class ExperimentResource(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    schema_version: str
    workflow_artifact_version_id: uuid.UUID
    scientific_spec_json: dict[str, Any]
    scientific_spec_sha256: str
    registry_resolution_json: dict[str, Any]
    registry_resolution_sha256: str
    request_idempotency_key: str | None
    created_at: dt.datetime | None


class StartExecutionRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    requested_capability: Capability
    preferred_framework: Framework = Framework.QISKIT
    expected_projection_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ObservationResource(BaseModel):
    id: uuid.UUID
    execution_id: uuid.UUID
    attempt: int
    status: str
    result_contract_json: dict[str, Any]
    result_contract_sha256: str
    failure_code: str | None
    created_at: dt.datetime | None


class ExecutionResource(BaseModel):
    id: uuid.UUID
    experiment_id: uuid.UUID
    run_id: uuid.UUID | None
    framework: str
    runtime_profile_id: str
    runtime_image_digest: str
    adapter_release_id: str
    execution_identity_sha256: str
    status: str
    production_runtime_status: str
    public_execution: Literal["blocked"] = "blocked"
    review_state: Literal["unreviewed"] = "unreviewed"
    scientific_review: Literal["unreviewed"] = "unreviewed"
    execution_policy: Literal["owner_waived_private"] = "owner_waived_private"
    runtime_qualification: Literal["unqualified", "qualified_private"]
    publication: Literal["blocked"] = "blocked"
    observations: list[ObservationResource] = Field(default_factory=list)
    created_at: dt.datetime | None
    updated_at: dt.datetime | None


class MaterializedVqeArtifactResource(BaseModel):
    artifact_id: uuid.UUID
    artifact_version_id: uuid.UUID
    visibility: Literal["private"] = "private"
    publication: Literal["blocked"] = "blocked"
    scientific_release: Literal["blocked"] = "blocked"


class CreateControlledComparisonRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    baseline_workflow_artifact_version_id: uuid.UUID
    candidate_workflow_artifact_version_id: uuid.UUID
    changed_role: Literal["parameter_optimizer"]
    fixed_component_digests: dict[ComponentType, str] = Field(min_length=1)
    baseline_configuration: dict[str, str] = Field(max_length=32)
    candidate_configuration: dict[str, str] = Field(max_length=32)
    metric_protocol_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    budget_protocol_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ControlledComparisonRunResource(BaseModel):
    id: uuid.UUID
    comparison_spec_id: uuid.UUID
    baseline_execution_id: uuid.UUID
    candidate_execution_id: uuid.UUID
    status: str
    run_json: dict[str, Any]
    run_sha256: str
    created_at: dt.datetime | None


class FinalizeControlledComparisonRunRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    baseline_execution_id: uuid.UUID
    candidate_execution_id: uuid.UUID


class ControlledComparisonResource(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    baseline_workflow_artifact_version_id: uuid.UUID
    candidate_workflow_artifact_version_id: uuid.UUID
    changed_role: str
    spec_json: dict[str, Any]
    spec_sha256: str
    scientific_review: Literal["unreviewed"] = "unreviewed"
    execution_policy: Literal["owner_waived_private"] = "owner_waived_private"
    visibility: Literal["private"] = "private"
    publication: Literal["blocked"] = "blocked"
    runs: list[ControlledComparisonRunResource] = Field(default_factory=list)
    created_at: dt.datetime | None


def _to_observation_resource(row: VqeObservationRow) -> ObservationResource:
    return ObservationResource(
        id=row.id,
        execution_id=row.execution_id,
        attempt=row.attempt,
        status=row.status,
        result_contract_json=row.result_contract_json,
        result_contract_sha256=row.result_contract_sha256,
        failure_code=row.failure_code,
        created_at=row.created_at,
    )


def _to_comparison_run_resource(
    row: VqeControlledComparisonRunRow,
) -> ControlledComparisonRunResource:
    return ControlledComparisonRunResource(
        id=row.id,
        comparison_spec_id=row.comparison_spec_id,
        baseline_execution_id=row.baseline_execution_id,
        candidate_execution_id=row.candidate_execution_id,
        status=row.status,
        run_json=row.run_json,
        run_sha256=row.run_sha256,
        created_at=row.created_at,
    )


async def _to_controlled_comparison_resource(
    scope: CurrentScope,
    session: DbSession,
    row: VqeControlledComparisonSpecRow,
) -> ControlledComparisonResource:
    runs = await vqe_repo.list_controlled_comparison_runs(scope, session, row.id)
    return ControlledComparisonResource(
        id=row.id,
        workspace_id=row.workspace_id,
        baseline_workflow_artifact_version_id=row.baseline_workflow_artifact_version_id,
        candidate_workflow_artifact_version_id=row.candidate_workflow_artifact_version_id,
        changed_role=row.changed_role,
        spec_json=row.spec_json,
        spec_sha256=row.spec_sha256,
        scientific_review="unreviewed",
        execution_policy="owner_waived_private",
        visibility="private",
        publication="blocked",
        runs=[_to_comparison_run_resource(item) for item in runs],
        created_at=row.created_at,
    )


async def _to_execution_resource(
    scope: CurrentScope,
    session: DbSession,
    row: VqeExecutionRow,
) -> ExecutionResource:
    observations = await vqe_repo.list_observations(scope, session, row.id)
    binding = row.execution_binding_json
    production_runtime_status = binding.get(
        "production_runtime_status",
        "unqualified",
    )
    return ExecutionResource(
        id=row.id,
        experiment_id=row.experiment_id,
        run_id=row.run_id,
        framework=row.framework,
        runtime_profile_id=row.runtime_profile_id,
        runtime_image_digest=row.runtime_image_digest,
        adapter_release_id=row.adapter_release_id,
        execution_identity_sha256=row.execution_identity_sha256,
        status=row.status,
        production_runtime_status=production_runtime_status,
        runtime_qualification=(
            "qualified_private" if production_runtime_status == "qualified" else "unqualified"
        ),
        observations=[_to_observation_resource(item) for item in observations],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _to_component_spec_resource(row: VqeComponentSpecRow) -> ComponentSpecResource:
    return ComponentSpecResource(
        artifact_version_id=row.artifact_version_id,
        schema_version=row.schema_version,
        component_type=row.component_type,
        semantic_key=row.semantic_key,
        spec_json=row.spec_json,
        normalized_spec_sha256=row.normalized_spec_sha256,
        machine_validation_state=row.machine_validation_state,
        review_state=row.review_state,
        created_at=row.created_at,
    )


def _to_workflow_component_resource(row: VqeWorkflowComponentRow) -> WorkflowComponentResource:
    return WorkflowComponentResource(
        id=row.id,
        workflow_artifact_version_id=row.workflow_artifact_version_id,
        component_role=row.component_role,
        component_artifact_version_id=row.component_artifact_version_id,
        ordinal=row.ordinal,
        binding_metadata=row.binding_metadata,
        created_at=row.created_at,
    )


def _to_experiment_resource(row: VqeExperimentRow) -> ExperimentResource:
    return ExperimentResource(
        id=row.id,
        workspace_id=row.workspace_id,
        user_id=row.user_id,
        schema_version=row.schema_version,
        workflow_artifact_version_id=row.workflow_artifact_version_id,
        scientific_spec_json=row.scientific_spec_json,
        scientific_spec_sha256=row.scientific_spec_sha256,
        registry_resolution_json=row.registry_resolution_json,
        registry_resolution_sha256=row.registry_resolution_sha256,
        request_idempotency_key=row.request_idempotency_key,
        created_at=row.created_at,
    )


def _canonical_sha256(value: Any) -> str:
    """Hash one JSON value with the repository-wide canonical JSON rules."""

    return hashlib.sha256(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _launch_actor_hmac(scope: CurrentScope, settings: Settings) -> str:
    """Pseudonymise actors for the append-only launch ledger.

    Production must provide an independent HMAC key. Local development may
    derive one from its already-local bearer token, keeping tests and offline
    demos usable without weakening a deployed environment.
    """

    actor_key = getattr(settings, "vqe_decision_hmac_key", "")
    if not actor_key and getattr(settings, "environment", None) == "development":
        local_token = getattr(settings, "local_dev_token", "")
        if local_token:
            actor_key = f"majorana-development-vqe-ledger:{local_token}"
    if not actor_key:
        raise HTTPException(
            status_code=503,
            detail={
                "reason_code": "vqe_decision_ledger_unavailable",
                "message": "the server cannot record an auditable launch decision",
                "retryable": False,
            },
        )
    return hmac.new(
        actor_key.encode(),
        str(scope.user_id).encode(),
        hashlib.sha256,
    ).hexdigest()


_VALIDATED_DRAFT_WORKFLOW_KEYS = frozenset(
    {
        "workflow.h2.fixed_excitation.slsqp.v1",
        "workflow.h2.fixed_excitation.cobyla.v1",
        "workflow.h2.uccsd.v1",
        "workflow.h2.hardware_efficient.v1",
    }
)


def _runtime_profiles_for_workflow(row: VqeComponentSpecRow) -> tuple[Any, ...]:
    """Resolve the server-owned implementation family without trusting clients."""

    semantic_key = row.semantic_key
    migration = row.spec_json.get("migration")
    if semantic_key == "workflow.h2.uccsd.v1" or migration == (
        "h2_fixed_excitation_slsqp_to_uccsd_slsqp"
    ):
        profiles = uccsd_production_runtime_profiles()
        evaluator_provider = row.spec_json.get("evaluator_provider")
        if evaluator_provider in {"qiskit", "pennylane"}:
            return tuple(
                profile
                for profile in profiles
                if profile.binding.framework.value == evaluator_provider
            )
        return profiles
    if semantic_key == "workflow.h2.hardware_efficient.v1" or migration == (
        "h2_uccsd_slsqp_to_hardware_efficient_slsqp"
    ):
        profiles = hardware_efficient_production_runtime_profiles()
        evaluator_provider = row.spec_json.get("evaluator_provider")
        if evaluator_provider in {"qiskit", "pennylane"}:
            return tuple(
                profile
                for profile in profiles
                if profile.binding.framework.value == evaluator_provider
            )
        return profiles
    if semantic_key.startswith("workflow.lih.") or semantic_key == "workflow.h2.adapt.v1":
        return ()
    return production_runtime_profiles()


def _implementation_resolution_for_profile(
    *,
    row: VqeComponentSpecRow,
    links: list[VqeWorkflowComponentRow],
    profile: Any,
    composition_state: CompositionState,
    settings: Settings,
) -> ImplementationResolutionState:
    """Prove that one validated workflow is bound to one exact runtime.

    A qualified OCI image is not, by itself, evidence that an arbitrary
    Registry workflow can execute in that image.  Resolution is therefore
    admitted only for the small server-authored private slice whose strict
    scientific resolver has succeeded.  Framework-specific migrations must
    additionally carry exact runtime/adapter binding metadata on every role
    changed by the migration.
    """

    if composition_state is not CompositionState.MACHINE_VALIDATED:
        return ImplementationResolutionState.UNRESOLVED

    migration = row.spec_json.get("migration")
    if migration in {
        "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
        "h2_uccsd_slsqp_to_hardware_efficient_slsqp",
    } and not settings.vqe_production_execution:
        return ImplementationResolutionState.UNRESOLVED
    if (
        migration not in {
            "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
            "h2_uccsd_slsqp_to_hardware_efficient_slsqp",
        }
        and not (settings.vqe_candidate_execution or settings.vqe_production_execution)
    ):
        return ImplementationResolutionState.UNRESOLVED

    # The frozen H2 candidate and its server-validated optimizer swap are the
    # two portable v0.2 compositions implemented by both production adapters.
    if row.semantic_key == vqe_repo.H2_REVIEW_CANDIDATE_WORKFLOW_KEY:
        return ImplementationResolutionState.RESOLVED
    if (
        row.spec_json.get("kind") == "component_swap_workflow_draft"
        and row.spec_json.get("changed_role") == ComponentType.PARAMETER_OPTIMIZER.value
        and row.spec_json.get("candidate_component_semantic_key")
        in {"optimizer.slsqp.v1", "optimizer.cobyla.v1"}
        and row.spec_json.get("execution_status") == "private_qualification_candidate"
    ):
        evaluator_provider = row.spec_json.get("evaluator_provider")
        return (
            ImplementationResolutionState.RESOLVED
            if evaluator_provider == profile.binding.framework.value
            else ImplementationResolutionState.UNRESOLVED
        )

    required_bound_roles: set[str]
    if migration == "h2_fixed_excitation_slsqp_to_uccsd_slsqp":
        required_bound_roles = {
            ComponentType.ANSATZ.value,
            ComponentType.COMPILATION_BACKEND.value,
        }
    elif migration == "h2_uccsd_slsqp_to_hardware_efficient_slsqp":
        required_bound_roles = {
            ComponentType.ANSATZ.value,
            ComponentType.COMPILATION_BACKEND.value,
        }
    else:
        return ImplementationResolutionState.UNRESOLVED

    if row.spec_json.get("evaluator_provider") != profile.binding.framework.value:
        return ImplementationResolutionState.UNRESOLVED
    bindings_by_role = {
        link.component_role: link.binding_metadata or {}
        for link in links
        if link.component_role in required_bound_roles
    }
    if set(bindings_by_role) != required_bound_roles:
        return ImplementationResolutionState.UNRESOLVED
    for metadata in bindings_by_role.values():
        if (
            metadata.get("runtime_profile_id") != profile.binding.runtime_profile_id
            or metadata.get("adapter_release_id") != profile.binding.adapter_release_id
            or metadata.get("evidence_level") != "runtime_qualified"
            or metadata.get("runtime_qualification") != "private_qualified"
        ):
            return ImplementationResolutionState.UNRESOLVED
    return ImplementationResolutionState.RESOLVED


def _execution_policy_for_workflow(
    row: VqeComponentSpecRow,
    settings: Settings,
) -> ExecutionPolicyState:
    # Immutable standard definitions may be transformed into a private
    # validated draft without claiming scientific review or execution rights.
    if (
        row.machine_validation_state == MachineValidationState.UNVALIDATED.value
        and row.semantic_key in _VALIDATED_DRAFT_WORKFLOW_KEYS
    ):
        return ExecutionPolicyState.PERMITTED_PRIVATE
    if row.review_state in {
        ReviewState.HUMAN_REVIEWED.value,
        ReviewState.AUTHOR_CONFIRMED.value,
    }:
        return ExecutionPolicyState.PERMITTED_PRIVATE
    if settings.vqe_candidate_execution or settings.vqe_production_execution:
        return ExecutionPolicyState.OWNER_WAIVED_PRIVATE
    return ExecutionPolicyState.REVIEW_REQUIRED


async def _workflow_launch_projection(
    *,
    scope: CurrentScope,
    session: DbSession,
    settings: Settings,
    row: VqeComponentSpecRow,
    evaluated_at: dt.datetime | None = None,
) -> WorkflowLaunchProjectionResource:
    """Adapt durable Registry/worker state into the pure launch evaluator."""

    now = evaluated_at or dt.datetime.now(dt.timezone.utc)
    catalog_workspace_id = _catalog_workspace_id(settings)
    definition_state = DefinitionState.AVAILABLE
    composition_state = (
        CompositionState.MACHINE_VALIDATED
        if row.machine_validation_state == MachineValidationState.MACHINE_VALIDATED.value
        else CompositionState.UNVALIDATED
    )
    execution_policy = _execution_policy_for_workflow(row, settings)
    validated_draft_supported = row.semantic_key in _VALIDATED_DRAFT_WORKFLOW_KEYS

    links: list[VqeWorkflowComponentRow] = []
    component_snapshot: list[dict[str, Any]] = []
    try:
        links = await vqe_repo.list_workflow_components(
            scope,
            session,
            row.artifact_version_id,
            catalog_workspace_id=catalog_workspace_id,
        )
        for link in sorted(links, key=lambda item: (item.component_role, item.ordinal)):
            component = await vqe_repo.get_component_spec(
                scope,
                session,
                link.component_artifact_version_id,
                catalog_workspace_id=catalog_workspace_id,
            )
            component_snapshot.append(
                {
                    "role": link.component_role,
                    "ordinal": link.ordinal,
                    "artifact_version_id": str(component.artifact_version_id),
                    "semantic_key": component.semantic_key,
                    "normalized_spec_sha256": component.normalized_spec_sha256,
                    "machine_validation_state": component.machine_validation_state,
                    "review_state": component.review_state,
                }
            )
    except vqe_repo.NotFoundError:
        definition_state = DefinitionState.MISSING

    # Re-run the same strict scientific resolver used by creation.  This is a
    # preflight, not a substitute for the create-time re-evaluation below.
    if composition_state is CompositionState.MACHINE_VALIDATED:
        try:
            await vqe_repo.resolve_scientific_experiment_spec(
                scope,
                session,
                row.artifact_version_id,
                catalog_workspace_id=catalog_workspace_id,
                review_policy=(
                    "approved"
                    if execution_policy is ExecutionPolicyState.PERMITTED_PRIVATE
                    else "h2_owner_deferred_candidate"
                ),
            )
        except (vqe_repo.InvalidWorkflowCompositionError, vqe_repo.NotFoundError):
            composition_state = CompositionState.VALIDATION_FAILED

    framework_inputs: list[FrameworkLaunchInput] = []
    framework_snapshots: list[dict[str, Any]] = []
    expiry_candidates: list[dt.datetime] = []
    for profile in _runtime_profiles_for_workflow(row):
        binding = profile.binding
        implementation_resolution = _implementation_resolution_for_profile(
            row=row,
            links=links,
            profile=profile,
            composition_state=composition_state,
            settings=settings,
        )
        readiness = await vqe_repo.get_runtime_readiness(
            scope,
            session,
            runtime_profile_id=binding.runtime_profile_id,
        )
        if readiness is None:
            readiness_state = LiveReadinessState.UNKNOWN
            generation = None
            readiness_expires_at = None
        else:
            generation = readiness.generation
            readiness_expires_at = readiness.expires_at
            if readiness.expires_at <= now:
                readiness_state = LiveReadinessState.STALE
            elif readiness.status == "ready":
                readiness_state = LiveReadinessState.READY
            else:
                readiness_state = LiveReadinessState.UNAVAILABLE
            expiry_candidates.append(readiness.expires_at)
        framework_inputs.append(
            FrameworkLaunchInput(
                framework=binding.framework.value,
                implementation_resolution=implementation_resolution,
                runtime_qualification=(
                    RuntimeQualificationState.QUALIFIED
                    if binding.production_runtime_status == "qualified"
                    else RuntimeQualificationState.UNQUALIFIED
                ),
                live_readiness=readiness_state,
            )
        )
        framework_snapshots.append(
            {
                "framework": binding.framework.value,
                "runtime_profile_id": binding.runtime_profile_id,
                "implementation_resolution": implementation_resolution.value,
                "runtime_qualification": (
                    "qualified"
                    if binding.production_runtime_status == "qualified"
                    else "unqualified"
                ),
                "live_readiness": readiness_state.value,
                "readiness_generation": str(generation) if generation else None,
                "readiness_expires_at": (
                    readiness_expires_at.isoformat() if readiness_expires_at else None
                ),
            }
        )

    decision = evaluate_workflow_launch(
        WorkflowLaunchInput(
            definition_state=definition_state,
            composition_state=composition_state,
            execution_policy_state=execution_policy,
            validated_draft_supported=validated_draft_supported,
            frameworks=tuple(framework_inputs),
        )
    )
    registry_snapshot = {
        "workflow": {
            "artifact_version_id": str(row.artifact_version_id),
            "semantic_key": row.semantic_key,
            "normalized_spec_sha256": row.normalized_spec_sha256,
            "machine_validation_state": row.machine_validation_state,
            "review_state": row.review_state,
        },
        "components": component_snapshot,
    }
    registry_snapshot_sha256 = _canonical_sha256(registry_snapshot)
    stable_projection = {
        "workflow_artifact_version_id": str(row.artifact_version_id),
        "registry_snapshot_sha256": registry_snapshot_sha256,
        "definition_state": definition_state.value,
        "composition_state": composition_state.value,
        "execution_policy_state": execution_policy.value,
        "validated_draft_supported": validated_draft_supported,
        "experiment_creation": decision.experiment_creation.model_dump(mode="json"),
        "frameworks": [item.model_dump(mode="json") for item in decision.frameworks],
        "runtime_snapshots": framework_snapshots,
    }
    projection_sha256 = _canonical_sha256(stable_projection)
    expires_at = min(expiry_candidates) if expiry_candidates else now + dt.timedelta(seconds=30)
    framework_by_name = {item.framework: item for item in decision.frameworks}
    framework_resources = []
    for snapshot in framework_snapshots:
        framework_decision = framework_by_name[snapshot["framework"]]
        framework_resources.append(
            FrameworkLaunchProjectionResource(
                **snapshot,
                decision=framework_decision.decision.value,
                primary_reason_code=(
                    framework_decision.primary_reason_code.value
                    if framework_decision.primary_reason_code
                    else None
                ),
                blockers=[
                    LaunchBlockerResource(
                        reason_code=blocker.reason_code.value,
                        field=blocker.field,
                        retryable=blocker.retryable,
                    )
                    for blocker in framework_decision.blockers
                ],
            )
        )
    creation = decision.experiment_creation
    return WorkflowLaunchProjectionResource(
        workflow_artifact_version_id=row.artifact_version_id,
        workflow_semantic_key=row.semantic_key,
        registry_semantic_key=(
            row.spec_json.get("registry_semantic_key")
            if isinstance(row.spec_json.get("registry_semantic_key"), str)
            else None
        ),
        machine_validation_state=row.machine_validation_state,
        review_state=row.review_state,
        definition_state=definition_state.value,
        composition_state=composition_state.value,
        execution_policy_state=execution_policy.value,
        validated_draft_supported=validated_draft_supported,
        experiment_creation=ExperimentCreationProjectionResource(
            decision=creation.decision.value,
            launch_mode=creation.launch_mode.value,
            primary_reason_code=(
                creation.primary_reason_code.value if creation.primary_reason_code else None
            ),
            blockers=[
                LaunchBlockerResource(
                    reason_code=blocker.reason_code.value,
                    field=blocker.field,
                    retryable=blocker.retryable,
                )
                for blocker in creation.blockers
            ],
        ),
        frameworks=framework_resources,
        projection_sha256=projection_sha256,
        registry_snapshot_sha256=registry_snapshot_sha256,
        evaluated_at=now,
        expires_at=expires_at,
    )


def _to_research_review_resource(row) -> ResearchCandidateReviewRecordResource:
    return ResearchCandidateReviewRecordResource(
        id=row.id,
        previous_review_id=row.previous_review_id,
        reviewer_user_id=row.reviewer_user_id,
        review_kind=row.review_kind,
        independence_state=row.independence_state,
        disposition=row.disposition,
        source_snapshot_sha256=row.source_snapshot_sha256,
        evidence_bundle_sha256=row.evidence_bundle_sha256,
        base_candidate_sha256=row.base_candidate_sha256,
        reviewed_candidate=row.reviewed_candidate_json,
        reviewed_candidate_sha256=row.reviewed_candidate_sha256,
        decisions=row.decisions_json,
        rationale=row.rationale,
        review_sha256=row.review_sha256,
        created_at=row.created_at,
    )


def _to_research_materialization_resource(row) -> ResearchCandidateMaterializationResource:
    return ResearchCandidateMaterializationResource(
        id=row.id,
        envelope_id=row.envelope_id,
        review_id=row.review_id,
        artifact_id=row.artifact_id,
        artifact_version_id=row.artifact_version_id,
        materialization_schema_version=row.materialization_schema_version,
        source_snapshot_sha256=row.source_snapshot_sha256,
        evidence_bundle_sha256=row.evidence_bundle_sha256,
        review_sha256=row.review_sha256,
        reviewed_candidate_sha256=row.reviewed_candidate_sha256,
        license_expression=row.license_expression,
        license_gate=row.license_gate,
        compatibility_contract=row.compatibility_contract_json,
        compatibility_contract_sha256=row.compatibility_contract_sha256,
        materialized_bundle_sha256=row.materialized_bundle_sha256,
        publication_eligible=row.publication_eligible,
        execution_eligible=row.execution_eligible,
        created_at=row.created_at,
    )


# --- components ----------------------------------------------------------


@router.get("/atlas/components", response_model=ComponentSpecListResponse)
async def list_components(
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    component_type: ComponentType | None = None,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ComponentSpecListResponse:
    rows = await vqe_repo.list_component_specs(
        scope,
        session,
        component_type=component_type,
        cursor=cursor,
        limit=limit,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    next_cursor = rows[-1].artifact_version_id if len(rows) == limit else None
    return ComponentSpecListResponse(
        components=[_to_component_spec_resource(r) for r in rows],
        next_cursor=next_cursor,
    )


@router.get("/atlas/components/{artifact_version_id}", response_model=ComponentSpecResource)
async def get_component(
    artifact_version_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ComponentSpecResource:
    row = await vqe_repo.get_component_spec(
        scope,
        session,
        artifact_version_id,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    return _to_component_spec_resource(row)


# --- workflows -------------------------------------------------------------


@router.post(
    "/atlas/workflows/swaps",
    response_model=WorkflowSwapResource,
    status_code=201,
)
async def create_workflow_swap(
    body: CreateWorkflowSwapRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    request_idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
    ],
) -> WorkflowSwapResource:
    try:
        saved = await vqe_repo.save_component_swap_workflow_draft(
            scope,
            session,
            baseline_workflow_artifact_version_id=(body.baseline_workflow_artifact_version_id),
            baseline_template_key=body.baseline_template_key,
            changed_role=ComponentType(body.changed_role),
            candidate_component_semantic_key=body.candidate_component_semantic_key,
            candidate_component_spec_sha256=body.candidate_component_spec_sha256,
            configuration=tuple(sorted(body.configuration.items())),
            evaluator_provider=body.evaluator_provider,
            request_idempotency_key=request_idempotency_key,
            catalog_workspace_id=_catalog_workspace_id(settings),
        )
    except (vqe_repo.InvalidWorkflowCompositionError, vqe_repo.NotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except vqe_repo.IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    await _file_private_artifact(scope, session, identity, settings, saved.artifact.id)
    return WorkflowSwapResource(
        artifact_id=saved.artifact.id,
        workflow_artifact_version_id=saved.version.id,
        workflow_semantic_key=saved.workflow_spec.semantic_key,
        request_sha256=saved.version.fingerprint,
        replayed=saved.replayed,
        execution_status=saved.workflow_spec.spec_json["execution_status"],
    )


@router.post(
    "/atlas/workflows/ansatz-migrations",
    response_model=WorkflowSwapResource,
    status_code=201,
)
async def create_ansatz_migration(
    body: CreateAnsatzMigrationRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    request_idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
    ],
) -> WorkflowSwapResource:
    try:
        save = (
            vqe_repo.save_h2_uccsd_migration_workflow_draft
            if body.migration == "h2_fixed_excitation_slsqp_to_uccsd_slsqp"
            else vqe_repo.save_h2_hardware_efficient_migration_workflow_draft
        )
        saved = await save(
            scope,
            session,
            baseline_workflow_artifact_version_id=body.baseline_workflow_artifact_version_id,
            evaluator_provider=body.evaluator_provider,
            request_idempotency_key=request_idempotency_key,
            catalog_workspace_id=_catalog_workspace_id(settings),
        )
    except (vqe_repo.InvalidWorkflowCompositionError, vqe_repo.NotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except vqe_repo.IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    await _file_private_artifact(scope, session, identity, settings, saved.artifact.id)
    return WorkflowSwapResource(
        artifact_id=saved.artifact.id,
        workflow_artifact_version_id=saved.version.id,
        workflow_semantic_key=saved.workflow_spec.semantic_key,
        request_sha256=saved.version.fingerprint,
        replayed=saved.replayed,
        execution_status=saved.workflow_spec.spec_json["execution_status"],
    )


@router.get("/atlas/workflows", response_model=ComponentSpecListResponse)
async def list_workflows(
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ComponentSpecListResponse:
    rows = await vqe_repo.list_component_specs(
        scope,
        session,
        component_type=ComponentType.WORKFLOW,
        cursor=cursor,
        limit=limit,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    next_cursor = rows[-1].artifact_version_id if len(rows) == limit else None
    return ComponentSpecListResponse(
        components=[_to_component_spec_resource(r) for r in rows],
        next_cursor=next_cursor,
    )


@router.get("/atlas/workflows/{workflow_artifact_version_id}", response_model=WorkflowResource)
async def get_workflow(
    workflow_artifact_version_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> WorkflowResource:
    catalog_workspace_id = _catalog_workspace_id(settings)
    spec = await vqe_repo.get_component_spec(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if spec.component_type != ComponentType.WORKFLOW.value:
        raise HTTPException(status_code=404, detail="artifact version is not a workflow")
    components = await vqe_repo.list_workflow_components(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    return WorkflowResource(
        workflow_artifact_version_id=spec.artifact_version_id,
        schema_version=spec.schema_version,
        spec_json=spec.spec_json,
        machine_validation_state=spec.machine_validation_state,
        review_state=spec.review_state,
        components=[_to_workflow_component_resource(c) for c in components],
    )


@router.get(
    "/vqe/workflow-launch-projections",
    response_model=WorkflowLaunchProjectionListResponse,
)
async def list_workflow_launch_projections(
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> WorkflowLaunchProjectionListResponse:
    """List workflow launch truth, not the broader Registry catalog.

    Every item is evaluated from Registry state and the latest persisted
    worker heartbeat.  Clients must use ``projection_sha256`` when creating
    an experiment; the mutation recomputes the projection to close TOCTOU.
    """

    rows = await vqe_repo.list_component_specs(
        scope,
        session,
        component_type=ComponentType.WORKFLOW,
        cursor=cursor,
        limit=limit,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    evaluated_at = dt.datetime.now(dt.timezone.utc)
    projections = [
        await _workflow_launch_projection(
            scope=scope,
            session=session,
            settings=settings,
            row=row,
            evaluated_at=evaluated_at,
        )
        for row in rows
    ]
    return WorkflowLaunchProjectionListResponse(
        workflows=projections,
        next_cursor=rows[-1].artifact_version_id if len(rows) == limit else None,
    )


@router.get(
    "/vqe/workflow-launch-projections/{workflow_artifact_version_id}",
    response_model=WorkflowLaunchProjectionResource,
)
async def get_workflow_launch_projection(
    workflow_artifact_version_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> WorkflowLaunchProjectionResource:
    row = await vqe_repo.get_component_spec(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    if row.component_type != ComponentType.WORKFLOW.value:
        raise HTTPException(status_code=404, detail="artifact version is not a workflow")
    return await _workflow_launch_projection(
        scope=scope,
        session=session,
        settings=settings,
        row=row,
    )


@router.post(
    "/vqe/validated-workflow-drafts",
    response_model=WorkflowSwapResource,
    status_code=201,
)
async def create_validated_workflow_draft(
    body: CreateValidatedWorkflowDraftRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=160),
    ],
    request_id: Annotated[str | None, Header(alias="X-Request-ID", max_length=200)] = None,
) -> WorkflowSwapResource:
    """Derive one immutable, server-validated private draft from a seed.

    The authored standard seed remains unmodified.  The resulting artifact
    records its source definition, exact configured components, evaluator,
    and digest; no client can promote arbitrary Registry content.
    """

    catalog_workspace_id = _catalog_workspace_id(settings)
    source = await vqe_repo.get_component_spec(
        scope,
        session,
        body.source_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    projection = await _workflow_launch_projection(
        scope=scope,
        session=session,
        settings=settings,
        row=source,
    )
    source_workflow_artifact_version_id = source.artifact_version_id
    actor_hmac_sha256 = _launch_actor_hmac(scope, settings)

    async def record_draft_decision(
        *, decision: str, reason_code: str | None, derived_id: uuid.UUID | None = None
    ) -> None:
        await vqe_repo.append_launch_decision(
            scope,
            session,
            actor_hmac_sha256=actor_hmac_sha256,
            request_id=request_id or idempotency_key,
            action="create_validated_draft",
            workflow_artifact_version_id=source_workflow_artifact_version_id,
            experiment_id=None,
            decision=decision,
            primary_reason_code=reason_code,
            blockers_json=[
                item.model_dump(mode="json")
                for item in projection.experiment_creation.blockers
            ],
            projection_sha256=projection.projection_sha256,
            registry_snapshot_sha256=projection.registry_snapshot_sha256,
            readiness_snapshot_json=(
                [
                    {
                        "derived_workflow_artifact_version_id": str(derived_id),
                        "evaluator_provider": body.evaluator_provider,
                    }
                ]
                if derived_id
                else []
            ),
        )
        _observe_launch_decision(
            action="create_validated_draft",
            decision=decision,
            reason_code=reason_code,
            request_id=request_id or idempotency_key,
            workflow_artifact_version_id=source_workflow_artifact_version_id,
            projection_sha256=projection.projection_sha256,
            framework=body.evaluator_provider,
        )

    if (
        projection.projection_sha256 != body.expected_projection_sha256
        or projection.expires_at <= dt.datetime.now(dt.timezone.utc)
    ):
        await record_draft_decision(
            decision="stale_rejected", reason_code="vqe_launch_projection_stale"
        )
        await session.commit()
        raise HTTPException(
            status_code=412,
            detail={
                "reason_code": "vqe_launch_projection_stale",
                "message": "workflow launch state changed; refresh before deriving a draft",
                "retryable": True,
            },
        )
    if projection.experiment_creation.decision != "draft_required":
        await record_draft_decision(
            decision="blocked", reason_code="vqe_validated_draft_not_applicable"
        )
        await session.commit()
        raise HTTPException(
            status_code=422,
            detail={
                "reason_code": "vqe_validated_draft_not_applicable",
                "message": "this workflow is not an admitted standard seed",
                "retryable": False,
                "blockers": [
                    item.model_dump(mode="json")
                    for item in projection.experiment_creation.blockers
                ],
            },
        )

    optimizer_key = (
        "optimizer.cobyla.v1"
        if source.semantic_key == "workflow.h2.fixed_excitation.cobyla.v1"
        else "optimizer.slsqp.v1"
    )
    optimizer_digest = normalized_component_spec_digest(
        component_type=ComponentType.PARAMETER_OPTIMIZER,
        spec_json=standard_component_payload(optimizer_key),
    )
    # Resolve both inputs by scientific identity, never by list ordering.
    await vqe_repo.get_unique_component_by_semantic_digest(
        scope,
        session,
        semantic_key=optimizer_key,
        normalized_spec_sha256=optimizer_digest,
        catalog_workspace_id=catalog_workspace_id,
    )
    baseline = await vqe_repo.get_unique_component_by_semantic_digest(
        scope,
        session,
        semantic_key=vqe_repo.H2_REVIEW_CANDIDATE_WORKFLOW_KEY,
        normalized_spec_sha256=vqe_repo.H2_REVIEW_CANDIDATE_WORKFLOW_DIGEST,
        catalog_workspace_id=catalog_workspace_id,
    )
    try:
        saved = await vqe_repo.save_component_swap_workflow_draft(
            scope,
            session,
            baseline_workflow_artifact_version_id=baseline.artifact_version_id,
            baseline_template_key="workflow.h2.fixed_excitation.v1",
            changed_role=ComponentType.PARAMETER_OPTIMIZER,
            candidate_component_semantic_key=optimizer_key,
            candidate_component_spec_sha256=optimizer_digest,
            configuration=(),
            evaluator_provider=body.evaluator_provider,
            request_idempotency_key=f"{idempotency_key}:optimizer",
            catalog_workspace_id=catalog_workspace_id,
            source_definition_artifact_version_id=source.artifact_version_id,
        )
        if source.semantic_key in {
            "workflow.h2.uccsd.v1",
            "workflow.h2.hardware_efficient.v1",
        }:
            saved = await vqe_repo.save_h2_uccsd_migration_workflow_draft(
                scope,
                session,
                baseline_workflow_artifact_version_id=saved.version.id,
                evaluator_provider=body.evaluator_provider,
                request_idempotency_key=f"{idempotency_key}:uccsd",
                catalog_workspace_id=catalog_workspace_id,
            )
        if source.semantic_key == "workflow.h2.hardware_efficient.v1":
            saved = await vqe_repo.save_h2_hardware_efficient_migration_workflow_draft(
                scope,
                session,
                baseline_workflow_artifact_version_id=saved.version.id,
                evaluator_provider=body.evaluator_provider,
                request_idempotency_key=f"{idempotency_key}:hardware-efficient",
                catalog_workspace_id=catalog_workspace_id,
            )
    except vqe_repo.InvalidWorkflowCompositionError as exc:
        await session.rollback()
        await record_draft_decision(
            decision="invariant_rejected",
            reason_code="vqe_validated_draft_derivation_failed",
        )
        await session.commit()
        raise HTTPException(
            status_code=422,
            detail={
                "reason_code": "vqe_validated_draft_derivation_failed",
                "message": str(exc),
                "retryable": False,
            },
        ) from None
    except vqe_repo.IdempotencyConflictError as exc:
        await session.rollback()
        await record_draft_decision(
            decision="conflict_rejected",
            reason_code="vqe_validated_draft_idempotency_conflict",
        )
        await session.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "reason_code": "vqe_validated_draft_idempotency_conflict",
                "message": str(exc),
                "retryable": False,
            },
        ) from None

    await _file_private_artifact(scope, session, identity, settings, saved.artifact.id)
    await record_draft_decision(
        decision="accepted", reason_code=None, derived_id=saved.version.id
    )
    return WorkflowSwapResource(
        artifact_id=saved.artifact.id,
        workflow_artifact_version_id=saved.version.id,
        workflow_semantic_key=saved.workflow_spec.semantic_key,
        request_sha256=saved.version.fingerprint,
        replayed=saved.replayed,
        execution_status=saved.workflow_spec.spec_json["execution_status"],
    )


# --- comparisons (bundled corpus fixtures, not a DB table) -----------------


def _load_comparison(comparison_id: str) -> dict[str, Any] | None:
    """Load immutable comparison data from the packaged generated artifact.

    A source-tree fallback keeps direct editable installs usable before a
    wheel is built. Both representations are generated from the same Phase 2
    corpus and checked by the same CI generator command.
    """
    packaged = Path(__file__).resolve().parents[1] / "atlas_vqe_comparisons.generated.json"
    if packaged.exists():
        bundle = json.loads(packaged.read_text())
        return next(
            (
                comparison
                for comparison in bundle["comparisons"]
                if comparison["comparison_id"] == comparison_id
            ),
            None,
        )
    source_path = (
        Path(__file__).resolve().parents[5]
        / "docs"
        / "atlas"
        / "corpus"
        / "comparisons"
        / f"{comparison_id}.json"
    )
    try:
        return json.loads(source_path.read_text())
    except FileNotFoundError:
        return None


@router.get("/atlas/comparisons/{comparison_id}")
async def get_comparison(
    comparison_id: Annotated[str, PathParam(pattern=_COMPARISON_ID_PATTERN, max_length=200)],
    scope: CurrentScope,
) -> dict[str, Any]:
    comparison = _load_comparison(comparison_id)
    if comparison is None:
        raise HTTPException(status_code=404, detail="unknown comparison report") from None
    return comparison


# --- capabilities ------------------------------------------------------


@router.get("/vqe/capabilities", response_model=CapabilitiesResponse)
async def vqe_capabilities(scope: CurrentScope) -> CapabilitiesResponse:
    """Every capability this deployment could ever serve, and whether it is
    actually available right now. Phase 0 proved H2_STO3G_EXACT_ENERGY on
    independent spike runtimes, not on an approved production
    ExecutionBinding — so it is listed as unavailable until Phase 5 promotes
    a runtime profile out of CANDIDATE_UNVERIFIED (ADR-0025). Never report a
    capability as available without an actual promoted binding behind it.
    """
    return CapabilitiesResponse(
        capabilities=[
            CapabilityStatus(
                capability=Capability.H2_STO3G_EXACT_ENERGY.value,
                available=False,
                reason=(
                    "no runtime profile has been promoted out of "
                    "CANDIDATE_UNVERIFIED yet (ADR-0025, Phase 5B)"
                ),
            ),
            CapabilityStatus(
                capability=Capability.H2_STO3G_ACTUAL_VQE.value,
                available=False,
                reason=(
                    "local Phase 5A candidate execution is not a public capability; "
                    "human review and production runtime qualification remain pending"
                ),
            ),
            CapabilityStatus(
                capability=Capability.H2_STO3G_UCCSD_VQE.value,
                available=False,
                reason=(
                    "attested OCI runtimes exist for private qualification only; "
                    "public execution and scientific release remain blocked"
                ),
            ),
            CapabilityStatus(
                capability=Capability.H2_STO3G_HARDWARE_EFFICIENT_VQE.value,
                available=False,
                reason=(
                    "attested OCI runtimes exist for private qualification only; "
                    "public execution and scientific release remain blocked"
                ),
            ),
        ]
    )


# --- private research candidate review ---------------------------------


@router.get(
    "/vqe/research-candidates",
    response_model=ResearchCandidateEnvelopeListResponse,
)
async def list_research_candidate_envelopes(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ResearchCandidateEnvelopeListResponse:
    rows = await research_candidates_repo.list_research_candidate_envelopes(
        scope,
        session,
        cursor=cursor,
        limit=limit,
    )
    return ResearchCandidateEnvelopeListResponse(
        envelopes=[
            ResearchCandidateEnvelopeSummaryResource(
                id=row.id,
                source_snapshot_id=row.source_snapshot_id,
                envelope_sha256=row.envelope_sha256,
                input_bundle_sha256=row.input_bundle_sha256,
                provider=row.provider,
                requested_model=row.requested_model,
                served_model=row.served_model,
                machine_validation_state=row.machine_validation_state,
                human_review_state=row.human_review_state,
                publication_eligible=row.publication_eligible,
                materialization_eligible=row.materialization_eligible,
                candidates=[
                    {
                        "local_id": item["local_id"],
                        "candidate_type": item["candidate_type"],
                        "field_count": len(item["fields"]),
                        "unknown_count": len(item["unknowns"]),
                        "conflict_count": len(item["conflicts"]),
                    }
                    for item in row.envelope_json["response"]["candidates"]
                ],
                created_at=row.created_at,
            )
            for row in rows
        ],
        next_cursor=rows[-1].id if len(rows) == limit else None,
    )


@router.get(
    "/vqe/research-candidates/{envelope_id}/{candidate_local_id}",
    response_model=ResearchCandidateReviewViewResource,
)
async def get_research_candidate_review_view(
    envelope_id: uuid.UUID,
    candidate_local_id: str,
    scope: CurrentScope,
    session: DbSession,
) -> ResearchCandidateReviewViewResource:
    try:
        view = await research_candidates_repo.get_research_candidate_review_view(
            scope,
            session,
            envelope_id=envelope_id,
            candidate_local_id=candidate_local_id,
        )
    except research_candidates_repo.NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except research_candidates_repo.ResearchCandidateReviewError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": str(exc), "message": "candidate evidence is not reviewable"},
        ) from None
    return ResearchCandidateReviewViewResource(
        envelope_id=view.envelope_id,
        envelope_sha256=view.envelope_sha256,
        candidate=view.candidate,
        candidate_sha256=view.candidate_sha256,
        source_snapshot_sha256=view.source_snapshot_sha256,
        evidence_bundle_sha256=view.evidence_bundle_sha256,
        evidence=list(view.evidence),
        latest_review=(
            _to_research_review_resource(view.latest_review) if view.latest_review else None
        ),
    )


@router.post(
    "/vqe/research-candidates/{envelope_id}/reviews",
    response_model=CreateResearchCandidateReviewResponse,
    status_code=201,
)
async def create_research_candidate_review(
    envelope_id: uuid.UUID,
    body: CreateResearchCandidateReviewRequest,
    scope: CurrentScope,
    session: DbSession,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ],
) -> CreateResearchCandidateReviewResponse:
    try:
        persisted = await research_candidates_repo.create_research_candidate_review(
            scope,
            session,
            envelope_id=envelope_id,
            candidate_local_id=body.candidate_local_id,
            expected_envelope_sha256=body.expected_envelope_sha256,
            expected_candidate_sha256=body.expected_candidate_sha256,
            expected_evidence_bundle_sha256=body.expected_evidence_bundle_sha256,
            disposition=body.disposition,
            decisions=[item.model_dump(mode="json") for item in body.decisions],
            rationale=body.rationale,
            idempotency_key=idempotency_key,
        )
    except research_candidates_repo.AuthzError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except research_candidates_repo.NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except research_candidates_repo.ResearchCandidateReviewIdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except research_candidates_repo.ResearchCandidateReviewError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": str(exc), "message": "research review rejected"},
        ) from None
    return CreateResearchCandidateReviewResponse(
        review=_to_research_review_resource(persisted.review),
        request_id=persisted.request_id,
        replayed_review=persisted.replayed_review,
        replayed_request=persisted.replayed_request,
    )


@router.post(
    "/vqe/research-candidates/{envelope_id}/reviews/{review_id}/materialize",
    response_model=MaterializeResearchCandidateReviewResponse,
    status_code=201,
)
async def materialize_research_candidate_review(
    envelope_id: uuid.UUID,
    review_id: uuid.UUID,
    body: MaterializeResearchCandidateReviewRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ],
) -> MaterializeResearchCandidateReviewResponse:
    try:
        persisted = await research_candidates_repo.materialize_research_candidate_review(
            scope,
            session,
            envelope_id=envelope_id,
            review_id=review_id,
            expected_review_sha256=body.expected_review_sha256,
            expected_reviewed_candidate_sha256=body.expected_reviewed_candidate_sha256,
            expected_evidence_bundle_sha256=body.expected_evidence_bundle_sha256,
            idempotency_key=idempotency_key,
        )
    except research_candidates_repo.AuthzError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except research_candidates_repo.NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except research_candidates_repo.ResearchCandidateMaterializationIdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except research_candidates_repo.ResearchCandidateMaterializationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": str(exc), "message": "research candidate materialization rejected"},
        ) from None
    version = await artifacts_repo.get_version(
        scope,
        session,
        persisted.materialization.artifact_version_id,
    )
    await _file_private_artifact(scope, session, identity, settings, version.artifact_id)
    return MaterializeResearchCandidateReviewResponse(
        materialization=_to_research_materialization_resource(persisted.materialization),
        request_id=persisted.request_id,
        replayed_materialization=persisted.replayed_materialization,
        replayed_request=persisted.replayed_request,
    )


# --- experiments -------------------------------------------------------


@router.post("/vqe/experiments", response_model=ExperimentResource, status_code=201)
async def create_experiment(
    body: CreateExperimentRequest,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    request_idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
    ],
    request_id: Annotated[str | None, Header(alias="X-Request-ID", max_length=200)] = None,
) -> ExperimentResource:
    request_id = request_id or request_idempotency_key
    workflow = await vqe_repo.get_component_spec(
        scope,
        session,
        body.workflow_artifact_version_id,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    projection = await _workflow_launch_projection(
        scope=scope,
        session=session,
        settings=settings,
        row=workflow,
    )
    actor_hmac_sha256 = _launch_actor_hmac(scope, settings)
    readiness_snapshot = [
        {
            "framework": item.framework,
            "runtime_profile_id": item.runtime_profile_id,
            "live_readiness": item.live_readiness,
            "readiness_generation": (
                str(item.readiness_generation) if item.readiness_generation else None
            ),
            "readiness_expires_at": (
                item.readiness_expires_at.isoformat() if item.readiness_expires_at else None
            ),
        }
        for item in projection.frameworks
    ]

    async def record_decision(
        *,
        decision: str,
        experiment_id: uuid.UUID | None = None,
        reason_code: str | None = None,
        invariant_failure: bool = False,
    ) -> None:
        recorded_reason = reason_code or projection.experiment_creation.primary_reason_code
        await vqe_repo.append_launch_decision(
            scope,
            session,
            actor_hmac_sha256=actor_hmac_sha256,
            request_id=request_id,
            action="create_experiment",
            workflow_artifact_version_id=body.workflow_artifact_version_id,
            experiment_id=experiment_id,
            decision=decision,
            primary_reason_code=recorded_reason,
            blockers_json=[item.model_dump(mode="json") for item in projection.experiment_creation.blockers],
            projection_sha256=projection.projection_sha256,
            registry_snapshot_sha256=projection.registry_snapshot_sha256,
            readiness_snapshot_json=readiness_snapshot,
        )
        _observe_launch_decision(
            action="create_experiment",
            decision=decision,
            reason_code=recorded_reason,
            request_id=request_id,
            workflow_artifact_version_id=body.workflow_artifact_version_id,
            experiment_id=experiment_id,
            projection_sha256=projection.projection_sha256,
            invariant_failure=invariant_failure,
        )

    if (
        projection.projection_sha256 != body.expected_projection_sha256
        or projection.expires_at <= dt.datetime.now(dt.timezone.utc)
    ):
        await record_decision(decision="stale_rejected")
        # This transaction contains only the operational rejection record.  An
        # explicit commit is necessary because raising skips the dependency's
        # post-yield commit; no scientific mutation has occurred at this point.
        await session.commit()
        raise HTTPException(
            status_code=412,
            detail={
                "reason_code": "vqe_launch_projection_stale",
                "message": "workflow launch state changed; refresh the projection",
                "retryable": True,
            },
        )
    if projection.experiment_creation.decision != "eligible":
        await record_decision(decision="blocked")
        await session.commit()
        raise HTTPException(
            status_code=(
                403
                if projection.experiment_creation.primary_reason_code
                in {
                    "vqe_execution_policy_review_required",
                    "vqe_execution_policy_denied",
                }
                else 422
            ),
            detail={
                "reason_code": projection.experiment_creation.primary_reason_code,
                "message": "workflow is not eligible for direct experiment creation",
                "retryable": False,
                "blockers": [
                    item.model_dump(mode="json")
                    for item in projection.experiment_creation.blockers
                ],
            },
        )
    try:
        catalog_workspace_id = _catalog_workspace_id(settings)
        resolved = await vqe_repo.resolve_scientific_experiment_spec(
            scope,
            session,
            body.workflow_artifact_version_id,
            catalog_workspace_id=catalog_workspace_id,
            review_policy=(
                "h2_owner_deferred_candidate"
                if (
                    settings.vqe_candidate_execution
                    or getattr(settings, "vqe_production_execution", False)
                )
                else "approved"
            ),
        )
        experiment = await vqe_repo.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=body.workflow_artifact_version_id,
            resolved=resolved,
            request_idempotency_key=request_idempotency_key,
            catalog_workspace_id=catalog_workspace_id,
        )
        await record_decision(decision="accepted", experiment_id=experiment.id)
    except vqe_repo.InvalidWorkflowCompositionError as exc:
        # Projection and creation share the strict resolver.  Reaching this
        # branch after an eligible projection is an operational invariant
        # failure, not a normal user validation error.  Roll back any partial
        # scientific mutation, then persist only the rejection decision.
        await session.rollback()
        await record_decision(
            decision="invariant_rejected",
            reason_code="vqe_eligible_create_scientific_mismatch",
            invariant_failure=True,
        )
        await session.commit()
        raise HTTPException(
            status_code=422,
            detail={
                "reason_code": "vqe_eligible_create_scientific_mismatch",
                "message": "eligible projection contradicted the strict scientific resolver",
                "retryable": False,
            },
        ) from exc
    except vqe_repo.IdempotencyConflictError as exc:
        await session.rollback()
        await record_decision(
            decision="conflict_rejected",
            reason_code="vqe_experiment_idempotency_conflict",
        )
        await session.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "reason_code": "vqe_experiment_idempotency_conflict",
                "message": str(exc),
                "retryable": False,
            },
        ) from None
    return _to_experiment_resource(experiment)


@router.get("/vqe/experiments/{experiment_id}", response_model=ExperimentResource)
async def get_experiment(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> ExperimentResource:
    experiment = await vqe_repo.get_experiment(scope, session, experiment_id)
    return _to_experiment_resource(experiment)


@router.post(
    "/vqe/controlled-comparisons",
    response_model=ControlledComparisonResource,
    status_code=201,
)
async def create_controlled_comparison(
    body: CreateControlledComparisonRequest,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    request_idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
    ],
) -> ControlledComparisonResource:
    try:
        spec = ControlledComparisonSpecV1.model_validate(body.model_dump())
        row = await vqe_repo.create_controlled_comparison_spec(
            scope,
            session,
            spec=spec,
            request_idempotency_key=request_idempotency_key,
            catalog_workspace_id=_catalog_workspace_id(settings),
        )
    except vqe_repo.ComparisonIntegrityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except vqe_repo.IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return await _to_controlled_comparison_resource(scope, session, row)


@router.get(
    "/vqe/controlled-comparisons/{comparison_spec_id}",
    response_model=ControlledComparisonResource,
)
async def get_controlled_comparison(
    comparison_spec_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ControlledComparisonResource:
    row = await vqe_repo.get_controlled_comparison_spec(scope, session, comparison_spec_id)
    return await _to_controlled_comparison_resource(scope, session, row)


@router.post(
    "/vqe/controlled-comparisons/{comparison_spec_id}/runs",
    response_model=ControlledComparisonRunResource,
    status_code=201,
)
async def finalize_controlled_comparison_run(
    comparison_spec_id: uuid.UUID,
    body: FinalizeControlledComparisonRunRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ControlledComparisonRunResource:
    try:
        row = await vqe_repo.finalize_controlled_comparison_run(
            scope,
            session,
            comparison_spec_id=comparison_spec_id,
            baseline_execution_id=body.baseline_execution_id,
            candidate_execution_id=body.candidate_execution_id,
        )
    except vqe_repo.ComparisonIntegrityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return _to_comparison_run_resource(row)


@router.get(
    "/vqe/experiments/{experiment_id}/executions",
    response_model=list[ExecutionResource],
)
async def list_executions(
    experiment_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> list[ExecutionResource]:
    rows = await vqe_repo.list_executions(scope, session, experiment_id)
    return [await _to_execution_resource(scope, session, row) for row in rows]


@router.post(
    "/vqe/experiments/{experiment_id}/executions",
    response_model=ExecutionResource,
    status_code=201,
)
async def start_execution(
    experiment_id: uuid.UUID,
    body: StartExecutionRequest,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ],
    request_id: Annotated[str | None, Header(alias="X-Request-ID", max_length=200)] = None,
) -> ExecutionResource:
    if not (
        settings.vqe_candidate_execution or getattr(settings, "vqe_production_execution", False)
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "candidate_execution_disabled",
                "message": (
                    "VQE execution is blocked; enable one server-owned private "
                    "execution gate explicitly"
                ),
            },
        )
    experiment = await vqe_repo.get_experiment(scope, session, experiment_id)
    workflow = await vqe_repo.get_component_spec(
        scope,
        session,
        experiment.workflow_artifact_version_id,
        catalog_workspace_id=_catalog_workspace_id(settings),
    )
    projection = await _workflow_launch_projection(
        scope=scope,
        session=session,
        settings=settings,
        row=workflow,
    )
    framework_projection = next(
        (
            item
            for item in projection.frameworks
            if item.framework == body.preferred_framework.value
        ),
        None,
    )
    actor_hmac_sha256 = _launch_actor_hmac(scope, settings)
    readiness_snapshot = [
        {
            "framework": item.framework,
            "runtime_profile_id": item.runtime_profile_id,
            "live_readiness": item.live_readiness,
            "readiness_generation": (
                str(item.readiness_generation) if item.readiness_generation else None
            ),
            "readiness_expires_at": (
                item.readiness_expires_at.isoformat() if item.readiness_expires_at else None
            ),
        }
        for item in projection.frameworks
    ]

    async def record_start_decision(decision: str, reason_code: str | None) -> None:
        blockers = framework_projection.blockers if framework_projection else []
        await vqe_repo.append_launch_decision(
            scope,
            session,
            actor_hmac_sha256=actor_hmac_sha256,
            request_id=request_id or idempotency_key,
            action="start_execution",
            workflow_artifact_version_id=experiment.workflow_artifact_version_id,
            experiment_id=experiment.id,
            decision=decision,
            primary_reason_code=reason_code,
            blockers_json=[item.model_dump(mode="json") for item in blockers],
            projection_sha256=projection.projection_sha256,
            registry_snapshot_sha256=projection.registry_snapshot_sha256,
            readiness_snapshot_json=readiness_snapshot,
        )
        _observe_launch_decision(
            action="start_execution",
            decision=decision,
            reason_code=reason_code,
            request_id=request_id or idempotency_key,
            workflow_artifact_version_id=experiment.workflow_artifact_version_id,
            experiment_id=experiment.id,
            projection_sha256=projection.projection_sha256,
            framework=body.preferred_framework.value,
        )

    now = dt.datetime.now(dt.timezone.utc)
    if (
        body.expected_projection_sha256 != projection.projection_sha256
        or projection.expires_at <= now
    ):
        await record_start_decision("stale_rejected", "vqe_launch_projection_stale")
        await session.commit()
        raise HTTPException(
            status_code=412,
            detail={
                "reason_code": "vqe_launch_projection_stale",
                "message": "runtime readiness changed; refresh before starting",
                "retryable": True,
            },
        )
    if framework_projection is None or framework_projection.decision != "eligible":
        reason_code = (
            framework_projection.primary_reason_code
            if framework_projection
            else "vqe_implementation_unresolved"
        )
        await record_start_decision("blocked", reason_code)
        await session.commit()
        raise HTTPException(
            status_code=(
                503
                if reason_code
                in {
                    "vqe_runtime_unavailable",
                    "vqe_runtime_readiness_stale",
                    "vqe_runtime_readiness_unknown",
                }
                else 422
            ),
            detail={
                "reason_code": reason_code,
                "message": "the selected framework is not ready for this workflow",
                "retryable": bool(
                    framework_projection
                    and any(item.retryable for item in framework_projection.blockers)
                ),
                "blockers": (
                    [item.model_dump(mode="json") for item in framework_projection.blockers]
                    if framework_projection
                    else []
                ),
            },
        )
    production_execution = getattr(settings, "vqe_production_execution", False)
    expected_capability = _capability_for_scientific_spec(experiment.scientific_spec_json)
    if expected_capability is None or body.requested_capability is not expected_capability:
        await record_start_decision("blocked", "vqe_capability_identity_mismatch")
        await session.commit()
        raise HTTPException(
            status_code=422,
            detail={
                "reason_code": "vqe_capability_identity_mismatch",
                "message": "requested capability does not match the frozen scientific identity",
                "retryable": False,
            },
        )
    if body.requested_capability is Capability.H2_STO3G_ACTUAL_VQE:
        # The old Phase 5A profile used a one-machine Docker image ID.  That
        # identity cannot be fetched again after Docker storage is reset, even
        # when the exact source tree is rebuilt.  Both private development and
        # production therefore bind the published, attested OCI digest.  The
        # execution/review/publication gates remain separate and fail closed.
        profile = production_runtime_profile(body.preferred_framework)
    elif body.requested_capability is Capability.H2_STO3G_UCCSD_VQE:
        if not production_execution:
            await record_start_decision("blocked", "vqe_production_execution_gate_disabled")
            await session.commit()
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "uccsd_requires_qualified_runtime",
                    "message": (
                        "H2 UCCSD execution requires the server-owned, "
                        "digest-pinned production runtime gate"
                    ),
                },
            )
        if not _matches_h2_uccsd_component_identity(experiment.scientific_spec_json):
            await record_start_decision("blocked", "vqe_capability_identity_mismatch")
            await session.commit()
            raise HTTPException(
                status_code=422,
                detail={
                    "reason_code": "vqe_capability_identity_mismatch",
                    "message": (
                        "requested H2 UCCSD capability does not match the experiment "
                        "component identity"
                    ),
                    "retryable": False,
                },
            )
        profile = uccsd_production_runtime_profile(body.preferred_framework)
    elif body.requested_capability is Capability.H2_STO3G_HARDWARE_EFFICIENT_VQE:
        if not production_execution:
            await record_start_decision("blocked", "vqe_production_execution_gate_disabled")
            await session.commit()
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "hardware_efficient_requires_qualified_runtime",
                    "message": (
                        "H2 hardware-efficient execution requires the server-owned, "
                        "digest-pinned production runtime gate"
                    ),
                },
            )
        if not _matches_h2_hardware_efficient_component_identity(experiment.scientific_spec_json):
            await record_start_decision("blocked", "vqe_capability_identity_mismatch")
            await session.commit()
            raise HTTPException(
                status_code=422,
                detail={
                    "reason_code": "vqe_capability_identity_mismatch",
                    "message": (
                        "requested H2 hardware-efficient capability does not match "
                        "the experiment component identity"
                    ),
                    "retryable": False,
                },
            )
        profile = hardware_efficient_production_runtime_profile(body.preferred_framework)
    else:
        await record_start_decision("blocked", "vqe_capability_unsupported")
        await session.commit()
        raise HTTPException(
            status_code=422,
            detail={
                "reason_code": "vqe_capability_unsupported",
                "message": "unsupported private VQE capability",
                "retryable": False,
            },
        )
    execution = await vqe_repo.create_execution(
        scope,
        session,
        experiment.id,
        binding=profile.binding,
    )
    if execution.run_id is None:
        run_key = f"vqe-execution-{execution.execution_identity_sha256}-{idempotency_key}"
        run = await runs_repo.find_run_by_idempotency_key(scope, session, run_key)
        if run is None:
            run = await runs_repo.create_run(
                scope,
                session,
                task_prompt=(
                    "Execute the frozen unreviewed, owner-policy private "
                    f"{body.requested_capability.value} "
                    f"candidate with {profile.binding.framework.value}"
                ),
                mode=RunMode.EXECUTE,
                framework=ContractFramework(profile.binding.framework.value),
                seed=experiment.scientific_spec_json["seed"],
                timeout_s=300,
                idempotency_key=run_key,
            )
            await runs_repo.append_run_event(
                scope,
                session,
                run.id,
                type="run.queued",
                payload={
                    "mode": RunMode.EXECUTE.value,
                    "framework": profile.binding.framework.value,
                },
            )
        execution = await vqe_repo.bind_execution_run(
            scope,
            session,
            execution.id,
            run_id=run.id,
        )
        await system.enqueue_job(
            session,
            kind=VQE_EXECUTE_JOB_KIND,
            payload={
                "execution_id": str(execution.id),
                "run_id": str(run.id),
                "workspace_id": str(scope.workspace_id),
                "user_id": str(scope.user_id),
            },
            run_id=run.id,
        )
    await record_start_decision("accepted", None)
    return await _to_execution_resource(scope, session, execution)


@router.get(
    "/vqe/executions/{execution_id}",
    response_model=ExecutionResource,
)
async def get_execution(
    execution_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ExecutionResource:
    execution = await vqe_repo.get_execution(scope, session, execution_id)
    return await _to_execution_resource(scope, session, execution)


@router.post("/vqe/experiments/{experiment_id}/cancel")
async def cancel_experiment(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> list[ExecutionResource]:
    executions = await vqe_repo.list_executions(scope, session, experiment_id)
    if not executions:
        raise HTTPException(status_code=409, detail="experiment has no execution to cancel")
    changed: list[VqeExecutionRow] = []
    for execution in executions:
        if execution.status not in {"planned", "queued", "running"}:
            changed.append(execution)
            continue
        if execution.run_id is not None:
            run = await runs_repo.get_run(scope, session, execution.run_id, for_update=True)
            if RunStatus(run.status) in {RunStatus.QUEUED, RunStatus.RUNNING}:
                await runs_repo.finish_run(
                    scope,
                    session,
                    run.id,
                    RunStatus.CANCELLED,
                    event_payload={"status": RunStatus.CANCELLED.value},
                    event_id=uuid.uuid5(run.id, "run.finished"),
                )
        changed.append(
            await vqe_repo.transition_execution(
                scope,
                session,
                execution.id,
                new_status="cancelled",
            )
        )
    return [await _to_execution_resource(scope, session, row) for row in changed]


@router.get("/vqe/experiments/{experiment_id}/events", deprecated=True)
async def experiment_events(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> list[ExecutionResource]:
    return await list_executions(experiment_id, scope, session)


@router.post(
    "/vqe/executions/{execution_id}/materialize",
    response_model=MaterializedVqeArtifactResource,
)
async def materialize_execution(
    execution_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> MaterializedVqeArtifactResource:
    execution = await vqe_repo.get_execution(scope, session, execution_id)
    if execution.status != "succeeded":
        raise HTTPException(status_code=409, detail="VQE execution has not succeeded")
    observations = await vqe_repo.list_observations(scope, session, execution.id)
    successful = [item for item in observations if item.status == "succeeded"]
    if not successful:
        raise HTTPException(status_code=409, detail="successful execution lacks evidence")
    observation = successful[-1]
    if execution.run_id is None:
        raise HTTPException(status_code=409, detail="successful execution lacks a durable run")
    experiment = await vqe_repo.get_experiment(scope, session, execution.experiment_id)
    runtime_status = execution.execution_binding_json.get(
        "production_runtime_status",
        "unqualified",
    )
    if runtime_status not in {"unqualified", "qualified"}:
        raise HTTPException(status_code=409, detail="unknown VQE runtime qualification state")
    run = await runs_repo.get_run(scope, session, execution.run_id)
    if run.artifact_version_id is not None:
        version = await artifacts_repo.get_version(scope, session, run.artifact_version_id)
        artifact = await artifacts_repo.get_artifact(scope, session, version.artifact_id)
        await _file_private_artifact(scope, session, identity, settings, artifact.id)
        return MaterializedVqeArtifactResource(
            artifact_id=artifact.id,
            artifact_version_id=version.id,
        )
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=f"h2-vqe-candidate-{execution.id}",
        title=f"H2 STO-3G VQE candidate — {execution.framework}",
        family=Algorithm.VQE,
        framework=ContractFramework(execution.framework),
        kept=False,
    )
    bundle = {
        "schema_version": "0.1.0",
        "kind": "majorana_vqe_execution_bundle",
        "scientific_experiment": {
            "spec": experiment.scientific_spec_json,
            "spec_sha256": experiment.scientific_spec_sha256,
            "registry_resolution": experiment.registry_resolution_json,
            "registry_resolution_sha256": experiment.registry_resolution_sha256,
        },
        "execution": {
            "id": str(execution.id),
            "binding": execution.execution_binding_json,
            "identity_sha256": execution.execution_identity_sha256,
        },
        "observation": {
            "id": str(observation.id),
            "attempt": observation.attempt,
            "result": observation.result_contract_json,
            "result_contract_sha256": observation.result_contract_sha256,
        },
    }
    evidence_bytes = json.dumps(bundle, sort_keys=True, indent=2).encode()
    fingerprint = hashlib.sha256(evidence_bytes).hexdigest()
    version = await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "vqe_private_execution",
            "scientific_review_state": "unreviewed",
            "execution_policy": "owner_waived_private",
            "production_runtime_status": runtime_status,
            "publication": "blocked",
            "scientific_release": "blocked",
            "execution_id": str(execution.id),
            "scientific_spec_sha256": experiment.scientific_spec_sha256,
            "registry_resolution_sha256": experiment.registry_resolution_sha256,
            "execution_identity_sha256": execution.execution_identity_sha256,
            "result_contract_sha256": observation.result_contract_sha256,
            "canonical_circuit_sha256": observation.result_contract_json.get(
                "canonical_circuit_sha256"
            ),
            "compilation_protocol_sha256": observation.result_contract_json.get(
                "compilation_protocol_sha256"
            ),
            "verification_summary": {
                "verified": False,
                "decision": None,
                "evidence_strength": None,
                "reason_code": "independent_human_review_not_performed",
            },
        },
        code=evidence_bytes.decode(),
        code_lang="json",
        fingerprint=fingerprint,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="candidate scientific evidence is not an executable circuit export",
        # The execution contract records one resource row per compilation
        # stage, while ArtifactVersion deliberately exposes a mapping so the
        # representation can be extended without changing its top-level type.
        # Preserve every stage instead of storing the raw list, which cannot
        # be deserialized through the public artifact contract.
        resource_estimates={
            "stages": observation.result_contract_json.get("resources", []),
        },
        limitations=(
            "Private VQE evidence; independent human scientific review was not "
            "performed. The owner policy permits private execution only, and "
            "publication remains blocked."
        ),
    )
    await runs_repo.set_run_artifact_version(scope, session, run.id, version.id)
    await _file_private_artifact(scope, session, identity, settings, artifact.id)
    return MaterializedVqeArtifactResource(
        artifact_id=artifact.id,
        artifact_version_id=version.id,
    )
