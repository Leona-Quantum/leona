"""Atlas VQE Component Registry, Workflows, Comparisons, and Experiments
(Phase 3, plan Part IV "API candidate", ADR-0023/0024/0025).

GET /v1/atlas/comparisons/{id} reads directly from the bundled
docs/atlas/corpus/comparisons/*.json files rather than a DB table: the
plan's own Phase 3 DB-responsibilities list has no comparisons table, and
Phase 2's comparison reports are versioned, machine-generated corpus data
(ADR-0026), not per-workspace mutable state.

POST /v1/vqe/experiments/{id}/cancel, GET .../events, and POST
.../materialize are honest stubs, not fake success: vqe_experiments never
creates a `runs` row in Phase 3 (no approved ExecutionBinding exists until
Phase 5 resolves one against a runtime promoted out of CANDIDATE_UNVERIFIED,
ADR-0024), so there is nothing to cancel, no events to stream, and no
succeeded observation to materialize yet. Each returns a contract-shaped 409
instead of a silent no-op or an invented 200.
"""

import datetime as dt
import json
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi import Path as PathParam
from majorana_vqe.canonical import scientific_experiment_spec_digest
from majorana_vqe.models import Capability, ComponentType
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession
from ..orm import VqeComponentSpec as VqeComponentSpecRow
from ..orm import VqeExperiment as VqeExperimentRow
from ..orm import VqeWorkflowComponent as VqeWorkflowComponentRow
from ..repos import vqe as vqe_repo

router = APIRouter()

_COMPARISON_ID_PATTERN = r"^[a-zA-Z0-9_]+$"

_NO_EXECUTION_DETAIL = {
    "code": "no_execution_started",
    "message": (
        "Phase 3 persists only the immutable scientific spec; no run or "
        "ExecutionBinding exists for this experiment yet. Execution begins in "
        "Phase 5 once a runtime profile is promoted out of CANDIDATE_UNVERIFIED "
        "(ADR-0024)."
    ),
}


# --- resource shapes ---------------------------------------------------


class ComponentSpecResource(BaseModel):
    artifact_version_id: uuid.UUID
    schema_version: str
    component_type: str
    spec_json: dict[str, Any]
    normalized_spec_sha256: str | None
    annotation_state: str
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
    annotation_state: str
    components: list[WorkflowComponentResource]


class CapabilityStatus(BaseModel):
    capability: str
    available: bool
    reason: str | None


class CapabilitiesResponse(BaseModel):
    capabilities: list[CapabilityStatus]


class CreateExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_artifact_version_id: uuid.UUID
    protocol_version: str = Field(min_length=1, max_length=50)
    dataset_snapshot_id: str | None = Field(default=None, max_length=200)
    initial_parameters: list[float] = Field(default_factory=list, max_length=256)
    seed: int = Field(ge=0)


