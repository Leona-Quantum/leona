"""Scoped storage for courses, their modules, and the chat turns that revise the plan.

`course_modules` and `course_turns` resolve their tenant through `courses` (migration
0059's RLS policies do the same, via `exists (select 1 from courses ...)`), so a module
or turn belonging to another workspace's course is `NotFoundError`, not a 403 — the same
"absent or not yours" the rest of the repository layer gives.

Two things this module derives rather than stores, both because nothing is in a position
to write them:

- **A module's status.** It is the status of its notebook's latest version, and the
  notebook lane's `notebook.generate` handler has never heard of courses. Storing a copy
  would mean a second writer for a fact the notebooks tables already hold, and the copy
  would be wrong from the first time a reader re-ran a notebook.
- **A course being `ready`.** Same reason, one level up: the last module's generation job
  finishes without knowing it was the last, so no writer observes the transition.
  `_derive_status` reports it from the modules; the stored column keeps saying
  `generating`. `set_course_status` still exists and is used for the transitions a caller
  *does* observe (planning → planned → generating, and planning → failed).
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import majorana_contracts as contracts
from majorana_contracts import Scope
from majorana_contracts.courses import CoursePlan, PlannedModule
from pydantic import ValidationError
from sqlalchemy import and_, case, cast, func, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import (
    Course,
    CourseModule,
    CourseTurn,
    Membership,
    Notebook,
    NotebookVersion,
    Run,
    RunEvent,
    User,
)
from ._base import AuthzError, NotFoundError, require_write, touched_now
from .audit import record_audit

#: How far seqs are pushed out of the way while a course is being renumbered.
#: `uq_course_modules_seq` is checked per statement, so an in-place reorder would
#: collide with a row that has not moved yet; every reorder is therefore two
#: passes, out and back. Safe because a plan is capped at 16 modules and the only
#: constraint on `seq` is `>= 1`.
_SEQ_PARK = 1_000


def _required(value: Any, name: str) -> Any:
    if value is None:
        raise RuntimeError(f"persisted course row is missing {name}")
    return value


# ----------------------------------------------------------------------------- courses


async def create_course(
    scope: Scope,
    session: AsyncSession,
    *,
    slug: str,
    title: str,
    summary: str = "",
    brief: str,
    audience: dict[str, Any],
    style: dict[str, Any],
    framework: dict[str, Any],
    language: str,
    plan_run_id: uuid.UUID | None,
) -> Course:
    """Create the course in `planning`. Modules arrive later, from the plan."""
    require_write(scope)
    course = Course(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        owner_user_id=scope.user_id,
        slug=slug,
        title=title,
        summary=summary,
        brief=brief,
        audience=audience,
        style=style,
        framework=framework,
        language=language,
        status=contracts.CourseStatus.PLANNING.value,
        plan_run_id=plan_run_id,
        plan=None,
    )
    session.add(course)
    await record_audit(
        scope,
        session,
        action="course.created",
        target_kind="course",
        target_id=course.id,
    )
    await session.flush()
    await session.refresh(course)
    return course


async def get_course(scope: Scope, session: AsyncSession, course_id: uuid.UUID) -> Course:
    row = (
        await session.execute(
            select(Course).where(
                Course.id == course_id,
                Course.workspace_id == scope.workspace_id,
                Course.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("course")
    return row


async def get_course_by_run_id(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> Course | None:
    """The course a plan run belongs to — backs idempotent replay of `POST
    /courses`, the same way `notebooks_repo.get_version_by_run_id` does there."""
    return (
        await session.execute(
            select(Course).where(
                Course.plan_run_id == run_id,
                Course.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def list_courses(
    scope: Scope, session: AsyncSession, *, cursor: uuid.UUID | None = None, limit: int = 50
) -> list[Course]:
    stmt = (
        select(Course)
        .where(Course.workspace_id == scope.workspace_id, Course.deleted_at.is_(None))
        .order_by(Course.id.desc())
        .limit(limit)
    )
    if cursor is not None:  # UUIDv7 PKs are time-ordered: id is the cursor
        stmt = stmt.where(Course.id < cursor)
    return list((await session.execute(stmt)).scalars().all())


async def set_course_status(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, status: str
) -> Course:
    require_write(scope)
    course = await get_course(scope, session, course_id)
    course.status = status
    course.updated_at = touched_now()
    await session.flush()
    return course


async def soft_delete_course(scope: Scope, session: AsyncSession, course_id: uuid.UUID) -> None:
    """Soft-delete the course. The notebooks its modules generated are ordinary
    notebooks and are deliberately left alone — the reader keeps what was built."""
    require_write(scope)
    course = await get_course(scope, session, course_id)
    now = touched_now()
    course.deleted_at = now
    course.updated_at = now
    await record_audit(
        scope,
        session,
        action="course.deleted",
        target_kind="course",
        target_id=course.id,
    )
    await session.flush()


# ----------------------------------------------------------------------------- modules


async def list_modules(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID
) -> list[CourseModule]:
    course = await get_course(scope, session, course_id)
    return list(
        (
            await session.execute(
                select(CourseModule)
                .where(CourseModule.course_id == course.id)
                .order_by(CourseModule.seq.asc())
            )
        )
        .scalars()
        .all()
    )


async def get_module(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, module_id: uuid.UUID
) -> CourseModule:
    course = await get_course(scope, session, course_id)
    row = (
        await session.execute(
            select(CourseModule).where(
                CourseModule.id == module_id, CourseModule.course_id == course.id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("course module")
    return row


def _apply_planned(row: CourseModule, module: PlannedModule) -> None:
    row.slug = module.slug
    row.title = module.title
    row.topic = module.topic
    row.key_concepts = list(module.key_concepts)
    row.objectives = list(module.objectives)
    row.deliverable = module.deliverable
    row.kind = module.kind.value
    row.duration_minutes = module.duration_minutes
    row.prerequisites = list(module.prerequisites)
    row.brief = module.brief


async def replace_modules(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, plan: CoursePlan
) -> list[CourseModule]:
    """Rewrite a course's modules from a plan, keeping generated work.

    A row whose slug appears in the new plan survives. If it already has a
    notebook its CONTENT is left alone as well — the notebook was generated from
    those exact fields, and rewriting them would leave the module describing
    something the notebook does not teach (the same rule `update_course` applies
    to a hand edit). A surviving row with no notebook is refreshed from the plan;
    a slug the plan no longer names is deleted, notebook or not, because the
    reader asked for it to go and the notebook itself outlives the module.
    """
    require_write(scope)
    course = await get_course(scope, session, course_id)
    existing = {row.slug: row for row in await list_modules(scope, session, course_id)}
    planned_slugs = [module.slug for module in plan.modules]

    removed = [row.id for slug, row in existing.items() if slug not in set(planned_slugs)]
    if removed:
        await session.execute(
            sa_delete(CourseModule).where(
                CourseModule.course_id == course.id, CourseModule.id.in_(removed)
            )
        )
        await session.flush()

    survivors = [existing[slug] for slug in planned_slugs if slug in existing]
    for offset, row in enumerate(survivors, start=1):
        row.seq = _SEQ_PARK + offset
    await session.flush()

    ordered: list[CourseModule] = []
    for index, module in enumerate(plan.modules, start=1):
        row = existing.get(module.slug)
        if row is None:
            row = CourseModule(id=uuid7(), course_id=course.id, seq=index, slug=module.slug)
            _apply_planned(row, module)
            session.add(row)
        else:
            row.seq = index
            if row.notebook_id is None:
                _apply_planned(row, module)
            row.updated_at = touched_now()
        ordered.append(row)

    course.plan = plan.model_dump(mode="json")
    course.title = plan.title
    if plan.summary:
        course.summary = plan.summary
    course.updated_at = touched_now()
    await session.flush()
    return ordered


def plan_from_modules(course: Any, modules: list[Any]) -> CoursePlan:
    """The plan as the reader currently sees it, rebuilt from the stored rows.

    NOT `CoursePlan.model_validate(course.plan)`. That column is what the planner
    last returned; a hand edit through `PATCH /courses/{id}` moves the rows and
    leaves it untouched. Two callers need this and must not disagree: the export
    route renders the zip from it, and the worker's revise handler sends it to the
    model as "the current plan" — if those two diverged, a reader would download a
    course that did not match the one they had just been editing in chat.

    `model_construct`, so no validator runs: a hand reorder can legitimately leave
    a prerequisite pointing forward, and refusing to export or revise a course the
    reader can see on screen would be the wrong answer to that. `getattr` on the
    optional fields because the worker drives this through a store double whose
    rows are not ORM instances.
    """
    return CoursePlan.model_construct(
        title=getattr(course, "title", "") or "Course",
        summary=getattr(course, "summary", "") or "",
        modules=[
            PlannedModule(
                slug=module.slug,
                title=module.title,
                topic=getattr(module, "topic", "") or "",
                key_concepts=list(getattr(module, "key_concepts", None) or []),
                objectives=list(getattr(module, "objectives", None) or []),
                deliverable=getattr(module, "deliverable", "") or "",
                kind=contracts.NotebookKind(module.kind),
                duration_minutes=getattr(module, "duration_minutes", None),
                prerequisites=list(getattr(module, "prerequisites", None) or []),
                brief=getattr(module, "brief", "") or "",
            )
            for module in modules
        ],
    )


async def attach_module_notebook(
    scope: Scope,
    session: AsyncSession,
    course_id: uuid.UUID,
    module_id: uuid.UUID,
    notebook_id: uuid.UUID,
) -> CourseModule:
    require_write(scope)
    module = await get_module(scope, session, course_id, module_id)
    module.notebook_id = notebook_id
    module.updated_at = touched_now()
    await session.flush()
    return module


class ModuleAlreadyGenerated(Exception):
    """A patch tried to edit a module whose notebook already exists."""

    def __init__(self, module_id: uuid.UUID) -> None:
        super().__init__(str(module_id))
        self.module_id = module_id


class DueDateCreatorOnly(AuthzError):
    """Someone other than the course's creator tried to set or clear a due date.

    An `AuthzError`, so anything that does not catch it specifically still answers
    403 through the app's handler; a subclass so the route can give that 403 a
    sentence without telling it apart from a read-only role by the message text.
    """


def normalise_due_at(value: dt.datetime | None) -> dt.datetime | None:
    """The due date as stored: the same instant, in UTC, TRUNCATED to the minute.

    UTC so the resource a PATCH returns reads the same as every later GET, which
    gets the value back from Postgres in the session's zone (UTC).

    Whole minutes because a due date is set and shown to the minute (the web
    editor is a `datetime-local` input with no seconds), and `late` is decided on
    it to the microsecond. Kept with seconds, a deadline of 08:00:30 would show as
    08:00, an attempt at 08:00:10 would read on time against a deadline the reader
    was shown as already passed, and re-saving the untouched form would move the
    deadline (review on PR 969). Truncated, never rounded: "due at 08:00" means
    08:00:00, so a stray 08:00:59 becomes the minute it was typed in, not the next.
    """
    if value is None:
        return None
    return value.astimezone(dt.timezone.utc).replace(second=0, microsecond=0)


def _sets_due_at(patch: contracts.CourseModulePatch) -> bool:
    """Whether a patch touches the due date at all, clearing included.

    Read from the fields the client SENT, not from the value: `due_at: null` is a
    request to clear the due date, and an absent key is a request to leave it
    alone. Both parse to `None`, so the value alone cannot tell them apart.
    """
    return "due_at" in patch.model_fields_set


def _touches_plan(patch: contracts.CourseModulePatch) -> bool:
    """Whether a patch edits anything the module's notebook was generated from.

    Everything but `due_at` counts, and so does a patch that names a module and
    sends nothing else: that was refused on a generated module before due dates
    existed, and a due date is no reason to start accepting it.
    """
    sent = patch.model_fields_set - {"id"}
    return bool(sent - {"due_at"}) or not sent


async def update_course(
    scope: Scope,
    session: AsyncSession,
    course_id: uuid.UUID,
    *,
    title: str | None = None,
    summary: str | None = None,
    module_patches: list[contracts.CourseModulePatch] | None = None,
) -> Course:
    """Hand edits to the course and its still-ungenerated modules.

    A patch naming a module that already has a notebook raises
    `ModuleAlreadyGenerated` — including a pure `seq` reorder, because moving a
    generated module renumbers what "module 3 of this course" means in the
    preface every other notebook was written against.

    ## Due dates

    `due_at` is the one module field that is NOT refused on a generated module,
    and the one field only the course's creator (`courses.owner_user_id`) may
    change. A due date is the class's schedule, so it is set on exactly the
    modules a learner can open; and it is the instructor's, in the sense owner
    ruling ai-ops 260 draws: the person who made the course decides what counts as
    late, and a classmate who could move the deadline could make their own late
    attempt on time. Workspace role is not the test, for the reason
    `course_gradebook` gives: an admin who did not write the course is a classmate.

    The creator check runs before any row is touched, so a refused patch changes
    nothing, including the title or plan edits it may have carried alongside.
    `AuthzError` is the refusal every other creator-only action gives (a Qapp's
    publish, rollback and activity), which the app answers as 403: the caller can
    already read the course, so a 404 would be a lie about its existence.
    """
    require_write(scope)
    course = await get_course(scope, session, course_id)
    if (
        module_patches
        and any(_sets_due_at(patch) for patch in module_patches)
        and scope.user_id != course.owner_user_id
    ):
        raise DueDateCreatorOnly("only the course creator may set a module's due date")
    if title is not None:
        course.title = title
    if summary is not None:
        course.summary = summary

    if module_patches:
        modules = await list_modules(scope, session, course_id)
        by_id = {row.id: row for row in modules}
        for patch in module_patches:
            row = by_id.get(patch.id)
            if row is None:
                raise NotFoundError("course module")
            if row.notebook_id is not None and _touches_plan(patch):
                raise ModuleAlreadyGenerated(patch.id)
            if patch.title is not None:
                row.title = patch.title
            if patch.brief is not None:
                row.brief = patch.brief
            if patch.objectives is not None:
                row.objectives = list(patch.objectives)
            if patch.kind is not None:
                row.kind = patch.kind.value
            if _sets_due_at(patch):
                row.due_at = normalise_due_at(patch.due_at)
            row.updated_at = touched_now()

        wanted = {patch.id: patch.seq for patch in module_patches if patch.seq is not None}
        if wanted:
            # Move the named modules to their requested positions and let the rest
            # close up around them, keeping their relative order.
            moved = [row for row in modules if row.id in wanted]
            rest = [row for row in modules if row.id not in wanted]
            ordered: list[CourseModule] = list(rest)
            for row in sorted(moved, key=lambda r: wanted[r.id]):
                index = min(max(wanted[row.id], 1), len(ordered) + 1) - 1
                ordered.insert(index, row)
            for offset, row in enumerate(ordered, start=1):
                row.seq = _SEQ_PARK + offset
            await session.flush()
            for index, row in enumerate(ordered, start=1):
                row.seq = index

    course.updated_at = touched_now()
    await session.flush()
    return course


# ------------------------------------------------------------------------------- turns


async def append_turn(
    scope: Scope,
    session: AsyncSession,
    course_id: uuid.UUID,
    *,
    role: str,
    content: str,
    run_id: uuid.UUID | None,
) -> CourseTurn:
    require_write(scope)
    course = await get_course(scope, session, course_id)
    next_seq = (
        await session.execute(
            select(CourseTurn.seq)
            .where(CourseTurn.course_id == course.id)
            .order_by(CourseTurn.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    turn = CourseTurn(
        id=uuid7(),
        course_id=course.id,
        seq=(next_seq or 0) + 1,
        role=role,
        content=content,
        run_id=run_id,
    )
    session.add(turn)
    await session.flush()
    return turn


async def list_turns(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, *, limit: int = 200
) -> list[CourseTurn]:
    course = await get_course(scope, session, course_id)
    return list(
        (
            await session.execute(
                select(CourseTurn)
                .where(CourseTurn.course_id == course.id)
                .order_by(CourseTurn.seq.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


# ---------------------------------------------------------------------------- resources


async def _latest_versions(
    scope: Scope, session: AsyncSession, notebook_ids: list[uuid.UUID]
) -> dict[uuid.UUID, NotebookVersion]:
    """The newest version of each named notebook, scoped through `notebooks`.

    One query for the whole course rather than a `list_versions` per module: a
    course is capped at 16 modules, but `GET /v1/courses/{id}` would otherwise
    issue 17 round trips to render one page, and the same N+1 is already an open
    follow-up on `GET /v1/notebooks`.

    A notebook that is soft-deleted, or that belongs to another workspace, simply
    does not appear here — its module reads as `planned`, which is both true from
    the reader's side and self-healing: `POST /courses/{id}/generate` selects on
    the derived status, so the module can be built again.
    """
    if not notebook_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(NotebookVersion)
                .join(Notebook, NotebookVersion.notebook_id == Notebook.id)
                .where(
                    NotebookVersion.notebook_id.in_(notebook_ids),
                    Notebook.workspace_id == scope.workspace_id,
                    Notebook.deleted_at.is_(None),
                )
                .order_by(NotebookVersion.notebook_id, NotebookVersion.seq.asc())
            )
        )
        .scalars()
        .all()
    )
    latest: dict[uuid.UUID, NotebookVersion] = {}
    for row in rows:  # ascending seq, so the last write per notebook wins
        latest[row.notebook_id] = row
    return latest


_VERSION_TO_MODULE_STATUS: dict[str, contracts.CourseModuleStatus] = {
    contracts.NotebookVersionStatus.QUEUED.value: contracts.CourseModuleStatus.QUEUED,
    contracts.NotebookVersionStatus.RUNNING.value: contracts.CourseModuleStatus.RUNNING,
    contracts.NotebookVersionStatus.READY.value: contracts.CourseModuleStatus.READY,
    contracts.NotebookVersionStatus.FAILED.value: contracts.CourseModuleStatus.FAILED,
}


def module_to_resource(
    module: CourseModule, latest: NotebookVersion | None
) -> contracts.CourseModule:
    if module.notebook_id is None or latest is None:
        # No notebook, or a notebook that no longer resolves (soft-deleted, or the
        # FK already nulled). Either way the module reads as `planned` AND reports
        # no notebook, so the two halves of the resource agree and the generate
        # route — which selects on the derived status — will offer to build it.
        status = contracts.CourseModuleStatus.PLANNED
        version_seq = None
        notebook_id = None
    else:
        status = _VERSION_TO_MODULE_STATUS.get(latest.status, contracts.CourseModuleStatus.PLANNED)
        version_seq = latest.seq
        notebook_id = module.notebook_id
    return contracts.CourseModule(
        id=module.id,
        seq=module.seq,
        slug=module.slug,
        title=module.title,
        topic=module.topic,
        key_concepts=list(module.key_concepts or []),
        objectives=list(module.objectives or []),
        deliverable=module.deliverable,
        kind=contracts.NotebookKind(module.kind),
        duration_minutes=module.duration_minutes,
        prerequisites=list(module.prerequisites or []),
        brief=module.brief,
        notebook_id=notebook_id,
        status=status,
        notebook_version_seq=version_seq,
        due_at=module.due_at,
    )


def _derive_status(stored: str, modules: list[contracts.CourseModule]) -> contracts.CourseStatus:
    """The status a reader is shown, from the stored one and the modules.

    `planning` and `failed` are about the PLAN and are reported as stored — a
    course with no plan has no modules to derive anything from, and a plan that
    failed did not produce any. Past that point the modules are the truth:
    everything ready is `ready` (nothing observes the last module finishing, so
    no writer could have stored it), anything in flight is `generating`, and
    otherwise the stored value stands. A failed MODULE does not fail the course:
    it is one notebook to retry, not a broken plan.
    """
    if stored in (contracts.CourseStatus.PLANNING.value, contracts.CourseStatus.FAILED.value):
        return contracts.CourseStatus(stored)
    if modules and all(m.status is contracts.CourseModuleStatus.READY for m in modules):
        return contracts.CourseStatus.READY
    if any(
        m.status in (contracts.CourseModuleStatus.QUEUED, contracts.CourseModuleStatus.RUNNING)
        for m in modules
    ):
        return contracts.CourseStatus.GENERATING
    return contracts.CourseStatus(stored)


async def course_to_resource(
    scope: Scope,
    session: AsyncSession,
    course: Course,
    modules: list[CourseModule] | None = None,
) -> contracts.Course:
    """The full course, modules included, with every module's status derived from
    its notebook's latest version."""
    rows = modules if modules is not None else await list_modules(scope, session, course.id)
    latest = await _latest_versions(
        scope, session, [row.notebook_id for row in rows if row.notebook_id is not None]
    )
    module_resources = [
        module_to_resource(row, latest.get(row.notebook_id) if row.notebook_id else None)
        for row in rows
    ]
    ready = sum(1 for m in module_resources if m.status is contracts.CourseModuleStatus.READY)
    return contracts.Course(
        id=course.id,
        slug=course.slug,
        title=course.title,
        summary=course.summary,
        brief=course.brief,
        audience=contracts.Audience.model_validate(course.audience or {}),
        style=contracts.Style.model_validate(course.style or {}),
        framework=contracts.NotebookFramework.model_validate(course.framework or {}),
        language=course.language,
        status=_derive_status(course.status, module_resources),
        plan_run_id=course.plan_run_id,
        owner_user_id=course.owner_user_id,
        modules=module_resources,
        module_count=len(module_resources),
        ready_count=ready,
        created_at=_required(course.created_at, "created_at"),
        updated_at=_required(course.updated_at, "updated_at"),
    )


