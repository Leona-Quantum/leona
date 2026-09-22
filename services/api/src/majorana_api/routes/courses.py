"""Courses: an ordered plan of notebooks, generated from one prompt.

A course is planned by the worker (`course.plan`), revised in chat (`course.revise`),
and *generated* one module at a time through the ordinary notebook path — this module
never writes a second notebook-creation path, it calls
`routes.notebooks.create_notebook_and_enqueue`.

Every route that creates a run goes through `routes.notebooks._gate_notebook_run`, the
same abuse/tier gate `POST /v1/runs` applies to an EXECUTE submission. `POST
/courses/{id}/generate` dispatches one run PER MODULE and gates each of them
separately: a course is a way to ask for eight notebooks in one click, not a way to
ask for eight notebooks past a limit that stops at one.
"""

from __future__ import annotations

import csv
import io
import uuid
from typing import Annotated

import majorana_contracts as contracts
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from leona_notebooks.courses import export_course_zip
from majorana_contracts.enums import RunMode
from starlette.concurrency import run_in_threadpool

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..jobs import COURSE_PLAN_JOB_KIND, COURSE_REVISE_JOB_KIND
from ..orm import Course as CourseRow
from ..orm import CourseModule as CourseModuleRow
from ..repos import courses as courses_repo
from ..repos import notebooks as notebooks_repo
from ..repos import runs as runs_repo
from ..repos import system
from ..request_models import RequestModel
from ..settings import Settings
from .notebooks import (
    _gate_notebook_run,
    _run_framework,
    _slug,
    create_notebook_and_enqueue,
)
from .runs import _assert_same_request, _idempotency_request_hash

router = APIRouter()


# --------------------------------------------------------------------------- requests
#
# As in `routes/notebooks.py`: the contracts classes are the wire shape, and these
# subclasses add only the NUL-byte guard every request body inherits
# (`request_models.RequestModel`, which is services/api-only and must not be a
# contracts dependency).


class CreateCourseRequest(RequestModel, contracts.CreateCourseRequest):
    pass


class UpdateCourseRequest(RequestModel, contracts.UpdateCourseRequest):
    pass


class GenerateCourseRequest(RequestModel, contracts.GenerateCourseRequest):
    pass


class CreateCourseTurnRequest(RequestModel, contracts.CreateCourseTurnRequest):
    pass


#: How much of the "earlier modules covered …" preface a module's brief may carry
#: before it is trimmed. `CreateNotebookRequest.brief` caps the whole thing at 8000
#: and a module's own brief may already be 4000, so the preface cannot be unbounded.
_PREFACE_BUDGET = 1_800
_BRIEF_CEILING = 8_000


def _default_title(body: contracts.CreateCourseRequest) -> str:
    return body.title or body.brief.strip().splitlines()[0][:120] or "Untitled course"


async def _resource(
    scope: CurrentScope,
    session: DbSession,
    course: CourseRow,
    modules: list[CourseModuleRow] | None = None,
) -> contracts.Course:
    return await courses_repo.course_to_resource(scope, session, course, modules)


def _module_brief(course: CourseRow, modules: list[CourseModuleRow], index: int) -> str:
    """The brief `notebook.generate` receives for one module.

    A module's notebook is generated ALONE — the generator never sees the plan or
    its siblings — so the only place it can learn what the reader already built is
    this preface. It goes in FRONT of the module's own brief because that is where
    context belongs for the model, and because the module's brief ends with what
    the notebook must produce.
    """
    module = modules[index]
    earlier = modules[:index]
    preface = f'This is module {index + 1} of {len(modules)} in the course "{course.title}". '
    if earlier:
        covered = "; ".join(
            f"{other.title} ({other.topic or ', '.join(other.key_concepts or []) or 'no topic'})"
            for other in earlier
        )
        if len(covered) > _PREFACE_BUDGET:
            covered = covered[: _PREFACE_BUDGET - 1].rstrip() + "…"
        preface += (
            f"Earlier modules already covered: {covered}. Assume the reader has worked "
            "through them; build on that material rather than re-teaching it, and say "
            "explicitly where you are picking up from. "
        )
    else:
        preface += "It is the FIRST module: assume nothing beyond the stated audience. "
    return (preface + module.brief)[:_BRIEF_CEILING]


