"""Worker loop (AD-7): recover -> claim -> heartbeat -> dispatch -> finish.

Leases are fenced by a random token, so a worker that outlives its lease cannot
overwrite a replacement worker. Only explicitly classified transient failures
retry; unknown failures remain inspectable and fail closed. SIGTERM drains the
active job before Cloud Run scale-down.
"""

import asyncio
import contextlib
import datetime as dt
import json
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
from .handlers import DEAD_LETTER_HANDLERS, HANDLERS, close_orphaned_run

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
# The reaper is a safety net for runs already stranded for a 15-minute grace
# period, so it has no reason to run on every poll cycle. It used to, including
# on the no-sleep iterations that drain a busy queue — an extra join +
# correlated subquery between every processed job and the next claim attempt,
# on the exact path the <100ms p95 claim-latency budget is measured on. A
# wall-clock interval keeps it off the hot path; nothing is reaped later than
# it otherwise would be in any way that matters at a 15-minute grace.
REAP_INTERVAL_S = _positive_env("WORKER_REAP_INTERVAL_S", 60.0)

# The same argument, applied to the two sweeps that were still running on every
# cycle. Both are recovery paths whose own timescales are measured in minutes:
# lease recovery cannot act before a JOB_LEASE_S (120s) lease has expired, and
# dead-letter delivery already retries ~30s apart. Running them every 2s bought
# no recovery a caller can perceive and cost two extra round trips per cycle.
#
# It was not free. Over the 17.7 days to 2026-07-27 the database logged
# 2,334,042 committed transactions and 5.03 GB of egress against a 47 MB
# database — 1.5 transactions/second, which is exactly three per 2s cycle, and
# almost exactly the free-tier transfer allowance. The queue was idle for
# essentially all of it: an idle worker, not a user, spent the quota.
#
# Claim latency is deliberately untouched. `claim_job` still runs every cycle;
# only the sweeps around it are gated.
#
# MEASURED, after the fact, A/B against a scratch database on the production
# instance — 120s of the real run_forever() each way, reading xact_commit:
#
#     ungated  2.175 transactions/s
#     gated    1.408 transactions/s     (1.55x, not the 3x the session counting
#                                        suggested)
#
# The gap is `pool_pre_ping=True` in db.py: every pool checkout issues its own
# statement, which Postgres commits as its own transaction. So a session costs
# two transactions, not one, and the claim — the session deliberately left on
# every cycle — is two of them. Dropping the pre-ping would roughly halve what
# is left, and it is NOT being dropped: it exists so a connection killed by a
# Cloud SQL maintenance restart is replaced transparently instead of failing one
# user's request, and since the move to a fixed-price instance a transaction
# costs nothing. Reliability over a cost that no longer exists.
RECOVER_INTERVAL_S = _positive_env("WORKER_RECOVER_INTERVAL_S", 30.0)
if RECOVER_INTERVAL_S > JOB_LEASE_S:
    raise ValueError("WORKER_RECOVER_INTERVAL_S must not exceed WORKER_JOB_LEASE_S")

DEAD_LETTER_TIMEOUT_S = _positive_env("WORKER_DEAD_LETTER_TIMEOUT_S", 30.0)
DEAD_LETTER_LEASE_S = _positive_env(
    "WORKER_DEAD_LETTER_LEASE_S", max(45.0, DEAD_LETTER_TIMEOUT_S + 15.0)
)
if DEAD_LETTER_LEASE_S <= DEAD_LETTER_TIMEOUT_S:
    raise ValueError("WORKER_DEAD_LETTER_LEASE_S must exceed WORKER_DEAD_LETTER_TIMEOUT_S")
DEAD_LETTER_INTERVAL_S = _positive_env("WORKER_DEAD_LETTER_INTERVAL_S", 15.0)


class Sweep:
    """A background query that must not run on every poll cycle.

    Two properties matter, and both are why this is a class rather than an
    inline `if now >= next_at`:

    * **The clock, not the cycle count.** A busy queue skips the sleep entirely
      (`continue` drains the queue), so counting cycles would put a sweep back
      between every pair of jobs — the hot path REAP_INTERVAL_S exists to keep
      it off.
    * **A productive sweep re-arms immediately.** Each of these sweeps handles
      one item per call. Gating a backlog behind the full interval would drain
      it at one item per interval; `due()` stays true while there is more to do,
      so a backlog drains at poll speed and only an *empty* sweep waits.

    The first call is always due, so a restarted worker sweeps promptly rather
    than ignoring a stranded job for its first interval.
    """

    __slots__ = ("_interval_s", "_next_at")

    def __init__(self, interval_s: float) -> None:
        self._interval_s = interval_s
        self._next_at = 0.0

    def due(self, now: float) -> bool:
        return now >= self._next_at

    def done(self, now: float, *, productive: bool) -> None:
        """Record that the sweep ran. `productive` means it found work."""
        self._next_at = now if productive else now + self._interval_s


