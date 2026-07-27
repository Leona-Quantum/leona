"""Being told you were invited, and being able to say no (migration 0038).

Before this, an invite was silent. `add_member_by_email` attached an account and
returned 201 to the *inviter*; the invited person's next page load was
indistinguishable from any other, and the only way out of a workspace somebody
put them in was to ask that person to remove them.

Everything here is a live-database test rather than a shape assertion, because
every property that matters is about which rows exist:

- an announcement is the ABSENCE of `acknowledged_at`, so anything that creates a
  membership silently — provisioning, creating your own workspace — has to stamp
  it, and a miss shows up as a user being told about their own account;
- acknowledgement has three doors (open, dismiss, leave) and they have to agree;
- leaving is a delete, and the thing that makes it safe is that the owner cannot.
"""

import uuid

import pytest
from matrix_helpers import requires_db
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Membership, User, Workspace
from majorana_api.repos import system, workspaces

pytestmark = requires_db


async def _make_user(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"invites-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@invites.test",
    )


def _scope(user: User, workspace: Workspace, role: Role) -> Scope:
    return Scope(user_id=user.id, workspace_id=workspace.id, role=role)


async def _invite(db, host: User, host_ws: Workspace, guest: User, role=Role.MEMBER) -> Membership:
    membership, _user = await workspaces.add_member_by_email(
        _scope(host, host_ws, Role.OWNER), db, email=guest.email, role=role
    )
    return membership


async def test_a_new_account_is_told_about_nothing(db):
    """The failure this guards is the embarrassing one: shipping 0038 and having
    every user's first page load announce the personal workspace that signing in
    created for them. Mutation check: drop `acknowledged_at` from the Membership
    built in `get_or_provision_user` and this fails."""
    user, _personal = await _make_user(db, "fresh")
    assert await system.list_unacknowledged_memberships(db, user_id=user.id) == []


async def test_creating_your_own_workspace_announces_nothing(db):
    owner, _personal = await _make_user(db, "creator")
    await system.create_team_workspace(
        db, owner=owner, name="Ion trap group", owned_workspace_limit=None
    )
    assert await system.list_unacknowledged_memberships(db, user_id=owner.id) == []


async def test_an_invite_announces_itself_with_its_author(db):
    host, host_ws = await _make_user(db, "author-host")
    guest, _ = await _make_user(db, "author-guest")
    await _invite(db, host, host_ws, guest, role=Role.VIEWER)

    outstanding = await system.list_unacknowledged_memberships(db, user_id=guest.id)
    assert len(outstanding) == 1
    workspace, membership, inviter = outstanding[0]
    assert workspace.id == host_ws.id
    assert membership.role == Role.VIEWER
    # Who did this. Without it the only honest sentence is "you were added to X",
    # which reads like something the system did rather than a colleague.
    assert inviter is not None and inviter.id == host.id
    assert inviter.email == host.email


async def test_the_inviter_is_told_about_nothing(db):
    """An invite announces to the invitee only. The host pressed the button."""
    host, host_ws = await _make_user(db, "quiet-host")
    guest, _ = await _make_user(db, "quiet-guest")
    await _invite(db, host, host_ws, guest)
    assert await system.list_unacknowledged_memberships(db, user_id=host.id) == []


async def test_opening_the_workspace_acknowledges_it(db):
    """The notice must not follow someone around INSIDE the workspace it is
    announcing. Settings' switcher has never called an acknowledge route and
    never will, so the acknowledgement belongs to the switch itself."""
    host, host_ws = await _make_user(db, "open-host")
    guest, _ = await _make_user(db, "open-guest")
    await _invite(db, host, host_ws, guest)

    switched = await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)
    assert switched is not None
    assert await system.list_unacknowledged_memberships(db, user_id=guest.id) == []


async def test_dismissing_silences_the_notice_without_entering(db):
    host, host_ws = await _make_user(db, "dismiss-host")
    guest, guest_ws = await _make_user(db, "dismiss-guest")
    await _invite(db, host, host_ws, guest)

    assert await system.acknowledge_membership(db, user=guest, workspace_id=host_ws.id) is True
    assert await system.list_unacknowledged_memberships(db, user_id=guest.id) == []
    # Dismissing is "not now", not "no": the access is still there, and the
    # caller has NOT been moved into the workspace they declined to open.
    active = await system.resolve_active_workspace(
        db, user=guest, personal_workspace_id=guest_ws.id
    )
    assert active is not None and active.workspace_id == guest_ws.id
    assert {ws.id for ws, _m in await system.list_user_workspaces(db, user_id=guest.id)} == {
        guest_ws.id,
        host_ws.id,
    }


