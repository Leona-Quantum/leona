"""Public catalog boundary and Step 3 private staging.

Two callers, both bound to a server-configured identity — never a
caller-selected workspace:
1. get_catalog_workspace: the anonymous-safe public reader (Step 6+).
2. stage_artifact / stage_artifact_version: the importer service principal
   (Step 3). Staged records are always non-public: review_state='draft' and
   publication_state='private' are hard-coded, never accepted from the
   caller, so a compromised or buggy importer cannot publish directly.
"""

import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    ExecutionState,
    ExportStatus,
    Framework,
    PublicationState,
    ReviewState,
    Role,
    Visibility,
)
from majorana_openqasm import fingerprint as qasm_fingerprint
from majorana_openqasm import normalize
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..catalog_hashing import hash_normalized_source, hash_source_blob
from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion, Membership, Workspace
from ._base import AuthzError, NotFoundError, RepoError

DEDUP_CONSTRAINT_NAME = "uq_artifact_versions_normalized_source_hash"


class DuplicateSourceError(RepoError):
    """A catalog version with this normalized_source_hash already exists."""

    def __init__(self, normalized_source_hash: str):
        super().__init__(f"duplicate normalized_source_hash: {normalized_source_hash}")
        self.normalized_source_hash = normalized_source_hash


async def _catalog_membership_workspace(
    session: AsyncSession, *, workspace_id: uuid.UUID, user_id: uuid.UUID, role: Role
) -> Workspace:
    stmt = (
        select(Workspace)
        .join(
            Membership,
            (Membership.workspace_id == Workspace.id) & (Membership.user_id == user_id),
        )
        .where(
            Workspace.id == workspace_id,
            Workspace.kind == "system",
            Workspace.deleted_at.is_(None),
            Membership.role == role,
        )
    )
    workspace = (await session.execute(stmt)).scalars().first()
    if workspace is None:
        raise NotFoundError("catalog workspace")
    return workspace


async def get_catalog_workspace(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
) -> Workspace:
    """Validate the exact server-owned reader scope and system workspace.

    Requiring both the configured IDs and the persisted viewer membership means
    a caller cannot substitute a personal workspace even if a future route is
    wired incorrectly.
    """
    if not authority.enabled or not authority.is_public_scope(scope):
        raise AuthzError("invalid catalog reader scope")
    return await _catalog_membership_workspace(
        session, workspace_id=scope.workspace_id, user_id=scope.user_id, role=Role.VIEWER
    )


async def _get_importer_workspace(
    scope: Scope, session: AsyncSession, *, authority: CatalogAuthority
) -> Workspace:
    if not authority.enabled or not authority.is_importer_scope(scope):
        raise AuthzError("invalid catalog importer scope")
    return await _catalog_membership_workspace(
        session, workspace_id=scope.workspace_id, user_id=scope.user_id, role=Role.OWNER
    )


async def _get_catalog_artifact(
    session: AsyncSession, *, workspace_id: uuid.UUID, artifact_id: uuid.UUID
) -> Artifact:
    stmt = select(Artifact).where(
        Artifact.id == artifact_id,
        Artifact.workspace_id == workspace_id,
        Artifact.deleted_at.is_(None),
    )
    artifact = (await session.execute(stmt)).scalars().first()
    if artifact is None:
        raise NotFoundError("catalog artifact")
    return artifact


async def stage_artifact(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    slug: str,
    title: str,
    family: Algorithm,
    framework: Framework,
    artifact_kind: ArtifactKind,
    execution_state: ExecutionState,
    parent_artifact_id: uuid.UUID | None = None,
) -> Artifact:
    """Create an immutable-identity, non-public staged catalog artifact."""
    workspace = await _get_importer_workspace(scope, session, authority=authority)
    if parent_artifact_id is not None:  # provenance edge must stay in-catalog
        await _get_catalog_artifact(
            session, workspace_id=workspace.id, artifact_id=parent_artifact_id
        )
    artifact = Artifact(
        id=uuid7(),
        workspace_id=workspace.id,
        slug=slug,
        title=title,
        family=family,
        framework=framework,
        visibility=Visibility.PRIVATE,
        artifact_kind=artifact_kind,
        execution_state=execution_state,
        review_state=ReviewState.DRAFT,
        publication_state=PublicationState.PRIVATE,
        parent_artifact_id=parent_artifact_id,
    )
    session.add(artifact)
    await session.flush()
    return artifact


async def stage_artifact_version(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    raw_source: bytes,
    normalized_source: str,
    code: str,
    code_lang: str,
    authoritative_framework: Framework,
    authoritative_framework_version: str,
    source_language: str,
    metadata_schema_version: str,
    qasm: str | None = None,
    semantic_fingerprint: str | None = None,
    semantic_fingerprint_algorithm: str | None = None,
    toolchain_digest: str | None = None,
    export_status: ExportStatus = ExportStatus.UNSUPPORTED,
    export_reason: str | None = None,
    resource_estimates: dict[str, Any] | None = None,
    limitations: str | None = None,
) -> ArtifactVersion:
    """Persist an immutable staged version with exact-duplicate rejection.

    Both hashes are computed here from the caller-supplied bytes/text, never
    trusted as a caller-provided digest, so a staged hash always matches the
    content actually stored. The unique constraint on normalized_source_hash
    (migration 0014) enforces rejection atomically — concurrent importers
    racing the same source cannot both win.
    """
    workspace = await _get_importer_workspace(scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session, workspace_id=workspace.id, artifact_id=artifact_id
    )

    source_blob_sha256 = hash_source_blob(raw_source)
    normalized_hash = hash_normalized_source(normalized_source)
    # QASM canonicalization/fingerprint follows the same convention as
    # repos/system.py's seed path: the existing `fingerprint` column keeps
    # its pipeline meaning and only borrows the normalized-source digest as
    # its fallback when no canonical QASM is present.
    canonical_qasm = normalize(qasm) if qasm is not None else None
    fingerprint = (
        qasm_fingerprint(canonical_qasm) if canonical_qasm is not None else normalized_hash
    )

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
        qasm_version="3.0" if canonical_qasm is not None else None,
        qasm=canonical_qasm,
        code=code,
        code_lang=code_lang,
        fingerprint=fingerprint,
        export_status=export_status,
        export_reason=export_reason,
        resource_estimates=resource_estimates,
        limitations=limitations,
        metadata_schema_version=metadata_schema_version,
        authoritative_framework=authoritative_framework,
        authoritative_framework_version=authoritative_framework_version,
        source_language=source_language,
        source_blob_sha256=source_blob_sha256,
        normalized_source_hash=normalized_hash,
        semantic_fingerprint=semantic_fingerprint,
        semantic_fingerprint_algorithm=semantic_fingerprint_algorithm,
        toolchain_digest=toolchain_digest,
    )
    session.add(version)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        if exc.orig is not None and exc.orig.diag.constraint_name == DEDUP_CONSTRAINT_NAME:
            raise DuplicateSourceError(normalized_hash) from exc
        raise

    artifact.current_version_id = version.id
    await session.flush()
    return version
