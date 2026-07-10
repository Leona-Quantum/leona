"""Audit-log repository — security-relevant actions only. Append-only (DB grant).

Any role may generate audit rows (auth events include viewers); reading the
log is admin-only.
"""

import uuid
from typing import Any

from majorana_contracts import Scope
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import AuditLog
from ._base import require_admin


async def record_audit(
    scope: Scope,
    session: AsyncSession,
    *,
    action: str,
    target_kind: str | None = None,
    target_id: uuid.UUID | None = None,
    ip: str | None = None,
    meta: dict[str, Any] | None = None,
) -> AuditLog:
    row = AuditLog(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        actor_user_id=scope.user_id,
        action=action,
        target_kind=target_kind,
        target_id=target_id,
        ip=ip,
        meta=meta,
    )
    session.add(row)
    await session.flush()
    return row


async def list_audit(
    scope: Scope,
    session: AsyncSession,
    *,
    cursor: uuid.UUID | None = None,
    limit: int = 100,
) -> list[AuditLog]:
    require_admin(scope)
    stmt = (
        select(AuditLog)
        .where(AuditLog.workspace_id == scope.workspace_id)
        .order_by(AuditLog.id.desc())
        .limit(limit)
    )
    if cursor is not None:
        stmt = stmt.where(AuditLog.id < cursor)
    return list((await session.execute(stmt)).scalars().all())
