"""Comments and @-mentions on runs, notebooks and saved circuits (proposal 9).

    GET    /v1/comments?target_type=&target_id=   the thread on one thing, oldest first
    POST   /v1/comments                           comment, or reply with `parent_id`
    PATCH  /v1/comments/{comment_id}              the author rewrites their comment
    DELETE /v1/comments/{comment_id}              the author, or an owner or admin
    GET    /v1/comments/mentions                  comments that mention me, newest first
    GET    /v1/comments/people                    who a comment here can mention

Who may do what is decided, and argued, in `repos/comments.py`'s module
docstring: every role reads, viewers do not write, only the author edits, and the
author or an owner/admin deletes. This module adds nothing to those rules; it
serializes, pages, and meters.

Every refusal that concerns a thing outside the caller's workspace is the same
404 the rest of the API gives for a row that does not exist, because the
repository layer raises the same `NotFoundError` for both.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import majorana_contracts as contracts
from fastapi import APIRouter, HTTPException, Query, Request, Response
from majorana_contracts import CommentTargetType, Scope

from ..auth.deps import CurrentScope, DbSession
from ..orm import Comment as CommentRow
from ..repos import comments as comments_repo
from ..request_models import RequestModel

router = APIRouter()

#: One page. The default suits a thread under a run; the ceiling keeps one
#: request from reading an unbounded thread into memory.
DEFAULT_PAGE = 50
MAX_PAGE = 100


class CreateCommentRequest(RequestModel, contracts.CreateCommentRequest):
    pass


class UpdateCommentRequest(RequestModel, contracts.UpdateCommentRequest):
    pass


def _person(person: comments_repo.Person) -> contracts.CommentPerson:
    return contracts.CommentPerson(
        user_id=person.user_id, display_name=person.display_name, handle=person.handle
    )


def _to_comment(
    scope: Scope, row: CommentRow, read: comments_repo.CommentRead
) -> contracts.Comment:
    deleted = row.deleted_at is not None
    if deleted:
        # The row keeps its place in the thread; nothing it said is served.
        author = None
        body = ""
        mentions: list[contracts.CommentPerson] = []
    else:
        person = read.people.get(row.author_user_id)
        author = (
            _person(person)
            if person is not None
            # Left the workspace. Still the author, but no longer described to it.
            else contracts.CommentPerson(user_id=row.author_user_id, current_member=False)
        )
        body = row.body
        mentions = sorted(
            (_person(read.people[uid]) for uid in read.mentions.get(row.id, [])),
            key=lambda p: p.handle,
        )
    return contracts.Comment(
        id=row.id,
        workspace_id=row.workspace_id,
        target_type=CommentTargetType(row.target_type),
        target_id=row.target_id,
        parent_id=row.parent_id,
        author=author,
        body=body,
        mentions=mentions,
        created_at=row.created_at,
        edited_at=row.edited_at,
        deleted_at=row.deleted_at,
        can_edit=comments_repo.may_edit(scope, row),
        can_delete=comments_repo.may_delete(scope, row),
    )


def _to_list(scope: Scope, read: comments_repo.CommentRead) -> contracts.CommentList:
    return contracts.CommentList(
        items=[_to_comment(scope, row, read) for row in read.comments],
        next_cursor=read.next_cursor,
    )


def _refused(exc: comments_repo.CommentRefused) -> HTTPException:
    sentences = {
        "parent_deleted": "That comment was deleted, so it can no longer be replied to.",
        "comment_deleted": "That comment was deleted, so it can no longer be edited.",
    }
    return HTTPException(
        409,
        detail={"error": sentences.get(exc.reason, "request refused"), "reason": exc.reason},
    )


def _meter(request: Request, scope: Scope) -> None:
    """Count one post against the caller's own per-minute ceiling.

    Keyed by the account, which is what is posting (see `DEFAULT_COMMENT_LIMIT`).
    Checked before the repository is called, so a refused post costs no query.
    """
    decision = request.app.state.comment_limiter.check(str(scope.user_id))
    if not decision.allowed:
        raise HTTPException(
            429,
            detail={
                "error": "You are posting comments faster than this allows. Wait a moment and try again.",
                "reason": "comment_rate_limited",
            },
            headers={"Retry-After": str(decision.retry_after_s)},
        )


@router.get("/comments/mentions", response_model=contracts.CommentList)
async def list_my_mentions(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = DEFAULT_PAGE,
) -> contracts.CommentList:
    """Comments in the active workspace that mention the caller, newest first.

    `cursor` is the previous page's `next_cursor`.
    """
    read = await comments_repo.list_mentions(scope, session, cursor=cursor, limit=limit)
    return _to_list(scope, read)


@router.get("/comments/people", response_model=contracts.CommentPeopleList)
async def list_mentionable_people(
    scope: CurrentScope, session: DbSession
) -> contracts.CommentPeopleList:
    """The current members of this workspace, with the handle that mentions each."""
    people = await comments_repo.list_people(scope, session)
    return contracts.CommentPeopleList(items=[_person(p) for p in people])


@router.get("/comments", response_model=contracts.CommentList)
async def list_comments(
    scope: CurrentScope,
    session: DbSession,
    target_type: CommentTargetType,
    target_id: uuid.UUID,
    cursor: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = DEFAULT_PAGE,
) -> contracts.CommentList:
    """The thread on one run, notebook or saved circuit, oldest first.

    404 when the target does not exist in the caller's workspace, whether it
    exists elsewhere or nowhere.
    """
    read = await comments_repo.list_comments(
        scope,
        session,
        target_type=target_type,
        target_id=target_id,
        cursor=cursor,
        limit=limit,
    )
    return _to_list(scope, read)


@router.post("/comments", response_model=contracts.Comment, status_code=201)
async def create_comment(
    request: Request, body: CreateCommentRequest, scope: CurrentScope, session: DbSession
) -> contracts.Comment:
    """Post a comment, or a reply when `parent_id` is set. Viewers get 403."""
    _meter(request, scope)
    try:
        read = await comments_repo.create_comment(
            scope,
            session,
            target_type=body.target_type,
            target_id=body.target_id,
            body=body.body,
            parent_id=body.parent_id,
        )
    except comments_repo.CommentRefused as exc:
        raise _refused(exc) from None
    return _to_comment(scope, read.comments[0], read)


@router.patch("/comments/{comment_id}", response_model=contracts.Comment)
async def update_comment(
    comment_id: uuid.UUID, body: UpdateCommentRequest, scope: CurrentScope, session: DbSession
) -> contracts.Comment:
    """The author rewrites their comment. Anyone else gets 403."""
    try:
        read = await comments_repo.update_comment(scope, session, comment_id, body=body.body)
    except comments_repo.CommentRefused as exc:
        raise _refused(exc) from None
    return _to_comment(scope, read.comments[0], read)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> Response:
    """Remove a comment from its thread. The author, or an owner or admin."""
    await comments_repo.delete_comment(scope, session, comment_id)
    return Response(status_code=204)
