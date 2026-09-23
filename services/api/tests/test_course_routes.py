"""routes/courses.py over ASGI — the contract Lane B is built against.

Same shape as `test_notebook_routes.py`: the real app, identity/scope stubbed via
`dependency_overrides`, and the repository layer replaced with fakes via
`monkeypatch.setattr` on the module objects the route imported.

One deliberate difference. The generate path does NOT stub
`create_notebook_and_enqueue`; it fakes `notebooks_repo.create_notebook` and
`system_repo.enqueue_job` underneath it and asserts the real job payload. The whole
point of factoring that helper out was that a course's modules reach the worker
through the same producer `POST /v1/notebooks` uses, and a test that stubbed the
helper would pass whether or not that were still true.
"""

import datetime as dt
import io
import json
import uuid as uuid_module
import zipfile
from types import SimpleNamespace

import httpx
import pytest
from majorana_contracts.courses import CoursePlan, PlannedModule

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.jobs import (
    COURSE_PLAN_JOB_KIND,
    COURSE_REVISE_JOB_KIND,
    NOTEBOOK_GENERATE_JOB_KIND,
)
from majorana_api.orm import Course as CourseRow
from majorana_api.orm import CourseModule as CourseModuleRow
from majorana_api.orm import CourseTurn as CourseTurnRow
from majorana_api.orm import Notebook as NotebookRow
from majorana_api.orm import NotebookVersion as NotebookVersionRow
from majorana_api.orm import User, Workspace
from majorana_api.repos import courses as courses_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system as system_repo
from majorana_api.repos._base import NotFoundError
from majorana_api.routes import notebooks as notebooks_routes
from majorana_api.settings import Settings

NOW = dt.datetime(2026, 9, 3, tzinfo=dt.timezone.utc)

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

LESSON_SOURCE = """\
# ---
# title: Week 1
# kind: lesson
# summary: One qubit.
# objectives:
#   - Build a circuit
# ---

# %% [markdown] role=objective
# ## What you will build
# A circuit.

# %% role=run
from qiskit import QuantumCircuit
qc = QuantumCircuit(1)

# %% [markdown] role=summary
# Done.
"""


