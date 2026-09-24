"""routes/notebooks.py over ASGI — the contract a client is built against.

Same shape as `test_qpu_credential_routes.py`: the real app, identity/scope
stubbed via `dependency_overrides` (`test_qpu_credential_routes.py:98-110`), and
the repository layer replaced with fakes via `monkeypatch.setattr` on the
`notebooks`/`runs`/`system` module objects the route imported — so these tests
run with no database and assert what the route actually sends the job queue and
the client, not what a repository function does internally (that is
`test_notebook_repo.py`'s job).
"""

import datetime as dt
import json as json_module
import uuid as uuid_module
from types import SimpleNamespace

import httpx
import pytest
from majorana_contracts import NotebookKind

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.jobs import (
    NOTEBOOK_GENERATE_JOB_KIND,
    NOTEBOOK_GRADE_JOB_KIND,
    NOTEBOOK_REVISE_JOB_KIND,
)
from majorana_api.orm import Notebook as NotebookRow
from majorana_api.orm import NotebookVersion as NotebookVersionRow
from majorana_api.orm import User, Workspace
from majorana_api.repos._base import NotFoundError
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system as system_repo
from majorana_api.routes import notebooks as notebooks_routes
from majorana_api.settings import Settings

NOW = dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc)

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


def _notebook_row(**overrides) -> NotebookRow:
    base = dict(
        id=uuid_module.uuid4(),
        workspace_id=uuid_module.uuid4(),
        owner_user_id=uuid_module.uuid4(),
        slug="my-notebook-ab12cd34",
        title="My notebook",
        kind="lesson",
        summary="",
        visibility="private",
        language="en",
        framework={"name": "qiskit", "version": ">=2.5,<2.6", "execution": "local-statevector"},
        current_version_id=None,
        deleted_at=None,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return NotebookRow(**base)


def _version_row(**overrides) -> NotebookVersionRow:
    base = dict(
        id=uuid_module.uuid4(),
        notebook_id=uuid_module.uuid4(),
        seq=1,
        status="queued",
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

    # The abuse/tier gate reaches real repository queries
    # (`runs_repo.reserve_execute_run_slot`, `count_runs_by_mode_since`, ...)
    # this file's bare `object()` session cannot answer. Every OTHER route test
    # in this suite that reaches `POST /v1/runs` monkeypatches around the same
    # gate (`test_run_execute_backstop.py`); here it is bypassed at the single
    # point `routes.notebooks` calls it from.
    monkeypatch.setattr(notebooks_routes, "_enforce_execute_backstop", no_backstop)

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# --------------------------------------------------------------------------- create


async def test_create_notebook_enqueues_generate_job_with_expected_payload(
    client, scope_identity, monkeypatch
):
    scope, _identity = scope_identity
    run_id = uuid_module.uuid4()
    captured_create_run: dict = {}
    captured_job: dict = {}

    async def fake_create_run(_scope, _session, **kwargs):
        captured_create_run.update(kwargs)
        return SimpleNamespace(id=run_id)

    async def fake_append_run_event(*_args, **_kwargs):
        return None

    async def fake_create_notebook(_scope, _session, **kwargs):
        version = _version_row(run_id=run_id)
        notebook = _notebook_row()
        captured_create_run["notebook_kwargs"] = kwargs
        return notebook, version

    async def fake_enqueue_job(_session, *, kind, payload, run_id=None, **_kwargs):
        captured_job["kind"] = kind
        captured_job["payload"] = payload
        captured_job["run_id"] = run_id
        return SimpleNamespace(id=uuid_module.uuid4())

    monkeypatch.setattr(runs_repo, "create_run", fake_create_run)
    monkeypatch.setattr(runs_repo, "append_run_event", fake_append_run_event)
    monkeypatch.setattr(notebooks_repo, "create_notebook", fake_create_notebook)
    monkeypatch.setattr(system_repo, "enqueue_job", fake_enqueue_job)

    async with client as c:
        response = await c.post(
            "/v1/notebooks",
            json={"brief": "Teach me a Bell state", "response_locale": "en"},
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["run_id"] == str(run_id)

    assert captured_create_run["mode"] == "notebook"
    assert captured_create_run["task_prompt"] == "Teach me a Bell state"

    assert captured_job["kind"] == NOTEBOOK_GENERATE_JOB_KIND
    assert captured_job["run_id"] == run_id
    payload = captured_job["payload"]
    assert payload["kind"] == "generate"
    assert payload["run_id"] == str(run_id)
    assert payload["user_id"] == str(scope.user_id)
    assert payload["workspace_id"] == str(scope.workspace_id)
    assert payload["response_locale"] == "en"
    assert payload["request"]["brief"] == "Teach me a Bell state"
    assert uuid_module.UUID(payload["notebook_id"])
    assert uuid_module.UUID(payload["version_id"])
    assert set(payload) == {
        "run_id",
        "notebook_id",
        "version_id",
        "user_id",
        "workspace_id",
        "kind",
        "request",
        "response_locale",
    }


async def test_create_notebook_refuses_a_nul_byte(client):
    async with client as c:
        response = await c.post("/v1/notebooks", json={"brief": "a\x00b"})
    assert response.status_code == 422


# ------------------------------------------------------------------- get/list scoping


async def test_get_notebook_outside_the_workspace_is_404(client, monkeypatch):
    async def fake_get_notebook(_scope, _session, _notebook_id):
        raise NotFoundError("notebook")

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{uuid_module.uuid4()}")

    assert response.status_code == 404


# -------------------------------------------------------------------------- 409s


async def test_turn_on_a_notebook_with_no_ready_version_is_409(client, monkeypatch):
    notebook = _notebook_row(current_version_id=None)
    version = _version_row(notebook_id=notebook.id, seq=1, status="queued")

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_list_versions(_scope, _session, _notebook_id):
        return [version]

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "list_versions", fake_list_versions)

    async with client as c:
        response = await c.post(f"/v1/notebooks/{notebook.id}/turns", json={"message": "hi"})

    assert response.status_code == 409
    assert response.json()["reason"] == "notebook_not_ready"


def _failed_first_build(*, with_spec: bool):
    notebook = _notebook_row(current_version_id=None)
    spec = {"slug": notebook.slug, "title": "t", "cells": [{"id": "c1", "kind": "code", "source": "x = 1\n"}]}
    failed = _version_row(
        notebook_id=notebook.id,
        seq=1,
        status="failed",
        spec=spec if with_spec else None,
        error="cell c1 failed: NameError: name 'y' is not defined",
    )
    return notebook, failed


def _patch_for_a_run(monkeypatch, notebook, versions, captured: dict) -> None:
    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_list_versions(_scope, _session, _notebook_id):
        return versions

    async def fake_create_run(_scope, _session, **_kwargs):
        return SimpleNamespace(id=uuid_module.uuid4())

    async def fake_append_run_event(*_a, **_k):
        return None

    async def fake_append_turn(_scope, _session, notebook_id, **kwargs):
        return SimpleNamespace(
            id=uuid_module.uuid4(), notebook_id=notebook_id, seq=1, role=kwargs["role"],
            content=kwargs["content"], run_id=kwargs["run_id"], created_at=NOW,
        )

    async def fake_create_version(_scope, _session, notebook_id, **kwargs):
        return _version_row(notebook_id=notebook_id, seq=2, created_by=kwargs["created_by"])

    async def fake_enqueue_job(_session, *, kind, payload, run_id=None, **_kwargs):
        captured["kind"] = kind
        captured["payload"] = payload
        return SimpleNamespace(id=uuid_module.uuid4())

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "list_versions", fake_list_versions)
    monkeypatch.setattr(notebooks_repo, "append_turn", fake_append_turn)
    monkeypatch.setattr(notebooks_repo, "create_version", fake_create_version)
    monkeypatch.setattr(runs_repo, "create_run", fake_create_run)
    monkeypatch.setattr(runs_repo, "append_run_event", fake_append_run_event)
    monkeypatch.setattr(system_repo, "enqueue_job", fake_enqueue_job)


async def test_a_turn_on_a_notebook_whose_only_build_failed_starts_from_that_build(client, monkeypatch):
    # Plan 10-notebook-ide rule 2. The 2026-09-24 production notebook answered 409 to each
    # message its owner sent, although its failed build carried all 36 cells.
    notebook, failed = _failed_first_build(with_spec=True)
    captured: dict = {}
    _patch_for_a_run(monkeypatch, notebook, [failed], captured)

    async with client as c:
        response = await c.post(f"/v1/notebooks/{notebook.id}/turns", json={"message": "fix cell c1"})

    assert response.status_code == 201, response.text
    assert captured["kind"] == NOTEBOOK_REVISE_JOB_KIND
    assert captured["payload"]["base_version_id"] == str(failed.id)


async def test_a_rerun_of_a_notebook_whose_only_build_failed_starts_from_that_build(client, monkeypatch):
    notebook, failed = _failed_first_build(with_spec=True)
    captured: dict = {}
    _patch_for_a_run(monkeypatch, notebook, [failed], captured)

    async with client as c:
        response = await c.post(f"/v1/notebooks/{notebook.id}/run")

    assert response.status_code == 200, response.text
    assert captured["payload"]["kind"] == "rerun"
    assert captured["payload"]["base_version_id"] == str(failed.id)


async def test_a_failed_build_with_no_spec_still_has_nothing_to_work_from(client, monkeypatch):
    notebook, failed = _failed_first_build(with_spec=False)
    captured: dict = {}
    _patch_for_a_run(monkeypatch, notebook, [failed], captured)

    async with client as c:
        response = await c.post(f"/v1/notebooks/{notebook.id}/turns", json={"message": "hi"})

    assert response.status_code == 409
    assert response.json()["reason"] == "notebook_not_ready"
    assert "kind" not in captured


async def test_a_ready_version_is_still_preferred_over_a_newer_failed_one(client, monkeypatch):
    ready = _version_row(seq=1, status="ready", spec={"slug": "s", "title": "t", "cells": []})
    notebook = _notebook_row(current_version_id=ready.id)
    ready = _version_row(id=ready.id, notebook_id=notebook.id, seq=1, status="ready", spec=ready.spec)
    newer_failed = _version_row(notebook_id=notebook.id, seq=2, status="failed", spec=ready.spec)
    captured: dict = {}
    _patch_for_a_run(monkeypatch, notebook, [ready, newer_failed], captured)

    async with client as c:
        response = await c.post(f"/v1/notebooks/{notebook.id}/turns", json={"message": "hi"})

    assert response.status_code == 201, response.text
    assert captured["payload"]["base_version_id"] == str(ready.id)


async def test_turn_while_a_revision_is_in_flight_is_409(client, monkeypatch):
    ready = _version_row(seq=1, status="ready")
    notebook = _notebook_row(current_version_id=ready.id)
    ready = _version_row(id=ready.id, notebook_id=notebook.id, seq=1, status="ready")
    queued = _version_row(notebook_id=notebook.id, seq=2, status="queued")

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_list_versions(_scope, _session, _notebook_id):
        return [ready, queued]

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "list_versions", fake_list_versions)

    async with client as c:
        response = await c.post(f"/v1/notebooks/{notebook.id}/run")

    assert response.status_code == 409
    assert response.json()["reason"] == "notebook_version_in_flight"


