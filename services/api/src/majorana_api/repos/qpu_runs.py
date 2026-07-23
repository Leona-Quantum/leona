"""Durable qpu_run records — the attestation row a hardware job lives in.

Every mutation is workspace-scoped and status transitions are validated here,
not by callers: a record that has reached a terminal state never changes
again, and raw provider counts are written exactly once, with the transition
that completes the record.
"""

import datetime as dt
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import QpuRunStatus
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import QpuRun
from ._base import require_write

_TERMINAL = {QpuRunStatus.DONE, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED}

_ALLOWED_TRANSITIONS: dict[QpuRunStatus, set[QpuRunStatus]] = {
    QpuRunStatus.QUEUED: {QpuRunStatus.RUNNING, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED},
    QpuRunStatus.RUNNING: {QpuRunStatus.DONE, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED},
}


async def create_record(
    scope: Scope,
    session: AsyncSession,
    *,
    device_id: str,
    provider: str,
    shots: int,
    qasm: str,
    source_fingerprint: str,
    estimate_basis: str,
    estimated_total_usd: float | None,
    rate_source: str,
    rate_confirmed_on: str,
    artifact_version_id: uuid.UUID | None = None,
) -> QpuRun:
    require_write(scope)
    record = QpuRun(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        artifact_version_id=artifact_version_id,
        provider=provider,
        device_id=device_id,
        shots=shots,
        status=QpuRunStatus.QUEUED.value,
        source_fingerprint=source_fingerprint,
        qasm=qasm,
        estimate_basis=estimate_basis,
        estimated_total_usd=estimated_total_usd,
        rate_source=rate_source,
        rate_confirmed_on=rate_confirmed_on,
    )
    session.add(record)
    await session.flush()
    return record


async def get_record(scope: Scope, session: AsyncSession, record_id: uuid.UUID) -> QpuRun:
    stmt = select(QpuRun).where(QpuRun.id == record_id, QpuRun.workspace_id == scope.workspace_id)
    record = (await session.execute(stmt)).scalar_one_or_none()
    if record is None:
        raise LookupError(f"qpu_run {record_id} is not visible in this workspace")
    return record


async def transition(
    scope: Scope,
    session: AsyncSession,
    record_id: uuid.UUID,
    status: QpuRunStatus,
    *,
    provider_job_id: str | None = None,
    raw_counts: dict[str, int] | None = None,
    error: str | None = None,
    submitted_at: dt.datetime | None = None,
    completed_at: dt.datetime | None = None,
) -> QpuRun:
    """Move a record along its lifecycle; refuses terminal rewrites.

    The WHERE clause repeats the from-status predicate so two workers cannot
    both complete the same record: whoever loses the race matches zero rows
    and reads back the winner's terminal state instead of overwriting it.
    """
    require_write(scope)
    record = await get_record(scope, session, record_id)
    current = QpuRunStatus(record.status)
    if status not in _ALLOWED_TRANSITIONS.get(current, set()):
        raise ValueError(f"qpu_run cannot move {current.value} -> {status.value}")
    values: dict[str, Any] = {"status": status.value, "updated_at": dt.datetime.now(dt.UTC)}
    if provider_job_id is not None:
        values["provider_job_id"] = provider_job_id
    if raw_counts is not None:
        values["raw_counts"] = raw_counts
    if error is not None:
        values["error"] = error[:2000]
    if submitted_at is not None:
        values["submitted_at"] = submitted_at
    if status in _TERMINAL:
        values["completed_at"] = completed_at or dt.datetime.now(dt.UTC)
    result = await session.execute(
        update(QpuRun)
        .where(
            QpuRun.id == record_id,
            QpuRun.workspace_id == scope.workspace_id,
            QpuRun.status == current.value,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        raise RuntimeError(f"qpu_run {record_id} changed concurrently")
    await session.refresh(record)
    return record
