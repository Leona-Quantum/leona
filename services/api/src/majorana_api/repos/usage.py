"""Usage-event repository — quota + billing substrate. Append-only (DB grant)."""

import datetime as dt
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import UsageKind
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
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
    event_id: uuid.UUID | None = None,
) -> UsageEvent:
    require_write(scope)
    if quantity < 0:  # append-only billing substrate: corrections are new kinds, not negatives
        raise ValueError("quantity must be non-negative")
    if event_id is not None:
        await session.execute(
            insert(UsageEvent)
            .values(
                id=event_id,
                workspace_id=scope.workspace_id,
                user_id=scope.user_id,
                kind=kind,
                quantity=quantity,
                meta=meta,
            )
            .on_conflict_do_nothing(index_elements=[UsageEvent.id])
        )
        existing = (
            await session.execute(
                select(UsageEvent).where(
                    UsageEvent.id == event_id,
                    UsageEvent.workspace_id == scope.workspace_id,
                    UsageEvent.user_id == scope.user_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ValueError("usage event id is unavailable in this scope")
        if (
            existing.kind != kind
            or float(existing.quantity) != float(quantity)
            or existing.meta != meta
        ):
            raise ValueError("usage event idempotency key was reused with different content")
        return existing
    event = UsageEvent(
        id=event_id or uuid7(),
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
