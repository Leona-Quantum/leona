import asyncio

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