# -------------------------------------------------------------------------- export


async def test_export_sets_the_ipynb_content_type_and_filename(client, monkeypatch):
    notebook = _notebook_row(slug="bell-state-ab12cd34")
    version = _version_row(
        notebook_id=notebook.id, seq=2, status="ready", ipynb={"cells": [], "nbformat": 4}
    )

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, seq):
        assert seq == 2
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/versions/2/export.ipynb")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ipynb+json")
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="bell-state-ab12cd34-v2.ipynb"'
    )
    assert response.json() == {"cells": [], "nbformat": 4}


async def test_export_compiles_from_spec_when_no_executed_copy_exists(client, monkeypatch):
    notebook = _notebook_row(slug="s")
    spec = {
        "schema_version": 1,
        "slug": "s",
        "title": "A notebook",
        "kind": "scratch",
        "cells": [{"id": "c01", "kind": "markdown", "source": "# hi"}],
    }
    version = _version_row(notebook_id=notebook.id, seq=1, status="ready", ipynb=None, spec=spec)

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, _seq):
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb")

    assert response.status_code == 200
    body = response.json()
    # A downloaded notebook now opens with what to install. Without it the first thing a
    # reader meets outside our sandbox is `ModuleNotFoundError` on the first import, and
    # the version requirement was recorded only in `metadata.leona`, which no Jupyter,
    # JupyterLab or VS Code UI shows anybody.
    assert body["cells"][0]["id"] == "leona-setup-note"
    assert "pip install" in body["cells"][0]["source"]
    assert body["cells"][1]["source"] == "# hi"


