"""The token-spend block against real Postgres, and over real HTTP.

`test_usage_endpoint.py` proves the fold: given rows shaped like this, the three
totals come out like that. It cannot prove the rows ever arrive in that shape,
and everything interesting about this query is on the far side of that line.

Four things only checkable here:

- **`meta->>'role'` actually extracts the role.** The bucketing is the whole
  feature, and it runs inside Postgres against a JSONB column written by a
  different service. A typo in the key name produces zero chat spend and a
  perfectly healthy 200 — the fold's tests would all still pass, because the
  fold would be receiving exactly what it was handed.
- **Rows with no `meta` at all.** `record_usage` allows `meta=None` and the
  ledger predates the chat writer, so such rows exist. NULL group keys arriving
  as a third bucket is a real shape, not a hypothetical one.
- **The window boundary on a stored timestamp**, on a table the migration
  revokes UPDATE on — so an out-of-window row is written as an INSERT with an
  explicit `ts`, which is also the only way to compare against a value Postgres
  stored rather than one Python made a moment ago.
- **Per workspace, and the consequence of it.** The unit test asserts the
  workspace predicate is in the SQL. This asserts what it is for: a second
  tenant's chat does not appear in this one's number.

And the endpoint is driven over HTTP rather than called as a function, because
`PATCH /projects/{id}` returned a 500 in exactly that gap last release — a route
that its repository tests, its behaviour suite and the authz matrix all passed.
"""

import datetime as dt
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import CHAT_USAGE_ROLE, Role, UsageKind

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.ids import uuid7
from majorana_api.orm import UsageEvent, User
from majorana_api.repos import system
from majorana_api.repos import usage as usage_repo
from majorana_api.settings import Settings
from majorana_api.tiers import TIER_WINDOW

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the spend report needs DATABASE_URL"
)

pytestmark = requires_db

