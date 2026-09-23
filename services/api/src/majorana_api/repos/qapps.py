"""Scoped storage for generated Qapps and their sandbox executions.

Private rows are visible only inside ``scope.workspace_id``. A Qapp explicitly
published by its creator may also be read or executed from another scope; every
such query states that public exception alongside the normal tenant predicate.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import hashlib
import json
import re
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import QappExecutionStatus, Visibility
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import AuditLog, Qapp, QappExecution, QappVersion, Run, User
from ._base import AuthzError, NotFoundError, RepoError, require_write, touched_now
from .audit import record_audit


def _accessible(scope: Scope) -> Any:
    return or_(
        Qapp.workspace_id == scope.workspace_id,
        and_(Qapp.visibility == Visibility.PUBLIC.value, Qapp.deleted_at.is_(None)),
    )


class QappPublicationBlocked(RepoError):
    """The current version has not completed one schema-valid sandbox execution."""


class QappForkBlocked(RepoError):
    """The source Qapp is not eligible to be forked — it must be published."""


class QappExecutionCeiling(RepoError):
    """A spend ceiling refused this execution. ``scope_name`` says which one.

    Three ceilings guard the same paid sandbox, and which one fired changes what
    the caller should do, so the name travels with the refusal rather than being
    flattened into one message:

    ``account``     this visitor has run too many Qapps this hour; another
                    visitor is unaffected.
    ``qapp``        this *published Qapp* has been run too many times this hour
                    by everyone put together; the visitor may not have run it at
                    all. Bounds one popular — or one hostile — public page.
    ``deployment``  every Qapp on the deployment put together. The last backstop
                    on total spend, and the only one whose ceiling does not rise
                    when accounts are added.
    """

    def __init__(self, scope_name: str) -> None:
        super().__init__(f"Qapp execution ceiling reached: {scope_name}")
        self.scope_name = scope_name


def _escape_ilike(term: str) -> str:
    """Escape `%`, `_` and the escape character itself for a literal `ILIKE` match.

    Gallery search is a substring match a visitor types, not a pattern language —
    a title containing a literal `%` or `_` must not let a searcher's `%` or `_`
    behave as a wildcard instead of the character it looks like.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _slug(title: str, qapp_id: uuid.UUID) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:120]
    # UUIDv7 starts with its timestamp. Qapps generated in the same fraction of
    # a second therefore share the first eight characters, which made repeated
    # prompts collide on the globally unique slug. Keep the complete UUID bits:
    # even a 120-character stem remains within the schema's 160-character cap.
    return f"{stem or 'qapp'}-{qapp_id.hex}"


