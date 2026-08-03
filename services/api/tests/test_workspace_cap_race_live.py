"""The owned-workspace cap across two connections, against real Postgres.

`owned_workspaces` is not a product feature limit. `tiers.TierLimits` says what
it is for: it is what stops the per-workspace artifact cap from being trivially
bypassed, because an account able to mint tenants without bound has no artifact
cap at all. So a race here is a race on the thing that bounds the OTHER cap —
each extra workspace is another whole Vault allowance.

`create_workspace` compared the count against the limit with nothing held
between the read and the write, which is the same shape
`artifacts.reserve_artifact_slot` and `shares._reserve_membership_slot` both
exist to close. Two creates by one account do not touch a common row on their
own: what they share is the OWNER, and that is what is locked.

**A burst inside one process cannot show this** — one event loop finishes each
request's read and write before starting the next — so this drives two
independent sessions and pins the interleaving. Removing the lock fails it with
the account owning one workspace more than its tier allows.

Committing, and therefore responsible for its own teardown.
"""

import asyncio
import os
import uuid

import pytest
from majorana_contracts.enums import Role
from repo_test_helpers import delete_committed_tenants, slot_taken_or_the_reason_why

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system
from majorana_api.tiers import limits_for

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the workspace cap race needs DATABASE_URL"
)

pytestmark = requires_db

#: Read from the tier table, not written as a literal.
FREE_WORKSPACE_CAP = limits_for("free").owned_workspaces

BLOCKED_FOR_S = 1.5


