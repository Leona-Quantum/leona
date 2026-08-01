"""The shared-project membership cap across two connections, against real Postgres.

The grantee's allowance is the one cap in this service whose two racers hold
DIFFERENT project rows: two owners, each granting one of their own projects to
the same person. `shares._lock_project` serializes neither of them — they are
not talking about the same project — so the only thing both transactions touch
is the grantee, and that is what `_reserve_membership_slot` locks.

**A burst inside one process would prove nothing here**, for the reason
`test_artifact_cap_race_live` records: one event loop runs each request's read
and write to completion before starting the next, so the interleaving never
happens. So this drives two independent sessions and pins the order explicitly —
A takes the last slot and holds its transaction open, B has to be behind it, and
B must see A's grant when it gets through.

Removing the `with_for_update()` in `_reserve_membership_slot` fails this file
with the fifth membership granted.

Committing, and therefore responsible for its own teardown.
"""

import asyncio
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, ShareRole
from repo_test_helpers import delete_committed_tenants

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import projects as projects_repo
from majorana_api.repos import shares as shares_repo
from majorana_api.repos import system
from majorana_api.tiers import limits_for

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the membership cap race needs DATABASE_URL"
)

pytestmark = requires_db

#: Read from the tier table rather than written as a literal, so this suite
#: follows the product decision instead of pinning a second copy of it.
TEAM_MEMBERSHIP_CAP = limits_for("team").shared_projects

#: How long B is given to prove it is blocked. Long enough that a machine under
#: load does not report a lock that is not there; short enough to stay a test.
BLOCKED_FOR_S = 1.5

#: What the route resolves for a team-plan grantee. Written here rather than
#: taken from a `lambda ...: True` so that the cap under test is the real one:
#: a double answering `max_shared_projects=None` would exempt this suite from
#: the very thing it exists to measure.
TEAM_ALLOWANCE = shares_repo.GranteeAllowance(
    may_receive=limits_for("team").project_sharing,
    max_shared_projects=TEAM_MEMBERSHIP_CAP,
)


async def _tenant(session, tag: str):
    """A user, their personal workspace, and an OWNER scope over it."""
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"memcap-{tag}-{uuid.uuid4()}",
        email=f"memcap-{tag}-{uuid.uuid4().hex[:8]}@memcap.test",
        display_name=tag.title(),
    )
    return user, workspace, Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


@pytest.mark.asyncio
async def test_the_last_membership_cannot_be_granted_twice_by_two_owners():
    assert TEAM_MEMBERSHIP_CAP is not None and TEAM_MEMBERSHIP_CAP >= 2, (
        "this fixture stages the boundary by filling cap-1 memberships first"
    )
    engine = engine_from_env()
    factory = session_factory(engine)
    workspace_ids: list[uuid.UUID] = []
    user_ids: list[uuid.UUID] = []

    async with factory() as session:
        grantee, grantee_ws, _grantee_scope = await _tenant(session, "grantee")
        workspace_ids.append(grantee_ws.id)
        user_ids.append(grantee.id)

        # cap-1 memberships, from one owner. The cap counts grants received
        # across every owner, so who filled them is not what is being measured.
        filler, filler_ws, filler_scope = await _tenant(session, "filler")
        workspace_ids.append(filler_ws.id)
        user_ids.append(filler.id)
        for index in range(TEAM_MEMBERSHIP_CAP - 1):
            project = await projects_repo.create_project(
                filler_scope, session, name=f"Filled {index}"
            )
            await shares_repo.grant_share(
                filler_scope,
                session,
                project.id,
                email=grantee.email,
                role=ShareRole.VIEWER,
                grantee_allowance=lambda _grantee: TEAM_ALLOWANCE,
            )

        # The two contenders own DIFFERENT projects, so `_lock_project` holds
        # two different rows and serializes nothing between them.
        owner_a, ws_a, scope_a = await _tenant(session, "ownera")
        owner_b, ws_b, scope_b = await _tenant(session, "ownerb")
        workspace_ids += [ws_a.id, ws_b.id]
        user_ids += [owner_a.id, owner_b.id]
        project_a = await projects_repo.create_project(scope_a, session, name="Contended A")
        project_b = await projects_repo.create_project(scope_b, session, name="Contended B")
        await session.commit()

        staged = await shares_repo.count_shared_project_memberships(session, grantee.id)
        assert staged == TEAM_MEMBERSHIP_CAP - 1, (
            f"staged {staged} memberships, not {TEAM_MEMBERSHIP_CAP - 1}: the two "
            "owners below would not be racing for the last one"
        )

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        """Takes the last membership and holds its transaction open."""
        async with factory() as session:
            await shares_repo.grant_share(
                scope_a,
                session,
                project_a.id,
                email=grantee.email,
                role=ShareRole.VIEWER,
                grantee_allowance=lambda _grantee: TEAM_ALLOWANCE,
            )
            a_has_the_slot.set()
            # Held deliberately: this is the window in which the unlocked code
            # let B count a membership A had already taken.
            await asyncio.sleep(BLOCKED_FOR_S * 2)
            await session.commit()

    async def caller_b() -> None:
        await a_has_the_slot.wait()
        async with factory() as session:
            try:
                await shares_repo.grant_share(
                    scope_b,
                    session,
                    project_b.id,
                    email=grantee.email,
                    role=ShareRole.VIEWER,
                    grantee_allowance=lambda _grantee: TEAM_ALLOWANCE,
                )
                await session.commit()
                b_outcome.append("granted")
            except shares_repo.ShareError as refused:
                await session.rollback()
                b_outcome.append(refused)

    a_task = asyncio.create_task(caller_a())
    b_task = asyncio.create_task(caller_b())

    try:
        await a_has_the_slot.wait()
        done, _pending = await asyncio.wait({b_task}, timeout=BLOCKED_FOR_S)
        assert not done, (
            "the second owner's grant completed while the first still held its "
            f"transaction open: {b_outcome} — the cap was compared against a "
            "count nothing was holding"
        )

        await asyncio.wait_for(asyncio.gather(a_task, b_task), timeout=30)

        assert b_outcome and isinstance(b_outcome[0], shares_repo.ShareError), (
            f"the second owner was not refused: {b_outcome}"
        )
        # The refusal is about the grantee's plan, not about this project.
        assert "shared projects" in str(b_outcome[0]), b_outcome[0]

        async with factory() as session:
            held = await shares_repo.count_shared_project_memberships(session, grantee.id)
        assert held == TEAM_MEMBERSHIP_CAP, (
            f"the grantee holds {held} memberships against a cap of {TEAM_MEMBERSHIP_CAP}"
        )
    finally:
        # Cancelled before teardown, not merely awaited: on a failed assertion
        # `caller_a` is still asleep INSIDE its transaction holding the
        # grantee's row lock, and teardown deletes that very user — it would
        # block on the lock its own test holds and hang instead of reporting.
        for task in (a_task, b_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(a_task, b_task, return_exceptions=True)
        await delete_committed_tenants(factory, workspace_ids, user_ids)
        await engine.dispose()