def _module_request(
    course: CourseRow, modules: list[CourseModuleRow], index: int
) -> contracts.CreateNotebookRequest:
    module = modules[index]
    return contracts.CreateNotebookRequest(
        brief=_module_brief(course, modules, index),
        kind=contracts.NotebookKind(module.kind),
        title=module.title,
        audience=contracts.Audience.model_validate(course.audience or {}),
        style=contracts.Style.model_validate(course.style or {}),
        framework=contracts.NotebookFramework.model_validate(course.framework or {}),
        seeds=[
            contracts.Seed(kind="curriculum", ref=f"{course.slug}/{module.slug}", note=course.title)
        ],
        response_locale=course.language,  # type: ignore[arg-type]
    )


async def _new_run(
    *,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Settings,
    task_prompt: str,
    framework: contracts.NotebookFramework | None,
    idempotency_key: str | None = None,
    idempotency_request_hash: str | None = None,
):
    """Gate, create and announce one run. Every run-creating route here uses it,
    so none of them can be added later without the gate."""
    await _gate_notebook_run(task_prompt, scope, session, identity, settings)
    try:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt=task_prompt,
            mode=RunMode.NOTEBOOK,
            framework=_run_framework(framework),
            idempotency_key=idempotency_key,
            idempotency_request_hash=idempotency_request_hash,
        )
    except runs_repo.IdempotencyKeyInFlight:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "A run with this Idempotency-Key is being created by another "
                    "request. Retry to receive it."
                ),
                "reason": "idempotency_key_in_flight",
            },
        ) from None
    await runs_repo.append_run_event(
        scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
    )
    return run


# ---------------------------------------------------------------------------- create


@router.post("/courses", response_model=contracts.CreateCourseResponse, status_code=201)
async def create_course(
    body: CreateCourseRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> contracts.CreateCourseResponse:
    request_hash = _idempotency_request_hash(body) if idempotency_key else None  # type: ignore[arg-type]
    if idempotency_key:
        existing_run = await runs_repo.find_run_by_idempotency_key(scope, session, idempotency_key)
        if existing_run is not None:
            _assert_same_request(existing_run, request_hash)
            course = await courses_repo.get_course_by_run_id(scope, session, existing_run.id)
            if course is None:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": (
                            "A course is being created under this Idempotency-Key by "
                            "another request. Retry to receive it."
                        ),
                        "reason": "idempotency_key_in_flight",
                    },
                )
            return contracts.CreateCourseResponse(
                course=await _resource(scope, session, course), run_id=existing_run.id
            )

    run = await _new_run(
        scope=scope,
        session=session,
        identity=identity,
        settings=settings,
        task_prompt=body.brief,
        framework=body.framework,
        idempotency_key=idempotency_key,
        idempotency_request_hash=request_hash,
    )
    course = await courses_repo.create_course(
        scope,
        session,
        slug=_slug(body.title or body.brief),
        title=_default_title(body),
        brief=body.brief,
        audience=(body.audience or contracts.Audience()).model_dump(mode="json"),
        style=(body.style or contracts.Style()).model_dump(mode="json"),
        framework=(body.framework or contracts.NotebookFramework()).model_dump(mode="json"),
        language=body.response_locale,
        plan_run_id=run.id,
    )
    await system.enqueue_job(
        session,
        kind=COURSE_PLAN_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "course_id": str(course.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "plan",
            "request": body.model_dump(mode="json"),
            "response_locale": body.response_locale,
        },
        run_id=run.id,
    )
    return contracts.CreateCourseResponse(
        course=await _resource(scope, session, course, []), run_id=run.id
    )


# ------------------------------------------------------------------------ read / edit