async def test_a_quiz_downloads_without_its_answers(client, scope_identity, monkeypatch):
    """The download button on a quiz used to hand over the answer key.

    `build_for_kind` existed and only the CLI called it; every path a real user could
    reach took `to_ipynb`'s `build="full"` default, so the file a reader downloaded to
    ATTEMPT the quiz contained the answers. Asserted here, at the route, because that is
    where a user touches it — the compiler's own redaction was correct throughout and
    tested, which is exactly why nothing caught this.
    """
    scope, _identity = scope_identity
    notebook = _notebook_row(slug="q", owner_user_id=scope.user_id)
    spec = {
        "schema_version": 1,
        "slug": "q",
        "title": "A quiz",
        "kind": "quiz",
        "cells": [
            {"id": "c01", "kind": "markdown", "role": "objective", "source": "## Quiz"},
            {"id": "c02", "kind": "markdown", "role": "question", "source": "Which gate?"},
            {"id": "c03", "kind": "markdown", "role": "answer", "source": "Hadamard."},
            {"id": "c04", "kind": "markdown", "role": "summary", "source": "Done."},
        ],
    }
    version = _version_row(notebook_id=notebook.id, seq=1, status="ready", ipynb=None, spec=spec)

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, _seq):
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)

    async with client as c:
        reader = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb")
        author = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb?build=solution")

    assert reader.status_code == 200
    assert "Hadamard" not in reader.text
    assert [c["id"] for c in reader.json()["cells"]] == [
        "leona-setup-note",
        "c01",
        "c02",
        "c04",
    ]
    # The control: asking for the solution build still returns it, so the assertion above
    # is about the redaction and not about a route that lost the cell some other way.
    assert author.status_code == 200
    assert "Hadamard" in author.text


async def test_a_lesson_downloads_whole(client, scope_identity, monkeypatch):
    """The negative control for the rule above: only a challenge or a quiz is redacted.

    Without this, making every download redacted would pass the quiz test and quietly
    strip the worked examples out of every lesson — the failure that looks like success.
    """
    scope, _identity = scope_identity
    notebook = _notebook_row(slug="l", owner_user_id=scope.user_id)
    spec = {
        "schema_version": 1,
        "slug": "l",
        "title": "A lesson",
        "kind": "lesson",
        "cells": [
            {"id": "c01", "kind": "markdown", "role": "objective", "source": "## Lesson"},
            {
                "id": "c02",
                "kind": "code",
                "role": "solution",
                "source": "worked = 42",
                "stub": "worked = None\n",
            },
            {"id": "c03", "kind": "markdown", "role": "summary", "source": "Done."},
        ],
    }
    version = _version_row(notebook_id=notebook.id, seq=1, status="ready", ipynb=None, spec=spec)

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, _seq):
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb")

    assert response.status_code == 200
    assert "worked = 42" in response.text


# ------------------------------------------------------- who may see the answers (ai-ops#260)


_QUIZ_SPEC = {
    "schema_version": 1,
    "slug": "q",
    "title": "A quiz",
    "kind": "quiz",
    "cells": [
        {"id": "c01", "kind": "markdown", "role": "objective", "source": "## Quiz"},
        {
            "id": "c02",
            "kind": "markdown",
            "role": "question",
            "source": "Which gate creates superposition?",
            "answer": {"kind": "choice", "options": ["X", "H"], "correct": 1},
        },
        {"id": "c03", "kind": "markdown", "role": "answer", "source": "The Hadamard gate."},
        {"id": "c04", "kind": "markdown", "role": "summary", "source": "Done."},
    ],
}


def _wire_quiz(monkeypatch, notebook):
    version = _version_row(
        notebook_id=notebook.id,
        seq=1,
        status="ready",
        spec=_QUIZ_SPEC,
        source="# %% [markdown] role=answer\n# The Hadamard gate.\n",
        ipynb={"cells": [{"cell_type": "markdown", "source": "The Hadamard gate."}], "nbformat": 4},
    )

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, _seq):
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)
    return version


async def test_the_author_of_a_notebook_still_sees_its_answers(client, scope_identity, monkeypatch):
    scope, _identity = scope_identity
    _wire_quiz(monkeypatch, _notebook_row(slug="q", owner_user_id=scope.user_id))

    async with client as c:
        response = await c.get(f"/v1/notebooks/{uuid_module.uuid4()}/versions/1")

    assert response.status_code == 200
    assert "Hadamard" in response.text, "the person who wrote the quiz must still see it"
    assert response.json()["spec"]["cells"][2]["role"] == "answer"


