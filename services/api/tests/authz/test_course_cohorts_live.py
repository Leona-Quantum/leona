"""Who may manage a course's cohorts, and who the gradebook's `?cohort_id=`
filter shows to whom, against real Postgres (ai-ops 349 proposal 8, cohorts
slice).

The rule under test (`repos.cohorts`): **only the course's creator
(`courses.owner_user_id`) may create, rename, delete a cohort or assign a
member to one — refused 403, whatever the caller's workspace role; anyone else
in the workspace may read the list, and gets at most their own cohort's name,
never a roster; a caller from another workspace gets 404**, the answer every
course route gives across a workspace boundary. This is the same line
`test_course_due_dates_live.py` draws for due dates, and for the identical
reason: workspace role is not the test, `courses.owner_user_id` is.

`test_course_repo.py`/`test_course_routes.py` are the fake-backed unit suites
for the rest of this package; this file adds no equivalent for cohorts —
only what a real database proves is covered here: that a member is in AT MOST
ONE cohort at a time (the upsert onto a real primary key, under a real unique
constraint), that a duplicate name is refused by the database's own index and
not merely by application logic, and that the gradebook's cohort filter is a
predicate a real query evaluates rather than a client-side illusion.

Everything runs inside the authz `db` fixture's transaction and is rolled back.
"""

from __future__ import annotations

import datetime as dt
import uuid

import httpx
import pytest
from majorana_contracts import CohortVisibility, Scope
from majorana_contracts.courses import CoursePlan, PlannedModule
from majorana_contracts.enums import Framework, Role, RunMode
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.orm import User, Workspace
from majorana_api.repos import cohorts as cohorts_repo
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
    ],
}

T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.timezone.utc)


async def _person(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"cohort-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@cohort.test",
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
    course = await courses_repo.create_course(
        creator,
        db,
        slug=f"cohort-{uuid.uuid4().hex[:8]}",
        title="Cohort probe",
        brief="A course for the cohort suite.",
        audience={},
        style={},
        framework=FRAMEWORK,
        language="en",
        plan_run_id=None,
    )
    plan = CoursePlan(
        title="Cohort probe",
        modules=[PlannedModule(slug="week-01", title="Week 1", objectives=["one"], brief="One.")],
    )
    modules = await courses_repo.replace_modules(creator, db, course.id, plan)
    notebook, version = await notebooks_repo.create_notebook(
        creator,
        db,
        slug=f"cohort-nb-{uuid.uuid4().hex[:8]}",
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


async def _grade(db, learner: Scope, version_id: uuid.UUID, *, passed: int, at: dt.datetime):
    run = await runs_repo.create_run(
        learner,
        db,
        task_prompt="Grade an attempt",
        mode=RunMode.NOTEBOOK,
        framework=Framework.QISKIT,
    )
    run.created_at = at
    await db.flush()
    await runs_repo.append_run_event(
        learner,
        db,
        run.id,
        type="notebook.grades",
        payload={
            "version_id": str(version_id),
            "grades": {
                "notebook_slug": "graded",
                "cells": [
                    {"id": "ex1", "status": "passed" if passed else "failed", "graded_by": "d"}
                ],
            },
            "passed": passed,
            "failed": 1 - passed,
            "attempted": 1,
            "note": "",
        },
    )
    return run


def _client(db, scope: Scope) -> httpx.AsyncClient:
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=scope.user_id, email="probe@cohort.test"),
        Workspace(id=scope.workspace_id),
    )
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ---------------------------------------------------------------------------- creation


async def test_the_creator_creates_lists_renames_and_deletes_a_cohort(db):
    creator = await _owner_scope(db, "teacher")
    course, _modules, _version = await _course(db, creator)

    cohort = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    resource = await cohorts_repo.cohort_to_resource(db, cohort)
    assert (resource.name, resource.members, resource.member_count) == ("Section A", [], 0)

    renamed = await cohorts_repo.update_cohort(creator, db, course.id, cohort.id, name="Section A2")
    assert renamed.name == "Section A2"

    listed = await cohorts_repo.list_cohorts(creator, db, course.id)
    assert listed.visibility is CohortVisibility.ALL_COHORTS
    assert [c.name for c in listed.items] == ["Section A2"]

    await cohorts_repo.delete_cohort(creator, db, course.id, cohort.id)
    after = await cohorts_repo.list_cohorts(creator, db, course.id)
    assert after.items == []


