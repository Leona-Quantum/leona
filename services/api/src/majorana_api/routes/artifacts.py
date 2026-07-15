"""Workspace artifact reads for Quepo Studio.

The web surface is a renderer; artifact ownership and workspace scoping stay in
the control plane's repository layer.
"""

import re
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from majorana_contracts import Artifact as ArtifactResource
from majorana_contracts import ArtifactVersion as ArtifactVersionResource
from majorana_contracts.enums import Algorithm, ExportStatus, Framework, Visibility
from majorana_openqasm import OpenQASMError, fingerprint, normalize
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession
from ..repos import artifacts as artifacts_repo
from ..orm import Artifact as ArtifactRow
from ..orm import ArtifactVersion as ArtifactVersionRow

router = APIRouter()


class ImportPublicArtifactRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_slug: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=240)
    family: str = Field(min_length=1, max_length=120)
    framework: Framework
    code: str = Field(min_length=1, max_length=100_000)
    code_lang: str = Field(min_length=1, max_length=40)
    qasm: str | None = Field(default=None, max_length=100_000)
    framework_variants: dict[str, str] | None = None
    resource_estimates: dict[str, Any] | None = None
    export_status: ExportStatus = ExportStatus.DOWNLOAD_ONLY
    source_url: AnyHttpUrl
    source_title: str = Field(min_length=1, max_length=400)
    source_license: str = Field(min_length=1, max_length=400)
    introduction: str = Field(min_length=1, max_length=20_000)
    explanation: str = Field(min_length=1, max_length=20_000)
    verification: str = Field(min_length=1, max_length=20_000)


def _public_family(value: str) -> Algorithm:
    normalized = value.lower()
    family_map = (
        ("qaoa", Algorithm.QAOA),
        ("vqe", Algorithm.VQE),
        ("grover", Algorithm.GROVER),
        ("bell", Algorithm.BELL),
        ("ghz", Algorithm.GHZ),
        ("qft", Algorithm.QFT),
        ("quantum fourier", Algorithm.QFT),
        ("qpe", Algorithm.QPE),
        ("amplitude estimation", Algorithm.AMPLITUDE_ESTIMATION),
        ("state preparation", Algorithm.STATE_PREPARATION),
        ("error correction", Algorithm.ERROR_CORRECTION),
    )
    return next((family for marker, family in family_map if marker in normalized), Algorithm.OTHER)


def _public_slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:120] or "reference"


def _canonical_public_qasm(source: str | None) -> tuple[str | None, str | None, str | None]:
    if source is None:
        return None, None, None
    try:
        canonical = normalize(source)
    except OpenQASMError as exc:
        raise HTTPException(status_code=422, detail=f"invalid OpenQASM: {exc}") from exc
    return canonical, "3.0", fingerprint(canonical)


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
        qasm_version=row.qasm_version,
        qasm=row.qasm,
        metadata=row.artifact_metadata,
        code=row.code,
        code_lang=row.code_lang,
        fingerprint=row.fingerprint,
        export_status=ExportStatus(row.export_status),
        export_reason=row.export_reason,
        framework_variants=row.framework_variants,
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


@router.post("/artifacts/import-public", response_model=ArtifactResource, status_code=201)
async def import_public_artifact(
    body: ImportPublicArtifactRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactResource:
    """Copy a public reference into the caller's personal Library.

    This is an import snapshot, not a new verification result. The source and
    limitations are retained on the artifact version so the private copy does not
    lose its public provenance.
    """
    slug = f"public-{_public_slug(body.source_slug)}-{scope.workspace_id.hex}"
    existing = await artifacts_repo.get_artifact_by_slug(scope, session, slug)
    if existing is not None:
        return _to_artifact(existing)

    qasm, qasm_version, qasm_fingerprint = _canonical_public_qasm(body.qasm)
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title=body.title,
        family=_public_family(body.family),
        framework=body.framework,
    )
    await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=qasm_version,
        qasm=qasm,
        metadata={
            "source": {
                "kind": "public_repository",
                "slug": body.source_slug,
                "title": body.source_title,
                "url": str(body.source_url),
                "license": body.source_license,
            },
            "introduction": body.introduction,
            "explanation": body.explanation,
            "verification": body.verification,
        },
        code=body.code,
        code_lang=body.code_lang,
        fingerprint=qasm_fingerprint or f"public-reference:{body.source_slug}",
        export_status=body.export_status,
        framework_variants=body.framework_variants,
        resource_estimates=body.resource_estimates,
        limitations=(
            "Imported from the public research database. This private copy preserves public "
            "source context but is not a new execution or verification record. Review the "
            "source license and rerun the artifact before relying on it."
        ),
    )
    return _to_artifact(artifact)


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
    return _to_version(
        await artifacts_repo.get_version(scope, session, artifact.current_version_id)
    )
