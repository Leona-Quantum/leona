"""Run, run-event, and verification-record repositories.

run_events and verification_records carry no workspace_id; every access resolves
the parent run under scope first. run_events is append-only (DB grant enforced).
"""

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


async def list_conversation_messages(
    scope: Scope,
    session: AsyncSession,
    conversation_id: uuid.UUID,
    *,
    exclude_run_id: uuid.UUID | None = None,
    limit: int = 20,
) -> list[dict[str, str]]:
    """Build provider-neutral user/assistant history from stored chat turns.

    Only completed assistant text is replayed into a new provider request. A
    failed or in-flight turn contributes no invented answer.
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
    messages: list[dict[str, str]] = []
    for row in rows:
        events = await list_run_events(scope, session, row.id)
        assistant_text: str | None = None
        for event in reversed(events):
            if event.type == "chat.completed":
                value = event.payload.get("text")
                if isinstance(value, str) and value.strip():
                    assistant_text = value
                    break
            if event.type == "run.analysis":
                value = event.payload.get("interpretation")
                if isinstance(value, str) and value.strip():
                    assistant_text = value
                    break
        if assistant_text is None:
            continue
        messages.extend(
            [
                {"role": "user", "content": row.task_prompt},
                {"role": "assistant", "content": assistant_text},
            ]
        )
    return messages


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
