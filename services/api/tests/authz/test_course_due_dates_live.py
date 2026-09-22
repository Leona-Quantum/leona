"""Who may set a course module's due date, and what the gradebook reads against it,
against real Postgres (ai-ops 349 proposal 8, assignments).

The rule under test (`repos.courses.update_course`): **only the course's creator
(`courses.owner_user_id`) may set or clear a module's due date; anyone else in the
workspace is refused 403, whatever their workspace role, and nothing they sent is
applied; a caller from another workspace gets 404**, the answer every course route
gives across a workspace boundary.

`test_course_repo.py` proves the logic on fakes. What only a database proves:

- that the value survives the round trip through a `timestamptz` column as the same
  INSTANT, whatever offset it was sent with;
- that the late/missing boundary holds on timestamps Postgres itself wrote and
  returned, with their real precision, rather than on Python values a fake echoed
  back;
- that a refused request really changed nothing, read back from the table rather
  than off the ORM instance the refused request was holding.

Everything runs inside the authz `db` fixture's transaction and is rolled back.
"""

from __future__ import annotations

import csv as csv_module
import datetime as dt
import io
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.courses import CoursePlan, PlannedModule
from majorana_contracts.enums import Framework, Role, RunMode
from matrix_helpers import requires_db
from sqlalchemy import select

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.ids import uuid7
from majorana_api.orm import CourseModule as CourseModuleRow
from majorana_api.orm import RunEvent, User, Workspace
from majorana_api.repos import courses as courses_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

FRAMEWORK = {"name": "qiskit", "version": ">=2.5,<2.6", "execution": "local-statevector"}

GRADED_SPEC = {
    "schema_version": 1,
    "slug": "graded",
    "title": "Graded",
    "kind": "lesson",
    "cells": [
        {"id": "c01", "kind": "markdown", "role": "objective", "source": "# Hi"},
        {
            "id": "ex1",
            "kind": "code",
            "role": "solution",
            "source": "def double(x):\n    return 2 * x",
            "stub": "def double(x):\n    ...",
            "check": "assert double(3) == 6",
        },
    ],
}

#: 17:00 in Tokyo on the 30th, which is 08:00 UTC. Sent with its offset on purpose.
DUE = dt.datetime(2026, 9, 30, 8, 0, tzinfo=dt.timezone.utc)
DUE_IN_TOKYO = "2026-09-30T17:00:00+09:00"
#: Postgres keeps microseconds, so this is the smallest step either side of the line.
TICK = dt.timedelta(microseconds=1)


async def _person(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"due-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@due.test",
        display_name=tag.title(),
    )


async def _owner_scope(db, tag: str) -> Scope:
    user, workspace = await _person(db, tag)
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


async def _co_member(db, owner: Scope, tag: str, *, role: Role = Role.MEMBER) -> Scope:
    user, _own = await _person(db, tag)
    await workspaces_repo.add_member(owner, db, user_id=user.id, role=role)
    return Scope(user_id=user.id, workspace_id=owner.workspace_id, role=role)


async def _course(db, creator: Scope):
    """A two-module course: the first has a ready notebook with one graded exercise,
    the second is still only planned."""
    course = await courses_repo.create_course(
        creator,
        db,
        slug=f"due-{uuid.uuid4().hex[:8]}",
        title="Due date probe",
        brief="A course for the due-date suite.",
        audience={},
        style={},
        framework=FRAMEWORK,
        language="en",
        plan_run_id=None,
    )
    plan = CoursePlan(
        title="Due date probe",
        modules=[
            PlannedModule(slug="week-01", title="Week 1", objectives=["one"], brief="One."),
            PlannedModule(slug="week-02", title="Week 2", objectives=["two"], brief="Two."),
        ],
    )
    modules = await courses_repo.replace_modules(creator, db, course.id, plan)
    notebook, version = await notebooks_repo.create_notebook(
        creator,
        db,
        slug=f"due-nb-{uuid.uuid4().hex[:8]}",
        title="Week 1",
        kind="lesson",
        summary="",
        language="en",
        framework=FRAMEWORK,
        request={},
        run_id=None,
    )
    await notebooks_repo.set_version_result(
        creator,
        db,
        version.id,
        status="ready",
        spec=GRADED_SPEC,
        source="",
        ipynb=None,
        report=None,
        review=None,
        error="",
    )
    await courses_repo.attach_module_notebook(creator, db, course.id, modules[0].id, notebook.id)
    return course, modules, version


