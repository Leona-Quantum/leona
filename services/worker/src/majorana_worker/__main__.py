"""Worker loop skeleton (AD-7): claim → dispatch → finish, polling run_after.

No job kinds exist until the Phase 2 pipeline lands; an unknown kind is marked
`dead` (fail closed, never retry-loop garbage). SIGTERM drains gracefully —
Cloud Run sends it before scale-down.
"""

import asyncio
import logging
import os
import signal
import socket

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

log = logging.getLogger("majorana_worker")

POLL_INTERVAL_S = float(os.environ.get("WORKER_POLL_INTERVAL_S", "2.0"))


async def _liveness_listener(stop: asyncio.Event) -> None:
    """Cloud Run services must accept on $PORT (AD-7 runs the worker as a
    second service off the api image). Any request gets a static 200."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read(1024)
        writer.write(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "0.0.0.0", int(os.environ["PORT"]))
    async with server:
        await stop.wait()


async def run_forever() -> None:
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    engine = engine_from_env()
    factory = session_factory(engine)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    liveness = asyncio.create_task(_liveness_listener(stop)) if os.environ.get("PORT") else None
    log.info("worker %s started (poll %.1fs)", worker_id, POLL_INTERVAL_S)

    while not stop.is_set():
        async with factory() as session:
            job = await system.claim_job(session, worker_id=worker_id)
            if job is not None:
                # No job kinds exist until the Phase 2 pipeline registers
                # handlers here; fail closed rather than retry-loop.
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
        try:
            await asyncio.wait_for(stop.wait(), timeout=POLL_INTERVAL_S)
        except TimeoutError:
            pass
    if liveness is not None:
        await liveness
    await engine.dispose()
    log.info("worker %s drained and stopped", worker_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_forever())
