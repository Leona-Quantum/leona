"""Worker loop (AD-7): recover -> claim -> heartbeat -> dispatch -> finish.

Leases are fenced by a random token, so a worker that outlives its lease cannot
overwrite a replacement worker. Only explicitly classified transient failures
retry; unknown failures remain inspectable and fail closed. SIGTERM drains the
active job before Cloud Run scale-down.
"""

import asyncio
import contextlib
import datetime as dt
import logging
import math
import os
import signal
import socket
from typing import Any

from majorana_api.db import engine_from_env, session_factory
from majorana_api.observability import init_telemetry
from majorana_api.repos import system
from opentelemetry import metrics

from .errors import RetryableJobError
from .handlers import DEAD_LETTER_HANDLERS, HANDLERS

log = logging.getLogger("majorana_worker")

POLL_INTERVAL_S = float(os.environ.get("WORKER_POLL_INTERVAL_S", "2.0"))
if not math.isfinite(POLL_INTERVAL_S) or POLL_INTERVAL_S <= 0:
    raise ValueError(f"WORKER_POLL_INTERVAL_S must be a positive number: {POLL_INTERVAL_S}")
ERROR_BACKOFF_S = 10.0


def _positive_env(name: str, default: float) -> float:
    value = float(os.environ.get(name, str(default)))
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive number: {value}")
    return value


JOB_LEASE_S = _positive_env("WORKER_JOB_LEASE_S", 120.0)
JOB_HEARTBEAT_S = _positive_env("WORKER_JOB_HEARTBEAT_S", min(30.0, JOB_LEASE_S / 3))
if JOB_HEARTBEAT_S >= JOB_LEASE_S:
    raise ValueError("WORKER_JOB_HEARTBEAT_S must be less than WORKER_JOB_LEASE_S")
RETRY_BASE_S = _positive_env("WORKER_RETRY_BASE_S", 5.0)
RETRY_MAX_S = _positive_env("WORKER_RETRY_MAX_S", 300.0)
if RETRY_BASE_S > RETRY_MAX_S:
    raise ValueError("WORKER_RETRY_BASE_S must not exceed WORKER_RETRY_MAX_S")
DEAD_LETTER_TIMEOUT_S = _positive_env("WORKER_DEAD_LETTER_TIMEOUT_S", 30.0)

_meter = metrics.get_meter("majorana.worker.queue")
_job_claims = _meter.create_counter("majorana.jobs.claimed")
_job_requeues = _meter.create_counter("majorana.jobs.requeued")
_job_terminals = _meter.create_counter("majorana.jobs.terminal")
_job_lease_losses = _meter.create_counter("majorana.jobs.lease_lost")
_job_attempts = _meter.create_histogram("majorana.jobs.attempts")
_job_queue_age = _meter.create_histogram("majorana.jobs.queue_age_seconds")


async def _heartbeat_loop(factory, *, job_id: Any, lease_token, stop: asyncio.Event) -> None:
    """Renew ownership and stop the handler before a locally known lease expiry."""
    loop = asyncio.get_running_loop()
    local_deadline = loop.time() + JOB_LEASE_S
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=JOB_HEARTBEAT_S)
            return
        except TimeoutError:
            pass
        try:
            # Bound the renewal I/O by the time actually available inside the
            # lease, keeping the same one-heartbeat safety margin the failure
            # path below uses. A *hanging* session/heartbeat/commit would
            # otherwise never return, the deadline check would never run, and
            # the handler would keep executing after another worker claimed
            # the expired job. A zero/negative budget expires immediately and
            # lands in the same fail-closed branch.
            io_budget = max(
                0.0, min(JOB_HEARTBEAT_S, local_deadline - loop.time() - JOB_HEARTBEAT_S)
            )
            async with asyncio.timeout(io_budget):
                async with factory() as session:
                    renewed = await system.heartbeat_job(
                        session,
                        job_id=job_id,
                        lease_token=lease_token,
                        lease_seconds=JOB_LEASE_S,
                    )
                    await session.commit()
        except Exception as exc:
            # A short database outage may recover within the existing lease. Do
            # not keep executing once the locally known expiry is too close.
            if loop.time() + JOB_HEARTBEAT_S >= local_deadline:
                raise system.JobLeaseLostError(
                    f"heartbeat unavailable before lease expiry for job {job_id}"
                ) from exc
            log.exception("job %s heartbeat failed; retrying within current lease", job_id)
            continue
        if not renewed:
            raise system.JobLeaseLostError(f"job {job_id} no longer owns its lease")
        local_deadline = loop.time() + JOB_LEASE_S


