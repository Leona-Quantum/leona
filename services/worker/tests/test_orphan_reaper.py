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


class _Recorder:
    """Stands in for `majorana_api.repos.notebooks` inside `close_orphaned_run`."""

    def __init__(self, version):
        self.version = version
        self.results: list[dict] = []
        self.turns: list[dict] = []

    async def get_version_by_run_id(self, _scope, _session, run_id):
        self.asked_for = run_id
        return self.version

    async def set_version_result(self, _scope, _session, version_id, **fields):
        self.results.append({"version_id": version_id, **fields})

    async def append_turn(self, _scope, _session, notebook_id, **fields):
        self.turns.append({"notebook_id": notebook_id, **fields})


async def _close(monkeypatch, version):
    from types import SimpleNamespace

    from majorana_worker import handlers

    recorder = _Recorder(version)

    async def list_run_events(_scope, _session, _run_id):
        return []

    async def fail_run_from_dead_letter(_scope, _session, _run_id, **_kwargs):
        return True

    monkeypatch.setattr(handlers, "notebooks_repo", recorder)
    monkeypatch.setattr(
        handlers,
        "runs_repo",
        SimpleNamespace(
            list_run_events=list_run_events, fail_run_from_dead_letter=fail_run_from_dead_letter
        ),
    )
    monkeypatch.setattr(handlers, "_validated_event_payload", lambda _run, _type, payload: payload)
    orphan = _orphan("callback never landed")
    closed = await handlers.close_orphaned_run(_Session(), orphan)
    return orphan, recorder, closed


async def test_the_reaper_also_fails_the_notebook_version_the_run_was_generating(monkeypatch):
    """Closing only the run left the notebook refusing every later edit, for good.

    The API answers 409 `notebook_version_in_flight` while a notebook's latest version
    is `queued` or `running`, and the dead-letter handler is the only other thing that
    ever moves that row. The reaper runs precisely when that handler did not.
    """
    from types import SimpleNamespace

    version = SimpleNamespace(id=uuid.uuid4(), notebook_id=uuid.uuid4(), status="running")
    orphan, recorder, closed = await _close(monkeypatch, version)

    assert closed is True
    assert recorder.asked_for == orphan.run_id
    assert [(r["version_id"], r["status"]) for r in recorder.results] == [(version.id, "failed")]
    assert "callback never landed" in recorder.results[0]["error"]
    assert [(t["notebook_id"], t["version_id"], t["run_id"]) for t in recorder.turns] == [
        (version.notebook_id, version.id, orphan.run_id)
    ]


@pytest.mark.parametrize("status", ["ready", "failed"])
async def test_a_version_that_already_has_a_result_is_left_alone(monkeypatch, status):
    from types import SimpleNamespace

    version = SimpleNamespace(id=uuid.uuid4(), notebook_id=uuid.uuid4(), status=status)
    _orphan_row, recorder, _closed = await _close(monkeypatch, version)

    assert recorder.results == []
    assert recorder.turns == []


async def test_a_run_that_made_no_notebook_closes_as_before(monkeypatch):
    _orphan_row, recorder, closed = await _close(monkeypatch, None)

    assert closed is True
    assert recorder.results == []
    assert recorder.turns == []
