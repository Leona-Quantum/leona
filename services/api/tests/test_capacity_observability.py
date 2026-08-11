import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from majorana_api import db
from majorana_api.routes import runs


class _RecordingInstrument:
    def __init__(self) -> None:
        self.calls: list[tuple[object, object | None]] = []

    def add(self, value, attributes=None) -> None:
        self.calls.append((value, attributes))

    def record(self, value, attributes=None) -> None:
        self.calls.append((value, attributes))


class _Pool:
    def connect(self):
        return "connection"


class _TimeoutPool:
    def connect(self):
        raise SQLAlchemyTimeoutError("pool exhausted")


def test_pool_acquisition_records_duration_without_request_attributes(monkeypatch):
    wait = _RecordingInstrument()
    timeouts = _RecordingInstrument()
    monkeypatch.setattr(db, "_checkout_wait", wait)
    monkeypatch.setattr(db, "_checkout_timeouts", timeouts)
    clock = iter((10.0, 10.25))
    monkeypatch.setattr(db.time, "monotonic", lambda: next(clock))

    pool = _Pool()
    db._instrument_pool(pool)

    assert pool.connect() == "connection"
    assert wait.calls == [(pytest.approx(0.25), None)]
    assert timeouts.calls == []


def test_pool_timeout_is_counted_and_re_raised(monkeypatch):
    wait = _RecordingInstrument()
    timeouts = _RecordingInstrument()
    monkeypatch.setattr(db, "_checkout_wait", wait)
    monkeypatch.setattr(db, "_checkout_timeouts", timeouts)
    clock = iter((20.0, 20.5))
    monkeypatch.setattr(db.time, "monotonic", lambda: next(clock))

    pool = _TimeoutPool()
    db._instrument_pool(pool)

    with pytest.raises(SQLAlchemyTimeoutError, match="pool exhausted"):
        pool.connect()

    assert wait.calls == [(pytest.approx(0.5), None)]
    assert timeouts.calls == [(1, None)]


class _SessionFactory:
    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


@pytest.mark.asyncio
async def test_sse_metrics_track_client_disconnect_and_release_active_stream(monkeypatch):
    active = _RecordingInstrument()
    polls = _RecordingInstrument()
    disconnects = _RecordingInstrument()
    monkeypatch.setattr(runs, "_sse_active_streams", active)
    monkeypatch.setattr(runs, "_sse_polls", polls)
    monkeypatch.setattr(runs, "_sse_disconnects", disconnects)
    monkeypatch.setattr(runs, "SSE_POLL_INTERVAL_S", 0.0)

    run_id = uuid.uuid4()
    disconnected_calls = 0

    async def is_disconnected():
        nonlocal disconnected_calls
        disconnected_calls += 1
        return disconnected_calls == 2

    async def get_run(_scope, _session, requested_run_id):
        assert requested_run_id == run_id
        return SimpleNamespace(status="running")

    async def list_run_events_with_status(_scope, _session, requested_run_id, *, after_seq):
        assert requested_run_id == run_id
        assert after_seq == 0
        return [], "running"

    monkeypatch.setattr(runs.runs_repo, "get_run", get_run)
    monkeypatch.setattr(runs.runs_repo, "list_run_events_with_status", list_run_events_with_status)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(session_factory=_SessionFactory())),
        is_disconnected=is_disconnected,
    )

    response = await runs.stream_run_events(run_id, object(), object(), request)
    chunks = [chunk async for chunk in response.body_iterator]

    assert chunks == []
    assert active.calls == [(1, None), (-1, None)]
    assert polls.calls == [(1, None)]
    assert disconnects.calls == [(1, None)]
    assert str(run_id) not in repr(active.calls + polls.calls + disconnects.calls)


@pytest.mark.asyncio
async def test_sse_active_metric_is_released_when_stream_is_cancelled(monkeypatch):
    active = _RecordingInstrument()
    polls = _RecordingInstrument()
    disconnects = _RecordingInstrument()
    monkeypatch.setattr(runs, "_sse_active_streams", active)
    monkeypatch.setattr(runs, "_sse_polls", polls)
    monkeypatch.setattr(runs, "_sse_disconnects", disconnects)
    monkeypatch.setattr(runs, "SSE_HEARTBEAT_EVERY_POLLS", 1)

    async def get_run(_scope, _session, _run_id):
        return SimpleNamespace(status="running")

    async def list_run_events_with_status(_scope, _session, _run_id, *, after_seq):
        return [], "running"

    async def is_disconnected():
        return False

    monkeypatch.setattr(runs.runs_repo, "get_run", get_run)
    monkeypatch.setattr(runs.runs_repo, "list_run_events_with_status", list_run_events_with_status)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(session_factory=_SessionFactory())),
        is_disconnected=is_disconnected,
    )

    response = await runs.stream_run_events(uuid.uuid4(), object(), object(), request)
    iterator = response.body_iterator
    assert await iterator.__anext__() == ": keep-alive\n\n"
    await iterator.aclose()

    assert active.calls == [(1, None), (-1, None)]
    assert polls.calls == [(1, None)]
    assert disconnects.calls == []
