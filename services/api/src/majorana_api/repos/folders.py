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
    stmt = (
        select(WorkspaceFolder)
        .where(WorkspaceFolder.workspace_id == scope.workspace_id)
        .order_by(WorkspaceFolder.created_at, WorkspaceFolder.id)
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
    folder = WorkspaceFolder(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        name=normalized,
    )
    session.add(folder)
    await session.flush()
    await session.refresh(folder)
    return folder


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