async def test_another_member_of_the_workspace_does_not_see_the_answers(
    client, scope_identity, monkeypatch
):
    """Owner ruling ai-ops#260, option 1 — only the creator sees the answers.

    Before this, `for_learner()` had no production caller: every member of the workspace
    received the raw spec, and so did anyone with the network tab open. The three
    assertions below are three separate carriers of the same secret, and redacting one
    while leaving the others is what a spec-only fix would have done.
    """
    _wire_quiz(monkeypatch, _notebook_row(slug="q", owner_user_id=uuid_module.uuid4()))

    async with client as c:
        response = await c.get(f"/v1/notebooks/{uuid_module.uuid4()}/versions/1")

    assert response.status_code == 200
    body = response.json()
    assert [cell["id"] for cell in body["spec"]["cells"]] == ["c01", "c02", "c04"]
    assert body["spec"]["cells"][1]["answer"] is None
    assert body["spec"]["cells"][1]["answer_prompt"]["options"] == ["X", "H"]
    assert "Hadamard" not in body["source"], "the .nb.py source carries the answer too"
    assert "Hadamard" not in json_module.dumps(body["ipynb"]), "so does the stored compile"


async def test_a_non_author_cannot_ask_for_the_solution_build(client, monkeypatch):
    """`?build=solution` was the redaction's back door, open to anyone in the workspace.

    The version route was fixed and the export route, one function below it, took the
    build straight from the query string — so a colleague got the unredacted notebook for
    the price of a parameter. Greptile caught it on PR 836.

    Refused rather than quietly downgraded: they asked for a specific thing and are
    entitled to know they did not get it.
    """
    notebook = _notebook_row(slug="q", owner_user_id=uuid_module.uuid4())  # someone else's
    _wire_quiz(monkeypatch, notebook)

    async with client as c:
        response = await c.get(
            f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb?build=solution"
        )

    assert response.status_code == 403
    assert response.json()["reason"] == "notebook_solutions_are_the_authors"
    assert "Hadamard" not in response.text


async def test_a_non_author_downloading_a_LESSON_still_gets_it_redacted(client, monkeypatch):
    """Deciding by kind alone leaves every graded lesson downloadable in full.

    `build_for_kind` answers "what is this notebook FOR", so a lesson compiles whole —
    right for its author, wrong for a colleague, because the ruling is about answers and
    a lesson carries `role=answer` and stubbed `role=solution` cells exactly as a quiz
    does. The same defect in a different costume, and it survives a fix aimed only at the
    `?build=solution` parameter.
    """
    notebook = _notebook_row(slug="l", owner_user_id=uuid_module.uuid4())
    spec = {
        "schema_version": 1,
        "slug": "l",
        "title": "A graded lesson",
        "kind": "lesson",
        "cells": [
            {"id": "c01", "kind": "markdown", "role": "objective", "source": "## Lesson"},
            {
                "id": "c02",
                "kind": "code",
                "role": "solution",
                "source": "worked = 42",
                "stub": "worked = None\n",
            },
            {"id": "c03", "kind": "markdown", "role": "answer", "source": "It is Hadamard."},
            {"id": "c04", "kind": "markdown", "role": "summary", "source": "Done."},
        ],
    }
    version = _version_row(notebook_id=notebook.id, seq=1, status="ready", ipynb=None, spec=spec)

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, _seq):
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb")

    assert response.status_code == 200
    assert "worked = 42" not in response.text
    assert "It is Hadamard" not in response.text
    # The control: the cell is still THERE as a slot to type in, not silently deleted.
    assert "worked = None" in response.text


# ---------------------------------------- a downstream cell can leak the answer too (PR 959)

_LEAKY_LESSON_SPEC = {
    "schema_version": 1,
    "slug": "l",
    "title": "A graded lesson",
    "kind": "lesson",
    "cells": [
        {"id": "obj", "kind": "markdown", "role": "objective", "source": "## Lesson"},
        {"id": "pre", "kind": "code", "role": "setup", "source": "print('setup')"},
        {
            "id": "solution",
            "kind": "code",
            "role": "solution",
            "source": "worked = 42",
            "stub": "worked = None\n",
        },
        # This cell's own SOURCE never changes between builds — it prints whatever
        # `worked` was bound to, and in the answer-key run that was the real solution's
        # value. `checkpoint` is downstream of `solution`, not itself redacted.
        {"id": "checkpoint", "kind": "code", "role": "checkpoint", "source": "print(worked)"},
        {"id": "summary", "kind": "markdown", "role": "summary", "source": "Done."},
    ],
}


def _leaky_lesson_report() -> dict:
    from leona_notebooks.execution import CellResult, ExecutionReport

    report = ExecutionReport(
        notebook_slug="l",
        ok=True,
        runner="sandbox",
        cells=[
            CellResult(id="pre", status="ok", stdout="setup\n"),
            CellResult(id="solution", status="ok", stdout="42\n"),
            CellResult(id="checkpoint", status="ok", stdout="42\n"),
        ],
    )
    return report.model_dump(mode="json")


def _wire_leaky_lesson(monkeypatch, notebook):
    version = _version_row(
        notebook_id=notebook.id,
        seq=1,
        status="ready",
        ipynb=None,
        spec=_LEAKY_LESSON_SPEC,
        report=_leaky_lesson_report(),
    )

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_get_version_by_seq(_scope, _session, _notebook_id, _seq):
        return version

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "get_version_by_seq", fake_get_version_by_seq)
    return version


