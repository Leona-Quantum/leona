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


class _CommittingSession:
    async def commit(self) -> None:
        return None


class _CommittingFactory:
    def __call__(self):
        return self

    async def __aenter__(self):
        return _CommittingSession()

    async def __aexit__(self, *_args):
        return None


async def _lease_lost(*_args, **_kwargs):
    raise system.JobLeaseLostError("replaced")


def _claimed(kind: str):
    return ("job-1", kind, {}, "lease-1", 1, 0.0)


@pytest.mark.asyncio
async def test_lease_loss_while_dead_lettering_unknown_kind_is_counted_not_raised(monkeypatch):
    """The unknown-kind path writes a terminal row and can lose its lease doing it.

    Before this was handled the error escaped _process_claimed_job into the
    generic poll backoff, so the worker took an unrelated penalty and
    majorana.jobs.lease_lost never moved.
    """
    losses = _RecordingInstrument()
    terminals = _RecordingInstrument()
    monkeypatch.setattr(worker_main, "_job_lease_losses", losses)
    monkeypatch.setattr(worker_main, "_job_terminals", terminals)
    monkeypatch.setattr(worker_main, "HANDLERS", {})
    monkeypatch.setattr(system, "finish_job", _lease_lost)

    await worker_main._process_claimed_job(_CommittingFactory(), _claimed("no-such-kind"))

    assert losses.calls == [(1, {"kind": "no-such-kind"})]
    assert terminals.calls == []


@pytest.mark.asyncio
async def test_lease_loss_while_retrying_is_counted_not_raised(monkeypatch):
    """retry_job raises from INSIDE `except RetryableJobError`.

    The sibling `except system.JobLeaseLostError` is already out of scope at
    that point, so this path needs its own handler; the sibling cannot catch it.
    """
    losses = _RecordingInstrument()
    requeues = _RecordingInstrument()
    monkeypatch.setattr(worker_main, "_job_lease_losses", losses)
    monkeypatch.setattr(worker_main, "_job_requeues", requeues)

    async def handler(*_args, **_kwargs):
        raise worker_main.RetryableJobError("transient")

    monkeypatch.setattr(worker_main, "HANDLERS", {"demo": handler})
    monkeypatch.setattr(system, "retry_job", _lease_lost)

    async def execute(_factory, *, job_id, lease_token, handler, payload):
        raise worker_main.RetryableJobError("transient")

    monkeypatch.setattr(worker_main, "_execute_with_heartbeat", execute)

    await worker_main._process_claimed_job(_CommittingFactory(), _claimed("demo"))

    assert losses.calls == [(1, {"kind": "demo"})]
    assert requeues.calls == []


@pytest.mark.asyncio
async def test_slow_queue_depth_sample_is_dropped_and_counted(monkeypatch):
    """A bounded sample that goes silent under load is indistinguishable from an
    empty queue unless the drop is itself counted."""
    import asyncio

    depth = _RecordingInstrument()
    timeouts = _RecordingInstrument()
    monkeypatch.setattr(worker_main, "_job_queue_depth", depth)
    monkeypatch.setattr(worker_main, "_job_queue_depth_timeouts", timeouts)
    monkeypatch.setattr(worker_main, "QUEUE_METRICS_TIMEOUT_S", 0.01)

    async def slow(_session):
        await asyncio.sleep(5)
        return 7

    monkeypatch.setattr(system, "count_runnable_jobs", slow)

    assert await worker_main._record_queue_depth(_Factory()) is None
    assert depth.calls == []
    assert timeouts.calls == [(1, None)]
