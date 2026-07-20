"""Artifact + artifact-version repositories.

Versions carry no workspace_id column; every version query joins through its
artifact so the workspace predicate is always applied.
"""

import datetime as dt
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus, Framework, Visibility
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion
from ._base import NotFoundError, require_admin, require_write


async def list_artifacts(
    scope: Scope,
    session: AsyncSession,
    *,
    family: Algorithm | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[tuple[Artifact, dict[str, Any] | None]]:
    """Artifacts plus each one's current-version metadata (None when no version).

    The metadata rides along so the list resource can carry the verification
    grade — without it the web fabricated "verified" for every unopened
    artifact. One outer join, not a per-row fetch.
    """
    stmt = (
        select(Artifact, ArtifactVersion.artifact_metadata)
        .join(
            ArtifactVersion,
            Artifact.current_version_id == ArtifactVersion.id,
            isouter=True,
        )
        .where(Artifact.workspace_id == scope.workspace_id, Artifact.deleted_at.is_(None))
        .order_by(Artifact.id.desc())
        .limit(limit)
    )
    if family is not None:
        stmt = stmt.where(Artifact.family == family)
    if cursor is not None:  # UUIDv7 PKs are time-ordered: id is the cursor
        stmt = stmt.where(Artifact.id < cursor)
    return [
        (row[0], row[1] if isinstance(row[1], dict) else None)
        for row in (await session.execute(stmt)).all()
    ]


async def list_verified_exemplars(
    scope: Scope,
    session: AsyncSession,
    *,
    framework: Framework,
    family: Algorithm | None = None,
    limit: int = 2,
) -> list[tuple[Artifact, ArtifactVersion]]:
    """Recent artifacts whose current version passed verification, for few-shot
    retrieval into the generation context (LLM work list item 4).

    Retrieval is from THIS workspace's verified corpus, not the open web — we
    control its quality, and every row here already survived the deterministic
    checks. The decision filter reads the version's verification_summary, the
    same field the Vault list grade reads.
    """
    stmt = (
        select(Artifact, ArtifactVersion)
        .join(ArtifactVersion, Artifact.current_version_id == ArtifactVersion.id)
        .where(
            Artifact.workspace_id == scope.workspace_id,
            Artifact.deleted_at.is_(None),
            Artifact.framework == framework,
            ArtifactVersion.artifact_metadata["verification_summary"]["decision"].astext
            == "pass",
        )
        .order_by(Artifact.id.desc())
        .limit(max(1, min(limit, 5)))
    )
    if family is not None:
        stmt = stmt.where(Artifact.family == family)
    return [(row[0], row[1]) for row in (await session.execute(stmt)).all()]


async def get_artifact(
    scope: Scope, session: AsyncSession, artifact_id: uuid.UUID, *, for_update: bool = False
) -> Artifact:
    stmt = select(Artifact).where(
        Artifact.id == artifact_id,
        Artifact.workspace_id == scope.workspace_id,
        Artifact.deleted_at.is_(None),
    )
    if for_update:
        stmt = stmt.with_for_update()
    artifact = (await session.execute(stmt)).scalars().first()
    if artifact is None:
        raise NotFoundError("artifact")
    return artifact


async def get_artifact_by_slug(scope: Scope, session: AsyncSession, slug: str) -> Artifact | None:
    """Return an in-scope artifact by slug for idempotent imports."""
    stmt = select(Artifact).where(
        Artifact.slug == slug,
        Artifact.workspace_id == scope.workspace_id,
        Artifact.deleted_at.is_(None),
    )
    return (await session.execute(stmt)).scalars().first()


async def create_artifact(
    scope: Scope,
    session: AsyncSession,
    *,
    slug: str,
    title: str,
    family: Algorithm,
    framework: Framework,
    parent_artifact_id: uuid.UUID | None = None,
) -> Artifact:
    require_write(scope)
    if parent_artifact_id is not None:  # provenance edge must stay in-workspace
        await get_artifact(scope, session, parent_artifact_id)
    artifact = Artifact(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        slug=slug,
        title=title,
        family=family,
        framework=framework,
        visibility=Visibility.PRIVATE,
        parent_artifact_id=parent_artifact_id,
    )
    session.add(artifact)
    await session.flush()
    return artifact


async def set_visibility(
    scope: Scope, session: AsyncSession, artifact_id: uuid.UUID, visibility: Visibility
) -> None:
    require_admin(scope)
    stmt = (
        update(Artifact)
        .where(
            Artifact.id == artifact_id,
            Artifact.workspace_id == scope.workspace_id,
            Artifact.deleted_at.is_(None),
        )
        .values(visibility=visibility, updated_at=func.now())
    )
    result = await session.execute(stmt)
    if result.rowcount == 0:
        raise NotFoundError("artifact")


async def soft_delete_artifact(scope: Scope, session: AsyncSession, artifact_id: uuid.UUID) -> None:
    require_admin(scope)
    stmt = (
        update(Artifact)
        .where(
            Artifact.id == artifact_id,
            Artifact.workspace_id == scope.workspace_id,
            Artifact.deleted_at.is_(None),
        )
        .values(deleted_at=dt.datetime.now(dt.timezone.utc), updated_at=func.now())
    )
    result = await session.execute(stmt)
    if result.rowcount == 0:
        raise NotFoundError("artifact")


async def create_version(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    qasm_version: str | None,
    qasm: str | None,
    metadata: dict[str, Any] | None = None,
    code: str,
    code_lang: str,
    fingerprint: str,
    export_status: ExportStatus,
    export_reason: str | None = None,
    framework_variants: dict[str, str] | None = None,
    resource_estimates: dict[str, Any] | None = None,
    limitations: str | None = None,
) -> ArtifactVersion:
    require_write(scope)
    # Lock the artifact row: serializes concurrent version creation so
    # max(seq)+1 can't collide (uq_artifact_versions_seq rejects the loser).
    artifact = await get_artifact(scope, session, artifact_id, for_update=True)
    next_seq = (
        await session.execute(
            select(func.coalesce(func.max(ArtifactVersion.seq), 0) + 1).where(
                ArtifactVersion.artifact_id == artifact.id
            )
        )
    ).scalar_one()
    version = ArtifactVersion(
        id=uuid7(),
        artifact_id=artifact.id,
        seq=next_seq,
        qasm_version=qasm_version,
        qasm=qasm,
        artifact_metadata=metadata,
        code=code,
        code_lang=code_lang,
        fingerprint=fingerprint,
        export_status=export_status,
        export_reason=export_reason,
        framework_variants=framework_variants,
        resource_estimates=resource_estimates,
        limitations=limitations,
    )
    session.add(version)
    await session.flush()
    await session.execute(
        update(Artifact)
        .where(Artifact.id == artifact.id, Artifact.workspace_id == scope.workspace_id)
        .values(current_version_id=version.id, updated_at=func.now())
    )
    # The SQL expression above can expire ORM attributes under AsyncSession;
    # keep the just-written object safe for callers that serialize it in the
    # same request without triggering implicit IO.
    artifact.current_version_id = version.id
    artifact.updated_at = dt.datetime.now(dt.timezone.utc)
    return version


async def get_version(
    scope: Scope, session: AsyncSession, version_id: uuid.UUID
) -> ArtifactVersion:
    stmt = (
        select(ArtifactVersion)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            ArtifactVersion.id == version_id,
            Artifact.workspace_id == scope.workspace_id,
            Artifact.deleted_at.is_(None),
        )
    )
    version = (await session.execute(stmt)).scalars().first()
    if version is None:
        raise NotFoundError("artifact version")
    return version
