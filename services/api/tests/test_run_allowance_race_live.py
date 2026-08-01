"""The weekly execute allowance across two connections, against real Postgres.

The third cap of this shape and the one with money directly attached: every
execute run buys provider tokens and sandbox time, so two submissions at the
boundary that both read "4 of 5 used" are a plan's spend multiplied by however
many requests arrive together.

**Nothing downstream catches it.** The worker has its own allowance gate, but
`handlers._assert_execute_allowance` runs only when the worker RESOLVES an AUTO
run to EXECUTE. An explicit `mode=execute` submission takes `resolve_mode`'s
passthrough branch — `ModeDecision.changed` is False — and the worker returns
before the check. So for that mode the admission gate is the only gate, which is
why this file is about that mode.

Committing, and therefore responsible for its own teardown.
"""

import asyncio
import datetime as dt
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode
from repo_test_helpers import delete_committed_tenants, slot_taken_or_the_reason_why

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.tiers import TIER_WINDOW, limits_for

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the run allowance race needs DATABASE_URL"
)

pytestmark = requires_db

#: Read from the tier table rather than pinned as a second copy.
FREE_RUNS_PER_WEEK = limits_for("free").agent_runs_per_week

BLOCKED_FOR_S = 1.5


async def _spend(scope: Scope, session, count: int, tag: str) -> None:
    """`count` runs whose resolved mode is EXECUTE — what the allowance counts.

    AUTO would not do. `count_execute_runs_since` is deliberately narrower than
    the abuse backstop: a free account's chat is unmetered by policy, so a
    fixture that filled the window with AUTO rows would leave the allowance
    untouched and the two callers below would not be at any boundary at all.
    """
    for index in range(count):
        await runs_repo.create_run(
            scope,
            session,
            task_prompt=f"{tag} {index}",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )


@pytest.mark.asyncio
async def test_the_last_weekly_run_cannot_be_spent_twice_by_two_connections():
    assert FREE_RUNS_PER_WEEK is not None and FREE_RUNS_PER_WEEK >= 2
    engine = engine_from_env()
    factory = session_factory(engine)

    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"runrace-{uuid.uuid4()}",
            email=f"runrace-{uuid.uuid4().hex[:8]}@runrace.test",
            display_name="Run Race",
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        await _spend(scope, session, FREE_RUNS_PER_WEEK - 1, "fill")
        await session.commit()

        since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        staged = await runs_repo.count_execute_runs_since(scope, session, since)
        assert staged == FREE_RUNS_PER_WEEK - 1, (
            f"staged {staged} execute runs, not {FREE_RUNS_PER_WEEK - 1}: the two "
            "callers below would not be racing for the last one"
        )

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            await runs_repo.reserve_execute_run_slot(scope, session, since, FREE_RUNS_PER_WEEK)
            await _spend(scope, session, 1, "contend-a")
            a_has_the_slot.set()
            await asyncio.sleep(BLOCKED_FOR_S * 2)
            await session.commit()

    async def caller_b() -> None:
        await a_has_the_slot.wait()
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            try:
                await runs_repo.reserve_execute_run_slot(scope, session, since, FREE_RUNS_PER_WEEK)
                await _spend(scope, session, 1, "contend-b")
                await session.commit()
                b_outcome.append("spent")
            except runs_repo.RunAllowanceReached as reached:
                await session.rollback()
                b_outcome.append(reached)

    a_task = asyncio.create_task(caller_a())
    b_task = asyncio.create_task(caller_b())

    try:
        await slot_taken_or_the_reason_why(a_has_the_slot, a_task)
        done, _pending = await asyncio.wait({b_task}, timeout=BLOCKED_FOR_S)
        assert not done, (
            "the second caller completed while the first still held its "
            f"transaction open: {b_outcome} — the allowance was compared against "
            "a count nothing was holding"
        )

        await asyncio.wait_for(asyncio.gather(a_task, b_task), timeout=30)

        assert b_outcome and isinstance(b_outcome[0], runs_repo.RunAllowanceReached), (
            f"the second caller was not refused: {b_outcome}"
        )
        assert b_outcome[0].limit == FREE_RUNS_PER_WEEK

        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            used = await runs_repo.count_execute_runs_since(scope, session, since)
        assert used == FREE_RUNS_PER_WEEK, (
            f"the account spent {used} runs against an allowance of {FREE_RUNS_PER_WEEK}"
        )
    finally:
        for task in (a_task, b_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(a_task, b_task, return_exceptions=True)
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()


@pytest.mark.asyncio
async def test_an_unmetered_tier_takes_no_lock_and_both_submissions_land():
    """The positive control, and the reason the lock is conditional.

    `limit is None` is the developer tier, on the product's hottest write path.
    Without this case the test above also passes against a reservation that
    simply refuses the second caller every time.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"runfree-{uuid.uuid4()}",
            email=f"runfree-{uuid.uuid4().hex[:8]}@runrace.test",
            display_name="Run Free",
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        await session.commit()

    async def submit(tag: str) -> None:
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            await runs_repo.reserve_execute_run_slot(scope, session, since, None)
            await _spend(scope, session, 1, tag)
            await session.commit()

    try:
        await asyncio.gather(submit("unmetered-a"), submit("unmetered-b"))
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            used = await runs_repo.count_execute_runs_since(scope, session, since)
        assert used == 2, f"an unmetered account landed {used} runs, not 2"
    finally:
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()


@pytest.mark.asyncio
async def test_the_allowance_is_the_account_s_and_not_one_workspace_s():
    """Two workspaces of ONE account share one allowance.

    This is the case a workspace lock would miss entirely: the two submissions
    hold different workspace rows and the same user. It is also the reason
    `count_execute_runs_since` is the repository's only unscoped query, so the
    reservation has to lock the thing the count is actually keyed on.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    workspace_ids: list[uuid.UUID] = []
    async with factory() as session:
        user, personal = await system.get_or_provision_user(
            session,
            workos_user_id=f"runacct-{uuid.uuid4()}",
            email=f"runacct-{uuid.uuid4().hex[:8]}@runrace.test",
            display_name="Run Account",
        )
        second, _membership = await system.create_team_workspace(
            session, owner=user, name="Second tenant", owned_workspace_limit=None
        )
        workspace_ids += [personal.id, second.id]
        here = Scope(user_id=user.id, workspace_id=personal.id, role=Role.OWNER)
        there = Scope(user_id=user.id, workspace_id=second.id, role=Role.OWNER)
        await _spend(here, session, FREE_RUNS_PER_WEEK, "in-personal")
        await session.commit()

        since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        with pytest.raises(runs_repo.RunAllowanceReached):
            await runs_repo.reserve_execute_run_slot(there, session, since, FREE_RUNS_PER_WEEK)
    try:
        pass
    finally:
        await delete_committed_tenants(factory, workspace_ids, [user.id])
        await engine.dispose()
