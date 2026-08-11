"""Run a bounded, provider-free benchmark through the real Worker loop.

The harness replaces only the repository and handler boundaries with an
in-memory queue and a deterministic no-op/delay handler.  The production
``majorana_worker.run_forever`` control flow still performs the claim,
transaction commit, handler dispatch, heartbeat supervision, and terminal
finish sequence.  No database engine, provider preflight, sandbox, or network
client is constructed by this module.

The command prints one JSON result and exits non-zero if the bounded batch does
not complete exactly once:

    uv run --package majorana-worker python bench/worker/queue_throughput.py
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import datetime as dt
import json
import math
import os
import time
from collections import deque
from dataclasses import dataclass
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from majorana_api.repos import system
from majorana_worker import __main__ as worker_main

BENCHMARK_JOB_KIND = "bench.worker.noop"
_BENCHMARK_NAMESPACE = uuid5(NAMESPACE_URL, "https://majorana.invalid/worker-queue")
_MAX_JOBS = 1_000
_MAX_WORKERS = 20
_MAX_HANDLER_DELAY_MS = 1_000.0
_MAX_TIMEOUT_S = 300.0


class BenchmarkError(RuntimeError):
    """The bounded benchmark could not establish its completion invariants."""


@dataclass(frozen=True, slots=True)
class BenchmarkConfig:
    """Explicit bounds for one local benchmark run."""

    jobs: int = 100
    workers: int = 1
    handler_delay_ms: float = 0.0
    timeout_s: float = 30.0

    def __post_init__(self) -> None:
        if not 1 <= self.jobs <= _MAX_JOBS:
            raise ValueError(f"jobs must be between 1 and {_MAX_JOBS}")
        if not 1 <= self.workers <= _MAX_WORKERS:
            raise ValueError(f"workers must be between 1 and {_MAX_WORKERS}")
        if not 0 <= self.handler_delay_ms <= _MAX_HANDLER_DELAY_MS:
            raise ValueError(f"handler_delay_ms must be between 0 and {_MAX_HANDLER_DELAY_MS}")
        if not math.isfinite(self.handler_delay_ms):
            raise ValueError("handler_delay_ms must be finite")
        if not 0 < self.timeout_s <= _MAX_TIMEOUT_S:
            raise ValueError(f"timeout_s must be between 0 and {_MAX_TIMEOUT_S}")
        if not math.isfinite(self.timeout_s):
            raise ValueError("timeout_s must be finite")


@dataclass(slots=True)
class _BenchmarkJob:
    """The small subset of the ORM Job shape used by the real Worker loop."""

    index: int
    id: UUID
    kind: str
    payload: dict[str, Any]
    created_at: dt.datetime
    status: str = "queued"
    attempts: int = 0
    max_attempts: int = 3
    lease_token: UUID | None = None


class _InMemoryQueue:
    """Deterministic stand-in for the repository's leased queue boundary."""

    def __init__(self, jobs: list[_BenchmarkJob]) -> None:
        self._queued = deque(jobs)
        self._jobs = {job.id: job for job in jobs}
        self._lock = asyncio.Lock()
        self.finished = asyncio.Event()
        self.completed_at: float | None = None
        self.first_claim_at: float | None = None
        self.claim_calls = 0
        self.claimed_ids: list[UUID] = []
        self.finish_calls = 0
        self.finished_ids: list[UUID] = []
        self.heartbeat_calls = 0
        self.session_open_count = 0
        self.commit_count = 0
        self.max_queue_depth = len(jobs)

    @property
    def remaining_depth(self) -> int:
        return len(self._queued)

    async def claim(
        self, _session, *, worker_id: str, lease_seconds: float
    ) -> _BenchmarkJob | None:
        del worker_id, lease_seconds
        async with self._lock:
            self.claim_calls += 1
            if not self._queued:
                return None
            job = self._queued.popleft()
            if job.status != "queued":
                raise BenchmarkError(f"job {job.index} was claimed in state {job.status!r}")
            job.status = "running"
            job.attempts += 1
            job.lease_token = uuid5(_BENCHMARK_NAMESPACE, f"lease:{job.index}:{job.attempts}")
            self.claimed_ids.append(job.id)
            if self.first_claim_at is None:
                self.first_claim_at = time.perf_counter()
            return job

    async def heartbeat(
        self,
        _session,
        *,
        job_id: UUID,
        lease_token: UUID,
        lease_seconds: float,
    ) -> bool:
        del lease_seconds
        async with self._lock:
            self.heartbeat_calls += 1
            job = self._jobs[job_id]
            return job.status == "running" and job.lease_token == lease_token

    async def finish(
        self,
        _session,
        *,
        job_id: UUID,
        lease_token: UUID,
        status: str,
        **_kwargs: Any,
    ) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            if job.status != "running" or job.lease_token != lease_token:
                raise BenchmarkError(f"job {job.index} lost its in-memory lease")
            if status != "done":
                raise BenchmarkError(f"benchmark job {job.index} finished as {status!r}")
            job.status = status
            self.finish_calls += 1
            self.finished_ids.append(job_id)
            if len(self.finished_ids) == len(self._jobs):
                self.completed_at = time.perf_counter()
                self.finished.set()

    def assert_complete(self) -> None:
        if len(self.finished_ids) != len(self._jobs):
            raise BenchmarkError(
                f"completed {len(self.finished_ids)} of {len(self._jobs)} benchmark jobs"
            )
        if len(set(self.claimed_ids)) != len(self.claimed_ids):
            raise BenchmarkError("a benchmark job was claimed more than once")
        if self.remaining_depth != 0:
            raise BenchmarkError(f"{self.remaining_depth} benchmark jobs remained queued")
        for job in self._jobs.values():
            if job.status != "done" or job.attempts != 1:
                raise BenchmarkError(
                    f"job {job.index} ended as status={job.status!r}, attempts={job.attempts}"
                )


