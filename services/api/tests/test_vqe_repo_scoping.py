"""Every VQE registry repo function must bind scope.workspace_id into its
statement (02-architecture.md §4) -- statement-level check, DB-free, mirrors
test_repo_scoping.py. Create-path functions that first resolve a referenced
ArtifactVersion/Experiment through the scoped repo fail closed with
NotFoundError against RecordingSession's always-empty result, which also
proves the existence check happens before any row is added."""

import uuid

import pytest
from repo_test_helpers import compiled

from majorana_api.repos import NotFoundError, vqe


def assert_workspace_bound(stmt, scope):
    sql, params = compiled(stmt)
    assert "workspace_id" in sql
    assert scope.workspace_id in params.values(), f"scope not bound in: {sql}"


async def test_get_component_spec_joins_through_artifact(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.get_component_spec(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN artifacts" in sql or "JOIN public.artifacts" in sql
    assert_workspace_bound(stmt, scope)


async def test_list_component_specs_is_workspace_bound(scope, session):
    result = await vqe.list_component_specs(scope, session)
    assert result == []
    assert_workspace_bound(session.statements[0], scope)


async def test_create_component_spec_checks_artifact_version_first(scope, session):
    from majorana_vqe.models import ComponentType

    with pytest.raises(NotFoundError):
        await vqe.create_component_spec(
            scope,
            session,
            artifact_version_id=uuid.uuid4(),
            schema_version="0.1.0",
            component_type=ComponentType.ANSATZ,
        )
    # get_version's scoped select ran; nothing was added to the session.
    assert_workspace_bound(session.statements[0], scope)
    assert session.added == []


async def test_list_workflow_components_checks_workflow_first(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.list_workflow_components(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_create_workflow_component_checks_both_versions_first(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.create_workflow_component(
            scope,
            session,
            workflow_artifact_version_id=uuid.uuid4(),
            component_role="ansatz",
            component_artifact_version_id=uuid.uuid4(),
            ordinal=0,
        )
    assert_workspace_bound(session.statements[0], scope)
    assert session.added == []


async def test_get_experiment_is_workspace_bound(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.get_experiment(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_list_experiments_is_workspace_bound(scope, session):
    result = await vqe.list_experiments(scope, session)
    assert result == []
    assert_workspace_bound(session.statements[0], scope)


async def test_find_experiment_by_request_idempotency_key_is_workspace_bound(scope, session):
    result = await vqe.find_experiment_by_request_idempotency_key(scope, session, "some-key")
    assert result is None
    assert_workspace_bound(session.statements[0], scope)


async def test_create_experiment_checks_workflow_version_first(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=uuid.uuid4(),
            resolved=object(),
        )
    assert_workspace_bound(session.statements[0], scope)
    assert session.added == []


async def test_list_observations_checks_experiment_first(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.list_observations(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_append_observation_checks_experiment_first(scope, session):
    with pytest.raises(NotFoundError):
        await vqe.append_observation(
            scope,
            session,
            uuid.uuid4(),
            attempt=1,
            evidence={},
        )
    assert_workspace_bound(session.statements[0], scope)
    assert session.added == []
