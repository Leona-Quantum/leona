"""Live Postgres checks for atomic, conditional Dead Letter Run closure."""

import asyncio
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import runs, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="terminal Run consistency needs DATABASE_URL"
)


@pytest.fixture
async def env():
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"terminal-test-{uuid.uuid4()}",
            email=f"terminal-{uuid.uuid4()}@authz.test",
        )
        await session.commit()
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
    try:
        yield factory, scope
    finally:
        await engine.dispose()


async def _run(factory, scope) -> uuid.UUID:
    async with factory() as session:
        run = await runs.create_run(
            scope,
            session,
            task_prompt="terminal consistency",
            mode=RunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        await runs.update_run_status(scope, session, run.id, RunStatus.RUNNING)
        await session.commit()
        return run.id


def _event_ids(run_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (
        uuid.uuid5(run_id, "run.error.job_dead_letter"),
        uuid.uuid5(run_id, "run.finished"),
    )


async def _close(factory, scope, run_id) -> bool:
    error_id, finished_id = _event_ids(run_id)
    async with factory() as session:
        changed = await runs.fail_run_from_dead_letter(
            scope,
            session,
            run_id,
            error_payload={"stage": None, "code": "job_dead_letter", "message": "failed"},
            error_event_id=error_id,
            finished_event_id=finished_id,
        )
        await session.commit()
        return changed


async def _finish(factory, scope, run_id, status: RunStatus) -> RunStatus:
    async with factory() as session:
        result = await runs.finish_run(
            scope,
            session,
            run_id,
            status,
            event_payload={"status": status.value},
            event_id=uuid.uuid5(run_id, "run.finished"),
        )
        await session.commit()
        return result


@requires_db
async def test_competing_dead_letter_callbacks_create_one_terminal_sequence(env):
    factory, scope = env
    run_id = await _run(factory, scope)

    outcomes = await asyncio.gather(
        _close(factory, scope, run_id),
        _close(factory, scope, run_id),
    )
    assert sorted(outcomes) == [False, True]

    async with factory() as session:
        run = await runs.get_run(scope, session, run_id)
        events = await runs.list_run_events(scope, session, run_id)
        assert RunStatus(run.status) is RunStatus.FAILED
        assert [event.type for event in events] == ["run.error", "run.finished"]


@requires_db
async def test_terminal_event_conflict_rolls_back_status_and_second_event(env):
    factory, scope = env
    run_id = await _run(factory, scope)
    error_id, finished_id = _event_ids(run_id)
    async with factory() as session:
        await runs.append_run_event(
            scope,
            session,
            run_id,
            type="run.error",
            payload={"stage": None, "code": "different", "message": "old"},
            event_id=error_id,
        )
        await session.commit()

    async with factory() as session:
        with pytest.raises(ValueError, match="different content"):
            await runs.fail_run_from_dead_letter(
                scope,
                session,
                run_id,
                error_payload={"stage": None, "code": "job_dead_letter", "message": "failed"},
                error_event_id=error_id,
                finished_event_id=finished_id,
            )
        await session.rollback()

    async with factory() as session:
        run = await runs.get_run(scope, session, run_id)
        events = await runs.list_run_events(scope, session, run_id)
        assert RunStatus(run.status) is RunStatus.RUNNING
        assert [event.type for event in events] == ["run.error"]


@requires_db
async def test_completion_and_cancellation_race_leave_one_matching_terminal_event(env):
    factory, scope = env
    run_id = await _run(factory, scope)

    outcomes = await asyncio.gather(
        _finish(factory, scope, run_id, RunStatus.SUCCEEDED),
        _finish(factory, scope, run_id, RunStatus.CANCELLED),
    )

    async with factory() as session:
        run = await runs.get_run(scope, session, run_id)
        events = await runs.list_run_events(scope, session, run_id)
    terminal = RunStatus(run.status)
    assert outcomes == [terminal, terminal]
    assert len(events) == 1
    assert events[0].type == "run.finished"
    assert RunStatus(events[0].payload["status"]) is terminal