class _Session:
    def __init__(self, queue: _InMemoryQueue) -> None:
        self._queue = queue

    async def commit(self) -> None:
        self._queue.commit_count += 1


class _SessionContext:
    def __init__(self, queue: _InMemoryQueue) -> None:
        self._queue = queue

    async def __aenter__(self) -> _Session:
        self._queue.session_open_count += 1
        return _Session(self._queue)

    async def __aexit__(self, *_args: Any) -> None:
        return None


class _SessionFactory:
    def __init__(self, queue: _InMemoryQueue) -> None:
        self._queue = queue

    def __call__(self) -> _SessionContext:
        return _SessionContext(self._queue)


class _Engine:
    async def dispose(self) -> None:
        return None


class _DeterministicHandler:
    def __init__(self, delay_s: float) -> None:
        self._delay_s = delay_s
        self.calls = 0
        self.active = 0
        self.max_active = 0

    async def __call__(self, _session: _Session, payload: dict[str, Any]) -> None:
        if payload.get("job_kind") != BENCHMARK_JOB_KIND:
            raise BenchmarkError("benchmark handler received an unexpected job payload")
        self.calls += 1
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self._delay_s:
                await asyncio.sleep(self._delay_s)
        finally:
            self.active -= 1


@contextlib.contextmanager
def _patched_worker(queue: _InMemoryQueue, handler: _DeterministicHandler):
    """Patch only boundaries that would otherwise reach DB/provider code."""

    async def recover_stale_jobs(_session):
        return system.StaleJobRecovery(requeued=0, dead_jobs=())

    async def count_runnable_jobs(_session) -> int:
        return queue.remaining_depth

    async def claim_pending_dead_letter(_session, *, worker_id: str, lease_seconds: float):
        del worker_id, lease_seconds
        return None

    async def list_orphaned_runs(_session):
        return ()

    async def no_provider_preflight() -> None:
        return None

    session_factory = _SessionFactory(queue)
    saved = {
        "engine_from_env": worker_main.engine_from_env,
        "session_factory": worker_main.session_factory,
        "preflight": worker_main._preflight_models,
        "handlers": worker_main.HANDLERS,
        "poll_interval": worker_main.POLL_INTERVAL_S,
        "error_backoff": worker_main.ERROR_BACKOFF_S,
        "claim_job": system.claim_job,
        "heartbeat_job": system.heartbeat_job,
        "finish_job": system.finish_job,
        "recover_stale_jobs": system.recover_stale_jobs,
        "claim_pending_dead_letter": system.claim_pending_dead_letter,
        "list_orphaned_runs": system.list_orphaned_runs,
        "count_runnable_jobs": system.count_runnable_jobs,
    }
    previous_port = os.environ.pop("PORT", None)
    worker_main.engine_from_env = lambda: _Engine()
    worker_main.session_factory = lambda _engine: session_factory
    worker_main._preflight_models = no_provider_preflight
    worker_main.HANDLERS = {BENCHMARK_JOB_KIND: handler}
    worker_main.POLL_INTERVAL_S = 0.001
    worker_main.ERROR_BACKOFF_S = 0.001
    system.claim_job = queue.claim
    system.heartbeat_job = queue.heartbeat
    system.finish_job = queue.finish
    system.recover_stale_jobs = recover_stale_jobs
    system.claim_pending_dead_letter = claim_pending_dead_letter
    system.list_orphaned_runs = list_orphaned_runs
    # The worker samples queue depth for the capacity metric (#373).  That query
    # is best-effort and swallows its own errors, so leaving it unswapped does
    # not fail the run -- it just prints a traceback into a benchmark whose whole
    # output contract is one clean JSON record, and it would make
    # ``external_database_called`` a claim the harness no longer checks here.
    # The in-memory queue already knows its own depth, so answer from that.
    system.count_runnable_jobs = count_runnable_jobs
    try:
        yield
    finally:
        worker_main.engine_from_env = saved["engine_from_env"]
        worker_main.session_factory = saved["session_factory"]
        worker_main._preflight_models = saved["preflight"]
        worker_main.HANDLERS = saved["handlers"]
        worker_main.POLL_INTERVAL_S = saved["poll_interval"]
        worker_main.ERROR_BACKOFF_S = saved["error_backoff"]
        system.claim_job = saved["claim_job"]
        system.heartbeat_job = saved["heartbeat_job"]
        system.finish_job = saved["finish_job"]
        system.recover_stale_jobs = saved["recover_stale_jobs"]
        system.claim_pending_dead_letter = saved["claim_pending_dead_letter"]
        system.list_orphaned_runs = saved["list_orphaned_runs"]
        system.count_runnable_jobs = saved["count_runnable_jobs"]
        if previous_port is not None:
            os.environ["PORT"] = previous_port


