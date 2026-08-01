"""Studio project repositories — durable artifact grouping (migration 0041).

The Studio counterpart of `folders.py`. Deliberately the same shape: a person
who has learned how Run's Folders behave should not have to learn Projects
separately, and the two files diverging by accident is how one of them ends up
with the reorder semantics nobody chose.

What is NOT here, on purpose: sharing. A project grant is a *second*
authorization path to artifact rows, and every statement below binds
`scope.workspace_id` exactly once. When grants land they arrive as their own
functions with their own scoping proof, not as an extra branch inside these.
"""

import datetime as dt
import uuid

from majorana_contracts import Scope
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, Project
from ._base import NotFoundError, require_write
from .artifacts import get_artifact


def normalize_name(name: str) -> str:
    return " ".join(name.strip().split())[:80]


def _touched_now() -> dt.datetime:
    """The stamp for an in-place edit, as a Python value rather than `func.now()`.

    `updated_at` carries only a `server_default`, so an ORM attribute assignment
    followed by a flush leaves it at its INSERT value and the resource reports a
    stale time. Two things it deliberately is not:

    - `onupdate=func.now()` on the column. SQLAlchemy marks an `onupdate`
      attribute expired after the UPDATE, and the route's next read of it becomes
      a lazy load outside the async greenlet — the exact 500 that
      `set_artifact_project` was fixed for.
    - `func.now()` assigned to the instance. That leaves a SQL expression object
      on the attribute until something refreshes it, which is the same trap
      wearing a different hat.

    A plain UTC datetime is a value the instance keeps, so the row the caller
    serializes is the row that was written.
    """
    return dt.datetime.now(dt.timezone.utc)


async def list_projects(scope: Scope, session: AsyncSession) -> list[Project]:
    """Ordered by the user's arrangement, then by the order this table had.

    `(created_at, id)` is the tiebreak rather than a replacement for it:
    `position` carries no unique constraint (migration 0041, following 0040), so
    two projects CAN share one, and when they do the result must be the stable
    order everybody already saw rather than whatever Postgres returns.
    """
    stmt = (
        select(Project)
        .where(Project.workspace_id == scope.workspace_id)
        .order_by(Project.position, Project.created_at, Project.id)
    )
    return list((await session.execute(stmt)).scalars().all())


async def get_project(scope: Scope, session: AsyncSession, project_id: uuid.UUID) -> Project:
    stmt = select(Project).where(
        Project.id == project_id,
        Project.workspace_id == scope.workspace_id,
    )
    project = (await session.execute(stmt)).scalars().first()
    if project is None:
        raise NotFoundError("project")
    return project


