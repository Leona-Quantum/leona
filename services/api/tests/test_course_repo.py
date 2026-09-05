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
