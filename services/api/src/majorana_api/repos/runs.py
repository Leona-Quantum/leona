"""Run, run-event, and verification-record repositories.

run_events and verification_records carry no workspace_id; every access resolves
the parent run under scope first. run_events is append-only (DB grant enforced).
"""

import datetime as dt
import json
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import Framework, RunMode, RunStatus, VerificationMethod
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Run, RunEvent, VerificationRecord
from . import artifacts as artifacts_repo
from ._base import NotFoundError, require_write


async def get_run(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, *, for_update: bool = False
) -> Run:
    stmt = select(Run).where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
    if for_update:
        stmt = stmt.with_for_update()
    run = (await session.execute(stmt)).scalars().first()
    if run is None:
        raise NotFoundError("run")
    return run


async def list_runs(
    scope: Scope,
    session: AsyncSession,
    *,
    status: RunStatus | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[Run]:
    stmt = (
        select(Run)
        .where(Run.workspace_id == scope.workspace_id)
        .order_by(Run.id.desc())
        .limit(limit)
    )
    if status is not None:
        stmt = stmt.where(Run.status == status)
    if cursor is not None:
        stmt = stmt.where(Run.id < cursor)
    return list((await session.execute(stmt)).scalars().all())


#: Modes that can consume execution budget at admission time. AUTO belongs here
#: even though it is not itself an execution: it is the *default* mode on
#: CreateRunRequest, and the worker may resolve it to EXECUTE.
BACKSTOP_COUNTED_MODES = (RunMode.EXECUTE.value, RunMode.AUTO.value)


async def count_runs_by_mode_since(
    scope: Scope, session: AsyncSession, since: dt.datetime
) -> dict[str, int]:
    """Per-mode run counts for this workspace since `since`, for EXECUTE/AUTO.

    Backs the API-side abuse backstop in `routes.runs.create_run`.

    Counting EXECUTE alone is not enough, and this is the whole reason the
    function is shaped this way. AUTO is the default mode on CreateRunRequest,
    so a caller who simply omits `mode` never lands in an execute-only count —
    they could submit without bound while the counter read zero. The worker does
    rewrite AUTO rows to their resolved mode, but that happens *after*
    admission, which is exactly too late for a gate that runs at admission.

    Returns a mode -> count mapping rather than a single number so the caller
    can hold a tight bound on explicit EXECUTE and a separate, looser bound on
    everything that might become one, instead of metering ordinary
    conversational traffic against the strict ceiling.
    """
    stmt = (
        select(Run.mode, func.count())
        .select_from(Run)
        .where(
            Run.workspace_id == scope.workspace_id,
            Run.mode.in_(BACKSTOP_COUNTED_MODES),
            Run.created_at >= since,
        )
        .group_by(Run.mode)
    )
    return {str(mode): int(count) for mode, count in (await session.execute(stmt)).all()}


async def count_execute_runs_since(scope: Scope, session: AsyncSession, since: dt.datetime) -> int:
    """Runs whose RESOLVED mode is EXECUTE, for the per-tier weekly allowance.

    Deliberately narrower than `count_runs_by_mode_since`, and the difference is
    the point. The backstop counts AUTO too, because at admission an AUTO row
    might still become an execution and an abuse ceiling must bound the worst
    case. A *plan* allowance must not: a free account's chat is unmetered by
    policy, and counting AUTO here would spend someone's five weekly runs on
    conversation.

    The worker rewrites an AUTO row to EXECUTE when it resolves it, so a run that
    really did execute is counted from that moment on, whichever mode it was
    submitted as.

    THE ONLY QUERY IN THE REPOSITORY LAYER THAT DOES NOT BIND
    `scope.workspace_id`, and the omission is the point rather than an oversight.
    It is asserted by `test_repo_scoping.test_tier_allowance_counts_the_account`,
    so removing this comment does not remove the decision.

    The weekly allowance belongs to an ACCOUNT, not to a tenant. Both of the
    workspace-bound readings are wrong once a user can be in more than one:

    - Per workspace alone: a collaborator opens a shared workspace and reads
      "all 5 of your runs are used" because somebody else used them. The refusal
      says *your plan*, so it would be a lie about whose allowance was spent.
    - Per (workspace, user): the allowance multiplies by the number of
      workspaces the user can reach. A free account owning three, or invited
      into ten, would hold fifteen or fifty weekly runs while the product says
      five.

    Counting the caller's own rows across every workspace they act in leaks
    nothing across the tenancy boundary: `Run.user_id == scope.user_id` selects
    rows the caller created, which are the caller's own data by definition. The
    boundary this layer protects is "scope A cannot see workspace B's rows", and
    no row here belongs to anyone else.

    The flat abuse ceiling above this one stays per workspace on purpose — that
    one bounds a tenant rather than an account.
    """
    return int((await session.execute(execute_allowance_stmt(scope, since))).scalar_one())


def execute_allowance_stmt(scope: Scope, since: dt.datetime):
    """The allowance count as a statement, so a test can EXPLAIN this exact one.

    Split out rather than restated in the test. This query runs on every run
    submission and `ix_runs_user_mode_created` (migration 0039) exists solely to
    serve it — a refactor that changed the predicates would silently drop back to
    the sequential scan the index was added to remove, and a test carrying its own
    copy of the SQL would keep passing while it happened.
    """
    return (
        select(func.count())
        .select_from(Run)
        .where(
            Run.user_id == scope.user_id,
            Run.mode == RunMode.EXECUTE.value,
            Run.created_at >= since,
        )
    )


async def find_run_by_idempotency_key(
    scope: Scope, session: AsyncSession, idempotency_key: str
) -> Run | None:
    stmt = select(Run).where(
        Run.workspace_id == scope.workspace_id,
        Run.idempotency_key == idempotency_key,
    )
    return (await session.execute(stmt)).scalars().first()


async def create_run(
    scope: Scope,
    session: AsyncSession,
    *,
    task_prompt: str,
    mode: RunMode,
    framework: Framework,
    artifact_version_id: uuid.UUID | None = None,
    seed: int | None = None,
    shots: int | None = None,
    timeout_s: int | None = None,
    idempotency_key: str | None = None,
    conversation_id: uuid.UUID | None = None,
) -> Run:
    """Create a queued run with an optional, already-saved Vault context.

    A run may carry a specific artifact version as context, but that version is
    only meaningful inside the caller's workspace. Resolve it through the
    scoped artifact repository before inserting the run so an invalid or
    cross-workspace reference fails at submission time instead of creating a
    queued job that can only fail later in the worker.
    """
    require_write(scope)
    if artifact_version_id is not None:
        await artifacts_repo.get_version(scope, session, artifact_version_id)
    run = Run(
        idempotency_key=idempotency_key,
        id=uuid7(),
        conversation_id=conversation_id or uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        artifact_version_id=artifact_version_id,
        task_prompt=task_prompt,
        mode=mode,
        status=RunStatus.QUEUED,
        framework=framework,
        seed=seed,
        shots=shots,
        timeout_s=timeout_s,
    )
    session.add(run)
    await session.flush()
    # Server defaults (status/created_at/updated_at) aren't populated by flush;
    # load them now — a lazy attribute refresh later would MissingGreenlet.
    await session.refresh(run)
    return run


async def list_conversation_runs(
    scope: Scope,
    session: AsyncSession,
    conversation_id: uuid.UUID,
    *,
    limit: int = 50,
) -> list[Run]:
    """Return the scoped turns in chronological order for durable chat replay."""
    stmt = (
        select(Run)
        .where(
            Run.workspace_id == scope.workspace_id,
            Run.conversation_id == conversation_id,
        )
        .order_by(Run.created_at, Run.id)
        .limit(min(max(limit, 1), 100))
    )
    return list((await session.execute(stmt)).scalars().all())


# Conversation history is priced in estimated tokens, not characters, because
# what it costs is a provider request. Chat is the one unmetered surface in this
# product: no weekly allowance, no submission backstop, no usage ledger (see
# services/api/tests/test_run_execute_backstop.py). Nothing downstream will
# refuse an expensive chat turn, so the ceiling has to be here, and it has to be
# absolute rather than a function of how long the conversation has run.
#
# The per-turn shares below sum to less than the total on purpose: that is what
# guarantees the newest turn is always admitted whole, so "explain this code"
# never loses the thing "this" refers to.
_CONVERSATION_CODE_MAX_TOKENS = 2_000
_CONVERSATION_VALUE_MAX_TOKENS = 500
_CONVERSATION_ASSISTANT_MAX_TOKENS = 4_000
_CONVERSATION_USER_MAX_TOKENS = 1_000
_CONVERSATION_HISTORY_MAX_TOKENS = 8_000

_TRUNCATION_MARKER = "\n[Earlier output truncated for conversation context]"


def _estimated_tokens(value: str) -> int:
    """Provider-independent, deterministic token estimate.

    ASCII prose and source tokenize at roughly four characters per token;
    Japanese — a first-class UI language here, and the language the follow-up
    case that motivated this history exists for was written in — tokenizes at
    closer to one. Counting every non-ASCII character as its own token keeps one
    budget honest for both, instead of a character budget that silently costs
    four times as much on a Japanese conversation as on an English one.
    """
    ascii_chars = sum(1 for char in value if char.isascii())
    return -(-ascii_chars // 4) + (len(value) - ascii_chars)


def _bounded_text(value: str, token_limit: int) -> str:
    """Return the longest prefix of `value` costing at most `token_limit`.

    Truncation is oldest-first at the history level and tail-first here, and it
    is always marked: an unmarked truncation would read to the model as source
    or a result that genuinely ended there.
    """
    if _estimated_tokens(value) <= token_limit:
        return value
    budget = token_limit - _estimated_tokens(_TRUNCATION_MARKER)
    if budget <= 0:
        return ""
    ascii_seen = 0
    wide_seen = 0
    cut = 0
    for index, char in enumerate(value):
        if char.isascii():
            ascii_seen += 1
        else:
            wide_seen += 1
        if -(-ascii_seen // 4) + wide_seen > budget:
            break
        cut = index + 1
    return f"{value[:cut]}{_TRUNCATION_MARKER}"


def _context_json(value: Any) -> str:
    try:
        rendered = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    except (TypeError, ValueError):
        rendered = str(value)
    return _bounded_text(rendered, _CONVERSATION_VALUE_MAX_TOKENS)


def _latest_event_payload(events: list[RunEvent], event_type: str) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.type == event_type and isinstance(event.payload, dict):
            return event.payload
    return None


def _execution_context_from_events(events: list[RunEvent]) -> str | None:
    """Render one completed Execute turn as provider-neutral assistant history.

    The conversation UI already replays source and results from these durable
    events. The model must receive the same facts or a follow-up such as "explain
    this" has no referent. stdout/stderr are deliberately excluded: only the
    selected source, protected RESULT, plan, and terminal evidence are context.
    """
    finished = _latest_event_payload(events, "run.finished")
    analysis = _latest_event_payload(events, "run.analysis")
    if finished is None and analysis is None:
        return None

    source = (
        _latest_event_payload(events, "code.finalized")
        or _latest_event_payload(events, "run.best_effort")
        or _latest_event_payload(events, "code.generated")
    )
    if source is None and analysis is None:
        return None

    sections = [
        "[Prior Execute output — durable context from an earlier turn, not a new execution]"
    ]
    if analysis is not None:
        interpretation = analysis.get("interpretation")
        if isinstance(interpretation, str) and interpretation.strip():
            sections.extend(["Analysis:", interpretation.strip()])

    if source is not None:
        code = source.get("code")
        if isinstance(code, str) and code.strip():
            language = str(source.get("language") or "text")
            revision = source.get("revision")
            revision_note = f", revision {revision}" if isinstance(revision, int) else ""
            fence = "qasm" if language.lower() in {"openqasm", "qasm"} else "python"
            sections.extend(
                [
                    f"Generated source ({language}{revision_note}):",
                    f"```{fence}\n{_bounded_text(code.strip(), _CONVERSATION_CODE_MAX_TOKENS)}\n```",
                ]
            )

    plan = _latest_event_payload(events, "plan.produced")
    if plan is not None and isinstance(plan.get("plan"), dict):
        sections.extend(["Plan:", f"```json\n{_context_json(plan['plan'])}\n```"])

    sandbox = _latest_event_payload(events, "sandbox.result")
    if sandbox is not None and isinstance(sandbox.get("result"), dict):
        sections.extend(
            ["Observed sandbox RESULT:", f"```json\n{_context_json(sandbox['result'])}\n```"]
        )

    if source is not None and any(
        key in source for key in ("failed_checks", "critic_summary", "residual_risks")
    ):
        limitations = {
            key: source[key]
            for key in ("failed_checks", "critic_summary", "residual_risks")
            if source.get(key)
        }
        if limitations:
            sections.extend(
                ["Recorded limitations:", f"```json\n{_context_json(limitations)}\n```"]
            )

    if finished is not None:
        terminal = {
            key: finished[key]
            for key in (
                "status",
                "verifier_decision",
                "evidence_strength",
                "reason_code",
                "verification_summary",
                "residual_risks",
            )
            if finished.get(key) is not None
        }
        if terminal:
            sections.extend(
                ["Recorded terminal evidence:", f"```json\n{_context_json(terminal)}\n```"]
            )
    return _bounded_text("\n\n".join(sections), _CONVERSATION_ASSISTANT_MAX_TOKENS)


def _conversation_assistant_text(events: list[RunEvent]) -> str | None:
    """Return the exact assistant-side content a later turn may refer to."""
    chat = _latest_event_payload(events, "chat.completed")
    if chat is not None:
        text = chat.get("text")
        if isinstance(text, str) and text.strip():
            return _bounded_text(text.strip(), _CONVERSATION_ASSISTANT_MAX_TOKENS)
    return _execution_context_from_events(events)


def _bounded_conversation_history(
    turns: list[tuple[str, str]],
) -> list[dict[str, str]]:
    """Keep the newest complete turns inside a fixed, absolute provider budget.

    Two ceilings, both applied here rather than trusted from the caller, so the
    bound holds whatever was stored: every turn is first clamped to its per-turn
    share, then turns are admitted newest-first until the total budget is spent.
    Because one clamped turn always costs less than the total, the newest turn
    is always admitted — a follow-up never loses the turn it refers to.

    The invariant this exists to hold: the size of a chat request is a function
    of the budget, never of how long the conversation is.
    """
    selected: list[tuple[str, str]] = []
    used = 0
    for user, assistant in reversed(turns):
        user = _bounded_text(user, _CONVERSATION_USER_MAX_TOKENS)
        assistant = _bounded_text(assistant, _CONVERSATION_ASSISTANT_MAX_TOKENS)
        cost = _estimated_tokens(user) + _estimated_tokens(assistant)
        if used + cost > _CONVERSATION_HISTORY_MAX_TOKENS:
            break
        selected.append((user, assistant))
        used += cost
    messages: list[dict[str, str]] = []
    for user, assistant in reversed(selected):
        messages.extend(
            [
                {"role": "user", "content": user},
                {"role": "assistant", "content": assistant},
            ]
        )
    return messages


async def list_conversation_messages(
    scope: Scope,
    session: AsyncSession,
    conversation_id: uuid.UUID,
    *,
    exclude_run_id: uuid.UUID | None = None,
    limit: int = 20,
) -> list[dict[str, str]]:
    """Build provider-neutral user/assistant history from stored turns.

    Completed chat text is replayed verbatim. Execute turns are reconstructed
    from their durable plan/source/RESULT/terminal events, so references such as
    "this code" retain their meaning. In-flight turns contribute no invented
    answer, and the newest complete turns are bounded before provider dispatch.
    """
    conditions = [
        Run.workspace_id == scope.workspace_id,
        Run.conversation_id == conversation_id,
    ]
    if exclude_run_id is not None:
        conditions.append(Run.id != exclude_run_id)
    stmt = (
        select(Run)
        .where(*conditions)
        .order_by(Run.created_at.desc(), Run.id.desc())
        .limit(min(max(limit, 1), 50))
    )
    rows = list((await session.execute(stmt)).scalars().all())
    rows.reverse()
    turns: list[tuple[str, str]] = []
    for row in rows:
        events = await list_run_events(scope, session, row.id)
        assistant_text = _conversation_assistant_text(events)
        if assistant_text is None:
            continue
        turns.append((row.task_prompt, assistant_text))
    return _bounded_conversation_history(turns)


# The only run columns a status transition may touch — an open **fields would
# let a caller rewrite workspace_id/user_id and pierce the scope invariant.
_RUN_STATUS_FIELDS = frozenset(
    {
        "started_at",
        "finished_at",
        "sandbox_provider",
        "sandbox_meta",
        "verifier_decision",
        "verification_summary",
        "residual_risks",
        "baseline",
    }
)


async def update_run_status(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    status: RunStatus,
    *,
    set_started_at: bool = False,
    set_finished_at: bool = False,
    **fields: Any,
) -> None:
    require_write(scope)
    if not _RUN_STATUS_FIELDS.issuperset(fields):
        raise ValueError(f"not status-transition fields: {set(fields) - _RUN_STATUS_FIELDS}")
    # Timestamp flags exist so non-repository callers (the worker) never need
    # to construct func.now() themselves — sqlalchemy stays behind this layer.
    if set_started_at:
        fields["started_at"] = func.now()
    if set_finished_at:
        fields["finished_at"] = func.now()
    stmt = (
        update(Run)
        .where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
        .values(status=status, updated_at=func.now(), **fields)
    )
    result = await session.execute(stmt)
    if result.rowcount == 0:
        raise NotFoundError("run")


async def finish_run(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    status: RunStatus,
    *,
    event_payload: dict[str, Any],
    event_id: uuid.UUID,
    **fields: Any,
) -> RunStatus:
    """Atomically append the terminal event and close an active Run.

    The row lock fences API cancellation against Worker completion. The caller
    commits once after this function returns, so neither the event nor the row
    can become visible alone. A retry after another terminal writer returns the
    winning status without appending a contradictory event.
    """
    require_write(scope)
    if status not in {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}:
        raise ValueError("finish_run requires a terminal status")
    if RunStatus(event_payload.get("status")) is not status:
        raise ValueError("terminal event status must match the Run status")
    if status is RunStatus.FAILED and not event_payload.get("reason_code"):
        raise ValueError("failed terminal event requires a machine-readable reason_code")
    if not _RUN_STATUS_FIELDS.issuperset(fields):
        raise ValueError(f"not status-transition fields: {set(fields) - _RUN_STATUS_FIELDS}")

    run = await get_run(scope, session, run_id, for_update=True)
    current = RunStatus(run.status)
    if current in {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}:
        return current

    await append_run_event(
        scope,
        session,
        run_id,
        type="run.finished",
        payload=event_payload,
        event_id=event_id,
    )
    result = await session.execute(
        update(Run)
        .where(
            Run.id == run_id,
            Run.workspace_id == scope.workspace_id,
            Run.status.in_((RunStatus.QUEUED, RunStatus.RUNNING)),
        )
        .values(status=status, finished_at=func.now(), updated_at=func.now(), **fields)
    )
    if result.rowcount != 1:
        raise RuntimeError(f"run {run_id} changed while its row lock was held")
    return status


async def set_run_mode(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, mode: RunMode
) -> None:
    """Record the mode a run actually dispatched in (worker intent routing).

    Separate from `update_run_status` because this is not a status transition and
    must not be reachable through its `**fields` allowlist: mode is settled once,
    before the run starts, and nothing later in the lifecycle may rewrite it.
    """
    require_write(scope)
    stmt = (
        update(Run)
        .where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
        .values(mode=mode, updated_at=func.now())
    )
    result = await session.execute(stmt)
    if result.rowcount == 0:
        raise NotFoundError("run")


async def set_run_artifact_version(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, version_id: uuid.UUID
) -> None:
    """Link a saved artifact version back to the run that produced it (SAVE stage)."""
    require_write(scope)
    stmt = (
        update(Run)
        .where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
        .values(artifact_version_id=version_id, updated_at=func.now())
    )
    result = await session.execute(stmt)
    if result.rowcount == 0:
        raise NotFoundError("run")


async def append_run_event(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    type: str,
    payload: dict[str, Any],
    event_id: uuid.UUID | None = None,
) -> RunEvent:
    require_write(scope)
    # Lock the run row: serializes concurrent appends so max(seq)+1 can't collide
    # (uq_run_events_seq would reject the loser otherwise).
    run = await get_run(scope, session, run_id, for_update=True)
    if event_id is not None:
        existing = (
            await session.execute(
                select(RunEvent)
                .join(Run, RunEvent.run_id == Run.id)
                .where(
                    RunEvent.id == event_id,
                    RunEvent.run_id == run.id,
                    Run.workspace_id == scope.workspace_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.run_id != run.id or existing.type != type or existing.payload != payload:
                raise ValueError("run event idempotency key was reused with different content")
            return existing
    next_seq = (
        await session.execute(
            select(func.coalesce(func.max(RunEvent.seq), 0) + 1).where(RunEvent.run_id == run.id)
        )
    ).scalar_one()
    event = RunEvent(
        id=event_id or uuid7(), run_id=run.id, seq=next_seq, type=type, payload=payload
    )
    session.add(event)
    await session.flush()
    return event


async def fail_run_from_dead_letter(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    error_payload: dict[str, Any],
    error_event_id: uuid.UUID,
    finished_event_id: uuid.UUID,
) -> bool:
    """Atomically close an active Run and append its terminal event sequence.

    The scoped Run lock serializes cancellation and competing callbacks. A
    terminal Run is left untouched; compatible deterministic event IDs make a
    retry repair a partial sequence written by an older Worker.
    """
    require_write(scope)
    run = await get_run(scope, session, run_id, for_update=True)
    if RunStatus(run.status) not in {RunStatus.QUEUED, RunStatus.RUNNING}:
        return False
    await append_run_event(
        scope,
        session,
        run_id,
        type="run.error",
        payload=error_payload,
        event_id=error_event_id,
    )
    await append_run_event(
        scope,
        session,
        run_id,
        type="run.finished",
        payload={
            "status": RunStatus.FAILED.value,
            "reason_code": str(error_payload.get("code") or "job_dead_letter")[:120],
        },
        event_id=finished_event_id,
    )
    result = await session.execute(
        update(Run)
        .where(
            Run.id == run_id,
            Run.workspace_id == scope.workspace_id,
            Run.status.in_((RunStatus.QUEUED, RunStatus.RUNNING)),
        )
        .values(
            status=RunStatus.FAILED,
            finished_at=func.now(),
            updated_at=func.now(),
        )
    )
    if result.rowcount != 1:
        raise RuntimeError(f"run {run_id} changed while its row lock was held")
    return True


async def list_run_events(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    after_seq: int = 0,  # SSE resume: Last-Event-ID
) -> list[RunEvent]:
    stmt = (
        select(RunEvent)
        .join(Run, RunEvent.run_id == Run.id)
        .where(
            RunEvent.run_id == run_id,
            Run.workspace_id == scope.workspace_id,
            RunEvent.seq > after_seq,
        )
        .order_by(RunEvent.seq)
    )
    return list((await session.execute(stmt)).scalars().all())


async def add_verification_record(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    method: VerificationMethod,
    result: str,
    params: dict[str, Any] | None = None,
    details: dict[str, Any] | None = None,
) -> VerificationRecord:
    require_write(scope)
    run = await get_run(scope, session, run_id)  # scope check
    record = VerificationRecord(
        id=uuid7(),
        run_id=run.id,
        method=method,
        params=params or {},
        result=result,
        details=details,
    )
    session.add(record)
    await session.flush()
    return record


async def list_verification_records(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> list[VerificationRecord]:
    stmt = (
        select(VerificationRecord)
        .join(Run, VerificationRecord.run_id == Run.id)
        .where(
            VerificationRecord.run_id == run_id,
            Run.workspace_id == scope.workspace_id,
        )
        .order_by(VerificationRecord.id)
    )
    return list((await session.execute(stmt)).scalars().all())