async def test_a_non_author_never_sees_a_downstream_cells_output_either(client, monkeypatch):
    """Greptile's P1 on PR 959, confirmed here first (this test failed against the
    unfixed `to_ipynb` before the fix landed, proving the leak was real on THIS route,
    not only in the course zip it was originally reported against).

    `to_ipynb` used to drop only the output of the cell whose SOURCE it replaced — the
    stub itself. `checkpoint` below is unchanged text (`print(worked)`), but it ran in
    the same kernel as the hidden `solution` cell and printed the value that cell
    produced: `42`, the answer. Owner ruling ai-ops 260, option 1 — only the author may
    see it, and this cell's stdout handed it to any other workspace member who clicked
    export.
    """
    notebook = _notebook_row(slug="l", owner_user_id=uuid_module.uuid4())
    _wire_leaky_lesson(monkeypatch, notebook)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb")

    assert response.status_code == 200
    body = response.json()
    by_id = {cell["id"]: cell for cell in body["cells"]}
    # The control: a cell before the redacted one keeps its output, so the assertions
    # below are about redaction and not about a route that dropped every output.
    assert by_id["pre"]["outputs"], "a cell before the redacted one must keep its output"
    assert by_id["solution"]["outputs"] == [], "the redacted cell itself carries no output"
    assert by_id["checkpoint"]["outputs"] == [], "a cell AFTER it must not leak the answer either"
    assert "42" not in json_module.dumps(body)


async def test_the_author_still_sees_every_cells_output(client, scope_identity, monkeypatch):
    """The positive control: the fix must not have turned into "drop every output"."""
    scope, _identity = scope_identity
    notebook = _notebook_row(slug="l", owner_user_id=scope.user_id)
    _wire_leaky_lesson(monkeypatch, notebook)

    async with client as c:
        # A lesson's default build for its own author is "full" (`build_for_kind`), so
        # no query parameter is needed to see everything.
        response = await c.get(f"/v1/notebooks/{notebook.id}/versions/1/export.ipynb")

    assert response.status_code == 200
    body = response.json()
    by_id = {cell["id"]: cell for cell in body["cells"]}
    assert by_id["pre"]["outputs"]
    assert by_id["solution"]["outputs"], "the author's own solution output must survive"
    assert by_id["checkpoint"]["outputs"], "and everything downstream of it too"
    assert "42" in json_module.dumps(body)


# ------------------------------------------------ a learner's score is kept (ai-ops 260)


def _wire_grades(monkeypatch, notebook, found):
    async def fake_get_notebook(_scope, _session, _notebook_id):
        return notebook

    async def fake_latest(_scope, _session, _notebook_id):
        return found

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "latest_grades_for_reader", fake_latest)


def _grades_payload(version, **overrides):
    payload = {
        "version_id": str(version.id),
        "grades": {"notebook_slug": "n", "cells": []},
        "passed": 4,
        "failed": 1,
        "attempted": 5,
        "note": "",
    }
    payload.update(overrides)
    return payload


async def test_a_reader_gets_their_last_score_back(client, monkeypatch):
    """Owner ruling ai-ops 260, option 1 — the score survives closing the tab.

    It always could have: grading writes `notebook.grades` to `run_events` and
    `RepoEventSink` validates it before persisting. Nothing ever read it back, so the
    score existed in the database and not in the product.
    """
    notebook = _notebook_row(slug="n")
    version = _version_row(notebook_id=notebook.id, seq=3, status="ready")
    notebook.current_version_id = version.id
    _wire_grades(monkeypatch, notebook, (version, _grades_payload(version)))

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/grades")

    assert response.status_code == 200
    body = response.json()
    assert (body["passed"], body["failed"], body["attempted"]) == (4, 1, 5)
    assert body["version_seq"] == 3
    assert body["stale"] is False


async def test_a_score_earned_on_an_older_version_comes_back_marked_stale(client, monkeypatch):
    """Returned, not dropped — but a client must be able to say which version it is for.

    Rendering an old pass against rewritten cells silently is the failure this prevents:
    the reader believes they have already done work the current version now asks for.
    """
    notebook = _notebook_row(slug="n")
    graded = _version_row(notebook_id=notebook.id, seq=1, status="ready")
    notebook.current_version_id = uuid_module.uuid4()  # a later version is current
    _wire_grades(monkeypatch, notebook, (graded, _grades_payload(graded)))

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/grades")

    assert response.status_code == 200
    assert response.json()["stale"] is True


async def test_a_reader_with_no_attempt_gets_null_rather_than_an_invented_zero(client, monkeypatch):
    """`null`, not `0 of 0`.

    A zero score is a claim that the reader tried and got nothing right. "Has not tried"
    and "tried and got nothing right" are different facts about a learner, and a client
    that cannot tell them apart greets a first-time reader with a failed scorecard.
    """
    notebook = _notebook_row(slug="n")
    _wire_grades(monkeypatch, notebook, None)

    async with client as c:
        response = await c.get(f"/v1/notebooks/{notebook.id}/grades")

    assert response.status_code == 200
    assert response.json() is None


# -------------------------------------------------------------------------- import


