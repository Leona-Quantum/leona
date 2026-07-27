"""Atlas VQE registry, comparisons, and portable experiments (Phase 4.5).

GET /v1/atlas/comparisons/{id} reads directly from the bundled
docs/atlas/corpus/comparisons/*.json files rather than a DB table: the
plan's own Phase 3 DB-responsibilities list has no comparisons table, and
Phase 2's comparison reports are versioned, machine-generated corpus data
(ADR-0026), not per-workspace mutable state.

Phase 5A candidate execution is available only when a local-development
feature gate is enabled. It reuses durable runs/jobs/events while public
capability and scientific promotion remain blocked.
"""

import datetime as dt
import hashlib
import json
import uuid
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi import Path as PathParam
from majorana_contracts.enums import Algorithm, ExportStatus, RunMode, RunStatus
from majorana_contracts.enums import Framework as ContractFramework
from majorana_vqe.models import Capability, ComponentType, Framework
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession, get_settings
from ..jobs import VQE_EXECUTE_JOB_KIND
from ..orm import VqeComponentSpec as VqeComponentSpecRow
from ..orm import VqeExperiment as VqeExperimentRow
from ..orm import VqeExecution as VqeExecutionRow
from ..orm import VqeObservation as VqeObservationRow
from ..orm import VqeWorkflowComponent as VqeWorkflowComponentRow
from ..repos import artifacts as artifacts_repo
from ..repos import runs as runs_repo
from ..repos import system
from ..repos import vqe as vqe_repo
from ..settings import Settings
from ..vqe_runtime_profiles import candidate_runtime_profile, production_runtime_profile

router = APIRouter()

_COMPARISON_ID_PATTERN = r"^[a-zA-Z0-9_]+$"


def _catalog_workspace_id(settings: Settings) -> uuid.UUID | None:
    """Return only the server-owned catalog workspace identifier.

    A request body or query parameter must never be able to choose the
    authority against which public registry entries are resolved.
    """
    return (
        settings.catalog_authority.workspace_id if settings.catalog_authority.configured else None
    )


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


class CreateWorkflowSwapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_workflow_artifact_version_id: uuid.UUID
    baseline_template_key: Literal["workflow.h2.fixed_excitation.v1"]
    changed_role: Literal["parameter_optimizer"]
    candidate_component_semantic_key: Literal["optimizer.slsqp.v1"]
    candidate_component_spec_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    configuration: dict[str, str] = Field(default_factory=dict, max_length=16)
    evaluator_provider: Literal["qiskit", "pennylane"]


class WorkflowSwapResource(BaseModel):
    artifact_id: uuid.UUID
    workflow_artifact_version_id: uuid.UUID
    workflow_semantic_key: str
    request_sha256: str
    replayed: bool
    execution_status: Literal["blocked_until_runtime_qualified"]
    visibility: Literal["private"] = "private"


class CapabilityStatus(BaseModel):
    capability: str
    available: bool
    reason: str | None


class CapabilitiesResponse(BaseModel):
    capabilities: list[CapabilityStatus]


class CreateExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_artifact_version_id: uuid.UUID


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


class StartExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_capability: Capability
    preferred_framework: Framework = Framework.QISKIT


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
    review_state: Literal["owner_waived"] = "owner_waived"
    observations: list[ObservationResource] = Field(default_factory=list)
    created_at: dt.datetime | None
    updated_at: dt.datetime | None


class MaterializedVqeArtifactResource(BaseModel):
    artifact_id: uuid.UUID
    artifact_version_id: uuid.UUID
    visibility: Literal["private"] = "private"
    publication: Literal["blocked"] = "blocked"
    scientific_release: Literal["blocked"] = "blocked"


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


async def _to_execution_resource(
    scope: CurrentScope,
    session: DbSession,
    row: VqeExecutionRow,
) -> ExecutionResource:
    observations = await vqe_repo.list_observations(scope, session, row.id)
    binding = row.execution_binding_json
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
        production_runtime_status=binding.get(
            "production_runtime_status",
            "unqualified",
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
    settings: Annotated[Settings, Depends(get_settings)],
    request_idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
    ],
) -> WorkflowSwapResource:
    try:
        saved = await vqe_repo.save_component_swap_workflow_draft(
            scope,
            session,
            baseline_workflow_artifact_version_id=(
                body.baseline_workflow_artifact_version_id
            ),
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
    return WorkflowSwapResource(
        artifact_id=saved.artifact.id,
        workflow_artifact_version_id=saved.version.id,
        workflow_semantic_key=saved.workflow_spec.semantic_key,
        request_sha256=saved.version.fingerprint,
        replayed=saved.replayed,
        execution_status="blocked_until_runtime_qualified",
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
    a runtime profile out of CANDIDATE_UNVERIFIED (ADR-0024). Never report a
    capability as available without an actual promoted binding behind it.
    """
    return CapabilitiesResponse(
        capabilities=[
            CapabilityStatus(
                capability=Capability.H2_STO3G_EXACT_ENERGY.value,
                available=False,
                reason=(
                    "no runtime profile has been promoted out of "
                    "CANDIDATE_UNVERIFIED yet (ADR-0024, Phase 5B)"
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
        ]
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
) -> ExperimentResource:
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
    except vqe_repo.InvalidWorkflowCompositionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except vqe_repo.IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return _to_experiment_resource(experiment)


@router.get("/vqe/experiments/{experiment_id}", response_model=ExperimentResource)
async def get_experiment(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> ExperimentResource:
    experiment = await vqe_repo.get_experiment(scope, session, experiment_id)
    return _to_experiment_resource(experiment)


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
    if body.requested_capability is not Capability.H2_STO3G_ACTUAL_VQE:
        raise HTTPException(status_code=422, detail="unsupported Phase 5A capability")
    experiment = await vqe_repo.get_experiment(scope, session, experiment_id)
    profile = (
        production_runtime_profile(body.preferred_framework)
        if getattr(settings, "vqe_production_execution", False)
        else candidate_runtime_profile(body.preferred_framework)
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
                    "Execute the frozen owner-waived H2 STO-3G actual-VQE "
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
    execution_id: uuid.UUID, scope: CurrentScope, session: DbSession
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
            "human_review_state": "owner_waived",
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
                "reason_code": ("independent_human_review_owner_waived_publication_blocked"),
            },
        },
        code=evidence_bytes.decode(),
        code_lang="json",
        fingerprint=fingerprint,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="candidate scientific evidence is not an executable circuit export",
        resource_estimates=observation.result_contract_json.get("resources"),
        limitations=(
            "Private VQE evidence; independent human review was owner-waived "
            "and publication remains blocked."
        ),
    )
    await runs_repo.set_run_artifact_version(scope, session, run.id, version.id)
    return MaterializedVqeArtifactResource(
        artifact_id=artifact.id,
        artifact_version_id=version.id,
    )
