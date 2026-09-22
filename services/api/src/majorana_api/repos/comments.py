"""Scoped storage for comments and the people they mention (migration 0068).

## Who may do what — an owner-visible decision, written down here on purpose

- **Read**: every role, viewers included. A viewer "can read everything" in a
  workspace (INVITE_COPY, `apps/web/lib/workspace-locale.ts`), and a comment is part
  of the thing it is on.
- **Write** (comment, reply, edit): owner, admin and member. NOT viewer. The
  viewer role is described to the person holding it as "cannot run or save", and a
  comment is something saved into the workspace for everyone in it to read, so the
  conservative reading is that a viewer cannot leave one. If the owner wants viewers
  to comment, this is the one line to change (`require_write` below and the two
  `WRITE_ROLES` checks in `may_edit`/`_may_remove`), and the tests that pin it
  are `test_viewer_cannot_write` and `test_viewer_reads_but_cannot_write`.
- **Edit**: the author only, and only while they still hold a writing role. An
  admin can remove a comment but cannot put words in someone else's mouth.
- **Delete**: the author, or an owner or admin of the workspace (moderation). A
  deletion by someone other than the author is written to the audit log.

## Isolation

Every function applies `scope.workspace_id` itself, like the rest of this layer.
The thing a comment is on is checked through the SAME scoped getter its own routes
use (`runs.get_run`, `notebooks.get_notebook`, `artifacts.get_artifact`), so a
comment on another workspace's run is `NotFoundError` for exactly the reason that
run is, and indistinguishable from a run that does not exist.

Mentions resolve against the current members of `scope.workspace_id` and nobody
else (`mentions.py`). When read back, a mention of someone who has since left is
dropped, and an author who has since left is served with no name or handle.
"""

from __future__ import annotations

import dataclasses
import uuid

from majorana_contracts import CommentTargetType, Scope
from sqlalchemy import and_, delete, exists, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..mentions import Member, handles_for, resolve_mentions
from ..orm import Artifact, Comment, CommentMention, Membership, Notebook, User
from . import artifacts as artifacts_repo
from . import notebooks as notebooks_repo
from . import runs as runs_repo
from ._base import ADMIN_ROLES, WRITE_ROLES, AuthzError, NotFoundError, RepoError
from ._base import is_unique_violation, require_write, touched_now
from .audit import record_audit


