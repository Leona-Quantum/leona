"""Job handlers for the course lane: write a course's plan from the reader's brief
(`course.plan`), and rewrite it from a chat turn (`course.revise`).

A course plan run is a Run with `mode=notebook` — quota, the abuse backstop and the
SSE stream come from the notebook lane, which already registered that mode; a course
adds no run mode of its own. Generating a module's notebook is not handled here at
all: `POST /v1/courses/{id}/generate` dispatches ordinary `notebook.generate` jobs,
so a course module and a hand-asked notebook go through one pipeline.

The retry that matters, and why it is shaped this way: a plan can come back wrong in
two different ways and both must be handed back to the model with the same words.
`CoursePlan.model_validate` refuses the structurally impossible (duplicate slugs, a
prerequisite pointing forward) and `leona_notebooks.courses.check_plan` reports the
pedagogically useless (a module with no brief, or no objective). `_ask_twice`
treats them as one failure list, re-asks ONCE with that list appended, and fails the
run with a reason code if the second attempt is no better — never saves a plan whose
briefs cannot each stand alone, because each one is dispatched alone.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from majorana_contracts import Scope
from majorana_contracts.courses import CoursePlan, CourseStatus, CreateCourseRequest
from majorana_contracts.enums import Role, RunStatus, Stage
from majorana_llm import (
    LLMClient,
    LLMRequest,
    StageOutputError,
    default_llm,
    extract_json,
    model_for,
    normalize_response_locale,
)

from leona_notebooks.courses import check_plan, plan_prompt, revise_plan_prompt
from leona_notebooks.spec import Audience, Framework, Style

from majorana_api.db import AsyncSession
from majorana_api.repos.courses import plan_from_modules

from .notebook_handlers import _seed_material_for, _strip_fences

log = logging.getLogger("majorana_worker.course_handlers")

#: Course-lane LLM roles, resolved through the shared `model_for` machinery
#: (registered in `packages/py/llm/src/majorana_llm/models.py`).
_ROLE_PLAN = "course_plan"
_ROLE_REVISE = "course_revise"

#: Both course stages are planning work. `majorana_contracts.enums.Stage` has no
#: member naming a course stage and the DB-level `stage.started`/`stage.finished`
#: events are typed against THAT enum, so this maps onto the closest existing
#: member — the same reasoning, and the same trade, as `notebook_handlers._STAGE_MAP`.
_STAGE = Stage.PLAN

#: One retry, then fail. A second bad plan is a signal about the brief or the
#: model, not something a third attempt fixes, and every attempt costs the reader.
_MAX_PLAN_ATTEMPTS = 2


def _scope_from_payload(payload: dict[str, Any]) -> Scope:
    return Scope(
        user_id=uuid.UUID(payload["user_id"]),
        workspace_id=uuid.UUID(payload["workspace_id"]),
        role=Role.MEMBER,  # write, never admin — least authority that can plan
    )


class PlanRevision(BaseModel):
    """What the revise call returns: a whole rewritten plan plus what to say."""

    model_config = ConfigDict(extra="ignore")

    reply: str = ""
    summary: str = ""
    plan: CoursePlan = Field(...)


class CourseStore(Protocol):
    """What these handlers need from `majorana_api.repos.courses`.

    Unlike the notebook lane's `NotebookStore` — written before its repository
    existed — this Protocol is not a placeholder: `repos.courses` exists and
    `RepoCourseStore` imports it at module load. It is here so the tests can drive
    the handlers against an in-memory double without a database, which is the only
    way the retry path above can be exercised at all.
    """

    async def get_course(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID
    ) -> Any: ...

    async def list_modules(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID
    ) -> list[Any]: ...

    async def replace_modules(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID, plan: CoursePlan
    ) -> list[Any]: ...

    async def set_course_status(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID, status: str
    ) -> Any: ...

    async def append_turn(
        self,
        scope: Scope,
        session: AsyncSession,
        course_id: uuid.UUID,
        *,
        role: str,
        content: str,
        run_id: uuid.UUID | None,
    ) -> Any: ...

    async def list_turns(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID, *, limit: int = 200
    ) -> list[Any]: ...


class RepoCourseStore:
    """`CourseStore` over `majorana_api.repos.courses`."""

    async def get_course(self, scope: Scope, session: AsyncSession, course_id: uuid.UUID) -> Any:
        from majorana_api.repos import courses as courses_repo

        return await courses_repo.get_course(scope, session, course_id)

    async def list_modules(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID
    ) -> list[Any]:
        from majorana_api.repos import courses as courses_repo

        return await courses_repo.list_modules(scope, session, course_id)

    async def replace_modules(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID, plan: CoursePlan
    ) -> list[Any]:
        from majorana_api.repos import courses as courses_repo

        return await courses_repo.replace_modules(scope, session, course_id, plan)

    async def set_course_status(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID, status: str
    ) -> Any:
        from majorana_api.repos import courses as courses_repo

        return await courses_repo.set_course_status(scope, session, course_id, status)

    async def append_turn(
        self,
        scope: Scope,
        session: AsyncSession,
        course_id: uuid.UUID,
        *,
        role: str,
        content: str,
        run_id: uuid.UUID | None,
    ) -> Any:
        from majorana_api.repos import courses as courses_repo

        return await courses_repo.append_turn(
            scope, session, course_id, role=role, content=content, run_id=run_id
        )

    async def list_turns(
        self, scope: Scope, session: AsyncSession, course_id: uuid.UUID, *, limit: int = 200
    ) -> list[Any]:
        from majorana_api.repos import courses as courses_repo

        return await courses_repo.list_turns(scope, session, course_id, limit=limit)


class PlanRefused(Exception):
    """Both attempts came back with a plan we will not save. Carries the failures
    so the reader is told what was wrong rather than "something went wrong"."""

    def __init__(self, failures: list[str]) -> None:
        super().__init__("; ".join(failures)[:1_900])
        self.failures = failures


def _plan_from_text(text: str) -> tuple[CoursePlan | None, list[str]]:
    """`(plan, failures)`. A plan is returned only when it passes BOTH layers."""
    try:
        raw = extract_json(_strip_fences(text))
    except StageOutputError as exc:
        return None, [f"The response was not JSON: {exc}"]
    try:
        plan = CoursePlan.model_validate_json(raw)
    except ValidationError as exc:
        return None, [
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()[:10]
        ]
    failures = check_plan(plan)
    return (None, failures) if failures else (plan, [])


def _revision_from_text(text: str) -> tuple[PlanRevision | None, list[str]]:
    try:
        raw = extract_json(_strip_fences(text))
    except StageOutputError as exc:
        return None, [f"The response was not JSON: {exc}"]
    try:
        revision = PlanRevision.model_validate_json(raw)
    except ValidationError as exc:
        return None, [
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()[:10]
        ]
    failures = check_plan(revision.plan)
    return (None, failures) if failures else (revision, [])


async def _ask(
    llm: LLMClient,
    *,
    role: str,
    system: str,
    user: str,
    temperature: float,
    schema: dict[str, Any],
) -> str:
    response = await llm.complete(
        LLMRequest(
            model=model_for(role),
            system=system,
            user=user,
            response_schema=schema,
            schema_name=role,
            temperature=temperature,
        )
    )
    return response.text


async def _ask_twice(
    llm: LLMClient,
    *,
    role: str,
    system: str,
    user: str,
    parse,
    schema: dict[str, Any],
):
    """Ask, and on a refusal ask once more with the failures spelled out.

    The failures are appended to the USER message, not the system prompt: the
    model is being told what was wrong with the answer it just gave, which is a
    fact about this exchange rather than a standing instruction.
    """
    last_failures: list[str] = []
    for attempt in range(_MAX_PLAN_ATTEMPTS):
        prompt = user
        if last_failures:
            prompt = (
                f"{user}\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix every one of these and "
                "return the whole corrected JSON object:\n- " + "\n- ".join(last_failures)
            )
        text = await _ask(
            llm,
            role=role,
            system=system,
            user=prompt,
            temperature=0.0 if attempt == 0 else 0.3,
            schema=schema,
        )
        parsed, failures = parse(text)
        if parsed is not None:
            return parsed
        last_failures = failures
    raise PlanRefused(last_failures)


def _course_preferences(course: Any) -> tuple[Audience, Style, Framework]:
    return (
        Audience.model_validate(getattr(course, "audience", None) or {}),
        Style.model_validate(getattr(course, "style", None) or {}),
        Framework.model_validate(getattr(course, "framework", None) or {}),
    )


async def _fail_course_run(
    *,
    store: CourseStore,
    scope: Scope,
    session: AsyncSession,
    course_id: uuid.UUID,
    run_id: uuid.UUID,
    run_store: Any,
    sink: Any,
    error: str,
    reason_code: str,
    set_status: str | None,
) -> None:
    """Every way planning or revising can fail ends here: the course carries a
    readable state, a nala turn says what went wrong, and the run is FAILED —
    never a dead-lettered job with a course stuck in `planning` forever."""
    try:
        if set_status is not None:
            await store.set_course_status(scope, session, course_id, set_status)
        await store.append_turn(
            scope,
            session,
            course_id,
            role="nala",
            content=f"I couldn't finish this: {error}"[:8_000],
            run_id=run_id,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        log.exception("course run %s: failed to persist the failure itself", run_id)
    try:
        await sink.emit("run.error", {"stage": None, "code": reason_code, "message": error[:2000]})
    except Exception:
        log.exception("course run %s: failed to emit run.error", run_id)
    try:
        await run_store.finish(
            RunStatus.FAILED, {"status": RunStatus.FAILED, "reason_code": reason_code}
        )
    except Exception:
        log.exception("course run %s: failed to finish the run as FAILED", run_id)


async def _start(session: AsyncSession, payload: dict[str, Any]):
    """The shared preamble: claim the run, or return `None` if it is not ours."""
    from .handlers import RepoEventSink, RepoRunStateStore

    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    run_store = RepoRunStateStore(scope, session, run_id)
    sink = RepoEventSink(scope, session, run_id)
    if await run_store.current_status() is not RunStatus.QUEUED:
        return None
    await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
    await session.commit()
    await sink.emit("run.started", {})
    return scope, run_id, run_store, sink


# --------------------------------------------------------------------------- handlers


async def handle_course_plan(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    store: CourseStore | None = None,
) -> None:
    started = await _start(session, payload)
    if started is None:
        return
    scope, run_id, run_store, sink = started
    course_id = uuid.UUID(payload["course_id"])
    course_store = store or RepoCourseStore()
    response_locale = normalize_response_locale(payload.get("response_locale"))
    client = llm or default_llm()

    try:
        request = CreateCourseRequest.model_validate(payload.get("request") or {})
        # `_seed_material_for` reads only `.seeds` and `.framework`, which
        # `CreateCourseRequest` carries with the same meaning — see its annotation.
        seed_material, _run_cell = await _seed_material_for(scope, session, request)
        system, user = plan_prompt(
            brief=request.brief,
            audience=request.audience,
            style=request.style,
            framework=request.framework,
            module_count=request.module_count,
            response_locale=response_locale,
            seed_material=seed_material,
        )
        await sink.emit("stage.started", {"stage": _STAGE.value})
        plan = await _ask_twice(
            client,
            role=_ROLE_PLAN,
            system=system,
            user=user,
            parse=_plan_from_text,
            schema=CoursePlan.model_json_schema(),
        )
        await sink.emit("stage.finished", {"stage": _STAGE.value, "ok": True, "duration_ms": 0})

        await course_store.replace_modules(scope, session, course_id, plan)
        await course_store.set_course_status(scope, session, course_id, CourseStatus.PLANNED.value)
        await course_store.append_turn(
            scope,
            session,
            course_id,
            role="nala",
            content=(
                plan.summary
                or f"Planned {len(plan.modules)} modules. Generate them when you are ready."
            )[:8_000],
            run_id=run_id,
        )
        await session.commit()
        await run_store.finish(
            RunStatus.SUCCEEDED,
            {"status": RunStatus.SUCCEEDED, "reason_code": "course_planned"},
        )
    except PlanRefused as exc:
        log.warning("course.plan run %s refused both plans: %s", run_id, exc)
        await sink.emit("stage.finished", {"stage": _STAGE.value, "ok": False, "duration_ms": 0})
        await _fail_course_run(
            store=course_store,
            scope=scope,
            session=session,
            course_id=course_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"the plan did not hold up: {exc}",
            reason_code="course_plan_rejected",
            set_status=CourseStatus.FAILED.value,
        )
    except Exception as exc:
        log.exception("course.plan run %s failed", run_id)
        await _fail_course_run(
            store=course_store,
            scope=scope,
            session=session,
            course_id=course_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"course planning failed: {exc}",
            reason_code="course_plan_failed",
            set_status=CourseStatus.FAILED.value,
        )


async def handle_course_revise(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    store: CourseStore | None = None,
) -> None:
    started = await _start(session, payload)
    if started is None:
        return
    scope, run_id, run_store, sink = started
    course_id = uuid.UUID(payload["course_id"])
    course_store = store or RepoCourseStore()
    response_locale = normalize_response_locale(payload.get("response_locale"))
    client = llm or default_llm()

    try:
        course = await course_store.get_course(scope, session, course_id)
        modules = await course_store.list_modules(scope, session, course_id)
        if not modules:
            raise ValueError("this course has no plan to revise")
        # Built from the MODULE ROWS, not from `courses.plan`. That column is what
        # the planner last returned; the rows are what the reader is looking at,
        # and a hand edit through PATCH /courses/{id} moves the rows only. Sending
        # the model the stale column would have it "keep" module titles the reader
        # already renamed. `model_construct` because a hand reorder can leave a
        # prerequisite pointing forward, and refusing to let the reader FIX that in
        # chat would be exactly the wrong answer.
        # One implementation, shared with `GET /courses/{id}/export.zip` — see its
        # docstring for why the rows and not the `courses.plan` column.
        current = plan_from_modules(course, modules)
        _audience, _style, framework = _course_preferences(course)
        message = str((payload.get("request") or {}).get("message", ""))

        system, user = revise_plan_prompt(
            current,
            message,
            response_locale=response_locale,
            framework=framework,
        )
        await sink.emit("stage.started", {"stage": _STAGE.value})
        revision = await _ask_twice(
            client,
            role=_ROLE_REVISE,
            system=system,
            user=user,
            parse=_revision_from_text,
            schema=PlanRevision.model_json_schema(),
        )
        await sink.emit("stage.finished", {"stage": _STAGE.value, "ok": True, "duration_ms": 0})

        await course_store.replace_modules(scope, session, course_id, revision.plan)
        await course_store.append_turn(
            scope,
            session,
            course_id,
            role="nala",
            content=(revision.reply or revision.summary or "Updated the plan.")[:8_000],
            run_id=run_id,
        )
        await session.commit()
        await run_store.finish(
            RunStatus.SUCCEEDED,
            {"status": RunStatus.SUCCEEDED, "reason_code": "course_revised"},
        )
    except PlanRefused as exc:
        log.warning("course.revise run %s refused both plans: %s", run_id, exc)
        await sink.emit("stage.finished", {"stage": _STAGE.value, "ok": False, "duration_ms": 0})
        await _fail_course_run(
            store=course_store,
            scope=scope,
            session=session,
            course_id=course_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"the revised plan did not hold up: {exc}",
            reason_code="course_revision_rejected",
            # The EXISTING plan still stands, so the course is not `failed` — only
            # this turn is. Leaving the status alone is the difference between "your
            # edit did not work" and "your course is broken".
            set_status=None,
        )
    except Exception as exc:
        log.exception("course.revise run %s failed", run_id)
        await _fail_course_run(
            store=course_store,
            scope=scope,
            session=session,
            course_id=course_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"course revision failed: {exc}",
            reason_code="course_revision_failed",
            set_status=None,
        )


async def handle_course_dead_letter(
    session: AsyncSession,
    payload: dict[str, Any],
    reason: str,
    *,
    store: CourseStore | None = None,
) -> None:
    """Close an active run AND say so on the course when the durable job cannot
    continue (worker crash, exhausted retries, lost lease). Without this a
    dead-lettered `course.plan` leaves a course in `planning` forever, with
    nothing that could ever move it."""
    from .handlers import handle_run_dead_letter

    await handle_run_dead_letter(session, payload, reason)
    course_id = payload.get("course_id")
    run_id = payload.get("run_id")
    if not course_id or not run_id:
        return
    scope = _scope_from_payload(payload)
    course_store = store or RepoCourseStore()
    planning = payload.get("kind") == "plan"
    try:
        if planning:
            await course_store.set_course_status(
                scope, session, uuid.UUID(course_id), CourseStatus.FAILED.value
            )
        await course_store.append_turn(
            scope,
            session,
            uuid.UUID(course_id),
            role="nala",
            content=f"I couldn't finish this: job dead-lettered: {reason[:500]}",
            run_id=uuid.UUID(run_id),
        )
        await session.commit()
    except Exception:
        await session.rollback()
        log.exception("course dead-letter: failed to mark course %s", course_id)