async def create_project(scope: Scope, session: AsyncSession, *, name: str) -> Project:
    """Create, or return the project that already holds this name.

    Idempotent on the name because the web adopts a browser's local projects on
    first sign-in after this shipped, and that adoption runs against whatever the
    server already has — a second device replaying the same list must land on the
    same rows, not on "Bell states (2)".
    """
    require_write(scope)
    normalized = normalize_name(name)
    if not normalized:
        raise ValueError("project name must not be empty")
    existing = (
        (
            await session.execute(
                select(Project).where(
                    Project.workspace_id == scope.workspace_id,
                    func.lower(Project.name) == normalized.lower(),
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    # A new project goes at the end of the arrangement, not at the end of
    # creation order — `position` is what the sidebar reads.
    # `.scalars().first()` rather than `.scalar()`: identical for a one-column
    # select (both give None on an empty workspace), and the scoping suite's
    # session double implements only the former.
    highest = (
        (
            await session.execute(
                select(func.max(Project.position)).where(Project.workspace_id == scope.workspace_id)
            )
        )
        .scalars()
        .first()
    )
    project = Project(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        name=normalized,
        position=0 if highest is None else highest + 1,
    )
    session.add(project)
    await session.flush()
    await session.refresh(project)
    return project


async def rename_project(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID, *, name: str
) -> Project:
    """Rename in place, refusing a name another project in this workspace holds.

    `create_project` returns the existing row on a duplicate name — a create is
    idempotent and that is friendly. A rename is not: it would have to either
    merge two projects or silently do nothing, so it refuses and the caller gets
    to say why. The comparison is case-insensitive to match
    `uq_projects_workspace_name_lower`, which would otherwise refuse the write at
    the database with an unreadable IntegrityError.
    """
    require_write(scope)
    project = await get_project(scope, session, project_id)
    normalized = normalize_name(name)
    if not normalized:
        raise ValueError("project name must not be empty")
    if normalized.lower() != project.name.lower():
        clash = (
            (
                await session.execute(
                    select(Project).where(
                        Project.workspace_id == scope.workspace_id,
                        Project.id != project_id,
                        func.lower(Project.name) == normalized.lower(),
                    )
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise ValueError(f"a project named {normalized!r} already exists")
    project.name = normalized
    project.updated_at = _touched_now()
    await session.flush()
    return project


async def delete_project(scope: Scope, session: AsyncSession, project_id: uuid.UUID) -> None:
    """Remove the project; its artifacts survive, ungrouped.

    Deleting the container must never delete the contents — a project is an
    arrangement, and the artifacts in it are the user's actual work, each one the
    evidence for an execution that earned it. `artifacts.project_id` carries a
    foreign key with no cascade, so the NULLing is not optional: skip it and the
    DELETE raises instead.

    Soft-deleted artifacts are NULLed too. They are excluded from every read, but
    the foreign key does not care what `deleted_at` says, and a restore must not
    resurrect a pointer to a project that is gone.
    """
    require_write(scope)
    project = await get_project(scope, session, project_id)
    await session.execute(
        update(Artifact)
        .where(Artifact.workspace_id == scope.workspace_id, Artifact.project_id == project.id)
        .values(project_id=None, updated_at=func.now())
    )
    await session.delete(project)
    await session.flush()


async def reorder_projects(
    scope: Scope, session: AsyncSession, ordered_ids: list[uuid.UUID]
) -> list[Project]:
    """Rewrite the whole workspace's project order from the list the client holds.

    The client sends every project id it knows about, in the order it wants. That
    is deliberately not a "move project X to slot N" API: two people dragging in
    two tabs against a positional API interleave into an order neither of them
    chose, whereas last-write-wins on a whole list is at least an order somebody
    actually saw.

    Ids the caller does not own are refused rather than ignored, so a stale tab
    cannot silently drop a project to the bottom.

    Projects the caller OMITS — one created in another tab since this list was
    rendered — are appended after the arrangement, keeping their relative order.
    They must be renumbered explicitly, not left alone: the listed projects are
    rewritten to 0..n-1, so an untouched project still holding position 2 would
    reappear in the middle of an order the user just chose.
    """
    require_write(scope)
    if len(set(ordered_ids)) != len(ordered_ids):
        raise ValueError("project order contains the same project twice")
    current = await list_projects(scope, session)
    known = {project.id: project for project in current}
    unknown = [str(project_id) for project_id in ordered_ids if project_id not in known]
    if unknown:
        raise NotFoundError(f"project {unknown[0]}")
    requested = set(ordered_ids)
    # `current` is already in list order, so the omitted projects keep their
    # relative arrangement rather than being reshuffled by dictionary order.
    tail = [project.id for project in current if project.id not in requested]
    touched = _touched_now()
    for index, project_id in enumerate([*ordered_ids, *tail]):
        project = known[project_id]
        # Only the rows that actually move are stamped. Rewriting `updated_at`
        # on every project in the workspace would make a drag that changed two
        # positions look like an edit to all of them.
        if project.position != index:
            project.position = index
            project.updated_at = touched
    await session.flush()
    return await list_projects(scope, session)


async def set_artifact_project(
    scope: Scope,
    session: AsyncSession,
    artifact_id: uuid.UUID,
    project_id: uuid.UUID | None,
) -> Artifact:
    """File an artifact under a project, or (None) return it to the ungrouped list.

    Both ids are resolved through their scoped getters before anything is
    written, so filing workspace A's artifact under workspace B's project is a
    NotFound on whichever half the caller does not own — the same answer as a row
    that never existed.
    """
    require_write(scope)
    artifact = await get_artifact(scope, session, artifact_id, for_update=True)
    if project_id is not None:
        await get_project(scope, session, project_id)
    result = await session.execute(
        update(Artifact)
        .where(Artifact.id == artifact.id, Artifact.workspace_id == scope.workspace_id)
        .values(project_id=project_id, updated_at=func.now())
    )
    if result.rowcount == 0:
        raise NotFoundError("artifact")
    # Re-read rather than patch the in-memory row and hand it back. `updated_at=
    # func.now()` is a SQL expression the ORM cannot evaluate in Python, so this
    # UPDATE synchronizes by EXPIRING the instance — and every attribute the
    # caller then touches becomes a lazy load. Inside a route that load happens
    # outside SQLAlchemy's greenlet and raises MissingGreenlet, which is a 500 on
    # a write that has already succeeded. Caught here by driving the endpoint
    # over HTTP; the repository-level tests never touch a second attribute.
    return await get_artifact(scope, session, artifact_id)
