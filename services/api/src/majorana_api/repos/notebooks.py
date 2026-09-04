"""Scoped storage for notebooks, their versions, and the chat turns that revise them.

Every table here resolves through `notebooks` for its tenant check (migration 0058's
RLS policies do the same, via `exists (select 1 from notebooks ...)`), so a version or
turn belonging to another workspace's notebook is `NotFoundError`, not a 403 — the same
"absent or not yours" the rest of the repository layer gives (`_base.NotFoundError`).

A version is immutable once it leaves `queued`/`running`, except through
`set_version_result`, which is the one function allowed to write its result columns
(`status`, `spec`, `source`, `ipynb`, `report`, `review`, `error`, `finished_at`) and,
when the result is `ready`, to move the notebook's `current_version_id` pointer and
refresh the notebook's own title/summary/kind from the generated spec.
"""

from __future__ import annotations

import uuid
from typing import Any

import majorana_contracts as contracts
from majorana_contracts import Scope
from majorana_contracts.enums import Visibility
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Notebook, NotebookTurn, NotebookVersion
from ._base import NotFoundError, require_write, touched_now
from .audit import record_audit


def _required(value: Any, name: str) -> Any:
    if value is None:
        raise RuntimeError(f"persisted notebook row is missing {name}")
    return value


# --------------------------------------------------------------------------- notebooks


async def create_notebook(
    scope: Scope,
    session: AsyncSession,
    *,
    slug: str,
    title: str,
    kind: str,
    summary: str,
    language: str,
    framework: dict[str, Any],
    request: dict[str, Any],
    run_id: uuid.UUID | None,
    created_by: str = contracts.NotebookVersionAuthor.NALA.value,
) -> tuple[Notebook, NotebookVersion]:
    """Create the notebook and its first version together.

    `created_by` defaults to `nala` (a queued generation) — the shape every
    caller but one wants. `POST /notebooks/import` is the one exception: the
    reader supplied the notebook, not Nala, and passes `created_by="user"` with
    `run_id=None` (nothing was dispatched to produce it) before immediately
    calling `set_version_result` to mark that first version `ready`.
    """
    require_write(scope)
    notebook_id = uuid7()
    notebook = Notebook(
        id=notebook_id,
        workspace_id=scope.workspace_id,
        owner_user_id=scope.user_id,
        slug=slug,
        title=title,
        kind=kind,
        summary=summary,
        visibility=Visibility.PRIVATE.value,
        language=language,
        framework=framework,
    )
    version = NotebookVersion(
        id=uuid7(),
        notebook_id=notebook_id,
        seq=1,
        status=contracts.NotebookVersionStatus.QUEUED.value,
        created_by=created_by,
        message="",
        request=request,
        run_id=run_id,
    )
    session.add(notebook)
    session.add(version)
    await record_audit(
        scope,
        session,
        action="notebook.created",
        target_kind="notebook",
        target_id=notebook_id,
    )
    await session.flush()
    await session.refresh(notebook)
    await session.refresh(version)
    return notebook, version


async def list_notebooks(
    scope: Scope, session: AsyncSession, *, cursor: uuid.UUID | None = None, limit: int = 50
) -> list[Notebook]:
    stmt = (
        select(Notebook)
        .where(Notebook.workspace_id == scope.workspace_id, Notebook.deleted_at.is_(None))
        .order_by(Notebook.id.desc())
        .limit(limit)
    )
    if cursor is not None:  # UUIDv7 PKs are time-ordered: id is the cursor
        stmt = stmt.where(Notebook.id < cursor)
    return list((await session.execute(stmt)).scalars().all())