_meter = metrics.get_meter("majorana.worker.queue")
_job_claims = _meter.create_counter("majorana.jobs.claimed")
_job_requeues = _meter.create_counter("majorana.jobs.requeued")
_job_terminals = _meter.create_counter("majorana.jobs.terminal")
_job_lease_losses = _meter.create_counter("majorana.jobs.lease_lost")
_job_attempts = _meter.create_histogram("majorana.jobs.attempts")
_job_queue_age = _meter.create_histogram("majorana.jobs.queue_age_seconds")
_runs_reaped = _meter.create_counter("majorana.runs.reaped")


def _structured_log(severity: str, message: str, **fields: Any) -> None:
    """Emit one Cloud Logging structured line.

    Cloud Run parses a single-line JSON object on stdout and honours its
    `severity` field. Plain `logging` output from this process lands at DEFAULT
    severity instead — checked against seven days of production logs, where the
    only entries above WARNING were multi-line tracebacks. That distinction is
    the whole point here: the deploy workflow's post-deploy gate filters on
    `severity>=ERROR`, so an alarm raised through `log.error` would be invisible
    to the very check that is supposed to fail the deploy.
    """
    print(json.dumps({"severity": severity, "message": message, **fields}), flush=True)


async def _preflight_models() -> None:
    """Ask the provider whether it serves the models this worker would send.

    Runs once at startup, off the poll loop, and never blocks job processing or
    startup. A definitive mismatch is loud, because the deploy gate reads it;
    anything unproven is a quiet INFO, because a preflight that fires on a
    network blip is a preflight somebody disables.

    This is the check whose absence let a stale MAJORANA_MODEL_* override on the
    live service take down every execute run for days behind a green deploy
    (2026-07-26) — chat had no override, so the product still looked half-alive.
    """
    try:
        from majorana_llm.preflight import check_with_timeout

        report = await check_with_timeout()
    except asyncio.CancelledError:
        raise
    except Exception:
        log.warning("model preflight did not complete", exc_info=True)
        return
    if report.unsupported:
        named = ", ".join(f"{role.role}={role.model}" for role in report.unsupported)
        _structured_log(
            "ERROR",
            f"configured models are not served by {report.provider}: {named}. "
            "Every run reaching these stages will fail. Compare the "
            "MAJORANA_MODEL_* overrides on this service against the defaults in "
            "majorana_llm.models.",
            **report.as_log_payload(),
        )
    elif report.proven:
        log.info("model preflight ok: %s", report.as_log_payload()["checked"])
    else:
        log.info("model preflight inconclusive: no provider model list available")


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


async def _deliver_pending_dead_letters(factory, *, worker_id: str) -> bool:
    """Deliver at most one pending dead letter. True when one was claimed.

    The return value is what re-arms the sweep: a backlog must drain at poll
    speed rather than one item per DEAD_LETTER_INTERVAL_S.
    """
    async with factory() as session:
        job = await system.claim_pending_dead_letter(
            session,
            worker_id=worker_id,
            lease_seconds=DEAD_LETTER_LEASE_S,
        )
        await session.commit()  # reservation is durable before callback I/O
    if job is None:
        return False
    delivery_token = job.dead_letter_lease_token
    if delivery_token is None:
        raise RuntimeError(f"claimed dead-letter job {job.id} has no delivery token")
    callback = DEAD_LETTER_HANDLERS.get(job.kind)
    error: str | None = None
    if callback is None:
        # Unknown kinds are intentionally terminal; there is no domain state
        # callback that can be invoked safely.
        error = None
    else:
        try:
            async with asyncio.timeout(DEAD_LETTER_TIMEOUT_S):
                async with factory() as session:
                    await callback(
                        session,
                        job.payload,
                        job.last_error or f"job ended with status {job.status}",
                    )
        except Exception as exc:
            error = (str(exc) or type(exc).__name__)[:2000]
            log.exception("dead-letter callback failed for job %s", job.id)
    async with factory() as session:
        marked = await system.mark_job_dead_lettered(
            session,
            job_id=job.id,
            delivery_token=delivery_token,
            error=error,
        )
        await session.commit()
    if not marked:
        log.warning("job %s lost its dead-letter delivery reservation", job.id)
    elif error is None:
        log.info("job %s dead-letter callback completed", job.id)
    elif int(job.dead_letter_attempts or 0) + 1 >= system.DEFAULT_DEAD_LETTER_MAX_ATTEMPTS:
        log.error("job %s dead-letter callback abandoned after retry budget", job.id)
    return True


