"""Workspace + membership repositories."""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import Membership, Workspace
from ._base import NotFoundError, require_admin


async def get_workspace(scope: Scope, session: AsyncSession) -> Workspace:
    stmt = select(Workspace).where(
        Workspace.id == scope.workspace_id,
        Workspace.deleted_at.is_(None),
    )
    ws = (await session.execute(stmt)).scalars().first()
    if ws is None:
        raise NotFoundError("workspace")
    return ws


async def list_members(scope: Scope, session: AsyncSession) -> list[Membership]:
    stmt = select(Membership).where(Membership.workspace_id == scope.workspace_id)
    return list((await session.execute(stmt)).scalars().all())


async def add_member(
    scope: Scope, session: AsyncSession, *, user_id: uuid.UUID, role: Role
) -> Membership:
    require_admin(scope)
    member = Membership(workspace_id=scope.workspace_id, user_id=user_id, role=role)
    session.add(member)
    await session.flush()
    return member
