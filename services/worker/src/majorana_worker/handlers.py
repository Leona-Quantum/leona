"""Job handlers — the worker's dispatch table, and the repo-backed adapters that
let the pure executor (majorana-pipeline) persist through the scoped repository
layer. The worker acts under the run creator's scope (carried in the job payload
at enqueue time), never a broader one; repos.system stays provisioning+jobs only.
"""

import asyncio
import logging
import os
import uuid
from typing import Any, Awaitable, Callable

from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus
from majorana_agent import (
    AgentPolicy,
    AgentRuntime,
    AgentState,
    CircuitToolset,
    StructuredToolModel,
    ToolBroker,
)
from majorana_contracts.events import run_event_adapter
from majorana_llm import LLMClient, LLMRequest, QUANTUM_AGENT_SYSTEM_PROMPT, default_llm, model_for
from majorana_sandbox import LocalSubprocessSandbox, Sandbox, VercelSandbox

from majorana_api.db import AsyncSession
from majorana_api.jobs import RUN_EXECUTE_JOB_KIND
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import artifacts as artifacts_repo

from .agent_events import AgentEventObserver
from .agent_llm import MeteredAgentLLM
from .agent_ports import (
    EvidenceVerifier,
    LLMPlanner,
    RepoArtifactPublisher,
    SandboxCandidateExecutor,
    TrustedOpenQASMConverter,
)
from .agent_store import RepoAgentStore
from .context import RunContext

log = logging.getLogger("majorana_worker")

DEFAULT_RUN_TIMEOUT_S = 300.0


def _default_llm() -> LLMClient:
    """Production LLM client for the active provider profile (keys read at call time)."""
    return default_llm()


def _default_sandbox() -> Sandbox:
    """Choose the execution boundary without silently weakening production.

    The local subprocess double is useful for a paid-provider walkthrough on a
    developer machine, but it is not a security boundary and must never be
    selected by a Cloud Run, Vercel, or CI process.
    """
    provider = os.environ.get("MAJORANA_SANDBOX", "vercel").strip().lower()
    if provider == "local":
        if os.environ.get("MAJORANA_ENV", "").strip().lower() != "development" or any(
            os.environ.get(name)
            for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI")
        ):
            raise RuntimeError(
                "MAJORANA_SANDBOX=local requires MAJORANA_ENV=development and a local process"
            )
        return LocalSubprocessSandbox()
    if provider == "vercel":
        return VercelSandbox()
    raise RuntimeError("MAJORANA_SANDBOX must be 'vercel' or 'local'")


class RepoEventSink:
    """EventSink → runs_repo.append_run_event, validating each event against the
    contracts union before it's persisted (a malformed event must never enter
    the replay log)."""

    def __init__(self, scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id

    async def emit(
        self, type: str, payload: dict[str, Any], *, event_id: uuid.UUID | None = None
    ) -> None:
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
            self._scope,
            self._session,
            self._run_id,
            type=type,
            payload=wire,
            event_id=event_id,
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
    parent_artifact_id = None
    if run.artifact_version_id is not None:
        version = await artifacts_repo.get_version(scope, session, run.artifact_version_id)
        parent_artifact_id = version.artifact_id
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
        conversation_id=run.conversation_id,
        source_code=payload.get("source_code"),
        source_framework=Framework(run.framework),
        parent_artifact_id=parent_artifact_id,
    )
    store = RepoRunStateStore(scope, session, run_id)
    try:
        async with asyncio.timeout(run.timeout_s or DEFAULT_RUN_TIMEOUT_S):
            provider = llm or _default_llm()
            if ctx.mode is not RunMode.EXECUTE:
                final = await _handle_conversation(ctx, store, provider)
            else:
                final = await _handle_agent_execution(
                    ctx,
                    store,
                    scope=scope,
                    session=session,
                    llm=provider,
                    sandbox=sandbox or _default_sandbox(),
                    parent_artifact_id=parent_artifact_id,
                )
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


