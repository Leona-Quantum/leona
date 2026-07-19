"""Public catalog boundary, Step 3 private staging, and Step 4 provenance/rights/review.

Three callers, each bound to a server-configured identity or a persisted
membership row — never a caller-selected workspace:
1. get_catalog_workspace: the anonymous-safe public reader (Step 6+).
2. stage_*/record_*/submit_for_review: the importer service principal
   (CatalogAuthority.is_importer_scope). Staged records are always
   non-public: review_state='draft' and publication_state='private' are
   hard-coded, never accepted from the caller, so a compromised or buggy
   importer cannot publish directly.
3. decide_*: a real authenticated human holding ADMIN membership on the
   system catalog workspace (granted via repos/workspaces.add_member by the
   importer's OWNER scope). The importer's own identity is structurally
   excluded — see _get_reviewer_workspace — so importer and reviewer are
   always different principals (ADR-0016: review/publication must be
   attributable human actions).
"""

import datetime as dt
import uuid
from typing import Any

from majorana_contracts import Scope, assert_review_transition
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    CitationRelation,
    ExecutionState,
    ExportStatus,
    Framework,
    LicenseAssertionKind,
    LicenseDecision,
    LicenseScope,
    PublicationState,
    ReviewState,
    Role,
    SourceKind,
    Visibility,
)
from majorana_openqasm import fingerprint as qasm_fingerprint
from majorana_openqasm import normalize
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..catalog_hashing import hash_normalized_source, hash_source_blob
from ..catalog_publication import PublicationReadiness, evaluate_publication_readiness
from ..ids import uuid7
from ..orm import (
    Artifact,
    ArtifactCitation,
    ArtifactSource,
    ArtifactTag,
    ArtifactVersion,
    LicenseAssertion,
    Membership,
    Workspace,
)
from ._base import AuthzError, NotFoundError, RepoError
from .audit import record_audit

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


async def get_importer_workspace(
    scope: Scope, session: AsyncSession, *, authority: CatalogAuthority
) -> Workspace:
    if not authority.enabled or not authority.is_importer_scope(scope):
        raise AuthzError("invalid catalog importer scope")
    return await _catalog_membership_workspace(
        session, workspace_id=scope.workspace_id, user_id=scope.user_id, role=Role.OWNER
    )


async def _get_reviewer_workspace(
    scope: Scope, session: AsyncSession, *, authority: CatalogAuthority
) -> Workspace:
    """A real human with ADMIN membership — never the importer identity,
    even if a future misconfiguration ever granted it an ADMIN row too."""
    if (
        not authority.enabled
        or not authority.configured
        or scope.workspace_id != authority.workspace_id
        or scope.user_id == authority.importer_user_id
        or scope.user_id == authority.public_reader_user_id
    ):
        raise AuthzError("invalid catalog reviewer scope")
    return await _catalog_membership_workspace(
        session, workspace_id=scope.workspace_id, user_id=scope.user_id, role=Role.ADMIN
    )


async def _get_catalog_artifact(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    artifact_id: uuid.UUID,
    for_update: bool = False,
) -> Artifact:
    stmt = select(Artifact).where(
        Artifact.id == artifact_id,
        Artifact.workspace_id == workspace_id,
        Artifact.deleted_at.is_(None),
    )
    if for_update:
        stmt = stmt.with_for_update()
    artifact = (await session.execute(stmt)).scalars().first()
    if artifact is None:
        raise NotFoundError("catalog artifact")
    return artifact


