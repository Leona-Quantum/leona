"""Course cohorts: named groups within a course (ai-ops 349 proposal 8).

`course_cohorts` and `course_cohort_members` resolve their tenant through
`courses`, exactly as `course_modules`/`course_turns` do (migration 0074's RLS
policies do the same, via `exists (select 1 from courses ...)`), so a cohort or
membership belonging to another workspace's course is `NotFoundError`, not a
403 — the same "absent or not yours" every course-scoped lookup gives.

This module depends on `repos.courses` (for `get_course`), and `repos.courses`
does not import this module back — `course_gradebook`'s cohort filter and its
`GradebookRow.cohort_name` column read `CourseCohort`/`CourseCohortMember`
directly off `..orm` instead, so the dependency stays one-directional.
"""

from __future__ import annotations

import uuid

import majorana_contracts as contracts
from majorana_contracts import Scope
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Course, CourseCohort as CourseCohortRow, CourseCohortMember, Membership, User
from ._base import AuthzError, NotFoundError, is_unique_violation, require_write, touched_now
from .audit import record_audit
from .courses import get_course

#: The unique index a duplicate cohort NAME within one course collides on
#: (`uq_course_cohorts_course_name`, migration 0074).
_NAME_INDEX = "uq_course_cohorts_course_name"


class CohortCreatorOnly(AuthzError):
    """Someone other than the course's creator tried to manage its cohorts.

    An `AuthzError`, so anything that does not catch it specifically still
    answers 403 through the app's handler — the same shape `courses.py`'s
    `DueDateCreatorOnly` gives due dates, for the identical reason (owner
    ruling ai-ops 260: the person who made the course decides who is in which
    section, and a classmate who could edit cohorts could move themselves, or
    someone else, into whichever one they liked).
    """


class DuplicateCohortName(Exception):
    """Another cohort of this course already has this name."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


class CourseMemberNotFound(Exception):
    """The user named is not a CURRENT member of this course's workspace."""

    def __init__(self, user_id: uuid.UUID) -> None:
        super().__init__(str(user_id))
        self.user_id = user_id


def _require_creator(scope: Scope, course: Course) -> None:
    """`require_write` first, then the creator check — the same order
    `courses.update_course` uses for due dates, so a workspace VIEWER who
    happens to have created a course (impossible today, kept anyway: role
    changes after creation are not) is refused by the role gate rather than
    let through on ownership alone."""
    require_write(scope)
    if scope.user_id != course.owner_user_id:
        raise CohortCreatorOnly("only the course creator may manage its cohorts")


