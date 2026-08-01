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
from ..orm import Artifact, ArtifactVersion, Workspace
from ._base import NotFoundError, RepoError, require_admin, require_write


class ArtifactCapReached(RepoError):
    """The workspace already holds as many filed artifacts as its plan allows.

    Carries both numbers because the refusal a user reads names them, and a
    caller that had to recount to build the sentence would be reading outside
    the lock that made the number true.
    """

    def __init__(self, held: int, limit: int) -> None:
        super().__init__(f"workspace holds {held} of its {limit}-artifact plan limit")
        self.held = held
        self.limit = limit


async def count_kept(session: AsyncSession, workspace_id: uuid.UUID) -> int:
    """Filed artifacts in a workspace — the number every plan cap is compared to.

    One definition of "filed", in one place. The predicate (not deleted AND
    `kept_at` set) was written out at three call sites before this existed, and
    a cap comparing a differently-filtered count to the same limit is a cap that
    is wrong in one direction without anything failing.

    Takes a raw `workspace_id` rather than a `Scope` on purpose: `shares.py`
    counts the OWNING workspace of a shared project, which is by definition not
    the caller's scope. The workspace-scoping invariant is satisfied by the
    callers, each of which has already proven its right to the id it passes.
    """
    return int(
        (
            await session.execute(
                select(func.count(Artifact.id)).where(
                    Artifact.workspace_id == workspace_id,
                    Artifact.deleted_at.is_(None),
                    Artifact.kept_at.is_not(None),
                )
            )
        ).scalar_one()
    )


async def reserve_artifact_slot(
    session: AsyncSession, workspace_id: uuid.UUID, limit: int | None
) -> None:
    """Take the workspace's cap lock and refuse if it is already full.

    ## Why a lock, and why on the workspace row

    Before this, the cap was a read-then-write across two statements with
    nothing held between them: the route counted with `get_overview` and the
    repository wrote. Two callers at the boundary both read `24` and both file,
    and the workspace ends up holding 26 against a cap of 25. Measured, not
    reasoned: removing the `with_for_update()` below fails
    `test_artifact_cap_race_live` with the second caller reporting `filed`.

    That test needs **two connections** to show it, which is the part worth
    carrying. An earlier version fired eight concurrent requests through one
    ASGI app and passed against the unlocked code — one event loop runs each
    request's read and write to completion before starting the next, so a burst
    in one process cannot interleave. The API autoscales; two real requests are
    two processes.

    The lock has to be on something all the racers share, and what they share is
    the workspace: they are filing *different* artifacts into it, so locking the
    artifact row (which `keep_artifact` already did) serializes nothing. That is
    the same argument `shares._lock_project` makes for the project cap — this is
    the tier cap's missing half.

    ## Lock ordering

    **This lock is acquired LAST in every path that takes it**, after the
    artifact row (`keep`) or the project row (`contribute`). Nothing acquires a
    row lock after it. That is what keeps the three writers deadlock-free
    without reordering any of them, and it is the rule to preserve if a fourth
    is ever added.

    `limit is None` means unlimited, and takes no lock at all: an unmetered tier
    has nothing to serialize, and making every developer-tier keep queue behind
    one row would be a cost with no purchase.
    """
    if limit is None:
        return
    await session.execute(
        select(Workspace.id).where(Workspace.id == workspace_id).with_for_update()
    )
    held = await count_kept(session, workspace_id)
    if held >= limit:
        raise ArtifactCapReached(held, limit)


