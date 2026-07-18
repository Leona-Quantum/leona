import asyncio
import uuid
from types import SimpleNamespace

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


async def test_dead_letters_are_delivered_one_per_poll_cycle(monkeypatch):
    observed = {}

    async def claim_pending_dead_letter(_session, *, worker_id, lease_seconds):
        observed.update(worker_id=worker_id, lease_seconds=lease_seconds)
        return None

    monkeypatch.setattr(system, "claim_pending_dead_letter", claim_pending_dead_letter)
    await worker_main._deliver_pending_dead_letters(_factory, worker_id="worker-a")
    assert observed["worker_id"] == "worker-a"
    assert observed["lease_seconds"] > worker_main.DEAD_LETTER_TIMEOUT_S


async def test_dead_letter_reservation_commits_before_callback(monkeypatch):
    events = []
    token = uuid.uuid4()
    job = SimpleNamespace(
        id=uuid.uuid4(),
        kind="test.dead-letter",
        payload={"run_id": str(uuid.uuid4())},
        status="dead",
        last_error="failed",
        dead_letter_attempts=0,
        dead_letter_lease_token=token,
    )

    class Session:
        async def commit(self):
            events.append("commit")

    class Context:
        async def __aenter__(self):
            return Session()

        async def __aexit__(self, *_args):
            return None

    def factory():
        return Context()

    async def claim(_session, *, worker_id, lease_seconds):
        events.append("claim")
        return job

    async def callback(_session, _payload, _error):
        events.append("callback")

    async def mark(_session, *, job_id, delivery_token, error):
        assert job_id == job.id
        assert delivery_token == token
        events.append("mark")
        return True

    monkeypatch.setattr(system, "claim_pending_dead_letter", claim)
    monkeypatch.setattr(system, "mark_job_dead_lettered", mark)
    monkeypatch.setitem(worker_main.DEAD_LETTER_HANDLERS, job.kind, callback)

    await worker_main._deliver_pending_dead_letters(factory, worker_id="worker-a")

    assert events == ["claim", "commit", "callback", "mark", "commit"]


async def test_handler_is_cancelled_when_heartbeat_io_hangs(monkeypatch):
    """A hanging (not failing) heartbeat write must still fail closed: if the
    renewal I/O never returns, the deadline check never runs, and the handler
    would keep executing after another worker claimed the expired job."""
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def hanging_heartbeat_job(*_args, **_kwargs):
        await asyncio.Event().wait()  # never returns, never raises

    async def handler(_session, _payload):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(system, "heartbeat_job", hanging_heartbeat_job)
    monkeypatch.setattr(worker_main, "JOB_HEARTBEAT_S", 0.01)
    monkeypatch.setattr(worker_main, "JOB_LEASE_S", 0.1)

    with pytest.raises(system.JobLeaseLostError):
        # Bounded from the outside so a regression hangs the test visibly
        # instead of hanging the suite.
        await asyncio.wait_for(
            worker_main._execute_with_heartbeat(
                _factory,
                job_id="job",
                lease_token="lease",
                handler=handler,
                payload={},
            ),
            timeout=2.0,
        )

    assert started.is_set()
    assert cancelled.is_set()


async def test_handler_is_cancelled_when_fenced_lease_is_lost(monkeypatch):
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def heartbeat_job(*_args, **_kwargs):
        return False

    async def handler(_session, _payload):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(system, "heartbeat_job", heartbeat_job)
    monkeypatch.setattr(worker_main, "JOB_HEARTBEAT_S", 0.01)
    monkeypatch.setattr(worker_main, "JOB_LEASE_S", 0.1)

    with pytest.raises(system.JobLeaseLostError):
        await worker_main._execute_with_heartbeat(
            _factory,
            job_id="job",
            lease_token="lease",
            handler=handler,
            payload={},
        )

    assert started.is_set()
    assert cancelled.is_set()
