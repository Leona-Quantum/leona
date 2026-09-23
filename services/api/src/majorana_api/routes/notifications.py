"""In-app notifications (ai-ops 349, option 2, "Job-finished notifications").

    GET  /v1/notifications                    the caller's own inbox, newest first
    POST /v1/notifications/{id}/read          mark one of the caller's own read
    POST /v1/notifications/read-all           mark every one of the caller's own read

Two producers write rows here — a hardware run of the caller's reaching a
terminal state (`repos/qpu_runs.py::transition`), and someone mentioning them
in a comment (`repos/comments.py::_replace_mentions`) — but this module knows
nothing about either. It only ever reads and marks the caller's own rows, the
same "absent or not yours" `NotFoundError` the rest of the repository layer
gives everywhere else.

Personal-access-token callers: every route here is a `GET` except the two
marks, and neither mark appears in `auth/token_access.py`'s allowlists, so a
token can read this inbox but never mark anything in it read — the default-shut
rule, with nothing added on purpose.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import majorana_contracts as contracts
from fastapi import APIRouter, HTTPException, Query, Response

from ..auth.deps import CurrentScope, DbSession
from ..repos import notifications as notifications_repo
from ..repos._base import NotFoundError

router = APIRouter()


@router.get("/notifications", response_model=contracts.NotificationList)
async def list_notifications(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=notifications_repo.MAX_PAGE)] = (
        notifications_repo.DEFAULT_PAGE
    ),
) -> contracts.NotificationList:
    """The caller's own notifications, newest first, and their total unread
    count — the bell badge needs the whole number regardless of which page of
    the inbox is open."""
    rows, unread = await notifications_repo.list_notifications(
        scope, session, cursor=cursor, limit=limit
    )
    return contracts.NotificationList(
        items=[notifications_repo.to_resource(row) for row in rows],
        next_cursor=rows[-1].id if len(rows) == limit else None,
        unread_count=unread,
    )


@router.post("/notifications/{notification_id}/read", status_code=204)
async def mark_notification_read(
    notification_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> Response:
    """Mark one of the caller's own notifications read. Idempotent, and a
    notification belonging to anyone else is 404 rather than 403 — see
    `notifications_repo.mark_read`."""
    try:
        await notifications_repo.mark_read(scope, session, notification_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="unknown notification") from None
    return Response(status_code=204)


@router.post("/notifications/read-all", status_code=204)
async def mark_all_notifications_read(scope: CurrentScope, session: DbSession) -> Response:
    """Mark every one of the caller's own unread notifications read."""
    await notifications_repo.mark_all_read(scope, session)
    return Response(status_code=204)