async def test_a_duplicate_cohort_name_is_refused(db):
    creator = await _owner_scope(db, "teacher")
    course, _modules, _version = await _course(db, creator)
    await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    await db.flush()

    with pytest.raises(cohorts_repo.DuplicateCohortName):
        await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    await db.rollback()  # the failed insert leaves the transaction unusable past this point


# ---------------------------------------------------------------------------- authz


@pytest.mark.parametrize("role", [Role.MEMBER, Role.ADMIN])
async def test_a_workspace_member_who_did_not_create_the_course_is_refused(db, role):
    creator = await _owner_scope(db, "teacher")
    classmate = await _co_member(db, creator, "classmate", role=role)
    course, _modules, _version = await _course(db, creator)
    ana = await _co_member(db, creator, "ana")

    with pytest.raises(cohorts_repo.CohortCreatorOnly):
        await cohorts_repo.create_cohort(classmate, db, course.id, name="Section A")
    with pytest.raises(cohorts_repo.CohortCreatorOnly):
        await cohorts_repo.set_membership(classmate, db, course.id, ana.user_id, cohort_id=None)


async def test_the_workspace_owner_who_did_not_write_the_course_is_refused_too(db):
    workspace_owner = await _owner_scope(db, "wsowner")
    teacher = await _co_member(db, workspace_owner, "teacher")
    course, _modules, _version = await _course(db, teacher)

    with pytest.raises(cohorts_repo.CohortCreatorOnly):
        await cohorts_repo.create_cohort(workspace_owner, db, course.id, name="Section A")
    # The control: the same call from the member who wrote the course lands.
    cohort = await cohorts_repo.create_cohort(teacher, db, course.id, name="Section A")
    assert cohort.name == "Section A"


async def test_a_read_only_member_is_refused_by_the_role_gate_first(db):
    creator = await _owner_scope(db, "teacher")
    viewer = await _co_member(db, creator, "viewer", role=Role.VIEWER)
    course, _modules, _version = await _course(db, creator)

    with pytest.raises(cohorts_repo.AuthzError):
        await cohorts_repo.create_cohort(viewer, db, course.id, name="Section A")
    # A viewer may still READ — list_cohorts carries no write gate.
    listed = await cohorts_repo.list_cohorts(viewer, db, course.id)
    assert listed.visibility is CohortVisibility.OWN_COHORT
    assert listed.items == []


async def test_another_workspace_gets_404_from_every_mutation(db):
    creator = await _owner_scope(db, "teacher")
    course, _modules, _version = await _course(db, creator)
    stranger = await _owner_scope(db, "stranger")

    with pytest.raises(NotFoundError):
        await cohorts_repo.create_cohort(stranger, db, course.id, name="Section A")
    with pytest.raises(NotFoundError):
        await cohorts_repo.list_cohorts(stranger, db, course.id)
    with pytest.raises(NotFoundError):
        await cohorts_repo.set_membership(stranger, db, course.id, stranger.user_id, cohort_id=None)


# ------------------------------------------------------------------- membership rules


async def test_a_member_is_in_at_most_one_cohort_at_a_time(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    section_b = await cohorts_repo.create_cohort(creator, db, course.id, name="Section B")

    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)
    listed = await cohorts_repo.list_cohorts(creator, db, course.id)
    by_name = {c.name: [m.user_id for m in c.members] for c in listed.items}
    assert by_name == {"Section A": [ana.user_id], "Section B": []}

    # Moving her: the upsert must remove her from A, not merely add her to B.
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_b.id)
    listed = await cohorts_repo.list_cohorts(creator, db, course.id)
    by_name = {c.name: [m.user_id for m in c.members] for c in listed.items}
    assert by_name == {"Section A": [], "Section B": [ana.user_id]}

    # Clearing her: `cohort_id=None` removes her from every cohort of this course.
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=None)
    listed = await cohorts_repo.list_cohorts(creator, db, course.id)
    assert all(c.members == [] for c in listed.items)


