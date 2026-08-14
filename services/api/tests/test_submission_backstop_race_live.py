"""The per-account submission backstop across two connections, against real
Postgres (ai-ops 86, 2026-08-14).

Before this ruling the combined EXECUTE+AUTO ceiling was compared with nothing
held between the read and the write — not merely a weaker guarantee than the
tier gate's, but no guarantee at all: two submissions at the boundary could
both read "999 of 1000" and both be admitted. `reserve_submission_backstop_slot`
closes that the same way `reserve_execute_run_slot` already closes it for the
paid tier gate, and `test_the_last_weekly_submission_cannot_be_spent_twice_by_
two_connections` below is the same proof applied to it.

This file also carries the live version of the scenario the ruling exists to
fix: a free account spreading submissions across the three workspaces its tier
is sold (`tiers.TIER_LIMITS["free"].owned_workspaces == 3`) still gets ONE
50-submission ceiling, not three.

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
from majorana_api.routes.runs import EXECUTE_BACKSTOP_WINDOW, submission_backstop_limit
from majorana_api.tiers import TIER_LIMITS

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the submission backstop race needs DATABASE_URL"
)

pytestmark = requires_db

#: Read from the tier table rather than pinned as a second copy — the same
#: reason `test_run_allowance_race_live.py` reads `FREE_TOKENS` from
#: `limits_for`.
FREE_LIMIT = submission_backstop_limit(TIER_LIMITS["free"])

BLOCKED_FOR_S = 1.5


async def _submit(scope: Scope, session, count: int, tag: str) -> None:
    """`count` AUTO submissions — the mode this ruling exists to bound, and the
    one that reaches the backstop without also touching the EXECUTE-only tier
    token reservation."""
    for index in range(count):
        await runs_repo.create_run(
            scope,
            session,
            task_prompt=f"{tag} {index}",
            mode=RunMode.AUTO,
            framework=Framework.QISKIT,
        )


@pytest.mark.asyncio
async def test_the_last_weekly_submission_cannot_be_spent_twice_by_two_connections():
    assert FREE_LIMIT is not None and FREE_LIMIT > 1
    engine = engine_from_env()
    factory = session_factory(engine)

    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"subrace-{uuid.uuid4()}",
            email=f"subrace-{uuid.uuid4().hex[:8]}@subrace.test",
            display_name="Submission Race",
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        # Exactly one submission's worth left.
        await _submit(scope, session, FREE_LIMIT - 1, "stage")
        await session.commit()

        since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
        staged = await runs_repo.count_submitted_runs_for_account_since(scope, session, since)
        assert staged == FREE_LIMIT - 1, (
            f"staged {staged}, not {FREE_LIMIT - 1}: the two callers below would "
            "not be racing for the account's last submission"
        )

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
            await runs_repo.reserve_submission_backstop_slot(scope, session, since, FREE_LIMIT)
            await _submit(scope, session, 1, "contend-a")
            a_has_the_slot.set()
            await asyncio.sleep(BLOCKED_FOR_S * 2)
            await session.commit()

    async def caller_b() -> None:
        await a_has_the_slot.wait()
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
            try:
                await runs_repo.reserve_submission_backstop_slot(scope, session, since, FREE_LIMIT)
                await _submit(scope, session, 1, "contend-b")
                await session.commit()
                b_outcome.append("submitted")
            except runs_repo.SubmissionBackstopReached as reached:
                await session.rollback()
                b_outcome.append(reached)

    a_task = asyncio.create_task(caller_a())
    b_task = asyncio.create_task(caller_b())

    try:
        await slot_taken_or_the_reason_why(a_has_the_slot, a_task)
        done, _pending = await asyncio.wait({b_task}, timeout=BLOCKED_FOR_S)
        assert not done, (
            "the second caller completed while the first still held its "
            f"transaction open: {b_outcome} — the backstop was compared against "
            "a count nothing was holding"
        )

        await asyncio.wait_for(asyncio.gather(a_task, b_task), timeout=30)

        assert b_outcome and isinstance(b_outcome[0], runs_repo.SubmissionBackstopReached), (
            f"the second caller was not refused: {b_outcome}"
        )
        assert b_outcome[0].limit == FREE_LIMIT
        assert b_outcome[0].used == FREE_LIMIT

        # One winner, so exactly FREE_LIMIT submissions landed — not FREE_LIMIT + 1.
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
            used = await runs_repo.count_submitted_runs_for_account_since(scope, session, since)
        assert used == FREE_LIMIT, f"{used} submissions landed against a ceiling of {FREE_LIMIT}"
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

    `limit is None` is the developer/Enterprise tier (ai-ops 86: "Enterprise
    alert-only"). Without this case the test above also passes against a
    reservation that simply refuses the second caller every time.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"subfree-{uuid.uuid4()}",
            email=f"subfree-{uuid.uuid4().hex[:8]}@subrace.test",
            display_name="Submission Free",
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        await session.commit()

    async def submit(tag: str) -> None:
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
            await runs_repo.reserve_submission_backstop_slot(scope, session, since, None)
            await _submit(scope, session, 1, tag)
            await session.commit()

    try:
        await asyncio.gather(submit("unmetered-a"), submit("unmetered-b"))
        async with factory() as session:
            since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
            used = await runs_repo.count_submitted_runs_for_account_since(scope, session, since)
        assert used == 2, f"an unmetered account landed {used} submissions, not 2"
    finally:
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()


@pytest.mark.asyncio
async def test_the_backstop_is_the_account_s_and_not_three_workspaces_worth():
    """The exact leak ai-ops 86 fixes: the free tier sells `owned_workspaces=3`
    (`tiers.TIER_LIMITS`). Spreading `FREE_LIMIT` submissions across all three
    of an account's workspaces exhausts the SAME ceiling one workspace would —
    a free account owning three workspaces still gets 50 total, not 150.
    """
    assert FREE_LIMIT is not None
    engine = engine_from_env()
    factory = session_factory(engine)
    workspace_ids: list[uuid.UUID] = []
    async with factory() as session:
        user, personal = await system.get_or_provision_user(
            session,
            workos_user_id=f"subacct-{uuid.uuid4()}",
            email=f"subacct-{uuid.uuid4().hex[:8]}@subrace.test",
            display_name="Submission Account",
        )
        second, _membership = await system.create_team_workspace(
            session, owner=user, name="Second tenant", owned_workspace_limit=None
        )
        third, _membership2 = await system.create_team_workspace(
            session, owner=user, name="Third tenant", owned_workspace_limit=None
        )
        workspace_ids += [personal.id, second.id, third.id]
        scopes = [
            Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)
            for ws in (personal, second, third)
        ]
        # Spread every submission across all three workspaces, round-robin.
        for index in range(FREE_LIMIT):
            await _submit(scopes[index % 3], session, 1, f"spread-{index}")
        await session.commit()

        since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
        used = await runs_repo.count_submitted_runs_for_account_since(scopes[0], session, since)
        assert used == FREE_LIMIT, (
            f"{used} submissions counted across three workspaces, not {FREE_LIMIT} — "
            "the per-account count must not depend on which workspace is asked"
        )

        # Refused through EVERY one of the three workspaces, not just the one
        # that happened to submit last — a workspace-bound reservation would
        # have let the other two keep going.
        for ws_scope in scopes:
            with pytest.raises(runs_repo.SubmissionBackstopReached) as caught:
                await runs_repo.reserve_submission_backstop_slot(
                    ws_scope, session, since, FREE_LIMIT
                )
            assert caught.value.used == FREE_LIMIT
            assert caught.value.limit == FREE_LIMIT
    await delete_committed_tenants(factory, workspace_ids, [user.id])
    await engine.dispose()
