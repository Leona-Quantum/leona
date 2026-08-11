"""Run lifecycle: create (idempotent) → queued job → worker executes → SSE replay.

The SSE endpoint is a pure reader of run_events (ADR-0008): live runs and stored
runs replay through the same code path, resumable via Last-Event-ID = seq.
"""

import asyncio
import datetime as dt
import hashlib
import json
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from majorana_contracts import Conversation as ConversationResource
from majorana_contracts import ConversationTurn
from majorana_contracts import IllegalTransition, assert_transition, is_terminal
from majorana_contracts import Run as RunResource
from majorana_contracts.enums import ExportStatus, Framework, RunMode, RunStatus
from pydantic import ConfigDict, Field
from opentelemetry import metrics

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..request_models import RequestModel
from ..jobs import RUN_EXECUTE_JOB_KIND
from ..orm import Run as RunRow
from ..repos import artifacts as artifacts_repo
from ..repos import folders as folders_repo
from ..repos import runs as runs_repo
from ..repos import system
from ..settings import Settings
from ..tiers import TIER_WINDOW as _TIER_WINDOW
from ..tiers import limits_for, tier_of
from ..verification_summary import parse_verification_summary

router = APIRouter()

_meter = metrics.get_meter("majorana.api.sse")
_sse_active_streams = _meter.create_up_down_counter(
    "majorana.sse.active_streams",
    unit="{stream}",
    description="Currently active server-sent event streams",
)
_sse_polls = _meter.create_counter(
    "majorana.sse.polls",
    description="SSE event polling iterations",
)
_sse_disconnects = _meter.create_counter(
    "majorana.sse.disconnects",
    description="SSE streams observed after a client disconnect",
)

SSE_POLL_INTERVAL_S = 1.0
SSE_HEARTBEAT_EVERY_POLLS = 15

#: Hard ceiling on how long one SSE connection may be held open.
#:
#: The loop already closes on `run.finished` and on a run that reached a
#: terminal status without emitting one, so this is not the normal exit — it is
#: the case where neither fires. `timeout_s` on a run is capped at 600, and a
#: stream is resumable by `Last-Event-ID`, so a client cut off here reconnects
#: and loses nothing. Without it, a connection whose run never resolves is held
#: for as long as the client keeps the socket open, and the cost of holding
#: thousands of them is paid by everyone else on the instance.
SSE_MAX_DURATION_S = 3600.0


class CreateRunRequest(RequestModel):
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
    # Controls user-facing natural language only. Code, identifiers, enum values,
    # RESULT keys, and verification contracts remain locale-neutral.
    response_locale: Literal["en", "ja"] = "en"


class SetRunFolderRequest(RequestModel):
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


def _idempotency_request_hash(body: CreateRunRequest) -> str:
    """Fingerprint the whole submitted request, `source_code` included.

    `model_dump(mode="json")` rather than a hand-listed subset: a field added to
    `CreateRunRequest` later is then covered without anybody remembering to add
    it here, and the failure mode of forgetting — two different requests hashing
    the same — is silent. Sorted keys so field order never changes the digest.

    `source_code` matters most and is the reason this is not a comparison
    against the stored Run's own columns: it is never a column. It travels to
    the worker in the job payload and into a draft version, so two submissions
    differing only in the code to run would be indistinguishable from the row.
    """
    return hashlib.sha256(
        json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()
    ).hexdigest()