async def test_assigning_a_non_member_is_refused(db):
    creator = await _owner_scope(db, "teacher")
    course, _modules, _version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    outsider, _own_ws = await _person(db, "outsider")

    with pytest.raises(cohorts_repo.CourseMemberNotFound):
        await cohorts_repo.set_membership(
            creator, db, course.id, outsider.id, cohort_id=section_a.id
        )


async def test_assigning_to_a_cohort_from_another_course_is_refused(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course_a, _modules_a, _version_a = await _course(db, creator)
    course_b, _modules_b, _version_b = await _course(db, creator)
    foreign_cohort = await cohorts_repo.create_cohort(creator, db, course_b.id, name="Section A")

    with pytest.raises(NotFoundError):
        await cohorts_repo.set_membership(
            creator, db, course_a.id, ana.user_id, cohort_id=foreign_cohort.id
        )


async def test_deleting_a_cohort_leaves_its_former_members_with_none(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)

    await cohorts_repo.delete_cohort(creator, db, course.id, section_a.id)

    own_view = await cohorts_repo.list_cohorts(ana, db, course.id)
    assert own_view.items == []


# --------------------------------------------------------------------------- visibility


async def test_the_creator_sees_every_cohort_with_its_full_roster(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, _version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)
    await cohorts_repo.set_membership(creator, db, course.id, bo.user_id, cohort_id=section_a.id)

    listed = await cohorts_repo.list_cohorts(creator, db, course.id)
    assert listed.visibility is CohortVisibility.ALL_COHORTS
    [cohort] = listed.items
    assert cohort.member_count == 2
    assert {m.user_id for m in cohort.members} == {ana.user_id, bo.user_id}


async def test_a_non_creator_sees_only_their_own_cohort_name_and_no_roster(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, _version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    await cohorts_repo.create_cohort(creator, db, course.id, name="Section B")
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)
    await cohorts_repo.set_membership(creator, db, course.id, bo.user_id, cohort_id=section_a.id)

    ana_view = await cohorts_repo.list_cohorts(ana, db, course.id)
    assert ana_view.visibility is CohortVisibility.OWN_COHORT
    [cohort] = ana_view.items
    # Her own cohort's NAME, and nothing about who else is in it — not even Bo,
    # who really is in the same section (the control below proves that).
    assert (cohort.name, cohort.members, cohort.member_count) == ("Section A", [], 0)

    everyone = await cohorts_repo.list_cohorts(creator, db, course.id)
    section_a_roster = {
        m.user_id for c in everyone.items if c.name == "Section A" for m in c.members
    }
    assert section_a_roster == {ana.user_id, bo.user_id}


async def test_a_member_in_no_cohort_sees_an_empty_list(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _course(db, creator)
    await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")

    ana_view = await cohorts_repo.list_cohorts(ana, db, course.id)
    assert ana_view.visibility is CohortVisibility.OWN_COHORT
    assert ana_view.items == []


# --------------------------------------------------------------------- gradebook filter


async def test_the_gradebook_can_be_filtered_to_one_cohort(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    section_b = await cohorts_repo.create_cohort(creator, db, course.id, name="Section B")
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)
    await cohorts_repo.set_membership(creator, db, course.id, bo.user_id, cohort_id=section_b.id)
    await _grade(db, ana, version.id, passed=1, at=T0)
    await _grade(db, bo, version.id, passed=1, at=T0)

    filtered = await courses_repo.course_gradebook(creator, db, course.id, cohort_id=section_a.id)
    assert filtered.cohort_id == section_a.id
    assert {row.user_id for row in filtered.rows} == {ana.user_id}
    assert filtered.rows[0].cohort_name == "Section A"

    unfiltered = await courses_repo.course_gradebook(creator, db, course.id)
    assert unfiltered.cohort_id is None
    names = {row.user_id: row.cohort_name for row in unfiltered.rows}
    assert names[ana.user_id] == "Section A"
    assert names[bo.user_id] == "Section B"
    assert names[creator.user_id] is None


async def test_filtering_by_a_cohort_from_another_course_is_refused(db):
    creator = await _owner_scope(db, "teacher")
    course_a, _modules_a, _version_a = await _course(db, creator)
    course_b, _modules_b, _version_b = await _course(db, creator)
    foreign_cohort = await cohorts_repo.create_cohort(creator, db, course_b.id, name="Section A")

    with pytest.raises(NotFoundError):
        await courses_repo.course_gradebook(creator, db, course_a.id, cohort_id=foreign_cohort.id)


async def test_a_member_filtering_by_a_cohort_that_is_not_their_own_gets_no_rows(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    section_b = await cohorts_repo.create_cohort(creator, db, course.id, name="Section B")
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)
    await cohorts_repo.set_membership(creator, db, course.id, bo.user_id, cohort_id=section_b.id)
    await _grade(db, ana, version.id, passed=1, at=T0)

    # Ana asking for Section B (not hers) sees no rows at all — not Bo's, not her own.
    filtered = await courses_repo.course_gradebook(ana, db, course.id, cohort_id=section_b.id)
    assert filtered.rows == []
    # The control: Ana filtered to her OWN section still sees her own row.
    own = await courses_repo.course_gradebook(ana, db, course.id, cohort_id=section_a.id)
    assert [row.user_id for row in own.rows] == [ana.user_id]


# -------------------------------------------------------------------------------- HTTP


async def test_over_http_a_stranger_gets_404_and_a_member_sees_only_their_own_cohort(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _course(db, creator)
    section_a = await cohorts_repo.create_cohort(creator, db, course.id, name="Section A")
    await cohorts_repo.set_membership(creator, db, course.id, ana.user_id, cohort_id=section_a.id)
    stranger = await _owner_scope(db, "stranger")

    async with _client(db, stranger) as c:
        response = await c.get(f"/v1/courses/{course.id}/cohorts")
    assert response.status_code == 404, response.text

    async with _client(db, ana) as c:
        response = await c.get(f"/v1/courses/{course.id}/cohorts")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["visibility"] == "own_cohort"
    assert [item["name"] for item in body["items"]] == ["Section A"]
    assert body["items"][0]["members"] == []

    async with _client(db, ana) as c:
        refused = await c.post(f"/v1/courses/{course.id}/cohorts", json={"name": "Section C"})
    assert refused.status_code == 403, refused.text
    assert refused.json()["reason"] == "course_cohort_creator_only"


async def test_over_http_the_creator_manages_cohorts_and_filters_the_gradebook(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _course(db, creator)
    await _grade(db, ana, version.id, passed=1, at=T0)
    await _grade(db, bo, version.id, passed=1, at=T0)

    async with _client(db, creator) as c:
        created = await c.post(f"/v1/courses/{course.id}/cohorts", json={"name": "Section A"})
        assert created.status_code == 201, created.text
        cohort_id = created.json()["id"]
        assigned = await c.put(
            f"/v1/courses/{course.id}/members/{ana.user_id}/cohort",
            json={"cohort_id": cohort_id},
        )
        assert assigned.status_code == 204, assigned.text

        filtered = await c.get(f"/v1/courses/{course.id}/gradebook?cohort_id={cohort_id}")
        csv_filtered = await c.get(f"/v1/courses/{course.id}/gradebook.csv?cohort_id={cohort_id}")
        full = (await c.get(f"/v1/courses/{course.id}/gradebook")).json()

    assert filtered.status_code == 200, filtered.text
    body = filtered.json()
    assert [row["user_id"] for row in body["rows"]] == [str(ana.user_id)]
    assert body["cohort_id"] == cohort_id

    bo_email = next(row["email"] for row in full["rows"] if row["user_id"] == str(bo.user_id))
    csv_text = csv_filtered.content.decode("utf-8").lstrip("﻿")
    assert "Section A" in csv_text
    # Bo was never in this cohort — the filtered CSV must not carry his row.
    assert bo_email not in csv_text

    # The duplicate-name conflict last: the failed INSERT it triggers poisons
    # this session's ongoing (uncommitted) transaction — see
    # `test_a_duplicate_cohort_name_is_refused` for the same fact against the
    # repo directly — so nothing in THIS test may rely on the session again
    # afterward.
    async with _client(db, creator) as c:
        duplicate = await c.post(f"/v1/courses/{course.id}/cohorts", json={"name": "Section A"})
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["reason"] == "course_cohort_duplicate_name"
    await db.rollback()
