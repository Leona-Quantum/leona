"""Workspace-folder repositories for durable run organization."""

import uuid

from majorana_contracts import Scope
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Run, WorkspaceFolder
from ._base import NotFoundError, require_write
from .runs import get_run


def normalize_name(name: str) -> str:
    return " ".join(name.strip().split())[:80]


async def list_folders(scope: Scope, session: AsyncSession) -> list[WorkspaceFolder]:
    """Ordered by the user's arrangement, then by the order this table used to have.

    `(created_at, id)` stays as the tiebreak rather than being replaced: `position`
    carries no unique constraint (see migration 0040), so two folders CAN share
    one, and when they do the result must be the stable order everybody already
    saw rather than whatever Postgres returns.
    """
    stmt = (
        select(WorkspaceFolder)
        .where(WorkspaceFolder.workspace_id == scope.workspace_id)
        .order_by(WorkspaceFolder.position, WorkspaceFolder.created_at, WorkspaceFolder.id)
    )
    return list((await session.execute(stmt)).scalars().all())


async def get_folder(scope: Scope, session: AsyncSession, folder_id: uuid.UUID) -> WorkspaceFolder:
    stmt = select(WorkspaceFolder).where(
        WorkspaceFolder.id == folder_id,
        WorkspaceFolder.workspace_id == scope.workspace_id,
    )
    folder = (await session.execute(stmt)).scalars().first()
    if folder is None:
        raise NotFoundError("folder")
    return folder


async def create_folder(scope: Scope, session: AsyncSession, *, name: str) -> WorkspaceFolder:
    require_write(scope)
    normalized = normalize_name(name)
    existing = (
        (
            await session.execute(
                select(WorkspaceFolder).where(
                    WorkspaceFolder.workspace_id == scope.workspace_id,
                    func.lower(WorkspaceFolder.name) == normalized.lower(),
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    # A new folder goes at the end of the user's arrangement, not at the end of
    # creation order — those stopped being the same thing in migration 0040.
    # `.scalars().first()` rather than `.scalar()`: identical for a one-column
    # select (both give None when the workspace has no folders yet), and the
    # scoping suite's session double implements only the former.
    highest = (
        (
            await session.execute(
                select(func.max(WorkspaceFolder.position)).where(
                    WorkspaceFolder.workspace_id == scope.workspace_id
                )
            )
        )
        .scalars()
        .first()
    )
    folder = WorkspaceFolder(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        name=normalized,
        position=0 if highest is None else highest + 1,
    )
    session.add(folder)
    await session.flush()
    await session.refresh(folder)
    return folder


async def rename_folder(
    scope: Scope, session: AsyncSession, folder_id: uuid.UUID, *, name: str
) -> WorkspaceFolder:
    """Rename in place, refusing a name another folder in this workspace holds.

    `create_folder` returns the existing row on a duplicate name rather than
    erroring — a create is idempotent and that is friendly. A rename is not: it
    would have to either merge two folders or silently do nothing, so it refuses
    and the caller gets to say why. The comparison is case-insensitive to match
    `uq_workspace_folders_workspace_name_lower`, which would otherwise refuse the
    write at the database with an unreadable IntegrityError.
    """
    require_write(scope)
    folder = await get_folder(scope, session, folder_id)
    normalized = normalize_name(name)
    if not normalized:
        raise ValueError("folder name must not be empty")
    if normalized.lower() != folder.name.lower():
        clash = (
            (
                await session.execute(
                    select(WorkspaceFolder).where(
                        WorkspaceFolder.workspace_id == scope.workspace_id,
                        WorkspaceFolder.id != folder_id,
                        func.lower(WorkspaceFolder.name) == normalized.lower(),
                    )
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise ValueError(f"a folder named {normalized!r} already exists")
    folder.name = normalized
    await session.flush()
    return folder


async def delete_folder(scope: Scope, session: AsyncSession, folder_id: uuid.UUID) -> None:
    """Remove the folder; its runs survive, unfiled.

    Deleting the container must never delete the contents — a folder is an
    arrangement, and the runs in it are the user's actual work. `runs.folder_id`
    carries a foreign key with no cascade, so the NULLing is not optional: skip
    it and the DELETE raises instead.
    """
    require_write(scope)
    folder = await get_folder(scope, session, folder_id)
    await session.execute(
        update(Run)
        .where(Run.workspace_id == scope.workspace_id, Run.folder_id == folder.id)
        .values(folder_id=None, updated_at=func.now())
    )
    await session.delete(folder)
    await session.flush()


async def reorder_folders(
    scope: Scope, session: AsyncSession, ordered_ids: list[uuid.UUID]
) -> list[WorkspaceFolder]:
    """Rewrite the whole workspace's folder order from the list the client holds.

    The client sends every folder id it knows about, in the order it wants. That
    is deliberately not a "move folder X to slot N" API: two people dragging in
    two tabs against a positional API interleave into an order neither of them
    chose, whereas last-write-wins on a whole list is at least an order somebody
    actually saw.

    Ids the caller does not own are refused rather than ignored, so a stale tab
    cannot silently drop a folder to the bottom.

    Folders the caller OMITS — one created in another tab since this list was
    rendered — are appended after the arrangement, keeping their relative order.
    They must be renumbered explicitly, not left alone: the listed folders are
    rewritten to 0..n-1, so an untouched folder still holding position 2 would
    reappear in the middle of an order the user just chose.
    """
    require_write(scope)
    if len(set(ordered_ids)) != len(ordered_ids):
        raise ValueError("folder order contains the same folder twice")
    current = await list_folders(scope, session)
    known = {folder.id: folder for folder in current}
    unknown = [str(folder_id) for folder_id in ordered_ids if folder_id not in known]
    if unknown:
        raise NotFoundError(f"folder {unknown[0]}")
    requested = set(ordered_ids)
    # `current` is already in list order, so the omitted folders keep their
    # relative arrangement rather than being reshuffled by dictionary order.
    tail = [folder.id for folder in current if folder.id not in requested]
    for index, folder_id in enumerate([*ordered_ids, *tail]):
        known[folder_id].position = index
    await session.flush()
    return await list_folders(scope, session)


async def set_run_folder(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    folder_id: uuid.UUID | None,
) -> Run:
    require_write(scope)
    run = await get_run(scope, session, run_id, for_update=True)
    if folder_id is not None:
        await get_folder(scope, session, folder_id)
    result = await session.execute(
        update(Run)
        .where(Run.id == run.id, Run.workspace_id == scope.workspace_id)
        .values(folder_id=folder_id, updated_at=func.now())
    )
    if result.rowcount == 0:
        raise NotFoundError("run")
    run.folder_id = folder_id
    return run