async def test_import_creates_a_ready_version(client, monkeypatch):
    ipynb = {
        "cells": [{"cell_type": "markdown", "metadata": {}, "source": "# Hello notebook\n"}],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    created: dict = {}

    async def fake_create_notebook(_scope, _session, **kwargs):
        created["create_kwargs"] = kwargs
        notebook = _notebook_row(slug=kwargs["slug"], title=kwargs["title"], kind=kwargs["kind"])
        version = _version_row(
            notebook_id=notebook.id, seq=1, status="queued", created_by=kwargs["created_by"]
        )
        created["notebook"] = notebook
        created["version"] = version
        return notebook, version

    async def fake_set_version_result(_scope, _session, _version_id, **kwargs):
        created["result_kwargs"] = kwargs
        version = created["version"]
        version.status = kwargs["status"]
        version.spec = kwargs["spec"]
        version.ipynb = kwargs["ipynb"]
        version.source = kwargs["source"]
        created["notebook"].current_version_id = version.id
        return version

    async def fake_list_versions(_scope, _session, _notebook_id):
        return [created["version"]]

    monkeypatch.setattr(notebooks_repo, "create_notebook", fake_create_notebook)
    monkeypatch.setattr(notebooks_repo, "set_version_result", fake_set_version_result)
    monkeypatch.setattr(notebooks_repo, "list_versions", fake_list_versions)

    async with client as c:
        response = await c.post("/v1/notebooks/import", json={"ipynb": ipynb, "execute": False})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["run_id"] is None
    assert body["version"]["status"] == "ready"
    assert created["create_kwargs"]["created_by"] == "user"
    assert created["create_kwargs"]["run_id"] is None
    assert created["result_kwargs"]["status"] == "ready"
    assert created["result_kwargs"]["ipynb"] == ipynb
    # from_ipynb read the title from the first markdown heading.
    assert created["create_kwargs"]["title"] == "Hello notebook"


async def test_import_with_execute_enqueues_a_rerun_job(client, monkeypatch):
    ipynb = {
        "cells": [{"cell_type": "markdown", "metadata": {}, "source": "# Hello again\n"}],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    state: dict = {}

    async def fake_create_notebook(_scope, _session, **kwargs):
        notebook = _notebook_row(slug=kwargs["slug"], title=kwargs["title"], kind=kwargs["kind"])
        version = _version_row(notebook_id=notebook.id, seq=1, created_by=kwargs["created_by"])
        state["notebook"] = notebook
        state["v1"] = version
        return notebook, version

    async def fake_set_version_result(_scope, _session, version_id, **kwargs):
        v1 = state["v1"]
        v1.status = kwargs["status"]
        v1.spec = kwargs["spec"]
        state["notebook"].current_version_id = v1.id
        return v1

    async def fake_create_run(_scope, _session, **_kwargs):
        return SimpleNamespace(id=uuid_module.uuid4())

    async def fake_append_run_event(*_a, **_k):
        return None

    async def fake_create_version(_scope, _session, _notebook_id, **kwargs):
        v2 = _version_row(notebook_id=state["notebook"].id, seq=2, created_by=kwargs["created_by"])
        state["v2"] = v2
        return v2

    captured_job: dict = {}

    async def fake_enqueue_job(_session, *, kind, payload, run_id=None, **_kwargs):
        captured_job["kind"] = kind
        captured_job["payload"] = payload
        return SimpleNamespace(id=uuid_module.uuid4())

    async def fake_list_versions(_scope, _session, _notebook_id):
        return [state["v1"], state.get("v2", state["v1"])]

    monkeypatch.setattr(notebooks_repo, "create_notebook", fake_create_notebook)
    monkeypatch.setattr(notebooks_repo, "set_version_result", fake_set_version_result)
    monkeypatch.setattr(notebooks_repo, "create_version", fake_create_version)
    monkeypatch.setattr(notebooks_repo, "list_versions", fake_list_versions)
    monkeypatch.setattr(runs_repo, "create_run", fake_create_run)
    monkeypatch.setattr(runs_repo, "append_run_event", fake_append_run_event)
    monkeypatch.setattr(system_repo, "enqueue_job", fake_enqueue_job)

    async with client as c:
        response = await c.post("/v1/notebooks/import", json={"ipynb": ipynb, "execute": True})

    assert response.status_code == 201, response.text
    assert response.json()["run_id"] is not None
    assert captured_job["kind"] == NOTEBOOK_REVISE_JOB_KIND
    assert captured_job["payload"]["kind"] == "rerun"


# ------------------------------------------------------------------------ templates


async def test_templates_returns_every_notebook_kind(client):
    async with client as c:
        response = await c.get("/v1/notebook-templates")

    assert response.status_code == 200
    body = response.json()
    kind_ids = {k["id"] for k in body["kinds"]}
    assert kind_ids == {k.value for k in NotebookKind}
    assert len(body["starters"]) > 0
    for starter in body["starters"]:
        assert starter["kind"] in kind_ids


# -------------------------------------------------------------- author (the editor)

SPEC_FIXTURE = {
    "schema_version": 1,
    "slug": "ignored-the-notebooks-own-slug-wins",
    "title": "Edited by the reader",
    "kind": "lesson",
    "cells": [
        {"id": "c01", "kind": "markdown", "role": "objective", "source": "# Hi"},
        {"id": "c02", "kind": "code", "role": "run", "source": "print('one')"},
        {"id": "c03", "kind": "code", "role": "run", "source": "print('two')"},
    ],
}

SOURCE_FIXTURE = "# ---\n# title: From a text editor\n# ---\n# %% id=c01\nprint('one')\n"


@pytest.fixture
def author_state(monkeypatch):
    """A ready notebook with one version, plus recording fakes for everything the
    author route writes. Returns the dict the assertions read."""
    notebook = _notebook_row()
    v1 = _version_row(notebook_id=notebook.id, seq=1, status="ready", created_by="nala")
    notebook.current_version_id = v1.id
    state: dict = {"notebook": notebook, "versions": [v1], "jobs": [], "runs": []}

    async def fake_get_notebook(_scope, _session, _notebook_id):
        return state["notebook"]

    async def fake_list_versions(_scope, _session, _notebook_id):
        return state["versions"]

    async def fake_create_version(_scope, _session, _notebook_id, **kwargs):
        version = _version_row(
            notebook_id=state["notebook"].id,
            seq=len(state["versions"]) + 1,
            created_by=kwargs["created_by"],
            message=kwargs["message"],
            request=kwargs["request"],
            run_id=kwargs["run_id"],
        )
        state["create_version_kwargs"] = kwargs
        state["versions"].append(version)
        return version

    async def fake_set_version_result(_scope, _session, version_id, **kwargs):
        version = next(v for v in state["versions"] if v.id == version_id)
        state["result_kwargs"] = kwargs
        version.status = kwargs["status"]
        version.spec = kwargs["spec"]
        version.source = kwargs["source"]
        version.ipynb = kwargs["ipynb"]
        version.review = kwargs["review"]
        return version

    async def fake_create_run(_scope, _session, **kwargs):
        run = SimpleNamespace(id=uuid_module.uuid4())
        state["runs"].append(kwargs)
        return run

    async def fake_append_run_event(*_a, **_k):
        return None

    async def fake_enqueue_job(_session, *, kind, payload, run_id=None, **_kwargs):
        state["jobs"].append({"kind": kind, "payload": payload})
        return SimpleNamespace(id=uuid_module.uuid4())

    monkeypatch.setattr(notebooks_repo, "get_notebook", fake_get_notebook)
    monkeypatch.setattr(notebooks_repo, "list_versions", fake_list_versions)
    monkeypatch.setattr(notebooks_repo, "create_version", fake_create_version)
    monkeypatch.setattr(notebooks_repo, "set_version_result", fake_set_version_result)
    monkeypatch.setattr(runs_repo, "create_run", fake_create_run)
    monkeypatch.setattr(runs_repo, "append_run_event", fake_append_run_event)
    monkeypatch.setattr(system_repo, "enqueue_job", fake_enqueue_job)
    return state


async def test_author_from_a_spec_enqueues_an_author_job_carrying_the_spec(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"spec": SPEC_FIXTURE, "message": "moved a cell"},
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["run_id"] is not None
    assert body["version"]["created_by"] == "user"
    assert body["version"]["message"] == "moved a cell"

    job = author_state["jobs"][0]
    assert job["kind"] == NOTEBOOK_REVISE_JOB_KIND
    assert job["payload"]["kind"] == "author"
    assert job["payload"]["run_until"] is None
    # The resolved spec travels, not the raw input — and the notebook's own slug wins
    # over whatever the submitted spec claimed.
    assert job["payload"]["request"]["spec"]["slug"] == author_state["notebook"].slug
    assert [cell["id"] for cell in job["payload"]["request"]["spec"]["cells"]] == [
        "c01",
        "c02",
        "c03",
    ]


async def test_author_from_source_parses_before_queueing(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"source": SOURCE_FIXTURE},
        )

    assert response.status_code == 201, response.text
    spec = author_state["jobs"][0]["payload"]["request"]["spec"]
    assert spec["title"] == "From a text editor"
    assert spec["cells"][0]["source"].strip() == "print('one')"


async def test_author_from_ipynb_parses_before_queueing(client, author_state):
    ipynb = {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": "# Pushed from Jupyter\n"},
            {
                "cell_type": "code",
                "metadata": {},
                "source": "print('hi')\n",
                "outputs": [],
                "execution_count": None,
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"ipynb": ipynb, "message": "from jupyter"},
        )

    assert response.status_code == 201, response.text
    spec = author_state["jobs"][0]["payload"]["request"]["spec"]
    assert any(cell["source"].strip() == "print('hi')" for cell in spec["cells"])


async def test_author_with_run_until_passes_the_cell_id_to_the_job(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"spec": SPEC_FIXTURE, "run_until": "c02"},
        )

    assert response.status_code == 201, response.text
    assert author_state["jobs"][0]["payload"]["run_until"] == "c02"