def _make_jobs(count: int, created_at: dt.datetime) -> list[_BenchmarkJob]:
    return [
        _BenchmarkJob(
            index=index,
            id=uuid5(_BENCHMARK_NAMESPACE, f"job:{index}"),
            kind=BENCHMARK_JOB_KIND,
            payload={"job_index": index, "job_kind": BENCHMARK_JOB_KIND},
            created_at=created_at,
        )
        for index in range(count)
    ]


async def run_benchmark(config: BenchmarkConfig) -> dict[str, Any]:
    """Run one bounded batch through the production Worker loop."""

    started_at = time.perf_counter()
    created_at = dt.datetime.now(dt.timezone.utc)
    queue = _InMemoryQueue(_make_jobs(config.jobs, created_at))
    handler = _DeterministicHandler(config.handler_delay_ms / 1_000.0)
    workers: list[asyncio.Task[None]] = []
    completion_waiter = asyncio.create_task(queue.finished.wait())

    with _patched_worker(queue, handler):
        try:
            workers = [
                asyncio.create_task(worker_main.run_forever(), name=f"worker-benchmark-{index}")
                for index in range(config.workers)
            ]
            done, _pending = await asyncio.wait(
                [completion_waiter, *workers],
                timeout=config.timeout_s,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if completion_waiter not in done:
                failed = next(
                    (
                        task
                        for task in done
                        if task is not completion_waiter and not task.cancelled()
                    ),
                    None,
                )
                if failed is not None:
                    failed.result()
                raise BenchmarkError(
                    f"batch did not complete within {config.timeout_s:.3f}s "
                    f"({len(queue.finished_ids)}/{config.jobs} finished)"
                )
        finally:
            completion_waiter.cancel()
            for task in workers:
                task.cancel()
            await asyncio.gather(completion_waiter, *workers, return_exceptions=True)

    queue.assert_complete()
    if queue.completed_at is None:
        raise BenchmarkError("queue reported completion without a completion timestamp")
    if handler.calls != config.jobs:
        raise BenchmarkError(f"handler ran {handler.calls} times for {config.jobs} completed jobs")
    elapsed_s = queue.completed_at - started_at
    if elapsed_s <= 0:
        raise BenchmarkError(f"benchmark elapsed time was not positive: {elapsed_s}")

    return {
        "status": "passed",
        "jobs_requested": config.jobs,
        "jobs_completed": len(queue.finished_ids),
        "workers": config.workers,
        "handler_delay_ms": config.handler_delay_ms,
        "peak_queue_depth": queue.max_queue_depth,
        "remaining_queue_depth": queue.remaining_depth,
        "elapsed_seconds": round(elapsed_s, 6),
        "throughput_jobs_per_second": round(config.jobs / elapsed_s, 3),
        "first_claim_latency_seconds": round((queue.first_claim_at or started_at) - started_at, 6),
        "max_handler_concurrency": handler.max_active,
        "claim_calls": queue.claim_calls,
        "finish_calls": queue.finish_calls,
        "heartbeat_calls": queue.heartbeat_calls,
        "session_open_count": queue.session_open_count,
        "commit_count": queue.commit_count,
        "invariants": {
            "all_jobs_finished_once": True,
            "all_attempts_are_one": True,
            "provider_preflight_called": False,
            "external_database_called": False,
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--jobs", type=int, default=100, help="bounded jobs to drain (default: 100)"
    )
    parser.add_argument(
        "--workers", type=int, default=1, help="in-process Worker loops (default: 1)"
    )
    parser.add_argument(
        "--handler-delay-ms",
        type=float,
        default=0.0,
        help="deterministic local handler delay per job (default: 0)",
    )
    parser.add_argument(
        "--timeout-s",
        type=float,
        default=30.0,
        help="fail if the bounded batch exceeds this wall-clock limit (default: 30)",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        config = BenchmarkConfig(
            jobs=args.jobs,
            workers=args.workers,
            handler_delay_ms=args.handler_delay_ms,
            timeout_s=args.timeout_s,
        )
        result = asyncio.run(run_benchmark(config))
    except (BenchmarkError, ValueError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}), flush=True)
        return 1
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
