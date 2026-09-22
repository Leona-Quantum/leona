"""Comment contracts — people in one workspace talking about a run, a notebook or a
saved circuit (proposal 9, "Working together, live", first slice: comments and
mentions; presence and co-editing are later slices and have no shape here yet).

Everything a comment names is inside ONE workspace: the thing it is on, the person
who wrote it, and the people it mentions. That is not a UI convention, it is what
the storage enforces (migration 0068) and what `services/api` checks on every
write, so none of these models carries an email address or anything else that
would describe a person to someone who could not already see them in the
workspace's own members list.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field, field_validator

from .models import _ResourceBase

#: The longest body a comment may carry, in characters. Mirrored by migration
#: 0068's `ck_comments_body_length`, which is the one that actually holds: this
#: bound exists so a client learns the limit from a 422 instead of a 500.
MAX_COMMENT_CHARS = 4000


class CommentTargetType(StrEnum):
    """What a comment is on, named after the entity the rest of the API uses.

    `artifact` is what Studio calls a saved circuit: the Studio page is
    `/studio?artifact=<id>` and the resource is `/v1/artifacts/<id>`. Closed on
    purpose — a new target type means a new existence check in the API and a new
    value in the database CHECK, not a string a client can invent.
    """

    RUN = "run"
    NOTEBOOK = "notebook"
    ARTIFACT = "artifact"


class CommentPerson(_ResourceBase):
    """A member as a comment shows them: a name and the handle that mentions them.

    `handle` is what follows `@` in a comment body. It is derived from the part of
    the member's email address before the `@`, which every member of the
    workspace can already read in its members list, and it becomes the whole
    address only when two current members would otherwise share one handle.

    Someone who has LEFT the workspace is still the author of what they wrote,
    but nothing about them is served any more: `current_member` is False, and
    `display_name` and `handle` are empty. Mentions never name a former member
    at all; they are dropped when read.
    """

    user_id: UUID
    display_name: str | None = None
    handle: str = ""
    current_member: bool = True


class Comment(_ResourceBase):
    """One comment, or one reply to a comment.

    A deleted comment keeps its place in its thread so the replies under it still
    read in order: `deleted_at` is set, and `body`, `author` and `mentions` are
    emptied in the response. The words are not served to anybody after deletion,
    including the person who wrote them.
    """

    id: UUID
    workspace_id: UUID
    target_type: CommentTargetType
    target_id: UUID
    #: The comment this one replies to. Threads are one level deep: a reply to a
    #: reply is stored as a reply to the comment at the top of that thread.
    parent_id: UUID | None = None
    #: None only when the comment is deleted.
    author: CommentPerson | None = None
    body: str = ""
    #: Current members this comment mentions. A person who has since left the
    #: workspace is dropped from this list when it is read.
    mentions: list[CommentPerson] = Field(default_factory=list)
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    #: What the CALLER may do with this comment, computed by the server so a
    #: client never re-derives the role rules. Always False on a deleted comment.
    can_edit: bool = False
    can_delete: bool = False


class CommentList(_ResourceBase):
    """A page of comments. `next_cursor` is the id to pass as `cursor` for the next
    page, and None on the last one."""

    items: list[Comment]
    next_cursor: UUID | None = None
    #: Whether the CALLER may post here, from their role in the workspace, so a
    #: client shows a viewer the thread without a composer they would be
    #: refused at. The server still decides on every post.
    can_comment: bool = False


class CommentPeopleList(_ResourceBase):
    """The current members a comment in this workspace can mention."""

    items: list[CommentPerson]


def _non_blank(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("a comment cannot be blank")
    return stripped


class CreateCommentRequest(_ResourceBase):
    target_type: CommentTargetType
    target_id: UUID
    body: str = Field(min_length=1, max_length=MAX_COMMENT_CHARS)
    parent_id: UUID | None = None

    @field_validator("body")
    @classmethod
    def body_not_blank(cls, value: str) -> str:
        return _non_blank(value)


class UpdateCommentRequest(_ResourceBase):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_CHARS)

    @field_validator("body")
    @classmethod
    def body_not_blank(cls, value: str) -> str:
        return _non_blank(value)