@router.get("/courses", response_model=contracts.CourseList)
async def list_courses(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> contracts.CourseList:
    limit = min(max(limit, 1), 100)
    items = await courses_repo.list_course_summaries(scope, session, cursor=cursor, limit=limit)
    next_cursor = str(items[-1].id) if len(items) == limit else None
    return contracts.CourseList(items=items, next_cursor=next_cursor)


@router.get("/courses/{course_id}", response_model=contracts.Course)
async def get_course(
    course_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.Course:
    course = await courses_repo.get_course(scope, session, course_id)
    return await _resource(scope, session, course)


@router.patch("/courses/{course_id}", response_model=contracts.Course)
async def update_course(
    course_id: uuid.UUID,
    body: UpdateCourseRequest,
    scope: CurrentScope,
    session: DbSession,
) -> contracts.Course:
    try:
        course = await courses_repo.update_course(
            scope,
            session,
            course_id,
            title=body.title,
            summary=body.summary,
            module_patches=body.modules,
        )
    except courses_repo.ModuleAlreadyGenerated as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "This module's notebook has already been generated, so its plan can "
                    "no longer be edited. Ask Nala to change the course instead, or "
                    "delete the notebook first."
                ),
                "reason": "course_module_already_generated",
                "module_id": str(exc.module_id),
            },
        ) from None
    return await _resource(scope, session, course)


@router.delete("/courses/{course_id}", status_code=204)
async def delete_course(course_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> None:
    await courses_repo.soft_delete_course(scope, session, course_id)


# -------------------------------------------------------------------------- generate


@router.post("/courses/{course_id}/generate", response_model=contracts.GenerateCourseResponse)
async def generate_course(
    course_id: uuid.UUID,
    body: GenerateCourseRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> contracts.GenerateCourseResponse:
    """Turn selected modules into notebooks — one `notebook.generate` run each.

    Selection is on the DERIVED status, not on `notebook_id is null`: a module
    whose notebook the reader deleted reads as `planned` and must be buildable
    again, and the resource the client is looking at says exactly that.
    """
    course = await courses_repo.get_course(scope, session, course_id)
    modules = await courses_repo.list_modules(scope, session, course_id)
    if not modules:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This course has no modules yet — its plan is still being written.",
                "reason": "course_not_planned",
            },
        )
    resource = await _resource(scope, session, course, modules)
    buildable = {m.id for m in resource.modules if m.status is contracts.CourseModuleStatus.PLANNED}

    if body.module_ids is None:
        selected = [index for index, module in enumerate(modules) if module.id in buildable]
    else:
        wanted = set(body.module_ids)
        known = {module.id for module in modules}
        if not wanted <= known:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "One of the module ids is not part of this course.",
                    "reason": "course_module_not_found",
                },
            )
        already = wanted - buildable
        if already:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "One of the selected modules already has a notebook.",
                    "reason": "course_module_already_generated",
                    "module_id": str(sorted(already, key=str)[0]),
                },
            )
        selected = [index for index, module in enumerate(modules) if module.id in wanted]

    run_ids: list[uuid.UUID] = []
    for index in selected:
        module = modules[index]
        run = await _new_run(
            scope=scope,
            session=session,
            identity=identity,
            settings=settings,
            task_prompt=module.title,
            framework=contracts.NotebookFramework.model_validate(course.framework or {}),
        )
        notebook, _version = await create_notebook_and_enqueue(
            scope, session, request=_module_request(course, modules, index), run_id=run.id
        )
        await courses_repo.attach_module_notebook(scope, session, course_id, module.id, notebook.id)
        run_ids.append(run.id)

    if run_ids:
        course = await courses_repo.set_course_status(
            scope, session, course_id, contracts.CourseStatus.GENERATING.value
        )
    modules = await courses_repo.list_modules(scope, session, course_id)
    return contracts.GenerateCourseResponse(
        course=await _resource(scope, session, course, modules), run_ids=run_ids
    )


# ---------------------------------------------------------------------------- export