async def get_notebook(scope: Scope, session: AsyncSession, notebook_id: uuid.UUID) -> Notebook:
    row = (
        await session.execute(
            select(Notebook).where(
                Notebook.id == notebook_id,
                Notebook.workspace_id == scope.workspace_id,
                Notebook.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("notebook")
    return row


async def update_notebook(
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    *,
    title: str | None = None,
    summary: str | None = None,
) -> Notebook:
    require_write(scope)
    notebook = await get_notebook(scope, session, notebook_id)
    if title is not None:
        notebook.title = title
    if summary is not None:
        notebook.summary = summary
    notebook.updated_at = touched_now()
    await session.flush()
    return notebook


async def soft_delete_notebook(scope: Scope, session: AsyncSession, notebook_id: uuid.UUID) -> None:
    require_write(scope)
    notebook = await get_notebook(scope, session, notebook_id)
    now = touched_now()
    notebook.deleted_at = now
    notebook.updated_at = now
    await record_audit(
        scope,
        session,
        action="notebook.deleted",
        target_kind="notebook",
        target_id=notebook.id,
    )
    await session.flush()


# ----------------------------------------------------------------------------- versions


async def create_version(
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    *,
    created_by: str,
    message: str,
    request: dict[str, Any],
    run_id: uuid.UUID | None,
) -> NotebookVersion:
    require_write(scope)
    notebook = await get_notebook(scope, session, notebook_id)
    next_seq = (
        await session.execute(
            select(func.coalesce(func.max(NotebookVersion.seq), 0) + 1).where(
                NotebookVersion.notebook_id == notebook.id
            )
        )
    ).scalar_one()
    version = NotebookVersion(
        id=uuid7(),
        notebook_id=notebook.id,
        seq=next_seq,
        status=contracts.NotebookVersionStatus.QUEUED.value,
        created_by=created_by,
        message=message,
        request=request,
        run_id=run_id,
    )
    session.add(version)
    await session.flush()
    return version


async def get_version(
    scope: Scope, session: AsyncSession, version_id: uuid.UUID
) -> NotebookVersion:
    row = (
        await session.execute(
            select(NotebookVersion)
            .join(Notebook, NotebookVersion.notebook_id == Notebook.id)
            .where(
                NotebookVersion.id == version_id,
                Notebook.workspace_id == scope.workspace_id,
                Notebook.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("notebook version")
    return row


async def get_version_by_run_id(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> NotebookVersion | None:
    """The version created FOR this run — backs idempotent replay of `POST
    /notebooks`: a repeated Idempotency-Key finds the already-created run via
    `runs_repo.find_run_by_idempotency_key`, and this is how the route gets back
    to the notebook that run produced (there is no `notebooks.created_by_run_id`
    column the way `qapps` has one; `notebook_versions.run_id` is the only edge).
    """
    return (
        await session.execute(
            select(NotebookVersion)
            .join(Notebook, NotebookVersion.notebook_id == Notebook.id)
            .where(
                NotebookVersion.run_id == run_id,
                Notebook.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def get_version_by_seq(
    scope: Scope, session: AsyncSession, notebook_id: uuid.UUID, seq: int
) -> NotebookVersion:
    notebook = await get_notebook(scope, session, notebook_id)
    row = (
        await session.execute(
            select(NotebookVersion).where(
                NotebookVersion.notebook_id == notebook.id, NotebookVersion.seq == seq
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("notebook version")
    return row


async def get_current_version(
    scope: Scope, session: AsyncSession, notebook_id: uuid.UUID
) -> NotebookVersion | None:
    notebook = await get_notebook(scope, session, notebook_id)
    if notebook.current_version_id is None:
        return None
    return (
        await session.execute(
            select(NotebookVersion).where(
                NotebookVersion.id == notebook.current_version_id,
                NotebookVersion.notebook_id == notebook.id,
            )
        )
    ).scalar_one_or_none()


async def list_versions(
    scope: Scope, session: AsyncSession, notebook_id: uuid.UUID
) -> list[NotebookVersion]:
    notebook = await get_notebook(scope, session, notebook_id)
    return list(
        (
            await session.execute(
                select(NotebookVersion)
                .where(NotebookVersion.notebook_id == notebook.id)
                .order_by(NotebookVersion.seq.asc())
            )
        )
        .scalars()
        .all()
    )


async def set_version_running(
    scope: Scope, session: AsyncSession, version_id: uuid.UUID
) -> NotebookVersion:
    require_write(scope)
    version = await get_version(scope, session, version_id)
    version.status = contracts.NotebookVersionStatus.RUNNING.value
    await session.flush()
    return version


async def set_version_result(
    scope: Scope,
    session: AsyncSession,
    version_id: uuid.UUID,
    *,
    status: str,
    spec: dict[str, Any] | None,
    source: str,
    ipynb: dict[str, Any] | None,
    report: dict[str, Any] | None,
    review: dict[str, Any] | None,
    error: str,
    message: str | None = None,
) -> NotebookVersion:
    """Write the one-shot result of a generate/revise/rerun job.

    Only on `status == "ready"` does this move the notebook's `current_version_id`
    pointer and refresh title/summary/kind from the spec — a `failed` version is
    recorded (so the reader can see what went wrong and the chat turn can show it)
    without ever becoming what a reader opening the notebook sees.
    """
    require_write(scope)
    version = await get_version(scope, session, version_id)
    version.status = status
    version.spec = spec
    version.source = source
    version.ipynb = ipynb
    version.report = report
    version.review = review
    version.error = error
    version.finished_at = touched_now()
    if message is not None:
        version.message = message
    if status == contracts.NotebookVersionStatus.READY.value:
        notebook = await get_notebook(scope, session, version.notebook_id)
        notebook.current_version_id = version.id
        if spec is not None:
            title = spec.get("title")
            if title:
                notebook.title = title
            summary = spec.get("summary")
            if summary is not None:
                notebook.summary = summary
            kind = spec.get("kind")
            if kind:
                notebook.kind = kind
        notebook.updated_at = touched_now()
    await session.flush()
    return version


async def count_versions(scope: Scope, session: AsyncSession, notebook_id: uuid.UUID) -> int:
    notebook = await get_notebook(scope, session, notebook_id)
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(NotebookVersion)
                .where(NotebookVersion.notebook_id == notebook.id)
            )
        ).scalar_one()
    )


# -------------------------------------------------------------------------------- turns


async def append_turn(
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    *,
    role: str,
    content: str,
    version_id: uuid.UUID | None,
    run_id: uuid.UUID | None,
) -> NotebookTurn:
    require_write(scope)
    notebook = await get_notebook(scope, session, notebook_id)
    next_seq = (
        await session.execute(
            select(func.coalesce(func.max(NotebookTurn.seq), 0) + 1).where(
                NotebookTurn.notebook_id == notebook.id
            )
        )
    ).scalar_one()
    turn = NotebookTurn(
        id=uuid7(),
        notebook_id=notebook.id,
        seq=next_seq,
        role=role,
        content=content,
        version_id=version_id,
        run_id=run_id,
    )
    session.add(turn)
    await session.flush()
    return turn


async def list_turns(
    scope: Scope, session: AsyncSession, notebook_id: uuid.UUID, *, limit: int = 200
) -> list[NotebookTurn]:
    notebook = await get_notebook(scope, session, notebook_id)
    return list(
        (
            await session.execute(
                select(NotebookTurn)
                .where(NotebookTurn.notebook_id == notebook.id)
                .order_by(NotebookTurn.seq.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


# ---------------------------------------------------------------------------- resources


def to_resource(notebook: Notebook, latest_version: NotebookVersion) -> contracts.Notebook:
    """Project a notebook plus its newest version (by `seq`, any status) into the wire
    resource. `latest_status`/`latest_run_id`/`version_count` describe that newest
    version — the point is a list can show "generating" without a second join.

    `current_version_seq` is filled in only when the newest version IS the current
    one. A revision in flight (queued/running past the current ready version, or a
    failed retry) leaves it `None` here rather than guessed at: the true current
    version's `seq` is not derivable from these two rows alone, and a caller that
    needs it exactly (`GET /notebooks/{id}`) fetches the current version itself and
    overrides the field.
    """
    current_version_seq = (
        latest_version.seq if notebook.current_version_id == latest_version.id else None
    )
    return contracts.Notebook(
        id=notebook.id,
        workspace_id=notebook.workspace_id,
        owner_user_id=notebook.owner_user_id,
        slug=notebook.slug,
        title=notebook.title,
        kind=contracts.NotebookKind(notebook.kind),
        summary=notebook.summary,
        visibility=Visibility(notebook.visibility),
        language=notebook.language,
        framework=contracts.NotebookFramework.model_validate(notebook.framework),
        current_version_id=notebook.current_version_id,
        current_version_seq=current_version_seq,
        latest_status=contracts.NotebookVersionStatus(latest_version.status),
        latest_run_id=latest_version.run_id,
        version_count=latest_version.seq,
        created_at=_required(notebook.created_at, "created_at"),
        updated_at=_required(notebook.updated_at, "updated_at"),
        deleted_at=notebook.deleted_at,
    )


def version_to_resource(
    version: NotebookVersion, *, full: bool
) -> contracts.NotebookVersion | contracts.NotebookVersionSummary:
    spec = version.spec if isinstance(version.spec, dict) else None
    report = version.report if isinstance(version.report, dict) else None
    cell_count = len(spec.get("cells", [])) if spec is not None else 0
    ok = report.get("ok") if report is not None else None
    fields: dict[str, Any] = dict(
        id=version.id,
        notebook_id=version.notebook_id,
        seq=version.seq,
        status=contracts.NotebookVersionStatus(version.status),
        created_by=contracts.NotebookVersionAuthor(version.created_by),
        message=version.message,
        ok=ok,
        cell_count=cell_count,
        run_id=version.run_id,
        created_at=_required(version.created_at, "created_at"),
    )
    if not full:
        return contracts.NotebookVersionSummary(**fields)
    return contracts.NotebookVersion(
        **fields,
        spec=contracts.NotebookSpec.model_validate(spec) if spec is not None else None,
        source=version.source or "",
        ipynb=version.ipynb,
        report=contracts.ExecutionReport.model_validate(report) if report is not None else None,
        review=(
            contracts.NotebookReview.model_validate(version.review)
            if version.review is not None
            else None
        ),
        error=version.error,
    )