async def create_generated(
    scope: Scope,
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    title: str,
    description: str,
    framework: str,
    qubits_estimate: int,
    ui_document: str,
    quantum_source: str,
    input_schema: dict[str, Any],
    output_schema: dict[str, Any],
    generation_prompt: str,
    source_artifact_version_id: uuid.UUID | None,
    range_smoke: dict[str, Any] | None = None,
) -> tuple[Qapp, QappVersion]:
    """Persist one generated bundle, idempotently by its originating run."""
    require_write(scope)
    # The 1-27 bound is declared on the parsed model AND on every response model,
    # and enforced by neither of them here: this function takes a plain `int` and
    # the column has no check. An out-of-range row is not a bad card — it is a
    # 500 for the WHOLE public gallery, because `list_public_qapps` builds a
    # `PublicQappSummary` per row and one field failing validation fails the
    # response. Cheaper to refuse the write than to serve a broken list.
    if not QAPP_MIN_QUBITS <= qubits_estimate <= QAPP_MAX_QUBITS:
        raise ValueError(
            f"qubits_estimate must be between {QAPP_MIN_QUBITS} and {QAPP_MAX_QUBITS}, "
            f"got {qubits_estimate}"
        )
    existing = (
        await session.execute(
            select(Qapp).where(
                Qapp.created_by_run_id == run_id,
                Qapp.workspace_id == scope.workspace_id,
                Qapp.owner_user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.current_version_id is None:
            raise RuntimeError("Qapp exists without a current version")
        version = (
            await session.execute(
                select(QappVersion).where(
                    QappVersion.id == existing.current_version_id,
                    QappVersion.qapp_id == existing.id,
                )
            )
        ).scalar_one()
        return existing, version

    run_exists = (
        await session.execute(
            select(Run.id).where(
                Run.id == run_id,
                Run.workspace_id == scope.workspace_id,
                Run.user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if run_exists is None:
        raise NotFoundError("run")

    canonical = json.dumps(
        {
            "framework": framework,
            "qubits_estimate": qubits_estimate,
            "ui_document": ui_document,
            "quantum_source": quantum_source,
            "input_schema": input_schema,
            "output_schema": output_schema,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    qapp_id = uuid7()
    qapp = Qapp(
        id=qapp_id,
        workspace_id=scope.workspace_id,
        owner_user_id=scope.user_id,
        slug=_slug(title, qapp_id),
        title=title,
        description=description,
        visibility=Visibility.PRIVATE.value,
        created_by_run_id=run_id,
    )
    version = QappVersion(
        id=uuid7(),
        qapp_id=qapp_id,
        seq=1,
        framework=framework,
        qubits_estimate=qubits_estimate,
        ui_document=ui_document,
        quantum_source=quantum_source,
        input_schema=input_schema,
        output_schema=output_schema,
        fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        source_artifact_version_id=source_artifact_version_id,
        generation_prompt=generation_prompt,
        # Deliberately OUTSIDE `canonical` above, and so outside the fingerprint.
        # The fingerprint identifies the bundle a visitor executes — framework,
        # source, schemas — and two identical bundles must fingerprint the same
        # whether or not anybody measured their top of range. ai-ops#180.
        range_smoke=range_smoke,
    )
    session.add(qapp)
    session.add(version)
    await session.flush()
    qapp.current_version_id = version.id
    await record_audit(
        scope,
        session,
        action="qapp.created",
        target_kind="qapp",
        target_id=qapp.id,
    )
    await session.flush()
    return qapp, version


async def list_qapps(scope: Scope, session: AsyncSession, *, limit: int = 100) -> list[Qapp]:
    return list(
        (
            await session.execute(
                select(Qapp)
                .where(Qapp.workspace_id == scope.workspace_id, Qapp.deleted_at.is_(None))
                .order_by(Qapp.updated_at.desc(), Qapp.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


#: Default and maximum page size for `list_public_qapps`. Kept small: each row
#: also serializes `PublicQappSummary`, and the point of real paging is that a
#: page answers in one bounded query rather than one that grows with the
#: gallery.
PUBLIC_GALLERY_PAGE_DEFAULT = 24
PUBLIC_GALLERY_PAGE_MAX = 60


async def list_public_qapps(
    scope: Scope,
    session: AsyncSession,
    *,
    search: str | None = None,
    before: tuple[dt.datetime, uuid.UUID] | None = None,
    limit: int = PUBLIC_GALLERY_PAGE_DEFAULT,
) -> list[tuple[Qapp, QappVersion]]:
    """One page of published Qapps, newest-published first, with only their
    current version available to projection.

    Real server-side paging and search, not client-side filtering of one page:
    `before` is a keyset cursor on the same `(published_at, id)` pair the list
    is ordered by, and `search` is a substring match on title/description
    pushed into the query rather than applied after the fact — so a Qapp
    published before the first page's window is exactly as searchable as one
    on it. The join here avoids both an N+1 lookup and exposing version
    source/UI fields to callers that only need gallery metadata.
    """
    stmt = (
        select(Qapp, QappVersion)
        .join(
            QappVersion,
            and_(
                QappVersion.qapp_id == Qapp.id,
                QappVersion.id == Qapp.current_version_id,
            ),
        )
        .where(
            _accessible(scope),
            Qapp.visibility == Visibility.PUBLIC.value,
            Qapp.published_at.is_not(None),
            Qapp.deleted_at.is_(None),
        )
    )
    term = (search or "").strip()
    if term:
        pattern = f"%{_escape_ilike(term)}%"
        stmt = stmt.where(
            or_(
                Qapp.title.ilike(pattern, escape="\\"),
                Qapp.description.ilike(pattern, escape="\\"),
            )
        )
    if before is not None:
        before_published_at, before_id = before
        stmt = stmt.where(
            or_(
                Qapp.published_at < before_published_at,
                and_(Qapp.published_at == before_published_at, Qapp.id < before_id),
            )
        )
    bounded = min(max(limit, 1), PUBLIC_GALLERY_PAGE_MAX)
    stmt = stmt.order_by(Qapp.published_at.desc(), Qapp.id.desc()).limit(bounded)
    return list((await session.execute(stmt)).all())


async def get_qapp(
    scope: Scope, session: AsyncSession, qapp_id: uuid.UUID, *, for_update: bool = False
) -> Qapp:
    stmt = select(Qapp).where(
        Qapp.id == qapp_id,
        Qapp.workspace_id == scope.workspace_id,
        Qapp.deleted_at.is_(None),
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp")
    return row


async def get_accessible_by_slug(scope: Scope, session: AsyncSession, slug: str) -> Qapp:
    row = (
        await session.execute(
            select(Qapp).where(Qapp.slug == slug, Qapp.deleted_at.is_(None), _accessible(scope))
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp")
    return row


async def get_current_version(scope: Scope, session: AsyncSession, qapp: Qapp) -> QappVersion:
    if qapp.current_version_id is None:
        raise NotFoundError("qapp version")
    row = (
        await session.execute(
            select(QappVersion)
            .join(Qapp, QappVersion.qapp_id == Qapp.id)
            .where(
                QappVersion.id == qapp.current_version_id,
                QappVersion.qapp_id == qapp.id,
                Qapp.deleted_at.is_(None),
                _accessible(scope),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp version")
    return row


async def get_version(scope: Scope, session: AsyncSession, version_id: uuid.UUID) -> QappVersion:
    """One version of a Qapp this scope's workspace owns — not the public
    projection. Used by version history and rollback, both creator-facing.
    """
    row = (
        await session.execute(
            select(QappVersion)
            .join(Qapp, QappVersion.qapp_id == Qapp.id)
            .where(
                QappVersion.id == version_id,
                Qapp.workspace_id == scope.workspace_id,
                Qapp.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp version")
    return row


async def list_versions(
    scope: Scope,
    session: AsyncSession,
    qapp_id: uuid.UUID,
    *,
    before_seq: int | None = None,
    limit: int = 20,
) -> list[QappVersion]:
    """This Qapp's version history, newest authored first.

    Ordered by `seq` (authoring order), which is NOT "which is current" — a
    rollback moves `qapps.current_version_id` without authoring a row, so the
    current version is frequently not the highest `seq`. Callers compare ids,
    the same discipline `artifacts.list_versions` documents for the identical
    reason.

    Workspace-scoped like every other Qapp read here (`get_qapp`,
    `qapp_detail`) — any co-member can see history. Only rollback itself is
    creator-only, matching how `set_visibility`/`soft_delete_qapp` narrow a
    workspace-scoped read to an owner-only write.
    """
    qapp = await get_qapp(scope, session, qapp_id)
    stmt = (
        select(QappVersion)
        .join(Qapp, QappVersion.qapp_id == Qapp.id)
        .where(
            QappVersion.qapp_id == qapp.id,
            Qapp.workspace_id == scope.workspace_id,
            Qapp.deleted_at.is_(None),
        )
        .order_by(QappVersion.seq.desc())
        .limit(limit)
    )
    if before_seq is not None:
        stmt = stmt.where(QappVersion.seq < before_seq)
    return list((await session.execute(stmt)).scalars().all())


async def list_qapp_activity(
    scope: Scope, session: AsyncSession, qapp_id: uuid.UUID, *, limit: int = 20
) -> list[AuditLog]:
    """Who changed this Qapp's publication state or live version, and when.

    Creator-only, for the same reason publishing and deleting are: a
    workspace co-member can otherwise read out who else touched the
    workspace's Qapp and when. Reuses the append-only `audit_log` table
    (`record_audit`) rather than a new column or table — every action this
    surfaces (`qapp.created`, `qapp.published`, `qapp.unpublished`,
    `qapp.rolled_back`, `qapp.forked`, `qapp.deleted`) already writes there.
    """
    qapp = await get_qapp(scope, session, qapp_id)
    if qapp.owner_user_id != scope.user_id:
        raise AuthzError("only the Qapp creator may view its activity")
    rows = (
        (
            await session.execute(
                select(AuditLog)
                .where(
                    AuditLog.workspace_id == scope.workspace_id,
                    AuditLog.target_kind == "qapp",
                    AuditLog.target_id == qapp.id,
                )
                .order_by(AuditLog.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def roll_back(
    scope: Scope, session: AsyncSession, qapp_id: uuid.UUID, version_id: uuid.UUID
) -> tuple[Qapp, bool]:
    """Make an earlier (or later) version live again. A pointer move, not a copy.

    Returns ``(qapp, demoted_to_private)``. ``demoted_to_private`` is True when
    a PUBLIC Qapp was taken private by this call, which happens only when the
    target version has never completed a successful run: ADR-0031 requires the
    CURRENT version to carry that proof before a Qapp may be public
    (`set_visibility`'s gate), and a rollback must not let a public page start
    serving a version that gate has never seen. When the target version
    already has a qualifying execution — the ordinary case, since every
    version this system has ever produced is born from a generation whose
    low-end smoke run already earned one — the Qapp stays public and the
    public page serves the new version immediately: "the public page always
    serves exactly the chosen version" with no separate re-publish step.

    Creator-only, matching `set_visibility`/`soft_delete_qapp`: `get_qapp` is
    workspace-scoped, so a co-member of the same workspace can read the row,
    and the owner check is what stands between them and repointing (or
    de-publishing) somebody else's Qapp.

    Locked with `for_update` on the Qapp row so a concurrent rollback or
    publish cannot interleave with the gate check below.
    """
    require_write(scope)
    qapp = await get_qapp(scope, session, qapp_id, for_update=True)
    if qapp.owner_user_id != scope.user_id:
        raise AuthzError("only the Qapp creator may change its live version")
    version = await get_version(scope, session, version_id)
    if version.qapp_id != qapp.id:
        raise NotFoundError("qapp version")
    if qapp.current_version_id == version.id:
        return qapp, False

    from_version_id = qapp.current_version_id
    now = touched_now()
    qapp.current_version_id = version.id
    qapp.updated_at = now

    demoted = False
    if qapp.visibility == Visibility.PUBLIC.value:
        succeeded = (
            await session.execute(
                select(QappExecution.id)
                .where(
                    QappExecution.qapp_id == qapp.id,
                    QappExecution.qapp_version_id == version.id,
                    QappExecution.status == QappExecutionStatus.SUCCEEDED.value,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if succeeded is None:
            qapp.visibility = Visibility.PRIVATE.value
            qapp.published_at = None
            demoted = True

    await record_audit(
        scope,
        session,
        action="qapp.rolled_back",
        target_kind="qapp",
        target_id=qapp.id,
        meta={
            "from_version_id": str(from_version_id) if from_version_id else None,
            "to_version_id": str(version.id),
            "to_seq": version.seq,
            "demoted_to_private": demoted,
        },
    )
    await session.flush()
    return qapp, demoted


async def fork_qapp(
    scope: Scope, session: AsyncSession, *, source_slug: str
) -> tuple[Qapp, QappVersion]:
    """Copy a published Qapp's current version into the caller's own account.

    The fork is a NEW Qapp, privately owned by the caller, whose first version
    is a byte-for-byte copy of the source's current version's UI document and
    quantum source. Provenance travels with it (`forked_from_qapp_id`,
    `forked_from_version_id`, migration 0064) so a reader can trace it back.

    Only a PUBLISHED source may be forked — `visibility == public` alone is not
    enough (a Qapp is briefly in that state with `published_at` unset nowhere
    in practice, but the pair is the actual publication contract everywhere
    else in this module, so it is checked here too). This also is what refuses
    forking a private Qapp: a source in the caller's OWN workspace that has
    simply never been published is refused by the same check that refuses a
    stranger's private Qapp, because publication — not workspace membership —
    is the line fork draws.

    The fork itself starts PRIVATE and passes through the ordinary document
    guard (at the worker, on generation) and publication gate
    (`set_visibility`) exactly like any other Qapp: copying a Qapp does not
    copy its proof that it runs; the new owner must execute their own copy
    successfully before they can publish it, because `qapp_executions` is
    keyed on this new `qapp_id`/`qapp_version_id`, not the source's.
    """
    require_write(scope)
    source = await get_accessible_by_slug(scope, session, source_slug)
    if source.visibility != Visibility.PUBLIC.value or source.published_at is None:
        raise QappForkBlocked("only a published Qapp may be forked")
    source_version = await get_current_version(scope, session, source)

    canonical = json.dumps(
        {
            "framework": source_version.framework,
            "qubits_estimate": source_version.qubits_estimate,
            "ui_document": source_version.ui_document,
            "quantum_source": source_version.quantum_source,
            "input_schema": source_version.input_schema,
            "output_schema": source_version.output_schema,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    qapp_id = uuid7()
    qapp = Qapp(
        id=qapp_id,
        workspace_id=scope.workspace_id,
        owner_user_id=scope.user_id,
        slug=_slug(source.title, qapp_id),
        title=source.title,
        description=source.description,
        visibility=Visibility.PRIVATE.value,
        created_by_run_id=None,
        forked_from_qapp_id=source.id,
        forked_from_version_id=source_version.id,
    )
    version = QappVersion(
        id=uuid7(),
        qapp_id=qapp_id,
        seq=1,
        framework=source_version.framework,
        qubits_estimate=source_version.qubits_estimate,
        ui_document=source_version.ui_document,
        quantum_source=source_version.quantum_source,
        input_schema=source_version.input_schema,
        output_schema=source_version.output_schema,
        fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        source_artifact_version_id=None,
        generation_prompt=(f"Forked from qapp {source.slug} (version {source_version.seq})."),
        range_smoke=None,
    )
    session.add(qapp)
    session.add(version)
    await session.flush()
    qapp.current_version_id = version.id
    await record_audit(
        scope,
        session,
        action="qapp.forked",
        target_kind="qapp",
        target_id=qapp.id,
        meta={
            "forked_from_qapp_id": str(source.id),
            "forked_from_version_id": str(source_version.id),
        },
    )
    await session.flush()
    return qapp, version


async def create_from_example(
    scope: Scope,
    session: AsyncSession,
    *,
    example_key: str,
    example_revision: int,
    title: str,
    description: str,
    framework: str,
    qubits_estimate: int,
    ui_document: str,
    quantum_source: str,
    input_schema: dict[str, Any],
    output_schema: dict[str, Any],
) -> tuple[Qapp, QappVersion]:
    """Copy one of Leona's example Qapps into the caller's own account.

    The bundle is passed in whole (the route resolves it from
    `majorana_api.qapp_examples`) so this layer stays free of any knowledge of
    where examples come from. The copy is shaped exactly like a fork
    (`fork_qapp` above): a NEW Qapp, PRIVATE, owned by the caller, with a first
    version holding the bundle byte for byte. It has neither an originating run
    nor a fork source, so both provenance columns are NULL, which
    `ck_qapps_forked_from_pair` (migration 0064) permits because it only
    requires the fork pair to be both-or-neither. Where it came from is recorded
    instead in the version's `generation_prompt` and in the audit entry.

    Publication is untouched: `set_visibility` still refuses until this copy's
    own current version has run successfully, so an example is never public
    until its new owner has run it (ai-ops 363).
    """
    require_write(scope)
    if not QAPP_MIN_QUBITS <= qubits_estimate <= QAPP_MAX_QUBITS:
        raise ValueError(
            f"qubits_estimate must be between {QAPP_MIN_QUBITS} and {QAPP_MAX_QUBITS}, "
            f"got {qubits_estimate}"
        )
    canonical = json.dumps(
        {
            "framework": framework,
            "qubits_estimate": qubits_estimate,
            "ui_document": ui_document,
            "quantum_source": quantum_source,
            "input_schema": input_schema,
            "output_schema": output_schema,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    qapp_id = uuid7()
    qapp = Qapp(
        id=qapp_id,
        workspace_id=scope.workspace_id,
        owner_user_id=scope.user_id,
        slug=_slug(title, qapp_id),
        title=title,
        description=description,
        visibility=Visibility.PRIVATE.value,
        created_by_run_id=None,
        forked_from_qapp_id=None,
        forked_from_version_id=None,
    )
    version = QappVersion(
        id=uuid7(),
        qapp_id=qapp_id,
        seq=1,
        framework=framework,
        qubits_estimate=qubits_estimate,
        ui_document=ui_document,
        quantum_source=quantum_source,
        input_schema=input_schema,
        output_schema=output_schema,
        fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        source_artifact_version_id=None,
        generation_prompt=(
            f"Copied from the Leona example Qapp {example_key!r} (revision {example_revision})."
        ),
        range_smoke=None,
    )
    session.add(qapp)
    session.add(version)
    await session.flush()
    qapp.current_version_id = version.id
    await record_audit(
        scope,
        session,
        action="qapp.created",
        target_kind="qapp",
        target_id=qapp.id,
        meta={"example": example_key, "example_revision": example_revision},
    )
    await session.flush()
    return qapp, version


async def set_visibility(
    scope: Scope, session: AsyncSession, qapp_id: uuid.UUID, visibility: Visibility
) -> Qapp:
    require_write(scope)
    qapp = await get_qapp(scope, session, qapp_id)
    if qapp.owner_user_id != scope.user_id:
        raise AuthzError("only the Qapp creator may publish it")
    visibility = Visibility(visibility)
    if visibility is Visibility.PUBLIC:
        succeeded = (
            await session.execute(
                select(QappExecution.id)
                .where(
                    QappExecution.qapp_id == qapp.id,
                    QappExecution.qapp_version_id == qapp.current_version_id,
                    QappExecution.status == QappExecutionStatus.SUCCEEDED.value,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if succeeded is None:
            raise QappPublicationBlocked("run the current Qapp successfully before publishing it")
    now = touched_now()
    qapp.visibility = visibility.value
    qapp.published_at = now if visibility is Visibility.PUBLIC else None
    qapp.updated_at = now
    await record_audit(
        scope,
        session,
        action="qapp.published" if visibility is Visibility.PUBLIC else "qapp.unpublished",
        target_kind="qapp",
        target_id=qapp.id,
    )
    await session.flush()
    return qapp


async def soft_delete_qapp(scope: Scope, session: AsyncSession, qapp_id: uuid.UUID) -> None:
    """Take a Qapp out of every listing and off its public address.

    The `deleted_at` column and the filter on every read existed from the start;
    nothing ever set it, so a generated Qapp could be unpublished but never
    removed from "My Qapps".

    Creator-only, for the reason publishing is: `get_qapp` is workspace-scoped, so
    a co-member can read the row, and the owner check is all that stands between
    them and deleting somebody else's app.

    The publication stamp is cleared in the same write. Every reader already
    filters on `deleted_at`, so this is not what takes `/q/<slug>` down; it is so
    the row never says "public" about a page that no longer exists, and so
    `ck_qapps_publication_stamp` sees the pair it requires.
    """
    require_write(scope)
    qapp = await get_qapp(scope, session, qapp_id)
    if qapp.owner_user_id != scope.user_id:
        raise AuthzError("only the Qapp creator may delete it")
    now = touched_now()
    qapp.visibility = Visibility.PRIVATE.value
    qapp.published_at = None
    qapp.deleted_at = now
    qapp.updated_at = now
    await record_audit(
        scope,
        session,
        action="qapp.deleted",
        target_kind="qapp",
        target_id=qapp.id,
    )
    await session.flush()


async def create_execution(
    scope: Scope,
    session: AsyncSession,
    *,
    qapp: Qapp,
    version: QappVersion,
    inputs: dict[str, Any],
) -> QappExecution:
    require_write(scope)
    # Re-check access here so a future caller cannot pass an unscoped ORM row.
    accessible = await get_accessible_by_slug(scope, session, qapp.slug)
    if accessible.id != qapp.id or version.qapp_id != qapp.id:
        raise NotFoundError("qapp")
    execution = QappExecution(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        qapp_id=qapp.id,
        qapp_version_id=version.id,
        status=QappExecutionStatus.QUEUED.value,
        inputs=inputs,
    )
    session.add(execution)
    await session.flush()
    return execution


@dataclasses.dataclass
class QappVersionUsageCounts:
    """One version's execution counts, for the creator's usage view only."""

    qapp_version_id: uuid.UUID
    total: int
    succeeded: int
    failed: int
    queued: int
    running: int
    last_execution_at: dt.datetime | None
    last_execution_status: str | None


async def qapp_usage(
    scope: Scope, session: AsyncSession, qapp_id: uuid.UUID
) -> list[QappVersionUsageCounts]:
    """Executions per version, last run, and run outcomes — creator-only.

    Built entirely from `qapp_executions` this Qapp already has: no new
    tracking of viewers or anonymous traffic, and nothing here counts a page
    view. Every row aggregated is a paid sandbox execution someone
    deliberately ran, through `execute_qapp`'s existing spend ceilings.

    Creator-only for the same reason `list_qapp_activity` is: `get_qapp` is
    workspace-scoped, so without the owner check a co-member could read out
    how much another member's Qapp is being used.
    """
    qapp = await get_qapp(scope, session, qapp_id)
    if qapp.owner_user_id != scope.user_id:
        raise AuthzError("only the Qapp creator may view its usage")

    counts_by_status = (
        await session.execute(
            select(
                QappExecution.qapp_version_id,
                QappExecution.status,
                func.count().label("n"),
            )
            .where(QappExecution.qapp_id == qapp.id)
            .group_by(QappExecution.qapp_version_id, QappExecution.status)
        )
    ).all()

    # DISTINCT ON is Postgres-specific, which this repository already is
    # throughout (postgresql.UUID/JSONB columns) — it is the one query shape
    # that gets "the most recent row per version" without one round trip per
    # version found above.
    last_by_version = (
        await session.execute(
            text(
                "select distinct on (qapp_version_id) qapp_version_id, status, created_at "
                "from qapp_executions where qapp_id = :qapp_id "
                "order by qapp_version_id, created_at desc"
            ),
            {"qapp_id": qapp.id},
        )
    ).all()
    last_by_id = {row.qapp_version_id: row for row in last_by_version}

    totals: dict[uuid.UUID, dict[str, int]] = {}
    for version_id, status, n in counts_by_status:
        totals.setdefault(version_id, {})[status] = int(n)

    results: list[QappVersionUsageCounts] = []
    for version_id, by_status in totals.items():
        last = last_by_id.get(version_id)
        results.append(
            QappVersionUsageCounts(
                qapp_version_id=version_id,
                total=sum(by_status.values()),
                succeeded=by_status.get(QappExecutionStatus.SUCCEEDED.value, 0),
                failed=by_status.get(QappExecutionStatus.FAILED.value, 0),
                queued=by_status.get(QappExecutionStatus.QUEUED.value, 0),
                running=by_status.get(QappExecutionStatus.RUNNING.value, 0),
                last_execution_at=last.created_at if last is not None else None,
                last_execution_status=last.status if last is not None else None,
            )
        )
    return results


#: How long a `running` Qapp execution may sit before another delivery may
#: re-claim it. An execution is capped at 120s of sandbox and the job lease at
#: 120s more, so five minutes is comfortably past any live delivery while still
#: short enough that a reader is not left staring at a dead one.
EXECUTION_STALE_AFTER = dt.timedelta(minutes=5)

#: The qubit lane this deployment runs (`majorana_sandbox.spec::DEFAULT_QUBIT_CEILING`,
#: AD-12). Restated here rather than imported because the repository layer must not
#: depend on the sandbox package; `test_qapp_persistence_bound_matches_the_sandbox_lane`
#: asserts the two have not drifted.
QAPP_MIN_QUBITS = 1
QAPP_MAX_QUBITS = 27

#: Key for the transaction-scoped advisory lock that serialises reservations.
#: Arbitrary but fixed, and namespaced by the migration that introduced the
#: counters it protects so a future unrelated advisory lock does not collide.
_PRESSURE_LOCK_KEY = 0x0055_0056


async def reserve_execution_slot(
    scope: Scope,
    session: AsyncSession,
    *,
    since: dt.datetime,
    limit: int,
    qapp_id: uuid.UUID,
    qapp_limit: int,
    deployment_limit: int,
) -> int:
    """Serialize all three spend ceilings before a paid sandbox is queued.

    The per-account ceiling alone is the right bound for a *private* Qapp, where
    the only account that can execute one is the account that owns it. It is not
    a bound at all for a **published** one: `/q/<slug>` is public and runs under
    the *visitor's* account, so per-account x (however many accounts sign up) is
    the real ceiling, and nothing caps how many published Qapps exist. The two
    cross-tenant ceilings are what actually bound spend, and they are read
    through migration 0056's `SECURITY DEFINER` counter rather than a plain
    `count(*)` — see that migration for why an ordinary count here would stop
    bounding anything the day RLS enforcement is switched on.

    One transaction-scoped advisory lock serialises the whole reservation, so
    two concurrent visitors cannot both read a count one below a ceiling and
    both be admitted. It is taken *before* the per-account row lock and never in
    the other order, so the two cannot deadlock against each other.

    A ceiling of `0` disables that one ceiling, matching how `rate_limit.py`
    spells "off" — an unbounded Qapp surface is recoverable and costs money,
    while one refusing every real visitor looks like an outage and cannot be
    diagnosed from the outside.
    """
    require_write(scope)
    await session.execute(select(func.pg_advisory_xact_lock(_PRESSURE_LOCK_KEY)))
    await session.execute(select(User.id).where(User.id == scope.user_id).with_for_update())
    used = int(
        (
            await session.execute(
                select(func.count())
                .select_from(QappExecution)
                .where(
                    QappExecution.user_id == scope.user_id,
                    QappExecution.created_at >= since,
                )
            )
        ).scalar_one()
    )
    if limit and used >= limit:
        raise QappExecutionCeiling("account")
    if qapp_limit or deployment_limit:
        pressure = (
            await session.execute(
                text(
                    "select qapp_count, global_count from qapp_execution_pressure(:since, :qapp_id)"
                ),
                {"since": since, "qapp_id": qapp_id},
            )
        ).one()
        if qapp_limit and int(pressure.qapp_count) >= qapp_limit:
            raise QappExecutionCeiling("qapp")
        if deployment_limit and int(pressure.global_count) >= deployment_limit:
            raise QappExecutionCeiling("deployment")
    return used


async def get_execution(
    scope: Scope, session: AsyncSession, execution_id: uuid.UUID, *, for_update: bool = False
) -> QappExecution:
    stmt = select(QappExecution).where(
        QappExecution.id == execution_id,
        QappExecution.workspace_id == scope.workspace_id,
        QappExecution.user_id == scope.user_id,
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp execution")
    return row


async def get_execution_source(
    scope: Scope, session: AsyncSession, execution_id: uuid.UUID
) -> tuple[QappExecution, QappVersion]:
    execution = await get_execution(scope, session, execution_id, for_update=True)
    version = (
        await session.execute(
            select(QappVersion).where(
                QappVersion.id == execution.qapp_version_id,
                QappVersion.qapp_id == execution.qapp_id,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise NotFoundError("qapp version")
    return execution, version


async def mark_execution_running(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    stale_after: dt.timedelta = EXECUTION_STALE_AFTER,
) -> bool:
    """Claim an execution for THIS delivery. True only if this call claimed it.

    Returning the row was not enough for the one caller that matters. A job the
    queue redelivers while the first delivery is still working finds the row
    already `running`, and a row is a row whether or not you were the one who
    claimed it — so the worker could not tell "I claimed it" from "someone else
    did" and started a second paid sandbox alongside the first. The boolean is
    the whole answer, and it is decided under the `FOR UPDATE` this already
    takes, so two deliveries racing here cannot both be told yes.

    **`stale_after` is why this is not simply `status == QUEUED`.** Refusing
    every non-queued row closes the double-spend and opens a worse hole in its
    place: `recover_stale_jobs` requeues a job only when its LEASE HAS EXPIRED,
    which means the previous worker died mid-execution. That redelivery would
    then find `running`, decline, and return normally — the queue would count
    the job done and the execution would sit in `running` with no result and no
    error, for ever, while the reader's page polled itself out. Trading a
    double charge for a permanently stuck row is not a fix.

    So a `running` row is re-claimable once it is older than any execution could
    legitimately still be. The window is generous on purpose: an execution is
    capped at 120s of sandbox and a lease at 120s more, so anything past
    `EXECUTION_STALE_AFTER` is not a live delivery, it is a dead one. Inside the
    window the answer stays no, which is the case that was costing money.
    """
    require_write(scope)
    row = await get_execution(scope, session, execution_id, for_update=True)
    if row.status == QappExecutionStatus.RUNNING.value:
        started = row.started_at
        if started is not None and started.tzinfo is None:
            started = started.replace(tzinfo=dt.timezone.utc)
        if started is not None and touched_now() - started < stale_after:
            return False
    elif row.status != QappExecutionStatus.QUEUED.value:
        return False
    row.status = QappExecutionStatus.RUNNING.value
    row.started_at = touched_now()
    row.updated_at = row.started_at
    await session.flush()
    return True


async def finish_execution(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    result: dict[str, Any] | None,
    error_code: str | None,
    sandbox_meta: dict[str, Any] | None,
) -> QappExecution:
    require_write(scope)
    row = await get_execution(scope, session, execution_id, for_update=True)
    if row.status in {
        QappExecutionStatus.SUCCEEDED.value,
        QappExecutionStatus.FAILED.value,
    }:
        return row
    now = touched_now()
    row.status = (
        QappExecutionStatus.SUCCEEDED.value
        if error_code is None
        else QappExecutionStatus.FAILED.value
    )
    row.result = result
    row.error_code = error_code
    row.sandbox_meta = sandbox_meta
    row.finished_at = now
    row.updated_at = now
    await session.flush()
    return row