class CommentRefused(RepoError):
    """A well-formed request the state of the thread will not take.

    `reason` is the token the route puts on the 409 so a client can say what
    happened in its own words.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


#: The partial unique index migration 0068 creates on
#: (workspace_id, author_user_id, idempotency_key).
_IDEMPOTENCY_INDEX = "uq_comments_author_idempotency_key"


class CommentIdempotencyKeyInFlight(RepoError):
    """Another request from the same author holds this Idempotency-Key and won the
    insert. Raised here so the route never has to know which index refused it, and
    never has to import sqlalchemy to find out (AGENTS.md rule 2)."""


@dataclasses.dataclass(frozen=True)
class Person:
    """A CURRENT member of the workspace, with the handle that mentions them."""

    user_id: uuid.UUID
    display_name: str | None
    handle: str


@dataclasses.dataclass
class CommentRead:
    """Rows plus what a route needs to serialize them without another query.

    `mentions` holds only people who are still members; `people` is keyed by
    user id and holds every current member, so an author missing from it has
    left the workspace.
    """

    comments: list[Comment]
    mentions: dict[uuid.UUID, list[uuid.UUID]]
    people: dict[uuid.UUID, Person]
    next_cursor: uuid.UUID | None = None


def may_comment(scope: Scope) -> bool:
    """Whether this caller may post or reply at all. The same set `require_write`
    enforces on every write below, stated once so a client is told the truth."""
    return scope.role in WRITE_ROLES


def may_edit(scope: Scope, row: Comment) -> bool:
    return (
        row.deleted_at is None and scope.role in WRITE_ROLES and row.author_user_id == scope.user_id
    )


def _may_remove(scope: Scope, row: Comment) -> bool:
    """Delete permission, regardless of whether the comment is already deleted."""
    return scope.role in WRITE_ROLES and (
        row.author_user_id == scope.user_id or scope.role in ADMIN_ROLES
    )


def may_delete(scope: Scope, row: Comment) -> bool:
    return row.deleted_at is None and _may_remove(scope, row)


# ------------------------------------------------------------------------------ members


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


def _people(members: list[Member]) -> dict[uuid.UUID, Person]:
    handles = handles_for(members)
    return {
        m.user_id: Person(user_id=m.user_id, display_name=m.display_name, handle=handles[m.user_id])
        for m in members
    }


async def list_people(scope: Scope, session: AsyncSession) -> list[Person]:
    """Everyone the caller can mention here, in membership order: every other
    current member. Not the caller, because a mention of yourself never resolves.

    No role gate beyond membership: this is the members list the caller can
    already read at `GET /v1/workspace`, minus the email addresses. Handles are
    derived from the WHOLE membership, caller included, so a collision with the
    caller's own handle still gives the other member their full address.
    """
    people = _people(await _members(scope, session))
    return [person for user_id, person in people.items() if user_id != scope.user_id]


# ------------------------------------------------------------------------------ targets


async def _require_target(
    scope: Scope, session: AsyncSession, target_type: CommentTargetType, target_id: uuid.UUID
) -> None:
    """Absent, deleted, or in another workspace: all three are the same NotFoundError."""
    if target_type == CommentTargetType.RUN:
        await runs_repo.get_run(scope, session, target_id)
    elif target_type == CommentTargetType.NOTEBOOK:
        await notebooks_repo.get_notebook(scope, session, target_id)
    elif target_type == CommentTargetType.ARTIFACT:
        await artifacts_repo.get_artifact(scope, session, target_id)
    else:  # pragma: no cover - the enum is closed, and so is the column's CHECK
        raise NotFoundError("comment target")


def _target_is_live():
    """A comment whose notebook or artifact was deleted drops out of the inbox.

    Runs are never deleted, so a run target is always live. Written as EXISTS
    against the same workspace the comment is in, so the check cannot be satisfied
    by a same-id row somewhere else.
    """
    return or_(
        Comment.target_type == CommentTargetType.RUN.value,
        and_(
            Comment.target_type == CommentTargetType.NOTEBOOK.value,
            exists().where(
                Notebook.id == Comment.target_id,
                Notebook.workspace_id == Comment.workspace_id,
                Notebook.deleted_at.is_(None),
            ),
        ),
        and_(
            Comment.target_type == CommentTargetType.ARTIFACT.value,
            exists().where(
                Artifact.id == Comment.target_id,
                Artifact.workspace_id == Comment.workspace_id,
                Artifact.deleted_at.is_(None),
            ),
        ),
    )


# ------------------------------------------------------------------------------ reads


async def _get_row(
    scope: Scope, session: AsyncSession, comment_id: uuid.UUID, *, for_update: bool = False
) -> Comment:
    stmt = select(Comment).where(
        Comment.id == comment_id, Comment.workspace_id == scope.workspace_id
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        raise NotFoundError("comment")
    return row


async def _mentions_of(
    scope: Scope, session: AsyncSession, comment_ids: list[uuid.UUID], current: set[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    found: dict[uuid.UUID, list[uuid.UUID]] = {cid: [] for cid in comment_ids}
    if not comment_ids:
        return found
    rows = (
        await session.execute(
            select(CommentMention.comment_id, CommentMention.mentioned_user_id)
            .where(
                CommentMention.workspace_id == scope.workspace_id,
                CommentMention.comment_id.in_(comment_ids),
            )
            .order_by(CommentMention.comment_id, CommentMention.mentioned_user_id)
        )
    ).all()
    for row in rows:
        # Someone who left after being mentioned: dropped on read, never served.
        if row.mentioned_user_id in current:
            found[row.comment_id].append(row.mentioned_user_id)
    return found


async def _read(
    scope: Scope,
    session: AsyncSession,
    rows: list[Comment],
    *,
    next_cursor: uuid.UUID | None = None,
) -> CommentRead:
    people = _people(await _members(scope, session))
    mentions = await _mentions_of(scope, session, [r.id for r in rows], set(people))
    return CommentRead(comments=rows, mentions=mentions, people=people, next_cursor=next_cursor)


def _page(rows: list[Comment], limit: int) -> tuple[list[Comment], uuid.UUID | None]:
    if len(rows) > limit:
        rows = rows[:limit]
        return rows, rows[-1].id
    return rows, None


async def list_comments(
    scope: Scope,
    session: AsyncSession,
    *,
    target_type: CommentTargetType,
    target_id: uuid.UUID,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> CommentRead:
    """The thread on one target, oldest first, deleted comments included.

    Oldest first over every comment on the target, replies included, rather than
    per thread: a reply is always newer than its parent (uuid7 ids), so a client
    that accumulates pages always has the parent before the reply arrives.
    """
    await _require_target(scope, session, target_type, target_id)
    stmt = (
        select(Comment)
        .where(
            Comment.workspace_id == scope.workspace_id,
            Comment.target_type == target_type.value,
            Comment.target_id == target_id,
        )
        .order_by(Comment.id)
        .limit(limit + 1)
    )
    if cursor is not None:
        stmt = stmt.where(Comment.id > cursor)
    rows, next_cursor = _page(list((await session.execute(stmt)).scalars().all()), limit)
    return await _read(scope, session, rows, next_cursor=next_cursor)


async def list_mentions(
    scope: Scope, session: AsyncSession, *, cursor: uuid.UUID | None = None, limit: int = 50
) -> CommentRead:
    """Comments in this workspace that mention the caller, newest first.

    Scoped to the active workspace like every other read: a person in two
    workspaces sees each one's mentions while they are in it. Deleted comments,
    and comments whose notebook or saved circuit was deleted, are left out.
    """
    stmt = (
        select(Comment)
        .join(
            CommentMention,
            and_(
                CommentMention.comment_id == Comment.id,
                CommentMention.workspace_id == Comment.workspace_id,
            ),
        )
        .where(
            CommentMention.workspace_id == scope.workspace_id,
            CommentMention.mentioned_user_id == scope.user_id,
            Comment.workspace_id == scope.workspace_id,
            Comment.deleted_at.is_(None),
            _target_is_live(),
        )
        .order_by(CommentMention.comment_id.desc())
        .limit(limit + 1)
    )
    if cursor is not None:
        stmt = stmt.where(CommentMention.comment_id < cursor)
    rows, next_cursor = _page(list((await session.execute(stmt)).scalars().all()), limit)
    return await _read(scope, session, rows, next_cursor=next_cursor)


async def find_by_idempotency_key(
    scope: Scope, session: AsyncSession, idempotency_key: str
) -> Comment | None:
    """The comment THIS author posted in THIS workspace under this key, if any.

    Keyed on the author as well as the workspace, like the index: a key is the
    caller's own, so another member's comment is never what a retry gets back.
    """
    return (
        (
            await session.execute(
                select(Comment).where(
                    Comment.workspace_id == scope.workspace_id,
                    Comment.author_user_id == scope.user_id,
                    Comment.idempotency_key == idempotency_key,
                )
            )
        )
        .scalars()
        .first()
    )


async def read_one(scope: Scope, session: AsyncSession, row: Comment) -> CommentRead:
    """One stored comment, with what a route needs to serialize it."""
    return await _read(scope, session, [row])


# ------------------------------------------------------------------------------ writes


async def _replace_mentions(
    scope: Scope, session: AsyncSession, row: Comment, members: list[Member]
) -> None:
    await session.execute(
        delete(CommentMention).where(
            CommentMention.workspace_id == scope.workspace_id,
            CommentMention.comment_id == row.id,
        )
    )
    for user_id in resolve_mentions(row.body, members, author_user_id=row.author_user_id):
        session.add(
            CommentMention(
                comment_id=row.id, mentioned_user_id=user_id, workspace_id=scope.workspace_id
            )
        )


async def create_comment(
    scope: Scope,
    session: AsyncSession,
    *,
    target_type: CommentTargetType,
    target_id: uuid.UUID,
    body: str,
    parent_id: uuid.UUID | None = None,
    idempotency_key: str | None = None,
    idempotency_request_hash: str | None = None,
) -> CommentRead:
    """A new comment, or a reply when `parent_id` is set.

    `idempotency_key` and its request hash are stored with the row. The route looks
    a key up first (`find_by_idempotency_key`); this only has to turn the race two
    concurrent retries can still run, both past that lookup, into
    `CommentIdempotencyKeyInFlight` rather than a 500.

    Threads are one level deep. A reply to a reply is filed under the comment at
    the top of that thread rather than refused, because the person replying meant
    "this conversation", and the top of it is where that conversation lives. A
    reply to a deleted comment is refused: there is nothing left to answer.
    """
    require_write(scope)
    await _require_target(scope, session, target_type, target_id)

    top_id: uuid.UUID | None = None
    if parent_id is not None:
        parent = await _thread_row(scope, session, parent_id, target_type, target_id)
        if parent.parent_id is not None:
            parent = await _thread_row(scope, session, parent.parent_id, target_type, target_id)
        if parent.deleted_at is not None:
            raise CommentRefused("parent_deleted")
        top_id = parent.id

    row = Comment(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        target_type=target_type.value,
        target_id=target_id,
        author_user_id=scope.user_id,
        parent_id=top_id,
        body=body,
        idempotency_key=idempotency_key,
        idempotency_request_hash=idempotency_request_hash,
    )
    session.add(row)
    # The mention rows reference the comment through a foreign key, so it has to
    # exist first.
    try:
        await session.flush()
    except IntegrityError as exc:
        # ONLY the idempotency index, by name. Any other constraint failing here
        # is a real fault and must not be answered "retry to receive it".
        if idempotency_key is not None and is_unique_violation(exc, _IDEMPOTENCY_INDEX):
            raise CommentIdempotencyKeyInFlight(idempotency_key) from exc
        raise
    members = await _members(scope, session)
    await _replace_mentions(scope, session, row, members)
    await session.flush()
    await session.refresh(row)
    return await _read(scope, session, [row])


async def _thread_row(
    scope: Scope,
    session: AsyncSession,
    comment_id: uuid.UUID,
    target_type: CommentTargetType,
    target_id: uuid.UUID,
) -> Comment:
    """A comment on THIS target in THIS workspace. A parent anywhere else is absent."""
    row = (
        (
            await session.execute(
                select(Comment).where(
                    Comment.id == comment_id,
                    Comment.workspace_id == scope.workspace_id,
                    Comment.target_type == target_type.value,
                    Comment.target_id == target_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise NotFoundError("comment")
    return row


async def update_comment(
    scope: Scope, session: AsyncSession, comment_id: uuid.UUID, *, body: str
) -> CommentRead:
    """The author rewrites their own comment. Mentions are re-read from the new text."""
    require_write(scope)
    row = await _get_row(scope, session, comment_id, for_update=True)
    if row.author_user_id != scope.user_id:
        raise AuthzError("only the author can edit a comment")
    if row.deleted_at is not None:
        raise CommentRefused("comment_deleted")
    row.body = body
    row.edited_at = touched_now()
    await session.flush()
    await _replace_mentions(scope, session, row, await _members(scope, session))
    await session.flush()
    return await _read(scope, session, [row])


async def delete_comment(scope: Scope, session: AsyncSession, comment_id: uuid.UUID) -> None:
    """Soft delete. The row keeps its place in the thread; its words stop being served.

    Deleting a comment that is already deleted is a no-op for anyone who could
    have deleted it, so a retried request does not turn into an error.
    """
    require_write(scope)
    row = await _get_row(scope, session, comment_id, for_update=True)
    if not _may_remove(scope, row):
        raise AuthzError("only the author or a workspace admin can delete a comment")
    if row.deleted_at is not None:
        return
    row.deleted_at = touched_now()
    # Nobody's inbox should keep pointing at words that are gone.
    await session.execute(
        delete(CommentMention).where(
            CommentMention.workspace_id == scope.workspace_id,
            CommentMention.comment_id == row.id,
        )
    )
    if row.author_user_id != scope.user_id:
        # Moderation, not housekeeping: "who removed what I wrote" is a question
        # the author can ask, and the admin who did it is the answer.
        await record_audit(
            scope,
            session,
            action="comment.removed_by_admin",
            target_kind="comment",
            target_id=row.id,
            meta={"author_user_id": str(row.author_user_id)},
        )
    await session.flush()
