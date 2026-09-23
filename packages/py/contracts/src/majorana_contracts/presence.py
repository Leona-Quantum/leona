"""Presence contracts — who else in the workspace is looking at a run, a
notebook or a saved circuit right now (proposal 9, "Working together, live",
second slice; the first, comments and mentions, is `comments.py`. Real
co-editing of a circuit is a later slice and has no shape here yet).

Presence names nothing about WHAT anyone said or did — only that they are
looking. That is deliberately less than a comment carries, and it is why this
model has no body, no thread and no history: `PresenceViewer` is a snapshot of
who is here right now, not a record of who was.
"""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import Field

from .models import _ResourceBase


class PresenceTargetType(StrEnum):
    """What presence is on. The same three kinds of thing `CommentTargetType`
    names, and the same values, but its own closed enum: presence and comments
    are independent features that happen to attach to the same three surfaces,
    and neither should have to change because the other's enum grew a member."""

    RUN = "run"
    NOTEBOOK = "notebook"
    ARTIFACT = "artifact"


class PresenceViewer(_ResourceBase):
    """One other current member looking at the same thing, right now.

    `handle` is the same derivation `CommentPerson.handle` uses (the part of a
    member's email before the `@`, widened to the full address on a collision),
    so a viewer with no `display_name` still has something to show. There is no
    email address here, for the same reason `CommentPerson` has none: everything
    it could say, a member can already read in the workspace's own members list.
    """

    user_id: UUID
    display_name: str | None = None
    handle: str = ""


class PresenceList(_ResourceBase):
    """Who else is here. Never includes the caller — a reader does not need to
    be told they are looking at their own screen."""

    viewers: list[PresenceViewer] = Field(default_factory=list)


class PresenceHeartbeatRequest(_ResourceBase):
    """`I am still looking at this.` Sent every ~15s while the tab is visible."""

    target_type: PresenceTargetType
    target_id: UUID
