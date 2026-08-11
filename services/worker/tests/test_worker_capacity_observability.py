import pytest

from majorana_api.repos import system
from majorana_worker import __main__ as worker_main


class _RecordingInstrument:
    def __init__(self) -> None:
        self.calls: list[tuple[object, object | None]] = []

    def add(self, value, attributes=None) -> None:
        self.calls.append((value, attributes))

    def record(self, value, attributes=None) -> None:
        self.calls.append((value, attributes))


class _Session:
    pass


class _Factory:
    def __init__(self) -> None:
        self.session = _Session()

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *_args):
        return None


@pytest.mark.asyncio
async def test_queue_depth_records_ready_count_without_job_attributes(monkeypatch):
    queue_depth = _RecordingInstrument()
    monkeypatch.setattr(worker_main, "_job_queue_depth", queue_depth)
    factory = _Factory()

    async def count_runnable_jobs(session):
        assert session is factory.session
        return 7

    monkeypatch.setattr(system, "count_runnable_jobs", count_runnable_jobs)

    assert await worker_main._record_queue_depth(factory) == 7
    assert queue_depth.calls == [(7, None)]


@pytest.mark.asyncio
async def test_queue_depth_query_failure_is_best_effort_and_emits_no_metric(monkeypatch):
    queue_depth = _RecordingInstrument()
    monkeypatch.setattr(worker_main, "_job_queue_depth", queue_depth)

    async def count_runnable_jobs(_session):
        raise RuntimeError("prompt and token must not become metric data")

    monkeypatch.setattr(system, "count_runnable_jobs", count_runnable_jobs)

    assert await worker_main._record_queue_depth(_Factory()) is None
    assert queue_depth.calls == []


def test_in_flight_metric_balances_normal_and_exceptional_paths(monkeypatch):
    in_flight = _RecordingInstrument()
    monkeypatch.setattr(worker_main, "_jobs_in_flight", in_flight)

    with worker_main._track_in_flight_job():
        pass
    with pytest.raises(ValueError, match="stop"):
        with worker_main._track_in_flight_job():
            raise ValueError("stop")

    assert in_flight.calls == [(1, None), (-1, None), (1, None), (-1, None)]


@pytest.mark.asyncio
async def test_count_runnable_jobs_returns_only_the_scalar_result():
    class _Result:
        def scalar_one(self):
            return 11

    class _CountingSession:
        statement = None

        async def execute(self, statement):
            self.statement = statement
            return _Result()

    session = _CountingSession()
    assert await system.count_runnable_jobs(session) == 11
    assert "jobs" in str(session.statement)
