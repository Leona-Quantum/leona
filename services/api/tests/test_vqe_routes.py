"""DB-free route-handler tests for the Atlas VQE surface.

Mirrors test_qpu_routes.py: handlers are called directly with monkeypatched
repo functions, never through TestClient/HTTP. The most important behaviour
under test here is that candidate execution stays fail-closed and that a
workflow lookup refuses a non-workflow component.
"""

import datetime as dt
import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from majorana_api.repos import vqe as vqe_repo
from majorana_api.routes import vqe as vqe_routes


def _settings():
    return SimpleNamespace(
        catalog_authority=SimpleNamespace(configured=False, workspace_id=None),
        vqe_candidate_execution=False,
    )


def _routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in vqe_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_every_plan_candidate_endpoint_is_reachable_over_http():
    expected = {
        ("/atlas/components", "GET"),
        ("/atlas/components/{artifact_version_id}", "GET"),
        ("/atlas/workflows", "GET"),
        ("/atlas/workflows/swaps", "POST"),
        ("/atlas/workflows/{workflow_artifact_version_id}", "GET"),
        ("/atlas/comparisons/{comparison_id}", "GET"),
        ("/vqe/capabilities", "GET"),
        ("/vqe/experiments", "POST"),
        ("/vqe/experiments/{experiment_id}", "GET"),
        ("/vqe/experiments/{experiment_id}/executions", "GET"),
        ("/vqe/experiments/{experiment_id}/executions", "POST"),
        ("/vqe/executions/{execution_id}", "GET"),
        ("/vqe/experiments/{experiment_id}/cancel", "POST"),
        ("/vqe/experiments/{experiment_id}/events", "GET"),
        ("/vqe/executions/{execution_id}/materialize", "POST"),
    }
    assert expected <= _routes()


def test_every_route_requires_a_scope():
    for handler in (
        vqe_routes.list_components,
        vqe_routes.get_component,
        vqe_routes.list_workflows,
        vqe_routes.create_workflow_swap,
        vqe_routes.get_workflow,
        vqe_routes.get_comparison,
        vqe_routes.vqe_capabilities,
        vqe_routes.create_experiment,
        vqe_routes.get_experiment,
        vqe_routes.list_executions,
        vqe_routes.start_execution,
        vqe_routes.get_execution,
        vqe_routes.cancel_experiment,
        vqe_routes.experiment_events,
        vqe_routes.materialize_execution,
    ):
        assert "scope" in handler.__annotations__


def test_create_experiment_requires_a_request_idempotency_key_with_no_default():
    import inspect

    sig = inspect.signature(vqe_routes.create_experiment)
    assert sig.parameters["request_idempotency_key"].default is inspect.Parameter.empty


async def test_create_workflow_swap_passes_only_bounded_owner_choices(monkeypatch):
    baseline_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    version_id = uuid.uuid4()
    captured = {}

    async def fake_save(scope, session, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            artifact=SimpleNamespace(id=artifact_id),
            version=SimpleNamespace(id=version_id, fingerprint="a" * 64),
            workflow_spec=SimpleNamespace(semantic_key="workflow.instance.test"),
            replayed=False,
        )

    monkeypatch.setattr(vqe_repo, "save_component_swap_workflow_draft", fake_save)
    body = vqe_routes.CreateWorkflowSwapRequest(
        baseline_workflow_artifact_version_id=baseline_id,
        baseline_template_key="workflow.h2.fixed_excitation.v1",
        changed_role="parameter_optimizer",
        candidate_component_semantic_key="optimizer.slsqp.v1",
        candidate_component_spec_sha256="b" * 64,
        configuration={"max_objective_evaluations": "256"},
        evaluator_provider="qiskit",
    )
    result = await vqe_routes.create_workflow_swap(
        body,
        scope=object(),
        session=object(),
        settings=_settings(),
        request_idempotency_key="request-1",
    )
    assert result.workflow_artifact_version_id == version_id
    assert captured["candidate_component_semantic_key"] == "optimizer.slsqp.v1"
    assert "runtime_profile_id" not in captured
    assert "package_version" not in captured


async def test_capabilities_reports_the_h2_capability_as_unavailable():
    response = await vqe_routes.vqe_capabilities(scope=object())
    assert {status.capability for status in response.capabilities} == {
        "h2_sto3g_exact_energy",
        "h2_sto3g_actual_vqe_v1",
    }
    assert all(status.available is False for status in response.capabilities)
    assert all(status.reason for status in response.capabilities)


