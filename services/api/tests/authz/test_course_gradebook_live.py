"""Who may read a course's gradebook, against real Postgres (ai-ops 349 proposal 8).

The rule under test (`repos.courses.course_gradebook`): **the course's creator sees
every current member's row, started or not; anyone else in the workspace sees only
their own, started or not; and a caller from another workspace sees nothing at all**
(404, the answer every course route gives across a workspace boundary). Owner ruling ai-ops 260, option 1, is
"only the person who created it sees the answers"; a gradebook carries results
rather than answers, but it shows one member's work to another, so it follows the
same line.

`test_course_repo.py` asserts the clauses on the compiled SQL. That proves the query
SAYS the right thing; only a database proves it DOES — that `DISTINCT ON` keeps the
latest attempt rather than an arbitrary one, that the LEFT join from memberships
lists a member with no attempt and drops a person who left, and that a grading event
forged in another workspace against this workspace's notebook version is not joined
in on the strength of its payload alone.

Everything runs inside the authz `db` fixture's transaction and is rolled back. One
connection throughout, so there is no cross-connection visibility question to make
an assertion vacuous; the HTTP tests hand the same session to the app.

The probes for "another workspace" are a real second workspace, not a different role
in the first: a co-member is exactly who the creator-only rule exists to stop, and a
stranger is stopped earlier and more strongly by `get_course`'s workspace filter.
"""

from __future__ import annotations

import csv as csv_module
import datetime as dt
import io
import uuid

import httpx
import pytest
from majorana_contracts import GradebookVisibility, Scope
from majorana_contracts.courses import CoursePlan, PlannedModule
from majorana_contracts.enums import Framework, Role, RunMode
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.orm import User, Workspace
from majorana_api.repos import courses as courses_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.repos._base import NotFoundError
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
        {
            "id": "ex2",
            "kind": "code",
            "role": "solution",
            "source": "def triple(x):\n    return 3 * x",
            "stub": "def triple(x):\n    ...",
            "check": "assert triple(2) == 6",
        },
    ],
}

T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.timezone.utc)