async def _get_catalog_version(
    session: AsyncSession, *, workspace_id: uuid.UUID, artifact_version_id: uuid.UUID
) -> tuple[Artifact, ArtifactVersion]:
    stmt = (
        select(Artifact, ArtifactVersion)
        .join(ArtifactVersion, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            ArtifactVersion.id == artifact_version_id,
            Artifact.workspace_id == workspace_id,
            Artifact.deleted_at.is_(None),
        )
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise NotFoundError("catalog artifact version")
    return row[0], row[1]


async def _get_current_license_assertion(
    session: AsyncSession, *, artifact_version_id: uuid.UUID
) -> LicenseAssertion | None:
    stmt = (
        select(LicenseAssertion)
        .where(LicenseAssertion.artifact_version_id == artifact_version_id)
        .order_by(LicenseAssertion.created_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


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
    workspace = await get_importer_workspace(scope, session, authority=authority)
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
    workspace = await get_importer_workspace(scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session,
        workspace_id=workspace.id,
        artifact_id=artifact_id,
        for_update=True,
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
    # A new revision cannot inherit a stale review outcome made about different
    # content (repository Step 4 plan: "a new source revision cannot reuse
    # stale review/evidence"). PENDING_REVIEW resets too: otherwise a reviewer
    # could accept content staged after submission. QUARANTINED deliberately
    # survives — it is a rights hold on the artifact, and staging new bytes
    # must never lift a legal hold.
    if artifact.review_state in (
        ReviewState.PENDING_REVIEW,
        ReviewState.ACCEPTED,
        ReviewState.REJECTED,
    ):
        artifact.review_state = ReviewState.DRAFT
    await session.flush()
    return version


async def record_artifact_source(
    scope: Scope,
    session: AsyncSession,
    artifact_version_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    source_kind: SourceKind,
    content_hash: str,
    retrieved_at: dt.datetime,
    repository: str | None = None,
    ref: str | None = None,
    path: str | None = None,
    package_version: str | None = None,
    retrieval_metadata: dict[str, Any] | None = None,
) -> ArtifactSource:
    """Record the one pinned source for a staged version (importer-only).

    artifact_version_id carries a UNIQUE constraint (migration 0015): a
    second call for the same version is a duplicate-source bug, not a
    correction — corrections stage a new version instead.
    """
    workspace = await get_importer_workspace(scope, session, authority=authority)
    await _get_catalog_version(
        session, workspace_id=workspace.id, artifact_version_id=artifact_version_id
    )
    source = ArtifactSource(
        id=uuid7(),
        artifact_version_id=artifact_version_id,
        source_kind=source_kind,
        repository=repository,
        ref=ref,
        path=path,
        package_version=package_version,
        retrieved_at=retrieved_at,
        retrieval_metadata=retrieval_metadata,
        content_hash=content_hash,
    )
    session.add(source)
    await session.flush()
    return source


async def record_license_assertion(
    scope: Scope,
    session: AsyncSession,
    artifact_version_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    assertion_kind: LicenseAssertionKind,
    license_scope: LicenseScope,
    spdx_id: str | None = None,
    evidence_hash: str | None = None,
    confidence: float | None = None,
    conflicting: bool = False,
) -> LicenseAssertion:
    """Record a declared/detected license claim (importer-only, append-only).

    An unknown (spdx_id is None) or explicitly conflicting claim fails
    closed immediately: the artifact's review_state becomes 'quarantined'
    in the same transaction, before any human looks at it. Only a reviewer
    decision (decide_license_assertion + decide_review) can move it forward
    — repository Step 4 plan: "unknown/conflicting licenses fail closed
    into quarantine".
    """
    workspace = await get_importer_workspace(scope, session, authority=authority)
    artifact, version = await _get_catalog_version(
        session, workspace_id=workspace.id, artifact_version_id=artifact_version_id
    )
    unresolved = spdx_id is None or conflicting
    assertion = LicenseAssertion(
        id=uuid7(),
        artifact_version_id=artifact_version_id,
        spdx_id=spdx_id,
        assertion_kind=assertion_kind,
        evidence_hash=evidence_hash,
        license_scope=license_scope,
        confidence=confidence,
        reviewer_decision=(LicenseDecision.QUARANTINED if unresolved else LicenseDecision.PENDING),
    )
    session.add(assertion)
    if unresolved and artifact.current_version_id == version.id:
        artifact.review_state = ReviewState.QUARANTINED
    await session.flush()
    return assertion


async def decide_license_assertion(
    scope: Scope,
    session: AsyncSession,
    artifact_version_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    decision: LicenseDecision,
    spdx_id: str | None = None,
    evidence_hash: str | None = None,
) -> LicenseAssertion:
    """Reviewer-only append: never updates a prior assertion row.

    Unset spdx_id/evidence_hash carry the prior assertion's value forward,
    so an 'approved' decision doesn't silently blank out what the importer
    already established.
    """
    if decision == LicenseDecision.PENDING:
        raise ValueError("reviewer decision cannot be 'pending'")
    workspace = await _get_reviewer_workspace(scope, session, authority=authority)
    await _get_catalog_version(
        session, workspace_id=workspace.id, artifact_version_id=artifact_version_id
    )
    previous = await _get_current_license_assertion(
        session, artifact_version_id=artifact_version_id
    )
    if previous is None:
        raise NotFoundError("license assertion")
    resolved_spdx_id = spdx_id if spdx_id is not None else previous.spdx_id
    # Approval must name a concrete license: an APPROVED assertion with
    # spdx_id=None would satisfy the publication-readiness check (it only
    # looks at the decision) and make an unknown license publishable.
    if decision == LicenseDecision.APPROVED and resolved_spdx_id is None:
        raise ValueError("approving a license requires a resolved spdx_id")
    assertion = LicenseAssertion(
        id=uuid7(),
        artifact_version_id=artifact_version_id,
        spdx_id=resolved_spdx_id,
        assertion_kind=previous.assertion_kind,
        evidence_hash=evidence_hash if evidence_hash is not None else previous.evidence_hash,
        license_scope=previous.license_scope,
        confidence=previous.confidence,
        reviewer_decision=decision,
        reviewer_user_id=scope.user_id,
        supersedes_assertion_id=previous.id,
    )
    session.add(assertion)
    await session.flush()
    return assertion


async def submit_for_review(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
) -> Artifact:
    """Importer-only, one-way: 'draft' -> 'pending_review'."""
    workspace = await get_importer_workspace(scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session, workspace_id=workspace.id, artifact_id=artifact_id
    )
    assert_review_transition(ReviewState(artifact.review_state), ReviewState.PENDING_REVIEW)
    artifact.review_state = ReviewState.PENDING_REVIEW
    await session.flush()
    return artifact


async def decide_review(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    decision: ReviewState,
) -> Artifact:
    """Reviewer-only: {'pending_review','quarantined'} -> {'accepted','rejected'}."""
    workspace = await _get_reviewer_workspace(scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session, workspace_id=workspace.id, artifact_id=artifact_id
    )
    previous_state = ReviewState(artifact.review_state)
    assert_review_transition(previous_state, decision)
    artifact.review_state = decision
    await record_audit(
        scope,
        session,
        action=f"catalog.review.{decision.value}",
        target_kind="artifact",
        target_id=artifact.id,
        meta={
            "from": previous_state.value,
            "to": decision.value,
            "artifact_version_id": (
                str(artifact.current_version_id) if artifact.current_version_id else None
            ),
        },
    )
    return artifact


async def record_citation(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    relation: CitationRelation,
    doi: str | None = None,
    arxiv_id: str | None = None,
    url: str | None = None,
    specification_ref: str | None = None,
    authors: list[str] | None = None,
    year: int | None = None,
) -> ArtifactCitation:
    """Importer-only. A citation does not grant redistribution permission —
    it is independent of license_assertions (repository Step 4 plan §5.2)."""
    if doi is None and arxiv_id is None and url is None and specification_ref is None:
        raise ValueError("citation needs at least one of doi/arxiv_id/url/specification_ref")
    workspace = await get_importer_workspace(scope, session, authority=authority)
    await _get_catalog_artifact(session, workspace_id=workspace.id, artifact_id=artifact_id)
    citation = ArtifactCitation(
        id=uuid7(),
        artifact_id=artifact_id,
        doi=doi,
        arxiv_id=arxiv_id,
        url=url,
        specification_ref=specification_ref,
        authors=authors,
        year=year,
        relation=relation,
    )
    session.add(citation)
    await session.flush()
    return citation


async def tag_artifact(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    tag: str,
) -> None:
    """Importer-only; idempotent (unique artifact_id/tag pair)."""
    workspace = await get_importer_workspace(scope, session, authority=authority)
    await _get_catalog_artifact(session, workspace_id=workspace.id, artifact_id=artifact_id)
    await session.execute(
        pg_insert(ArtifactTag)
        .values(artifact_id=artifact_id, tag=tag)
        .on_conflict_do_nothing(index_elements=[ArtifactTag.artifact_id, ArtifactTag.tag])
    )


async def get_publication_readiness(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
) -> PublicationReadiness:
    """Read-only precondition check. Never mutates publication_state —
    publication itself is a later step's audited human action."""
    try:
        workspace = await get_importer_workspace(scope, session, authority=authority)
    except AuthzError:
        workspace = await _get_reviewer_workspace(scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session, workspace_id=workspace.id, artifact_id=artifact_id
    )
    if artifact.current_version_id is None:
        return evaluate_publication_readiness(
            review_state=artifact.review_state or ReviewState.DRAFT,
            has_source=False,
            license_decision=None,
            source_blob_sha256=None,
            normalized_source_hash=None,
            authoritative_framework=None,
        )
    version = (
        (
            await session.execute(
                select(ArtifactVersion).where(ArtifactVersion.id == artifact.current_version_id)
            )
        )
        .scalars()
        .first()
    )
    source = (
        (
            await session.execute(
                select(ArtifactSource).where(
                    ArtifactSource.artifact_version_id == artifact.current_version_id
                )
            )
        )
        .scalars()
        .first()
    )
    license_row = await _get_current_license_assertion(
        session, artifact_version_id=artifact.current_version_id
    )
    return evaluate_publication_readiness(
        review_state=artifact.review_state or ReviewState.DRAFT,
        has_source=source is not None,
        license_decision=license_row.reviewer_decision if license_row else None,
        source_blob_sha256=version.source_blob_sha256 if version else None,
        normalized_source_hash=version.normalized_source_hash if version else None,
        authoritative_framework=version.authoritative_framework if version else None,
    )
