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

from majorana_contracts import (
    PublicCatalogEntry,
    Scope,
    assert_publication_transition,
    assert_review_transition,
)
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
from sqlalchemy import Select, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..catalog_hashing import hash_normalized_source, hash_source_blob
from ..catalog_publication import PublicationReadiness, evaluate_publication_readiness
from ..catalog_read_model import build_public_catalog_entry
from ..ids import uuid7
from ..orm import (
    Artifact,
    ArtifactCitation,
    ArtifactSource,
    ArtifactTag,
    ArtifactVersion,
    ImportItem,
    ImportJob,
    LicenseAssertion,
    Membership,
    User,
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
    """The head of the append-only supersession chain.

    Ordering by created_at alone is not sufficient to identify "current":
    created_at defaults to now(), which in Postgres is the *transaction*
    timestamp, so a declared assertion and the reviewer decision that supersedes
    it share an identical timestamp whenever both are written in one
    transaction. The tie then resolves arbitrarily and publication readiness can
    read a stale 'pending' decision. The chain head — the row no other assertion
    supersedes — is exact and independent of timestamps; created_at/id ordering
    only breaks ties between independent (non-superseding) assertions.
    """
    superseded = select(LicenseAssertion.supersedes_assertion_id).where(
        LicenseAssertion.artifact_version_id == artifact_version_id,
        LicenseAssertion.supersedes_assertion_id.is_not(None),
    )
    stmt = (
        select(LicenseAssertion)
        .where(
            LicenseAssertion.artifact_version_id == artifact_version_id,
            LicenseAssertion.id.not_in(superseded),
        )
        .order_by(LicenseAssertion.created_at.desc(), LicenseAssertion.id.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def find_staged_artifact_by_upstream_identity(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    upstream_identity: str,
) -> tuple[Artifact, ArtifactVersion | None] | None:
    """The catalog artifact already published under `upstream_identity`, if any.

    This is the importer's reconciliation key: an import that can find the
    record it created last time updates that record, instead of creating a
    second artifact and then colliding with itself on the table-wide
    normalized-source hash.

    Filters `deleted_at IS NULL` to match the partial unique index exactly
    (migration 0046). If these two ever drift, one of them is wrong in a way
    nothing reports: a resolver that sees rows the index does not cover fails on
    insert instead of reconciling, and an index that covers rows the resolver
    cannot see admits a duplicate identity.

    Returns the artifact together with its current version, because the caller's
    next question is always "is the incoming content the same as what is already
    stored" and answering it from a second query would race this one.
    """
    workspace = await get_importer_workspace(scope, session, authority=authority)
    row = (
        await session.execute(
            select(Artifact, ArtifactVersion)
            .outerjoin(ArtifactVersion, ArtifactVersion.id == Artifact.current_version_id)
            .where(
                Artifact.workspace_id == workspace.id,
                Artifact.deleted_at.is_(None),
                Artifact.upstream_identity == upstream_identity,
            )
        )
    ).first()
    if row is None:
        return None
    return row[0], row[1]


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
    upstream_identity: str | None = None,
) -> Artifact:
    """Create an immutable-identity, non-public staged catalog artifact.

    `upstream_identity` is the public slug the record will be served under and
    the key a later import reconciles against. It is set at creation and never
    changed: it is the one thing that has to stay stable across re-imports for a
    record to keep its URL.
    """
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
        upstream_identity=upstream_identity,
        # Curated corpus content, staged deliberately by an importer — never a
        # run result awaiting a keep decision. Set explicitly because this row
        # bypasses create_artifact and would otherwise be invisible (0036).
        kept_at=dt.datetime.now(dt.UTC),
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
    claim_hash: str | None = None,
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
        claim_hash=claim_hash,
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
    claim_hash: str | None = None,
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
        claim_hash=claim_hash if claim_hash is not None else previous.claim_hash,
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


async def _artifact_publication_readiness(
    session: AsyncSession, *, artifact: Artifact
) -> PublicationReadiness:
    """Load the version/source/license rows for one artifact and evaluate the
    pure readiness contract. Shared by the read-only readiness check and the
    publish action so both fail closed on exactly the same bindings."""
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


class PublicationNotReadyError(RepoError):
    """Publication was attempted while a required binding was missing.

    Publication fails closed (repository Step 4/6): review acceptance, a pinned
    source, an approved license, and the exact hash/framework binding must all be
    present. The blockers list names every unmet condition.
    """

    def __init__(self, blockers: tuple[str, ...]):
        super().__init__("catalog artifact is not ready to publish: " + "; ".join(blockers))
        self.blockers = blockers


async def publish_catalog_artifact(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
) -> Artifact:
    """Reviewer-only review->public transition (repository Step 6).

    An attributable human ADMIN (never the importer identity — enforced by
    _get_reviewer_workspace) flips publication_state private -> public, but only
    after evaluate_publication_readiness passes: acceptance, pinned source,
    approved license, and hash/framework binding. The transition itself is
    validated against the publication lifecycle table and audited. A record that
    is not ready raises PublicationNotReadyError and nothing is mutated, so a
    buggy or premature caller can never expose unreviewed content.

    Publishing an already-public record is a no-op rather than an error. PUBLIC
    has no self-edge in the lifecycle table — correctly, since it is not a state
    change — but that made re-running the publication CLI over a corpus die with
    IllegalPublicationTransition on the first record that was already live,
    part-way through, leaving the rest unpublished. Re-publishing what is
    published is what an operator re-running a corpus command means, and it
    changes nothing.

    The readiness check still runs first, and that ordering is the point: a
    record that was re-imported has had its review_state reset to DRAFT, so it
    is public *and* no longer ready, and it must be reported as blocked rather
    than waved through as "already done".
    """
    workspace = await _get_reviewer_workspace(scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session, workspace_id=workspace.id, artifact_id=artifact_id, for_update=True
    )
    readiness = await _artifact_publication_readiness(session, artifact=artifact)
    if not readiness.ready:
        raise PublicationNotReadyError(readiness.blockers)
    if artifact.publication_state == PublicationState.PUBLIC:
        # No transition, no audit row: nothing happened, and an audit trail that
        # records re-runs as publications would misreport when this went live.
        return artifact
    previous_state = PublicationState(artifact.publication_state or PublicationState.PRIVATE)
    assert_publication_transition(previous_state, PublicationState.PUBLIC)
    artifact.publication_state = PublicationState.PUBLIC
    await record_audit(
        scope,
        session,
        action="catalog.publication.public",
        target_kind="artifact",
        target_id=artifact.id,
        meta={
            "from": previous_state.value,
            "to": PublicationState.PUBLIC.value,
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


async def record_bulk_attestation(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    meta: dict[str, Any],
) -> None:
    """One corpus-level audit row for a bulk attestation run.

    Reviewer-scoped so the run is attributed to the human who attested, not to
    the importer that mechanically applied it. The per-record rows remain the
    authority for what was bound; this row records the act itself — statement,
    policy checksum, and which records were deliberately left out.
    """
    workspace = await _get_reviewer_workspace(scope, session, authority=authority)
    await record_audit(
        scope,
        session,
        action="catalog.license.bulk_attestation",
        target_kind="workspace",
        target_id=workspace.id,
        meta=meta,
    )


async def attest_catalog_record(
    importer_scope: Scope,
    reviewer_scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    spdx_id: str,
    assertion_kind: LicenseAssertionKind,
    license_scope: LicenseScope,
    source_kind: SourceKind,
    evidence_hash: str,
    repository: str | None,
    ref: str | None,
    path: str | None,
    retrieval_metadata: dict[str, Any],
    attestation_meta: dict[str, Any],
    claim_hash: str | None = None,
) -> tuple[str, ...]:
    """Bind provenance + an approved license onto one staged record (Slice C.5).

    This is the mechanical half of an owner bulk attestation: the legal half —
    which license, over which records, in whose words — lives in
    catalog_attestation.AttestationPolicy and arrives here as plain values.

    Both principals are required and stay distinct: the importer records the
    source and the *declared* claim, the reviewer approves it and accepts the
    review. Passing one scope for both is impossible — get_importer_workspace and
    _get_reviewer_workspace each reject the other's identity — which is exactly
    the ADR-0016 separation, preserved even in a bulk run.

    Idempotent by construction so a partial run can simply be re-run: each step
    is skipped when its effect is already present. Returns the steps actually
    performed, so the caller can report real work instead of a fixed count.
    """
    workspace = await get_importer_workspace(importer_scope, session, authority=authority)
    artifact = await _get_catalog_artifact(
        session, workspace_id=workspace.id, artifact_id=artifact_id, for_update=True
    )
    version_id = artifact.current_version_id
    if version_id is None:
        raise RepoError(f"catalog artifact {artifact_id} has no current version to attest")
    version = await session.get(ArtifactVersion, version_id)
    if version is None or not version.source_blob_sha256:
        raise RepoError(f"catalog version {version_id} has no pinned source hash")

    performed: list[str] = []

    existing_source = (
        (
            await session.execute(
                select(ArtifactSource).where(ArtifactSource.artifact_version_id == version_id)
            )
        )
        .scalars()
        .first()
    )
    if existing_source is None:
        await record_artifact_source(
            importer_scope,
            session,
            version_id,
            authority=authority,
            source_kind=source_kind,
            content_hash=version.source_blob_sha256,
            # The bytes were pinned when the import staged them; the attestation
            # is a later act and must not overwrite when the content was obtained.
            retrieved_at=version.created_at or dt.datetime.now(dt.UTC),
            repository=repository,
            ref=ref,
            path=path,
            retrieval_metadata=retrieval_metadata,
        )
        performed.append("source")

    current = await _get_current_license_assertion(session, artifact_version_id=version_id)
    if current is None:
        current = await record_license_assertion(
            importer_scope,
            session,
            version_id,
            authority=authority,
            assertion_kind=assertion_kind,
            license_scope=license_scope,
            spdx_id=spdx_id,
            evidence_hash=evidence_hash,
            claim_hash=claim_hash,
        )
        performed.append("declared")

    if current.reviewer_decision != LicenseDecision.APPROVED:
        await decide_license_assertion(
            reviewer_scope,
            session,
            version_id,
            authority=authority,
            decision=LicenseDecision.APPROVED,
            spdx_id=spdx_id,
            evidence_hash=evidence_hash,
            claim_hash=claim_hash,
        )
        await record_audit(
            reviewer_scope,
            session,
            action="catalog.license.attested",
            target_kind="artifact",
            target_id=artifact.id,
            meta={**attestation_meta, "artifact_version_id": str(version_id)},
        )
        performed.append("approved")

    # A record declared with an unknown/conflicting license lands in
    # 'quarantined', which is a legal review transition to 'accepted' — the
    # reviewer decision above is precisely the human act that resolves it.
    if artifact.review_state == ReviewState.DRAFT:
        await submit_for_review(importer_scope, session, artifact.id, authority=authority)
        performed.append("submitted")
    if artifact.review_state in {ReviewState.PENDING_REVIEW, ReviewState.QUARANTINED}:
        await decide_review(
            reviewer_scope,
            session,
            artifact.id,
            authority=authority,
            decision=ReviewState.ACCEPTED,
        )
        performed.append("accepted")

    return tuple(performed)


async def latest_license_claim_hash(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
) -> str | None:
    """The claim hash of the newest licence assertion on ANY version of a record.

    This is the "previous claim" side of AttestedRecord.grant_carries_forward.
    It deliberately looks across versions rather than at the current one: a
    re-imported record has a brand-new version carrying no assertion at all, and
    the question being asked is whether the human grant made over the *previous*
    version still binds. Restricting the lookup to the current version would
    always answer None and quietly turn every carry-forward into a fresh
    signature — the rubber stamp the owner's decision exists to avoid.

    Returns None when no assertion exists, and also when the newest one predates
    migration 0046 and therefore recorded no claim. Both mean "no comparable
    prior grant", and the caller must require a signature rather than infer one.
    """
    workspace = await get_importer_workspace(scope, session, authority=authority)
    await _get_catalog_artifact(session, workspace_id=workspace.id, artifact_id=artifact_id)
    return (
        await session.execute(
            select(LicenseAssertion.claim_hash)
            .join(ArtifactVersion, ArtifactVersion.id == LicenseAssertion.artifact_version_id)
            .where(ArtifactVersion.artifact_id == artifact_id)
            .order_by(LicenseAssertion.created_at.desc(), LicenseAssertion.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def grant_catalog_reviewer(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    user_id: uuid.UUID,
) -> Membership:
    """Importer-only: grant ADMIN on the system catalog to a real human account.

    This is the one bridge into the reviewer role that _get_reviewer_workspace
    accepts, and it is deliberately narrow. The grantee must already exist as a
    provisioned user — a reviewer is an attributable person (ADR-0016), so this
    never conjures an identity — and must be neither the importer nor the public
    reader, which would collapse the importer/reviewer separation the whole
    module is built on. Idempotent: re-granting an existing ADMIN is a no-op, and
    an existing non-ADMIN membership raises rather than being silently upgraded.
    """
    await get_importer_workspace(scope, session, authority=authority)
    if user_id in {authority.importer_user_id, authority.public_reader_user_id}:
        raise AuthzError("catalog reviewer must not be a system catalog service identity")
    if (await session.get(User, user_id)) is None:
        raise NotFoundError("reviewer user")

    existing = await session.get(Membership, (scope.workspace_id, user_id))
    if existing is not None:
        if existing.role != Role.ADMIN:
            raise AuthzError(
                f"user already holds catalog role {existing.role!r}; refusing to change it"
            )
        return existing

    membership = Membership(workspace_id=scope.workspace_id, user_id=user_id, role=Role.ADMIN)
    session.add(membership)
    await record_audit(
        scope,
        session,
        action="catalog.reviewer.granted",
        target_kind="user",
        target_id=user_id,
        meta={"role": Role.ADMIN.value},
    )
    return membership


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
    return await _artifact_publication_readiness(session, artifact=artifact)


def _public_catalog_predicate(workspace_id: uuid.UUID) -> list[Any]:
    """The accepted+public filter, shared by the page query and its count.

    Kept in one place because a count that does not match the rows it claims to
    describe is worse than no count at all: the web app compares the two to
    decide whether it has the whole corpus (see repository-source.ts).
    """
    return [
        Artifact.workspace_id == workspace_id,
        Artifact.deleted_at.is_(None),
        Artifact.review_state == ReviewState.ACCEPTED,
        Artifact.publication_state == PublicationState.PUBLIC,
    ]


def _from_public_catalog(stmt: Select, workspace_id: uuid.UUID) -> Select:
    """Apply the public catalog's FROM, joins and filter to `stmt`.

    Sharing the predicate was not enough. The listing also inner-joins
    ArtifactVersion on `current_version_id` and the count did not, so an
    accepted+public artifact with no current version would be counted and not
    rendered — the same disagreement as the ImportItem join, in the opposite
    direction, and just as invisible.

    Both queries are built through here so the row set has exactly one
    definition. The web app refuses the corpus and serves static data when the
    two disagree (repository-source.ts), so any divergence shows up as a page
    that looks perfectly fine while ignoring the database entirely.
    """
    return (
        stmt.select_from(Artifact)
        .join(ArtifactVersion, ArtifactVersion.id == Artifact.current_version_id)
        .where(*_public_catalog_predicate(workspace_id))
    )


def _latest_import_job_column(column: Any) -> Any:
    """`column` from the import batch that most recently produced this artifact.

    A correlated scalar subquery rather than a join, because it must yield at
    most one row per artifact no matter how many times the record has been
    imported. The predecessor — outerjoin(ImportItem).outerjoin(ImportJob) —
    returned one row per import batch, so a second import of the same corpus
    rendered every record twice while the count still counted artifacts once.

    Newest wins: it describes the import the current version came from. `id`
    breaks the tie because ids are uuid7 and therefore ordered by creation.
    `ix_import_items_artifact_recency` (migration 0046) serves both the
    correlation and the ordering.
    """
    return (
        select(column)
        .select_from(ImportItem)
        .join(ImportJob, ImportJob.id == ImportItem.import_job_id)
        .where(ImportItem.resulting_artifact_id == Artifact.id)
        .order_by(ImportItem.created_at.desc(), ImportItem.id.desc())
        .limit(1)
        .correlate(Artifact)
        .scalar_subquery()
    )


async def count_public_catalog_entries(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
) -> int:
    """How many entries the unpaginated listing would return."""
    workspace = await get_catalog_workspace(scope, session, authority=authority)
    stmt = _from_public_catalog(select(func.count()), workspace.id)
    return int((await session.execute(stmt)).scalar_one())


async def list_public_catalog_entries(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    limit: int | None = None,
    offset: int = 0,
) -> list[PublicCatalogEntry]:
    """Anonymous-safe listing of accepted+public catalog records (Step 6).

    The scope is validated against the server-owned public reader identity and
    the persisted VIEWER membership (get_catalog_workspace), so no HTTP caller
    can substitute a private workspace. Only artifacts that are simultaneously
    review_state='accepted', publication_state='public', and not soft-deleted
    are returned — the exact set a reviewer published. Provenance and the rich
    presentation `record` come from the pinned import source at read time.

    `limit`/`offset` bound the *database* read, not just the response. Bounding
    only the response would leave the original complaint intact: this route read
    the whole table on every anonymous request.

    Offset rather than a keyset cursor, unlike list_artifacts: the ordering key
    here is `coalesce(upstream_identity, slug)`, which nothing enforces as
    unique, and a keyset over a non-unique key silently drops rows. Offset's own
    weakness — drift when rows are inserted mid-pagination — costs nothing on
    this table, whose only writer is an operator running the publication CLI by
    hand.

    Every join here is either to-one or a scalar subquery, and that is load
    bearing: this query has to return exactly as many rows as
    count_public_catalog_entries counts. See _public_provenance for what the
    outerjoin used to cost.
    """
    workspace = await get_catalog_workspace(scope, session, authority=authority)
    stmt = _from_public_catalog(
        select(
            Artifact.slug,
            Artifact.execution_state,
            Artifact.updated_at,
            ArtifactVersion.code,
            ArtifactVersion.source_blob_sha256,
            Artifact.upstream_identity,
            _latest_import_job_column(ImportJob.provider).label("provider"),
            _latest_import_job_column(ImportJob.upstream_ref).label("upstream_ref"),
        ),
        workspace.id,
    ).order_by(func.coalesce(Artifact.upstream_identity, Artifact.slug))
    if offset:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    rows = (await session.execute(stmt)).all()
    return [
        build_public_catalog_entry(
            upstream_identity=row.upstream_identity or row.slug,
            execution_state=row.execution_state,
            updated_at=row.updated_at,
            source_code=row.code,
            source_blob_sha256=row.source_blob_sha256,
            import_provider=row.provider,
            upstream_ref=row.upstream_ref,
        )
        for row in rows
    ]


async def get_public_catalog_entry(
    scope: Scope,
    session: AsyncSession,
    slug: str,
    *,
    authority: CatalogAuthority,
) -> PublicCatalogEntry:
    """Single accepted+public entry by its stable public slug (manifest identity).

    Same authority validation and the same accepted+public filter as the listing,
    so an unpublished or draft record is a 404 to anonymous callers rather than
    an authorization error that would confirm its existence.

    Built through _from_public_catalog for the same reason the listing is: a
    detail route that can resolve a slug the listing does not show — or that
    stops resolving one the listing does — is a 404 nobody can explain.
    """
    workspace = await get_catalog_workspace(scope, session, authority=authority)
    stmt = _from_public_catalog(
        select(
            Artifact.slug,
            Artifact.execution_state,
            Artifact.updated_at,
            ArtifactVersion.code,
            ArtifactVersion.source_blob_sha256,
            Artifact.upstream_identity,
            _latest_import_job_column(ImportJob.provider).label("provider"),
            _latest_import_job_column(ImportJob.upstream_ref).label("upstream_ref"),
        ),
        workspace.id,
    ).where(func.coalesce(Artifact.upstream_identity, Artifact.slug) == slug)
    row = (await session.execute(stmt)).first()
    if row is None:
        raise NotFoundError("catalog entry")
    return build_public_catalog_entry(
        upstream_identity=row.upstream_identity or row.slug,
        execution_state=row.execution_state,
        updated_at=row.updated_at,
        source_code=row.code,
        source_blob_sha256=row.source_blob_sha256,
        import_provider=row.provider,
        upstream_ref=row.upstream_ref,
    )