async def _grade(
    db,
    learner: Scope,
    version_id: uuid.UUID,
    *,
    at: dt.datetime,
    passed: int = 1,
    failed: int = 0,
):
    """One grading run and its `notebook.grades` event, graded at `at`.

    Both clocks are set by hand: every row here is written in ONE transaction, where
    `now()` is the same instant for all of them, and the gradebook reads the grading
    time from the event (`run_events.ts`) while it orders attempts by the run's
    `created_at`.

    The event is INSERTED with its `ts` rather than written by `append_run_event` and
    stamped afterwards: `run_events` is append-only, and `app_rw`, the role this suite
    runs as, holds no UPDATE on it (0052), which is the point of running as it.
    """
    run = await runs_repo.create_run(
        learner,
        db,
        task_prompt="Grade an attempt",
        mode=RunMode.NOTEBOOK,
        framework=Framework.QISKIT,
    )
    run.created_at = at
    event = RunEvent(
        id=uuid7(),
        run_id=run.id,
        seq=1,
        type="notebook.grades",
        ts=at,
        payload={
            "version_id": str(version_id),
            "grades": {
                "notebook_slug": "graded",
                "cells": [
                    {
                        "id": "ex1",
                        "status": "passed" if passed else "failed",
                        "graded_by": "deterministic",
                    }
                ],
            },
            "passed": passed,
            "failed": failed,
            "attempted": passed + failed,
            "note": "",
        },
    )
    db.add(event)
    await db.flush()
    return run


async def _stored_due_at(db, module_id: uuid.UUID) -> dt.datetime | None:
    """Read from the table, not off an ORM instance a request may still be holding.

    A column select, so the value comes from the row. It autoflushes first, which is
    the stricter check: an instance a refused request had mutated in memory would be
    written and caught here, rather than hidden by a rollback the shared test session
    never performs.
    """
    return (
        await db.execute(select(CourseModuleRow.due_at).where(CourseModuleRow.id == module_id))
    ).scalar_one()


def _client(db, scope: Scope) -> httpx.AsyncClient:
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=scope.user_id, email="probe@due.test"),
        Workspace(id=scope.workspace_id),
    )
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _patch_body(module_id: uuid.UUID, due_at: str | None) -> dict:
    return {"modules": [{"id": str(module_id), "due_at": due_at}]}


# ---------------------------------------------------------------------------- the rule


async def test_the_creator_sets_and_clears_a_due_date_on_a_generated_module(db):
    creator = await _owner_scope(db, "teacher")
    course, modules, _version = await _course(db, creator)
    generated = modules[0]

    async with _client(db, creator) as c:
        set_response = await c.patch(
            f"/v1/courses/{course.id}", json=_patch_body(generated.id, DUE_IN_TOKYO)
        )
        read_back = await c.get(f"/v1/courses/{course.id}")
    assert set_response.status_code == 200, set_response.text
    assert await _stored_due_at(db, generated.id) == DUE, "stored as the same instant"
    body = read_back.json()
    assert body["owner_user_id"] == str(creator.user_id)
    assert dt.datetime.fromisoformat(body["modules"][0]["due_at"]) == DUE
    assert body["modules"][0]["notebook_id"] is not None, "a generated module"
    assert body["modules"][1]["due_at"] is None

    async with _client(db, creator) as c:
        cleared = await c.patch(f"/v1/courses/{course.id}", json=_patch_body(generated.id, None))
    assert cleared.status_code == 200, cleared.text
    assert await _stored_due_at(db, generated.id) is None