async def list_course_summaries(
    scope: Scope, session: AsyncSession, *, cursor: uuid.UUID | None = None, limit: int = 50
) -> list[contracts.CourseSummary]:
    """A page of courses as list rows, in THREE queries regardless of page size:
    the courses, all their modules, and the latest version of every notebook those
    modules point at.

    Deliberately not a `course_to_resource` per row. `GET /v1/notebooks` derives
    its per-row status with one `list_versions` call per notebook and is on record
    as an N+1 to fix when the list grows; there is no reason to ship the same shape
    again in the surface built next to it.
    """
    courses = await list_courses(scope, session, cursor=cursor, limit=limit)
    if not courses:
        return []
    modules_by_course: dict[uuid.UUID, list[CourseModule]] = {course.id: [] for course in courses}
    rows = (
        (
            await session.execute(
                select(CourseModule)
                .join(Course, CourseModule.course_id == Course.id)
                .where(
                    CourseModule.course_id.in_(list(modules_by_course)),
                    Course.workspace_id == scope.workspace_id,
                )
                .order_by(CourseModule.course_id, CourseModule.seq.asc())
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        modules_by_course.setdefault(row.course_id, []).append(row)
    latest = await _latest_versions(
        scope, session, [row.notebook_id for row in rows if row.notebook_id is not None]
    )

    summaries: list[contracts.CourseSummary] = []
    for course in courses:
        module_resources = [
            module_to_resource(row, latest.get(row.notebook_id) if row.notebook_id else None)
            for row in modules_by_course.get(course.id, [])
        ]
        ready = sum(1 for m in module_resources if m.status is contracts.CourseModuleStatus.READY)
        summaries.append(
            contracts.CourseSummary(
                id=course.id,
                slug=course.slug,
                title=course.title,
                summary=course.summary,
                status=_derive_status(course.status, module_resources),
                language=course.language,  # type: ignore[arg-type]
                module_count=len(module_resources),
                ready_count=ready,
                created_at=_required(course.created_at, "created_at"),
                updated_at=_required(course.updated_at, "updated_at"),
            )
        )
    return summaries


def turn_to_resource(turn: CourseTurn) -> contracts.CourseTurn:
    return contracts.CourseTurn(
        id=turn.id,
        seq=turn.seq,
        role=turn.role,  # type: ignore[arg-type]
        content=turn.content,
        created_at=_required(turn.created_at, "created_at"),
    )


# ---------------------------------------------------------------------------- gradebook


async def _live_notebook_graded_cells(
    scope: Scope, session: AsyncSession, notebook_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int | None]:
    """Every module notebook that still resolves, mapped to the graded-cell count of
    its CURRENT version (`None` when it has no ready version, or one that no longer
    parses).

    Counted with `NotebookSpec.graded_cells()`, the same call the grading route uses
    to decide what an attempt is graded on, so the gradebook's denominator cannot
    drift from the one a learner was actually scored against. A notebook missing
    from the result is soft-deleted or not this workspace's, and its module reads as
    having no notebook, exactly as `_latest_versions` treats it.
    """
    if not notebook_ids:
        return {}
    rows = (
        await session.execute(
            select(Notebook.id, NotebookVersion.spec)
            .outerjoin(
                NotebookVersion,
                and_(
                    NotebookVersion.id == Notebook.current_version_id,
                    NotebookVersion.notebook_id == Notebook.id,
                ),
            )
            .where(
                Notebook.id.in_(notebook_ids),
                Notebook.workspace_id == scope.workspace_id,
                Notebook.deleted_at.is_(None),
            )
        )
    ).all()
    counts: dict[uuid.UUID, int | None] = {}
    for notebook_id, spec in rows:
        if not spec:
            counts[notebook_id] = None
            continue
        try:
            counts[notebook_id] = len(contracts.NotebookSpec.model_validate(spec).graded_cells())
        except ValidationError:
            # A spec written by an older build that no longer validates. The module
            # still has a notebook and its members' attempts still count; only the
            # "out of how many today" figure is unknown, and `None` says that.
            counts[notebook_id] = None
    return counts


def _is_late(graded_at: dt.datetime, due_at: dt.datetime | None) -> bool:
    """Strictly after the due instant. One comparison, used for both the `late`
    flag (an attempt's grading time) and `missing` (the clock), so the two cannot
    disagree about which side of the deadline the instant itself falls on: an
    attempt graded AT the due time is on time, and at that same instant a module
    with no attempt is not missing yet."""
    return due_at is not None and graded_at > due_at


async def course_gradebook(
    scope: Scope,
    session: AsyncSession,
    course_id: uuid.UUID,
    *,
    now: dt.datetime | None = None,
) -> contracts.CourseGradebook:
    """Each current member's latest graded attempt at each module of a course.

    ## Who sees which rows

    **The course's creator (`courses.owner_user_id`) sees every current member of the
    workspace, started or not; anyone else sees only their own row, started or not.**
    Owner ruling ai-ops 260, option 1, is "only the person who created it sees the
    answers". A gradebook carries results, not answers, but it does expose one
    member's work to another, and the person the ruling already trusts with the
    answer key is the one person for whom that is the point. Workspace role is
    deliberately NOT the test: an admin who did not write the course is a classmate,
    and classmates do not read each other's marks. A caller from another workspace
    never gets this far: `get_course` answers 404, the same "absent or not yours"
    every course route gives.

    Members who have not started are listed for the creator because "who has not
    started" is an instructor's first question, and listing them exposes nothing new:
    it is the member list `GET /v1/workspace` already shows every member, plus each
    person's own results. So the statement is driven FROM `memberships` and LEFT
    joined to the grades, rather than driven from the grades, which could only ever
    list people who had already been graded.

    The rule is applied HERE, in the query, rather than by filtering rows in the
    route. A member's view is a query that cannot return anyone else's row, so there
    is no second code path (the CSV export, say) that could forget to filter.

    ## Where the numbers come from

    No table of its own. Grading already writes each verdict to `run_events` as
    `notebook.grades`, and `latest_grades_for_reader` already reads one learner's back
    from there. The inner query is that statement for every member at once, grouped
    with `DISTINCT ON (user, notebook)` so Postgres keeps one row per member per module
    rather than every attempt ever made. The counts are read out of the payload in
    SQL, so the per-cell messages never leave the database.

    A member is someone with a membership row NOW. A person who left the workspace
    keeps their runs, but the members page stops showing them the day they leave,
    and a gradebook that kept listing them would show their email to people who
    can no longer see it anywhere else.

    Latest rather than best, and `stale` when the version graded is no longer the
    notebook's current one: see `GradebookEntry`.

    ## Late and missing

    Both are read against the module's `due_at`, and both are derived here rather
    than stored, for the reason the module statuses are: the instructor can move a
    due date after the attempts exist, and a stored flag would then be wrong. An
    entry is `late` when its attempt was graded strictly after the due date. A
    module is missing for a member when its due date has passed (strictly, at
    `now`), they have no attempt at it, and it has something to be graded on (see
    `GradebookRow.missing_module_ids`).

    `now` is the API process's clock unless a caller passes one. The comparison is
    against `graded_at`, which Postgres stamped, so the two clocks differ by however
    far Cloud Run and Cloud SQL drift apart; both are NTP-synced, and a deadline is
    not a sub-second instrument. Asking Postgres for `now()` instead would add a
    round trip to every gradebook read to correct an error nobody can see.
    """
    moment = now if now is not None else touched_now()
    course = await get_course(scope, session, course_id)
    modules = await list_modules(scope, session, course_id)
    everyone = scope.user_id == course.owner_user_id
    visibility = (
        contracts.GradebookVisibility.ALL_MEMBERS
        if everyone
        else contracts.GradebookVisibility.OWN_ROW
    )

    notebook_ids = [row.notebook_id for row in modules if row.notebook_id is not None]
    live = await _live_notebook_graded_cells(scope, session, notebook_ids)
    columns = [
        contracts.GradebookModule(
            id=row.id,
            seq=row.seq,
            slug=row.slug,
            title=row.title,
            notebook_id=row.notebook_id if row.notebook_id in live else None,
            graded_cells=live.get(row.notebook_id) if row.notebook_id in live else None,
            due_at=row.due_at,
        )
        for row in modules
    ]
    # Modules a member can be missing: due, and gradable today. A module with no
    # ready notebook, or one with no graded exercise in it, can never be attempted,
    # so flagging it would mark the whole class missing for work that is not there.
    can_be_missed = [
        column
        for column in columns
        if _is_late(moment, column.due_at)
        and column.graded_cells is not None
        and column.graded_cells > 0
    ]
    module_by_notebook = {
        row.notebook_id: row
        for row in modules
        if row.notebook_id is not None and row.notebook_id in live
    }

    cells = RunEvent.payload["grades"]["cells"]
    latest = (
        select(
            Run.user_id.label("user_id"),
            NotebookVersion.notebook_id.label("notebook_id"),
            NotebookVersion.id.label("version_id"),
            NotebookVersion.seq.label("version_seq"),
            Notebook.current_version_id.label("current_version_id"),
            RunEvent.run_id.label("run_id"),
            func.coalesce(RunEvent.ts, RunEvent.created_at).label("graded_at"),
            RunEvent.payload["passed"].as_integer().label("passed"),
            RunEvent.payload["failed"].as_integer().label("failed"),
            RunEvent.payload["attempted"].as_integer().label("attempted"),
            # `jsonb_array_length` raises on a non-array, and one malformed event must
            # not take the whole gradebook down with it.
            case(
                (func.jsonb_typeof(cells) == "array", func.jsonb_array_length(cells)), else_=0
            ).label("graded_cells"),
        )
        .join(Run, RunEvent.run_id == Run.id)
        .join(
            NotebookVersion,
            NotebookVersion.id == cast(RunEvent.payload["version_id"].astext, PGUUID),
        )
        .join(Notebook, Notebook.id == NotebookVersion.notebook_id)
        .where(
            RunEvent.type == "notebook.grades",
            Run.workspace_id == scope.workspace_id,
            Notebook.workspace_id == scope.workspace_id,
            Notebook.deleted_at.is_(None),
            # Empty when no module has a notebook yet. The statement still runs,
            # because the creator still needs the member list with nobody started.
            NotebookVersion.notebook_id.in_(list(module_by_notebook)),
        )
        .distinct(Run.user_id, NotebookVersion.notebook_id)
        # DISTINCT ON keeps the FIRST row of each group in this order, so the two
        # leading keys must be the distinct ones and the rest pick the latest: the
        # `created_at`-then-`seq` order `latest_grades_for_reader` uses, plus the run id
        # (a UUIDv7, so time-ordered) last. `seq` only separates events WITHIN a run;
        # two grading runs stamped in the same microsecond both carry their verdict at
        # the same seq, and without a final key Postgres may pick either.
        .order_by(
            Run.user_id,
            NotebookVersion.notebook_id,
            Run.created_at.desc(),
            RunEvent.seq.desc(),
            Run.id.desc(),
        )
    )
    if not everyone:
        # Redundant with the outer `memberships.user_id` clause below, which is the one
        # that decides whose rows come back. This one keeps a member's request from
        # grouping every classmate's attempts only to throw them away.
        latest = latest.where(Run.user_id == scope.user_id)
    graded = latest.subquery("latest_grades")

    stmt = (
        select(
            Membership.user_id,
            User.email,
            User.display_name,
            graded.c.notebook_id,
            graded.c.version_id,
            graded.c.version_seq,
            graded.c.current_version_id,
            graded.c.run_id,
            graded.c.graded_at,
            graded.c.passed,
            graded.c.failed,
            graded.c.attempted,
            graded.c.graded_cells,
        )
        .select_from(Membership)
        .join(User, User.id == Membership.user_id)
        # LEFT: a member with no grading event still comes back, once, with every
        # grade column NULL. That row is "not started", which is the point.
        .outerjoin(graded, graded.c.user_id == Membership.user_id)
        .where(Membership.workspace_id == scope.workspace_id)
    )
    if not everyone:
        stmt = stmt.where(Membership.user_id == scope.user_id)

    people: dict[uuid.UUID, tuple[str, str | None]] = {}
    entries: dict[uuid.UUID, list[contracts.GradebookEntry]] = {}
    for (
        user_id,
        email,
        display_name,
        notebook_id,
        version_id,
        version_seq,
        current_version_id,
        run_id,
        graded_at,
        passed,
        failed,
        attempted,
        graded_cells,
    ) in (await session.execute(stmt)).all():
        people[user_id] = (email, display_name)
        found = entries.setdefault(user_id, [])
        module = module_by_notebook.get(notebook_id) if notebook_id is not None else None
        if module is None:
            continue
        found.append(
            contracts.GradebookEntry(
                module_id=module.id,
                passed=max(int(passed or 0), 0),
                failed=max(int(failed or 0), 0),
                attempted=max(int(attempted or 0), 0),
                graded_cells=max(int(graded_cells or 0), 0),
                version_seq=version_seq,
                stale=current_version_id != version_id,
                run_id=run_id,
                graded_at=_required(graded_at, "graded_at"),
                late=_is_late(_required(graded_at, "graded_at"), module.due_at),
            )
        )

    seq_of = {row.id: row.seq for row in modules}
    rows: list[contracts.GradebookRow] = []
    for user_id, found in entries.items():
        found.sort(key=lambda entry: seq_of.get(entry.module_id, 0))
        attempted_modules = {entry.module_id for entry in found}
        # Out of the WHOLE course: what they were graded on, plus what they have not
        # reached yet at today's count. See `GradebookRow.total_graded_cells`.
        ahead = [column.graded_cells for column in columns if column.id not in attempted_modules]
        known = [count for count in ahead if count is not None]
        # A module still being generated (attached, no ready version yet) has no count.
        # Treating that as 0 made every learner's total too small until generation
        # finished, which reads as a better score than they have (Greptile, PR 965).
        # An attempted module never needs its current count: it is counted at the
        # version the member was graded on, which the attempt itself carries.
        total_graded_cells = (
            sum(entry.graded_cells for entry in found) + sum(known)
            if len(known) == len(ahead)
            else None
        )
        email, display_name = people[user_id]
        rows.append(
            contracts.GradebookRow(
                user_id=user_id,
                email=email,
                display_name=display_name,
                entries=found,
                total_passed=sum(entry.passed for entry in found),
                total_graded_cells=total_graded_cells,
                last_graded_at=max((entry.graded_at for entry in found), default=None),
                missing_module_ids=[
                    column.id for column in can_be_missed if column.id not in attempted_modules
                ],
            )
        )
    rows.sort(key=lambda row: ((row.display_name or row.email).casefold(), str(row.user_id)))
    return contracts.CourseGradebook(
        course_id=course.id, visibility=visibility, modules=columns, rows=rows
    )