async def list_artifacts(
    scope: Scope,
    session: AsyncSession,
    *,
    family: Algorithm | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
    include_unkept: bool = False,
    project_id: uuid.UUID | None = None,
) -> list[tuple[Artifact, dict[str, Any] | None]]:
    """Artifacts plus each one's current-version metadata (None when no version).

    The metadata rides along so the list resource can carry the verification
    grade — without it the web fabricated "verified" for every unopened
    artifact. One outer join, not a per-row fetch.

    Unkept artifacts (migration 0036) are excluded by default: a run always
    materializes, but the result belongs in the Vault only once the user keeps
    it. `include_unkept` exists for callers that reason about everything a
    workspace has produced — quota accounting must NOT use it, or an unkept run
    would spend the user's Vault allowance.

    `project_id` NARROWS, and that is the only reason it is allowed on a
    workspace-scoped function: it is ANDed onto the workspace predicate, never
    substituted for it, so no value of it can reach a row the scope could not
    already reach. `repos/shares.py` passes it with a project it has already
    proven the caller may see — which is how a shared project's contents get
    listed without a second copy of this join drifting away from this one.
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
    if not include_unkept:
        stmt = stmt.where(Artifact.kept_at.is_not(None))
    if family is not None:
        stmt = stmt.where(Artifact.family == family)
    if project_id is not None:
        stmt = stmt.where(Artifact.project_id == project_id)
    if cursor is not None:  # UUIDv7 PKs are time-ordered: id is the cursor
        stmt = stmt.where(Artifact.id < cursor)
    return [
        (row[0], row[1] if isinstance(row[1], dict) else None)
        for row in (await session.execute(stmt)).all()
    ]


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
    kept: bool = True,
) -> Artifact:
    """Create an artifact.

    `kept` defaults True so every existing caller — imports, the catalog staging
    path, tests — keeps behaving as it did. Only the agent save path passes
    False, and only when the workspace has not opted into automatic keeping.
    """
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
        kept_at=dt.datetime.now(dt.UTC) if kept else None,
    )
    session.add(artifact)
    await session.flush()
    return artifact


async def keep_artifact(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    workspace_artifact_limit: int | None,
) -> Artifact:
    """Put a materialized-but-unkept artifact into the Vault.

    Idempotent, and deliberately does not re-stamp: keeping something twice must
    not move it to the top of a list ordered by when the user kept it. Reuses
    get_artifact, so an out-of-workspace or deleted id raises NotFoundError
    rather than silently keeping nothing.

    `workspace_artifact_limit` is a REQUIRED keyword, not a defaulted one, for
    the same reason `shares.contribute_artifact` makes it required: a caller
    that could omit it would silently get no cap check at all, and a cap
    enforced nowhere looks exactly like a cap that passes. `None` means
    unlimited and must be passed explicitly.

    The check lives here rather than at the route because it has to happen under
    `reserve_artifact_slot`'s lock, and a route cannot hold a lock across the
    repository call it is guarding. Re-keeping something already kept skips it
    entirely — that spends no new slot, so an account sitting exactly at its cap
    must not be refused for touching what it already has.
    """
    require_write(scope)
    artifact = await get_artifact(scope, session, artifact_id, for_update=True)
    if artifact.kept_at is None:
        await reserve_artifact_slot(session, scope.workspace_id, workspace_artifact_limit)
        artifact.kept_at = dt.datetime.now(dt.UTC)
        await session.flush()
    return artifact


async def set_visibility(
    scope: Scope, session: AsyncSession, artifact_id: uuid.UUID, visibility: Visibility
) -> None:
    require_admin(scope)
    visibility = Visibility(visibility)
    if visibility is Visibility.PUBLIC:
        artifact = await get_artifact(scope, session, artifact_id, for_update=True)
        if artifact.current_version_id is None:
            raise ValueError("public artifact requires a current version")
        version = await get_version(scope, session, artifact.current_version_id)
        metadata = version.artifact_metadata if isinstance(version.artifact_metadata, dict) else {}
        summary = metadata.get("verification_summary")
        summary = summary if isinstance(summary, dict) else {}
        if not (
            metadata.get("source") == "agent_candidate"
            and metadata.get("source_fingerprint") == version.fingerprint
            and summary.get("verified") is True
            and summary.get("decision") == "pass"
            and summary.get("evidence_strength") == "physical"
        ):
            raise ValueError("public artifact requires verified physical PASS evidence")
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


async def _point_current_version(
    scope: Scope, session: AsyncSession, artifact: Artifact, version: ArtifactVersion
) -> None:
    """Make `version` the artifact's current one.

    Demotes the artifact to PRIVATE, because visibility is earned by whatever is
    current: `set_visibility` only grants PUBLIC while the current version's
    metadata.source_fingerprint equals that version's fingerprint. Moving the
    pointer without demoting would leave an artifact advertising a verdict for
    content it no longer serves.

    A pointer that is already where it should be is left entirely alone. That
    matters for exactly the same reason: re-saving byte-identical content would
    otherwise unpublish a PUBLIC artifact that never changed.
    """
    if artifact.current_version_id == version.id:
        return
    await session.execute(
        update(Artifact)
        .where(Artifact.id == artifact.id, Artifact.workspace_id == scope.workspace_id)
        .values(
            current_version_id=version.id,
            visibility=Visibility.PRIVATE,
            updated_at=func.now(),
        )
    )
    # The SQL expression above can expire ORM attributes under AsyncSession;
    # keep the just-written object safe for callers that serialize it in the
    # same request without triggering implicit IO.
    artifact.current_version_id = version.id
    artifact.visibility = Visibility.PRIVATE
    artifact.updated_at = dt.datetime.now(dt.timezone.utc)


async def get_version_by_fingerprint(
    scope: Scope, session: AsyncSession, artifact_id: uuid.UUID, fingerprint: str
) -> ArtifactVersion | None:
    """The artifact's existing row for this exact content, if it has one."""
    stmt = (
        select(ArtifactVersion)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            ArtifactVersion.artifact_id == artifact_id,
            ArtifactVersion.fingerprint == fingerprint,
            Artifact.workspace_id == scope.workspace_id,
            Artifact.deleted_at.is_(None),
        )
    )
    return (await session.execute(stmt)).scalars().first()