@pytest.mark.parametrize("role", [Role.MEMBER, Role.ADMIN])
async def test_a_workspace_member_who_did_not_create_the_course_is_refused(db, role):
    creator = await _owner_scope(db, "teacher")
    classmate = await _co_member(db, creator, "classmate", role=role)
    course, modules, _version = await _course(db, creator)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, DUE_IN_TOKYO)]
    )

    async with _client(db, classmate) as c:
        moved = await c.patch(
            f"/v1/courses/{course.id}",
            json={"title": "Renamed by a classmate", **_patch_body(modules[0].id, None)},
        )
        set_new = await c.patch(
            f"/v1/courses/{course.id}", json=_patch_body(modules[1].id, "2026-10-07T08:00:00Z")
        )
    for response in (moved, set_new):
        assert response.status_code == 403, response.text
        assert response.json()["reason"] == "course_due_date_creator_only"
    # Nothing the refused requests carried was applied, read back from the table.
    assert await _stored_due_at(db, modules[0].id) == DUE
    assert await _stored_due_at(db, modules[1].id) is None
    reread = await courses_repo.get_course(creator, db, course.id)
    assert reread.title == "Due date probe"


async def test_the_workspace_owner_who_did_not_write_the_course_is_refused_too(db):
    """The creator is `courses.owner_user_id`, not the workspace owner."""
    workspace_owner = await _owner_scope(db, "wsowner")
    teacher = await _co_member(db, workspace_owner, "teacher")
    course, modules, _version = await _course(db, teacher)

    async with _client(db, workspace_owner) as c:
        refused = await c.patch(
            f"/v1/courses/{course.id}", json=_patch_body(modules[0].id, DUE_IN_TOKYO)
        )
    async with _client(db, teacher) as c:
        allowed = await c.patch(
            f"/v1/courses/{course.id}", json=_patch_body(modules[0].id, DUE_IN_TOKYO)
        )
    assert refused.status_code == 403
    # The control: the same request from the member who wrote the course lands.
    assert allowed.status_code == 200, allowed.text
    assert await _stored_due_at(db, modules[0].id) == DUE


async def test_a_read_only_member_is_refused_by_the_role_gate_first(db):
    creator = await _owner_scope(db, "teacher")
    viewer = await _co_member(db, creator, "viewer", role=Role.VIEWER)
    course, modules, _version = await _course(db, creator)
    async with _client(db, viewer) as c:
        response = await c.patch(
            f"/v1/courses/{course.id}", json=_patch_body(modules[0].id, DUE_IN_TOKYO)
        )
    assert response.status_code == 403
    assert await _stored_due_at(db, modules[0].id) is None


async def test_another_workspace_gets_404_and_changes_nothing(db):
    creator = await _owner_scope(db, "teacher")
    course, modules, _version = await _course(db, creator)
    stranger = await _owner_scope(db, "stranger")
    async with _client(db, stranger) as c:
        response = await c.patch(
            f"/v1/courses/{course.id}", json=_patch_body(modules[0].id, DUE_IN_TOKYO)
        )
    assert response.status_code == 404
    assert await _stored_due_at(db, modules[0].id) is None


async def test_a_plan_revision_keeps_the_due_date_of_every_module_that_survives(db):
    creator = await _owner_scope(db, "teacher")
    course, modules, _version = await _course(db, creator)
    await courses_repo.update_course(
        creator,
        db,
        course.id,
        module_patches=[
            _parsed_patch(modules[0].id, DUE_IN_TOKYO),
            _parsed_patch(modules[1].id, DUE_IN_TOKYO),
        ],
    )
    revised = CoursePlan(
        title="Due date probe",
        modules=[
            PlannedModule(slug="week-00", title="Week 0", objectives=["zero"], brief="Zero."),
            PlannedModule(slug="week-01", title="Week 1", objectives=["one"], brief="One."),
            PlannedModule(slug="week-02", title="Week 2, revised", objectives=["t"], brief="T."),
        ],
    )
    rows = await courses_repo.replace_modules(creator, db, course.id, revised)
    by_slug = {row.slug: row.id for row in rows}
    assert await _stored_due_at(db, by_slug["week-00"]) is None, "a new module has none"
    assert await _stored_due_at(db, by_slug["week-01"]) == DUE
    assert await _stored_due_at(db, by_slug["week-02"]) == DUE