async def test_author_with_an_unknown_run_until_is_400_and_queues_nothing(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"spec": SPEC_FIXTURE, "run_until": "c99"},
        )

    assert response.status_code == 400, response.text
    assert response.json()["reason"] == "notebook_unknown_cell"
    assert author_state["jobs"] == []


async def test_author_with_two_inputs_is_400(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"spec": SPEC_FIXTURE, "source": SOURCE_FIXTURE},
        )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["reason"] == "notebook_authoring_input"
    assert "spec, source" in body["title"]
    assert author_state["jobs"] == []


async def test_author_with_no_input_is_400(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions", json={"message": "nothing"}
        )

    assert response.status_code == 400, response.text
    assert response.json()["reason"] == "notebook_authoring_input"


async def test_author_with_unparseable_source_is_400_carrying_the_parse_error(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"source": "# %% role=not-a-role\nx = 1\n"},
        )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["reason"] == "notebook_authoring_input"
    # The parser's own complaint reaches the reader — not a generic sentence. `title`
    # is the field the web renders to a person (`app.py`'s HTTPException handler).
    assert body["title"] != "could not read this notebook source: "
    assert "could not read this notebook source" in body["title"]
    assert author_state["jobs"] == []


async def test_author_without_execute_saves_a_ready_version_and_queues_no_job(client, author_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions",
            json={"spec": SPEC_FIXTURE, "execute": False, "message": "draft"},
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["run_id"] is None
    assert body["version"]["status"] == "ready"
    assert author_state["jobs"] == []
    assert author_state["runs"] == []
    result = author_state["result_kwargs"]
    assert result["status"] == "ready"
    assert result["report"] is None
    assert result["source"].startswith("# ---")
    assert result["ipynb"]["nbformat"] == 4
    # A structure-incomplete edit is saved anyway, with the failures as warnings.
    assert result["review"] is not None
    assert result["review"]["warnings"]
    assert result["review"]["verdict"] == "needs-attention"


async def test_author_while_a_version_is_in_flight_is_409(client, author_state):
    author_state["versions"].append(
        _version_row(notebook_id=author_state["notebook"].id, seq=2, status="running")
    )
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/versions", json={"spec": SPEC_FIXTURE}
        )

    assert response.status_code == 409, response.text
    assert author_state["jobs"] == []


# ------------------------------------------------------------------- grading an attempt

GRADED_SPEC_FIXTURE = {
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


@pytest.fixture
def graded_state(author_state):
    """`author_state`'s plumbing, with the current version holding a graded cell."""
    author_state["versions"][0].spec = GRADED_SPEC_FIXTURE
    return author_state


async def test_an_attempt_enqueues_a_grade_job_carrying_only_the_readers_work(client, graded_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "def double(x):\n    return x + x"}, "answers": {}},
        )

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["run_id"] is not None
    assert body["graded_cells"] == 1

    job = graded_state["jobs"][0]
    assert job["kind"] == NOTEBOOK_GRADE_JOB_KIND
    assert job["payload"]["attempt"]["code"] == {"ex1": "def double(x):\n    return x + x"}
    # The assertion stays on the server. A job payload carrying the check would put the
    # answer one queue-row away from the thing it is hidden from.
    assert "check" not in str(job["payload"])
    # An attempt is not an edit: no version is created for it.
    assert len(graded_state["versions"]) == 1


