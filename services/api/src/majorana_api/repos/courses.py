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

import uuid
from typing import Any

import majorana_contracts as contracts
from majorana_contracts import Scope
from majorana_contracts.courses import CoursePlan, PlannedModule
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Course, CourseModule, CourseTurn, Notebook, NotebookVersion
from ._base import NotFoundError, require_write, touched_now
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
    """
    require_write(scope)
    course = await get_course(scope, session, course_id)
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
            if row.notebook_id is not None:
                raise ModuleAlreadyGenerated(patch.id)
            if patch.title is not None:
                row.title = patch.title
            if patch.brief is not None:
                row.brief = patch.brief
            if patch.objectives is not None:
                row.objectives = list(patch.objectives)
            if patch.kind is not None:
                row.kind = patch.kind.value
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
