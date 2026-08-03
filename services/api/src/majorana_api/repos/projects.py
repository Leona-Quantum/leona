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

import uuid

from majorana_contracts import Scope
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, Project
from . import artifacts as artifacts_repo
from ._base import NotFoundError, require_admin, require_write, touched_now
from ._project_limits import MAX_PROJECT_ARTIFACT_LIMIT, is_project_shared
from .artifacts import get_artifact

__all__ = [
    "MAX_PROJECT_ARTIFACT_LIMIT",
    "create_project",
    "delete_project",
    "get_project",
    "list_projects",
    "normalize_name",
    "rename_project",
    "reorder_projects",
    "set_artifact_project",
    "set_project_artifact_limit",
]


def normalize_name(name: str) -> str:
    return " ".join(name.strip().split())[:80]


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
    project.updated_at = touched_now()
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
    touched = touched_now()
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
    *,
    workspace_artifact_limit: int | None,
) -> Artifact:
    """File an artifact under a project, or (None) return it to the ungrouped list.

    Both ids are resolved through their scoped getters before anything is
    written, so filing workspace A's artifact under workspace B's project is a
    NotFound on whichever half the caller does not own — the same answer as a row
    that never existed.

    ## Why a move is a metered operation

    It reads like bookkeeping and it is not: under the owner's rule a shared
    project's contents spend no individual allowance, so this function moves
    artifacts between two different ledgers. Both directions had to be handled,
    and only one of them refuses:

    - **Into a project** — spends a slot in that project. This was the hole:
      `contribute_artifact` guarded the per-project limit under a lock for
      guests, and an owner moved artifacts into the very same project without
      the limit being read at all. Measured against `dev` at 6 artifacts into a
      project limited to 2.
    - **Out of a shared project** into an unshared one (or out of every project)
      — spends an individual slot, because the artifact becomes visible to
      `count_kept_against_quota` again. Refused when there is no room, which is
      the direction that stops "share a project, fill it, unshare it" being an
      unlimited Vault.
    - **Into a shared project** — frees an individual slot. Never refused.

    `workspace_artifact_limit` is a REQUIRED keyword for the same reason
    `keep_artifact` makes it one: a caller that could omit it would silently get
    no cap check, and a cap enforced nowhere looks exactly like a cap that
    passes. `None` means unlimited and must be passed explicitly.

    Locks are taken artifact → project → workspace, the order the rest of this
    layer uses. When a move is between two projects only the TARGET is locked:
    the source is losing a row, and a cap is never breached by going down.
    """
    require_write(scope)
    artifact = await get_artifact(scope, session, artifact_id, for_update=True)
    if artifact.project_id == project_id:
        # A no-op move must not spend anything. Dragging a circuit back onto the
        # project it is already in is an ordinary thing to do in the UI, and
        # refusing it at a full project would be refusing a change of nothing.
        return artifact
    was_shared = artifact.project_id is not None and await is_project_shared(
        session, artifact.project_id
    )
    now_shared = False
    if project_id is not None:
        await get_project(scope, session, project_id)
        if artifact.kept_at is not None:
            # Unkept artifacts occupy no project slot — the count is of kept
            # rows — so staging one into a full project is allowed and
            # `keep_artifact` is where it is refused.
            await artifacts_repo.reserve_project_slot(scope, session, project_id)
        now_shared = await is_project_shared(session, project_id)
    if artifact.kept_at is not None and was_shared and not now_shared:
        await artifacts_repo.reserve_artifact_slot(scope, session, workspace_artifact_limit)
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


async def set_project_artifact_limit(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID, *, max_artifacts: int
) -> Project:
    """How many artifacts a SHARE grantee may grow this project to (0043).

    Writes a concrete number, never back to NULL. NULL means "whatever the
    platform default is today" and is the state every project starts in; once an
    owner has chosen, that choice must not be silently re-floated by a later
    change to the default.

    Admin, not write. Lowering this is what takes a collaborator's ability to
    contribute away, so it is the same bar as revoking their grant — and
    `require_write` would let a MEMBER-scoped elevated share scope reach it,
    which is precisely the caller who must not decide their own ceiling.
    """
    require_admin(scope)
    if not 0 <= max_artifacts <= MAX_PROJECT_ARTIFACT_LIMIT:
        raise ValueError(f"an artifact limit must be between 0 and {MAX_PROJECT_ARTIFACT_LIMIT}")
    project = await get_project(scope, session, project_id)
    if project.max_artifacts != max_artifacts:
        project.max_artifacts = max_artifacts
        project.updated_at = touched_now()
        await session.flush()
    return project
