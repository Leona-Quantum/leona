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
from ._base import NotFoundError, require_write


async def get_run(scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> Run:
    stmt = select(Run).where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
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
    tolerances: dict[str, Any] | None = None,
    timeout_s: int | None = None,
) -> Run:
    require_write(scope)
    run = Run(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        artifact_version_id=artifact_version_id,
        task_prompt=task_prompt,
        mode=mode,
        status=RunStatus.QUEUED,
        framework=framework,
        seed=seed,
        shots=shots,
        tolerances=tolerances,
        timeout_s=timeout_s,
    )
    session.add(run)
    await session.flush()
    return run


async def update_run_status(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    status: RunStatus,
    **fields: Any,
) -> None:
    require_write(scope)
    stmt = (
        update(Run)
        .where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
        .values(status=status, updated_at=func.now(), **fields)
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
) -> RunEvent:
    require_write(scope)
    run = await get_run(scope, session, run_id)  # scope check
    next_seq = (
        await session.execute(
            select(func.coalesce(func.max(RunEvent.seq), 0) + 1).where(RunEvent.run_id == run.id)
        )
    ).scalar_one()
    event = RunEvent(id=uuid7(), run_id=run.id, seq=next_seq, type=type, payload=payload)
    session.add(event)
    await session.flush()
    return event


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