async def test_get_component_converts_the_row(monkeypatch):
    row = SimpleNamespace(
        artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        component_type="ansatz",
        semantic_key="ansatz.h2",
        spec_json={"k": "v"},
        normalized_spec_sha256="a" * 64,
        machine_validation_state="machine_validated",
        review_state="human_reviewed",
        created_at=dt.datetime.now(dt.UTC),
    )

    async def fake_get_component_spec(scope, session, artifact_version_id, **kwargs):
        return row

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    result = await vqe_routes.get_component(
        row.artifact_version_id,
        scope=object(),
        session=object(),
        settings=_settings(),
    )
    assert result.artifact_version_id == row.artifact_version_id
    assert result.component_type == "ansatz"
    assert result.spec_json == {"k": "v"}


async def test_get_workflow_rejects_a_non_workflow_component(monkeypatch):
    row = SimpleNamespace(
        artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        component_type="ansatz",  # not "workflow"
        semantic_key="ansatz.h2",
        spec_json={},
        normalized_spec_sha256="a" * 64,
        machine_validation_state="machine_validated",
        review_state="human_reviewed",
        created_at=None,
    )

    async def fake_get_component_spec(scope, session, artifact_version_id, **kwargs):
        return row

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.get_workflow(
            row.artifact_version_id,
            scope=object(),
            session=object(),
            settings=_settings(),
        )
    assert excinfo.value.status_code == 404


async def test_get_workflow_returns_its_components(monkeypatch):
    workflow_id = uuid.uuid4()
    spec_row = SimpleNamespace(
        artifact_version_id=workflow_id,
        schema_version="0.1.0",
        component_type="workflow",
        semantic_key="workflow.h2",
        spec_json={},
        normalized_spec_sha256="a" * 64,
        machine_validation_state="machine_validated",
        review_state="human_reviewed",
        created_at=None,
    )
    component_row = SimpleNamespace(
        id=uuid.uuid4(),
        workflow_artifact_version_id=workflow_id,
        component_role="ansatz",
        component_artifact_version_id=uuid.uuid4(),
        ordinal=0,
        binding_metadata=None,
        created_at=None,
    )

    async def fake_get_component_spec(scope, session, artifact_version_id, **kwargs):
        return spec_row

    async def fake_list_workflow_components(scope, session, workflow_artifact_version_id, **kwargs):
        return [component_row]

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe_repo, "list_workflow_components", fake_list_workflow_components)
    result = await vqe_routes.get_workflow(
        workflow_id,
        scope=object(),
        session=object(),
        settings=_settings(),
    )
    assert result.workflow_artifact_version_id == workflow_id
    assert len(result.components) == 1
    assert result.components[0].component_role == "ansatz"


async def test_get_comparison_reads_a_real_bundled_report():
    """peruzzo2014_vs_shen2017 is one of the 3 machine-generated MVP reports
    (ADR-0026) committed under docs/atlas/corpus/comparisons/."""
    result = await vqe_routes.get_comparison("peruzzo2014_vs_shen2017", scope=object())
    assert result["comparison_id"] == "peruzzo2014_vs_shen2017"
    assert result["is_manual_gold"] is False
    assert result["human_validated"] is False


async def test_get_comparison_404s_for_an_unknown_report():
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.get_comparison("does-not-exist", scope=object())
    assert excinfo.value.status_code == 404


async def test_create_experiment_translates_idempotency_conflict_to_409(monkeypatch):
    body = vqe_routes.CreateExperimentRequest(
        workflow_artifact_version_id=uuid.uuid4(),
    )

    async def fake_resolve_scientific_experiment_spec(*args, **kwargs):
        return object()

    async def fake_create_experiment(*args, **kwargs):
        raise vqe_repo.IdempotencyConflictError("reused for a different experiment")

    monkeypatch.setattr(
        vqe_repo, "resolve_scientific_experiment_spec", fake_resolve_scientific_experiment_spec
    )
    monkeypatch.setattr(vqe_repo, "create_experiment", fake_create_experiment)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.create_experiment(
            body,
            scope=object(),
            session=object(),
            settings=_settings(),
            request_idempotency_key="dup-key",
        )
    assert excinfo.value.status_code == 409


def test_create_experiment_request_rejects_client_supplied_component_ids():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        vqe_routes.CreateExperimentRequest(
            workflow_artifact_version_id=uuid.uuid4(),
            ansatz_version_id=uuid.uuid4(),
        )