@pytest.mark.asyncio
async def test_the_last_workspace_slot_cannot_be_taken_twice_by_two_connections():
    assert FREE_WORKSPACE_CAP is not None and FREE_WORKSPACE_CAP >= 2
    engine = engine_from_env()
    factory = session_factory(engine)
    workspace_ids: list[uuid.UUID] = []

    async with factory() as session:
        owner, personal = await system.get_or_provision_user(
            session,
            workos_user_id=f"wscap-{uuid.uuid4()}",
            email=f"wscap-{uuid.uuid4().hex[:8]}@wscap.test",
            display_name="Ws Cap",
        )
        workspace_ids.append(personal.id)
        # Provisioning already gives them one (personal counts — see
        # `count_owned_workspaces`), so the gap is measured, not assumed.
        held = await system.count_owned_workspaces(session, user_id=owner.id)
        assert held < FREE_WORKSPACE_CAP, (
            f"a new account already owns {held} of {FREE_WORKSPACE_CAP}; "
            "this fixture cannot stage the boundary"
        )
        for index in range(FREE_WORKSPACE_CAP - held - 1):
            workspace, _membership = await system.create_team_workspace(
                session, owner=owner, name=f"Filler {index}", owned_workspace_limit=None
            )
            workspace_ids.append(workspace.id)
        await session.commit()

        staged = await system.count_owned_workspaces(session, user_id=owner.id)
        assert staged == FREE_WORKSPACE_CAP - 1, (
            f"staged {staged} workspaces, not {FREE_WORKSPACE_CAP - 1}: the two "
            "callers below would not be racing for the last slot"
        )

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        async with factory() as session:
            workspace, _m = await system.create_team_workspace(
                session, owner=owner, name="Contender A", owned_workspace_limit=FREE_WORKSPACE_CAP
            )
            workspace_ids.append(workspace.id)
            a_has_the_slot.set()
            await asyncio.sleep(BLOCKED_FOR_S * 2)
            await session.commit()

    async def caller_b() -> None:
        await a_has_the_slot.wait()
        async with factory() as session:
            try:
                workspace, _m = await system.create_team_workspace(
                    session,
                    owner=owner,
                    name="Contender B",
                    owned_workspace_limit=FREE_WORKSPACE_CAP,
                )
                workspace_ids.append(workspace.id)
                await session.commit()
                b_outcome.append("created")
            except system.WorkspaceLimitReached as full:
                await session.rollback()
                b_outcome.append(full)

    a_task = asyncio.create_task(caller_a())
    b_task = asyncio.create_task(caller_b())

    try:
        await slot_taken_or_the_reason_why(a_has_the_slot, a_task)
        done, _pending = await asyncio.wait({b_task}, timeout=BLOCKED_FOR_S)
        assert not done, (
            "the second caller completed while the first still held its "
            f"transaction open: {b_outcome} — the cap was compared against a "
            "count nothing was holding"
        )

        await asyncio.wait_for(asyncio.gather(a_task, b_task), timeout=30)

        assert b_outcome and isinstance(b_outcome[0], system.WorkspaceLimitReached), (
            f"the second caller was not refused: {b_outcome}"
        )

        async with factory() as session:
            owned = await system.count_owned_workspaces(session, user_id=owner.id)
        assert owned == FREE_WORKSPACE_CAP, (
            f"the account owns {owned} workspaces against a cap of {FREE_WORKSPACE_CAP}"
        )
    finally:
        # Cancelled before teardown: on a failed assertion `caller_a` is still
        # asleep inside its transaction holding the owner's row lock, and
        # teardown deletes that user.
        for task in (a_task, b_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(a_task, b_task, return_exceptions=True)
        await delete_committed_tenants(factory, workspace_ids, [owner.id])
        await engine.dispose()


@pytest.mark.asyncio
async def test_an_unlimited_tier_takes_no_lock_and_two_creates_both_succeed():
    """The positive control, and the reason the lock is conditional.

    `owned_workspace_limit is None` is the developer tier. Serializing every
    unmetered create behind one row would be a cost with no purchase, and
    without this case the test above passes against code that simply refuses
    the second caller always.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    workspace_ids: list[uuid.UUID] = []
    async with factory() as session:
        owner, personal = await system.get_or_provision_user(
            session,
            workos_user_id=f"wsfree-{uuid.uuid4()}",
            email=f"wsfree-{uuid.uuid4().hex[:8]}@wscap.test",
            display_name="Ws Free",
        )
        workspace_ids.append(personal.id)
        await session.commit()

    async def create(name: str) -> None:
        async with factory() as session:
            workspace, _m = await system.create_team_workspace(
                session, owner=owner, name=name, owned_workspace_limit=None
            )
            workspace_ids.append(workspace.id)
            await session.commit()

    try:
        await asyncio.gather(create("Unmetered A"), create("Unmetered B"))
        async with factory() as session:
            owned = await system.count_owned_workspaces(session, user_id=owner.id)
        assert owned == 3, f"an unmetered account owns {owned}, not 3"
    finally:
        await delete_committed_tenants(factory, workspace_ids, [owner.id])
        await engine.dispose()


@pytest.mark.asyncio
async def test_the_membership_row_is_the_owner_s_and_the_role_is_owner():
    """A cheap sanity check that the locked path still creates what it did.

    A lock added around a create is one bad edit away from returning before the
    membership is written, and an owner with no membership is a workspace
    nobody can reach.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    workspace_ids: list[uuid.UUID] = []
    async with factory() as session:
        owner, personal = await system.get_or_provision_user(
            session,
            workos_user_id=f"wsrole-{uuid.uuid4()}",
            email=f"wsrole-{uuid.uuid4().hex[:8]}@wscap.test",
            display_name="Ws Role",
        )
        workspace_ids.append(personal.id)
        workspace, membership = await system.create_team_workspace(
            session,
            owner=owner,
            name="Roled",
            owned_workspace_limit=limits_for("free").owned_workspaces,
        )
        workspace_ids.append(workspace.id)
        await session.commit()
    try:
        assert membership.user_id == owner.id
        assert Role(membership.role) is Role.OWNER
        assert membership.workspace_id == workspace.id
        assert membership.acknowledged_at is not None
    finally:
        await delete_committed_tenants(factory, workspace_ids, [owner.id])
        await engine.dispose()