def _parsed_patch(module_id: uuid.UUID, due_at: str | None):
    from majorana_contracts import CourseModulePatch

    return CourseModulePatch.model_validate({"id": str(module_id), "due_at": due_at})


# ----------------------------------------------------------- late and missing, on Postgres


async def test_late_and_missing_hold_their_boundary_on_timestamps_postgres_wrote(db):
    creator = await _owner_scope(db, "teacher")
    on_the_dot = await _co_member(db, creator, "dot")
    after = await _co_member(db, creator, "after")
    before = await _co_member(db, creator, "before")
    nobody = await _co_member(db, creator, "nobody")
    course, modules, version = await _course(db, creator)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, DUE_IN_TOKYO)]
    )
    await _grade(db, on_the_dot, version.id, at=DUE)
    await _grade(db, after, version.id, at=DUE + TICK)
    await _grade(db, before, version.id, at=DUE - TICK)

    def rows(book):
        return {row.user_id: row for row in book.rows}

    at_the_line = rows(await courses_repo.course_gradebook(creator, db, course.id, now=DUE))
    past_it = rows(await courses_repo.course_gradebook(creator, db, course.id, now=DUE + TICK))

    # An attempt graded AT the due instant is on time; one microsecond later is late.
    assert [e.late for e in past_it[on_the_dot.user_id].entries] == [False]
    assert [e.late for e in past_it[after.user_id].entries] == [True]
    assert [e.late for e in past_it[before.user_id].entries] == [False]
    # At the due instant nobody is missing yet; a microsecond later the member with no
    # attempt is. Week 2 has no notebook, so it can be missing for no one.
    assert at_the_line[nobody.user_id].missing_module_ids == []
    assert past_it[nobody.user_id].missing_module_ids == [modules[0].id]
    for learner in (on_the_dot, after, before):
        assert past_it[learner.user_id].missing_module_ids == []


async def test_practising_after_the_deadline_does_not_make_an_on_time_member_late(db):
    """Owner ruling ai-ops 364, option 1: "Late only if there was no graded attempt by
    the due time", with the latest score still the one shown.

    Ana is graded before the deadline and tries again afterwards. Bo only ever tries
    afterwards, twice. Under the rule as first built -- late follows the latest attempt
    -- both would be late, because both of their latest attempts are past the due date.

    Bo is the negative control, and he is the whole point of the pair: a change that
    read the wrong instant, or dropped `late` altogether, would make Ana pass on its
    own. Only Bo staying late says the mark still fires when nothing was on time.
    """
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, modules, version = await _course(db, creator)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, DUE_IN_TOKYO)]
    )
    # On time and failing, then late and passing: the case the ruling calls out, where
    # the mark and the score deliberately disagree.
    await _grade(db, ana, version.id, at=DUE - dt.timedelta(hours=2), passed=0, failed=1)
    ana_latest = await _grade(db, ana, version.id, at=DUE + dt.timedelta(hours=2))
    await _grade(db, bo, version.id, at=DUE + dt.timedelta(minutes=1), passed=0, failed=1)
    bo_latest = await _grade(db, bo, version.id, at=DUE + dt.timedelta(hours=3))

    rows = {
        row.user_id: row
        for row in (await courses_repo.course_gradebook(creator, db, course.id, now=DUE + TICK)).rows
    }
    ana_entry = rows[ana.user_id].entries[0]
    bo_entry = rows[bo.user_id].entries[0]

    assert ana_entry.late is False
    assert bo_entry.late is True
    # Latest rather than best, unchanged: each row still shows the last attempt, so
    # Ana's on-time failure reads as the pass she got afterwards.
    assert (ana_entry.run_id, ana_entry.passed, ana_entry.failed) == (ana_latest.id, 1, 0)
    assert (bo_entry.run_id, bo_entry.passed, bo_entry.failed) == (bo_latest.id, 1, 0)
    # Neither is missing: a missing module is one with no attempt at all.
    assert rows[ana.user_id].missing_module_ids == []
    assert rows[bo.user_id].missing_module_ids == []


