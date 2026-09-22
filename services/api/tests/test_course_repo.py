"""repos/courses.py: scoping, the plan-replacement rules that protect generated
work, and the two things the module derives rather than stores.

DB-free, like `test_notebook_repo.py` — `RecordingSession`/`SequencedSession`
record every statement so the workspace predicate can be asserted without a
database. `test_course_routes.py` exercises the routes over ASGI.
"""

import datetime as dt
import uuid

import majorana_contracts as contracts
import pytest
from majorana_contracts.courses import CoursePlan, PlannedModule
from majorana_contracts.enums import Role
from repo_test_helpers import RecordingSession, SequencedSession, compiled, make_scope

from majorana_api.orm import Course as CourseRow
from majorana_api.orm import CourseModule as CourseModuleRow
from majorana_api.orm import CourseTurn as CourseTurnRow
from majorana_api.orm import NotebookVersion as NotebookVersionRow
from majorana_api.repos import courses as courses_repo
from majorana_api.repos._base import AuthzError, NotFoundError

NOW = dt.datetime(2026, 9, 3, tzinfo=dt.timezone.utc)


_MISSING = object()


class _Res:
    """One queued result for `SequencedSession`.

    `repo_test_helpers.Rows` answers `.scalars().all()` but not
    `scalar_one_or_none()`, which `get_course`/`get_module` call — so the two
    read shapes this module uses need one double that answers both rather than a
    guess about which the next function will pick.
    """

    def __init__(self, rows=(), *, scalar=_MISSING):
        self._rows = list(rows)
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        if self._scalar is not _MISSING:
            return self._scalar
        return self._rows[0] if self._rows else None

    def scalar_one(self):
        return self.scalar_one_or_none()


