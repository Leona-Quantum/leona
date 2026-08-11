"""DB-free checks for the poll loop's orphaned-run reaper.

The reaper is the last line of defence for a run whose job died: if it stops
early, or a single bad row aborts the batch, runs go back to spinning forever.
"""

import uuid

import pytest

from majorana_api.repos import system
from majorana_worker import __main__ as worker_main


class _Session:
    async def commit(self):
        return None


class _Context:
    async def __aenter__(self):
        return _Session()

    async def __aexit__(self, *_args):
        return None


def _factory():
    return _Context()


def _orphan(delivery_error: str | None = None) -> system.OrphanedRun:
    return system.OrphanedRun(
        run_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        job_id=uuid.uuid4(),
        delivery_error=delivery_error,
    )


async def test_every_listed_orphan_is_closed(monkeypatch):
    orphans = (_orphan(), _orphan("delivery abandoned"))
    closed = []

    async def list_orphaned_runs(_session, **_kwargs):
        return orphans

    async def close_orphaned_run(_session, orphan):
        closed.append(orphan.run_id)
        return True

    monkeypatch.setattr(system, "list_orphaned_runs", list_orphaned_runs)
    monkeypatch.setattr(worker_main, "close_orphaned_run", close_orphaned_run)
    await worker_main._reap_orphaned_runs(_factory)

    assert closed == [orphan.run_id for orphan in orphans]


async def test_one_failing_run_does_not_abandon_the_rest(monkeypatch):
    first, second = _orphan(), _orphan()
    closed = []

    async def list_orphaned_runs(_session, **_kwargs):
        return (first, second)

    async def close_orphaned_run(_session, orphan):
        if orphan.run_id == first.run_id:
            raise RuntimeError("run vanished")
        closed.append(orphan.run_id)
        return True

    monkeypatch.setattr(system, "list_orphaned_runs", list_orphaned_runs)
    monkeypatch.setattr(worker_main, "close_orphaned_run", close_orphaned_run)
    await worker_main._reap_orphaned_runs(_factory)

    assert closed == [second.run_id]


async def test_nothing_to_reap_touches_nothing(monkeypatch):
    calls = []

    async def list_orphaned_runs(_session, **_kwargs):
        return ()

    async def close_orphaned_run(_session, orphan):
        calls.append(orphan)
        return True

    monkeypatch.setattr(system, "list_orphaned_runs", list_orphaned_runs)
    monkeypatch.setattr(worker_main, "close_orphaned_run", close_orphaned_run)
    await worker_main._reap_orphaned_runs(_factory)

    assert calls == []


async def test_the_grace_period_clears_the_dead_letter_retry_budget():
    """The reaper must never race a delivery that is still retrying."""
    budget_s = system.DEFAULT_DEAD_LETTER_MAX_ATTEMPTS * 30.0
    assert system.ORPHANED_RUN_GRACE_S > budget_s * 2
    assert system.ORPHANED_DIRECT_RUN_GRACE_S > system.ORPHANED_RUN_GRACE_S


async def test_a_negative_grace_period_is_rejected():
    with pytest.raises(ValueError, match="grace_seconds"):
        await system.list_orphaned_runs(_Session(), grace_seconds=-1)
    with pytest.raises(ValueError, match="direct_grace_seconds"):
        await system.list_orphaned_runs(_Session(), direct_grace_seconds=-1)