SETTINGS = Settings(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


@pytest.fixture
async def account():
    """A fresh workspace per test — every assertion here sums ALL of its rows."""
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        tag = uuid.uuid4().hex[:12]
        user, workspace = await system.get_or_provision_user(
            session, workos_user_id=f"spend-{tag}", email=f"spend-{tag}@spend.test"
        )
        await session.commit()
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        identity = (User(id=user.id, email=user.email, plan=user.plan), workspace)

    app = create_app(SETTINGS)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: identity

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, factory, scope, user
    await engine.dispose()


async def _spend(factory, scope, *, role, model, tokens, ago=dt.timedelta(minutes=1)):
    """One ledger row, aged.

    Written as an INSERT with an explicit `ts` rather than through
    `record_usage` and then backdated: migration 0001 revokes UPDATE on
    `usage_events` from `app_rw` (it is an append-only billing substrate), so
    backdating is not a thing production could do and not a thing a test should
    teach. `meta=None` is reachable — the parameter is optional — so it is
    passed through as-is rather than defaulted to a dict here.
    """
    async with factory() as session:
        session.add(
            UsageEvent(
                id=uuid7(),
                workspace_id=scope.workspace_id,
                user_id=scope.user_id,
                kind=UsageKind.LLM_TOKENS,
                quantity=tokens,
                meta=None if role is None else {"role": role, "model": model},
                ts=dt.datetime.now(dt.timezone.utc) - ago,
            )
        )
        await session.commit()


async def _report(client: httpx.AsyncClient) -> dict:
    response = await client.get("/v1/usage")
    assert response.status_code == 200, response.text
    return response.json()["spend"]


async def test_a_workspace_that_has_spent_nothing_reports_zeroes(account):
    client, _factory, _scope, _user = account
    spend = await _report(client)

    assert spend["total"] == {"tokens": 0, "calls": 0}
    assert spend["chat"]["tokens"] == 0
    assert spend["runs"]["tokens"] == 0
    assert spend["by_model"] == []
    assert spend["window_days"] == TIER_WINDOW.days


async def test_chat_and_run_tokens_are_told_apart_by_postgres(account):
    """The assertion the whole file exists for.

    If `meta->>'role'` stopped matching what the worker writes, this is the only
    test in the repository that would fail: chat would read zero and the total
    would still be right.
    """
    client, factory, scope, _user = account
    await _spend(factory, scope, role=CHAT_USAGE_ROLE, model="deepseek-chat", tokens=1_200)
    await _spend(factory, scope, role=CHAT_USAGE_ROLE, model="deepseek-chat", tokens=800)
    await _spend(factory, scope, role="circuit_plan", model="deepseek-reasoner", tokens=5_000)

    spend = await _report(client)

    assert spend["chat"] == {"tokens": 2_000, "calls": 2}
    assert spend["runs"] == {"tokens": 5_000, "calls": 1}
    assert spend["total"] == {"tokens": 7_000, "calls": 3}
    assert [entry["model"] for entry in spend["by_model"]] == [
        "deepseek-reasoner",
        "deepseek-chat",
    ]


async def test_a_row_with_no_meta_is_a_run_and_keeps_its_tokens(account):
    """NULL role, NULL model — the coalesce in the query, exercised for real.

    Without it these arrive as a NULL group key: a third bucket that is neither
    chat nor a run, and tokens that appear in `total` but in no row of
    `by_model`.
    """
    client, factory, scope, _user = account
    await _spend(factory, scope, role=None, model=None, tokens=64)

    spend = await _report(client)

    assert spend["total"]["tokens"] == 64
    assert spend["chat"]["tokens"] == 0
    assert spend["runs"]["tokens"] == 64
    assert spend["by_model"] == [{"model": "", "tokens": 64, "calls": 1}]


async def test_the_window_boundary_holds_on_stored_timestamps(account):
    client, factory, scope, _user = account
    await _spend(
        factory,
        scope,
        role=CHAT_USAGE_ROLE,
        model="m",
        tokens=999,
        ago=TIER_WINDOW + dt.timedelta(seconds=1),
    )
    await _spend(
        factory, scope, role=CHAT_USAGE_ROLE, model="m", tokens=11, ago=dt.timedelta(days=6)
    )

    spend = await _report(client)

    assert spend["chat"]["tokens"] == 11, "spend older than the window must have aged out"
    assert spend["chat"]["calls"] == 1


async def test_a_second_tenants_spend_is_not_summed_into_this_one(account):
    """Two workspaces, one owner, two separate numbers.

    The run allowance directly above this block in the response is deliberately
    account-wide and would report 2 here. Spend must not follow it.
    """
    client, factory, scope, user = account
    async with factory() as session:
        second, _membership = await system.create_team_workspace(
            session, owner=user, name="Second", owned_workspace_limit=None
        )
        await session.commit()
    elsewhere = Scope(user_id=user.id, workspace_id=second.id, role=Role.OWNER)

    await _spend(factory, scope, role=CHAT_USAGE_ROLE, model="m", tokens=100)
    await _spend(factory, elsewhere, role=CHAT_USAGE_ROLE, model="m", tokens=5_000)

    spend = await _report(client)

    assert spend["chat"]["tokens"] == 100
    assert spend["total"]["calls"] == 1


async def test_only_token_events_are_counted(account):
    """`kind` is a predicate, not a comment.

    `usage_events` is one table for every metered quantity — runs and sandbox
    seconds live in it too, in units that are not tokens. Dropping the `kind`
    filter would add seconds to tokens and print the sum.
    """
    client, factory, scope, _user = account
    async with factory() as session:
        await usage_repo.record_usage(
            scope, session, kind=UsageKind.SANDBOX_SECONDS, quantity=42, meta={"role": "chat"}
        )
        await session.commit()

    spend = await _report(client)

    assert spend["total"]["tokens"] == 0


async def test_the_spend_query_reads_the_workspace_index(account):
    """`ix_usage_events_workspace_ts` is `(workspace_id, ts)` and this predicate
    is exactly it. The planner is the thing that silently stops using it."""
    from sqlalchemy import text
    from sqlalchemy.dialects import postgresql

    _client, factory, scope, _user = account
    await _spend(factory, scope, role=CHAT_USAGE_ROLE, model="m", tokens=1)

    stmt = usage_repo.token_spend_stmt(scope, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW)
    sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    async with factory() as session:
        # A tiny table is sequentially scanned whatever the index says.
        await session.execute(text("set local enable_seqscan = off"))
        plan = "\n".join(row[0] for row in (await session.execute(text("EXPLAIN " + sql))).all())

    assert "ix_usage_events_workspace_ts" in plan, plan