async def _execute_with_heartbeat(
    factory,
    *,
    job_id: Any,
    lease_token,
    handler,
    payload: dict[str, Any],
) -> None:
    """Run one handler while a separate DB session maintains its fenced lease."""
    stop = asyncio.Event()

    async def execute() -> None:
        async with factory() as session:
            await handler(session, payload)

    handler_task = asyncio.create_task(execute())
    heartbeat_task = asyncio.create_task(
        _heartbeat_loop(factory, job_id=job_id, lease_token=lease_token, stop=stop)
    )
    done, _ = await asyncio.wait(
        {handler_task, heartbeat_task}, return_when=asyncio.FIRST_COMPLETED
    )
    if heartbeat_task in done:
        heartbeat_error = heartbeat_task.exception()
        if heartbeat_error is not None:
            handler_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await handler_task
            raise heartbeat_error

    stop.set()
    try:
        await heartbeat_task
    except Exception:
        if not handler_task.done():
            handler_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await handler_task
        raise
    await handler_task


async def _deliver_pending_dead_letters(factory) -> None:
    async with factory() as session:
        pending = await system.list_pending_dead_letters(session, limit=10)
    for job in pending:
        callback = DEAD_LETTER_HANDLERS.get(job.kind)
        error: str | None = None
        if callback is None:
            # Unknown kinds are intentionally terminal; there is no domain state
            # callback that can be invoked safely.
            error = None
        else:
            try:
                async with factory() as session:
                    async with asyncio.timeout(DEAD_LETTER_TIMEOUT_S):
                        await callback(
                            session,
                            job.payload,
                            job.last_error or f"job ended with status {job.status}",
                        )
            except Exception as exc:
                error = (str(exc) or type(exc).__name__)[:2000]
                log.exception("dead-letter callback failed for job %s", job.id)
        async with factory() as session:
            marked = await system.mark_job_dead_lettered(session, job_id=job.id, error=error)
            await session.commit()
        if marked and error is None:
            log.info("job %s dead-letter callback completed", job.id)


