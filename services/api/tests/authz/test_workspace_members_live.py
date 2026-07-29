"""Inviting, re-roling and removing collaborators, against live Postgres.

The primitives these exercise have existed and been role-gated for months. What
was missing was any route that called them, and the reason was that a member
attached to a workspace had no way to act in it. Now that they do, the guards
around who may be attached and who may be detached are load-bearing rather than
theoretical, so they are proven here rather than asserted in a docstring.
"""

import uuid

import pytest
from matrix_helpers import requires_db
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select

from majorana_api.orm import Membership, User, Workspace
from majorana_api.repos import AuthzError, NotFoundError, system, workspaces

pytestmark = requires_db


async def _make_user(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"members-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@members.test",
    )


def _scope(user: User, workspace: Workspace, role: Role) -> Scope:
    return Scope(user_id=user.id, workspace_id=workspace.id, role=role)


async def test_invite_attaches_an_existing_account(db):
    host, host_ws = await _make_user(db, "invite-host")
    guest, _ = await _make_user(db, "invite-guest")

    membership, user = await workspaces.add_member_by_email(
        _scope(host, host_ws, Role.OWNER), db, email=guest.email.upper(), role=Role.MEMBER
    )
    assert user.id == guest.id
    assert membership.role == Role.MEMBER
    # Case and surrounding space must not mint a second account.
    assert user.email == guest.email


async def test_invite_of_an_address_that_never_signed_in_is_refused(db):
    host, host_ws = await _make_user(db, "unknown-host")
    with pytest.raises(NotFoundError):
        await workspaces.add_member_by_email(
            _scope(host, host_ws, Role.OWNER),
            db,
            email=f"never-{uuid.uuid4().hex}@members.test",
            role=Role.MEMBER,
        )


@pytest.mark.parametrize("role", [Role.MEMBER, Role.VIEWER])
async def test_only_admins_may_invite(db, role: Role):
    host, host_ws = await _make_user(db, f"gate-host-{role}")
    guest, _ = await _make_user(db, f"gate-guest-{role}")
    with pytest.raises(AuthzError):
        await workspaces.add_member_by_email(
            _scope(host, host_ws, role), db, email=guest.email, role=Role.MEMBER
        )


async def test_owner_cannot_be_removed(db):
    host, host_ws = await _make_user(db, "unremovable")
    admin, _ = await _make_user(db, "unremovable-admin")
    db.add(Membership(workspace_id=host_ws.id, user_id=admin.id, role=Role.ADMIN))
    await db.flush()

    with pytest.raises(AuthzError):
        await workspaces.remove_member(_scope(admin, host_ws, Role.ADMIN), db, user_id=host.id)
    still_there = await system.find_membership(db, workspace_id=host_ws.id, user_id=host.id)
    assert still_there is not None


async def test_owner_role_cannot_be_changed(db):
    host, host_ws = await _make_user(db, "role-locked")
    admin, _ = await _make_user(db, "role-locked-admin")
    db.add(Membership(workspace_id=host_ws.id, user_id=admin.id, role=Role.ADMIN))
    await db.flush()

    with pytest.raises(AuthzError):
        await workspaces.set_member_role(
            _scope(admin, host_ws, Role.ADMIN), db, user_id=host.id, role=Role.VIEWER
        )