async def _person(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"gradebook-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@gradebook.test",
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
    """A two-module course whose first module has a ready, graded notebook."""
    course = await courses_repo.create_course(
        creator,
        db,
        slug=f"gradebook-{uuid.uuid4().hex[:8]}",
        title="Gradebook probe",
        brief="A course for the gradebook suite.",
        audience={},
        style={},
        framework=FRAMEWORK,
        language="en",
        plan_run_id=None,
    )
    plan = CoursePlan(
        title="Gradebook probe",
        modules=[
            PlannedModule(slug="week-01", title="Week 1", objectives=["one"], brief="One."),
            PlannedModule(slug="week-02", title="Week 2", objectives=["two"], brief="Two."),
        ],
    )
    modules = await courses_repo.replace_modules(creator, db, course.id, plan)
    notebook, version = await notebooks_repo.create_notebook(
        creator,
        db,
        slug=f"gradebook-nb-{uuid.uuid4().hex[:8]}",
        title="Week 1",
        kind="lesson",
        summary="",
        language="en",
        framework=FRAMEWORK,
        request={},
        run_id=None,
    )
    await _make_ready(db, creator, version.id)
    await courses_repo.attach_module_notebook(creator, db, course.id, modules[0].id, notebook.id)
    return course, modules, notebook, version


async def _make_ready(db, scope: Scope, version_id: uuid.UUID) -> None:
    await notebooks_repo.set_version_result(
        scope,
        db,
        version_id,
        status="ready",
        spec=GRADED_SPEC,
        source="",
        ipynb=None,
        report=None,
        review=None,
        error="",
    )


async def _grade(db, learner: Scope, version_id: uuid.UUID, *, passed: int, at: dt.datetime):
    """One grading run and its `notebook.grades` event, the shape the worker emits.

    `created_at` is set by hand because every row in this suite is written inside ONE
    transaction, where `now()` is the same instant for all of them — so without it
    "latest" would be decided entirely by the tie-breakers.
    """
    run = await runs_repo.create_run(
        learner,
        db,
        task_prompt="Grade an attempt",
        mode=RunMode.NOTEBOOK,
        framework=Framework.QISKIT,
    )
    run.created_at = at
    await db.flush()
    cells = [
        {
            "id": cell_id,
            "status": "passed" if i < passed else "failed",
            "graded_by": "deterministic",
        }
        for i, cell_id in enumerate(("ex1", "ex2"))
    ]
    await runs_repo.append_run_event(
        learner,
        db,
        run.id,
        type="notebook.grades",
        payload={
            "version_id": str(version_id),
            "grades": {"notebook_slug": "graded", "cells": cells},
            "passed": passed,
            "failed": 2 - passed,
            "attempted": 2,
            "note": "",
        },
    )
    return run


# ---------------------------------------------------------------------------- the rule


def _by_user(book):
    return {row.user_id: row for row in book.rows}


async def test_the_course_creator_sees_every_current_member_started_or_not(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    cy = await _co_member(db, creator, "cy")  # never graded
    course, modules, _nb, version = await _course(db, creator)
    await _grade(db, ana, version.id, passed=2, at=T0)
    await _grade(db, bo, version.id, passed=1, at=T0)

    book = await courses_repo.course_gradebook(creator, db, course.id)

    assert book.visibility is GradebookVisibility.ALL_MEMBERS
    # The whole class, the creator included: the members page lists them too.
    assert set(_by_user(book)) == {creator.user_id, ana.user_id, bo.user_id, cy.user_id}
    rows = _by_user(book)
    assert [(e.module_id, e.passed, e.graded_cells) for e in rows[ana.user_id].entries] == [
        (modules[0].id, 2, 2)
    ]
    assert rows[bo.user_id].total_passed == 1
    # Week 2 has no notebook, so it adds nothing to the denominator.
    assert rows[bo.user_id].total_graded_cells == 2
    # Cy has not started: a row with nothing in it, not a zero score.
    assert rows[cy.user_id].entries == []
    assert rows[cy.user_id].last_graded_at is None
    assert (rows[cy.user_id].total_passed, rows[cy.user_id].total_graded_cells) == (0, 2)
    assert [m.graded_cells for m in book.modules] == [2, None]


async def test_a_member_who_did_not_create_the_course_sees_only_their_own_row(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, _nb, version = await _course(db, creator)
    await _grade(db, ana, version.id, passed=2, at=T0)
    await _grade(db, bo, version.id, passed=1, at=T0)

    book = await courses_repo.course_gradebook(ana, db, course.id)

    assert book.visibility is GradebookVisibility.OWN_ROW
    assert [row.user_id for row in book.rows] == [ana.user_id]
    assert book.rows[0].total_passed == 2
    # The control: Bo's attempt is really there, and the creator can see it. Without
    # this, "Ana sees one row" would also pass if Bo's grading had silently not landed.
    everyone = await courses_repo.course_gradebook(creator, db, course.id)
    assert _by_user(everyone)[bo.user_id].total_passed == 1


async def test_a_member_who_has_not_started_still_gets_their_own_row_and_no_one_elses(db):
    """An ADMIN of the workspace who did not write the course is a classmate here, and
    a classmate who has not started sees one empty row: their own."""
    creator = await _owner_scope(db, "teacher")
    admin = await _co_member(db, creator, "admin", role=Role.ADMIN)
    ana = await _co_member(db, creator, "ana")
    course, _modules, _nb, version = await _course(db, creator)
    await _grade(db, ana, version.id, passed=2, at=T0)

    book = await courses_repo.course_gradebook(admin, db, course.id)

    assert book.visibility is GradebookVisibility.OWN_ROW
    assert [(row.user_id, row.entries, row.last_graded_at) for row in book.rows] == [
        (admin.user_id, [], None)
    ]


async def test_a_member_created_course_gives_its_creator_the_full_view(db):
    """The creator is `courses.owner_user_id`, not the workspace owner: a plain member
    who wrote a course reads everyone's row on it, and the workspace owner does not."""
    workspace_owner = await _owner_scope(db, "wsowner")
    teacher = await _co_member(db, workspace_owner, "teacher")
    ana = await _co_member(db, workspace_owner, "ana")
    course, _modules, _nb, version = await _course(db, teacher)
    await _grade(db, ana, version.id, passed=1, at=T0)

    teacher_view = await courses_repo.course_gradebook(teacher, db, course.id)
    assert set(_by_user(teacher_view)) == {workspace_owner.user_id, teacher.user_id, ana.user_id}
    owner_view = await courses_repo.course_gradebook(workspace_owner, db, course.id)
    assert owner_view.visibility is GradebookVisibility.OWN_ROW
    assert [(row.user_id, row.entries) for row in owner_view.rows] == [
        (workspace_owner.user_id, [])
    ]


async def test_another_workspace_cannot_read_the_gradebook_at_all(db):
    creator = await _owner_scope(db, "teacher")
    course, _modules, _nb, _version = await _course(db, creator)
    stranger = await _owner_scope(db, "stranger")

    with pytest.raises(NotFoundError):
        await courses_repo.course_gradebook(stranger, db, course.id)


async def test_a_grading_event_forged_in_another_workspace_is_not_joined_in(db):
    """The join to the notebook version goes through the event PAYLOAD, which the
    writer controls. A run in workspace B carrying A's version id must not count in
    A's gradebook.

    The forger is a MEMBER of A running in their own workspace B, on purpose. A
    stranger with no membership in A is never a row at all, so a stranger-only
    version of this test stayed green with `runs.workspace_id` deleted from the
    query (tried: 9 of 9 passed). Only a member of A who writes the run somewhere
    else isolates the tenancy clause: they ARE listed, so the question is whether
    the forged attempt is counted against their name."""
    creator = await _owner_scope(db, "teacher")
    course, _modules, _nb, version = await _course(db, creator)
    user, own_workspace = await _person(db, "forger")
    await workspaces_repo.add_member(creator, db, user_id=user.id, role=Role.MEMBER)
    elsewhere = Scope(user_id=user.id, workspace_id=own_workspace.id, role=Role.OWNER)
    await _grade(db, elsewhere, version.id, passed=2, at=T0)
    stranger = await _owner_scope(db, "stranger")
    await _grade(db, stranger, version.id, passed=2, at=T0)

    book = await courses_repo.course_gradebook(creator, db, course.id)

    assert set(_by_user(book)) == {creator.user_id, user.id}, "the stranger is no member"
    assert _by_user(book)[user.id].entries == [], "the forged attempt must not count"
    # The control: the same member, graded INSIDE A, does count. Without it an empty
    # row would pass whether or not the query could see anything at all.
    inside = Scope(user_id=user.id, workspace_id=creator.workspace_id, role=Role.MEMBER)
    await _grade(db, inside, version.id, passed=1, at=T0)
    book = await courses_repo.course_gradebook(creator, db, course.id)
    assert _by_user(book)[user.id].total_passed == 1


# ------------------------------------------------------------------ what a row reports


async def test_the_latest_attempt_wins_and_a_revised_notebook_marks_it_outdated(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, notebook, version = await _course(db, creator)
    # The LATER attempt is written first, so its run id (a UUIDv7) is the smaller one:
    # if `created_at` were not the deciding key, the id tie-breaker would pick the
    # earlier attempt and this test would fail.
    later = await _grade(db, ana, version.id, passed=1, at=T0 + dt.timedelta(hours=2))
    await _grade(db, ana, version.id, passed=2, at=T0)

    row = _by_user(await courses_repo.course_gradebook(creator, db, course.id))[ana.user_id]
    [entry] = row.entries
    assert (entry.passed, entry.run_id, entry.stale) == (1, later.id, False)
    assert entry.version_seq == 1

    revised = await notebooks_repo.create_version(
        creator, db, notebook.id, created_by="user", message="revised", request={}, run_id=None
    )
    await _make_ready(db, creator, revised.id)

    row = _by_user(await courses_repo.course_gradebook(creator, db, course.id))[ana.user_id]
    assert row.entries[0].stale is True
    assert row.entries[0].version_seq == 1


async def test_a_person_who_left_the_workspace_leaves_the_gradebook(db):
    """Graded or not: the LEFT join must start from CURRENT memberships, so a person
    who left is gone whether or not they had an attempt to join to."""
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    dee = await _co_member(db, creator, "dee")  # never graded
    course, _modules, _nb, version = await _course(db, creator)
    await _grade(db, ana, version.id, passed=2, at=T0)
    await _grade(db, bo, version.id, passed=2, at=T0)

    # Through the real removal path, the one the members page's "Remove" button uses.
    await workspaces_repo.remove_member(creator, db, user_id=bo.user_id)
    await workspaces_repo.remove_member(creator, db, user_id=dee.user_id)

    book = await courses_repo.course_gradebook(creator, db, course.id)
    assert set(_by_user(book)) == {creator.user_id, ana.user_id}


# -------------------------------------------------------------------------------- HTTP


def _client(db, scope: Scope) -> httpx.AsyncClient:
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=scope.user_id, email="probe@gradebook.test"),
        Workspace(id=scope.workspace_id),
    )
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_over_http_a_stranger_gets_404_and_a_member_gets_their_own_row(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    cy = await _co_member(db, creator, "cy")  # never graded
    course, _modules, _nb, version = await _course(db, creator)
    await _grade(db, ana, version.id, passed=2, at=T0)
    await _grade(db, bo, version.id, passed=1, at=T0)
    stranger = await _owner_scope(db, "stranger")

    async with _client(db, stranger) as c:
        for suffix in ("gradebook", "gradebook.csv"):
            response = await c.get(f"/v1/courses/{course.id}/{suffix}")
            assert response.status_code == 404, (suffix, response.text)

    async with _client(db, ana) as c:
        own = await c.get(f"/v1/courses/{course.id}/gradebook")
        own_csv = await c.get(f"/v1/courses/{course.id}/gradebook.csv")
    assert own.status_code == 200, own.text
    assert own.json()["visibility"] == "own_row"
    assert [row["user_id"] for row in own.json()["rows"]] == [str(ana.user_id)]
    csv_text = own_csv.content.decode("utf-8")
    ana_email = own.json()["rows"][0]["email"]
    assert ana_email in csv_text
    # Neither a classmate who was graded nor one who was not reaches Ana through the
    # export: her CSV is her own row and nothing else.
    async with _client(db, creator) as c:
        full = (await c.get(f"/v1/courses/{course.id}/gradebook")).json()
        full_csv = (await c.get(f"/v1/courses/{course.id}/gradebook.csv")).content.decode()
    emails = {row["user_id"]: row["email"] for row in full["rows"]}
    assert emails[str(bo.user_id)] not in csv_text
    assert emails[str(cy.user_id)] not in csv_text
    assert full["visibility"] == "all_members"
    # The creator's export lists Cy, not started: an empty cells_passed.
    records = list(csv_module.DictReader(io.StringIO(full_csv.lstrip("\ufeff"))))
    cy_rows = [r for r in records if r["email"] == emails[str(cy.user_id)]]
    assert [(r["module_number"], r["cells_passed"]) for r in cy_rows] == [("1", ""), ("2", "")]
