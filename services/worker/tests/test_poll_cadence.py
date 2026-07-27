"""DB-free checks for the poll loop's sweep cadence.

The worker's cost is round trips, not query time. An idle 2s cycle used to open
three transactions — lease recovery, the claim, dead-letter delivery — and two
of those found nothing on essentially every cycle. Over the 17.7 days to
2026-07-27 that was 2,334,042 committed transactions and 5.03 GB of egress
against a 47 MB database, almost entirely from an idle queue.

What must not regress in the other direction: a sweep that finds work has to run
again on the next cycle, or a backlog drains one item per interval instead of at
poll speed.
"""

import asyncio
import contextlib

import pytest
from majorana_api.repos import system

from majorana_worker import __main__ as worker_main


def test_the_first_sweep_is_due_so_a_restart_sweeps_promptly():
    sweep = worker_main.Sweep(30.0)

    assert sweep.due(0.0)
    assert sweep.due(1_000_000.0)


def test_an_empty_sweep_waits_its_whole_interval():
    sweep = worker_main.Sweep(30.0)
    sweep.done(100.0, productive=False)

    assert not sweep.due(100.0)
    assert not sweep.due(129.9)
    assert sweep.due(130.0)
    assert sweep.due(200.0)


def test_a_productive_sweep_is_due_again_immediately():
    """A backlog drains at poll speed, not one item per interval."""
    sweep = worker_main.Sweep(30.0)
    sweep.done(100.0, productive=True)

    assert sweep.due(100.0)


def test_the_gate_is_wall_clock_not_cycle_count():
    """A busy queue skips the sleep entirely; counting cycles would put the
    sweep back between every pair of jobs, which is what it exists to avoid."""
    sweep = worker_main.Sweep(30.0)
    sweep.done(100.0, productive=False)

    for _ in range(1000):  # 1000 no-sleep drain iterations at the same instant
        assert not sweep.due(100.0)


def test_lease_recovery_cannot_be_configured_slower_than_the_lease():
    """Recovery that runs less often than leases expire would let a job whose
    worker died sit past its own lease before anything requeued it."""
    assert worker_main.RECOVER_INTERVAL_S <= worker_main.JOB_LEASE_S


@pytest.mark.parametrize(
    ("interval", "elapsed", "expected"),
    [
        (15.0, 14.999, False),
        (15.0, 15.0, True),
        (60.0, 59.0, False),
        (60.0, 61.0, True),
    ],
)
def test_the_interval_boundary_is_inclusive(interval, elapsed, expected):
    sweep = worker_main.Sweep(interval)
    sweep.done(1000.0, productive=False)

    assert sweep.due(1000.0 + elapsed) is expected


class _CountingSession:
    """Stands in for an AsyncSession. Every instance is one round trip."""

    def __init__(self, opened: list) -> None:
        opened.append(self)

    async def commit(self):
        return None


class _CountingFactory:
    def __init__(self) -> None:
        self.opened: list = []

    def __call__(self):
        return self

    async def __aenter__(self):
        return _CountingSession(self.opened)

    async def __aexit__(self, *_args):
        return None


class _Engine:
    async def dispose(self):
        return None


async def _run_idle_cycles(monkeypatch, *, cycles: int) -> _CountingFactory:
    """Drive the real poll loop over an idle queue and count sessions opened."""
    factory = _CountingFactory()
    reached = asyncio.Event()
    seen = 0

    async def claim_job(_session, **_kwargs):
        nonlocal seen
        seen += 1
        if seen >= cycles:
            reached.set()
        return None

    async def recover_stale_jobs(_session):
        return system.StaleJobRecovery(requeued=0, dead_jobs=())

    async def claim_pending_dead_letter(_session, **_kwargs):
        return None

    async def list_orphaned_runs(_session, **_kwargs):
        return ()

    async def preflight():
        return None

    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.setattr(worker_main, "engine_from_env", lambda: _Engine())
    monkeypatch.setattr(worker_main, "session_factory", lambda _engine: factory)
    monkeypatch.setattr(worker_main, "_preflight_models", preflight)
    monkeypatch.setattr(worker_main, "POLL_INTERVAL_S", 0.0005)
    monkeypatch.setattr(system, "claim_job", claim_job)
    monkeypatch.setattr(system, "recover_stale_jobs", recover_stale_jobs)
    monkeypatch.setattr(system, "claim_pending_dead_letter", claim_pending_dead_letter)
    monkeypatch.setattr(system, "list_orphaned_runs", list_orphaned_runs)

    task = asyncio.create_task(worker_main.run_forever())
    try:
        await asyncio.wait_for(reached.wait(), timeout=20)
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    return factory


async def test_an_idle_cycle_opens_one_session_not_three(monkeypatch):
    """The regression this change exists to prevent.

    Every sweep runs once on the first cycle, so 100 idle cycles cost 100 claims
    plus one recovery, one dead-letter check and one reap — not 300. The poll
    interval here is sub-millisecond, so no wall-clock gate can reopen.
    """
    factory = await _run_idle_cycles(monkeypatch, cycles=100)

    # 100 claims + 3 first-cycle sweeps, with headroom for the cycle in flight
    # when the event fired.
    assert len(factory.opened) < 130, (
        f"{len(factory.opened)} sessions for ~100 idle cycles: a sweep is back on the hot path"
    )
    assert len(factory.opened) >= 100, "the claim must still run on every cycle"