async def _start_liveness() -> asyncio.AbstractServer:
    """Static 200 responder on $PORT — the Cloud Run service model requires a
    listener (AD-7 runs the worker as a second service off the api image).
    This is a liveness probe target, NOT an API surface (worker AGENTS.md);
    bind failure raises at startup rather than running unhealthy."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read(1024)
        writer.write(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
        await writer.drain()
        writer.close()

    return await asyncio.start_server(handle, "0.0.0.0", int(os.environ["PORT"]))


async def run_forever() -> None:
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    engine = engine_from_env()
    factory = session_factory(engine)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    liveness = await _start_liveness() if os.environ.get("PORT") else None
    log.info("worker %s started (poll %.1fs)", worker_id, POLL_INTERVAL_S)

    try:
        while not stop.is_set():
            delay = POLL_INTERVAL_S
            try:
                async with factory() as session:
                    recovery = await system.recover_stale_jobs(session)
                    await session.commit()
                if recovery.requeued:
                    _job_requeues.add(recovery.requeued, {"reason": "lease_expired"})
                    log.warning("requeued %d jobs with expired leases", recovery.requeued)
                if recovery.dead_jobs:
                    _job_terminals.add(len(recovery.dead_jobs), {"status": "dead"})
                    log.error(
                        "dead-lettered %d jobs after lease exhaustion", len(recovery.dead_jobs)
                    )
                await _deliver_pending_dead_letters(factory)

                # Claim only after dead-letter callbacks complete. Otherwise the
                # new lease would be ticking before its heartbeat task starts.
                claimed: tuple[object, str, dict, object, int, float] | None = None
                async with factory() as session:
                    job = await system.claim_job(
                        session, worker_id=worker_id, lease_seconds=JOB_LEASE_S
                    )
                    if job is not None:
                        if job.lease_token is None:
                            raise RuntimeError(f"claimed job {job.id} has no lease token")
                        queue_age_seconds = (
                            max(
                                0.0,
                                (dt.datetime.now(dt.timezone.utc) - job.created_at).total_seconds(),
                            )
                            if job.created_at is not None
                            else 0.0
                        )
                        claimed = (
                            job.id,
                            job.kind,
                            job.payload,
                            job.lease_token,
                            int(job.attempts or 0),
                            queue_age_seconds,
                        )
                    await session.commit()  # claim visible before the handler starts
                if claimed is not None:
                    job_id, kind, payload, lease_token, attempts, queue_age_seconds = claimed
                    _job_claims.add(1, {"kind": kind})
                    _job_attempts.record(attempts, {"kind": kind})
                    _job_queue_age.record(queue_age_seconds, {"kind": kind})
                    handler = HANDLERS.get(kind)
                    if handler is None:
                        # Fail closed rather than retry-loop garbage.
                        async with factory() as session:
                            await system.finish_job(
                                session,
                                job_id=job_id,
                                lease_token=lease_token,
                                status="dead",
                                last_error=f"no handler registered for kind {kind!r}",
                                last_error_kind="unknown_kind",
                            )
                            await session.commit()
                        _job_terminals.add(1, {"status": "dead", "reason": "unknown_kind"})
                        log.error("job %s dead: no handler for kind %r", job_id, kind)
                    else:
                        try:
                            await _execute_with_heartbeat(
                                factory,
                                job_id=job_id,
                                lease_token=lease_token,
                                handler=handler,
                                payload=payload,
                            )
                            async with factory() as session:
                                await system.finish_job(
                                    session,
                                    job_id=job_id,
                                    lease_token=lease_token,
                                    status="done",
                                )
                                await session.commit()
                            _job_terminals.add(1, {"status": "done"})
                        except system.JobLeaseLostError:
                            # Never overwrite a replacement worker. The stale-job
                            # recovery path now owns the durable outcome.
                            _job_lease_losses.add(1, {"kind": kind})
                            log.exception("job %s (%s) lost its lease", job_id, kind)
                        except RetryableJobError as exc:
                            log.warning("job %s (%s) requested retry: %s", job_id, kind, exc)
                            async with factory() as session:
                                retry_status, retry_delay = await system.retry_job(
                                    session,
                                    job_id=job_id,
                                    lease_token=lease_token,
                                    last_error=str(exc),
                                    last_error_kind="retryable",
                                    base_delay_seconds=RETRY_BASE_S,
                                    max_delay_seconds=RETRY_MAX_S,
                                )
                                await session.commit()
                            if retry_status == "queued":
                                _job_requeues.add(1, {"reason": "retryable_failure"})
                                log.info("job %s retry scheduled in %.1fs", job_id, retry_delay)
                            else:
                                _job_terminals.add(
                                    1, {"status": "dead", "reason": "retry_exhausted"}
                                )
                        except Exception as exc:
                            log.exception("job %s (%s) failed", job_id, kind)
                            try:
                                async with factory() as session:
                                    await system.finish_job(
                                        session,
                                        job_id=job_id,
                                        lease_token=lease_token,
                                        status="failed",
                                        last_error=str(exc),
                                        last_error_kind="permanent",
                                    )
                                    await session.commit()
                                _job_terminals.add(1, {"status": "failed", "reason": "permanent"})
                            except system.JobLeaseLostError:
                                _job_lease_losses.add(1, {"kind": kind})
                                log.exception(
                                    "job %s failed after its lease was reassigned", job_id
                                )
                    continue  # drain the queue before sleeping again
            except Exception:
                # Transient DB failure: log, back off, keep the worker alive.
                log.exception("poll cycle failed; backing off %.0fs", ERROR_BACKOFF_S)
                delay = ERROR_BACKOFF_S
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except TimeoutError:
                pass
    finally:
        if liveness is not None:
            liveness.close()
            await liveness.wait_closed()
        await engine.dispose()
        log.info("worker %s drained and stopped", worker_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    init_telemetry("majorana-worker")
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