async def list_versions(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    *,
    before_seq: int | None = None,
    limit: int = 50,
) -> list[ArtifactVersion]:
    """One artifact's version history, newest authored first.

    Bounded and cursored on `seq` rather than on id: `seq` is the artifact-local
    authoring order and is what the UI labels rows with, so paging on anything
    else would page differently from how it reads.

    `seq` is NOT "which one is current". A restore moves
    `artifacts.current_version_id` without authoring a row, so max(seq) and the
    current version can be different rows — callers must compare ids.

    Raises NotFoundError for an artifact the scope cannot see, rather than
    returning an empty list, so a foreign id is indistinguishable from a deleted
    one.
    """
    artifact = await get_artifact(scope, session, artifact_id)
    stmt = (
        select(ArtifactVersion)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            ArtifactVersion.artifact_id == artifact.id,
            Artifact.workspace_id == scope.workspace_id,
            Artifact.deleted_at.is_(None),
        )
        .order_by(ArtifactVersion.seq.desc())
        .limit(limit)
    )
    if before_seq is not None:
        stmt = stmt.where(ArtifactVersion.seq < before_seq)
    return list((await session.execute(stmt)).scalars().all())


async def restore_version(
    scope: Scope, session: AsyncSession, artifact_id: uuid.UUID, version_id: uuid.UUID
) -> ArtifactVersion:
    """Make an earlier version current again.

    A pointer move, not a copy. Re-materializing the old content as a new row
    would have to carry that row's verification_summary and source_fingerprint
    into a second row describing the same bytes — evidence copied away from the
    execution that earned it, which ADR-0022 forbids — and UNIQUE(artifact_id,
    fingerprint) would reject it regardless.

    The consequence is that history records authoring, not restores: `seq` never
    moves, and nothing in `artifact_versions` says a restore happened. Only the
    artifact's `current_version_id` and `updated_at` change.
    """
    require_write(scope)
    artifact = await get_artifact(scope, session, artifact_id, for_update=True)
    version = await get_version(scope, session, version_id)
    if version.artifact_id != artifact.id:
        # In-workspace but belonging to a different artifact: restoring it here
        # would graft one artifact's content and evidence onto another.
        raise NotFoundError("artifact version")
    await _point_current_version(scope, session, artifact, version)
    return version


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
    """Save content as this artifact's current version.

    Returning to content the artifact already holds REINSTATES that row rather
    than writing a second one. `uq_artifact_versions_fingerprint` — UNIQUE
    (artifact_id, fingerprint) since migration 0001 — made the second write an
    IntegrityError with no handler, i.e. a 500, for two ordinary things: undoing
    an edit in Studio (A → B → A), and the worker's own
    `RepoReviewArtifactSaver`, which adds a version to the parent artifact ONLY
    when the candidate fingerprint equals the parent's and forks a new artifact
    otherwise — so its single same-artifact branch was the branch whose
    fingerprint was always already taken.

    Reinstating is sound because a fingerprint identifies content: the existing
    row's evidence was earned on these exact bytes, which is the equality
    ADR-0022 already requires between candidate, execution, review and version.
    The cost is that a re-execution of unchanged content does not store a second
    evidence record; the first one still describes the bytes accurately.

    The artifact row lock below is what makes the check-then-insert safe: every
    insert into artifact_versions goes through this function, so two concurrent
    writers cannot both miss the same existing row.
    """
    require_write(scope)
    # Lock the artifact row: serializes concurrent version creation so
    # max(seq)+1 can't collide (uq_artifact_versions_seq rejects the loser), and
    # so the duplicate-fingerprint check below cannot race an insert.
    artifact = await get_artifact(scope, session, artifact_id, for_update=True)
    if any(
        value is not None
        for value in (
            artifact.artifact_kind,
            artifact.execution_state,
            artifact.review_state,
            artifact.publication_state,
        )
    ):
        raise ValueError("catalog artifacts require the catalog repository lifecycle")
    existing = await get_version_by_fingerprint(scope, session, artifact.id, fingerprint)
    if existing is not None:
        await _point_current_version(scope, session, artifact, existing)
        return existing
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
    await _point_current_version(scope, session, artifact, version)
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
