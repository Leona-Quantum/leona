"""Worker loop skeleton (AD-7): claim → dispatch → finish, polling run_after.

No job kinds exist until the Phase 2 pipeline lands; an unknown kind is marked
`dead` (fail closed, never retry-loop garbage). SIGTERM drains gracefully —
Cloud Run sends it before scale-down.
"""

import asyncio
import logging
import math
import os
import signal
import socket

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

log = logging.getLogger("majorana_worker")

POLL_INTERVAL_S = float(os.environ.get("WORKER_POLL_INTERVAL_S", "2.0"))
if not math.isfinite(POLL_INTERVAL_S) or POLL_INTERVAL_S <= 0:
    raise ValueError(f"WORKER_POLL_INTERVAL_S must be a positive number: {POLL_INTERVAL_S}")
ERROR_BACKOFF_S = 10.0


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
                    job = await system.claim_job(session, worker_id=worker_id)
                    if job is not None:
                        # No job kinds exist until the Phase 2 pipeline
                        # registers handlers; fail closed rather than retry.
                        await system.finish_job(
                            session,
                            job_id=job.id,
                            status="dead",
                            last_error=f"no handler registered for kind {job.kind!r}",
                        )
                        log.error("job %s dead: no handler for kind %r", job.id, job.kind)
                        await session.commit()
                        continue  # drain the queue before sleeping again
                    await session.commit()
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
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
