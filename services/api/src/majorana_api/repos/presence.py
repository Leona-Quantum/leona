"""Scoped storage for presence: who else in the workspace is looking at a run,
a notebook or a saved circuit, right now (migration 0070).

## Who may do what

Every current member of the workspace may heartbeat and read presence,
VIEWER included. This is unlike comments (`repos/comments.py`), where a viewer
reads but never writes: a heartbeat carries no content, only "I am still
looking at this", and the whole point of the feature is to show who is
looking regardless of what they are allowed to do once they get there. There is
no `require_write` anywhere in this module.

## Isolation

Every function applies `scope.workspace_id` itself. The thing presence is on is
checked through the SAME scoped getter its own routes use (`runs.get_run`,
`notebooks.get_notebook`, `artifacts.get_artifact`), exactly as `comments.py`
does it, so presence on another workspace's run is `NotFoundError` for exactly
the reason that run is.

## Freshness is read back, never stored as a flag

A row's only interesting value is `last_seen_at`; "is this person here" is
`last_seen_at >= now() - PRESENCE_TTL_S`, computed at read time. There is no
column that says "present" — a boolean would need something to clear it when a
tab is closed without warning, and nothing here ever runs on a closed tab.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import uuid

from majorana_contracts import PresenceTargetType, Scope
from sqlalchemy import delete, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..mentions import Member, handles_for
from ..orm import Membership, Presence, User
from . import artifacts as artifacts_repo
from . import notebooks as notebooks_repo
from . import runs as runs_repo
from ._base import NotFoundError, touched_now

#: A viewer counts as "here" while their last heartbeat is within this window.
#: Three heartbeat intervals (heartbeats are ~15s apart): one missed beat, from
#: a slow network or a backgrounded tab about to be marked hidden, must not flip
#: someone to "gone" before the next one has a fair chance to land.
PRESENCE_TTL_S = 45

#: How much older than the TTL a row must be before `_prune_stale` removes it.
#: Wider than the TTL on purpose: pruning is cleanup, not the freshness check —
#: `list_viewers` already ignores a row past `PRESENCE_TTL_S` regardless of
#: whether it has been swept yet, so there is no reason to race the delete
#: against the read it does not gate.
_PRUNE_AFTER_S = 600

#: Rows removed by one opportunistic prune. Bounded so a workspace that has been
#: quiet for a long time, then gets a single heartbeat, does not turn that
#: heartbeat into an unbounded delete — see the module docstring on why this
#: table needs pruning at all (a person visiting many distinct things over time
#: is not capped by the upsert the way revisiting one thing is).
_PRUNE_BATCH = 200


@dataclasses.dataclass(frozen=True)
class Viewer:
    """A CURRENT member of the workspace, as presence shows them."""

    user_id: uuid.UUID
    display_name: str | None
    handle: str


async def _require_target(
    scope: Scope, session: AsyncSession, target_type: PresenceTargetType, target_id: uuid.UUID
) -> None:
    """Absent, deleted, or in another workspace: all three are the same NotFoundError.

    The same three getters `comments.py::_require_target` uses, for the same
    reason: a comment and a presence row attach to the same three kinds of
    thing, and the existence check that matters is the one those routes already
    enforce on every other read and write.
    """
    if target_type == PresenceTargetType.RUN:
        await runs_repo.get_run(scope, session, target_id)
    elif target_type == PresenceTargetType.NOTEBOOK:
        await notebooks_repo.get_notebook(scope, session, target_id)
    elif target_type == PresenceTargetType.ARTIFACT:
        await artifacts_repo.get_artifact(scope, session, target_id)
    else:  # pragma: no cover - the enum is closed, and so is the column's CHECK
        raise NotFoundError("presence target")


async def _members(scope: Scope, session: AsyncSession) -> list[Member]:
    rows = (
        await session.execute(
            select(Membership.user_id, User.email, User.display_name)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == scope.workspace_id)
            .order_by(Membership.created_at, Membership.user_id)
        )
    ).all()
    return [Member(user_id=r.user_id, email=r.email, display_name=r.display_name) for r in rows]


async def _prune_stale(scope: Scope, session: AsyncSession) -> None:
    """Delete a bounded batch of this workspace's rows older than the prune
    window. Scoped to the caller's own workspace — like every other query in
    this module — so this never touches another tenant's rows and never scans
    more of the table than the index on (workspace_id, last_seen_at) needs to."""
    cutoff = touched_now() - dt.timedelta(seconds=_PRUNE_AFTER_S)
    stale = (
        select(Presence.workspace_id, Presence.target_type, Presence.target_id, Presence.user_id)
        .where(Presence.workspace_id == scope.workspace_id, Presence.last_seen_at < cutoff)
        .limit(_PRUNE_BATCH)
    )
    await session.execute(
        delete(Presence).where(
            tuple_(
                Presence.workspace_id, Presence.target_type, Presence.target_id, Presence.user_id
            ).in_(stale)
        )
    )


async def heartbeat(
    scope: Scope, session: AsyncSession, *, target_type: PresenceTargetType, target_id: uuid.UUID
) -> None:
    """Record that `scope.user_id` is still looking at `target_id`, right now.

    An upsert on the primary key: the same person heartbeating the same thing
    twice is one row with a newer `last_seen_at`, never a second row. Pruning
    runs in the same transaction as every heartbeat (`_prune_stale`) rather than
    on a schedule, because there is no worker or cron this feature would
    otherwise need — "opportunistic" means every write carries a little
    housekeeping, not that housekeeping is somebody else's job.
    """
    await _require_target(scope, session, target_type, target_id)
    stmt = pg_insert(Presence).values(
        workspace_id=scope.workspace_id,
        target_type=target_type.value,
        target_id=target_id,
        user_id=scope.user_id,
        last_seen_at=touched_now(),
    )
    stmt = stmt.on_conflict_do_update(
        constraint="pk_presence", set_={"last_seen_at": stmt.excluded.last_seen_at}
    )
    await session.execute(stmt)
    await _prune_stale(scope, session)


async def list_viewers(
    scope: Scope, session: AsyncSession, *, target_type: PresenceTargetType, target_id: uuid.UUID
) -> list[Viewer]:
    """Everyone else currently looking at this thing: current members only, the
    caller excluded, last seen within `PRESENCE_TTL_S`.

    A former member's row, if it has not been pruned yet, is silently dropped
    here rather than served with nothing to say about them — the same choice
    `comments.py` makes for a mention of someone who has left, for the same
    reason: presence about somebody the workspace can no longer describe is not
    useful to show.
    """
    await _require_target(scope, session, target_type, target_id)
    cutoff = touched_now() - dt.timedelta(seconds=PRESENCE_TTL_S)
    rows = (
        (
            await session.execute(
                select(Presence.user_id).where(
                    Presence.workspace_id == scope.workspace_id,
                    Presence.target_type == target_type.value,
                    Presence.target_id == target_id,
                    Presence.last_seen_at >= cutoff,
                    Presence.user_id != scope.user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return []
    present = set(rows)
    members = await _members(scope, session)
    handles = handles_for(members)
    return [
        Viewer(user_id=m.user_id, display_name=m.display_name, handle=handles[m.user_id])
        for m in members
        if m.user_id in present
    ]