async def _fake_experiment(experiment_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=experiment_id,
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        schema_version="0.1.0",
        workflow_artifact_version_id=uuid.uuid4(),
        scientific_spec_json={},
        scientific_spec_sha256="a" * 64,
        registry_resolution_json={},
        registry_resolution_sha256="b" * 64,
        request_idempotency_key="k",
        created_at=dt.datetime.now(dt.UTC),
    )


async def test_execution_endpoints_remain_honest_without_an_execution(monkeypatch):
    experiment_id = uuid.uuid4()

    async def fake_list_executions(scope, session, eid):
        assert eid == experiment_id
        return []

    async def fake_get_execution(scope, session, execution_id):
        return SimpleNamespace(status="planned")

    monkeypatch.setattr(vqe_repo, "list_executions", fake_list_executions)
    monkeypatch.setattr(vqe_repo, "get_execution", fake_get_execution)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.cancel_experiment(
            experiment_id,
            scope=object(),
            session=object(),
        )
    assert excinfo.value.status_code == 409
    assert (
        await vqe_routes.experiment_events(
            experiment_id,
            scope=object(),
            session=object(),
        )
        == []
    )
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.materialize_execution(
            uuid.uuid4(),
            scope=object(),
            session=object(),
        )
    assert excinfo.value.status_code == 409


async def test_start_execution_is_fail_closed_without_development_gate():
    experiment_id = uuid.uuid4()
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.start_execution(
            experiment_id,
            vqe_routes.StartExecutionRequest(
                requested_capability="h2_sto3g_actual_vqe_v1",
                preferred_framework="qiskit",
            ),
            scope=object(),
            session=object(),
            settings=_settings(),
            idempotency_key="candidate-request",
        )
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "candidate_execution_disabled"


async def test_materialize_is_bound_to_the_selected_execution(monkeypatch):
    execution_id = uuid.uuid4()
    experiment_id = uuid.uuid4()
    run_id = uuid.uuid4()
    observation_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    version_id = uuid.uuid4()
    execution = SimpleNamespace(
        id=execution_id,
        experiment_id=experiment_id,
        run_id=run_id,
        framework="qiskit",
        status="succeeded",
        execution_binding_json={"framework": "qiskit", "runtime_profile_id": "fixed"},
        execution_identity_sha256="c" * 64,
    )
    observation = SimpleNamespace(
        id=observation_id,
        attempt=1,
        status="succeeded",
        result_contract_json={
            "status": "succeeded",
            "canonical_circuit_sha256": "d" * 64,
            "compilation_protocol_sha256": "e" * 64,
            "resources": [],
        },
        result_contract_sha256="f" * 64,
    )
    experiment = SimpleNamespace(
        scientific_spec_json={"schema_version": "0.2.0"},
        scientific_spec_sha256="a" * 64,
        registry_resolution_json={"schema_version": "0.2.0"},
        registry_resolution_sha256="b" * 64,
    )
    run = SimpleNamespace(id=run_id, artifact_version_id=None)
    captured = {}

    async def get_execution(scope, session, requested_id):
        assert requested_id == execution_id
        return execution

    async def list_observations(scope, session, requested_id):
        assert requested_id == execution_id
        return [observation]

    async def get_experiment(scope, session, requested_id):
        assert requested_id == experiment_id
        return experiment

    async def get_run(scope, session, requested_id):
        assert requested_id == run_id
        return run

    async def create_artifact(*args, **kwargs):
        return SimpleNamespace(id=artifact_id)

    async def create_version(*args, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(id=version_id)

    async def set_run_artifact_version(scope, session, requested_run_id, requested_version_id):
        assert (requested_run_id, requested_version_id) == (run_id, version_id)

    monkeypatch.setattr(vqe_repo, "get_execution", get_execution)
    monkeypatch.setattr(vqe_repo, "list_observations", list_observations)
    monkeypatch.setattr(vqe_repo, "get_experiment", get_experiment)
    monkeypatch.setattr(vqe_routes.runs_repo, "get_run", get_run)
    monkeypatch.setattr(vqe_routes.artifacts_repo, "create_artifact", create_artifact)
    monkeypatch.setattr(vqe_routes.artifacts_repo, "create_version", create_version)
    monkeypatch.setattr(
        vqe_routes.runs_repo,
        "set_run_artifact_version",
        set_run_artifact_version,
    )

    result = await vqe_routes.materialize_execution(
        execution_id,
        scope=object(),
        session=object(),
    )

    bundle = json.loads(captured["code"])
    assert result.artifact_version_id == version_id
    assert bundle["execution"]["id"] == str(execution_id)
    assert bundle["observation"]["id"] == str(observation_id)
    assert bundle["scientific_experiment"]["spec_sha256"] == "a" * 64
