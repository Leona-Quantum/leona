"""One recipient's inbox (migration 0073): a hardware run of theirs reached a
terminal state, or someone mentioned them in a comment.

Scoped on the RECIPIENT. Every function below takes `Scope` first, as the
authz invariant requires, but `list_notifications`, `unread_count`,
`mark_read` and `mark_all_read` filter on `scope.user_id` rather than
`scope.workspace_id` — the same argument `personal_access_tokens.py` makes for
a credential: an inbox belongs to a person, and a colleague in the same
workspace has no more business reading or marking it than they have revoking
somebody else's token. See migration 0073's docstring for the RLS side of the
same boundary.

`create_qpu_run_terminal` and `create_mention` are the two writers, and they
are the odd ones out: `scope` there is the ACTOR (the worker's or API's own
scope, or the comment's author), and the row they write names a DIFFERENT
`user_id` — the recipient. That is the same shape `workspaces.add_member`
already has: `scope` says who is doing this and authorizes it, a separate
`user_id` parameter says who the row is ABOUT. Neither writer re-checks
`require_write`; the caller (`qpu_runs.transition`, `comments._replace_mentions`)
has already done the authorization that makes the underlying event real, and
writing a notification for it is not a second permission to check.
"""

from __future__ import annotations

import datetime as dt
import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import QpuRunStatus
from majorana_contracts.notifications import (
    MAX_NOTIFICATION_SUMMARY_CHARS,
    Notification,
    NotificationKind,
)
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Notification as NotificationRow
from ._base import NotFoundError, touched_now

#: How long a notification stays in the inbox after it was written, read or
#: not. Pruned opportunistically on every write for the SAME recipient — see
#: `_prune` — rather than by a scheduled job, because nothing in this service
#: runs one; a recipient who never gets another notification keeps their old
#: ones, which is the one case pruning-on-write cannot reach and the one case
#: where it does not matter (nothing is querying that inbox anyway).
RETENTION_DAYS = 90

#: One default and ceiling for a page, the same numbers `qpu_runs`/`comments`
#: use for theirs.
DEFAULT_PAGE = 50
MAX_PAGE = 100

_TERMINAL_WORDS: dict[QpuRunStatus, str] = {
    QpuRunStatus.DONE: "finished",
    QpuRunStatus.ERROR: "failed",
    QpuRunStatus.CANCELLED: "was cancelled",
}


def _device_label(device_id: str) -> str:
    """The catalog's display name for a device, or the raw id if it is not
    (or no longer) in the rate card. Import kept local: this is the only
    function in the repository layer that needs `majorana_qpu` at all, and a
    catalog lookup that fails must never stop a notification from being
    written — the run finishing is the fact, the device's pretty name is a
    nicety."""
    try:
        from majorana_qpu import backend_info

        return backend_info(device_id).display_name
    except Exception:  # noqa: BLE001 — a notification's wording must not 500
        return device_id


def qpu_run_terminal_summary(device_id: str, status: QpuRunStatus) -> str:
    word = _TERMINAL_WORDS.get(status, status.value)
    return f"Your hardware run on {_device_label(device_id)} {word}."


def mention_summary(author_display_name: str | None) -> str:
    who = author_display_name or "Someone"
    return f"{who} mentioned you in a comment."


def to_resource(row: NotificationRow) -> Notification:
    return Notification(
        id=row.id,
        kind=NotificationKind(row.kind),
        summary=row.summary,
        data=row.data or {},
        created_at=row.created_at,
        read_at=row.read_at,
    )


async def _prune(session: AsyncSession, user_id: uuid.UUID, *, now: dt.datetime) -> None:
    """Delete this recipient's own rows older than `RETENTION_DAYS`.

    Scoped to `user_id` even though nothing calls this without one: a prune
    that forgot the predicate would delete every account's history the first
    time any account received a notification.
    """
    cutoff = now - dt.timedelta(days=RETENTION_DAYS)
    await session.execute(
        delete(NotificationRow).where(
            NotificationRow.user_id == user_id, NotificationRow.created_at < cutoff
        )
    )


