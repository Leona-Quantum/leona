"""Handing a workspace over and disposing of it, against live Postgres.

These two close the membership lifecycle. Before them an owner could invite,
re-role and remove everybody else and do none of it to themselves: `leave`,
`remove_member` and `set_member_role` all refuse the owner, because
`workspaces.owner_user_id` would end up pointing at somebody with no membership.
So the owner of a group they had left in real life had no operation at all.

Transfer is the interesting one to prove, because three rows have to move
together — the workspace's owner column, the recipient's role, the caller's —
and any two of them without the third is a state the rest of the system does not
expect. The tests below read all three back rather than trusting the return.
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
        workos_user_id=f"ownership-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@ownership.test",
    )


def _scope(user: User, workspace: Workspace, role: Role) -> Scope:
    return Scope(user_id=user.id, workspace_id=workspace.id, role=role)


async def _team(db, tag: str) -> tuple[User, Workspace]:
    """An owner and a shared workspace they own."""
    owner, _personal = await _make_user(db, tag)
    workspace, _membership = await system.create_team_workspace(
        db, owner=owner, name=f"{tag} group", owned_workspace_limit=None
    )
    return owner, workspace


async def _role_of(db, workspace: Workspace, user: User) -> str | None:
    membership = await system.find_membership(db, workspace_id=workspace.id, user_id=user.id)
    return None if membership is None else membership.role


async def _owner_column(db, workspace: Workspace) -> uuid.UUID:
    return (
        await db.execute(select(Workspace.owner_user_id).where(Workspace.id == workspace.id))
    ).scalar_one()


# --------------------------------------------------------------------------
# Transfer
# --------------------------------------------------------------------------


async def test_transfer_moves_the_owner_column_the_target_and_the_caller(db):
    """All three, in one transaction. Read back out of the database rather than
    taken from the return value, because the return value is what would agree
    with a half-applied transfer."""
    owner, workspace = await _team(db, "handover")
    heir, _ = await _make_user(db, "handover-heir")
    db.add(Membership(workspace_id=workspace.id, user_id=heir.id, role=Role.MEMBER))
    await db.flush()

    await workspaces.transfer_ownership(
        _scope(owner, workspace, Role.OWNER), db, user_id=heir.id, owned_workspace_limit=None
    )

    assert await _owner_column(db, workspace) == heir.id
    assert await _role_of(db, workspace, heir) == Role.OWNER
    # Demoted, not removed. Handing a workspace over is not leaving it.
    assert await _role_of(db, workspace, owner) == Role.ADMIN


async def test_transfer_returns_the_members_list_with_both_roles_changed(db):
    """The Settings panel replaces its state from this, rather than patching two
    rows and hoping they agree with the server."""
    owner, workspace = await _team(db, "returns")
    heir, _ = await _make_user(db, "returns-heir")
    db.add(Membership(workspace_id=workspace.id, user_id=heir.id, role=Role.VIEWER))
    await db.flush()

    members = await workspaces.transfer_ownership(
        _scope(owner, workspace, Role.OWNER), db, user_id=heir.id, owned_workspace_limit=None
    )
    roles = {user.id: membership.role for membership, user in members}
    assert roles[heir.id] == Role.OWNER
    assert roles[owner.id] == Role.ADMIN


@pytest.mark.parametrize("role", [Role.ADMIN, Role.MEMBER, Role.VIEWER])
async def test_only_the_owner_may_transfer(db, role: Role):
    """An admin is somebody the owner trusted with the members list. Giving the
    workspace away is not on that list."""
    owner, workspace = await _team(db, f"gate-{role}")
    other, _ = await _make_user(db, f"gate-other-{role}")
    db.add(Membership(workspace_id=workspace.id, user_id=other.id, role=role))
    await db.flush()

    with pytest.raises(AuthzError):
        await workspaces.transfer_ownership(
            _scope(other, workspace, role), db, user_id=other.id, owned_workspace_limit=None
        )
    assert await _owner_column(db, workspace) == owner.id


async def test_the_target_must_already_be_a_member(db):
    """Never an email, and never a user id that is merely valid. An account with
    no membership here is a 404 — the same answer as an id that does not exist,
    so this cannot be used to ask whether somebody has an account."""
    owner, workspace = await _team(db, "stranger")
    stranger, _ = await _make_user(db, "stranger-outside")

    with pytest.raises(NotFoundError):
        await workspaces.transfer_ownership(
            _scope(owner, workspace, Role.OWNER),
            db,
            user_id=stranger.id,
            owned_workspace_limit=None,
        )
    assert await _owner_column(db, workspace) == owner.id


async def test_transferring_to_yourself_is_refused(db):
    """Would otherwise demote the owner to ADMIN and promote them back in the
    same transaction, leaving a workspace whose owner column is right and whose
    membership row says ADMIN."""
    owner, workspace = await _team(db, "selfish")
    with pytest.raises(workspaces.AlreadyTheOwner):
        await workspaces.transfer_ownership(
            _scope(owner, workspace, Role.OWNER), db, user_id=owner.id, owned_workspace_limit=None
        )
    assert await _role_of(db, workspace, owner) == Role.OWNER


async def test_a_personal_workspace_cannot_be_handed_over(db):
    """It is the tenant `resolve_active_workspace` falls back to. Giving it away
    would leave an account whose own fallback belongs to somebody else."""
    owner, personal = await _make_user(db, "personal-transfer")
    guest, _ = await _make_user(db, "personal-transfer-guest")
    db.add(Membership(workspace_id=personal.id, user_id=guest.id, role=Role.MEMBER))
    await db.flush()

    with pytest.raises(workspaces.CannotTransferPersonalWorkspace):
        await workspaces.transfer_ownership(
            _scope(owner, personal, Role.OWNER), db, user_id=guest.id, owned_workspace_limit=None
        )
    assert await _owner_column(db, personal) == owner.id


async def test_the_recipients_own_workspace_allowance_is_enforced(db):
    """No workspace is created, so this cap looks irrelevant. It closes a bypass:
    without it an account at its limit transfers its workspaces to a confederate,
    creates the same number again and repeats, and the cap that exists to bound
    the per-workspace Vault caps bounds nothing."""
    owner, workspace = await _team(db, "cap")
    heir, _heir_personal = await _make_user(db, "cap-heir")
    db.add(Membership(workspace_id=workspace.id, user_id=heir.id, role=Role.MEMBER))
    await db.flush()

    # The heir already owns their personal workspace, which counts.
    with pytest.raises(system.WorkspaceLimitReached) as reached:
        await workspaces.transfer_ownership(
            _scope(owner, workspace, Role.OWNER), db, user_id=heir.id, owned_workspace_limit=1
        )
    assert reached.value.limit == 1
    assert await _owner_column(db, workspace) == owner.id
    assert await _role_of(db, workspace, heir) == Role.MEMBER


async def test_a_generous_allowance_lets_the_transfer_through(db):
    """The other side of the cap, so the test above is proving the limit rather
    than proving transfers fail."""
    owner, workspace = await _team(db, "cap-ok")
    heir, _ = await _make_user(db, "cap-ok-heir")
    db.add(Membership(workspace_id=workspace.id, user_id=heir.id, role=Role.MEMBER))
    await db.flush()

    await workspaces.transfer_ownership(
        _scope(owner, workspace, Role.OWNER), db, user_id=heir.id, owned_workspace_limit=2
    )
    assert await _owner_column(db, workspace) == heir.id


async def test_a_scope_that_disagrees_with_the_owner_column_is_refused(db):
    """Role OWNER in the scope, somebody else in the row. One of the two is
    wrong and this operation trusts neither."""
    owner, workspace = await _team(db, "disagree")
    impostor, _ = await _make_user(db, "disagree-impostor")
    heir, _ = await _make_user(db, "disagree-heir")
    db.add(Membership(workspace_id=workspace.id, user_id=impostor.id, role=Role.OWNER))
    db.add(Membership(workspace_id=workspace.id, user_id=heir.id, role=Role.MEMBER))
    await db.flush()

    with pytest.raises(AuthzError):
        await workspaces.transfer_ownership(
            _scope(impostor, workspace, Role.OWNER),
            db,
            user_id=heir.id,
            owned_workspace_limit=None,
        )
    assert await _owner_column(db, workspace) == owner.id


async def test_the_old_owner_can_leave_once_they_have_handed_it_over(db):
    """The whole point. Before this, `leave_workspace` refused the owner and
    there was no operation that made them stop being one."""
    owner, workspace = await _team(db, "exit")
    heir, _ = await _make_user(db, "exit-heir")
    db.add(Membership(workspace_id=workspace.id, user_id=heir.id, role=Role.MEMBER))
    await db.flush()

    with pytest.raises(system.CannotLeaveOwnedWorkspace):
        await system.leave_workspace(db, user=owner, workspace_id=workspace.id)

    await workspaces.transfer_ownership(
        _scope(owner, workspace, Role.OWNER), db, user_id=heir.id, owned_workspace_limit=None
    )
    assert await system.leave_workspace(db, user=owner, workspace_id=workspace.id) is True
    assert await _role_of(db, workspace, owner) is None
    assert await _role_of(db, workspace, heir) == Role.OWNER


# --------------------------------------------------------------------------
# Delete
# --------------------------------------------------------------------------


async def test_delete_removes_the_workspace_from_every_member_switcher(db):
    """A soft delete, and `deleted_at` is already the predicate every workspace
    read filters on — so one write removes it from the switcher, the invitation
    list and scope resolution at once."""
    owner, workspace = await _team(db, "retire")
    member, _ = await _make_user(db, "retire-member")
    db.add(Membership(workspace_id=workspace.id, user_id=member.id, role=Role.MEMBER))
    await db.flush()

    assert await system.delete_workspace(db, user=owner, workspace_id=workspace.id) is True

    for person in (owner, member):
        listed = await system.list_user_workspaces(db, user_id=person.id)
        assert workspace.id not in {row.id for row, _membership in listed}


async def test_only_the_owner_may_delete(db):
    """403, not 404: an admin can see the workspace, they simply may not do
    this. Distinguishable because they are already a member of it."""
    owner, workspace = await _team(db, "delete-gate")
    admin, _ = await _make_user(db, "delete-gate-admin")
    db.add(Membership(workspace_id=workspace.id, user_id=admin.id, role=Role.ADMIN))
    await db.flush()

    with pytest.raises(system.NotWorkspaceOwner):
        await system.delete_workspace(db, user=admin, workspace_id=workspace.id)
    assert await system.delete_workspace(db, user=owner, workspace_id=workspace.id) is True


async def test_a_non_member_gets_the_same_answer_as_a_workspace_that_is_absent(db):
    """False either way, which the route turns into 404 — holding an id tells a
    stranger nothing about whether it names anything."""
    _owner, workspace = await _team(db, "outsider")
    outsider, _ = await _make_user(db, "outsider-user")

    assert await system.delete_workspace(db, user=outsider, workspace_id=workspace.id) is False
    assert await system.delete_workspace(db, user=outsider, workspace_id=uuid.uuid4()) is False


async def test_a_personal_workspace_cannot_be_deleted(db):
    """Deleting it would leave the account with nothing to fall back to, which
    is a broken account rather than an empty one."""
    owner, personal = await _make_user(db, "personal-delete")
    with pytest.raises(system.CannotDeletePersonalWorkspace):
        await system.delete_workspace(db, user=owner, workspace_id=personal.id)


async def test_delete_clears_the_pointer_of_everyone_standing_in_it(db):
    """`resolve_active_workspace` falls back on a pointer that no longer
    resolves, so this is not what makes the deletion correct. It is what stops
    every other member paying a failed lookup for a tenant that is gone."""
    owner, workspace = await _team(db, "pointer")
    member, member_personal = await _make_user(db, "pointer-member")
    db.add(Membership(workspace_id=workspace.id, user_id=member.id, role=Role.MEMBER))
    await db.flush()
    await system.set_active_workspace(db, user=owner, workspace_id=workspace.id)
    await system.set_active_workspace(db, user=member, workspace_id=workspace.id)
    assert member.active_workspace_id == workspace.id

    await system.delete_workspace(db, user=owner, workspace_id=workspace.id)
    await db.refresh(member)
    await db.refresh(owner)
    assert member.active_workspace_id is None
    assert owner.active_workspace_id is None

    # And the member lands back in their own tenant rather than being refused.
    resolved = await system.resolve_active_workspace(
        db, user=member, personal_workspace_id=member_personal.id
    )
    assert resolved is not None and resolved.workspace_id == member_personal.id


async def test_deleting_gives_the_owned_workspace_allowance_back(db):
    """`count_owned_workspaces` filters on `deleted_at`, so a retired workspace
    stops spending a slot. Asserted because the alternative — a cap that counts
    workspaces the user can no longer see — is the kind of thing nobody notices
    until somebody hits it."""
    owner, workspace = await _team(db, "allowance")
    before = await system.count_owned_workspaces(db, user_id=owner.id)
    await system.delete_workspace(db, user=owner, workspace_id=workspace.id)
    assert await system.count_owned_workspaces(db, user_id=owner.id) == before - 1


async def test_a_deleted_workspace_stops_announcing_itself(db):
    """An unacknowledged membership is the invitation (0038). Deleting the
    workspace has to withdraw it, or somebody is told about a tenant they cannot
    open."""
    owner, workspace = await _team(db, "withdraw")
    invitee, _ = await _make_user(db, "withdraw-invitee")
    await workspaces.add_member_by_email(
        _scope(owner, workspace, Role.OWNER), db, email=invitee.email, role=Role.MEMBER
    )
    outstanding = await system.list_unacknowledged_memberships(db, user_id=invitee.id)
    assert workspace.id in {row.id for row, _m, _i in outstanding}

    await system.delete_workspace(db, user=owner, workspace_id=workspace.id)
    outstanding = await system.list_unacknowledged_memberships(db, user_id=invitee.id)
    assert workspace.id not in {row.id for row, _m, _i in outstanding}


async def test_deleting_twice_is_not_an_error_the_second_time_it_is_absent(db):
    """The second call finds no live workspace and answers False, which the
    route turns into 404 — the honest answer for a workspace that is gone."""
    owner, workspace = await _team(db, "twice")
    assert await system.delete_workspace(db, user=owner, workspace_id=workspace.id) is True
    assert await system.delete_workspace(db, user=owner, workspace_id=workspace.id) is False