async def test_one_members_on_time_attempt_does_not_clear_anothers_late_mark(db):
    """The `late` window is partitioned by member AND module. A partition too wide --
    by module alone -- would let Ana's on-time attempt clear Bo's mark, and the test
    above could not tell, because there each member's own history explains their mark.
    """
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, modules, version = await _course(db, creator)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, DUE_IN_TOKYO)]
    )
    await _grade(db, ana, version.id, at=DUE - dt.timedelta(hours=1))
    await _grade(db, bo, version.id, at=DUE + dt.timedelta(hours=1))

    rows = {
        row.user_id: row
        for row in (await courses_repo.course_gradebook(creator, db, course.id, now=DUE + TICK)).rows
    }
    assert rows[ana.user_id].entries[0].late is False
    assert rows[bo.user_id].entries[0].late is True


async def test_moving_the_due_date_moves_late_with_it(db):
    """Derived, not stored: the instructor extends the deadline and the late mark goes."""
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, modules, version = await _course(db, creator)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, DUE_IN_TOKYO)]
    )
    await _grade(db, ana, version.id, at=DUE + dt.timedelta(hours=1))
    book = await courses_repo.course_gradebook(creator, db, course.id, now=DUE + TICK)
    assert [row.entries[0].late for row in book.rows if row.user_id == ana.user_id] == [True]

    await courses_repo.update_course(
        creator,
        db,
        course.id,
        module_patches=[_parsed_patch(modules[0].id, "2026-10-01T08:00:00Z")],
    )
    book = await courses_repo.course_gradebook(creator, db, course.id, now=DUE + TICK)
    assert [row.entries[0].late for row in book.rows if row.user_id == ana.user_id] == [False]


async def test_a_member_sees_their_own_late_and_missing_and_no_one_elses(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, modules, version = await _course(db, creator)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, DUE_IN_TOKYO)]
    )
    await _grade(db, ana, version.id, at=DUE + TICK)

    bo_view = await courses_repo.course_gradebook(bo, db, course.id, now=DUE + TICK)
    assert [row.user_id for row in bo_view.rows] == [bo.user_id]
    assert bo_view.rows[0].missing_module_ids == [modules[0].id]
    assert bo_view.modules[0].due_at == DUE


# -------------------------------------------------------------------------------- HTTP


async def test_the_creators_csv_carries_due_at_late_and_missing(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, modules, version = await _course(db, creator)
    # A due date safely in the past, so "missing" is decided by the real clock the
    # route reads, not by a moment the test passed in.
    past = dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)
    await courses_repo.update_course(
        creator, db, course.id, module_patches=[_parsed_patch(modules[0].id, past.isoformat())]
    )
    await _grade(db, ana, version.id, at=past + dt.timedelta(days=1))

    async with _client(db, creator) as c:
        response = await c.get(f"/v1/courses/{course.id}/gradebook.csv")
    assert response.status_code == 200, response.text
    records = list(csv_module.DictReader(io.StringIO(response.content.decode().lstrip("﻿"))))
    week1 = {r["email"]: r for r in records if r["module_number"] == "1"}
    week2 = [r for r in records if r["module_number"] == "2"]
    ana_email = next(email for email in week1 if email.startswith("ana-"))
    teacher_email = next(email for email in week1 if email.startswith("teacher-"))
    assert week1[ana_email]["due_at"] == "2020-01-01T00:00:00+00:00"
    assert (week1[ana_email]["late"], week1[ana_email]["missing"]) == ("yes", "no")
    # The creator is a member too, has no attempt, and the due date has passed.
    assert (week1[teacher_email]["late"], week1[teacher_email]["missing"]) == ("", "yes")
    assert {(r["due_at"], r["missing"]) for r in week2} == {("", "no")}
