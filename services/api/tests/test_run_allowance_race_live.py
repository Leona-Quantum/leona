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
from majorana_contracts.enums import Framework, Role, RunMode, UsageKind
from repo_test_helpers import delete_committed_tenants, slot_taken_or_the_reason_why

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import usage as usage_repo
from majorana_api.tiers import TIER_WINDOW, TOKENS_PER_RUN_EQUIVALENT, limits_for

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the run allowance race needs DATABASE_URL"
)

pytestmark = requires_db

#: Read from the tier table rather than pinned as a second copy.
#:
#: Tokens, not runs, since 2026-08-03. Staging four run ROWS and racing for a
#: fifth no longer describes this gate at all: the reservation charges every
#: admitted-but-unfinished run at the run-equivalent rate, so four queued rows
#: are themselves 120,000 tokens of the allowance and both callers would be
#: refused before the race began. What is staged now is recorded SPEND, leaving
#: exactly one run's worth on the clock.
FREE_TOKENS = limits_for("free").agent_tokens_per_week

BLOCKED_FOR_S = 1.5


async def _spend(scope: Scope, session, count: int, tag: str) -> None:
    """`count` runs whose resolved mode is EXECUTE — what a caller submits.

    AUTO would not do. These rows are what makes the winner's run in-flight for
    the loser's reservation, and the in-flight charge only counts EXECUTE/AUTO.
    """
    for index in range(count):
        await runs_repo.create_run(
            scope,
            session,
            task_prompt=f"{tag} {index}",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )


async def _record_tokens(scope: Scope, session, tokens: int) -> None:
    """Recorded spend inside the window, written the way the worker writes it."""
    await usage_repo.record_usage(
        scope,
        session,
        kind=UsageKind.LLM_TOKENS,
        quantity=tokens,
        meta={"role": "request_plan", "model": "test"},
    )


@pytest.mark.asyncio
async def test_the_last_weekly_run_cannot_be_spent_twice_by_two_connections():
    assert FREE_TOKENS is not None and FREE_TOKENS > TOKENS_PER_RUN_EQUIVALENT
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
        # Exactly one run's worth left, and nothing in flight.
        await _record_tokens(scope, session, FREE_TOKENS - TOKENS_PER_RUN_EQUIVALENT)
        await session.commit()

        since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        staged = await usage_repo.account_tokens_since(scope, session, since)
        assert staged == FREE_TOKENS - TOKENS_PER_RUN_EQUIVALENT, (
            f"staged {staged} tokens, not {FREE_TOKENS - TOKENS_PER_RUN_EQUIVALENT}: the "
            "two callers below would not be racing for the last run's worth"
        )

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            await runs_repo.reserve_execute_run_slot(scope, session, since, FREE_TOKENS)
            await _spend(scope, session, 1, "contend-a")
            a_has_the_slot.set()
            await asyncio.sleep(BLOCKED_FOR_S * 2)
            await session.commit()

    async def caller_b() -> None:
        await a_has_the_slot.wait()
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            try:
                await runs_repo.reserve_execute_run_slot(scope, session, since, FREE_TOKENS)
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
        assert b_outcome[0].limit == FREE_TOKENS

        # One winner, so one more run in flight and no second charge against the
        # week. Read the way the gate reads it: recorded spend plus the reservation.
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            spent = await usage_repo.account_tokens_since(scope, session, since)
            in_flight = await runs_repo.count_in_flight_execute_runs(scope, session)
        assert in_flight == 1, f"{in_flight} runs were admitted against one run's worth"
        assert spent + in_flight * TOKENS_PER_RUN_EQUIVALENT == FREE_TOKENS, (
            f"the account holds {spent} spent + {in_flight} in flight against an "
            f"allowance of {FREE_TOKENS}"
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
        # Spent entirely in the personal workspace, and refused in the second
        # one. Written as recorded spend rather than run rows so the refusal is
        # the SUM being unscoped, not the in-flight reservation — both are keyed
        # on the account, and staging runs would leave which of the two did the
        # refusing ambiguous.
        await _record_tokens(here, session, FREE_TOKENS)
        await session.commit()

        since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        with pytest.raises(runs_repo.RunAllowanceReached):
            await runs_repo.reserve_execute_run_slot(there, session, since, FREE_TOKENS)
    try:
        pass
    finally:
        await delete_committed_tenants(factory, workspace_ids, [user.id])
        await engine.dispose()