def _assert_same_request(existing: RunRow, request_hash: str | None) -> None:
    """A reused key must describe the same request, or it is not a retry.

    Returning the stored run for a different body is the failure this exists to
    stop: the caller is handed a run it did not ask for, under a 201 that says
    it was created. RFC-wise this is 409 — the key is in use for something else.

    A NULL stored hash predates migration 0047. It is REFUSED, not waved
    through, and that is a correction: the first version returned the stored run
    for those rows on the reasoning that missing data cannot support a conflict.
    But "cannot compare" is exactly when handing back a run is unsafe — it keeps
    the defect this function exists to close reachable for every pre-migration
    key, which is a hole preserved for the convenience of not thinking about it.

    The cost is bounded and visible: a retry of a request created before the
    migration gets a 409 telling it to use a new key. Runs reach a terminal
    status in minutes and the migration runs during deploy, so the window where
    any row has a NULL hash and a live retry is minutes wide. Refusing loudly
    inside it beats returning a run that may not be the one asked for.
    """
    if existing.idempotency_request_hash == request_hash:
        return
    raise HTTPException(
        409,
        detail={
            "error": (
                "This Idempotency-Key was used for a different request. Use a new "
                "key, or resend the original request to receive its run."
            ),
            "reason": "idempotency_key_reused",
        },
    )


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
# Originally this was the ONLY server-side limit, added while the tier allowance
# still lived exclusively in the web BFF — a different server, which binds only
# callers who go through it. A script holding a valid access token could call
# POST /v1/runs directly and meet no tier gate at all. The promotion trigger
# recorded here was "when multi-user signup ships"; it shipped, and #164 moved
# the tier-accurate gate into this service (`tiers.py`, applied below).
#
# So this is no longer the tier gate, and it never was a mirror of the tier
# policy. It is a flat per-workspace ceiling far above every tier: it cannot
# refuse a legitimate user, needs no tier model and no environment variable, and
# removes the property that actually matters — that a token holder can spend
# unboundedly. It sits ABOVE the real gate so a metered user reads "your plan
# includes 5 runs", never "platform abuse ceiling".
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


#: The tier allowance window. Same seven days the BFF measures, so a user cannot
#: see two different "used" numbers depending on which service refused them.
#: Defined in `tiers` now that `/v1/usage` reports against the same window; kept
#: importable under this name because the gate's tests read `runs.TIER_WINDOW`.
TIER_WINDOW = _TIER_WINDOW


def tier_allowance_refusal(
    used: int,
    limit: int,
    *,
    runs: int | None,
    spent: int | None = None,
    reserved: int | None = None,
) -> HTTPException:
    """The refusal a metered account sees when its weekly allowance is spent.

    Worded like the BFF's `runAllowanceRefusal` rather than like the backstop:
    this one IS the plan allowance, and telling a user they hit "a platform
    abuse ceiling" when they simply used their week would be wrong.

    Both numbers, deliberately. Since the meter became tokens (2026-08-03) the
    enforced figure is 150,000 rather than 5, and a message built from the
    enforced figure alone would read "your plan includes 150000 verified runs
    per week". The run count is what the plan was sold as and what /pricing
    states, so it leads; the token figure is what the gate actually compared, so
    it is there to be checked against the usage screen.

    **And `used` alone cannot be checked against that screen.** It is recorded
    spend plus a reservation for in-flight runs (`reserve_execute_run_slot`),
    and the usage screen shows only the first, so a user reconciling the two
    finds a gap of one `TOKENS_PER_RUN_EQUIVALENT` per run still going — 30,000
    each, a fifth of the free tier, with nothing on any screen to attribute it
    to. `used` stays as it is, because it is the number the gate refused on and
    a message that quoted anything else would not describe the refusal. The
    halves ride alongside it so the gap has a name: `spent` is what the usage
    screen shows, `reserved` is the difference and it disappears as those runs
    finish and their real spend lands.

    `reason` stays `run_allowance_exhausted`. It is a wire value the web app and
    two test suites match on, and what the user ran out of has not changed —
    only the unit it is counted in.
    """
    allowance = (
        f"about {runs} verified runs a week ({limit:,} tokens)"
        if runs is not None
        else f"{limit:,} tokens a week"
    )
    return HTTPException(
        status_code=429,
        detail={
            "error": (
                f"Your plan includes {allowance}, and this week's allowance is used. "
                "Browser simulation in Studio stays available."
            ),
            "reason": "run_allowance_exhausted",
            "used": used,
            "limit": limit,
            "spent": used if spent is None else spent,
            "reserved": 0 if reserved is None else reserved,
        },
    )


