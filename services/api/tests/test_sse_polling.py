"""Focused checks for the SSE poll/query boundary."""

import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import RunStatus
from repo_test_helpers import compiled, make_scope

from majorana_api.repos import NotFoundError
from majorana_api.repos import runs as runs_repo
from majorana_api.routes import runs as run_routes


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return self._rows


class _Session:
    def __init__(self, result):
        self.result = result
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.result


class _PollContext:
    def __init__(self, trace):
        self.trace = trace

    async def __aenter__(self):
        self.trace.append("poll_open")
        return object()

    async def __aexit__(self, *_exc_info):
        self.trace.append("poll_close")


class _SessionFactory:
    def __init__(self, trace):
        self.trace = trace

    def __call__(self):
        return _PollContext(self.trace)


class _Request:
    def __init__(self, factory, *, disconnected=False):
        self.app = SimpleNamespace(state=SimpleNamespace(session_factory=factory))
        self.disconnected = disconnected
        self.disconnect_checks = 0

    async def is_disconnected(self):
        self.disconnect_checks += 1
        return self.disconnected


def _event(run_id: uuid.UUID, seq: int, event_type: str):
    return SimpleNamespace(
        run_id=run_id,
        seq=seq,
        ts=None,
        type=event_type,
        payload={"status": "succeeded"},
    )


async def _body(response) -> str:
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


async def test_event_status_read_is_one_scoped_query(scope):
    run_id = uuid.uuid4()
    first = _event(run_id, 4, "run.analysis")
    second = _event(run_id, 5, "run.finished")
    session = _Session(
        _Result(
            [
                (RunStatus.RUNNING.value, first),
                (RunStatus.RUNNING.value, second),
            ]
        )
    )

    events, status = await runs_repo.list_run_events_with_status(
        scope, session, run_id, after_seq=3
    )

    assert events == [first, second]
    assert status == RunStatus.RUNNING.value
    assert len(session.statements) == 1
    sql, _params = compiled(session.statements[0])
    assert "LEFT OUTER JOIN run_events" in sql
    assert "runs.workspace_id" in sql
    assert "run_events.seq >" in sql


async def test_event_status_read_reports_a_missing_run(scope):
    session = _Session(_Result([]))

    with pytest.raises(NotFoundError, match="run"):
        await runs_repo.list_run_events_with_status(scope, session, uuid.uuid4())

    assert len(session.statements) == 1


async def test_stream_uses_last_event_id_and_closes_on_finished(monkeypatch):
    run_id = uuid.uuid4()
    scope = make_scope()
    after_values = []
    get_run_calls = []

    async def get_run(_scope, _session, requested_id):
        get_run_calls.append(requested_id)
        return SimpleNamespace(status=RunStatus.RUNNING.value)

    async def read_events(_scope, _session, requested_id, *, after_seq):
        assert requested_id == run_id
        after_values.append(after_seq)
        return [_event(run_id, 8, "run.finished")], RunStatus.RUNNING.value

    monkeypatch.setattr(run_routes.runs_repo, "get_run", get_run)
    monkeypatch.setattr(
        run_routes.runs_repo,
        "list_run_events_with_status",
        read_events,
    )
    trace = []
    request = _Request(_SessionFactory(trace))

    response = await run_routes.stream_run_events(
        run_id,
        scope,
        object(),
        request,
        after=2,
        last_event_id="7",
    )
    body = await _body(response)

    assert after_values == [7]
    assert get_run_calls == [run_id]
    assert "id: 8\nevent: run.finished\n" in body
    assert trace == ["poll_open", "poll_close"]


async def test_stream_closes_terminal_run_without_second_status_query(monkeypatch):
    run_id = uuid.uuid4()
    scope = make_scope()
    get_run_calls = []
    read_calls = []

    async def get_run(_scope, _session, requested_id):
        get_run_calls.append(requested_id)
        return SimpleNamespace(status=RunStatus.RUNNING.value)

    async def read_events(_scope, _session, requested_id, *, after_seq):
        read_calls.append((requested_id, after_seq))
        return [], RunStatus.FAILED.value

    monkeypatch.setattr(run_routes.runs_repo, "get_run", get_run)
    monkeypatch.setattr(
        run_routes.runs_repo,
        "list_run_events_with_status",
        read_events,
    )
    trace = []
    response = await run_routes.stream_run_events(
        run_id,
        scope,
        object(),
        _Request(_SessionFactory(trace)),
    )
    body = await _body(response)

    assert read_calls == [(run_id, 0)]
    assert get_run_calls == [run_id]
    assert ": run terminal without run.finished; closing" in body
    assert trace == ["poll_open", "poll_close"]


async def test_stream_stops_before_polling_when_disconnected(monkeypatch):
    run_id = uuid.uuid4()
    scope = make_scope()
    read_called = False

    async def get_run(_scope, _session, _requested_id):
        return SimpleNamespace(status=RunStatus.RUNNING.value)

    async def read_events(*_args, **_kwargs):
        nonlocal read_called
        read_called = True
        return [], RunStatus.RUNNING.value

    monkeypatch.setattr(run_routes.runs_repo, "get_run", get_run)
    monkeypatch.setattr(
        run_routes.runs_repo,
        "list_run_events_with_status",
        read_events,
    )
    request = _Request(_SessionFactory([]), disconnected=True)

    response = await run_routes.stream_run_events(run_id, scope, object(), request)

    assert await _body(response) == ""
    assert request.disconnect_checks == 1
    assert read_called is False
