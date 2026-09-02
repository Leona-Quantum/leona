"""repos/notebooks.py: scoping, immutability of the create path, and the
`to_resource`/`version_to_resource` projections. DB-free — `RecordingSession`
records every statement issued so the workspace predicate can be asserted
without a database; `test_notebook_routes.py` exercises the routes over ASGI.
"""

import datetime as dt
import uuid

import pytest
from majorana_contracts.enums import Role
from repo_test_helpers import RecordingSession, compiled, make_scope

from majorana_api.orm import Notebook as NotebookRow
from majorana_api.orm import NotebookVersion as NotebookVersionRow
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos._base import AuthzError, NotFoundError

NOW = dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc)


def _notebook_row(**overrides) -> NotebookRow:
    base = dict(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        slug="my-notebook-abcd1234",
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
        id=uuid.uuid4(),
        notebook_id=uuid.uuid4(),
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


# ------------------------------------------------------------------- create_notebook


async def test_create_notebook_seeds_a_queued_nala_first_version():
    session = RecordingSession()
    scope = make_scope()
    run_id = uuid.uuid4()

    notebook, version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug="bell-state-ab12cd34",
        title="Bell state",
        kind="lesson",
        summary="",
        language="en",
        framework={"name": "qiskit"},
        request={"brief": "teach me a bell state"},
        run_id=run_id,
    )

    assert notebook.workspace_id == scope.workspace_id
    assert notebook.owner_user_id == scope.user_id
    assert version.notebook_id == notebook.id
    assert version.seq == 1
    assert version.status == "queued"
    assert version.created_by == "nala"
    assert version.run_id == run_id
    # notebook, version, and the audit row
    assert len(session.added) == 3


async def test_create_notebook_honours_an_explicit_created_by_and_no_run():
    """The one caller that overrides both: POST /notebooks/import."""
    session = RecordingSession()
    scope = make_scope()

    _notebook, version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug="imported-ab12cd34",
        title="Imported",
        kind="scratch",
        summary="",
        language="en",
        framework={"name": "qiskit"},
        request={"import": True},
        run_id=None,
        created_by="user",
    )

    assert version.created_by == "user"
    assert version.run_id is None


async def test_create_notebook_refuses_a_read_only_role():
    session = RecordingSession()
    scope = make_scope(role=Role.VIEWER)
    with pytest.raises(AuthzError):
        await notebooks_repo.create_notebook(
            scope,
            session,
            slug="x-ab12cd34",
            title="x",
            kind="lesson",
            summary="",
            language="en",
            framework={},
            request={},
            run_id=None,
        )
    assert session.added == []


# ------------------------------------------------------------------------- scoping


async def test_get_notebook_predicate_binds_workspace_and_excludes_deleted():
    session = RecordingSession()
    scope = make_scope()
    with pytest.raises(NotFoundError):
        await notebooks_repo.get_notebook(scope, session, uuid.uuid4())

    assert len(session.statements) == 1
    sql, params = compiled(session.statements[0])
    assert "notebooks.workspace_id" in sql
    assert "notebooks.deleted_at IS NULL" in sql
    assert params["workspace_id_1"] == scope.workspace_id


async def test_list_notebooks_scopes_by_workspace_and_orders_newest_first():
    session = RecordingSession()
    scope = make_scope()

    await notebooks_repo.list_notebooks(scope, session, limit=10)

    sql, params = compiled(session.statements[0])
    assert "notebooks.workspace_id" in sql
    assert "ORDER BY notebooks.id DESC" in sql
    assert params["workspace_id_1"] == scope.workspace_id


async def test_list_notebooks_cursor_narrows_by_id():
    session = RecordingSession()
    scope = make_scope()
    cursor = uuid.uuid4()

    await notebooks_repo.list_notebooks(scope, session, cursor=cursor, limit=10)

    sql, params = compiled(session.statements[0])
    assert "notebooks.id <" in sql
    assert cursor in params.values()


async def test_get_version_joins_through_notebooks_for_its_workspace_check():
    session = RecordingSession()
    scope = make_scope()
    with pytest.raises(NotFoundError):
        await notebooks_repo.get_version(scope, session, uuid.uuid4())

    sql, params = compiled(session.statements[0])
    assert "JOIN notebooks" in sql
    assert "notebooks.workspace_id" in sql
    assert params["workspace_id_1"] == scope.workspace_id


async def test_get_version_by_run_id_scopes_through_notebooks():
    session = RecordingSession()
    scope = make_scope()

    result = await notebooks_repo.get_version_by_run_id(scope, session, uuid.uuid4())

    assert result is None
    sql, _params = compiled(session.statements[0])
    assert "JOIN notebooks" in sql
    assert "notebook_versions.run_id" in sql


async def test_soft_delete_requires_write_role():
    session = RecordingSession()
    scope = make_scope(role=Role.VIEWER)
    with pytest.raises(AuthzError):
        await notebooks_repo.soft_delete_notebook(scope, session, uuid.uuid4())
    # AuthzError fires before any statement is issued.
    assert session.statements == []


# --------------------------------------------------------------------- projections


def test_to_resource_reports_the_latest_versions_status_and_run():
    notebook = _notebook_row()
    latest = _version_row(notebook_id=notebook.id, seq=3, status="running", run_id=uuid.uuid4())

    resource = notebooks_repo.to_resource(notebook, latest)

    assert resource.latest_status.value == "running"
    assert resource.latest_run_id == latest.run_id
    assert resource.version_count == 3
    # The newest version is not the current one (still generating): unknown by
    # design rather than guessed — see `to_resource`'s docstring.
    assert resource.current_version_seq is None


def test_to_resource_fills_current_version_seq_when_latest_is_current():
    notebook = _notebook_row()
    latest = _version_row(notebook_id=notebook.id, seq=1, status="ready")
    notebook.current_version_id = latest.id

    resource = notebooks_repo.to_resource(notebook, latest)

    assert resource.current_version_seq == 1
    assert resource.current_version_id == latest.id


def test_version_to_resource_summary_omits_spec_and_source():
    version = _version_row(
        spec={"cells": [{"id": "c1"}, {"id": "c2"}], "title": "t"},
        report={"ok": True},
        source="# a notebook",
    )

    summary = notebooks_repo.version_to_resource(version, full=False)

    assert summary.cell_count == 2
    assert summary.ok is True
    assert not hasattr(summary, "spec")
    assert not hasattr(summary, "source")


def test_version_to_resource_full_carries_spec_source_and_report():
    version = _version_row(
        spec={
            "schema_version": 1,
            "slug": "s",
            "title": "t",
            "cells": [],
        },
        source="# a notebook",
        report={
            "notebook_slug": "s",
            "ok": True,
            "runner": "sandbox",
            "cells": [],
        },
    )

    full = notebooks_repo.version_to_resource(version, full=True)

    assert full.spec is not None and full.spec.title == "t"
    assert full.source == "# a notebook"
    assert full.report is not None and full.report.ok is True


def test_version_to_resource_without_a_report_or_spec_reports_none_and_zero():
    version = _version_row()

    summary = notebooks_repo.version_to_resource(version, full=False)

    assert summary.cell_count == 0
    assert summary.ok is None
