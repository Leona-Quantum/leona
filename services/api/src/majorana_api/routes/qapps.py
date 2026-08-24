"""Qapp ownership, explicit publication, and authenticated sandbox execution."""

from __future__ import annotations

import uuid
import datetime as dt
from typing import Any

from fastapi import APIRouter, HTTPException
from majorana_contracts import Qapp, QappExecution, QappVersion, PublicQapp
from majorana_contracts.enums import Framework, Visibility
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession
from ..auth.qapp_deps import PublicQappScope
from ..jobs import QAPP_EXECUTE_JOB_KIND
from ..qapp_validation import validate_qapp_inputs
from ..request_models import RequestModel
from ..repos import qapps as qapps_repo
from ..repos import system

router = APIRouter()
QAPP_EXECUTION_BACKSTOP_PER_HOUR = 60


class QappDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    qapp: Qapp
    version: QappVersion


class PublicQappSummary(BaseModel):
    """Gallery-safe public metadata; excludes generated UI, source, and tenant ids."""

    model_config = ConfigDict(extra="forbid")

    slug: str
    title: str
    description: str
    framework: Framework
    qubits_estimate: int = Field(ge=1, le=27)
    version: int = Field(ge=1)
    published_at: dt.datetime


class SetQappVisibilityRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")
    visibility: Visibility


class ExecuteQappRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")
    inputs: dict[str, Any] = Field(default_factory=dict)


def _required(value, name: str):
    if value is None:
        raise RuntimeError(f"persisted Qapp is missing {name}")
    return value


def _qapp_resource(row) -> Qapp:
    return Qapp(
        id=row.id,
        workspace_id=row.workspace_id,
        owner_user_id=row.owner_user_id,
        slug=row.slug,
        title=row.title,
        description=row.description,
        visibility=row.visibility,
        current_version_id=_required(row.current_version_id, "current_version_id"),
        created_by_run_id=row.created_by_run_id,
        published_at=row.published_at,
        created_at=_required(row.created_at, "created_at"),
        updated_at=_required(row.updated_at, "updated_at"),
    )


def _version_resource(row) -> QappVersion:
    return QappVersion(
        id=row.id,
        qapp_id=row.qapp_id,
        seq=row.seq,
        framework=row.framework,
        qubits_estimate=row.qubits_estimate,
        ui_document=row.ui_document,
        quantum_source=row.quantum_source,
        input_schema=row.input_schema,
        output_schema=row.output_schema,
        fingerprint=row.fingerprint,
        source_artifact_version_id=row.source_artifact_version_id,
        created_at=_required(row.created_at, "created_at"),
    )


def _execution_resource(row) -> QappExecution:
    return QappExecution(
        id=row.id,
        qapp_id=row.qapp_id,
        qapp_version_id=row.qapp_version_id,
        status=row.status,
        inputs=row.inputs,
        result=row.result,
        error_code=row.error_code,
        created_at=_required(row.created_at, "created_at"),
        started_at=row.started_at,
        finished_at=row.finished_at,
    )


@router.get("/qapps", response_model=list[Qapp])
async def list_qapps(scope: CurrentScope, session: DbSession) -> list[Qapp]:
    return [_qapp_resource(row) for row in await qapps_repo.list_qapps(scope, session)]


@router.get("/qapps/public", response_model=list[PublicQappSummary])
async def list_public_qapps(scope: PublicQappScope, session: DbSession) -> list[PublicQappSummary]:
    rows = await qapps_repo.list_public_qapps(scope, session)
    return [
        PublicQappSummary(
            slug=qapp.slug,
            title=qapp.title,
            description=qapp.description,
            framework=version.framework,
            qubits_estimate=version.qubits_estimate,
            version=version.seq,
            published_at=_required(qapp.published_at, "published_at"),
        )
        for qapp, version in rows
    ]


@router.get("/qapps/public/{slug}", response_model=PublicQapp)
async def public_qapp(slug: str, scope: PublicQappScope, session: DbSession) -> PublicQapp:
    qapp = await qapps_repo.get_accessible_by_slug(scope, session, slug)
    if qapp.visibility != Visibility.PUBLIC.value or qapp.published_at is None:
        raise HTTPException(status_code=404, detail="qapp not found")
    version = await qapps_repo.get_current_version(scope, session, qapp)
    return PublicQapp(
        slug=qapp.slug,
        title=qapp.title,
        description=qapp.description,
        framework=version.framework,
        qubits_estimate=version.qubits_estimate,
        ui_document=version.ui_document,
        input_schema=version.input_schema,
        output_schema=version.output_schema,
        version=version.seq,
        fingerprint=version.fingerprint,
        published_at=qapp.published_at,
    )


@router.get("/qapps/{qapp_id}", response_model=QappDetail)
async def qapp_detail(qapp_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> QappDetail:
    qapp = await qapps_repo.get_qapp(scope, session, qapp_id)
    version = await qapps_repo.get_current_version(scope, session, qapp)
    return QappDetail(qapp=_qapp_resource(qapp), version=_version_resource(version))


@router.patch("/qapps/{qapp_id}/visibility", response_model=Qapp)
async def set_qapp_visibility(
    qapp_id: uuid.UUID,
    body: SetQappVisibilityRequest,
    scope: CurrentScope,
    session: DbSession,
) -> Qapp:
    try:
        qapp = await qapps_repo.set_visibility(scope, session, qapp_id, body.visibility)
    except qapps_repo.QappPublicationBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return _qapp_resource(qapp)


@router.post("/qapps/{slug}/executions", response_model=QappExecution, status_code=202)
async def execute_qapp(
    slug: str,
    body: ExecuteQappRequest,
    scope: CurrentScope,
    session: DbSession,
) -> QappExecution:
    qapp = await qapps_repo.get_accessible_by_slug(scope, session, slug)
    version = await qapps_repo.get_current_version(scope, session, qapp)
    try:
        validate_qapp_inputs(version.input_schema, body.inputs)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    try:
        await qapps_repo.reserve_execution_slot(
            scope,
            session,
            since=dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1),
            limit=QAPP_EXECUTION_BACKSTOP_PER_HOUR,
        )
    except ValueError:
        raise HTTPException(
            status_code=429,
            detail="Qapp execution safety limit reached; try again later",
        ) from None
    execution = await qapps_repo.create_execution(
        scope, session, qapp=qapp, version=version, inputs=body.inputs
    )
    await system.enqueue_job(
        session,
        kind=QAPP_EXECUTE_JOB_KIND,
        payload={
            "execution_id": str(execution.id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
        },
    )
    return _execution_resource(execution)


@router.get("/qapps/executions/{execution_id}", response_model=QappExecution)
async def qapp_execution(
    execution_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> QappExecution:
    return _execution_resource(await qapps_repo.get_execution(scope, session, execution_id))
