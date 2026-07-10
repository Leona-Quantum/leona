"""Job handlers — the worker's dispatch table, and the repo-backed adapters that
let the pure executor (majorana-pipeline) persist through the scoped repository
layer. The worker acts under the run creator's scope (carried in the job payload
at enqueue time), never a broader one; repos.system stays provisioning+jobs only.
"""

import asyncio
import logging
import uuid
from typing import Any, Awaitable, Callable

from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus
from majorana_contracts.events import run_event_adapter
from majorana_llm import LLMClient, default_llm
from majorana_pipeline import RunContext, execute_run
from majorana_sandbox import Sandbox, VercelSandbox

from majorana_api.db import AsyncSession
from majorana_api.jobs import RUN_EXECUTE_JOB_KIND
from majorana_api.repos import runs as runs_repo

from .stage_handlers import build_stage_handlers

log = logging.getLogger("majorana_worker")

DEFAULT_RUN_TIMEOUT_S = 300.0


def _default_llm() -> LLMClient:
    """Production LLM client for the active provider profile (keys read at call time)."""
    return default_llm()


def _default_sandbox() -> Sandbox:
    """Production sandbox (the real Firecracker boundary; needs Vercel creds)."""
    return VercelSandbox()


class RepoEventSink:
    """EventSink → runs_repo.append_run_event, validating each event against the
    contracts union before it's persisted (a malformed event must never enter
    the replay log)."""

    def __init__(self, scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id

    async def emit(self, type: str, payload: dict[str, Any]) -> None:
        candidate = {
            "run_id": self._run_id,
            "seq": 0,  # placeholder; the repo assigns the real seq under lock
            "ts": "1970-01-01T00:00:00Z",
            "type": type,
            **payload,
        }
        validated = run_event_adapter.validate_python(candidate)
        wire = validated.model_dump(mode="json", exclude={"run_id", "seq", "ts", "type"})
        await runs_repo.append_run_event(
            self._scope, self._session, self._run_id, type=type, payload=wire
        )
        await self._session.commit()  # each event visible to SSE readers immediately


class RepoRunStateStore:
    """RunStateStore → runs.status column, with started/finished timestamps."""

    def __init__(self, scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id

    async def set_status(self, new: RunStatus, **fields: Any) -> None:
        await runs_repo.update_run_status(
            self._scope,
            self._session,
            self._run_id,
            new,
            set_started_at=bool(fields.pop("started_at_now", False)),
            set_finished_at=bool(fields.pop("finished_at_now", False)),
        )
        await self._session.commit()

    async def current_status(self) -> RunStatus:
        run = await runs_repo.get_run(self._scope, self._session, self._run_id)
        status = RunStatus(run.status)
        # Expire AFTER reading: the next get_run must repopulate from the DB
        # (an API-side cancel commits in another session), and reading an
        # expired attribute here would lazy-refresh synchronously.
        self._session.expire(run)
        return status


def _scope_from_payload(payload: dict[str, Any]) -> Scope:
    return Scope(
        user_id=uuid.UUID(payload["user_id"]),
        workspace_id=uuid.UUID(payload["workspace_id"]),
        role=Role.MEMBER,  # write, never admin — least authority that can execute
    )


async def handle_run_execute(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    sandbox: Sandbox | None = None,
) -> None:
    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    run = await runs_repo.get_run(scope, session, run_id)
    ctx = RunContext(
        run_id=run_id,
        task_prompt=run.task_prompt,
        mode=RunMode(run.mode),
        framework=Framework(run.framework),
        seed=run.seed,
        shots=run.shots,
        tolerances=run.tolerances,
        timeout_s=run.timeout_s,
        sink=RepoEventSink(scope, session, run_id),
    )
    store = RepoRunStateStore(scope, session, run_id)
    handlers = build_stage_handlers(
        scope, session, run_id, llm or _default_llm(), sandbox or _default_sandbox()
    )
    try:
        async with asyncio.timeout(run.timeout_s or DEFAULT_RUN_TIMEOUT_S):
            final = await execute_run(ctx, store, handlers)
    except TimeoutError:
        # The stage coroutine was cancelled mid-flight; reset the session and
        # record the failure so the event log never ends mid-run.
        await session.rollback()
        if await store.current_status() is RunStatus.RUNNING:
            await ctx.sink.emit(
                "run.error",
                {"stage": None, "code": "run_timeout", "message": "run exceeded its time budget"},
            )
            await ctx.sink.emit("run.finished", {"status": RunStatus.FAILED})
            await store.set_status(RunStatus.FAILED, finished_at_now=True)
        final = RunStatus.FAILED
    log.info("run %s finished: %s", run_id, final)


JobHandler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]

HANDLERS: dict[str, JobHandler] = {
    RUN_EXECUTE_JOB_KIND: handle_run_execute,
}