async def _reap_orphaned_runs(factory) -> int:
    """Reconcile runs left active by a job that is terminal and past delivery.

    Dead-letter delivery is the only path that closes such a run, and it is not
    guaranteed to happen — see close_orphaned_run. This is the safety net, so it
    is deliberately forgiving: one capped batch per poll cycle, and a run that
    fails to close is logged and retried next cycle rather than stopping the rest.

    Returns how many runs were listed, not how many closed. `list_orphaned_runs`
    is capped at ten, so a full batch means there may be more waiting — and a
    batch where every close FAILED still has work left. Either way the sweep
    re-arms immediately rather than leaving the remainder for the next interval.
    """
    async with factory() as session:
        orphans = await system.list_orphaned_runs(session)
    for orphan in orphans:
        try:
            async with factory() as session:
                closed = await close_orphaned_run(session, orphan)
        except Exception:
            log.exception("failed to reap orphaned run %s (job %s)", orphan.run_id, orphan.job_id)
            continue
        if closed:
            _runs_reaped.add(1, {"reason": "orphaned"})
            # WARNING, not ERROR: a completed reap is the system working, not
            # failing. It must also stay below ERROR because the deploy workflow
            # fails on any majorana-worker log at severity>=ERROR in the 45s
            # after rollout — and the first deploy of this reaper sweeps the
            # backlog of already-stranded runs, which would have failed that
            # check on a deploy that had in fact succeeded. Genuine reap
            # failures above still log at ERROR and still trip it, which is
            # what that check is for.
            log.warning(
                "reaped orphaned run %s left active by terminal job %s",
                orphan.run_id,
                orphan.job_id,
            )
    return len(orphans)


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
    # Concurrent with the first poll cycles, not ahead of them: a provider that
    # is slow to answer must not delay draining the queue.
    preflight = asyncio.create_task(_preflight_models())
    # Each sweeps on the first cycle, then on its own wall clock. See Sweep.
    recover_sweep = Sweep(RECOVER_INTERVAL_S)
    dead_letter_sweep = Sweep(DEAD_LETTER_INTERVAL_S)
    reap_sweep = Sweep(REAP_INTERVAL_S)

    try:
        while not stop.is_set():
            delay = POLL_INTERVAL_S
            try:
                if recover_sweep.due(loop.time()):
                    async with factory() as session:
                        recovery = await system.recover_stale_jobs(session)
                        await session.commit()
                    recover_sweep.done(
                        loop.time(),
                        productive=bool(recovery.requeued or recovery.dead_jobs),
                    )
                    if recovery.requeued:
                        _job_requeues.add(recovery.requeued, {"reason": "lease_expired"})
                        log.warning("requeued %d jobs with expired leases", recovery.requeued)
                    if recovery.dead_jobs:
                        _job_terminals.add(len(recovery.dead_jobs), {"status": "dead"})
                        log.error(
                            "dead-lettered %d jobs after lease exhaustion", len(recovery.dead_jobs)
                        )
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
                # Normal jobs always get first access to the worker. A single
                # bounded dead-letter callback runs only after that job finishes
                # (or immediately when the queue is idle), so no claimed lease
                # ticks while callback delivery blocks.
                if dead_letter_sweep.due(loop.time()):
                    delivered = await _deliver_pending_dead_letters(factory, worker_id=worker_id)
                    dead_letter_sweep.done(loop.time(), productive=delivered)
                # Last line of defence, after delivery has had its full budget.
                # Rate-limited off the claim hot path (see REAP_INTERVAL_S); the
                # first cycle reaps immediately so a restart still sweeps
                # promptly.
                if reap_sweep.due(loop.time()):
                    reaped = await _reap_orphaned_runs(factory)
                    reap_sweep.done(loop.time(), productive=bool(reaped))
                if claimed is not None:
                    continue  # drain the main queue before sleeping again
            except Exception:
                # Transient DB failure: log, back off, keep the worker alive.
                log.exception("poll cycle failed; backing off %.0fs", ERROR_BACKOFF_S)
                delay = ERROR_BACKOFF_S
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except TimeoutError:
                pass
    finally:
        preflight.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await preflight
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
