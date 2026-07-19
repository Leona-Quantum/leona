"""Run lifecycle: create (idempotent) → queued job → worker executes → SSE replay.

The SSE endpoint is a pure reader of run_events (ADR-0008): live runs and stored
runs replay through the same code path, resumable via Last-Event-ID = seq.
"""

import asyncio
import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from majorana_contracts import Conversation as ConversationResource
from majorana_contracts import ConversationTurn
from majorana_contracts import IllegalTransition, assert_transition, is_terminal
from majorana_contracts import Run as RunResource
from majorana_contracts.enums import Framework, RunMode, RunStatus
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession
from ..jobs import RUN_EXECUTE_JOB_KIND
from ..orm import Run as RunRow
from ..repos import folders as folders_repo
from ..repos import runs as runs_repo
from ..repos import system

router = APIRouter()

SSE_POLL_INTERVAL_S = 1.0
SSE_HEARTBEAT_EVERY_POLLS = 15


class CreateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_prompt: str = Field(min_length=1, max_length=20_000)
    # AUTO by default: the worker decides from the message whether this is a task
    # to run or a message to answer. The old default was CHAT, which meant every
    # caller that wanted the pipeline had to say so — and the UI said "execute"
    # unconditionally, sending greetings into plan/generate/verify. An explicit
    # mode is still honoured exactly as given.
    mode: RunMode = RunMode.AUTO
    # Qiskit is the product default. Once supplied, this choice is authoritative
    # throughout generation, verification, optimization, and artifact writeback.
    framework: Framework = Framework.QISKIT
    artifact_version_id: uuid.UUID | None = None
    seed: int | None = None
    shots: int | None = Field(default=None, ge=1, le=1_000_000)
    tolerances: dict[str, float] | None = None
    timeout_s: int | None = Field(default=None, ge=1, le=600)
    source_code: str | None = Field(default=None, max_length=100_000)
    conversation_id: uuid.UUID | None = None


class SetRunFolderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folder_id: uuid.UUID | None = None