async def test_acknowledging_twice_is_the_same_as_once(db):
    """Two tabs answer the same notice. The second must not move the timestamp,
    or the record of when they were told drifts every time they click."""
    host, host_ws = await _make_user(db, "twice-host")
    guest, _ = await _make_user(db, "twice-guest")
    await _invite(db, host, host_ws, guest)

    await system.acknowledge_membership(db, user=guest, workspace_id=host_ws.id)
    first = (
        await db.execute(
            select(Membership.acknowledged_at).where(
                Membership.workspace_id == host_ws.id, Membership.user_id == guest.id
            )
        )
    ).scalar_one()
    await system.acknowledge_membership(db, user=guest, workspace_id=host_ws.id)
    second = (
        await db.execute(
            select(Membership.acknowledged_at).where(
                Membership.workspace_id == host_ws.id, Membership.user_id == guest.id
            )
        )
    ).scalar_one()
    assert first == second
    # And the door they came through does not matter: switching in afterwards
    # must not re-stamp either.
    await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)
    third = (
        await db.execute(
            select(Membership.acknowledged_at).where(
                Membership.workspace_id == host_ws.id, Membership.user_id == guest.id
            )
        )
    ).scalar_one()
    assert third == first


async def test_two_concurrent_acknowledgements_keep_the_first_timestamp(db):
    """The race a Python-side `if acknowledged_at is None` cannot win.

    Two tabs answer the same notice, or one opens the workspace while the other
    dismisses it. Both requests read `acknowledged_at IS NULL` before either
    writes — that is the whole window — and with the check in Python both then
    write, so the stored moment is whichever transaction committed *last*.

    The interleaving is explicit rather than threaded, because a real one
    deadlocks the test and proves nothing: Postgres takes a row lock, so the
    second UPDATE simply blocks until the first commits. The order below is the
    order the two requests actually reach the database, with the second one's
    read placed inside the window on purpose.

    Mutation check: restore `if membership.acknowledged_at is None: membership
    .acknowledged_at = datetime.now(...)` in `acknowledge_membership` and this
    fails — the second session's own `find_membership` returns its
    identity-mapped row, still carrying the NULL it read in the window, and
    stamps over the first timestamp.

    Commits rather than rolls back, unlike everything else in this file: one
    connection cannot observe another's uncommitted row, so the race does not
    exist inside a single transaction. The rows are removed at the end.
    """
    host, host_ws = await _make_user(db, "race-host")
    guest, _guest_ws = await _make_user(db, "race-guest")
    await _invite(db, host, host_ws, guest)
    await db.commit()

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as first_session, factory() as second_session:
            first_user = await first_session.get(User, guest.id)
            second_user = await second_session.get(User, guest.id)
            assert first_user is not None and second_user is not None

            # The window: both requests have seen an outstanding invitation.
            assert (
                await system.find_membership(
                    first_session, workspace_id=host_ws.id, user_id=guest.id
                )
            ).acknowledged_at is None
            assert (
                await system.find_membership(
                    second_session, workspace_id=host_ws.id, user_id=guest.id
                )
            ).acknowledged_at is None

            await system.acknowledge_membership(
                first_session, user=first_user, workspace_id=host_ws.id
            )
            await first_session.commit()
            first_stamp = (
                await first_session.execute(
                    select(Membership.acknowledged_at).where(
                        Membership.workspace_id == host_ws.id,
                        Membership.user_id == guest.id,
                    )
                )
            ).scalar_one()
            assert first_stamp is not None

            await system.acknowledge_membership(
                second_session, user=second_user, workspace_id=host_ws.id
            )
            await second_session.commit()

        async with factory() as reader:
            stamped = (
                await reader.execute(
                    select(Membership.acknowledged_at).where(
                        Membership.workspace_id == host_ws.id,
                        Membership.user_id == guest.id,
                    )
                )
            ).scalar_one()
            assert stamped is not None
            assert stamped == first_stamp
            assert (await system.list_unacknowledged_memberships(reader, user_id=guest.id)) == []

        async with factory() as cleanup:
            await cleanup.execute(
                Membership.__table__.delete().where(Membership.user_id == guest.id)
            )
            await cleanup.commit()
    finally:
        await engine.dispose()


async def test_acknowledging_a_workspace_you_are_not_in_is_refused(db):
    """404 at the route. A stranger holding a workspace id must not be able to
    learn whether it exists, and must not be able to stamp anyone's rows."""
    guest, _ = await _make_user(db, "stranger")
    assert await system.acknowledge_membership(db, user=guest, workspace_id=uuid.uuid4()) is False


async def test_a_role_change_does_not_re_announce(db):
    """They already know they are here — that is what the existing row means."""
    host, host_ws = await _make_user(db, "reannounce-host")
    guest, _ = await _make_user(db, "reannounce-guest")
    await _invite(db, host, host_ws, guest, role=Role.MEMBER)
    await system.acknowledge_membership(db, user=guest, workspace_id=host_ws.id)

    await workspaces.set_member_role(
        _scope(host, host_ws, Role.OWNER), db, user_id=guest.id, role=Role.VIEWER
    )
    assert await system.list_unacknowledged_memberships(db, user_id=guest.id) == []
    # Re-inviting an address that is already a member is a role change too.
    await _invite(db, host, host_ws, guest, role=Role.MEMBER)
    assert await system.list_unacknowledged_memberships(db, user_id=guest.id) == []