async def test_an_attempt_costs_a_run_the_same_way_a_rerun_does(client, graded_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "x = 1"}, "answers": {}},
        )

    assert response.status_code == 202, response.text
    # Grading executes the reader's code in the sandbox, so it goes through the same
    # run row, mode and framework a re-run does — an attempt must not be a way to buy
    # sandbox time outside the quota.
    assert len(graded_state["runs"]) == 1
    assert str(graded_state["runs"][0]["mode"]) == "notebook"


async def test_a_notebook_with_no_graded_cell_refuses_rather_than_queueing_nothing(
    client, author_state
):
    """A 202 here would hand back a run id for verdicts that are never coming."""
    author_state["versions"][0].spec = SPEC_FIXTURE
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{author_state['notebook'].id}/attempts", json={"code": {}}
        )

    assert response.status_code == 409, response.text
    assert response.json()["reason"] == "notebook_not_graded"
    assert author_state["jobs"] == []


async def test_an_attempt_naming_a_cell_the_version_does_not_have_is_refused(client, graded_state):
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "ok", "not-a-cell": "x = 1"}},
        )

    assert response.status_code == 422, response.text
    assert response.json()["reason"] == "unknown_cell"
    assert graded_state["jobs"] == []


async def test_an_oversized_cell_body_is_refused_by_the_contract(client, graded_state):
    """The per-cell size bound, isolated: `ex1` is a real cell of this version, so a
    422 here can only be the length rule.

    The cell-COUNT bound is deliberately not tested through this route. Sixty-five
    made-up ids are also sixty-five ids the version does not have, so the route's
    `unknown_cell` check answers 422 first and the assertion passes whether or not
    the count bound exists at all — a control answered by a different rule than the
    one under test. It is tested against the model itself instead, in
    `packages/py/contracts/tests`."""
    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "x" * 32_001}},
        )

    assert response.status_code == 422, response.text
    assert graded_state["jobs"] == []


async def test_a_retried_attempt_under_one_key_costs_one_run(client, graded_state, monkeypatch):
    """A dropped 202 is the ordinary case — the run is queued and the client never
    learned its id. Without a key the retry buys a second sandbox run and starts a
    competing grading stream against the same cell."""
    seen: dict[str, SimpleNamespace] = {}

    async def fake_find(_scope, _session, key):
        return seen.get(key)

    original_create = runs_repo.create_run

    async def fake_create(_scope, _session, **kwargs):
        run = await original_create(_scope, _session, **kwargs)
        if kwargs.get("idempotency_key"):
            run.idempotency_key = kwargs["idempotency_key"]
            run.idempotency_request_hash = kwargs.get("idempotency_request_hash")
            seen[kwargs["idempotency_key"]] = run
        return run

    monkeypatch.setattr(runs_repo, "find_run_by_idempotency_key", fake_find)
    monkeypatch.setattr(runs_repo, "create_run", fake_create)

    body = {"code": {"ex1": "def double(x):\n    return x + x"}, "answers": {}}
    async with client as c:
        first = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json=body,
            headers={"Idempotency-Key": "k-1"},
        )
        second = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json=body,
            headers={"Idempotency-Key": "k-1"},
        )

    assert first.status_code == 202 and second.status_code == 202, second.text
    assert first.json()["run_id"] == second.json()["run_id"]
    # One run, one job. The replay must not reach the queue at all.
    assert len(graded_state["runs"]) == 1
    assert len(graded_state["jobs"]) == 1


async def test_reusing_a_key_for_a_DIFFERENT_attempt_is_refused(client, graded_state, monkeypatch):
    """The other arm, and the one that matters: returning the stored run for a
    different body hands the reader a verdict on code they did not submit."""
    seen: dict[str, SimpleNamespace] = {}

    async def fake_find(_scope, _session, key):
        return seen.get(key)

    original_create = runs_repo.create_run

    async def fake_create(_scope, _session, **kwargs):
        run = await original_create(_scope, _session, **kwargs)
        if kwargs.get("idempotency_key"):
            run.idempotency_key = kwargs["idempotency_key"]
            run.idempotency_request_hash = kwargs.get("idempotency_request_hash")
            seen[kwargs["idempotency_key"]] = run
        return run

    monkeypatch.setattr(runs_repo, "find_run_by_idempotency_key", fake_find)
    monkeypatch.setattr(runs_repo, "create_run", fake_create)

    async with client as c:
        await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "first answer"}},
            headers={"Idempotency-Key": "k-2"},
        )
        clash = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "a completely different answer"}},
            headers={"Idempotency-Key": "k-2"},
        )

    assert clash.status_code == 409, clash.text
    assert len(graded_state["jobs"]) == 1


async def test_a_concurrent_retry_is_409_not_500(client, graded_state, monkeypatch):
    """Two retries can both pass the replay lookup before either run is committed. The
    loser must be told to retry, not told grading failed for an attempt that is
    running — a 500 here is the worst of the three possible answers."""

    async def fake_find(_scope, _session, _key):
        return None

    async def racing_create(*_a, **_k):
        raise runs_repo.IdempotencyKeyInFlight()

    monkeypatch.setattr(runs_repo, "find_run_by_idempotency_key", fake_find)
    monkeypatch.setattr(runs_repo, "create_run", racing_create)

    async with client as c:
        response = await c.post(
            f"/v1/notebooks/{graded_state['notebook'].id}/attempts",
            json={"code": {"ex1": "x = 1"}},
            headers={"Idempotency-Key": "k-race"},
        )

    assert response.status_code == 409, response.text
    assert response.json()["reason"] == "idempotency_key_in_flight"
    assert graded_state["jobs"] == []
