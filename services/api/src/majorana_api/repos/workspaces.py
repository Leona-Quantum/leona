"""Workspace + membership repositories."""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import delete, func, select, update
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


async def auto_keep_artifacts(scope: Scope, session: AsyncSession) -> bool:
    """Whether finished runs put their artifact straight into the Vault (0036).

    Read on the save path, so a missing workspace must not fail a run that has
    already done all its work: absence resolves to the default, which is the
    safe direction — the artifact still exists and can be kept by hand, whereas
    defaulting to True would file things the user did not ask for.
    """
    value = (
        await session.execute(
            select(Workspace.auto_keep_artifacts).where(
                Workspace.id == scope.workspace_id,
                Workspace.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return bool(value)


async def set_auto_keep_artifacts(
    scope: Scope, session: AsyncSession, *, enabled: bool
) -> Workspace:
    """Flip the settings toggle. Applies to future saves only, never backwards."""
    workspace = await get_workspace(scope, session)
    workspace.auto_keep_artifacts = enabled
    await session.flush()
    return workspace


async def update_display_name(
    scope: Scope,
    session: AsyncSession,
    *,
    display_name: str | None,
) -> User:
    """Update only the scoped user's profile name."""
    stmt = (
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            User.id == scope.user_id,
            Membership.workspace_id == scope.workspace_id,
        )
        .with_for_update()
    )
    user = (await session.execute(stmt)).scalars().first()
    if user is None:
        raise NotFoundError("user")
    user.display_name = display_name
    await session.flush()
    return user


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
                # Kept only: this is the number the account page shows as the
                # user's artifacts, and it must agree with what the Vault lists.
                # A materialized-but-unkept run is not theirs yet (0036).
                select(func.count(Artifact.id)).where(
                    Artifact.workspace_id == scope.workspace_id,
                    Artifact.deleted_at.is_(None),
                    Artifact.kept_at.is_not(None),
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


async def _member_row(scope: Scope, session: AsyncSession, user_id: uuid.UUID) -> Membership:
    membership = (
        (
            await session.execute(
                select(Membership).where(
                    Membership.workspace_id == scope.workspace_id,
                    Membership.user_id == user_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if membership is None:
        raise NotFoundError("membership")
    return membership


async def set_member_role(
    scope: Scope, session: AsyncSession, *, user_id: uuid.UUID, role: Role
) -> tuple[Membership, User]:
    """Change an existing member's role.

    The OWNER role is neither grantable nor removable here, in either direction.
    Granting it would be an ownership transfer, and taking it away would leave a
    workspace whose `owner_user_id` points at someone with no membership — a
    state nothing else in the system expects. Both are deliberate separate
    operations that do not exist yet.
    """
    require_admin(scope)
    if role == Role.OWNER:
        raise AuthzError("cannot grant owner via role change")
    membership = await _member_row(scope, session, user_id)
    if membership.role == Role.OWNER:
        raise AuthzError("cannot change the role of the workspace owner")
    membership.role = role
    await session.flush()
    user = (await session.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:  # pragma: no cover - a membership cannot outlive its user
        raise NotFoundError("user")
    return membership, user


async def remove_member(scope: Scope, session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """Revoke a member's access to this workspace.

    Takes effect on their next request, not their next sign-in: the active
    workspace pointer is re-validated against this table every time a scope is
    derived, so a removed user's next call resolves back to their own workspace.
    Their runs and artifacts stay — they belong to the workspace, not to them.
    """
    require_admin(scope)
    membership = await _member_row(scope, session, user_id)
    if membership.role == Role.OWNER:
        raise AuthzError("cannot remove the workspace owner")
    await session.execute(
        delete(Membership).where(
            Membership.workspace_id == scope.workspace_id,
            Membership.user_id == user_id,
        )
    )
    # Anyone pointing at this workspace loses the pointer now rather than on
    # their next request. The re-check in resolve_active_workspace makes this
    # redundant for correctness; it is here so a revoked user is not carrying a
    # stale pointer at a tenant they can no longer enter.
    await session.execute(
        update(User)
        .where(User.id == user_id, User.active_workspace_id == scope.workspace_id)
        .values(active_workspace_id=None)
    )
    await session.flush()


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
