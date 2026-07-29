"""Which workspace a request acts in, against live Postgres (migration 0037).

Two things are established here and both are authorization decisions, so neither
belongs in a DB-free test that can only prove a predicate was compiled:

1. A user's *personal* workspace is the one they own. Before collaboration
   nothing could be a member of anyone else's workspace, so "the personal
   workspace I have a membership in" was single-valued by accident. An invite
   makes it plural, and the old query had no ORDER BY — so a user's own identity
   could resolve into someone else's tenant on some requests and not others.
2. `users.active_workspace_id` is a preference, not a grant. It is re-checked
   against `memberships` on every request; a pointer that no longer resolves
   falls back to the workspace the caller owns instead of locking them out.
"""

import datetime as dt
import uuid

import pytest
from matrix_helpers import requires_db
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select

from majorana_api.orm import Membership, User, Workspace
from majorana_api.repos import system, workspaces

pytestmark = requires_db


async def _make_user(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"active-ws-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@active-ws.test",
    )


async def test_personal_workspace_is_the_one_the_user_owns(db):
    """The membership-keyed lookup this replaces could return the host's tenant.

    Mutation check: restore `Membership.user_id == user.id` in `_existing_user`
    in place of the ownership predicate and this fails — the guest's second
    resolution returns whichever personal workspace Postgres happens to hand
    back first.
    """
    _host, host_ws = await _make_user(db, "host")
    guest, guest_ws = await _make_user(db, "guest")

    # The host invites the guest into their PERSONAL workspace, which is exactly
    # what add_member_by_email does today.
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    _user, resolved = await system.get_or_provision_user(
        db, workos_user_id=guest.workos_user_id, email=guest.email
    )
    assert resolved.id == guest_ws.id
    assert resolved.id != host_ws.id
    assert resolved.owner_user_id == guest.id


async def test_absent_pointer_resolves_to_the_personal_workspace(db):
    user, personal = await _make_user(db, "default")
    active = await system.resolve_active_workspace(db, user=user, personal_workspace_id=personal.id)
    assert active is not None
    assert active.workspace_id == personal.id
    assert active.role == Role.OWNER


async def test_pointer_at_a_joined_workspace_carries_that_role(db):
    host, host_ws = await _make_user(db, "role-host")
    guest, guest_ws = await _make_user(db, "role-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.VIEWER))
    await db.flush()

    switched = await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)
    assert switched is not None

    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None
    assert active.workspace_id == host_ws.id
    # The role is the membership's, not the one they hold at home. A guest who
    # is OWNER of their own workspace must not carry that authority into
    # someone else's.
    assert active.role == Role.VIEWER


async def test_revoked_membership_falls_back_and_clears_the_pointer(db):
    host, host_ws = await _make_user(db, "revoke-host")
    guest, guest_ws = await _make_user(db, "revoke-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()
    await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)

    await db.execute(
        Membership.__table__.delete().where(
            Membership.workspace_id == host_ws.id, Membership.user_id == guest.id
        )
    )
    await db.flush()

    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None
    assert active.workspace_id == guest_ws.id
    stored = (
        await db.execute(select(User.active_workspace_id).where(User.id == guest.id))
    ).scalar_one()
    assert stored is None


async def test_soft_deleted_workspace_falls_back(db):
    host, host_ws = await _make_user(db, "deleted-host")
    guest, guest_ws = await _make_user(db, "deleted-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()
    await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)

    host_ws.deleted_at = dt.datetime.now(dt.UTC)
    await db.flush()

    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None
    assert active.workspace_id == guest_ws.id


async def test_switching_into_a_workspace_you_do_not_belong_to_is_refused(db):
    _host, host_ws = await _make_user(db, "stranger-host")
    guest, guest_ws = await _make_user(db, "stranger-guest")

    assert await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id) is None
    stored = (
        await db.execute(select(User.active_workspace_id).where(User.id == guest.id))
    ).scalar_one()
    assert stored is None

    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None
    assert active.workspace_id == guest_ws.id


async def test_switching_into_a_workspace_that_does_not_exist_is_refused(db):
    guest, _guest_ws = await _make_user(db, "ghost")
    assert await system.set_active_workspace(db, user=guest, workspace_id=uuid.uuid4()) is None


async def test_list_user_workspaces_puts_the_personal_one_first(db):
    host, host_ws = await _make_user(db, "list-host")
    guest, guest_ws = await _make_user(db, "list-guest")
    host_ws.name = "aaa-sorts-first-by-name"
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    rows = await system.list_user_workspaces(db, user_id=guest.id)
    assert [ws.id for ws, _m in rows] == [guest_ws.id, host_ws.id]
    assert [m.role for _ws, m in rows] == [Role.OWNER, Role.MEMBER]


async def test_a_team_workspace_you_own_still_sorts_below_your_personal_one(db):
    """The case the first ordering key got wrong.

    "Owned first" and "personal first" are the same rule until the user owns a
    team workspace as well — and then a team called "Ion trap group" sorts above
    a personal workspace named after an email address, which is what a running
    server actually did.
    """
    user, personal = await _make_user(db, "own-team")
    personal.name = "zzz-last-by-name"
    team, _ = await system.create_team_workspace(
        db, owner=user, name="aaa-first-by-name", owned_workspace_limit=None
    )
    await db.flush()

    rows = await system.list_user_workspaces(db, user_id=user.id)
    assert [ws.id for ws, _m in rows] == [personal.id, team.id]


async def test_a_guest_scope_reads_the_host_workspace_not_their_own(db):
    """The point of the whole feature: switching changes what the repos see."""
    host, host_ws = await _make_user(db, "read-host")
    guest, guest_ws = await _make_user(db, "read-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None and active.workspace_id == guest_ws.id

    await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)
    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None

    scope = Scope(user_id=guest.id, workspace_id=active.workspace_id, role=active.role)
    overview = await workspaces.get_workspace(scope, db)
    assert overview.id == host_ws.id


@pytest.mark.parametrize("role", [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER])
async def test_every_role_resolves_its_own_personal_workspace(db, role: Role):
    """A membership anywhere must never displace the workspace a user owns."""
    _host, host_ws = await _make_user(db, f"multi-{role}")
    guest, guest_ws = await _make_user(db, f"multi-guest-{role}")
    if role is not Role.OWNER:
        db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=role))
        await db.flush()

    _user, resolved = await system.get_or_provision_user(
        db, workos_user_id=guest.workos_user_id, email=guest.email
    )
    assert resolved.id == guest_ws.id
