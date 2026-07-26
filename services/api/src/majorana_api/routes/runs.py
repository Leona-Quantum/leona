"""Run lifecycle: create (idempotent) → queued job → worker executes → SSE replay.

The SSE endpoint is a pure reader of run_events (ADR-0008): live runs and stored
runs replay through the same code path, resumable via Last-Event-ID = seq.
"""

import asyncio
import datetime as dt
import hashlib
import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from majorana_contracts import Conversation as ConversationResource
from majorana_contracts import ConversationTurn
from majorana_contracts import IllegalTransition, assert_transition, is_terminal
from majorana_contracts import Run as RunResource
from majorana_contracts.enums import ExportStatus, Framework, RunMode, RunStatus
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession
from ..jobs import RUN_EXECUTE_JOB_KIND
from ..orm import Run as RunRow
from ..repos import artifacts as artifacts_repo
from ..repos import folders as folders_repo
from ..repos import runs as runs_repo
from ..repos import system
from ..verification_summary import parse_verification_summary

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
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    shots: int | None = Field(default=None, ge=1, le=20_000)
    timeout_s: int | None = Field(default=None, ge=1, le=600)
    source_code: str | None = Field(default=None, max_length=100_000)
    conversation_id: uuid.UUID | None = None


class SetRunFolderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folder_id: uuid.UUID | None = None


async def _create_stale_source_draft(
    body: CreateRunRequest,
    scope: CurrentScope,
    session: DbSession,
) -> uuid.UUID | None:
    """Persist an edited Studio source as an explicitly unverified version.

    The prior immutable version remains available, but its evidence is never
    attached to edited bytes. A successful agent materialization creates the
    next version and replaces this draft as the artifact's current version.
    """
    if body.source_code is None or body.artifact_version_id is None:
        return body.artifact_version_id
    base = await artifacts_repo.get_version(scope, session, body.artifact_version_id)
    if body.source_code == base.code:
        return body.artifact_version_id
    source_fingerprint = hashlib.sha256(body.source_code.encode()).hexdigest()
    draft = await artifacts_repo.create_version(
        scope,
        session,
        base.artifact_id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "studio_draft",
            "based_on_version_id": str(base.id),
            "source_fingerprint": source_fingerprint,
            "verification_summary": {
                "verified": False,
                "decision": None,
                "evidence_strength": None,
                "reason_code": "source_changed_pending_verification",
                "stale": True,
            },
        },
        code=body.source_code,
        code_lang=body.framework.value,
        fingerprint=source_fingerprint,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="edited source requires fresh conversion",
        limitations="Edited Studio draft; rerun before relying on verification evidence.",
    )
    return draft.id


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
        timeout_s=run.timeout_s,
        sandbox_provider=run.sandbox_provider,
        sandbox_meta=run.sandbox_meta,
        verifier_decision=run.verifier_decision,
        verification_summary=parse_verification_summary(getattr(run, "verification_summary", None)),
        residual_risks=run.residual_risks,
        baseline=run.baseline,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


# Abuse backstop for direct control-plane calls.
#
# The tier allowance (5 execute runs/week on free, per PR #146) is enforced in
# the web BFF, which is a *different server* from this one. `run-allowance.ts`
# claimed a client "cannot skip it without also skipping its own session
# cookie", but that only holds for callers who go through the BFF at all: a
# script holding a valid access token can call POST /v1/runs here directly and
# the tier gate never runs. Today that is unreachable in production — the
# single-user lock resolves to the unlimited developer tier, so there is no
# limit to bypass — but it becomes real cost exposure the moment multi-user
# WorkOS signup returns.
#
# This is deliberately NOT a mirror of the tier policy. Mirroring it would put
# tier truth in two services, need LEONA_DEVELOPER_EMAILS set on Cloud Run as
# well as Vercel, and risk throttling the live single-operator deployment at 5
# runs/week if any of that were wrong. Instead this is a flat per-workspace
# ceiling far above every tier: it cannot refuse a legitimate user, it needs no
# tier model, no new env var, and no owner action, and it removes the property
# that actually matters — that a token holder can spend unboundedly. The
# tier-accurate gate stays in the BFF where the owner approved it.
#
# Promotion trigger: when multi-user signup ships, this ceiling stops being
# sufficient and real per-tier enforcement has to move server-side. Recorded in
# the 2026-07-26 DECISIONS.md entry and NEXT.md.
#
# TWO ceilings, not one, because AUTO is the DEFAULT mode on CreateRunRequest.
# A first cut gated only `mode == EXECUTE`, which a caller defeated simply by
# omitting `mode`: those rows are AUTO at admission, the worker rewrites them to
# their resolved mode only afterwards, and a gate that runs at admission cannot
# read a value written later. So AUTO has to be bounded too. It is bounded
# separately and much more loosely because AUTO is also what ordinary
# conversational traffic arrives as, and metering chat against the strict
# execute ceiling would refuse legitimate users — which is the one thing a
# backstop must never do.
EXECUTE_BACKSTOP_WINDOW = dt.timedelta(days=7)
#: Explicit `mode="execute"` submissions.
EXECUTE_BACKSTOP_LIMIT = 200
#: EXECUTE + AUTO together — the bound that closes the default-mode bypass.
SUBMISSION_BACKSTOP_LIMIT = 1000


def _backstop_refusal(reason: str, used: int, limit: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={
            "error": (
                "This workspace has reached the platform ceiling on runs for a "
                "rolling seven-day window. This is an abuse backstop, not your "
                "plan allowance — if you are seeing it in normal use, contact "
                "support."
            ),
            "reason": reason,
            "used": used,
            "limit": limit,
        },
    )


async def _enforce_execute_backstop(
    body: CreateRunRequest,
    scope: CurrentScope,
    session: DbSession,
) -> None:
    if body.mode not in (RunMode.EXECUTE, RunMode.AUTO):
        return
    since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
    counts = await runs_repo.count_runs_by_mode_since(scope, session, since)
    executed = counts.get(RunMode.EXECUTE.value, 0)
    submitted = executed + counts.get(RunMode.AUTO.value, 0)

    if body.mode == RunMode.EXECUTE and executed >= EXECUTE_BACKSTOP_LIMIT:
        raise _backstop_refusal("execute_backstop_exhausted", executed, EXECUTE_BACKSTOP_LIMIT)
    if submitted >= SUBMISSION_BACKSTOP_LIMIT:
        raise _backstop_refusal(
            "submission_backstop_exhausted", submitted, SUBMISSION_BACKSTOP_LIMIT
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
    await _enforce_execute_backstop(body, scope, session)
    artifact_version_id = await _create_stale_source_draft(body, scope, session)
    run = await runs_repo.create_run(
        scope,
        session,
        task_prompt=body.task_prompt,
        mode=body.mode,
        framework=body.framework,
        artifact_version_id=artifact_version_id,
        seed=body.seed,
        shots=body.shots,
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
    await runs_repo.finish_run(
        scope,
        session,
        run_id,
        RunStatus.CANCELLED,
        event_payload={"status": RunStatus.CANCELLED.value},
        event_id=uuid.uuid5(run_id, "run.finished"),
    )
    # finish_run's ORM UPDATE expires the loaded row; touching an expired
    # attribute on an AsyncSession raises MissingGreenlet, so re-read it
    # explicitly (still inside our row lock) before serializing.
    await session.refresh(run)
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
