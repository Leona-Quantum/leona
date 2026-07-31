"""The allowance numbers against a real Postgres, not a recording session.

Everything in `test_usage_endpoint.py` is asserted on statements and mocks. That
proves the route calls the right things in the right order; it cannot prove the
SQL runs, that `LIMIT n` after an ascending `ORDER BY` on a DESC index returns
what the arithmetic assumes, or that a `timestamptz` round-trips through the
driver as the aware datetime the response adds seven days to.

Three specific things are only checkable here:

- **The window boundary.** A run exactly seven days and one second old is
  outside; one six days old is inside. `created_at` is a server default in the
  ORM, so a test that wants old rows has to write the column directly — and
  writing it directly is the only way to find out whether the comparison works
  on real stored values rather than on ones Python just made.
- **Ordering across rows written out of order.** The oldest row is not the
  first one inserted here, deliberately.
- **Per-user, not per-workspace.** Two workspaces owned by the same account,
  runs in both, one allowance. The unit test asserts the *absence* of a
  workspace predicate in the SQL; this asserts the consequence.
"""

import datetime as dt
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode
from sqlalchemy import update

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Run
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.routes import usage as usage_routes
from majorana_api.settings import Settings
from majorana_api.tiers import TIER_LIMITS, TIER_WINDOW

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the usage endpoint needs DATABASE_URL"
)

pytestmark = requires_db

FREE_WEEKLY = TIER_LIMITS["free"].agent_runs_per_week
assert FREE_WEEKLY is not None


def _settings() -> Settings:
    return Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
        developer_emails=frozenset(),
    )


@pytest.fixture
async def factory():
    engine = engine_from_env()
    made = session_factory(engine)
    try:
        yield made
    finally:
        await engine.dispose()


@pytest.fixture
async def account(factory):
    """A freshly provisioned account per test, through the real first-login path.

    Fresh because every assertion counts ALL of this user's execute runs; a
    shared account would make each test depend on what ran before it.
    """
    tag = uuid.uuid4().hex[:12]
    async with factory() as session:
        owner, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"usage-{tag}",
            email=f"usage-{tag}@usage.test",
        )
        await session.commit()
        return owner, Scope(user_id=owner.id, workspace_id=workspace.id, role=Role.OWNER)


async def _run_aged(scope, factory, *, ago: dt.timedelta, mode: RunMode = RunMode.EXECUTE):
    """One run, then backdated. `created_at` is a server default, so this is two
    statements — and the UPDATE is the point: it puts a value in the column that
    Postgres stored rather than one Python computed a moment ago."""
    async with factory() as session:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt="Build a Bell pair",
            mode=mode,
            framework=Framework.QISKIT,
        )
        stamp = dt.datetime.now(dt.timezone.utc) - ago
        await session.execute(update(Run).where(Run.id == run.id).values(created_at=stamp))
        await session.commit()
        return stamp


async def _usage(account, factory):
    _owner, scope = account
    async with factory() as session:
        return await usage_routes.usage(
            (_owner, object()),
            scope,
            session,
            _settings(),
        )


async def test_a_fresh_account_has_spent_nothing(account, factory):
    result = await _usage(account, factory)
    assert result.runs.used == 0
    assert result.runs.remaining == FREE_WEEKLY
    assert result.runs.next_slot_at is None


async def test_the_window_boundary_holds_on_stored_timestamps(account, factory):
    _owner, scope = account
    await _run_aged(scope, factory, ago=TIER_WINDOW + dt.timedelta(seconds=1))
    inside = await _run_aged(scope, factory, ago=dt.timedelta(days=6))

    result = await _usage(account, factory)
    assert result.runs.used == 1, "a run older than the window must have aged out"
    assert result.runs.next_slot_at is not None
    # Within a second — the route computes `since` from its own now(), so the
    # boundary row's expiry is derived from the stamp we wrote, not recomputed.
    assert abs((result.runs.next_slot_at - (inside + TIER_WINDOW)).total_seconds()) < 1