async def test_owner_cannot_be_granted_to_a_member(db):
    host, host_ws = await _make_user(db, "no-transfer")
    guest, _ = await _make_user(db, "no-transfer-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    with pytest.raises(AuthzError):
        await workspaces.set_member_role(
            _scope(host, host_ws, Role.OWNER), db, user_id=guest.id, role=Role.OWNER
        )


async def test_removal_revokes_and_drops_the_pointer(db):
    """The one behaviour a caller could get wrong by only deleting the row."""
    host, host_ws = await _make_user(db, "revoke-host")
    guest, guest_ws = await _make_user(db, "revoke-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()
    await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)

    await workspaces.remove_member(_scope(host, host_ws, Role.OWNER), db, user_id=guest.id)

    stored = (
        await db.execute(select(User.active_workspace_id).where(User.id == guest.id))
    ).scalar_one()
    assert stored is None
    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None and active.workspace_id == guest_ws.id


async def test_removing_someone_who_is_not_a_member_is_not_found(db):
    host, host_ws = await _make_user(db, "absent")
    stranger, _ = await _make_user(db, "absent-stranger")
    with pytest.raises(NotFoundError):
        await workspaces.remove_member(_scope(host, host_ws, Role.OWNER), db, user_id=stranger.id)


async def test_a_member_cannot_be_removed_from_a_workspace_they_are_not_in(db):
    """Cross-tenant probe: an admin of A cannot detach a member of B."""
    _host_a, ws_a = await _make_user(db, "cross-a")
    host_b, ws_b = await _make_user(db, "cross-b")
    guest, _ = await _make_user(db, "cross-guest")
    db.add(Membership(workspace_id=ws_b.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    admin_of_a = Scope(user_id=uuid.uuid4(), workspace_id=ws_a.id, role=Role.ADMIN)
    with pytest.raises(NotFoundError):
        await workspaces.remove_member(admin_of_a, db, user_id=guest.id)
    assert await system.find_membership(db, workspace_id=ws_b.id, user_id=guest.id) is not None
    assert host_b is not None


async def test_creating_a_team_workspace_makes_the_creator_its_owner(db):
    user, personal = await _make_user(db, "create")
    workspace, membership = await system.create_team_workspace(
        db, owner=user, name="  Ion   trap  group ", owned_workspace_limit=None
    )
    assert workspace.kind == "team"
    assert workspace.name == "Ion trap group"  # whitespace collapsed, not title-cased
    assert workspace.owner_user_id == user.id
    assert membership.role == Role.OWNER
    # Creating does not enter. The pointer is written by one route only.
    assert user.active_workspace_id is None

    rows = await system.list_user_workspaces(db, user_id=user.id)
    assert {ws.id for ws, _m in rows} == {personal.id, workspace.id}


async def test_the_owned_workspace_limit_counts_the_personal_one(db):
    """A free account owns its personal workspace; the limit is the total.

    If it exempted personal, the number in the refusal would not match the
    number the user can count in their own switcher.
    """
    user, _personal = await _make_user(db, "limit")
    await system.create_team_workspace(db, owner=user, name="one", owned_workspace_limit=3)
    await system.create_team_workspace(db, owner=user, name="two", owned_workspace_limit=3)
    with pytest.raises(system.WorkspaceLimitReached) as reached:
        await system.create_team_workspace(db, owner=user, name="three", owned_workspace_limit=3)
    assert reached.value.owned == 3
    assert reached.value.limit == 3


async def test_an_unlimited_tier_is_not_capped(db):
    user, _personal = await _make_user(db, "unlimited")
    for index in range(4):
        await system.create_team_workspace(
            db, owner=user, name=f"ws {index}", owned_workspace_limit=None
        )
    assert await system.count_owned_workspaces(db, user_id=user.id) == 5


async def test_a_blank_workspace_name_is_refused(db):
    user, _personal = await _make_user(db, "blank")
    with pytest.raises(ValueError):
        await system.create_team_workspace(db, owner=user, name="   ", owned_workspace_limit=None)


async def test_the_allowance_counts_the_user_across_workspaces(db):
    """A collaborator's weekly runs are theirs, and are not multiplied by the
    number of workspaces they can reach."""
    import datetime as dt

    from majorana_contracts.enums import RunMode

    from majorana_api.repos import runs as runs_repo

    host, host_ws = await _make_user(db, "meter-host")
    guest, guest_ws = await _make_user(db, "meter-guest")
    db.add(Membership(workspace_id=host_ws.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    guest_home = _scope(guest, guest_ws, Role.OWNER)
    guest_away = _scope(guest, host_ws, Role.MEMBER)
    host_home = _scope(host, host_ws, Role.OWNER)

    await runs_repo.create_run(
        guest_home, db, task_prompt="at home", mode=RunMode.EXECUTE, framework="qiskit"
    )
    await runs_repo.create_run(
        guest_away, db, task_prompt="away", mode=RunMode.EXECUTE, framework="qiskit"
    )
    await runs_repo.create_run(
        host_home, db, task_prompt="the host's own", mode=RunMode.EXECUTE, framework="qiskit"
    )
    await db.flush()

    since = dt.datetime.now(dt.UTC) - dt.timedelta(days=7)
    # Both of the guest's runs count, in either workspace: switching does not
    # refill the allowance.
    assert await runs_repo.count_execute_runs_since(guest_home, db, since) == 2
    assert await runs_repo.count_execute_runs_since(guest_away, db, since) == 2
    # And the host's run is not charged to the guest.
    assert await runs_repo.count_execute_runs_since(host_home, db, since) == 1