def _course_row(**overrides) -> CourseRow:
    base = dict(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        slug="qiskit-study-group-ab12cd34",
        title="Qiskit study group",
        summary="",
        brief="Teach me Qiskit in eight weeks",
        audience={},
        style={},
        framework={"name": "qiskit", "version": ">=2.5,<2.6", "execution": "local-statevector"},
        language="en",
        status="planned",
        plan_run_id=None,
        plan=None,
        deleted_at=None,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return CourseRow(**base)


def _module_row(**overrides) -> CourseModuleRow:
    base = dict(
        id=uuid.uuid4(),
        course_id=uuid.uuid4(),
        seq=1,
        slug="week-01",
        title="Week 1",
        topic="Qubits",
        key_concepts=["superposition"],
        objectives=["Build a circuit"],
        deliverable="A working notebook",
        kind="lesson",
        duration_minutes=45,
        prerequisites=[],
        brief="Teach week 1.",
        notebook_id=None,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return CourseModuleRow(**base)


def _version_row(**overrides) -> NotebookVersionRow:
    base = dict(
        id=uuid.uuid4(),
        notebook_id=uuid.uuid4(),
        seq=1,
        status="ready",
        created_by="nala",
        message="",
        request={},
        spec=None,
        source=None,
        ipynb=None,
        report=None,
        review=None,
        error="",
        run_id=None,
        created_at=NOW,
        finished_at=None,
    )
    base.update(overrides)
    return NotebookVersionRow(**base)


def _planned(slug: str, **overrides) -> PlannedModule:
    base = dict(
        slug=slug,
        title=slug.replace("-", " ").title(),
        objectives=[f"Do {slug}"],
        brief=f"Teach {slug}.",
    )
    base.update(overrides)
    return PlannedModule(**base)


# --------------------------------------------------------------------- create / scope


async def test_create_course_stamps_the_scope_and_starts_in_planning():
    session = RecordingSession()
    scope = make_scope()
    run_id = uuid.uuid4()

    course = await courses_repo.create_course(
        scope,
        session,
        slug="qiskit-study-group-ab12cd34",
        title="Qiskit study group",
        brief="Teach me Qiskit in eight weeks",
        audience={},
        style={},
        framework={"name": "qiskit"},
        language="en",
        plan_run_id=run_id,
    )

    assert course.workspace_id == scope.workspace_id
    assert course.owner_user_id == scope.user_id
    assert course.status == contracts.CourseStatus.PLANNING.value
    assert course.plan_run_id == run_id
    assert course.plan is None
    assert any(isinstance(added, CourseRow) for added in session.added)


async def test_create_course_refuses_a_read_only_role():
    with pytest.raises(AuthzError):
        await courses_repo.create_course(
            make_scope(Role.VIEWER),
            RecordingSession(),
            slug="s",
            title="t",
            brief="b",
            audience={},
            style={},
            framework={},
            language="en",
            plan_run_id=None,
        )


async def test_get_course_filters_on_the_workspace_and_the_soft_delete():
    session = RecordingSession()
    scope = make_scope()
    with pytest.raises(NotFoundError):
        await courses_repo.get_course(scope, session, uuid.uuid4())
    sql, params = compiled(session.statements[0])
    assert "courses.workspace_id = " in sql
    assert "courses.deleted_at IS NULL" in sql
    assert scope.workspace_id in params.values()


async def test_list_courses_applies_the_cursor_and_the_workspace_predicate():
    session = RecordingSession()
    scope = make_scope()
    cursor = uuid.uuid4()
    await courses_repo.list_courses(scope, session, cursor=cursor, limit=10)
    sql, params = compiled(session.statements[0])
    assert "courses.workspace_id = " in sql
    assert "courses.id < " in sql
    assert cursor in params.values()


async def test_list_modules_resolves_the_tenant_through_the_course():
    """A module read must not be reachable without the course's workspace check —
    that is the whole of `course_modules`' tenancy (migration 0059's policy says
    the same thing in SQL)."""
    course = _course_row()
    session = SequencedSession([_Res([course]), _Res([])])
    scope = make_scope()
    await courses_repo.list_modules(scope, session, course.id)
    course_sql, _ = compiled(session.statements[0])
    module_sql, params = compiled(session.statements[1])
    assert "courses.workspace_id = " in course_sql
    assert "course_modules.course_id = " in module_sql
    assert course.id in params.values()


# ------------------------------------------------------------------- replace_modules


async def test_replace_modules_keeps_a_generated_module_untouched_and_renumbers():
    """The rule that protects generated work: a surviving slug that already has a
    notebook keeps its content AND its notebook; only its position moves."""
    course = _course_row()
    notebook_id = uuid.uuid4()
    kept = _module_row(
        course_id=course.id,
        seq=1,
        slug="week-01",
        title="Original title",
        brief="Original brief.",
        notebook_id=notebook_id,
    )
    dropped = _module_row(course_id=course.id, seq=2, slug="week-99")
    # get_course (replace_modules), get_course (list_modules), the module list,
    # then the DELETE of the slug the new plan no longer names.
    session = SequencedSession([_Res([course]), _Res([course]), _Res([kept, dropped]), _Res([])])
    scope = make_scope()

    plan = CoursePlan(
        title="Rewritten course",
        summary="New summary",
        modules=[
            _planned("week-02"),
            _planned("week-01", title="Renamed", brief="Rewritten brief."),
        ],
    )
    ordered = await courses_repo.replace_modules(scope, session, course.id, plan)

    assert [row.slug for row in ordered] == ["week-02", "week-01"]
    assert [row.seq for row in ordered] == [1, 2]
    # The generated module kept everything but its position.
    assert kept.title == "Original title"
    assert kept.brief == "Original brief."
    assert kept.notebook_id == notebook_id
    assert kept.seq == 2
    # The new module was inserted.
    assert any(isinstance(added, CourseModuleRow) for added in session.added)
    # The plan is stored verbatim and the course's title follows it.
    assert course.plan["title"] == "Rewritten course"
    assert course.title == "Rewritten course"
    assert course.summary == "New summary"


async def test_replace_modules_refreshes_a_surviving_module_that_has_no_notebook():
    course = _course_row()
    stale = _module_row(
        course_id=course.id, seq=1, slug="week-01", title="Old", brief="Old.", notebook_id=None
    )
    session = SequencedSession([_Res([course]), _Res([course]), _Res([stale])])
    plan = CoursePlan(title="C", modules=[_planned("week-01", title="Fresh", brief="Fresh brief.")])
    await courses_repo.replace_modules(make_scope(), session, course.id, plan)
    assert stale.title == "Fresh"
    assert stale.brief == "Fresh brief."


async def test_replace_modules_deletes_a_slug_the_plan_no_longer_names():
    course = _course_row()
    gone = _module_row(course_id=course.id, seq=1, slug="week-99")
    session = SequencedSession(
        [_Res([course]), _Res([course]), _Res([gone]), _Res([])]  # the 4th is the DELETE
    )
    plan = CoursePlan(title="C", modules=[_planned("week-01")])
    await courses_repo.replace_modules(make_scope(), session, course.id, plan)
    deletes = [
        compiled(stmt)[0] for stmt in session.statements if compiled(stmt)[0].startswith("DELETE")
    ]
    assert deletes, "expected the dropped module to be deleted"
    assert "course_modules" in deletes[0]


async def test_replace_modules_parks_seqs_before_reassigning_them():
    """`uq_course_modules_seq` is checked per statement, so a straight swap would
    collide. The two-pass park is what makes a reorder legal, and it is only
    observable as an intermediate flush."""
    course = _course_row()
    first = _module_row(course_id=course.id, seq=1, slug="week-01")
    second = _module_row(course_id=course.id, seq=2, slug="week-02")
    session = SequencedSession([_Res([course]), _Res([course]), _Res([first, second])])
    parked: list[int] = []

    original_flush = session.flush

    async def recording_flush():
        parked.extend([first.seq, second.seq])
        await original_flush()

    session.flush = recording_flush
    plan = CoursePlan(title="C", modules=[_planned("week-02"), _planned("week-01")])
    await courses_repo.replace_modules(make_scope(), session, course.id, plan)

    assert max(parked) > courses_repo._SEQ_PARK, (
        f"expected an intermediate seq above {courses_repo._SEQ_PARK}, saw {parked}"
    )
    assert (first.seq, second.seq) == (2, 1)


# ---------------------------------------------------------------------- update_course


async def test_update_course_refuses_to_patch_a_module_that_has_a_notebook():
    course = _course_row()
    generated = _module_row(course_id=course.id, notebook_id=uuid.uuid4())
    session = SequencedSession([_Res([course]), _Res([course]), _Res([generated])])
    patch = contracts.CourseModulePatch(id=generated.id, title="New title")
    with pytest.raises(courses_repo.ModuleAlreadyGenerated) as excinfo:
        await courses_repo.update_course(make_scope(), session, course.id, module_patches=[patch])
    assert excinfo.value.module_id == generated.id


async def test_update_course_patches_an_ungenerated_module_and_reorders():
    course = _course_row()
    a = _module_row(course_id=course.id, seq=1, slug="week-01")
    b = _module_row(course_id=course.id, seq=2, slug="week-02")
    c = _module_row(course_id=course.id, seq=3, slug="week-03")
    session = SequencedSession([_Res([course]), _Res([course]), _Res([a, b, c])])
    patches = [
        contracts.CourseModulePatch(id=c.id, title="Moved", brief="New brief.", seq=1),
    ]
    await courses_repo.update_course(
        make_scope(), session, course.id, title="Renamed", module_patches=patches
    )
    assert course.title == "Renamed"
    assert c.title == "Moved" and c.brief == "New brief."
    assert (c.seq, a.seq, b.seq) == (1, 2, 3)


async def test_update_course_on_an_unknown_module_is_not_found():
    course = _course_row()
    session = SequencedSession([_Res([course]), _Res([course]), _Res([])])
    patch = contracts.CourseModulePatch(id=uuid.uuid4(), title="x")
    with pytest.raises(NotFoundError):
        await courses_repo.update_course(make_scope(), session, course.id, module_patches=[patch])


# ------------------------------------------------------------------------- projections


def _resource_module(status: contracts.CourseModuleStatus) -> contracts.CourseModule:
    return contracts.CourseModule(
        id=uuid.uuid4(), seq=1, slug="week-01", title="Week 1", status=status
    )


def test_module_status_is_derived_from_the_notebooks_latest_version():
    notebook_id = uuid.uuid4()
    module = _module_row(notebook_id=notebook_id)
    for version_status, expected in [
        ("queued", contracts.CourseModuleStatus.QUEUED),
        ("running", contracts.CourseModuleStatus.RUNNING),
        ("ready", contracts.CourseModuleStatus.READY),
        ("failed", contracts.CourseModuleStatus.FAILED),
    ]:
        latest = _version_row(notebook_id=notebook_id, seq=3, status=version_status)
        resource = courses_repo.module_to_resource(module, latest)
        assert resource.status is expected
        assert resource.notebook_version_seq == 3
        assert resource.notebook_id == notebook_id


def test_a_module_whose_notebook_no_longer_resolves_reads_as_planned_with_no_notebook():
    """Soft-deleted notebook: the module must read as buildable again, and the two
    halves of the resource must agree — a `planned` module reporting a notebook id
    would be offered for generation while claiming to have one."""
    module = _module_row(notebook_id=uuid.uuid4())
    resource = courses_repo.module_to_resource(module, None)
    assert resource.status is contracts.CourseModuleStatus.PLANNED
    assert resource.notebook_id is None
    assert resource.notebook_version_seq is None


def test_course_status_is_ready_only_when_every_module_is():
    ready = _resource_module(contracts.CourseModuleStatus.READY)
    running = _resource_module(contracts.CourseModuleStatus.RUNNING)
    planned = _resource_module(contracts.CourseModuleStatus.PLANNED)
    failed = _resource_module(contracts.CourseModuleStatus.FAILED)

    assert courses_repo._derive_status("generating", [ready, ready]) is contracts.CourseStatus.READY
    assert (
        courses_repo._derive_status("generating", [ready, running])
        is contracts.CourseStatus.GENERATING
    )
    # A failed module is one notebook to retry, not a broken course.
    assert (
        courses_repo._derive_status("generating", [ready, failed])
        is contracts.CourseStatus.GENERATING
    )
    assert courses_repo._derive_status("planned", [planned]) is contracts.CourseStatus.PLANNED
    # A course with no modules never claims to be ready.
    assert courses_repo._derive_status("planned", []) is contracts.CourseStatus.PLANNED


def test_planning_and_failed_are_reported_as_stored():
    ready = _resource_module(contracts.CourseModuleStatus.READY)
    assert courses_repo._derive_status("planning", []) is contracts.CourseStatus.PLANNING
    assert courses_repo._derive_status("failed", [ready]) is contracts.CourseStatus.FAILED


async def test_course_to_resource_counts_ready_modules_and_carries_the_plan_fields():
    course = _course_row(status="generating")
    notebook_id = uuid.uuid4()
    modules = [
        _module_row(course_id=course.id, seq=1, slug="week-01", notebook_id=notebook_id),
        _module_row(course_id=course.id, seq=2, slug="week-02"),
    ]
    latest = _version_row(notebook_id=notebook_id, seq=2, status="ready")
    session = SequencedSession([_Res([latest])])

    resource = await courses_repo.course_to_resource(make_scope(), session, course, modules)

    assert resource.kind == "course"
    assert resource.module_count == 2
    assert resource.ready_count == 1
    assert resource.status is contracts.CourseStatus.GENERATING
    assert [m.slug for m in resource.modules] == ["week-01", "week-02"]
    assert resource.modules[0].status is contracts.CourseModuleStatus.READY
    assert resource.modules[1].status is contracts.CourseModuleStatus.PLANNED


async def test_latest_versions_scopes_through_notebooks_and_skips_soft_deleted():
    session = RecordingSession()
    scope = make_scope()
    await courses_repo._latest_versions(scope, session, [uuid.uuid4()])
    sql, params = compiled(session.statements[0])
    assert "notebooks.workspace_id = " in sql
    assert "notebooks.deleted_at IS NULL" in sql
    assert scope.workspace_id in params.values()


async def test_latest_versions_issues_no_query_for_a_course_with_no_notebooks():
    session = RecordingSession()
    assert await courses_repo._latest_versions(make_scope(), session, []) == {}
    assert session.statements == []


async def test_list_course_summaries_is_three_queries_not_one_per_course():
    """The N+1 `GET /v1/notebooks` is on record for. Two courses must still cost
    three statements: the courses, their modules, and the notebook versions."""
    first = _course_row(status="generating")
    second = _course_row(status="planned")
    notebook_id = uuid.uuid4()
    modules = [
        _module_row(course_id=first.id, seq=1, slug="week-01", notebook_id=notebook_id),
        _module_row(course_id=second.id, seq=1, slug="week-01"),
    ]
    session = SequencedSession(
        [_Res([first, second]), _Res(modules), _Res([_version_row(notebook_id=notebook_id)])]
    )
    summaries = await courses_repo.list_course_summaries(make_scope(), session)
    assert len(session.statements) == 3
    assert [s.id for s in summaries] == [first.id, second.id]
    assert summaries[0].module_count == 1 and summaries[0].ready_count == 1
    assert summaries[0].status is contracts.CourseStatus.READY
    assert summaries[1].ready_count == 0


async def test_list_course_summaries_short_circuits_on_an_empty_page():
    session = SequencedSession([_Res([])])
    assert await courses_repo.list_course_summaries(make_scope(), session) == []
    assert len(session.statements) == 1


# ------------------------------------------------------------------------------ turns


async def test_append_turn_numbers_from_the_highest_existing_seq():
    course = _course_row()
    session = SequencedSession([_Res([course]), _Res(scalar=4)])
    turn = await courses_repo.append_turn(
        make_scope(), session, course.id, role="user", content="add a module", run_id=None
    )
    assert turn.seq == 5
    assert turn.course_id == course.id
    assert any(isinstance(added, CourseTurnRow) for added in session.added)


async def test_append_turn_starts_at_one_when_there_are_no_turns():
    course = _course_row()
    session = SequencedSession([_Res([course]), _Res(scalar=None)])
    turn = await courses_repo.append_turn(
        make_scope(), session, course.id, role="user", content="hi", run_id=None
    )
    assert turn.seq == 1


# -------------------------------------------------------------------------- gradebook
#
# Who sees which rows is the ruling (ai-ops 260, option 1), so it is asserted on the SQL
# the repo emits: the route tests replace this function with a fake, and a fake cannot
# show which clauses the real query carries. `tests/authz/test_course_gradebook_live.py`
# proves the same rule against Postgres.

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


def _gradebook_session(course, modules, live, grade_rows):
    """Results in the order `course_gradebook` issues its statements: the course, the
    course again (inside `list_modules`), the modules, the live notebooks with their
    current specs, then the grades."""
    return SequencedSession(
        [
            _Res(scalar=course),
            _Res(scalar=course),
            _Res(modules),
            _Res(live),
            _Res(grade_rows),
        ]
    )


def _grade_row(
    user_id, notebook_id, *, email, name=None, passed=1, graded=2, current=True, graded_at=NOW
):
    version_id = uuid.uuid4()
    return (
        user_id,
        email,
        name,
        notebook_id,
        version_id,
        3,
        version_id if current else uuid.uuid4(),
        uuid.uuid4(),
        graded_at,
        passed,
        graded - passed,
        graded,
        graded,
    )


def _not_started(user_id, *, email, name=None):
    """The row the LEFT join returns for a member with no grading event: the member
    columns filled, every grade column NULL."""
    return (user_id, email, name, *([None] * 10))


async def test_the_course_creator_gradebook_query_has_no_user_clause():
    owner = make_scope(Role.MEMBER)
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    notebook_id = uuid.uuid4()
    module = _module_row(course_id=course.id, notebook_id=notebook_id)
    session = _gradebook_session(course, [module], [(notebook_id, GRADED_SPEC)], [])

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert book.visibility is contracts.GradebookVisibility.ALL_MEMBERS
    sql, params = compiled(session.statements[-1])
    assert "run_events.type = " in sql
    assert "runs.workspace_id = " in sql, "tenancy boundary missing"
    assert "notebooks.workspace_id = " in sql
    assert "notebooks.deleted_at IS NULL" in sql
    assert "DISTINCT ON (runs.user_id, notebook_versions.notebook_id)" in sql
    # Driven FROM current memberships and LEFT joined to the grades, so a member who
    # has not started is listed, and a person who left is not.
    assert (
        sql.split("LEFT OUTER JOIN")[0]
        .rstrip()
        .endswith("FROM memberships JOIN users ON users.id = memberships.user_id")
    ), "the statement must start from memberships, not from the grades"
    assert "memberships.workspace_id = " in sql
    # The creator's view is everyone's, so no clause pins it to one user.
    assert "runs.user_id = %(" not in sql
    assert "memberships.user_id = %(" not in sql
    assert owner.user_id not in params.values()


async def test_a_member_who_did_not_create_the_course_is_pinned_to_their_own_row():
    """The mutation this exists for: drop the user clause for non-creators and every
    classmate's row, marks included, lands on every member's screen. The outer
    `memberships.user_id` clause decides whose rows come back; the inner `runs.user_id`
    one only keeps the grouping from reading classmates' attempts."""
    member = make_scope(Role.ADMIN)
    course = _course_row(workspace_id=member.workspace_id)  # someone else created it
    notebook_id = uuid.uuid4()
    module = _module_row(course_id=course.id, notebook_id=notebook_id)
    session = _gradebook_session(course, [module], [(notebook_id, GRADED_SPEC)], [])

    book = await courses_repo.course_gradebook(member, session, course.id)

    assert book.visibility is contracts.GradebookVisibility.OWN_ROW
    sql, params = compiled(session.statements[-1])
    assert "memberships.user_id = %(" in sql, "a non-creator must only ever see their own row"
    assert "runs.user_id = %(" in sql
    assert member.user_id in params.values()


async def test_gradebook_rows_total_over_the_whole_course_not_only_attempted_modules():
    owner = make_scope()
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    first_nb, second_nb, third_nb = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    modules = [
        _module_row(course_id=course.id, seq=1, slug="week-01", notebook_id=first_nb),
        _module_row(course_id=course.id, seq=2, slug="week-02", notebook_id=second_nb),
        _module_row(course_id=course.id, seq=3, slug="week-03", notebook_id=third_nb),
    ]
    ana, bo = uuid.uuid4(), uuid.uuid4()
    grades = [
        _grade_row(bo, first_nb, email="bo@example.test", passed=2, graded=2),
        _grade_row(bo, second_nb, email="bo@example.test", passed=0, graded=2, current=False),
        _grade_row(ana, second_nb, email="ana@example.test", name="Ana", passed=1, graded=2),
    ]
    live = [(first_nb, GRADED_SPEC), (second_nb, GRADED_SPEC), (third_nb, GRADED_SPEC)]
    session = _gradebook_session(course, modules, live, grades)

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert [m.graded_cells for m in book.modules] == [2, 2, 2]
    assert [m.notebook_id for m in book.modules] == [first_nb, second_nb, third_nb]
    # Sorted by what the members page shows: the name, else the email.
    assert [row.email for row in book.rows] == ["ana@example.test", "bo@example.test"]
    ana_row, bo_row = book.rows
    # Ana did one module of three: out of six cells, not out of the two she reached.
    assert (ana_row.total_passed, ana_row.total_graded_cells) == (1, 6)
    assert [e.module_id for e in ana_row.entries] == [modules[1].id]
    assert (bo_row.total_passed, bo_row.total_graded_cells) == (2, 6)
    assert [e.module_id for e in bo_row.entries] == [modules[0].id, modules[1].id]
    assert [e.stale for e in bo_row.entries] == [False, True]


async def test_a_member_who_has_not_started_is_a_row_with_no_entries():
    """Not a zero score: no entries, `last_graded_at` None, and the whole course as
    the denominator still ahead of them."""
    owner = make_scope()
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    notebook_id = uuid.uuid4()
    module = _module_row(course_id=course.id, notebook_id=notebook_id)
    ana, cy = uuid.uuid4(), uuid.uuid4()
    grades = [
        _grade_row(ana, notebook_id, email="ana@example.test", passed=2, graded=2),
        _not_started(cy, email="cy@example.test"),
    ]
    session = _gradebook_session(course, [module], [(notebook_id, GRADED_SPEC)], grades)

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert [row.email for row in book.rows] == ["ana@example.test", "cy@example.test"]
    cy_row = book.rows[1]
    assert cy_row.entries == []
    assert cy_row.last_graded_at is None
    assert (cy_row.total_passed, cy_row.total_graded_cells) == (0, 2)


async def test_a_total_is_unknown_while_a_module_is_still_being_generated():
    """Greptile, PR 965. A module is attached to its notebook before that notebook has
    a ready version, so during ordinary generation its count is unknown. Counting it
    as 0 made every learner's total too small, which reads as a better score than they
    have; the total is `None` instead, for everyone who has that module still ahead."""
    owner = make_scope()
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    ready_nb, generating_nb = uuid.uuid4(), uuid.uuid4()
    modules = [
        _module_row(course_id=course.id, seq=1, slug="week-01", notebook_id=ready_nb),
        _module_row(course_id=course.id, seq=2, slug="week-02", notebook_id=generating_nb),
    ]
    ana, cy = uuid.uuid4(), uuid.uuid4()
    grades = [
        _grade_row(ana, ready_nb, email="ana@example.test", passed=1, graded=2),
        _not_started(cy, email="cy@example.test"),
    ]
    # The generating notebook resolves (it is live) but has no ready version: spec None.
    live = [(ready_nb, GRADED_SPEC), (generating_nb, None)]
    session = _gradebook_session(course, modules, live, grades)

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert [m.graded_cells for m in book.modules] == [2, None]
    assert book.modules[1].notebook_id == generating_nb, "attached, still generating"
    ana_row, cy_row = book.rows
    assert (ana_row.total_passed, ana_row.total_graded_cells) == (1, None)
    assert cy_row.total_graded_cells is None


async def test_a_module_the_member_was_graded_on_needs_no_current_count():
    """The attempt carries its own denominator, so a module whose CURRENT count is
    unknown does not make the total unknown for someone already graded on it. Only a
    module still ahead of the member does."""
    owner = make_scope()
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    notebook_id = uuid.uuid4()
    module = _module_row(course_id=course.id, notebook_id=notebook_id)
    ana, cy = uuid.uuid4(), uuid.uuid4()
    grades = [
        _grade_row(ana, notebook_id, email="ana@example.test", passed=1, graded=2),
        _not_started(cy, email="cy@example.test"),
    ]
    # A current spec that no longer validates: the count today is unknown.
    session = _gradebook_session(course, [module], [(notebook_id, {"cells": "nope"})], grades)

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert book.modules[0].graded_cells is None
    ana_row, cy_row = book.rows
    assert ana_row.total_graded_cells == 2, "counted at the version Ana was graded on"
    assert cy_row.total_graded_cells is None, "Cy still has it ahead, uncounted"


async def test_members_are_listed_even_when_no_module_has_a_live_notebook():
    """The grades half of the statement matches nothing, and the member list still
    comes back: the creator sees who is in the class before anything is gradable."""
    owner = make_scope()
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    deleted_nb = uuid.uuid4()
    module = _module_row(course_id=course.id, notebook_id=deleted_nb)
    # The live-notebook query returns nothing: the notebook was soft-deleted.
    session = _gradebook_session(
        course, [module], [], [_not_started(owner.user_id, email="me@example.test")]
    )

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert book.modules[0].notebook_id is None
    assert [(row.user_id, row.entries) for row in book.rows] == [(owner.user_id, [])]
    # A module with no notebook has no count, so the course total is not known.
    assert book.rows[0].total_graded_cells is None
    assert len(session.statements) == 5


async def test_gradebook_of_another_workspace_is_not_found():
    session = SequencedSession([_Res(scalar=None)])
    with pytest.raises(NotFoundError):
        await courses_repo.course_gradebook(make_scope(), session, uuid.uuid4())


# -------------------------------------------------------------------------- due dates
#
# A due date is the one module field that may change after the notebook exists, and
# the one only the course's creator may change. Both halves are asserted, and the
# refusal is asserted to happen before any row is touched.

DUE = dt.datetime(2026, 9, 30, 8, 0, tzinfo=dt.timezone.utc)
ONE_TICK = dt.timedelta(microseconds=1)


def _patch(**fields) -> contracts.CourseModulePatch:
    """Parsed from a dict, the way FastAPI parses a request body, so the set of keys
    the client SENT (`model_fields_set`) is what a real request would carry."""
    return contracts.CourseModulePatch.model_validate(fields)


async def test_the_creator_sets_a_due_date_on_a_module_that_already_has_a_notebook():
    creator = make_scope()
    course = _course_row(workspace_id=creator.workspace_id, owner_user_id=creator.user_id)
    generated = _module_row(course_id=course.id, notebook_id=uuid.uuid4())
    session = SequencedSession([_Res([course]), _Res([course]), _Res([generated])])
    tokyo = dt.timezone(dt.timedelta(hours=9))

    await courses_repo.update_course(
        creator,
        session,
        course.id,
        module_patches=[_patch(id=str(generated.id), due_at="2026-09-30T17:00:00+09:00")],
    )

    assert generated.due_at == dt.datetime(2026, 9, 30, 17, 0, tzinfo=tokyo)
    # Normalised to UTC, so the PATCH response reads like every later GET.
    assert generated.due_at.utcoffset() == dt.timedelta(0)
    assert generated.due_at == DUE


async def test_an_explicit_null_clears_the_due_date_and_an_absent_key_leaves_it():
    creator = make_scope()
    course = _course_row(workspace_id=creator.workspace_id, owner_user_id=creator.user_id)
    planned = _module_row(course_id=course.id, due_at=DUE)

    session = SequencedSession([_Res([course]), _Res([course]), _Res([planned])])
    await courses_repo.update_course(
        creator, session, course.id, module_patches=[_patch(id=str(planned.id), title="Renamed")]
    )
    assert planned.title == "Renamed"
    assert planned.due_at == DUE, "a patch that did not send due_at must not clear it"

    session = SequencedSession([_Res([course]), _Res([course]), _Res([planned])])
    await courses_repo.update_course(
        creator, session, course.id, module_patches=[_patch(id=str(planned.id), due_at=None)]
    )
    assert planned.due_at is None


@pytest.mark.parametrize("role", [Role.MEMBER, Role.ADMIN, Role.OWNER])
async def test_only_the_course_creator_may_set_or_clear_a_due_date(role):
    """Workspace role is not the test: an admin, or the workspace's owner, who did
    not write the course is a classmate, and a classmate who could move the
    deadline could make their own late attempt on time."""
    someone_else = make_scope(role)
    course = _course_row(workspace_id=someone_else.workspace_id, title="Kept")
    planned = _module_row(course_id=course.id, due_at=DUE)
    for due_at in ("2026-10-07T08:00:00Z", None):
        session = SequencedSession([_Res([course]), _Res([course]), _Res([planned])])
        with pytest.raises(courses_repo.DueDateCreatorOnly):
            await courses_repo.update_course(
                someone_else,
                session,
                course.id,
                title="Changed alongside",
                module_patches=[_patch(id=str(planned.id), due_at=due_at)],
            )
        # Refused before anything was touched: the module was never even listed,
        # and the title that rode along with the refused patch was not applied.
        assert len(session.statements) == 1
        assert planned.due_at == DUE
        assert course.title == "Kept"


async def test_the_creator_refusal_is_an_authz_error_so_the_app_answers_403():
    assert issubclass(courses_repo.DueDateCreatorOnly, AuthzError)


async def test_someone_else_may_still_edit_a_planned_module_without_touching_its_due_date():
    """The creator rule is about due dates only. Editing a planned module stays
    open to anyone who can write in the workspace, as it was before due dates."""
    someone_else = make_scope()
    course = _course_row(workspace_id=someone_else.workspace_id)
    planned = _module_row(course_id=course.id, due_at=DUE)
    session = SequencedSession([_Res([course]), _Res([course]), _Res([planned])])
    await courses_repo.update_course(
        someone_else, session, course.id, module_patches=[_patch(id=str(planned.id), title="New")]
    )
    assert planned.title == "New" and planned.due_at == DUE


@pytest.mark.parametrize(
    "fields",
    [
        {"due_at": "2026-10-07T08:00:00Z", "title": "Also retitled"},
        {"due_at": "2026-10-07T08:00:00Z", "seq": 2},
        {},
    ],
    ids=["due-date-and-title", "due-date-and-reorder", "nothing-but-the-id"],
)
async def test_a_generated_module_still_refuses_every_plan_edit(fields):
    """The due-date exemption is for a patch that carries a due date and nothing
    else. Anything more, and a bare id with nothing at all, is refused as before."""
    creator = make_scope()
    course = _course_row(workspace_id=creator.workspace_id, owner_user_id=creator.user_id)
    generated = _module_row(course_id=course.id, notebook_id=uuid.uuid4(), due_at=DUE)
    session = SequencedSession([_Res([course]), _Res([course]), _Res([generated])])
    with pytest.raises(courses_repo.ModuleAlreadyGenerated):
        await courses_repo.update_course(
            creator, session, course.id, module_patches=[_patch(id=str(generated.id), **fields)]
        )
    assert generated.due_at == DUE


def test_a_due_date_without_a_utc_offset_is_refused():
    """ "2026-09-30T17:00" is a different moment in every time zone; the server
    would have to guess which one the instructor meant."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _patch(id=str(uuid.uuid4()), due_at="2026-09-30T17:00:00")


def test_a_module_resource_carries_its_due_date_and_a_course_its_creator():
    module = _module_row(due_at=DUE)
    assert courses_repo.module_to_resource(module, None).due_at == DUE
    assert courses_repo.module_to_resource(_module_row(), None).due_at is None


async def test_course_to_resource_names_the_courses_creator():
    course = _course_row()
    session = SequencedSession([_Res([course]), _Res([])])
    resource = await courses_repo.course_to_resource(make_scope(), session, course)
    assert resource.owner_user_id == course.owner_user_id


# ------------------------------------------------------------- late and missing, boundary


def _due_course(owner, *, due_at=DUE, spec=GRADED_SPEC):
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    notebook_id = uuid.uuid4()
    module = _module_row(course_id=course.id, notebook_id=notebook_id, due_at=due_at)
    return course, module, notebook_id, [(notebook_id, spec)]


@pytest.mark.parametrize(
    ("graded_at", "late"),
    [(DUE - ONE_TICK, False), (DUE, False), (DUE + ONE_TICK, True)],
    ids=["before", "exactly-at", "one-microsecond-after"],
)
async def test_an_attempt_is_late_only_when_graded_strictly_after_the_due_date(graded_at, late):
    """The convention: "due at 17:00" includes 17:00. An attempt graded at the due
    instant itself is on time."""
    owner = make_scope()
    course, module, notebook_id, live = _due_course(owner)
    ana = uuid.uuid4()
    grades = [_grade_row(ana, notebook_id, email="ana@example.test", graded_at=graded_at)]
    session = _gradebook_session(course, [module], live, grades)

    book = await courses_repo.course_gradebook(owner, session, course.id, now=DUE + ONE_TICK)

    assert book.modules[0].due_at == DUE
    [entry] = book.rows[0].entries
    assert entry.late is late
    # Late or not, an attempt is never also missing.
    assert book.rows[0].missing_module_ids == []


@pytest.mark.parametrize(
    ("now", "missing"),
    [(DUE - ONE_TICK, False), (DUE, False), (DUE + ONE_TICK, True)],
    ids=["before", "exactly-at", "one-microsecond-after"],
)
async def test_a_member_with_no_attempt_is_missing_only_once_the_due_date_has_passed(now, missing):
    """The same boundary as `late`, from the other side: at the due instant an attempt
    would still be on time, so a member who has none is not missing yet."""
    owner = make_scope()
    course, module, notebook_id, live = _due_course(owner)
    cy = uuid.uuid4()
    session = _gradebook_session(course, [module], live, [_not_started(cy, email="cy@x.test")])

    book = await courses_repo.course_gradebook(owner, session, course.id, now=now)

    assert book.rows[0].missing_module_ids == ([module.id] if missing else [])


async def test_nothing_is_late_or_missing_on_a_module_with_no_due_date():
    owner = make_scope()
    course, module, notebook_id, live = _due_course(owner, due_at=None)
    ana, cy = uuid.uuid4(), uuid.uuid4()
    grades = [
        _grade_row(ana, notebook_id, email="ana@x.test", graded_at=NOW + dt.timedelta(days=400)),
        _not_started(cy, email="cy@x.test"),
    ]
    session = _gradebook_session(course, [module], live, grades)

    book = await courses_repo.course_gradebook(owner, session, course.id, now=NOW)

    assert book.modules[0].due_at is None
    assert book.rows[0].entries[0].late is False
    assert [row.missing_module_ids for row in book.rows] == [[], []]


@pytest.mark.parametrize(
    "spec",
    [None, {"cells": "nope"}, {**GRADED_SPEC, "cells": GRADED_SPEC["cells"][:1]}],
    ids=["no-ready-version", "spec-no-longer-validates", "no-graded-exercise"],
)
async def test_a_module_with_nothing_to_be_graded_on_is_never_missing(spec):
    """Past due and unattempted, but there is nothing a member COULD have attempted:
    flagging it would mark the whole class missing for work that is not there."""
    owner = make_scope()
    course, module, _notebook_id, live = _due_course(owner, spec=spec)
    session = _gradebook_session(
        course, [module], live, [_not_started(owner.user_id, email="me@x")]
    )

    book = await courses_repo.course_gradebook(owner, session, course.id, now=DUE + ONE_TICK)

    assert book.rows[0].missing_module_ids == []


async def test_missing_modules_are_listed_in_course_order_for_each_member_separately():
    owner = make_scope()
    course = _course_row(workspace_id=owner.workspace_id, owner_user_id=owner.user_id)
    nbs = [uuid.uuid4() for _ in range(3)]
    modules = [
        _module_row(
            course_id=course.id, seq=i + 1, slug=f"week-0{i + 1}", notebook_id=nb, due_at=DUE
        )
        for i, nb in enumerate(nbs)
    ]
    ana, cy = uuid.uuid4(), uuid.uuid4()
    grades = [
        _grade_row(ana, nbs[1], email="ana@x.test", graded_at=DUE + dt.timedelta(hours=1)),
        _not_started(cy, email="cy@x.test"),
    ]
    session = _gradebook_session(course, modules, [(nb, GRADED_SPEC) for nb in nbs], grades)

    book = await courses_repo.course_gradebook(owner, session, course.id, now=DUE + ONE_TICK)

    ana_row, cy_row = book.rows
    assert ana_row.missing_module_ids == [modules[0].id, modules[2].id]
    assert ana_row.entries[0].late is True
    assert cy_row.missing_module_ids == [m.id for m in modules]
    # Late and missing change nothing about the scores PR 965 reports.
    assert (ana_row.total_passed, ana_row.total_graded_cells) == (1, 6)


async def test_the_gradebook_reads_the_clock_when_no_moment_is_given(monkeypatch):
    owner = make_scope()
    course, module, _notebook_id, live = _due_course(owner)
    monkeypatch.setattr(courses_repo, "touched_now", lambda: DUE + ONE_TICK)
    session = _gradebook_session(
        course, [module], live, [_not_started(owner.user_id, email="me@x")]
    )

    book = await courses_repo.course_gradebook(owner, session, course.id)

    assert book.rows[0].missing_module_ids == [module.id]
