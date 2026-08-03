"""Usage-event repository — quota + billing substrate. Append-only (DB grant)."""

import datetime as dt
import uuid
from typing import Any, NamedTuple

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


class TokenSpendRow(NamedTuple):
    """One (role, model) pair's share of the window's token spend."""

    role: str
    model: str
    calls: int
    tokens: int


def token_spend_stmt(scope: Scope, since: dt.datetime):
    """Token spend in the window, grouped by who spent it and on what model.

    A statement builder rather than a query written inline, for the same reason
    `runs.execute_allowance_stmt` is one: `ix_usage_events_workspace_ts`
    (migration 0001) is exactly `(workspace_id, ts)` and this predicate is what
    reads it. A test can compile and EXPLAIN this object; a test carrying its own
    copy of the SQL would keep passing while the real query stopped using it.

    Three things about the shape:

    * **Grouped by the raw role, not by a chat/not-chat flag.** The bucketing is
      one comparison and it belongs in Python, where it can be tested without a
      database and where the reader can see which roles fell on which side.
      Cardinality is a handful of agent stage names times a handful of models.
    * **`quantity` and not `meta.input_tokens` + `meta.output_tokens`.**
      `quantity` is a typed `Numeric` column; the meta values are free JSON, and
      `(meta->>'input_tokens')::numeric` raises for the whole request if any row
      ever holds a non-numeric there. The split is worth having once tokens are
      priced — input and output do not cost the same — and the cheap seam for it
      is another two summed columns here, not a different table.
    * **`coalesce(..., '')` on both keys.** `meta->>'role'` is NULL for a row
      written without meta at all, and NULL group keys would arrive as a third
      bucket that reads as neither chat nor a run. Empty string is a value the
      fold can name.
    """
    role = func.coalesce(UsageEvent.meta["role"].astext, "")
    model = func.coalesce(UsageEvent.meta["model"].astext, "")
    return (
        select(
            role.label("role"),
            model.label("model"),
            func.count().label("calls"),
            func.coalesce(func.sum(UsageEvent.quantity), 0).label("tokens"),
        )
        .where(
            UsageEvent.workspace_id == scope.workspace_id,
            UsageEvent.kind == UsageKind.LLM_TOKENS,
            UsageEvent.ts >= since,
        )
        .group_by(role, model)
    )


async def token_spend_since(
    scope: Scope, session: AsyncSession, since: dt.datetime
) -> list[TokenSpendRow]:
    """This WORKSPACE's token spend inside the window, one row per role+model.

    Per workspace and not per account, unlike the run allowance next to it in
    `/v1/usage`. The allowance is a thing a person is granted and carries between
    their workspaces; spend is a thing a workspace's activity produced, and a
    number that silently summed a second tenant's chat into this one's would be
    wrong in the direction that matters once anybody shares a screen.
    """
    rows = (await session.execute(token_spend_stmt(scope, since))).all()
    return [
        TokenSpendRow(role=row.role, model=row.model, calls=int(row.calls), tokens=int(row.tokens))
        for row in rows
    ]


def account_token_allowance_stmt(scope: Scope, since: dt.datetime):
    """The rows that spend the weekly TOKEN allowance. ONE definition, three statements.

    The same discipline `runs._spends_the_weekly_allowance` documents, for the
    same reason: the sum the gate refuses on, the sum `/v1/usage` reports, and
    the timestamps it computes "when your allowance frees up" from are all built
    here. Written separately they could drift by one predicate, and the product
    would then refuse a submission on a screen that had just shown headroom.

    Bound to `user_id` and NOT to `workspace_id`, unlike `token_spend_stmt` next
    to it. An allowance is granted to a person and travels between their
    workspaces; a spend report belongs to the tenant whose activity produced it.
    Summing this per workspace would let one account get its whole allowance
    again for every workspace it owns, which `owned_workspaces` exists to bound
    precisely because that kind of bypass is cheap.
    """
    return select(UsageEvent).where(
        UsageEvent.user_id == scope.user_id,
        UsageEvent.kind == UsageKind.LLM_TOKENS,
        UsageEvent.ts >= since,
    )


async def account_tokens_since(scope: Scope, session: AsyncSession, since: dt.datetime) -> int:
    """This ACCOUNT's metered tokens inside the window, across every workspace."""

    stmt = select(func.coalesce(func.sum(UsageEvent.quantity), 0)).where(
        UsageEvent.user_id == scope.user_id,
        UsageEvent.kind == UsageKind.LLM_TOKENS,
        UsageEvent.ts >= since,
    )
    return int((await session.execute(stmt)).scalar_one())


async def tokens_free_at(
    scope: Scope,
    session: AsyncSession,
    since: dt.datetime,
    *,
    window: dt.timedelta,
    surplus: int,
) -> dt.datetime | None:
    """When enough of the window's spend expires to clear `surplus` tokens.

    A run count could answer "your next run frees up then" by taking the Nth
    oldest row. Tokens cannot: rows are different sizes, so the answer is the
    oldest timestamp at which the CUMULATIVE spend that has aged out reaches
    `surplus`. Walking them oldest-first is the whole computation.

    `None` when the window does not hold enough to clear it, which is reachable
    without a bug — an account metered down from a higher tier can be over a
    limit that its whole current window cannot bring it under. Returning some
    timestamp anyway would be a promise the product then breaks.
    """
    if surplus <= 0:
        return None
    rows = (
        await session.execute(
            account_token_allowance_stmt(scope, since).order_by(UsageEvent.ts.asc())
        )
    ).scalars()
    freed = 0
    for row in rows:
        freed += int(row.quantity)
        if freed >= surplus:
            return row.ts + window
    return None
