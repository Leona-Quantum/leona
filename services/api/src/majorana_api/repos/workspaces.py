"""Workspace + membership repositories."""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role, WorkspaceKind
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import Artifact, Membership, Run, User, Workspace
from ._base import AuthzError, NotFoundError, require_admin, require_owner
from .system import reserve_owned_workspace_slot


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
    member = Membership(
        workspace_id=scope.workspace_id,
        user_id=user_id,
        role=role,
        # Somebody else's decision, so it is announced (0038). acknowledged_at
        # stays NULL: this is the row the invitee's notice is read from.
        invited_by_user_id=scope.user_id,
    )
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


async def member_with_user(
    scope: Scope, session: AsyncSession, *, user_id: uuid.UUID
) -> tuple[Membership, User]:
    """A member of this workspace, and the account behind them.

    Scoped read of a row the caller can already see in the members list, so it
    needs no role gate beyond the membership every Scope is built from.
    """
    membership = await _member_row(scope, session, user_id)
    user = (await session.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:  # pragma: no cover - a membership cannot outlive its user
        raise NotFoundError("user")
    return membership, user


async def set_member_role(
    scope: Scope, session: AsyncSession, *, user_id: uuid.UUID, role: Role
) -> tuple[Membership, User]:
    """Change an existing member's role.

    The OWNER role is neither grantable nor removable here, in either direction.
    Granting it would be an ownership transfer — a two-sided operation that also
    demotes the caller, so routing it through a one-sided role change would make
    it look like something it is not. `transfer_ownership` is that operation.
    Taking OWNER away would leave a workspace whose `owner_user_id` points at
    someone with no membership, which is a state nothing else in the system
    expects; the way out of a workspace you own is to hand it over or delete it.
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


class CannotTransferPersonalWorkspace(Exception):
    """A personal workspace belongs to the account, not to a role."""


class AlreadyTheOwner(Exception):
    """The transfer target is the caller."""


async def transfer_ownership(
    scope: Scope,
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    owned_workspace_limit: int | None,
) -> list[tuple[Membership, User]]:
    """Hand a workspace to one of its existing members. Owner only.

    The last hole in the membership lifecycle. An owner could invite, re-role and
    remove other people, but could not be removed, re-roled or leave themselves —
    every one of those refuses, because `workspaces.owner_user_id` would end up
    pointing at somebody with no membership. So an owner who wanted out of their
    own workspace had no operation at all, and neither did a group whose owner
    had left the group.

    Three things move together and must move in one transaction, because any two
    of them without the third is a state the rest of the system does not expect:
    `owner_user_id`, the target's role, and the caller's. The caller becomes
    ADMIN rather than losing their membership — handing over a workspace is not
    the same as leaving it, and if they did want out, `leave_workspace` is now
    open to them, which it was not a moment ago.

    The target is named by user id and must already hold a membership. Never by
    email: `add_member_by_email` exists and would let this route both create an
    account's access and hand it the workspace in one call, which is not an
    invitation, it is a way to give a stranger a tenant.

    The recipient's own `owned_workspaces` allowance is enforced here, which is
    not obvious — no workspace is created, so the total is unchanged. It closes a
    bypass: without it, an account at its limit transfers its workspaces to a
    confederate, creates the same number again, and repeats, and the cap that
    exists to bound the per-workspace Vault caps bounds nothing.
    """
    require_owner(scope)
    if user_id == scope.user_id:
        raise AlreadyTheOwner(str(user_id))
    # Locked for the whole transaction: two owners cannot both be transferring
    # this workspace, and a transfer cannot interleave with its own deletion.
    workspace = (
        await session.execute(
            select(Workspace)
            .where(Workspace.id == scope.workspace_id, Workspace.deleted_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if workspace is None:
        raise NotFoundError("workspace")
    if workspace.kind == WorkspaceKind.PERSONAL:
        # The tenant `resolve_active_workspace` falls back to. Giving it away
        # would leave an account whose own fallback is somebody else's.
        raise CannotTransferPersonalWorkspace(str(workspace.id))
    if workspace.owner_user_id != scope.user_id:
        # The scope says OWNER and the row disagrees. Refusing is the only safe
        # reading: one of the two is wrong and this operation trusts neither.
        raise AuthzError("scope owner does not match the workspace owner")

    membership, target = await member_with_user(scope, session, user_id=user_id)
    # The recipient's allowance, under the recipient's lock. This used to be a
    # second copy of `count_owned_workspaces`' statement written out inline,
    # which made it both a duplicated predicate and — like the create path —
    # a comparison against a count nothing was holding. Two transfers of two
    # different workspaces to the same person hold two different workspace
    # locks, so the lock above serializes neither of them.
    #
    # Taken AFTER the workspace lock, which is the ordering the helper's
    # docstring requires: a user row is the last lock any path takes.
    await reserve_owned_workspace_slot(session, owner_user_id=user_id, limit=owned_workspace_limit)

    caller_membership = await _member_row(scope, session, scope.user_id)
    workspace.owner_user_id = target.id
    membership.role = Role.OWNER
    caller_membership.role = Role.ADMIN
    await session.flush()
    return await list_members_with_users(scope, session)


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
            invited_by_user_id=scope.user_id,
        )
        session.add(membership)
    # A role change on an existing membership does NOT re-announce. They already
    # know they are here — that is what the existing row means — and a notice
    # saying "you were added" for something that happened weeks ago is worse
    # than saying nothing. Telling someone their role changed is a different
    # message, and it does not exist yet.
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
