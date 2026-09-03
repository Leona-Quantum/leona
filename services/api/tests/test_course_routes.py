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