async def test_the_oldest_run_is_found_when_it_was_not_inserted_first(account, factory):
    _owner, scope = account
    await _run_aged(scope, factory, ago=dt.timedelta(days=1))
    oldest = await _run_aged(scope, factory, ago=dt.timedelta(days=5))
    await _run_aged(scope, factory, ago=dt.timedelta(days=3))

    result = await _usage(account, factory)
    assert result.runs.used == 3
    assert abs((result.runs.next_slot_at - (oldest + TIER_WINDOW)).total_seconds()) < 1


async def test_chat_runs_do_not_spend_the_allowance(account, factory):
    _owner, scope = account
    await _run_aged(scope, factory, ago=dt.timedelta(days=1), mode=RunMode.CHAT)
    await _run_aged(scope, factory, ago=dt.timedelta(days=1), mode=RunMode.AUTO)

    result = await _usage(account, factory)
    assert result.runs.used == 0, "a free account's conversation is unmetered by policy"


async def test_the_allowance_is_the_accounts_and_not_one_workspaces(account, factory):
    """Two tenants, one account, one allowance.

    The unit test asserts the SQL has no workspace predicate. This asserts what
    that is *for*: a user who spends runs in a second workspace does not get a
    second five.
    """
    owner, scope = account
    async with factory() as session:
        second, _membership = await system.create_team_workspace(
            session, owner=owner, name="Second", owned_workspace_limit=None
        )
        await session.commit()
    elsewhere = Scope(user_id=owner.id, workspace_id=second.id, role=Role.OWNER)

    await _run_aged(scope, factory, ago=dt.timedelta(days=1))
    await _run_aged(elsewhere, factory, ago=dt.timedelta(days=2))

    from_first = await _usage(account, factory)
    from_second = await _usage((owner, elsewhere), factory)

    assert from_first.runs.used == 2
    assert from_second.runs.used == 2, "the same allowance, read from either workspace"
    # ...while the artifact cap is per workspace and must NOT follow it.
    assert from_first.workspaces.used == 2


async def test_an_exhausted_account_reports_the_run_that_frees_it(account, factory):
    _owner, scope = account
    stamps = []
    for day in range(FREE_WEEKLY):
        stamps.append(await _run_aged(scope, factory, ago=dt.timedelta(days=6 - day * 0.5)))

    result = await _usage(account, factory)
    assert result.runs.used == FREE_WEEKLY
    assert result.runs.exhausted is True
    assert result.runs.remaining == 0
    oldest = min(stamps)
    assert abs((result.runs.next_slot_at - (oldest + TIER_WINDOW)).total_seconds()) < 1


async def test_the_reported_count_is_the_one_the_gate_would_read(account, factory):
    """Both numbers, from the same database, in the same test.

    `test_usage_endpoint` walks a mocked count through both paths. This walks
    real rows through both queries, which is the only version that would catch
    the two disagreeing because of something Postgres does.
    """
    _owner, scope = account
    for day in (1, 2, 3):
        await _run_aged(scope, factory, ago=dt.timedelta(days=day))

    reported = await _usage(account, factory)
    async with factory() as session:
        enforced = await runs_repo.count_execute_runs_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert reported.runs.used == enforced == 3


async def test_the_timestamp_query_uses_the_allowance_index(account, factory):
    """`ix_runs_user_mode_created` exists for the count; this reads it too.

    An ascending ORDER BY on a DESC index is served by a backward scan — but
    "is" is a claim about the planner, and the planner is the thing that
    silently stops doing it. EXPLAIN is how that stays true.
    """
    _owner, scope = account
    await _run_aged(scope, factory, ago=dt.timedelta(days=1))

    stmt = runs_repo.oldest_allowance_runs_stmt(
        scope, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW, count=1
    )
    async with factory() as session:
        # A tiny table would be sequentially scanned whatever the index says,
        # so the planner is told to prefer the index if it can use it at all.
        await session.execute(_text("set local enable_seqscan = off"))
        plan = "\n".join(
            row[0] for row in (await session.execute(_text("EXPLAIN " + _sql(stmt)))).all()
        )

    assert "ix_runs_user_mode_created" in plan, plan


def _sql(stmt) -> str:
    from sqlalchemy.dialects import postgresql

    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def _text(sql: str):
    from sqlalchemy import text

    return text(sql)
