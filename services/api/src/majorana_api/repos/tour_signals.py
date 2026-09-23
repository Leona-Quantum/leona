"""Recording guided-tour step signals as counts (migration 0071, ai-ops 326).

## Deliberately no `Scope` — the exception AGENTS.md rule 2 already carries

Every other function in this layer takes a `Scope` first, because every other
table has a tenant to check it against. This table has none —
`db/migrations/versions/0071_tour_signal_counts.py`'s docstring places it
outside 0053's RLS scheme entirely, the same GLOBAL/no-policy group `jobs` and
the identity tables sit in — so there is no `workspace_id` or `user_id` to
receive one. `repos/personal_access_tokens.py::resolve_presented` is the
existing precedent for a function that "legitimately does not" take a `Scope`;
this is the same shape for the same reason, one level further out: that
function runs before a scope EXISTS, and this one runs for a caller that will
never have one, because `POST /v1/tour-signals` takes no credential at all.

## Two functions, one write and one read — both here, neither in the script

`record_signal` is the write; `list_counts` is the owner's read path
(`services/api/scripts/tour_signal_counts.py` calls it). Both live here rather
than the query living in the script directly, for the reason
`scripts/check_raw_queries.py` enforces mechanically: `services/api/scripts/`
is not in that gate's allowed prefixes, so a raw `sqlalchemy` import there is a
CI failure, not a style choice. `scripts/reattach_workos_identities.py` is the
existing precedent read correctly — it calls `identity_migration`'s own
repository functions and imports no `sqlalchemy` itself; `tour_signal_counts.py`
does the same here.
"""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import TourSignalCount


async def record_signal(
    session: AsyncSession,
    *,
    day: dt.date,
    track: str,
    step: str,
    kind: str,
) -> None:
    """Increment the count for `(day, track, step, kind)`, creating the row if needed.

    One statement, one round trip: `INSERT ... ON CONFLICT (day, track, step,
    kind) DO UPDATE SET count = count + 1` rather than a `SELECT` to decide
    between an insert and an update. That also makes it safe under concurrent
    callers hitting the same tuple in the same instant — the exact case this
    table exists for, since every visitor running the same tour step lands on
    the same row — where a read-then-write would lose an increment to a race
    the conflict clause makes impossible.

    The caller (the route) has already checked `track`/`step`/`kind` against
    `tour_signal_vocabulary`'s known sets; this function trusts that and adds
    no second check, the same division of labour `mint`'s length ceiling in
    `personal_access_tokens.py` documents — the model/route enforce it as a
    422 a person can read, migration 0071's CHECK constraints enforce it as
    the thing that cannot be gotten around by a caller that is not this route.
    """
    table = TourSignalCount.__table__
    await session.execute(
        insert(table)
        .values(day=day, track=track, step=step, kind=kind, count=1)
        .on_conflict_do_update(
            index_elements=[table.c.day, table.c.track, table.c.step, table.c.kind],
            set_={"count": table.c.count + 1},
        )
    )
    await session.flush()


async def list_counts(
    session: AsyncSession,
    *,
    since: dt.date | None = None,
    until: dt.date | None = None,
    track: str | None = None,
    step: str | None = None,
    kind: str | None = None,
) -> list[TourSignalCount]:
    """Every row matching the given filters, ordered for a human to read.

    No `Scope` here either — see the module docstring — and no pagination:
    `services/api/scripts/tour_signal_counts.py` is the only caller, run by
    hand against a date range, and this table's cardinality (days × ~17 tracks
    × ~43 steps × 10 kinds, and only the combinations that ever actually
    happened) is nowhere near where an unpaginated read would be a mistake.
    """
    query = sa.select(TourSignalCount).order_by(
        TourSignalCount.day, TourSignalCount.track, TourSignalCount.step, TourSignalCount.kind
    )
    if since is not None:
        query = query.where(TourSignalCount.day >= since)
    if until is not None:
        query = query.where(TourSignalCount.day <= until)
    if track is not None:
        query = query.where(TourSignalCount.track == track)
    if step is not None:
        query = query.where(TourSignalCount.step == step)
    if kind is not None:
        query = query.where(TourSignalCount.kind == kind)
    return list((await session.execute(query)).scalars().all())
