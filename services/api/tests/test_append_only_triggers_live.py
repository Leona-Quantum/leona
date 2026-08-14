"""Live proof that run_events, audit_log and usage_events are append-only.

`test_append_only_triggers_migration.py` proves migration 0050 renders the
right SQL. It cannot prove that SQL, once applied to a real server, actually
stops a write — Postgres privileges, trigger firing, and the exact SQLSTATE a
driver surfaces are exactly the kind of thing a monkeypatched `op.execute`
cannot see. This file runs the three tables' insert/update/delete surface
against a live server. Background on why a grant could not do this job is in
`0050_append_only_triggers.py`'s own docstring.

**The positive control below is the point of this file, not an afterthought.**
An UPDATE raising an error proves nothing by itself: a stale connection, a
fixture pointed at the wrong database, or a session already poisoned by an
earlier failure would ALSO make every UPDATE here fail, and this file would
look identical whether the trigger works or the harness is simply broken.
`test_the_harness_can_observe_a_successful_update` performs an ordinary
UPDATE — same fixture, same session, same statement shape as the three
rejections — against `runs`, the parent of `run_events` and a table 0050 does
not touch, and asserts it succeeds. If that one test ever fails, every
rejection below must be read as "the harness is broken," not "the trigger is
extra strong."

Every write in this file happens inside the fixture's one session, which is
never committed. That is deliberate and differs from `test_usage_spend_live.py`'s
`account` fixture, which commits real rows and relies on unique tags to avoid
collisions — fine there, wrong here: a row this file writes to prove
append-only is, if the trigger works, a row nothing could ever delete again.
So instead each assertion that expects a rejection opens a SAVEPOINT
(`session.begin_nested()`) around the one statement expected to fail —
Postgres aborts the enclosing transaction on any error, and a SAVEPOINT is the
only way to recover from that without losing the setup rows already written
earlier in the same session — and the session as a whole is rolled back at
teardown, so nothing here outlives the test. One exception:
`test_the_bypass_is_scoped_to_its_own_transaction_not_the_session` commits a
workspace and user up front, because it has to cross a real ROLLBACK boundary
to prove what it proves, and everything created in the same transaction as
that rollback would be undone by it too — see that test's own docstring.

Migration 0050 also gives these three tables a transaction-scoped bypass
(`SET LOCAL majorana.append_only_bypass = 'on'`), for
`repo_test_helpers.py::delete_committed_tenants` alone — see 0050's docstring
for the full reasoning. `test_the_bypass_is_scoped_to_its_own_transaction_not_the_session`
is the second positive control this file needs because of it: proving the
bypass lets a write through is not enough by itself, any more than proving the
trigger rejects one is — a GUC that is silently ALWAYS on would also make that
test pass, and would mean the trigger is not really append-only for anyone
sharing the connection afterward. So it also proves the bypass turns back off
the moment its own transaction ends.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus, UsageKind
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import AuditLog, Run, RunEvent, UsageEvent
from majorana_api.repos import audit as audit_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import usage as usage_repo

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the append-only triggers need DATABASE_URL"
)

pytestmark = requires_db


def _sqlstate(error: DBAPIError) -> str | None:
    """The SQLSTATE Postgres actually sent, read from psycopg's diagnostics
    rather than inferred from the exception's Python class. The class psycopg
    raises (e.g. `ObjectNotInPrerequisiteState`) is itself derived from this
    same field, so reading `.diag.sqlstate` directly is one fewer thing that
    could be wrong between what the server said and what the assertion
    checks."""
    diag = getattr(error.orig, "diag", None)
    return getattr(diag, "sqlstate", None)


@pytest.fixture
async def account():
    """A workspace, its owner, and a run to hang a run_event off of — all
    written through one session that is never committed. See the module
    docstring for why: falling out of the `async with factory()` block without
    committing rolls back everything written through it, which is what leaves
    this file with nothing to clean up afterward."""
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        tag = uuid.uuid4().hex[:12]
        user, workspace = await system.get_or_provision_user(
            session, workos_user_id=f"appendonly-{tag}", email=f"appendonly-{tag}@spend.test"
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt="append-only fixture run",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        yield session, scope, run
        await session.rollback()
    await engine.dispose()


async def test_run_events_insert_succeeds_update_and_delete_are_rejected(account):
    session, scope, run = account
    event = await runs_repo.append_run_event(scope, session, run.id, type="run.started", payload={})
    inserted = (
        await session.execute(select(RunEvent.id).where(RunEvent.id == event.id))
    ).scalar_one()
    assert inserted == event.id, "the table must remain writable — this INSERT has to succeed"

    with pytest.raises(DBAPIError, match="append-only") as update_exc:
        async with session.begin_nested():
            await session.execute(
                update(RunEvent).where(RunEvent.id == event.id).values(type="run.tampered")
            )
    assert _sqlstate(update_exc.value) == "55000"

    with pytest.raises(DBAPIError, match="append-only") as delete_exc:
        async with session.begin_nested():
            await session.execute(delete(RunEvent).where(RunEvent.id == event.id))
    assert _sqlstate(delete_exc.value) == "55000"


async def test_audit_log_insert_succeeds_update_and_delete_are_rejected(account):
    session, scope, _run = account
    row = await audit_repo.record_audit(scope, session, action="test.append_only_probe")
    inserted = (
        await session.execute(select(AuditLog.id).where(AuditLog.id == row.id))
    ).scalar_one()
    assert inserted == row.id, "the table must remain writable — this INSERT has to succeed"

    with pytest.raises(DBAPIError, match="append-only") as update_exc:
        async with session.begin_nested():
            await session.execute(
                update(AuditLog).where(AuditLog.id == row.id).values(action="tampered")
            )
    assert _sqlstate(update_exc.value) == "55000"

    with pytest.raises(DBAPIError, match="append-only") as delete_exc:
        async with session.begin_nested():
            await session.execute(delete(AuditLog).where(AuditLog.id == row.id))
    assert _sqlstate(delete_exc.value) == "55000"


async def test_usage_events_insert_succeeds_update_and_delete_are_rejected(account):
    session, scope, _run = account
    row = await usage_repo.record_usage(
        scope, session, kind=UsageKind.LLM_TOKENS, quantity=1, meta={"role": "test"}
    )
    inserted = (
        await session.execute(select(UsageEvent.id).where(UsageEvent.id == row.id))
    ).scalar_one()
    assert inserted == row.id, "the table must remain writable — this INSERT has to succeed"

    with pytest.raises(DBAPIError, match="append-only") as update_exc:
        async with session.begin_nested():
            await session.execute(
                update(UsageEvent).where(UsageEvent.id == row.id).values(quantity=2)
            )
    assert _sqlstate(update_exc.value) == "55000"

    with pytest.raises(DBAPIError, match="append-only") as delete_exc:
        async with session.begin_nested():
            await session.execute(delete(UsageEvent).where(UsageEvent.id == row.id))
    assert _sqlstate(delete_exc.value) == "55000"


async def test_the_harness_can_observe_a_successful_update(account):
    """The control the rest of this file depends on — see the module docstring.

    Same session, same fixture, same `UPDATE ... WHERE id = ...` shape as the
    three rejections above, against `runs`: the parent of `run_events`, and a
    table 0050 does not put a trigger on. If this ever starts failing, the
    session or the fixture is broken, and every rejection in this file needs
    to be treated as unproven until this passes again.
    """
    session, _scope, run = account
    async with session.begin_nested():
        await session.execute(update(Run).where(Run.id == run.id).values(status=RunStatus.RUNNING))

    refreshed = (await session.execute(select(Run.status).where(Run.id == run.id))).scalar_one()
    assert refreshed == RunStatus.RUNNING


async def test_the_bypass_is_scoped_to_its_own_transaction_not_the_session():
    """The bypass's own positive control — see the module docstring for why.

    `delete_committed_tenants` sets `majorana.append_only_bypass` with `SET
    LOCAL` so it can clean up committed rows without weakening the trigger for
    anyone else (0050's docstring has the full reasoning). Proving that
    end-to-end takes two separate transactions on the same connection: the
    bypass lets a DELETE through in the transaction that set it, and a DELETE
    in the NEXT transaction — where nothing set it — is rejected exactly like
    every other one in this file. Skipping the second half would not be a
    smaller test, it would be a different, weaker claim: "the bypass works,"
    not "the bypass is scoped." A GUC that silently stayed on regardless of
    `SET LOCAL` would pass the first half and fail only the second.

    This does not use the `account` fixture. It needs its own workspace and
    user committed up front — unlike the rest of this file — because crossing
    a real ROLLBACK boundary is the whole point, and everything created in the
    same transaction as that rollback, including a freshly made workspace and
    user, would be undone by it too.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    tag = uuid.uuid4().hex[:12]

    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"appendonly-bypass-{tag}",
            email=f"appendonly-bypass-{tag}@spend.test",
        )
        await session.commit()
    scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)

    async with factory() as session:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt="bypass scope fixture run",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        event = await runs_repo.append_run_event(
            scope, session, run.id, type="run.started", payload={}
        )

        # WITH the bypass, in the transaction that set it: the DELETE succeeds.
        await session.execute(text("SET LOCAL majorana.append_only_bypass = 'on'"))
        await session.execute(delete(RunEvent).where(RunEvent.id == event.id))
        remaining = (
            await session.execute(select(RunEvent.id).where(RunEvent.id == event.id))
        ).scalar_one_or_none()
        assert remaining is None, "the bypass should have let this DELETE through"

        # End the transaction. Whatever SET LOCAL did dies here with it — that
        # is the entire claim under test. The run created above dies with it
        # too, which is fine: it only existed to give the event a parent.
        await session.rollback()

    async with factory() as session:
        # A fresh transaction, same connection pool, no bypass set: this must
        # be rejected exactly like every other DELETE in this file. A new run
        # and event, because the rollback above undid the first pair too.
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt="bypass scope fixture run 2",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        other = await runs_repo.append_run_event(
            scope, session, run.id, type="run.started", payload={}
        )

        with pytest.raises(DBAPIError, match="append-only") as delete_exc:
            async with session.begin_nested():
                await session.execute(delete(RunEvent).where(RunEvent.id == other.id))
        assert _sqlstate(delete_exc.value) == "55000"

        await session.rollback()
    await engine.dispose()
