"""Notification contracts — one recipient's inbox (ai-ops 349, "Job-finished
notifications"): a hardware run of theirs reached a terminal state, or someone
mentioned them in a comment.

Migration 0073 is the storage authority; this module is the shape a client
reads. `data` carries kind-specific fields snapshotted at write time (never a
pointer a client has to follow back to the run or comment, which may since
have changed) and is deliberately untyped here: `kind` is the discriminant a
client switches on, and each kind's fields are documented beside it rather
than modelled as a union, because nothing outside this file's own docstring
and the two writers in `services/api/src/majorana_api/repos/notifications.py`
needs to construct one.

## The two kinds, and what `data` holds for each

- `qpu_run_terminal`: `{"qpu_run_id": <uuid>, "device_id": <str>,
  "status": "done" | "error" | "cancelled"}` — the run's id (to link to
  `/studio/hardware`), its catalog device, and the status it closed on.
- `mention`: `{"comment_id": <uuid>, "target_type": "run" | "notebook" |
  "artifact", "target_id": <uuid>}` — enough to build the same link
  `apps/web/lib/comments.ts::targetHref` builds for the mentions page.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from .models import _ResourceBase

#: Mirrors migration 0073's `ck_notifications_summary_length`, the same
#: reasoning `MAX_COMMENT_CHARS` gives: a client learns the bound from a 422
#: instead of a 500.
MAX_NOTIFICATION_SUMMARY_CHARS = 280


class NotificationKind(StrEnum):
    QPU_RUN_TERMINAL = "qpu_run_terminal"
    MENTION = "mention"


class Notification(_ResourceBase):
    """One event in the recipient's inbox. `read_at` is None until read."""

    id: UUID
    kind: NotificationKind
    summary: str
    #: Kind-specific fields; see this module's docstring for the shape per kind.
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    read_at: datetime | None = None


class NotificationList(_ResourceBase):
    """A page of the caller's own notifications, newest first."""

    items: list[Notification]
    next_cursor: UUID | None = None
    #: The caller's TOTAL unread count, not merely how many of THIS page are
    #: unread — the bell badge needs the whole number regardless of which page
    #: is open, and a client would otherwise have to page through everything
    #: to add it up itself.
    unread_count: int