async def _handle_agent_execution(
    ctx: RunContext,
    run_store: RepoRunStateStore,
    *,
    scope: Scope,
    session: AsyncSession,
    llm: LLMClient,
    sandbox: Sandbox,
    parent_artifact_id: uuid.UUID | None,
) -> RunStatus:
    status = await run_store.current_status()
    if status not in {RunStatus.QUEUED, RunStatus.RUNNING}:
        return status
    if status is RunStatus.QUEUED:
        await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
    # Re-emitting on RUNNING repairs a crash between the status transition and
    # event append; the deterministic ID prevents a duplicate event.
    await ctx.sink.emit("run.started", {}, event_id=uuid.uuid5(ctx.run_id, "run.started"))

    agent_store = RepoAgentStore(scope, session)
    metered_llm = MeteredAgentLLM(
        delegate=llm,
        sink=ctx.sink,
        scope=scope,
        session=session,
        run_id=ctx.run_id,
    )
    toolset = CircuitToolset(
        store=agent_store,
        framework=ctx.framework,
        planner=LLMPlanner(
            llm=metered_llm,
            task_prompt=ctx.task_prompt,
            framework=ctx.framework,
        ),
        executor=SandboxCandidateExecutor(sandbox),
        verifier=EvidenceVerifier(llm=metered_llm, task_prompt=ctx.task_prompt),
        converter=TrustedOpenQASMConverter(),
        publisher=RepoArtifactPublisher(
            scope=scope,
            session=session,
            run_id=ctx.run_id,
            parent_artifact_id=parent_artifact_id,
            title=ctx.task_prompt,
        ),
    )
    broker = ToolBroker(
        store=agent_store,
        policy=AgentPolicy(framework=ctx.framework),
        handlers=toolset.handlers(),
    )

    async def cancelled() -> bool:
        return await run_store.current_status() is RunStatus.CANCELLED

    observer = AgentEventObserver(store=agent_store, sink=ctx.sink)
    await observer.recover(ctx.run_id)
    runtime = AgentRuntime(
        store=agent_store,
        broker=broker,
        model=StructuredToolModel(
            llm=metered_llm,
            task_prompt=ctx.task_prompt,
            framework=ctx.framework,
            initial_source=ctx.source_code,
        ),
        observer=observer,
        cancel_requested=cancelled,
    )
    final = await runtime.run(ctx.run_id)
    if final is AgentState.CANCELLED:
        await ctx.sink.emit(
            "run.finished",
            {"status": RunStatus.CANCELLED},
            event_id=uuid.uuid5(ctx.run_id, "run.finished"),
        )
        return RunStatus.CANCELLED
    if final is AgentState.PUBLISHED:
        await ctx.sink.emit(
            "run.finished",
            {"status": RunStatus.SUCCEEDED, "verifier_decision": "pass"},
            event_id=uuid.uuid5(ctx.run_id, "run.finished"),
        )
        await run_store.set_status(
            RunStatus.SUCCEEDED,
            finished_at_now=True,
            verifier_decision="pass",
        )
        return RunStatus.SUCCEEDED
    await ctx.sink.emit(
        "run.error",
        {"stage": None, "code": "agent_failed", "message": "agent tool loop failed"},
        event_id=uuid.uuid5(ctx.run_id, "run.error.agent_failed"),
    )
    await ctx.sink.emit(
        "run.finished",
        {"status": RunStatus.FAILED},
        event_id=uuid.uuid5(ctx.run_id, "run.finished"),
    )
    await run_store.set_status(RunStatus.FAILED, finished_at_now=True)
    return RunStatus.FAILED


async def _handle_conversation(
    ctx: RunContext, store: RepoRunStateStore, llm: LLMClient
) -> RunStatus:
    """Answer a direct chat turn without invoking the execution pipeline."""
    status = await store.current_status()
    if status is not RunStatus.QUEUED:
        return status
    await store.set_status(RunStatus.RUNNING, started_at_now=True)
    await ctx.sink.emit("run.started", {})

    history = (
        await runs_repo.list_conversation_messages(
            store._scope,
            store._session,
            ctx.conversation_id,
            exclude_run_id=ctx.run_id,
        )
        if ctx.conversation_id is not None
        else []
    )
    model = model_for("chat")
    started = asyncio.get_running_loop().time()
    buffers = {"reasoning": "", "output": ""}

    async def on_delta(text: str, kind: str) -> None:
        normalized = kind if kind in buffers else "output"
        if not text:
            return
        buffers[normalized] += text
        while len(buffers[normalized]) >= 160:
            chunk, buffers[normalized] = (
                buffers[normalized][:160],
                buffers[normalized][160:],
            )
            await ctx.sink.emit(
                "chat.delta",
                {"kind": normalized, "text": chunk},
            )

    async def flush_deltas() -> None:
        for kind, text in buffers.items():
            if text:
                await ctx.sink.emit("chat.delta", {"kind": kind, "text": text})

    try:
        response = await llm.complete(
            LLMRequest(
                model=model,
                system=QUANTUM_AGENT_SYSTEM_PROMPT,
                user=ctx.task_prompt,
                messages=[*history, {"role": "user", "content": ctx.task_prompt}],
                max_tokens=8192,
                temperature=0.7,
            ),
            on_delta=on_delta,
        )
    except Exception:
        log.exception("chat provider failed for run %s", ctx.run_id)
        await flush_deltas()
        await ctx.sink.emit(
            "chat.error",
            {
                "code": "provider_failed",
                "message": "The assistant could not complete this response.",
            },
        )
        await ctx.sink.emit("run.finished", {"status": RunStatus.FAILED})
        await store.set_status(RunStatus.FAILED, finished_at_now=True)
        return RunStatus.FAILED

    await flush_deltas()
    interpretation = response.text.strip() or "The assistant returned an empty response."
    await ctx.sink.emit(
        "chat.completed",
        {
            "text": interpretation,
            "model": response.model,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
            "duration_ms": int((asyncio.get_running_loop().time() - started) * 1000),
        },
    )
    await ctx.sink.emit(
        "run.finished",
        {
            "status": RunStatus.SUCCEEDED,
        },
    )
    await store.set_status(RunStatus.SUCCEEDED, finished_at_now=True)
    return RunStatus.SUCCEEDED


JobHandler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]

HANDLERS: dict[str, JobHandler] = {
    RUN_EXECUTE_JOB_KIND: handle_run_execute,
}