async def _get_cohort(
    session: AsyncSession, course_id: uuid.UUID, cohort_id: uuid.UUID
) -> CourseCohortRow:
    row = (
        await session.execute(
            select(CourseCohortRow).where(
                CourseCohortRow.id == cohort_id, CourseCohortRow.course_id == course_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("course cohort")
    return row


async def create_cohort(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, *, name: str
) -> CourseCohortRow:
    course = await get_course(scope, session, course_id)
    _require_creator(scope, course)
    row = CourseCohortRow(id=uuid7(), course_id=course.id, name=name)
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        if is_unique_violation(exc, _NAME_INDEX):
            raise DuplicateCohortName(name) from None
        raise
    await record_audit(
        scope,
        session,
        action="course_cohort.created",
        target_kind="course_cohort",
        target_id=row.id,
    )
    await session.refresh(row)
    return row


async def update_cohort(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, cohort_id: uuid.UUID, *, name: str
) -> CourseCohortRow:
    course = await get_course(scope, session, course_id)
    _require_creator(scope, course)
    row = await _get_cohort(session, course.id, cohort_id)
    row.name = name
    row.updated_at = touched_now()
    try:
        await session.flush()
    except IntegrityError as exc:
        if is_unique_violation(exc, _NAME_INDEX):
            raise DuplicateCohortName(name) from None
        raise
    return row


async def delete_cohort(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, cohort_id: uuid.UUID
) -> None:
    """Delete the cohort. Its members are not moved anywhere — `ondelete=CASCADE`
    on the composite foreign key removes their `course_cohort_members` rows with
    it, which is exactly "no cohort" for a member: there is no third state
    between belonging to a cohort and belonging to none."""
    course = await get_course(scope, session, course_id)
    _require_creator(scope, course)
    row = await _get_cohort(session, course.id, cohort_id)
    await record_audit(
        scope,
        session,
        action="course_cohort.deleted",
        target_kind="course_cohort",
        target_id=row.id,
    )
    await session.delete(row)
    await session.flush()


async def set_membership(
    scope: Scope,
    session: AsyncSession,
    course_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    cohort_id: uuid.UUID | None,
) -> None:
    """Assign, move or clear `user_id`'s cohort for this course.

    An upsert onto `course_cohort_members`' primary key `(course_id, user_id)`,
    never a delete-then-insert: the row for a member who already has a cohort
    is updated in place, so there is no instant where a concurrent gradebook
    read could see them in neither.
    """
    course = await get_course(scope, session, course_id)
    _require_creator(scope, course)
    is_member = (
        await session.execute(
            select(Membership.user_id).where(
                Membership.workspace_id == course.workspace_id, Membership.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if is_member is None:
        raise CourseMemberNotFound(user_id)

    if cohort_id is None:
        await session.execute(
            sa_delete(CourseCohortMember).where(
                CourseCohortMember.course_id == course.id, CourseCohortMember.user_id == user_id
            )
        )
        await session.flush()
        return

    await _get_cohort(session, course.id, cohort_id)  # 404s a cohort from elsewhere
    existing = (
        await session.execute(
            select(CourseCohortMember).where(
                CourseCohortMember.course_id == course.id, CourseCohortMember.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(CourseCohortMember(course_id=course.id, user_id=user_id, cohort_id=cohort_id))
    else:
        existing.cohort_id = cohort_id
    await session.flush()


async def _rosters(
    session: AsyncSession, course_id: uuid.UUID, cohort_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[contracts.CohortMember]]:
    if not cohort_ids:
        return {}
    rows = (
        await session.execute(
            select(CourseCohortMember.cohort_id, User.id, User.email, User.display_name)
            .join(User, User.id == CourseCohortMember.user_id)
            .where(
                CourseCohortMember.course_id == course_id,
                CourseCohortMember.cohort_id.in_(cohort_ids),
            )
            .order_by(CourseCohortMember.cohort_id, User.email)
        )
    ).all()
    result: dict[uuid.UUID, list[contracts.CohortMember]] = {}
    for cohort_id, user_id, email, display_name in rows:
        result.setdefault(cohort_id, []).append(
            contracts.CohortMember(user_id=user_id, email=email, display_name=display_name)
        )
    return result


async def cohort_to_resource(session: AsyncSession, row: CourseCohortRow) -> contracts.CourseCohort:
    """One cohort, roster included. Used by `create_cohort`/`update_cohort`'s
    routes, where there is exactly one row to resource-ify and `list_cohorts`'
    batched `_rosters` call would be one query for one cohort."""
    members = (await _rosters(session, row.course_id, [row.id])).get(row.id, [])
    return contracts.CourseCohort(
        id=row.id,
        course_id=row.course_id,
        name=row.name,
        members=members,
        member_count=len(members),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_cohorts(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID
) -> contracts.CourseCohortList:
    """The course's cohorts. **The creator gets every cohort with its full
    roster; anyone else gets at most one — their own — with none.** Owner
    ruling ai-ops 260's line, drawn the same way `course_gradebook` draws it:
    workspace role is not the test, `courses.owner_user_id` is.
    """
    course = await get_course(scope, session, course_id)
    creator = scope.user_id == course.owner_user_id
    cohorts = (
        (
            await session.execute(
                select(CourseCohortRow)
                .where(CourseCohortRow.course_id == course.id)
                .order_by(CourseCohortRow.name)
            )
        )
        .scalars()
        .all()
    )

    if creator:
        rosters = await _rosters(session, course.id, [row.id for row in cohorts])
        items = [
            contracts.CourseCohort(
                id=row.id,
                course_id=row.course_id,
                name=row.name,
                members=rosters.get(row.id, []),
                member_count=len(rosters.get(row.id, [])),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in cohorts
        ]
        return contracts.CourseCohortList(
            course_id=course.id, visibility=contracts.CohortVisibility.ALL_COHORTS, items=items
        )

    own = (
        await session.execute(
            select(CourseCohortRow)
            .join(CourseCohortMember, CourseCohortMember.cohort_id == CourseCohortRow.id)
            .where(
                CourseCohortMember.course_id == course.id,
                CourseCohortMember.user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    items = []
    if own is not None:
        # `member_count` is meaningful only under ALL_COHORTS (see the field's
        # docstring); 0 here rather than the real count, which this caller is
        # not shown anywhere else either.
        items.append(
            contracts.CourseCohort(
                id=own.id,
                course_id=own.course_id,
                name=own.name,
                members=[],
                member_count=0,
                created_at=own.created_at,
                updated_at=own.updated_at,
            )
        )
    return contracts.CourseCohortList(
        course_id=course.id, visibility=contracts.CohortVisibility.OWN_COHORT, items=items
    )