def _course_row(**overrides) -> CourseRow:
    base = dict(
        id=uuid_module.uuid4(),
        workspace_id=uuid_module.uuid4(),
        owner_user_id=uuid_module.uuid4(),
        slug="qiskit-study-group-ab12cd34",
        title="Qiskit study group",
        summary="Eight weeks.",
        brief="Teach me Qiskit in eight weeks",
        audience={"level": "engineer"},
        style={"analogies": True},
        framework={"name": "qiskit", "version": ">=2.5,<2.6", "execution": "local-statevector"},
        language="en",
        status="planned",
        plan_run_id=None,
        plan={"title": "Qiskit study group", "summary": "", "modules": []},
        deleted_at=None,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return CourseRow(**base)


def _module_row(**overrides) -> CourseModuleRow:
    base = dict(
        id=uuid_module.uuid4(),
        course_id=uuid_module.uuid4(),
        seq=1,
        slug="week-01",
        title="Qubits and circuits",
        topic="Qubits",
        key_concepts=["superposition"],
        objectives=["Build a circuit"],
        deliverable="A working notebook",
        kind="lesson",
        duration_minutes=45,
        prerequisites=[],
        brief="Teach the first week.",
        notebook_id=None,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return CourseModuleRow(**base)


def _version_row(**overrides) -> NotebookVersionRow:
    base = dict(
        id=uuid_module.uuid4(),
        notebook_id=uuid_module.uuid4(),
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


@pytest.fixture
def scope_identity():
    scope = SimpleNamespace(
        user_id=uuid_module.uuid4(), workspace_id=uuid_module.uuid4(), role="owner"
    )
    user = User(id=scope.user_id, email="reader@majorana.test")
    workspace = Workspace(id=scope.workspace_id)
    return scope, (user, workspace)


@pytest.fixture
def client(scope_identity, monkeypatch):
    scope, identity = scope_identity
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: identity
    app.dependency_overrides[auth_deps.get_session] = lambda: object()

    async def no_backstop(*_args, **_kwargs):
        return None

    # `routes.courses` reaches the gate through `routes.notebooks._gate_notebook_run`,
    # which reads this module-global — so patching it here covers both surfaces, and
    # `test_every_run_creating_course_route_is_gated` proves the gate is actually on
    # the path rather than merely patched.
    monkeypatch.setattr(notebooks_routes, "_enforce_execute_backstop", no_backstop)

    async def no_versions(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(courses_repo, "_latest_versions", no_versions)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def run_plumbing(monkeypatch):
    """Fakes for the run + job machinery, recording what the routes dispatched."""
    created_runs: list[dict] = []
    jobs: list[dict] = []

    async def fake_create_run(_scope, _session, **kwargs):
        run = SimpleNamespace(id=uuid_module.uuid4(), **kwargs)
        created_runs.append({"id": run.id, **kwargs})
        return run

    async def fake_append_run_event(*_args, **_kwargs):
        return None

    async def fake_enqueue_job(_session, *, kind, payload, run_id=None, **_kwargs):
        jobs.append({"kind": kind, "payload": payload, "run_id": run_id})
        return SimpleNamespace(id=uuid_module.uuid4())

    monkeypatch.setattr(runs_repo, "create_run", fake_create_run)
    monkeypatch.setattr(runs_repo, "append_run_event", fake_append_run_event)
    monkeypatch.setattr(system_repo, "enqueue_job", fake_enqueue_job)
    return SimpleNamespace(runs=created_runs, jobs=jobs)


# --------------------------------------------------------------------------- create


async def test_create_course_enqueues_a_plan_job_and_returns_a_planning_course(
    client, scope_identity, run_plumbing, monkeypatch
):
    scope, _identity = scope_identity
    course = _course_row(status="planning", workspace_id=scope.workspace_id)
    captured: dict = {}

    async def fake_create_course(_scope, _session, **kwargs):
        captured.update(kwargs)
        course.plan_run_id = kwargs["plan_run_id"]
        return course

    monkeypatch.setattr(courses_repo, "create_course", fake_create_course)

    async with client as c:
        response = await c.post(
            "/v1/courses",
            json={
                "brief": "Teach me Qiskit in eight weeks",
                "module_count": 8,
                "response_locale": "en",
            },
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["course"]["status"] == "planning"
    assert body["course"]["kind"] == "course"
    assert body["course"]["modules"] == []
    assert body["course"]["module_count"] == 0

    assert len(run_plumbing.runs) == 1
    run = run_plumbing.runs[0]
    assert run["mode"] == "notebook", "a course must not invent a run mode"
    assert run["task_prompt"] == "Teach me Qiskit in eight weeks"
    assert body["run_id"] == str(run["id"])

    assert len(run_plumbing.jobs) == 1
    job = run_plumbing.jobs[0]
    assert job["kind"] == COURSE_PLAN_JOB_KIND
    assert job["run_id"] == run["id"]
    payload = job["payload"]
    assert payload["kind"] == "plan"
    assert payload["course_id"] == str(course.id)
    assert payload["user_id"] == str(scope.user_id)
    assert payload["workspace_id"] == str(scope.workspace_id)
    assert payload["request"]["module_count"] == 8
    assert set(payload) == {
        "run_id",
        "course_id",
        "user_id",
        "workspace_id",
        "kind",
        "request",
        "response_locale",
    }
    assert captured["brief"] == "Teach me Qiskit in eight weeks"
    assert captured["language"] == "en"


async def test_create_course_refuses_a_nul_byte(client, run_plumbing):
    async with client as c:
        response = await c.post("/v1/courses", json={"brief": "a\x00b"})
    assert response.status_code == 422


async def test_create_course_refuses_a_module_count_of_one(client, run_plumbing):
    async with client as c:
        response = await c.post("/v1/courses", json={"brief": "b", "module_count": 1})
    assert response.status_code == 422


# ------------------------------------------------------------------------- read/edit


async def test_get_course_outside_the_workspace_is_404(client, monkeypatch):
    async def fake_get_course(_scope, _session, _course_id):
        raise NotFoundError("course")

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    async with client as c:
        response = await c.get(f"/v1/courses/{uuid_module.uuid4()}")
    assert response.status_code == 404


async def test_list_courses_pages_with_a_string_cursor(client, monkeypatch):
    import majorana_contracts as contracts

    rows = [
        contracts.CourseSummary(
            id=uuid_module.uuid4(),
            slug=f"course-{i}",
            title=f"Course {i}",
            status=contracts.CourseStatus.PLANNED,
            module_count=2,
            ready_count=0,
            created_at=NOW,
            updated_at=NOW,
        )
        for i in range(2)
    ]

    async def fake_summaries(_scope, _session, *, cursor=None, limit=50):
        return rows

    monkeypatch.setattr(courses_repo, "list_course_summaries", fake_summaries)
    async with client as c:
        response = await c.get("/v1/courses?limit=2")
    assert response.status_code == 200
    body = response.json()
    assert [item["slug"] for item in body["items"]] == ["course-0", "course-1"]
    # A full page hands back a cursor, and CourseList types it as a string.
    assert body["next_cursor"] == str(rows[-1].id)


async def test_patch_a_generated_module_is_409(client, monkeypatch):
    course = _course_row()
    module_id = uuid_module.uuid4()

    async def fake_update_course(_scope, _session, _course_id, **_kwargs):
        raise courses_repo.ModuleAlreadyGenerated(module_id)

    monkeypatch.setattr(courses_repo, "update_course", fake_update_course)
    async with client as c:
        response = await c.patch(
            f"/v1/courses/{course.id}",
            json={"modules": [{"id": str(module_id), "title": "New"}]},
        )
    assert response.status_code == 409
    assert response.json()["reason"] == "course_module_already_generated"
    assert response.json()["module_id"] == str(module_id)


async def test_delete_course_is_a_soft_delete(client, monkeypatch):
    deleted: list = []

    async def fake_soft_delete(_scope, _session, course_id):
        deleted.append(course_id)

    monkeypatch.setattr(courses_repo, "soft_delete_course", fake_soft_delete)
    course_id = uuid_module.uuid4()
    async with client as c:
        response = await c.delete(f"/v1/courses/{course_id}")
    assert response.status_code == 204
    assert deleted == [course_id]


# -------------------------------------------------------------------------- generate


def _two_module_course(monkeypatch, **course_overrides):
    course = _course_row(**course_overrides)
    modules = [
        _module_row(course_id=course.id, seq=1, slug="week-01", title="Qubits and circuits"),
        _module_row(
            course_id=course.id,
            seq=2,
            slug="week-02",
            title="Entanglement",
            topic="Bell states",
            brief="Teach the second week.",
            prerequisites=["week-01"],
        ),
    ]

    async def fake_get_course(_scope, _session, _course_id):
        return course

    async def fake_list_modules(_scope, _session, _course_id):
        return modules

    async def fake_attach(_scope, _session, _course_id, module_id, notebook_id):
        for module in modules:
            if module.id == module_id:
                module.notebook_id = notebook_id
        return module

    async def fake_set_status(_scope, _session, _course_id, status):
        course.status = status
        return course

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    monkeypatch.setattr(courses_repo, "list_modules", fake_list_modules)
    monkeypatch.setattr(courses_repo, "attach_module_notebook", fake_attach)
    monkeypatch.setattr(courses_repo, "set_course_status", fake_set_status)
    return course, modules


async def test_generate_dispatches_one_notebook_run_per_module_with_a_course_preface(
    client, run_plumbing, monkeypatch
):
    course, modules = _two_module_course(monkeypatch)
    created: list = []

    async def fake_create_notebook(_scope, _session, **kwargs):
        notebook = NotebookRow(
            id=uuid_module.uuid4(),
            workspace_id=course.workspace_id,
            owner_user_id=course.owner_user_id,
            slug=kwargs["slug"],
            title=kwargs["title"],
            kind=kwargs["kind"],
            summary="",
            visibility="private",
            language=kwargs["language"],
            framework=kwargs["framework"],
            current_version_id=None,
            deleted_at=None,
            created_at=NOW,
            updated_at=NOW,
        )
        created.append(kwargs)
        return notebook, _version_row(status="queued", notebook_id=notebook.id)

    monkeypatch.setattr(notebooks_repo, "create_notebook", fake_create_notebook)

    async with client as c:
        response = await c.post(f"/v1/courses/{course.id}/generate", json={})

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["run_ids"]) == 2
    assert len(run_plumbing.runs) == 2
    assert all(run["mode"] == "notebook" for run in run_plumbing.runs)

    # Two notebook.generate jobs, produced by the SHARED helper — same payload keys
    # as POST /v1/notebooks.
    jobs = [job for job in run_plumbing.jobs if job["kind"] == NOTEBOOK_GENERATE_JOB_KIND]
    assert len(jobs) == 2
    assert set(jobs[0]["payload"]) == {
        "run_id",
        "notebook_id",
        "version_id",
        "user_id",
        "workspace_id",
        "kind",
        "request",
        "response_locale",
    }

    first, second = (job["payload"]["request"] for job in jobs)
    assert first["brief"].startswith(
        'This is module 1 of 2 in the course "Qiskit study group". It is the FIRST module'
    )
    assert first["brief"].endswith("Teach the first week.")
    assert "Earlier modules already covered" not in first["brief"]

    assert second["brief"].startswith('This is module 2 of 2 in the course "Qiskit study group".')
    assert "Earlier modules already covered: Qubits and circuits (Qubits)" in second["brief"]
    assert second["brief"].endswith("Teach the second week.")

    # The course's own preferences and the curriculum seed ride on every module.
    for request in (first, second):
        assert request["audience"]["level"] == "engineer"
        assert request["framework"]["name"] == "qiskit"
        assert request["response_locale"] == "en"
        assert request["seeds"] == [
            {
                "kind": "curriculum",
                "ref": f"{course.slug}/{'week-01' if request is first else 'week-02'}",
                "note": "Qiskit study group",
                # `content` arrived with the circuit seed (lane D); a curriculum seed
                # carries none, and the dump still spells the default out.
                "content": "",
            }
        ]
    assert [kwargs["kind"] for kwargs in created] == ["lesson", "lesson"]

    # Both modules were attached, and the course moved to generating.
    assert all(module.notebook_id is not None for module in modules)
    assert course.status == "generating"
    assert body["course"]["status"] == "generating"


async def test_generate_skips_a_module_that_already_has_a_notebook(
    client, run_plumbing, monkeypatch
):
    course, modules = _two_module_course(monkeypatch)
    notebook_id = uuid_module.uuid4()
    modules[0].notebook_id = notebook_id

    async def latest(_scope, _session, notebook_ids):
        return {notebook_id: _version_row(notebook_id=notebook_id, seq=1, status="ready")}

    monkeypatch.setattr(courses_repo, "_latest_versions", latest)

    async def fake_create_notebook(_scope, _session, **kwargs):
        notebook = NotebookRow(
            id=uuid_module.uuid4(),
            workspace_id=course.workspace_id,
            owner_user_id=course.owner_user_id,
            slug=kwargs["slug"],
            title=kwargs["title"],
            kind=kwargs["kind"],
            summary="",
            visibility="private",
            language=kwargs["language"],
            framework=kwargs["framework"],
            current_version_id=None,
            deleted_at=None,
            created_at=NOW,
            updated_at=NOW,
        )
        return notebook, _version_row(status="queued", notebook_id=notebook.id)

    monkeypatch.setattr(notebooks_repo, "create_notebook", fake_create_notebook)

    async with client as c:
        response = await c.post(f"/v1/courses/{course.id}/generate", json={})

    assert response.status_code == 200, response.text
    assert len(response.json()["run_ids"]) == 1, "the ready module must not be regenerated"


async def test_generate_named_module_that_already_has_a_notebook_is_409(
    client, run_plumbing, monkeypatch
):
    course, modules = _two_module_course(monkeypatch)
    notebook_id = uuid_module.uuid4()
    modules[0].notebook_id = notebook_id

    async def latest(_scope, _session, notebook_ids):
        return {notebook_id: _version_row(notebook_id=notebook_id, status="running")}

    monkeypatch.setattr(courses_repo, "_latest_versions", latest)
    async with client as c:
        response = await c.post(
            f"/v1/courses/{course.id}/generate", json={"module_ids": [str(modules[0].id)]}
        )
    assert response.status_code == 409
    assert response.json()["reason"] == "course_module_already_generated"


async def test_generate_an_unknown_module_id_is_404(client, run_plumbing, monkeypatch):
    course, _modules = _two_module_course(monkeypatch)
    async with client as c:
        response = await c.post(
            f"/v1/courses/{course.id}/generate", json={"module_ids": [str(uuid_module.uuid4())]}
        )
    assert response.status_code == 404
    assert response.json()["reason"] == "course_module_not_found"


async def test_generate_before_the_plan_exists_is_409(client, run_plumbing, monkeypatch):
    course = _course_row(status="planning")

    async def fake_get_course(_scope, _session, _course_id):
        return course

    async def fake_list_modules(_scope, _session, _course_id):
        return []

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    monkeypatch.setattr(courses_repo, "list_modules", fake_list_modules)
    async with client as c:
        response = await c.post(f"/v1/courses/{course.id}/generate", json={})
    assert response.status_code == 409
    assert response.json()["reason"] == "course_not_planned"


# ---------------------------------------------------------------------------- export


async def test_export_is_409_until_every_module_is_ready(client, monkeypatch):
    course, modules = _two_module_course(monkeypatch)
    notebook_id = uuid_module.uuid4()
    modules[0].notebook_id = notebook_id

    async def latest(_scope, _session, notebook_ids):
        return {notebook_id: _version_row(notebook_id=notebook_id, status="ready")}

    monkeypatch.setattr(courses_repo, "_latest_versions", latest)
    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")
    assert response.status_code == 409
    body = response.json()
    assert body["reason"] == "course_not_ready"
    assert body["modules"] == ["week-02"]


async def test_export_streams_a_zip_named_for_the_course(client, monkeypatch):
    from leona_notebooks.source import parse_source

    course, modules = _two_module_course(monkeypatch)
    versions = {}
    for module in modules:
        module.notebook_id = uuid_module.uuid4()
        versions[module.notebook_id] = _version_row(
            notebook_id=module.notebook_id,
            status="ready",
            spec=parse_source(LESSON_SOURCE, slug=module.slug).model_dump(mode="json"),
        )

    async def latest(_scope, _session, notebook_ids):
        return {nid: versions[nid] for nid in notebook_ids}

    async def fake_current_version(_scope, _session, notebook_id):
        return versions[notebook_id]

    monkeypatch.setattr(courses_repo, "_latest_versions", latest)
    monkeypatch.setattr(notebooks_repo, "get_current_version", fake_current_version)

    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == f'attachment; filename="{course.slug}.zip"'
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        readme = archive.read("README.md").decode()
        notebook = json.loads(archive.read("week-01/lesson.ipynb"))
    assert {"README.md", "curriculum.yaml", "week-01/lesson.ipynb", "week-02/lesson.ipynb"} <= names
    # The README reflects the STORED modules, not the stale `courses.plan` column
    # (which this fixture leaves with no modules at all).
    assert "Qubits and circuits" in readme and "Entanglement" in readme
    assert notebook["nbformat"] == 4


QUIZ_SOURCE = """\
# ---
# title: Week 1 quiz
# kind: quiz
# ---

# %% [markdown] role=objective
# ## Check what you learned

# %% [markdown] role=question
# Which gate creates a superposition?

# %% [markdown] role=answer
# The Hadamard gate, obviously.

# %% [markdown] role=question
# What does measuring collapse?

# %% [markdown] role=answer
# The superposition, into one basis state.

# %% [markdown] role=question
# How many shots did we use?

# %% [markdown] role=answer
# One thousand.

# %% [markdown] role=summary
# Done.
"""


def _course_with_a_quiz(monkeypatch, *, owner_user_id):
    """A one-module course whose module is a quiz with real answer cells."""
    from leona_notebooks.source import parse_source

    course, modules = _two_module_course(monkeypatch, owner_user_id=owner_user_id)
    versions = {}
    for module in modules:
        module.notebook_id = uuid_module.uuid4()
        versions[module.notebook_id] = _version_row(
            notebook_id=module.notebook_id,
            status="ready",
            spec=parse_source(QUIZ_SOURCE, slug=module.slug).model_dump(mode="json"),
        )

    async def latest(_scope, _session, notebook_ids):
        return {nid: versions[nid] for nid in notebook_ids}

    async def fake_current_version(_scope, _session, notebook_id):
        return versions[notebook_id]

    monkeypatch.setattr(courses_repo, "_latest_versions", latest)
    monkeypatch.setattr(notebooks_repo, "get_current_version", fake_current_version)
    return course


async def test_the_author_downloads_a_course_with_its_solutions(
    client, scope_identity, monkeypatch
):
    """`solutions/` is the point of a course export for the person who made it."""
    scope, _identity = scope_identity
    course = _course_with_a_quiz(monkeypatch, owner_user_id=scope.user_id)

    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        blob = b"".join(archive.read(n) for n in names if n.endswith(".ipynb"))
    assert any(n.startswith("solutions/") for n in names)
    assert b"The Hadamard gate, obviously." in blob


async def test_another_member_downloads_the_course_without_the_answer_key(client, monkeypatch):
    """Owner ruling ai-ops 260, option 1, applied to the course export.

    `builds_for` writes the answer-free notebook in place AND a full copy of every
    challenge and quiz under `solutions/`, so before this any member of the workspace
    downloaded the entire answer key in a zip. The notebook export route was fixed
    first; this is the same door one room over, which is the reason to enumerate the
    siblings of a defect rather than only the instance that was reported.
    """
    course = _course_with_a_quiz(monkeypatch, owner_user_id=uuid_module.uuid4())

    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        blob = b"".join(archive.read(n) for n in names if n.endswith(".ipynb"))
    assert not any(n.startswith("solutions/") for n in names), names
    assert b"The Hadamard gate, obviously." not in blob
    # The control: the course is still a usable download, not an empty zip. Without this
    # the assertions above would pass on a route that had simply stopped working.
    assert any(n.endswith(".ipynb") for n in names), names
    assert b"Which gate creates a superposition?" in blob


CHALLENGE_SOURCE = """\
# ---
# title: Week 1 challenge
# kind: challenge
# ---

# %% [markdown] role=objective
# ## Build a Bell pair

# %% role=setup
from qiskit import QuantumCircuit

# %% [markdown] role=exercise
# Build `bell`.

# %% role=solution stub="bell = None\\n"
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)

# %% [markdown] role=summary
# Done.
"""


def _challenge_execution_report() -> dict:
    """The stored `notebook_versions.report` for `CHALLENGE_SOURCE`, as it would come
    back out of Postgres: `c02` (`role=setup`, never redacted) and `c04` (`role=solution`,
    the cell a challenge build's stub replaces) each printed something when the version
    was generated."""
    from leona_notebooks.execution import CellResult, ExecutionReport

    report = ExecutionReport(
        notebook_slug="week-01",
        ok=True,
        runner="sandbox",
        cells=[
            CellResult(id="c02", status="ok", stdout="qiskit imported\n"),
            CellResult(id="c04", status="ok", stdout="Bell pair built\n"),
        ],
    )
    return report.model_dump(mode="json")


def _course_with_a_challenge(monkeypatch, *, owner_user_id):
    """A ONE-module course whose module is a challenge with a real executed report —
    the shape the worker leaves behind once a module's notebook has actually run.

    Deliberately not built on `_two_module_course`: that helper's modules default to
    `kind="lesson"` on the ROW, which `module_filename` (not `spec.kind`) uses to name
    the `.nb.py`/`.ipynb` file, so a module carrying `CHALLENGE_SOURCE` under a
    `kind="lesson"` row would compile the RIGHT build (`builds_for` reads `spec.kind`)
    under the WRONG name (`lesson.ipynb`, not `challenge.ipynb`) — confusing to read
    and not what this test is about. One module, `kind="challenge"` on both the row
    and the source, keeps the file the test asserts on unambiguous.
    """
    from leona_notebooks.source import parse_source

    course = _course_row(owner_user_id=owner_user_id)
    module = _module_row(
        course_id=course.id, seq=1, slug="week-01", title="Week 1", kind="challenge"
    )
    version = _version_row(
        notebook_id=uuid_module.uuid4(),
        status="ready",
        spec=parse_source(CHALLENGE_SOURCE, slug=module.slug).model_dump(mode="json"),
        report=_challenge_execution_report(),
    )
    module.notebook_id = version.notebook_id

    async def fake_get_course(_scope, _session, _course_id):
        return course

    async def fake_list_modules(_scope, _session, _course_id):
        return [module]

    async def latest(_scope, _session, notebook_ids):
        return {nid: version for nid in notebook_ids}

    async def fake_current_version(_scope, _session, _notebook_id):
        return version

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    monkeypatch.setattr(courses_repo, "list_modules", fake_list_modules)
    monkeypatch.setattr(courses_repo, "_latest_versions", latest)
    monkeypatch.setattr(notebooks_repo, "get_current_version", fake_current_version)
    return course


def _notebook_named(archive: zipfile.ZipFile, suffix: str) -> dict:
    (name,) = (n for n in archive.namelist() if n.endswith(suffix))
    return json.loads(archive.read(name))


async def test_the_author_downloads_a_course_with_its_executed_outputs(
    client, scope_identity, monkeypatch
):
    """The defect this fixes: every module notebook already ran in the sandbox when its
    version was generated, but `export_course_zip` rebuilt every notebook from its spec
    with `execute=False` and never carried a `report` in, so the owner's own download
    looked never-run — a challenge cell's solution included.
    """
    scope, _identity = scope_identity
    course = _course_with_a_challenge(monkeypatch, owner_user_id=scope.user_id)

    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        solution = _notebook_named(archive, "_solution.ipynb")
    by_id = {cell["id"]: cell for cell in solution["cells"]}
    assert by_id["c02"]["outputs"], "an ordinary cell must carry the output it produced"
    assert by_id["c04"]["outputs"], "the owner's own solution build must carry its output"


async def test_a_non_owner_never_downloads_the_solution_cells_output(client, monkeypatch):
    """Owner ruling ai-ops 260, option 1, extended to OUTPUT, not just source.

    A non-owner's challenge build already redacts the solution cell's SOURCE (the stub
    replaces it). Without this fix, `export_course_zip` carried no outputs at all, which
    hid the leak; once outputs are threaded through, the same per-cell redaction
    `to_ipynb` already proves for the single-notebook export
    (`test_a_stub_does_not_carry_the_solutions_output`) must hold here too — a non-owner
    must never see what the hidden solution cell printed.
    """
    course = _course_with_a_challenge(monkeypatch, owner_user_id=uuid_module.uuid4())

    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert not any(n.startswith("solutions/") for n in names), names
        challenge = _notebook_named(archive, "challenge.ipynb")
    by_id = {cell["id"]: cell for cell in challenge["cells"]}
    assert by_id["c02"]["outputs"], "an unredacted cell must keep the output it produced"
    assert by_id["c04"]["outputs"] == [], "a non-owner must never see the solution's output"
    assert "Bell pair built" not in json.dumps(challenge)


async def test_export_of_a_module_with_no_compiled_notebook_is_409(client, monkeypatch):
    course, modules = _two_module_course(monkeypatch)
    versions = {}
    for module in modules:
        module.notebook_id = uuid_module.uuid4()
        versions[module.notebook_id] = _version_row(
            notebook_id=module.notebook_id, status="ready", spec=None
        )

    async def latest(_scope, _session, notebook_ids):
        return {nid: versions[nid] for nid in notebook_ids}

    async def fake_current_version(_scope, _session, notebook_id):
        return versions[notebook_id]

    monkeypatch.setattr(courses_repo, "_latest_versions", latest)
    monkeypatch.setattr(notebooks_repo, "get_current_version", fake_current_version)
    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/export.zip")
    assert response.status_code == 409
    assert response.json()["reason"] == "course_module_not_compiled"


# ----------------------------------------------------------------------------- turns


async def test_turn_enqueues_a_revise_job_and_records_the_user_turn(
    client, run_plumbing, monkeypatch
):
    course = _course_row(
        plan=CoursePlan(
            title="Qiskit study group",
            modules=[PlannedModule(slug="week-01", title="Week 1", brief="b")],
        ).model_dump(mode="json")
    )
    appended: list = []

    async def fake_get_course(_scope, _session, _course_id):
        return course

    async def fake_append_turn(_scope, _session, course_id, *, role, content, run_id):
        turn = CourseTurnRow(
            id=uuid_module.uuid4(),
            course_id=course_id,
            seq=1,
            role=role,
            content=content,
            run_id=run_id,
            created_at=NOW,
        )
        appended.append(turn)
        return turn

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    monkeypatch.setattr(courses_repo, "append_turn", fake_append_turn)

    async with client as c:
        response = await c.post(
            f"/v1/courses/{course.id}/turns",
            json={"message": "add a module on transpilation after week 1"},
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["turn"]["role"] == "user"
    assert body["turn"]["content"] == "add a module on transpilation after week 1"
    job = run_plumbing.jobs[0]
    assert job["kind"] == COURSE_REVISE_JOB_KIND
    assert job["payload"]["kind"] == "revise"
    assert job["payload"]["course_id"] == str(course.id)
    assert job["payload"]["request"] == {"message": "add a module on transpilation after week 1"}
    assert run_plumbing.runs[0]["mode"] == "notebook"
    assert appended and appended[0].role == "user"


async def test_turn_while_the_plan_is_still_being_written_is_409(client, run_plumbing, monkeypatch):
    course = _course_row(status="planning", plan=None)

    async def fake_get_course(_scope, _session, _course_id):
        return course

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    async with client as c:
        response = await c.post(f"/v1/courses/{course.id}/turns", json={"message": "hi"})
    assert response.status_code == 409
    assert response.json()["reason"] == "course_not_planned"
    assert run_plumbing.runs == [], "no run may be created for a refused turn"


async def test_list_turns_returns_them_in_order(client, monkeypatch):
    course = _course_row()

    async def fake_list_turns(_scope, _session, _course_id, **_kwargs):
        return [
            CourseTurnRow(
                id=uuid_module.uuid4(),
                course_id=course.id,
                seq=seq,
                role=role,
                content=content,
                run_id=None,
                created_at=NOW,
            )
            for seq, role, content in [(1, "user", "drop week 3"), (2, "nala", "Dropped it.")]
        ]

    monkeypatch.setattr(courses_repo, "list_turns", fake_list_turns)
    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/turns")
    assert response.status_code == 200
    items = response.json()["items"]
    assert [(i["seq"], i["role"]) for i in items] == [(1, "user"), (2, "nala")]


# ------------------------------------------------------------------------- the gate


@pytest.mark.parametrize(
    "method,path_suffix,body",
    [
        ("post", "", {"brief": "b"}),
        ("post", "/generate", {}),
        ("post", "/turns", {"message": "m"}),
    ],
)
async def test_every_run_creating_course_route_is_gated(
    scope_identity, monkeypatch, method, path_suffix, body
):
    """The gate is on the path, not merely patched away in the other tests. Each
    run-creating route must reach `_enforce_execute_backstop`; a route that gained a
    run without going through `_new_run` would fail here."""
    scope, identity = scope_identity
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: identity
    app.dependency_overrides[auth_deps.get_session] = lambda: object()

    calls: list = []

    async def refusing_gate(*_args, **_kwargs):
        calls.append(1)
        raise AssertionError("gate reached")

    monkeypatch.setattr(notebooks_routes, "_enforce_execute_backstop", refusing_gate)

    async def no_versions(*_args, **_kwargs):
        return {}

    course, _modules = _two_module_course(monkeypatch)
    monkeypatch.setattr(courses_repo, "_latest_versions", no_versions)

    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    url = "/v1/courses" if not path_suffix else f"/v1/courses/{course.id}{path_suffix}"
    with pytest.raises(AssertionError, match="gate reached"):
        async with client as c:
            await getattr(c, method)(url, json=body)
    assert calls == [1]


# ------------------------------------------------------------------------- gradebook


def _gradebook(course, modules, *, visibility="all_members"):
    """A gradebook as the repo would return it: two members, one of them with a
    display name built to be a spreadsheet formula."""
    import majorana_contracts as contracts

    first, second = modules
    entry = contracts.GradebookEntry(
        module_id=first.id,
        passed=1,
        failed=1,
        attempted=2,
        graded_cells=2,
        version_seq=1,
        stale=False,
        run_id=uuid_module.uuid4(),
        graded_at=NOW,
    )
    rows = [
        contracts.GradebookRow(
            user_id=uuid_module.uuid4(),
            email="ana@example.test",
            display_name='=HYPERLINK("http://evil.test","Open")',
            entries=[entry],
            total_passed=1,
            total_graded_cells=5,
            last_graded_at=NOW,
        ),
        contracts.GradebookRow(
            user_id=uuid_module.uuid4(),
            email="bo@example.test",
            display_name=None,
            entries=[entry.model_copy(update={"module_id": second.id, "stale": True})],
            total_passed=1,
            total_graded_cells=4,
            last_graded_at=NOW,
        ),
        # A member who has not started: listed for the course's creator all the same.
        contracts.GradebookRow(
            user_id=uuid_module.uuid4(),
            email="cy@example.test",
            display_name="Cy",
            entries=[],
            total_passed=0,
            total_graded_cells=5,
            last_graded_at=None,
        ),
    ]
    return contracts.CourseGradebook(
        course_id=course.id,
        visibility=contracts.GradebookVisibility(visibility),
        modules=[
            contracts.GradebookModule(
                id=first.id, seq=1, slug=first.slug, title=first.title, graded_cells=2
            ),
            contracts.GradebookModule(
                id=second.id, seq=2, slug=second.slug, title="-1 is the answer", graded_cells=3
            ),
        ],
        rows=rows,
    )


@pytest.fixture
def gradebook_course(monkeypatch):
    course, modules = _two_module_course(monkeypatch)
    book = _gradebook(course, modules)

    async def fake_gradebook(_scope, _session, course_id, cohort_id=None):
        assert course_id == course.id
        return book if cohort_id is None else book.model_copy(update={"cohort_id": cohort_id})

    monkeypatch.setattr(courses_repo, "course_gradebook", fake_gradebook)
    return course, book


async def test_gradebook_returns_the_repo_answer_with_its_visibility(client, gradebook_course):
    course, book = gradebook_course
    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/gradebook")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["visibility"] == "all_members"
    assert [row["email"] for row in body["rows"]] == [
        "ana@example.test",
        "bo@example.test",
        "cy@example.test",
    ]
    assert body["rows"][2]["entries"] == [] and body["rows"][2]["last_graded_at"] is None
    assert body["rows"][0]["entries"][0]["passed"] == 1


async def test_gradebook_of_a_course_in_another_workspace_is_404(client, monkeypatch):
    async def fake_gradebook(_scope, _session, _course_id, cohort_id=None):
        raise NotFoundError("course")

    async def fake_get_course(_scope, _session, _course_id):
        raise NotFoundError("course")

    monkeypatch.setattr(courses_repo, "course_gradebook", fake_gradebook)
    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    async with client as c:
        json_response = await c.get(f"/v1/courses/{uuid_module.uuid4()}/gradebook")
        csv_response = await c.get(f"/v1/courses/{uuid_module.uuid4()}/gradebook.csv")
    assert json_response.status_code == 404
    assert csv_response.status_code == 404


async def test_gradebook_csv_is_one_row_per_member_per_module_with_totals(client, gradebook_course):
    import csv as csv_module

    course, _book = gradebook_course
    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/gradebook.csv")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="{course.slug}-gradebook.csv"'
    )
    text = response.content.decode("utf-8")
    assert text.startswith("﻿"), "Excel needs the BOM to read a Japanese name as UTF-8"
    rows = list(csv_module.reader(io.StringIO(text.lstrip("﻿"))))
    header, body = rows[0], rows[1:]
    assert header[:6] == [
        "member",
        "email",
        "module_number",
        "module",
        "cells_passed",
        "graded_cells",
    ]
    # `cohort` is appended after the totals (ai-ops 349 proposal 8), so it is the
    # new last column and the totals are now third- and second-from-last.
    assert header[-3:] == ["course_cells_passed", "course_graded_cells", "cohort"]
    assert len(body) == 6, "three members x two modules"
    record = [dict(zip(header, row, strict=True)) for row in body]
    # A module the member has not been graded on: passed EMPTY, not 0, and the
    # module's count today as the denominator.
    assert record[1]["email"] == "ana@example.test"
    assert record[1]["cells_passed"] == ""
    assert record[1]["graded_cells"] == "3"
    assert record[0]["cells_passed"] == "1" and record[0]["graded_cells"] == "2"
    assert [r["course_graded_cells"] for r in record] == ["5", "5", "4", "4", "5", "5"]
    assert record[3]["outdated"] == "yes" and record[2]["outdated"] == ""
    # A member with no display name is listed by their email.
    assert record[2]["member"] == "bo@example.test"
    # A member who has not started: every module "not started" (empty), and the
    # course total empty rather than 0, while the denominator is still the course's.
    cy = [r for r in record if r["email"] == "cy@example.test"]
    assert [r["cells_passed"] for r in cy] == ["", ""]
    assert [r["graded_cells"] for r in cy] == ["2", "3"]
    assert [r["graded_at"] for r in cy] == ["", ""]
    assert [r["course_cells_passed"] for r in cy] == ["", ""]
    assert record[0]["course_cells_passed"] == "1", "a started member keeps their total"


async def test_gradebook_csv_cannot_smuggle_a_formula_into_a_spreadsheet(client, gradebook_course):
    course, _book = gradebook_course
    async with client as c:
        response = await c.get(f"/v1/courses/{course.id}/gradebook.csv")
    text = response.content.decode("utf-8")
    assert "'=HYPERLINK(" in text
    assert ",=HYPERLINK(" not in text and ',"=HYPERLINK(' not in text
    assert "'-1 is the answer" in text


@pytest.mark.parametrize("prefix", ["=", "+", "-", "@", "\t", "\r"])
def test_every_formula_prefix_is_neutralised(prefix):
    import csv as csv_module

    import majorana_contracts as contracts

    from majorana_api.routes.courses import render_gradebook_csv

    module_id = uuid_module.uuid4()
    book = contracts.CourseGradebook(
        course_id=uuid_module.uuid4(),
        visibility=contracts.GradebookVisibility.ALL_MEMBERS,
        modules=[
            contracts.GradebookModule(
                id=module_id, seq=1, slug="m", title=f"{prefix}title", graded_cells=1
            )
        ],
        rows=[
            contracts.GradebookRow(
                user_id=uuid_module.uuid4(),
                email=f"{prefix}x@example.test",
                display_name=f"{prefix}cmd|' /C calc'!A0",
                entries=[],
                total_passed=0,
                total_graded_cells=1,
                last_graded_at=NOW,
            )
        ],
    )
    [_header, row] = list(csv_module.reader(io.StringIO(render_gradebook_csv(book))))
    member, email, _seq, title = row[:4]
    for cell in (member, email, title):
        assert cell.startswith("'" + prefix), repr(cell)
    # The control: an ordinary value is left exactly as typed.
    assert row[2] == "1"


async def test_gradebook_csv_and_gradebook_and_export_resolve_to_their_own_routes(
    client, gradebook_course
):
    """Three sibling paths under one course, checked with real requests rather than
    reasoned about: `gradebook.csv` must not be swallowed by `gradebook`, and adding
    both must not change what `export.zip` answers (409, every module unready)."""
    course, _book = gradebook_course
    async with client as c:
        as_json = await c.get(f"/v1/courses/{course.id}/gradebook")
        as_csv = await c.get(f"/v1/courses/{course.id}/gradebook.csv")
        as_zip = await c.get(f"/v1/courses/{course.id}/export.zip")
        wrong_method = await c.post(f"/v1/courses/{course.id}/gradebook.csv")
    assert as_json.headers["content-type"].startswith("application/json")
    assert as_csv.headers["content-type"].startswith("text/csv")
    assert as_zip.status_code == 409 and as_zip.json()["reason"] == "course_not_ready"
    assert wrong_method.status_code == 405


def test_an_unknown_course_total_is_an_empty_cell_not_a_smaller_number():
    """Greptile, PR 965: while a module is still being generated its count is unknown,
    so the member's course total is `None`, and the CSV leaves that cell empty rather
    than writing the smaller sum of the modules it could count."""
    import csv as csv_module

    import majorana_contracts as contracts

    from majorana_api.routes.courses import render_gradebook_csv

    ready, generating = uuid_module.uuid4(), uuid_module.uuid4()
    book = contracts.CourseGradebook(
        course_id=uuid_module.uuid4(),
        visibility=contracts.GradebookVisibility.ALL_MEMBERS,
        modules=[
            contracts.GradebookModule(
                id=ready,
                seq=1,
                slug="a",
                title="Ready",
                notebook_id=uuid_module.uuid4(),
                graded_cells=2,
            ),
            contracts.GradebookModule(
                id=generating,
                seq=2,
                slug="b",
                title="Generating",
                notebook_id=uuid_module.uuid4(),
                graded_cells=None,
            ),
        ],
        rows=[
            contracts.GradebookRow(
                user_id=uuid_module.uuid4(),
                email="ana@example.test",
                entries=[
                    contracts.GradebookEntry(
                        module_id=ready,
                        passed=2,
                        failed=0,
                        attempted=2,
                        graded_cells=2,
                        version_seq=1,
                        run_id=uuid_module.uuid4(),
                        graded_at=NOW,
                    )
                ],
                total_passed=2,
                total_graded_cells=None,
                last_graded_at=NOW,
            )
        ],
    )
    assert book.model_dump(mode="json")["rows"][0]["total_graded_cells"] is None
    records = list(csv_module.DictReader(io.StringIO(render_gradebook_csv(book))))
    assert [r["course_graded_cells"] for r in records] == ["", ""]
    assert [r["graded_cells"] for r in records] == ["2", ""]
    # The control: what IS known still reaches the sheet.
    assert [r["course_cells_passed"] for r in records] == ["2", "2"]


# ------------------------------------------------------------------------- due dates
#
# Through the REAL `update_course`, with only the course and module reads faked: the
# three states of `due_at` (absent, a value, null) are told apart by which keys the
# client sent, so the thing worth proving is that FastAPI's parse of the body still
# carries that set all the way to the repository.


class _FlushOnly:
    """The one session method `update_course` calls once the reads are faked."""

    async def flush(self):
        return None


@pytest.fixture
def due_client(client):
    """`client`, with a session the real `update_course` can flush. `client` hands the
    routes a bare `object()`, which was enough while every repo call was faked."""
    client._transport.app.dependency_overrides[auth_deps.get_session] = lambda: _FlushOnly()
    return client


def _due_course(monkeypatch, scope, *, creator: bool, generated: bool = True):
    course, modules = _two_module_course(
        monkeypatch,
        workspace_id=scope.workspace_id,
        **({"owner_user_id": scope.user_id} if creator else {}),
    )
    if generated:
        modules[0].notebook_id = uuid_module.uuid4()
    return course, modules


async def test_the_creator_sets_and_clears_a_due_date_over_http(
    due_client, scope_identity, monkeypatch
):
    scope, _identity = scope_identity
    course, modules = _due_course(monkeypatch, scope, creator=True)
    target, planned = modules
    assert target.notebook_id is not None and planned.notebook_id is None
    async with due_client as c:
        set_response = await c.patch(
            f"/v1/courses/{course.id}",
            json={
                "modules": [
                    {"id": str(target.id), "due_at": "2026-09-30T17:00:00+09:00"},
                    {"id": str(planned.id), "due_at": "2026-10-07T08:00:00Z"},
                ]
            },
        )
        # A module patch that does not SEND due_at: the planned module's title
        # changes and its due date stays.
        kept_response = await c.patch(
            f"/v1/courses/{course.id}",
            json={"modules": [{"id": str(planned.id), "title": "Renamed"}]},
        )
        cleared_response = await c.patch(
            f"/v1/courses/{course.id}", json={"modules": [{"id": str(target.id), "due_at": None}]}
        )

    assert set_response.status_code == 200, set_response.text
    body = set_response.json()
    assert body["owner_user_id"] == str(scope.user_id)
    # Accepted on a module whose notebook already exists, and returned in UTC.
    assert dt.datetime.fromisoformat(body["modules"][0]["due_at"]) == dt.datetime(
        2026, 9, 30, 8, 0, tzinfo=dt.timezone.utc
    )
    assert body["modules"][0]["due_at"].endswith(("Z", "+00:00"))

    assert kept_response.status_code == 200, kept_response.text
    kept = kept_response.json()["modules"][1]
    assert kept["title"] == "Renamed"
    assert kept["due_at"] is not None, "a module patch without due_at must leave it"

    assert cleared_response.status_code == 200, cleared_response.text
    cleared = cleared_response.json()["modules"]
    assert cleared[0]["due_at"] is None
    assert cleared[1]["due_at"] is not None, "clearing one module leaves the other"


async def test_someone_who_did_not_create_the_course_is_refused_403_and_nothing_changes(
    due_client, scope_identity, monkeypatch
):
    scope, _identity = scope_identity
    course, modules = _due_course(monkeypatch, scope, creator=False)
    async with due_client as c:
        response = await c.patch(
            f"/v1/courses/{course.id}",
            json={
                "title": "Also renamed",
                "modules": [{"id": str(modules[1].id), "due_at": "2026-09-30T08:00:00Z"}],
            },
        )
        clear = await c.patch(
            f"/v1/courses/{course.id}",
            json={"modules": [{"id": str(modules[1].id), "due_at": None}]},
        )
    assert response.status_code == 403, response.text
    assert response.json()["reason"] == "course_due_date_creator_only"
    assert response.json()["title"] == "Only the person who made this course can set its due dates."
    assert clear.status_code == 403
    assert modules[1].due_at is None
    assert course.title == "Qiskit study group", "the title riding along was not applied"


async def test_a_due_date_on_a_course_in_another_workspace_is_404(client, monkeypatch):
    async def fake_get_course(_scope, _session, _course_id):
        raise NotFoundError("course")

    monkeypatch.setattr(courses_repo, "get_course", fake_get_course)
    async with client as c:
        response = await c.patch(
            f"/v1/courses/{uuid_module.uuid4()}",
            json={"modules": [{"id": str(uuid_module.uuid4()), "due_at": "2026-09-30T08:00:00Z"}]},
        )
    assert response.status_code == 404


async def test_a_due_date_with_no_utc_offset_is_422(due_client, scope_identity, monkeypatch):
    scope, _identity = scope_identity
    course, modules = _due_course(monkeypatch, scope, creator=True)
    async with due_client as c:
        response = await c.patch(
            f"/v1/courses/{course.id}",
            json={"modules": [{"id": str(modules[0].id), "due_at": "2026-09-30T17:00:00"}]},
        )
    assert response.status_code == 422
    assert modules[0].due_at is None


async def test_a_plan_edit_riding_with_a_due_date_on_a_generated_module_is_still_409(
    due_client, scope_identity, monkeypatch
):
    scope, _identity = scope_identity
    course, modules = _due_course(monkeypatch, scope, creator=True)
    async with due_client as c:
        response = await c.patch(
            f"/v1/courses/{course.id}",
            json={
                "modules": [
                    {"id": str(modules[0].id), "due_at": "2026-09-30T08:00:00Z", "title": "New"}
                ]
            },
        )
    assert response.status_code == 409
    assert response.json()["reason"] == "course_module_already_generated"


def test_the_csv_carries_due_at_late_and_missing_beside_graded_at():
    import csv as csv_module

    import majorana_contracts as contracts

    from majorana_api.routes.courses import render_gradebook_csv

    due = dt.datetime(2026, 9, 30, 17, 0, tzinfo=dt.timezone(dt.timedelta(hours=9)))
    first, second, third = (uuid_module.uuid4() for _ in range(3))
    entry = contracts.GradebookEntry(
        module_id=first,
        passed=1,
        failed=1,
        attempted=2,
        graded_cells=2,
        version_seq=1,
        run_id=uuid_module.uuid4(),
        graded_at=NOW,
        late=True,
    )
    book = contracts.CourseGradebook(
        course_id=uuid_module.uuid4(),
        visibility=contracts.GradebookVisibility.ALL_MEMBERS,
        modules=[
            contracts.GradebookModule(
                id=first, seq=1, slug="a", title="A", graded_cells=2, due_at=due
            ),
            contracts.GradebookModule(
                id=second, seq=2, slug="b", title="B", graded_cells=2, due_at=due
            ),
            contracts.GradebookModule(id=third, seq=3, slug="c", title="C", graded_cells=2),
        ],
        rows=[
            contracts.GradebookRow(
                user_id=uuid_module.uuid4(),
                email="ana@example.test",
                entries=[entry],
                total_passed=1,
                total_graded_cells=6,
                last_graded_at=NOW,
                missing_module_ids=[second],
            )
        ],
    )
    reader = csv_module.DictReader(io.StringIO(render_gradebook_csv(book)))
    header = reader.fieldnames
    records = list(reader)

    assert header is not None
    at = header.index("graded_at")
    assert header[at : at + 4] == ["graded_at", "due_at", "late", "missing"]
    # PR 965's pinned ends are where they were; `cohort` (ai-ops 349 proposal 8)
    # is appended after them, so it is the new last column.
    assert header[:4] == ["member", "email", "module_number", "module"]
    assert header[-3:] == ["course_cells_passed", "course_graded_cells", "cohort"]
    # In UTC, whatever offset the value arrived with.
    assert [r["due_at"] for r in records] == [
        "2026-09-30T08:00:00+00:00",
        "2026-09-30T08:00:00+00:00",
        "",
    ]
    # `late` only where there is an attempt; `missing` on every row.
    assert [r["late"] for r in records] == ["yes", "", ""]
    assert [r["missing"] for r in records] == ["no", "yes", "no"]
