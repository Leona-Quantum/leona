"""Workspace artifact reads for Quepo Studio.

The web surface is a renderer; artifact ownership and workspace scoping stay in
the control plane's repository layer.
"""

import uuid

from fastapi import APIRouter, HTTPException
from majorana_contracts import Artifact as ArtifactResource
from majorana_contracts import ArtifactVersion as ArtifactVersionResource
from majorana_contracts.enums import Algorithm, ExportStatus, Framework, Visibility

from ..auth.deps import CurrentScope, DbSession
from ..repos import artifacts as artifacts_repo
from ..orm import Artifact as ArtifactRow
from ..orm import ArtifactVersion as ArtifactVersionRow

router = APIRouter()


def _to_artifact(row: ArtifactRow) -> ArtifactResource:
    return ArtifactResource(
        id=row.id,
        workspace_id=row.workspace_id,
        slug=row.slug,
        title=row.title,
        family=row.family,
        framework=Framework(row.framework),
        visibility=Visibility(row.visibility or Visibility.PRIVATE),
        parent_artifact_id=row.parent_artifact_id,
        current_version_id=row.current_version_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


def _to_version(row: ArtifactVersionRow) -> ArtifactVersionResource:
    return ArtifactVersionResource(
        id=row.id,
        artifact_id=row.artifact_id,
        seq=row.seq,
        ir_version=row.ir_version,
        ir=row.ir,
        code=row.code,
        code_lang=row.code_lang,
        fingerprint=row.fingerprint,
        export_status=ExportStatus(row.export_status),
        export_reason=row.export_reason,
        qasm=row.qasm,
        resource_estimates=row.resource_estimates,
        limitations=row.limitations,
        created_at=row.created_at,
    )


@router.get("/artifacts", response_model=list[ArtifactResource])
async def list_artifacts(
    scope: CurrentScope,
    session: DbSession,
    family: Algorithm | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[ArtifactResource]:
    rows = await artifacts_repo.list_artifacts(
        scope,
        session,
        family=family,
        cursor=cursor,
        limit=min(max(limit, 1), 100),
    )
    return [_to_artifact(row) for row in rows]


@router.get("/artifacts/{artifact_id}", response_model=ArtifactResource)
async def get_artifact(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactResource:
    return _to_artifact(await artifacts_repo.get_artifact(scope, session, artifact_id))


@router.get("/artifacts/{artifact_id}/versions/current", response_model=ArtifactVersionResource)
async def get_current_version(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactVersionResource:
    artifact = await artifacts_repo.get_artifact(scope, session, artifact_id)
    if artifact.current_version_id is None:
        raise HTTPException(status_code=404, detail="artifact version")
    return _to_version(await artifacts_repo.get_version(scope, session, artifact.current_version_id))