@router.get("/courses/{course_id}/export.zip")
async def export_course(course_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> Response:
    course = await courses_repo.get_course(scope, session, course_id)
    modules = await courses_repo.list_modules(scope, session, course_id)
    resource = await _resource(scope, session, course, modules)
    unready = [
        m.slug for m in resource.modules if m.status is not contracts.CourseModuleStatus.READY
    ]
    if not resource.modules or unready:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "Every module must have a ready notebook before the course can be exported."
                ),
                "reason": "course_not_ready",
                "modules": unready,
            },
        )

    specs: dict[str, object] = {}
    reports: dict[str, contracts.ExecutionReport] = {}
    for module in modules:
        if module.notebook_id is None:
            continue
        version = await notebooks_repo.get_current_version(scope, session, module.notebook_id)
        if version is None or version.spec is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": f"Module {module.slug} has no compiled notebook to export.",
                    "reason": "course_module_not_compiled",
                },
            )
        specs[module.slug] = contracts.NotebookSpec.model_validate(version.spec)
        # The module's notebook already ran in the sandbox when this version was
        # generated (same as any other notebook version) — carried into the export so
        # the reader gets the executed copy, exactly as `export_notebook_version` does
        # for a single notebook. A version with no report (imported, or from before
        # execution reports were stored) simply exports with empty outputs, as before.
        if version.report is not None:
            reports[module.slug] = contracts.ExecutionReport.model_validate(version.report)

    plan = courses_repo.plan_from_modules(course, modules)
    # `export_course_zip` compiles every notebook and builds an archive — CPU work
    # with no await in it, so it runs off the event loop rather than stalling every
    # other request on this worker for the duration.
    # Owner ruling ai-ops 260, option 1: only the person who created it sees the answers.
    # A course is a bundle of notebooks and the same rule binds — `builds_for` writes the
    # answer-free notebook in place AND a full copy of every challenge and quiz under
    # `solutions/`, so without this any member of the workspace downloaded the whole
    # answer key in a zip. The notebook export route was fixed first; this is the same
    # door one room over, and it is the reason to enumerate the siblings of a defect
    # rather than only the instance that was reported.
    blob = await run_in_threadpool(
        export_course_zip,
        plan,
        specs,  # type: ignore[arg-type]
        slug=course.slug,
        framework=contracts.NotebookFramework.model_validate(course.framework or {}),
        include_solutions=scope.user_id == course.owner_user_id,
        notebook_reports=reports,  # type: ignore[arg-type]
    )
    return Response(
        content=blob,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{course.slug}.zip"'},
    )


# ------------------------------------------------------------------------- gradebook