def _to_resource(run: RunRow) -> RunResource:
    return RunResource(
        id=run.id,
        conversation_id=run.conversation_id,
        workspace_id=run.workspace_id,
        user_id=run.user_id,
        artifact_version_id=run.artifact_version_id,
        folder_id=run.folder_id,
        task_prompt=run.task_prompt,
        mode=RunMode(run.mode),
        status=RunStatus(run.status),
        framework=Framework(run.framework),
        seed=run.seed,
        shots=run.shots,
        tolerances=run.tolerances,
        timeout_s=run.timeout_s,
        sandbox_provider=run.sandbox_provider,
        sandbox_meta=run.sandbox_meta,
        verifier_decision=run.verifier_decision,
        residual_risks=run.residual_risks,
        baseline=run.baseline,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


@router.post("/runs", response_model=RunResource, status_code=201)
async def create_run(
    body: CreateRunRequest,
    scope: CurrentScope,
    session: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RunResource:
    if idempotency_key:
        existing = await runs_repo.find_run_by_idempotency_key(scope, session, idempotency_key)
        if existing is not None:
            return _to_resource(existing)
    run = await runs_repo.create_run(
        scope,
        session,
        task_prompt=body.task_prompt,
        mode=body.mode,
        framework=body.framework,
        artifact_version_id=body.artifact_version_id,
        seed=body.seed,
        shots=body.shots,
        tolerances=body.tolerances,
        timeout_s=body.timeout_s,
        idempotency_key=idempotency_key,
        conversation_id=body.conversation_id,
    )
    await runs_repo.append_run_event(
        scope,
        session,
        run.id,
        type="run.queued",
        payload={"mode": str(body.mode), "framework": str(body.framework)},
    )
    # The job payload carries the scope the worker will act under — it resumes
    # the creator's authority, never a broader one (system repo stays minimal).
    await system.enqueue_job(
        session,
        kind=RUN_EXECUTE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
            **({"source_code": body.source_code} if body.source_code is not None else {}),
        },
        run_id=run.id,
    )
    return _to_resource(run)


@router.get("/runs", response_model=list[RunResource])
async def list_runs(
    scope: CurrentScope,
    session: DbSession,
    status: RunStatus | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[RunResource]:
    rows = await runs_repo.list_runs(
        scope, session, status=status, cursor=cursor, limit=min(max(limit, 1), 100)
    )
    return [_to_resource(r) for r in rows]


@router.get("/runs/{run_id}", response_model=RunResource)
async def get_run(run_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> RunResource:
    return _to_resource(await runs_repo.get_run(scope, session, run_id))


@router.get("/runs/{run_id}/conversation", response_model=ConversationResource)
async def get_conversation(
    run_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> ConversationResource:
    current = await runs_repo.get_run(scope, session, run_id)
    turns: list[ConversationTurn] = []
    for row in await runs_repo.list_conversation_runs(scope, session, current.conversation_id):
        events = await runs_repo.list_run_events(scope, session, row.id)
        turns.append(
            ConversationTurn(
                run=_to_resource(row),
                events=[_event_json(event) for event in events],
            )
        )
    return ConversationResource(
        id=current.conversation_id,
        workspace_id=scope.workspace_id,
        turns=turns,
    )


@router.patch("/runs/{run_id}/folder", response_model=RunResource)
async def set_run_folder(
    run_id: uuid.UUID,
    body: SetRunFolderRequest,
    scope: CurrentScope,
    session: DbSession,
) -> RunResource:
    run = await folders_repo.set_run_folder(scope, session, run_id, body.folder_id)
    return _to_resource(run)


@router.post("/runs/{run_id}/cancel", response_model=RunResource)
async def cancel_run(run_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> RunResource:
    """Cooperative cancel: QUEUED flips immediately; RUNNING is honored by the
    executor between stages. Terminal runs 409."""
    run = await runs_repo.get_run(scope, session, run_id, for_update=True)
    current = RunStatus(run.status)
    try:
        assert_transition(current, RunStatus.CANCELLED)
    except IllegalTransition:
        raise HTTPException(409, f"run is {current}; cannot cancel") from None
    await runs_repo.update_run_status(scope, session, run_id, RunStatus.CANCELLED)
    run.status = RunStatus.CANCELLED
    return _to_resource(run)


def _event_json(ev: Any) -> dict[str, Any]:
    """Reassemble the wire event: envelope columns + payload (events.py contract)."""
    return {
        "run_id": str(ev.run_id),
        "seq": ev.seq,
        "ts": ev.ts.isoformat() if ev.ts else None,
        "type": ev.type,
        **ev.payload,
    }


@router.get("/runs/{run_id}/events")
async def list_run_events(
    run_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    after: int = 0,
) -> list[dict[str, Any]]:
    events = await runs_repo.list_run_events(scope, session, run_id, after_seq=after)
    return [_event_json(e) for e in events]


@router.get("/runs/{run_id}/events/stream")
async def stream_run_events(
    run_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    request: Request,
    after: int = 0,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
):
    """SSE replay + live tail. id = seq, event = type. Ends after run.finished.
    Stored runs replay identically to live ones — same rows, same code path."""
    # 404/403 semantics up front, on the request's own session:
    await runs_repo.get_run(scope, session, run_id)
    start_seq = int(last_event_id) if last_event_id and last_event_id.isdigit() else after

    factory = request.app.state.session_factory

    async def gen():
        seq = start_seq
        idle_polls = 0
        while True:
            if await request.is_disconnected():
                return
            async with factory() as s:
                events = await runs_repo.list_run_events(scope, s, run_id, after_seq=seq)
            if events:
                idle_polls = 0
                for ev in events:
                    seq = ev.seq
                    data = json.dumps(_event_json(ev))
                    yield f"id: {ev.seq}\nevent: {ev.type}\ndata: {data}\n\n"
                    if ev.type == "run.finished":
                        return
            else:
                idle_polls += 1
                if idle_polls % SSE_HEARTBEAT_EVERY_POLLS == 0:
                    yield ": keep-alive\n\n"
                # A run that reached terminal status without a run.finished event
                # (e.g. job died) must not hold the connection open forever.
                async with factory() as s:
                    row = await runs_repo.get_run(scope, s, run_id)
                    if is_terminal(RunStatus(row.status)):
                        yield ": run terminal without run.finished; closing\n\n"
                        return
            await asyncio.sleep(SSE_POLL_INTERVAL_S)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