class ExperimentResource(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID | None
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    schema_version: str
    workflow_artifact_version_id: uuid.UUID
    scientific_spec_json: dict[str, Any]
    scientific_spec_sha256: str
    protocol_version: str
    request_idempotency_key: str | None
    created_at: dt.datetime | None


def _to_component_spec_resource(row: VqeComponentSpecRow) -> ComponentSpecResource:
    return ComponentSpecResource(
        artifact_version_id=row.artifact_version_id,
        schema_version=row.schema_version,
        component_type=row.component_type,
        spec_json=row.spec_json,
        normalized_spec_sha256=row.normalized_spec_sha256,
        annotation_state=row.annotation_state,
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
        run_id=row.run_id,
        workspace_id=row.workspace_id,
        user_id=row.user_id,
        schema_version=row.schema_version,
        workflow_artifact_version_id=row.workflow_artifact_version_id,
        scientific_spec_json=row.scientific_spec_json,
        scientific_spec_sha256=row.scientific_spec_sha256,
        protocol_version=row.protocol_version,
        request_idempotency_key=row.request_idempotency_key,
        created_at=row.created_at,
    )


# --- components ----------------------------------------------------------


@router.get("/atlas/components", response_model=ComponentSpecListResponse)
async def list_components(
    scope: CurrentScope,
    session: DbSession,
    component_type: ComponentType | None = None,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ComponentSpecListResponse:
    rows = await vqe_repo.list_component_specs(
        scope, session, component_type=component_type, cursor=cursor, limit=limit
    )
    next_cursor = rows[-1].artifact_version_id if len(rows) == limit else None
    return ComponentSpecListResponse(
        components=[_to_component_spec_resource(r) for r in rows],
        next_cursor=next_cursor,
    )


@router.get("/atlas/components/{artifact_version_id}", response_model=ComponentSpecResource)
async def get_component(
    artifact_version_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> ComponentSpecResource:
    row = await vqe_repo.get_component_spec(scope, session, artifact_version_id)
    return _to_component_spec_resource(row)


# --- workflows -------------------------------------------------------------


@router.get("/atlas/workflows", response_model=ComponentSpecListResponse)
async def list_workflows(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ComponentSpecListResponse:
    rows = await vqe_repo.list_component_specs(
        scope, session, component_type=ComponentType.WORKFLOW, cursor=cursor, limit=limit
    )
    next_cursor = rows[-1].artifact_version_id if len(rows) == limit else None
    return ComponentSpecListResponse(
        components=[_to_component_spec_resource(r) for r in rows],
        next_cursor=next_cursor,
    )


@router.get("/atlas/workflows/{workflow_artifact_version_id}", response_model=WorkflowResource)
async def get_workflow(
    workflow_artifact_version_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> WorkflowResource:
    spec = await vqe_repo.get_component_spec(scope, session, workflow_artifact_version_id)
    if spec.component_type != ComponentType.WORKFLOW.value:
        raise HTTPException(status_code=404, detail="artifact version is not a workflow")
    components = await vqe_repo.list_workflow_components(
        scope, session, workflow_artifact_version_id
    )
    return WorkflowResource(
        workflow_artifact_version_id=spec.artifact_version_id,
        schema_version=spec.schema_version,
        spec_json=spec.spec_json,
        annotation_state=spec.annotation_state,
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
                    "CANDIDATE_UNVERIFIED yet (ADR-0024, Phase 5)"
                ),
            )
        ]
    )


# --- experiments -------------------------------------------------------


@router.post("/vqe/experiments", response_model=ExperimentResource, status_code=201)
async def create_experiment(
    body: CreateExperimentRequest,
    scope: CurrentScope,
    session: DbSession,
    request_idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
    ],
) -> ExperimentResource:
    try:
        scientific_spec = await vqe_repo.resolve_scientific_experiment_spec(
            scope,
            session,
            body.workflow_artifact_version_id,
            dataset_snapshot_id=body.dataset_snapshot_id,
            initial_parameters=body.initial_parameters,
            seed=body.seed,
        )
        digest = scientific_experiment_spec_digest(scientific_spec)
        experiment = await vqe_repo.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=body.workflow_artifact_version_id,
            schema_version=scientific_spec.schema_version,
            scientific_spec_json=scientific_spec.model_dump(mode="json"),
            scientific_spec_sha256=digest,
            protocol_version=body.protocol_version,
            request_idempotency_key=request_idempotency_key,
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


@router.post("/vqe/experiments/{experiment_id}/cancel")
async def cancel_experiment(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> None:
    await vqe_repo.get_experiment(scope, session, experiment_id)  # 404 if unknown/out of scope
    raise HTTPException(status_code=409, detail=_NO_EXECUTION_DETAIL)


@router.get("/vqe/experiments/{experiment_id}/events")
async def experiment_events(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> None:
    await vqe_repo.get_experiment(scope, session, experiment_id)
    raise HTTPException(status_code=409, detail=_NO_EXECUTION_DETAIL)


@router.post("/vqe/experiments/{experiment_id}/materialize")
async def materialize_experiment(
    experiment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> None:
    await vqe_repo.get_experiment(scope, session, experiment_id)
    raise HTTPException(status_code=409, detail=_NO_EXECUTION_DETAIL)