async def _write(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    kind: NotificationKind,
    summary: str,
    data: dict[str, object],
    now: dt.datetime | None = None,
) -> NotificationRow:
    moment = now if now is not None else touched_now()
    row = NotificationRow(
        id=uuid7(),
        user_id=user_id,
        workspace_id=workspace_id,
        kind=kind.value,
        summary=summary[:MAX_NOTIFICATION_SUMMARY_CHARS],
        data=data,
        created_at=moment,
    )
    session.add(row)
    await session.flush()
    # After the insert, not before: the row just written is never the one this
    # deletes (it is inside the window it just set `created_at` to), and a
    # prune that ran first would do the same work one write earlier for no
    # reason.
    await _prune(session, user_id, now=moment)
    return row


async def create_qpu_run_terminal(
    scope: Scope,
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    qpu_run_id: uuid.UUID,
    device_id: str,
    status: QpuRunStatus,
    now: dt.datetime | None = None,
) -> NotificationRow:
    """Called from `qpu_runs.transition`, the single place a run's status
    becomes DONE, ERROR or CANCELLED — see that function's call sites in
    `services/worker/src/majorana_worker/handlers.py`. `user_id` is the run's
    OWN owner (`QpuRun.user_id`), read from the row rather than assumed to be
    `scope.user_id`: every real caller happens to have them equal (the worker
    builds its scope from the same job payload the API wrote out of the
    submitting user), but the row is the fact and the scope is only the actor.

    `now` is a testing seam, the same one `personal_access_tokens.mint` gives
    for the same reason: nothing else can put a row far enough in the past to
    exercise `RETENTION_DAYS` in a test that runs in under a second.
    """
    return await _write(
        session,
        user_id=user_id,
        workspace_id=workspace_id,
        kind=NotificationKind.QPU_RUN_TERMINAL,
        summary=qpu_run_terminal_summary(device_id, status),
        data={"qpu_run_id": str(qpu_run_id), "device_id": device_id, "status": status.value},
        now=now,
    )


async def create_mention(
    scope: Scope,
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    comment_id: uuid.UUID,
    target_type: str,
    target_id: uuid.UUID,
    author_display_name: str | None,
    now: dt.datetime | None = None,
) -> NotificationRow:
    """Called from `comments._replace_mentions` for each NEWLY mentioned
    person only — re-saving a comment whose mentions did not change must not
    re-notify someone who was already told. `now` is the same testing seam
    `create_qpu_run_terminal` has."""
    return await _write(
        session,
        user_id=user_id,
        workspace_id=workspace_id,
        kind=NotificationKind.MENTION,
        summary=mention_summary(author_display_name),
        data={
            "comment_id": str(comment_id),
            "target_type": target_type,
            "target_id": str(target_id),
        },
        now=now,
    )


async def unread_count(scope: Scope, session: AsyncSession) -> int:
    stmt = (
        select(func.count())
        .select_from(NotificationRow)
        .where(NotificationRow.user_id == scope.user_id, NotificationRow.read_at.is_(None))
    )
    return int((await session.execute(stmt)).scalar_one())


async def list_notifications(
    scope: Scope,
    session: AsyncSession,
    *,
    cursor: uuid.UUID | None = None,
    limit: int = DEFAULT_PAGE,
) -> tuple[list[NotificationRow], int]:
    """The caller's own notifications, newest first, and their total unread
    count — the badge needs the whole number regardless of which page is open.
    """
    limit = min(max(limit, 1), MAX_PAGE)
    stmt = (
        select(NotificationRow)
        .where(NotificationRow.user_id == scope.user_id)
        .order_by(NotificationRow.id.desc())
        .limit(limit)
    )
    if cursor is not None:
        stmt = stmt.where(NotificationRow.id < cursor)
    rows = list((await session.execute(stmt)).scalars().all())
    unread = await unread_count(scope, session)
    return rows, unread


async def mark_read(
    scope: Scope, session: AsyncSession, notification_id: uuid.UUID
) -> NotificationRow:
    """Mark one of the caller's OWN notifications read. Idempotent.

    A notification belonging to anyone else is `NotFoundError` — the same
    "absent or not yours" the rest of the repository layer gives, and here it
    is load-bearing: a distinguishable 403 would confirm that a guessed id
    names a real notification, and whose it is.
    """
    row = (
        await session.execute(
            select(NotificationRow).where(
                NotificationRow.id == notification_id,
                NotificationRow.user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("notification")
    if row.read_at is None:
        row.read_at = touched_now()
        await session.flush()
    return row


async def mark_all_read(scope: Scope, session: AsyncSession) -> None:
    await session.execute(
        update(NotificationRow)
        .where(NotificationRow.user_id == scope.user_id, NotificationRow.read_at.is_(None))
        .values(read_at=touched_now())
    )