async def _enforce_execute_backstop(
    body: CreateRunRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Settings,
) -> None:
    if body.mode not in (RunMode.EXECUTE, RunMode.AUTO):
        return
    since = dt.datetime.now(dt.timezone.utc) - EXECUTE_BACKSTOP_WINDOW
    counts = await runs_repo.count_runs_by_mode_since(scope, session, since)
    executed = counts.get(RunMode.EXECUTE.value, 0)
    submitted = executed + counts.get(RunMode.AUTO.value, 0)

    # The tier gate runs FIRST, because it is the smaller number and the one the
    # user recognises. A metered account that has spent its week should read
    # "your plan includes 5 runs", never "platform abuse ceiling".
    #
    # Only explicit EXECUTE is refused here. An AUTO submission has not decided
    # what it is yet, and refusing it would refuse ordinary chat — which for a
    # free account is unmetered by policy. The hole that leaves (submit
    # everything as AUTO and let the worker resolve it to EXECUTE) is closed
    # where the decision is actually made, in the worker's mode resolution:
    # majorana_worker.handlers._resolve_mode.
    user, _workspace = identity
    limits = limits_for(tier_of(user, settings))
    if body.mode == RunMode.EXECUTE:
        # Reserved under the account's lock rather than merely counted: two
        # submissions at the boundary used to read the same number and both
        # pass, and this is the gate with provider spend behind it. The worker's
        # own allowance check does NOT cover this case — it runs only when it
        # resolves an AUTO run to EXECUTE, and an explicit mode takes
        # `resolve_mode`'s passthrough branch.
        try:
            await runs_repo.reserve_execute_run_slot(
                scope,
                session,
                dt.datetime.now(dt.timezone.utc) - TIER_WINDOW,
                limits.agent_tokens_per_week,
            )
        except runs_repo.RunAllowanceReached as reached:
            raise tier_allowance_refusal(
                reached.used,
                reached.limit,
                runs=limits.agent_runs_per_week,
                spent=reached.spent,
                reserved=reached.reserved,
            ) from reached

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
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RunResource:
    request_hash = _idempotency_request_hash(body) if idempotency_key else None
    if idempotency_key:
        existing = await runs_repo.find_run_by_idempotency_key(scope, session, idempotency_key)
        if existing is not None:
            _assert_same_request(existing, request_hash)
            return _to_resource(existing)
    await _enforce_execute_backstop(body, scope, session, identity, settings)
    artifact_version_id = await _create_stale_source_draft(body, scope, session)
    try:
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
            idempotency_request_hash=request_hash,
            conversation_id=body.conversation_id,
        )
    except runs_repo.IdempotencyKeyInFlight:
        # Two requests carrying the same key raced past the SELECT above and
        # both reached the INSERT; the partial unique index from migration 0002
        # let exactly one through. Losing that race is not a server fault, and
        # answering 500 told the caller to retry a request that had in fact
        # already succeeded.
        raise HTTPException(
            409,
            detail={
                "error": (
                    "A run with this Idempotency-Key is being created by another "
                    "request. Retry to receive it."
                ),
                "reason": "idempotency_key_in_flight",
            },
        ) from None
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
            "response_locale": body.response_locale,
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
        _sse_active_streams.add(1)
        try:
            seq = start_seq
            idle_polls = 0
            deadline = asyncio.get_running_loop().time() + SSE_MAX_DURATION_S
            while True:
                if await request.is_disconnected():
                    _sse_disconnects.add(1)
                    return
                if asyncio.get_running_loop().time() >= deadline:
                    # Said on the wire rather than dropped silently: a client that
                    # is told why can reconnect from its Last-Event-ID, and one that
                    # simply loses the socket cannot tell this from a network fault.
                    yield ": stream duration limit reached; reconnect with Last-Event-ID\n\n"
                    return
                _sse_polls.add(1)
                async with factory() as s:
                    events, run_status = await runs_repo.list_run_events_with_status(
                        scope, s, run_id, after_seq=seq
                    )
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
                    # The status arrives with the event read (#372); re-querying it
                    # here would undo that PR while still looking merged.
                    if is_terminal(RunStatus(run_status)):
                        yield ": run terminal without run.finished; closing\n\n"
                        return
                await asyncio.sleep(SSE_POLL_INTERVAL_S)
        finally:
            _sse_active_streams.add(-1)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
