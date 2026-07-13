"""Workspace + membership repositories."""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import Artifact, Membership, Run, User, Workspace
from ._base import AuthzError, NotFoundError, require_admin


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


async def list_members_with_users(
    scope: Scope, session: AsyncSession
) -> list[tuple[Membership, User]]:
    stmt = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.workspace_id == scope.workspace_id)
        .order_by(Membership.created_at, Membership.user_id)
    )
    return list((await session.execute(stmt)).all())


async def get_overview(
    scope: Scope, session: AsyncSession
) -> tuple[Workspace, list[tuple[Membership, User]], int, int]:
    workspace = await get_workspace(scope, session)
    members = await list_members_with_users(scope, session)
    artifact_count = int(
        (
            await session.execute(
                select(func.count(Artifact.id)).where(
                    Artifact.workspace_id == scope.workspace_id,
                    Artifact.deleted_at.is_(None),
                )
            )
        ).scalar_one()
    )
    run_count = int(
        (
            await session.execute(
                select(func.count(Run.id)).where(Run.workspace_id == scope.workspace_id)
            )
        ).scalar_one()
    )
    return workspace, members, artifact_count, run_count


async def add_member(
    scope: Scope, session: AsyncSession, *, user_id: uuid.UUID, role: Role
) -> Membership:
    require_admin(scope)
    if role == Role.OWNER:  # ownership transfer is a separate deliberate operation
        raise AuthzError("cannot grant owner via add_member")
    member = Membership(workspace_id=scope.workspace_id, user_id=user_id, role=role)
    session.add(member)
    await session.flush()
    return member


async def add_member_by_email(
    scope: Scope,
    session: AsyncSession,
    *,
    email: str,
    role: Role,
) -> tuple[Membership, User]:
    """Attach an already-provisioned WorkOS user to this workspace."""
    require_admin(scope)
    if role == Role.OWNER:
        raise AuthzError("cannot grant owner via member invite")
    normalized_email = email.strip().lower()
    user = (
        (await session.execute(select(User).where(func.lower(User.email) == normalized_email)))
        .scalars()
        .first()
    )
    if user is None:
        raise NotFoundError("user")
    existing = await session.execute(
        select(Membership).where(
            Membership.workspace_id == scope.workspace_id,
            Membership.user_id == user.id,
        )
    )
    membership = existing.scalars().first()
    if membership is None:
        membership = Membership(
            workspace_id=scope.workspace_id,
            user_id=user.id,
            role=role,
        )
        session.add(membership)
    elif membership.role != Role.OWNER:
        await session.execute(
            update(Membership)
            .where(
                Membership.workspace_id == scope.workspace_id,
                Membership.user_id == user.id,
            )
            .values(role=role)
        )
        membership.role = role
    await session.flush()
    return membership, user