async def test_an_invitation_survives_losing_its_author(db):
    """ON DELETE SET NULL. Losing the author is not a reason to leave someone
    permanently unaware of a workspace they are in — the notice drops the name,
    not the message. Exercises the OUTER join in the listing query."""
    host, host_ws = await _make_user(db, "orphan-host")
    guest, _ = await _make_user(db, "orphan-guest")
    await _invite(db, host, host_ws, guest)
    await db.execute(
        Membership.__table__.update()
        .where(Membership.workspace_id == host_ws.id, Membership.user_id == guest.id)
        .values(invited_by_user_id=None)
    )
    await db.flush()

    outstanding = await system.list_unacknowledged_memberships(db, user_id=guest.id)
    assert len(outstanding) == 1
    _workspace, _membership, inviter = outstanding[0]
    assert inviter is None


async def test_a_soft_deleted_workspace_is_not_announced(db):
    host, host_ws = await _make_user(db, "deleted-host")
    guest, _ = await _make_user(db, "deleted-guest")
    await _invite(db, host, host_ws, guest)
    host_ws.deleted_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    await db.flush()
    assert await system.list_unacknowledged_memberships(db, user_id=guest.id) == []


async def test_leaving_gives_up_access_and_the_pointer(db):
    """The counterpart to `remove_member`, and the reason the notice can offer a
    real choice: before this the only way out was to ask the person who put you
    there."""
    host, host_ws = await _make_user(db, "leave-host")
    guest, guest_ws = await _make_user(db, "leave-guest")
    await _invite(db, host, host_ws, guest)
    await system.set_active_workspace(db, user=guest, workspace_id=host_ws.id)

    assert await system.leave_workspace(db, user=guest, workspace_id=host_ws.id) is True

    assert (await system.find_membership(db, workspace_id=host_ws.id, user_id=guest.id)) is None
    stored = (
        await db.execute(select(User.active_workspace_id).where(User.id == guest.id))
    ).scalar_one()
    assert stored is None
    assert {ws.id for ws, _m in await system.list_user_workspaces(db, user_id=guest.id)} == {
        guest_ws.id
    }


async def test_leaving_does_not_disturb_anyone_else(db):
    """Their runs and artifacts stay — they belong to the workspace. And the
    workspace itself, and everyone else in it, are untouched."""
    host, host_ws = await _make_user(db, "bystander-host")
    guest, _ = await _make_user(db, "bystander-guest")
    other, _ = await _make_user(db, "bystander-other")
    await _invite(db, host, host_ws, guest)
    await _invite(db, host, host_ws, other)

    await system.leave_workspace(db, user=guest, workspace_id=host_ws.id)

    remaining = {
        row.user_id
        for row in (
            await db.execute(select(Membership).where(Membership.workspace_id == host_ws.id))
        ).scalars()
    }
    assert remaining == {host.id, other.id}
    live = (
        await db.execute(select(Workspace.deleted_at).where(Workspace.id == host_ws.id))
    ).scalar_one()
    assert live is None


async def test_the_owner_cannot_leave(db):
    """Not an authority problem — there would be nobody left to run it, and
    `workspaces.owner_user_id` would point at someone with no membership. The
    fix is an ownership transfer, which does not exist yet."""
    owner, personal = await _make_user(db, "owner-leave")
    with pytest.raises(system.CannotLeaveOwnedWorkspace):
        await system.leave_workspace(db, user=owner, workspace_id=personal.id)

    team, _membership = await system.create_team_workspace(
        db, owner=owner, name="Owned", owned_workspace_limit=None
    )
    with pytest.raises(system.CannotLeaveOwnedWorkspace):
        await system.leave_workspace(db, user=owner, workspace_id=team.id)


async def test_leaving_a_workspace_you_are_not_in_is_refused(db):
    guest, _ = await _make_user(db, "leave-stranger")
    assert await system.leave_workspace(db, user=guest, workspace_id=uuid.uuid4()) is False


async def test_leaving_ends_the_announcement(db):
    """The third door. An unacknowledged row that is deleted cannot be announced
    again, so nothing has to stamp it — but if leaving is ever changed to a soft
    delete, this is the test that will notice."""
    host, host_ws = await _make_user(db, "leave-notice-host")
    guest, _ = await _make_user(db, "leave-notice-guest")
    await _invite(db, host, host_ws, guest)

    await system.leave_workspace(db, user=guest, workspace_id=host_ws.id)
    assert await system.list_unacknowledged_memberships(db, user_id=guest.id) == []
