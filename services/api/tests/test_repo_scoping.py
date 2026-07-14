"""Every repository function must bind scope.workspace_id into its statement
(02-architecture.md §4). Statement-level check, DB-free; the live cross-workspace
probes land with the step-4 authz suite."""

import uuid

import pytest
from repo_test_helpers import compiled
from majorana_contracts.enums import RunMode, UsageKind, VerificationMethod

from majorana_api.repos import NotFoundError, artifacts, audit, folders, runs, usage, workspaces


def assert_workspace_bound(stmt, scope):
    sql, params = compiled(stmt)
    assert "workspace_id" in sql
    assert scope.workspace_id in params.values(), f"scope not bound in: {sql}"


async def test_get_workspace(scope, session):
    with pytest.raises(NotFoundError):
        await workspaces.get_workspace(scope, session)
    # workspaces scope by their own id column
    sql, params = compiled(session.statements[0])
    assert "workspaces.id" in sql
    assert scope.workspace_id in params.values()


async def test_list_members(scope, session):
    await workspaces.list_members(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_list_artifacts(scope, session):
    await artifacts.list_artifacts(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_get_artifact(scope, session):
    with pytest.raises(NotFoundError):
        await artifacts.get_artifact(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_get_version_joins_artifact(scope, session):
    with pytest.raises(NotFoundError):
        await artifacts.get_version(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN artifacts" in sql
    assert_workspace_bound(stmt, scope)


async def test_set_visibility_scoped_update(scope, session):
    admin = scope.model_copy(update={"role": "admin"})
    with pytest.raises(NotFoundError):  # rowcount 0 == outside scope or absent
        await artifacts.set_visibility(admin, session, uuid.uuid4(), "public")
    assert_workspace_bound(session.statements[0], admin)


async def test_soft_delete_scoped_update(scope, session):
    admin = scope.model_copy(update={"role": "admin"})
    with pytest.raises(NotFoundError):
        await artifacts.soft_delete_artifact(admin, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], admin)


async def test_get_run(scope, session):
    with pytest.raises(NotFoundError):
        await runs.get_run(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_list_runs(scope, session):
    await runs.list_runs(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_list_folders(scope, session):
    await folders.list_folders(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_get_folder(scope, session):
    with pytest.raises(NotFoundError):
        await folders.get_folder(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_update_run_status(scope, session):
    with pytest.raises(NotFoundError):
        await runs.update_run_status(scope, session, uuid.uuid4(), "running")
    assert_workspace_bound(session.statements[0], scope)


async def test_append_run_event_checks_run_scope(scope, session):
    with pytest.raises(NotFoundError):  # parent run resolved under scope first
        await runs.append_run_event(scope, session, uuid.uuid4(), type="run.started", payload={})
    assert_workspace_bound(session.statements[0], scope)


async def test_list_run_events_joins_runs(scope, session):
    await runs.list_run_events(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN runs" in sql
    assert_workspace_bound(stmt, scope)


async def test_list_verification_records_joins_runs(scope, session):
    await runs.list_verification_records(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN runs" in sql
    assert_workspace_bound(stmt, scope)


async def test_sum_usage(scope, session):
    import datetime as dt

    await usage.sum_usage(
        scope, session, kind=UsageKind.RUN, since=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    )
    assert_workspace_bound(session.statements[0], scope)


async def test_list_audit(scope, session):
    admin = scope.model_copy(update={"role": "admin"})
    await audit.list_audit(admin, session)
    assert_workspace_bound(session.statements[0], admin)


async def test_created_rows_carry_scope_workspace(scope, session):
    artifact = await artifacts.create_artifact(
        scope, session, slug="s", title="t", family="VQE", framework="qiskit"
    )
    assert artifact.workspace_id == scope.workspace_id

    run = await runs.create_run(
        scope, session, task_prompt="p", mode=RunMode.EXECUTE, framework="qiskit"
    )
    assert run.workspace_id == scope.workspace_id
    assert run.user_id == scope.user_id

    folder = await folders.create_folder(scope, session, name="  shared   work  ")
    assert folder.workspace_id == scope.workspace_id
    assert folder.name == "shared work"

    event = await usage.record_usage(scope, session, kind=UsageKind.RUN, quantity=1)
    assert event.workspace_id == scope.workspace_id

    row = await audit.record_audit(scope, session, action="test")
    assert row.workspace_id == scope.workspace_id
    assert row.actor_user_id == scope.user_id


async def test_verification_record_requires_in_scope_run(scope, session):
    with pytest.raises(NotFoundError):
        await runs.add_verification_record(
            scope, session, uuid.uuid4(), method=VerificationMethod.EXACT, result="pass"
        )
    assert_workspace_bound(session.statements[0], scope)