@router.get("/courses/{course_id}/gradebook", response_model=contracts.CourseGradebook)
async def get_course_gradebook(
    course_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.CourseGradebook:
    """How members are doing on this course's graded exercises.

    The course's creator gets every member's row; anyone else in the workspace gets
    their own row only, and `visibility` says which of the two this is. The reason
    (owner ruling ai-ops 260, option 1) and why workspace role is not the test are on
    `courses_repo.course_gradebook`, which is where the rule is enforced: this route
    and the CSV beside it cannot disagree about it because neither applies it.
    """
    return await courses_repo.course_gradebook(scope, session, course_id)


#: A spreadsheet reads a cell that starts with one of these as a formula, or (tab,
#: CR) as the start of one once the cell is trimmed. Display names and module titles
#: are text other people typed, so a name of `=HYPERLINK("http://…","Open")` would
#: otherwise become a live link in the instructor's spreadsheet. OWASP's CSV injection
#: guidance: prefix a single quote, which every spreadsheet shows as text.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

_GRADEBOOK_CSV_HEADER = (
    "member",
    "email",
    "module_number",
    "module",
    "cells_passed",
    "graded_cells",
    "graded_at",
    "notebook_version",
    "outdated",
    "run_id",
    "course_cells_passed",
    "course_graded_cells",
)


def _csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def render_gradebook_csv(book: contracts.CourseGradebook) -> str:
    """One row per member per module, with the member's course totals on every row.

    A module the member has not been graded on still gets its row, with
    `cells_passed` EMPTY rather than 0: "has not tried" and "tried and passed
    nothing" are different facts about a learner, the same distinction
    `GET /notebooks/{id}/grades` draws with `null`. Its `graded_cells` is the
    module's count today, so a member's `graded_cells` column sums to their
    `course_graded_cells`, which is the check a spreadsheet user will make first.
    A member who has not started anything gets `course_cells_passed` empty too,
    for the same reason.

    Totals are two numeric columns rather than one "7/12" cell, because a
    spreadsheet reads "7/12" as the 12th of July.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(_GRADEBOOK_CSV_HEADER)
    for row in book.rows:
        by_module = {entry.module_id: entry for entry in row.entries}
        for module in book.modules:
            entry = by_module.get(module.id)
            cells: tuple[object, ...] = (
                row.display_name or row.email,
                row.email,
                module.seq,
                module.title,
                entry.passed if entry else None,
                entry.graded_cells if entry else module.graded_cells,
                entry.graded_at.isoformat() if entry else None,
                entry.version_seq if entry else None,
                ("yes" if entry.stale else "no") if entry else None,
                entry.run_id if entry else None,
                row.total_passed if row.entries else None,
                row.total_graded_cells,
            )
            writer.writerow([_csv_cell(cell) for cell in cells])
    return buffer.getvalue()


@router.get("/courses/{course_id}/gradebook.csv")
async def export_course_gradebook(
    course_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> Response:
    """The gradebook as a spreadsheet. Same rows as `GET .../gradebook`, from the
    same call, so a member who downloads it gets their own row and nothing else.

    UTF-8 with a byte-order mark. Without it Excel opens the file in the system
    code page and a Japanese member's name arrives as mojibake; every tool that
    reads CSV as UTF-8 skips the mark.
    """
    course = await courses_repo.get_course(scope, session, course_id)
    book = await courses_repo.course_gradebook(scope, session, course_id)
    return Response(
        content="\ufeff" + render_gradebook_csv(book),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{course.slug}-gradebook.csv"'},
    )


# ------------------------------------------------------------------------------ turns


@router.post(
    "/courses/{course_id}/turns",
    response_model=contracts.CreateCourseTurnResponse,
    status_code=201,
)
async def create_course_turn(
    course_id: uuid.UUID,
    body: CreateCourseTurnRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> contracts.CreateCourseTurnResponse:
    """Chat that edits the PLAN. Refused while the plan is still being written —
    there would be nothing to revise, and the reply would race the planner."""
    course = await courses_repo.get_course(scope, session, course_id)
    if course.status == contracts.CourseStatus.PLANNING.value:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This course's plan is still being written.",
                "reason": "course_not_planned",
            },
        )
    if course.plan is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This course has no plan to revise.",
                "reason": "course_not_planned",
            },
        )

    run = await _new_run(
        scope=scope,
        session=session,
        identity=identity,
        settings=settings,
        task_prompt=body.message,
        framework=contracts.NotebookFramework.model_validate(course.framework or {}),
    )
    turn = await courses_repo.append_turn(
        scope,
        session,
        course_id,
        role="user",
        content=body.message,
        run_id=run.id,
    )
    await system.enqueue_job(
        session,
        kind=COURSE_REVISE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "course_id": str(course_id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "revise",
            "request": {"message": body.message},
            "response_locale": course.language,
        },
        run_id=run.id,
    )
    return contracts.CreateCourseTurnResponse(
        turn=courses_repo.turn_to_resource(turn), run_id=run.id
    )


@router.get("/courses/{course_id}/turns", response_model=contracts.CourseTurnList)
async def list_course_turns(
    course_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.CourseTurnList:
    turns = await courses_repo.list_turns(scope, session, course_id)
    return contracts.CourseTurnList(items=[courses_repo.turn_to_resource(t) for t in turns])
