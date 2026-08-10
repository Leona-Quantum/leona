"""Live Postgres checks for the orphaned-run reaper's selection predicate.

Twelve production runs sat in `running` for days (2026-07-16 → 07-19) because
dead-letter delivery is the only path that closes a run whose job died, and
`mark_job_dead_lettered` stamps `dead_lettered_at` once its retry budget is spent
whether or not the callback succeeded. These tests pin the reconciliation query
that now catches that case — and, just as importantly, the three cases it must
NOT catch, since closing a live run would be far worse than leaving one spinning.
"""

import datetime as dt
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus
from sqlalchemy import update

from majorana_api.db import engine_from_env, session_factory
from majorana_api.jobs import RUN_EXECUTE_JOB_KIND
from majorana_api.orm import Job, Run
from majorana_api.repos import runs, system
from majorana_worker.handlers import close_orphaned_run

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="orphaned-run reconciliation needs DATABASE_URL"
)


@pytest.fixture
async def env():
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"orphan-test-{uuid.uuid4()}",
            email=f"orphan-{uuid.uuid4()}@authz.test",
        )
        await session.commit()
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
    try:
        yield factory, scope
    finally:
        await engine.dispose()


async def _orphan(
    factory,
    scope,
    *,
    run_status: RunStatus = RunStatus.RUNNING,
    job_status: str = "failed",
    dead_lettered_age_s: float | None = system.ORPHANED_RUN_GRACE_S + 60,
    delivery_error: str | None = None,
) -> uuid.UUID:
    """A run in `run_status` whose execution job is in `job_status`."""
    async with factory() as session:
        run = await runs.create_run(
            scope,
            session,
            task_prompt="orphan reconciliation",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        if run_status is not RunStatus.QUEUED:
            await runs.update_run_status(scope, session, run.id, run_status)
        job = await system.enqueue_job(
            session,
            kind=RUN_EXECUTE_JOB_KIND,
            payload={
                "run_id": str(run.id),
                "user_id": str(scope.user_id),
                "workspace_id": str(scope.workspace_id),
            },
            run_id=run.id,
        )
        now = dt.datetime.now(dt.UTC)
        dead_lettered_at = (
            None if dead_lettered_age_s is None else now - dt.timedelta(seconds=dead_lettered_age_s)
        )
        # ck_jobs_lease_shape (migration 0012): a `running` job must hold a full
        # lease, and every other status must hold none.
        lease = (
            {
                "locked_by": "worker-test",
                "locked_at": now,
                "lease_token": uuid.uuid4(),
                "lease_expires_at": now + dt.timedelta(seconds=120),
            }
            if job_status == "running"
            else {}
        )
        await session.execute(
            update(Job)
            .where(Job.id == job.id)
            .values(
                status=job_status,
                dead_lettered_at=dead_lettered_at,
                dead_letter_error=delivery_error,
                **lease,
            )
        )
        await session.commit()
        return run.id


async def _jobless_run(
    factory,
    scope,
    *,
    age_s: float,
    run_status: RunStatus = RunStatus.RUNNING,
) -> uuid.UUID:
    """A direct-handler style active run with deliberately no durable job."""
    async with factory() as session:
        run = await runs.create_run(
            scope,
            session,
            task_prompt="direct orphan reconciliation",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        if run_status is not RunStatus.QUEUED:
            await runs.update_run_status(scope, session, run.id, run_status)
        await session.execute(
            update(Run)
            .where(Run.id == run.id)
            .values(updated_at=dt.datetime.now(dt.UTC) - dt.timedelta(seconds=age_s))
        )
        await session.commit()
        return run.id


def _ids(orphans) -> set[uuid.UUID]:
    return {orphan.run_id for orphan in orphans}


@requires_db
async def test_a_run_left_active_by_an_abandoned_dead_letter_is_listed(env):
    factory, scope = env
    run_id = await _orphan(factory, scope, delivery_error="callback raised 5 times")

    async with factory() as session:
        orphans = await system.list_orphaned_runs(session)

    listed = [orphan for orphan in orphans if orphan.run_id == run_id]
    assert len(listed) == 1
    assert listed[0].workspace_id == scope.workspace_id
    assert listed[0].user_id == scope.user_id
    assert listed[0].delivery_error == "callback raised 5 times"


@requires_db
async def test_a_queued_run_whose_job_is_dead_is_also_listed(env):
    factory, scope = env
    run_id = await _orphan(factory, scope, run_status=RunStatus.QUEUED, job_status="dead")

    async with factory() as session:
        assert run_id in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_an_old_direct_run_with_no_job_is_listed(env):
    factory, scope = env
    run_id = await _jobless_run(
        factory,
        scope,
        age_s=system.ORPHANED_DIRECT_RUN_GRACE_S + 60,
    )

    async with factory() as session:
        listed = [
            orphan
            for orphan in await system.list_orphaned_runs(session, limit=1_000)
            if orphan.run_id == run_id
        ]

    assert len(listed) == 1
    assert listed[0].job_id is None
    assert listed[0].delivery_error is None


@requires_db
async def test_a_fresh_direct_run_with_no_job_is_never_reaped(env):
    factory, scope = env
    run_id = await _jobless_run(factory, scope, age_s=30)

    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_delivery_still_in_flight_is_never_reaped(env):
    """dead_lettered_at IS NULL means delivery has not given up yet."""
    factory, scope = env
    run_id = await _orphan(factory, scope, dead_lettered_age_s=None)

    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_a_run_inside_the_grace_period_is_never_reaped(env):
    factory, scope = env
    run_id = await _orphan(factory, scope, dead_lettered_age_s=30)

    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_a_run_whose_job_is_still_working_is_never_reaped(env):
    """The reaper must not touch a run that is genuinely executing."""
    factory, scope = env
    run_id = await _orphan(factory, scope, job_status="running", dead_lettered_age_s=None)

    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_a_run_with_any_other_live_job_is_never_reaped(env):
    """A terminal job alongside a working one must not condemn the run."""
    factory, scope = env
    run_id = await _orphan(factory, scope)

    async with factory() as session:
        assert run_id in _ids(await system.list_orphaned_runs(session))
        await system.enqueue_job(
            session,
            kind=RUN_EXECUTE_JOB_KIND,
            payload={"run_id": str(run_id)},
            run_id=run_id,
        )
        await session.commit()

    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_an_already_terminal_run_is_not_listed(env):
    factory, scope = env
    run_id = await _orphan(factory, scope, run_status=RunStatus.FAILED)

    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_reaping_closes_the_run_and_writes_the_terminal_sequence(env):
    """End to end: the run stops spinning and gets the same events delivery writes."""
    factory, scope = env
    run_id = await _orphan(factory, scope, delivery_error="callback raised 5 times")

    async with factory() as session:
        orphan = next(
            o for o in await system.list_orphaned_runs(session, limit=1_000) if o.run_id == run_id
        )
    async with factory() as session:
        assert await close_orphaned_run(session, orphan) is True

    async with factory() as session:
        run = await runs.get_run(scope, session, run_id)
        events = await runs.list_run_events(scope, session, run_id)
    assert RunStatus(run.status) is RunStatus.FAILED
    assert [event.type for event in events] == ["run.error", "run.finished"]
    assert events[0].payload["code"] == "run_orphaned"
    assert "abandoned" in events[0].payload["message"]

    # The run is terminal, so it drops out of the candidate set — no re-reaping.
    async with factory() as session:
        assert run_id not in _ids(await system.list_orphaned_runs(session))


@requires_db
async def test_reaping_an_old_direct_run_records_the_no_job_reason(env):
    factory, scope = env
    run_id = await _jobless_run(
        factory,
        scope,
        age_s=system.ORPHANED_DIRECT_RUN_GRACE_S + 60,
    )

    async with factory() as session:
        orphan = next(
            o for o in await system.list_orphaned_runs(session, limit=1_000) if o.run_id == run_id
        )
    async with factory() as session:
        assert await close_orphaned_run(session, orphan) is True

    async with factory() as session:
        run = await runs.get_run(scope, session, run_id)
        events = await runs.list_run_events(scope, session, run_id)
    assert RunStatus(run.status) is RunStatus.FAILED
    assert [event.type for event in events] == ["run.error", "run.finished"]
    assert "no execution job" in events[0].payload["message"]


@requires_db
async def test_reaping_is_idempotent_against_a_partial_delivery_sequence(env):
    """A delivery that wrote run.error then died must be completed, not duplicated."""
    factory, scope = env
    run_id = await _orphan(factory, scope)

    async with factory() as session:
        orphan = next(o for o in await system.list_orphaned_runs(session) if o.run_id == run_id)
        await runs.append_run_event(
            scope,
            session,
            run_id,
            type="run.error",
            payload={
                "stage": None,
                "code": "run_orphaned",
                "message": "execution job ended without closing this run",
            },
            event_id=uuid.uuid5(run_id, "run.error.job_dead_letter"),
        )
        await session.commit()

    async with factory() as session:
        assert await close_orphaned_run(session, orphan) is True

    async with factory() as session:
        events = await runs.list_run_events(scope, session, run_id)
    assert [event.type for event in events] == ["run.error", "run.finished"]
