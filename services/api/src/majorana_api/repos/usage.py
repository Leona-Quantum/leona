"""Usage-event repository — quota + billing substrate. Append-only (DB grant)."""

import datetime as dt
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import UsageKind
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import UsageEvent
from ._base import require_write


async def record_usage(
    scope: Scope,
    session: AsyncSession,
    *,
    kind: UsageKind,
    quantity: float,
    meta: dict[str, Any] | None = None,
) -> UsageEvent:
    require_write(scope)
    event = UsageEvent(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        kind=kind,
        quantity=quantity,
        meta=meta,
    )
    session.add(event)
    await session.flush()
    return event


async def sum_usage(
    scope: Scope, session: AsyncSession, *, kind: UsageKind, since: dt.datetime
) -> float:
    stmt = select(func.coalesce(func.sum(UsageEvent.quantity), 0)).where(
        UsageEvent.workspace_id == scope.workspace_id,
        UsageEvent.kind == kind,
        UsageEvent.ts >= since,
    )
    return float((await session.execute(stmt)).scalar_one())
