"""DB-free route-handler tests for the Atlas VQE surface (Phase 3).

Mirrors test_qpu_routes.py: handlers are called directly with monkeypatched
repo functions, never through TestClient/HTTP. The most important behaviour
under test here is that cancel/events/materialize are honest stubs (409, not
a silent 200) and that a workflow lookup refuses a non-workflow component.
"""

import datetime as dt
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from majorana_api.repos import vqe as vqe_repo
from majorana_api.routes import vqe as vqe_routes


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
        ("/atlas/workflows/{workflow_artifact_version_id}", "GET"),
        ("/atlas/comparisons/{comparison_id}", "GET"),
        ("/vqe/capabilities", "GET"),
        ("/vqe/experiments", "POST"),
        ("/vqe/experiments/{experiment_id}", "GET"),
        ("/vqe/experiments/{experiment_id}/cancel", "POST"),
        ("/vqe/experiments/{experiment_id}/events", "GET"),
        ("/vqe/experiments/{experiment_id}/materialize", "POST"),
    }
    assert expected <= _routes()


def test_every_route_requires_a_scope():
    for handler in (
        vqe_routes.list_components,
        vqe_routes.get_component,
        vqe_routes.list_workflows,
        vqe_routes.get_workflow,
        vqe_routes.get_comparison,
        vqe_routes.vqe_capabilities,
        vqe_routes.create_experiment,
        vqe_routes.get_experiment,
        vqe_routes.cancel_experiment,
        vqe_routes.experiment_events,
        vqe_routes.materialize_experiment,
    ):
        assert "scope" in handler.__annotations__


def test_create_experiment_requires_a_request_idempotency_key_with_no_default():
    import inspect

    sig = inspect.signature(vqe_routes.create_experiment)
    assert sig.parameters["request_idempotency_key"].default is inspect.Parameter.empty


async def test_capabilities_reports_the_h2_capability_as_unavailable():
    response = await vqe_routes.vqe_capabilities(scope=object())
    assert len(response.capabilities) == 1
    status = response.capabilities[0]
    assert status.capability == "h2_sto3g_exact_energy"
    assert status.available is False
    assert status.reason


async def test_get_component_converts_the_row(monkeypatch):
    row = SimpleNamespace(
        artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        component_type="ansatz",
        spec_json={"k": "v"},
        normalized_spec_sha256=None,
        annotation_state="draft",
        created_at=dt.datetime.now(dt.UTC),
    )

    async def fake_get_component_spec(scope, session, artifact_version_id):
        return row

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    result = await vqe_routes.get_component(
        row.artifact_version_id, scope=object(), session=object()
    )
    assert result.artifact_version_id == row.artifact_version_id
    assert result.component_type == "ansatz"
    assert result.spec_json == {"k": "v"}


async def test_get_workflow_rejects_a_non_workflow_component(monkeypatch):
    row = SimpleNamespace(
        artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        component_type="ansatz",  # not "workflow"
        spec_json={},
        normalized_spec_sha256=None,
        annotation_state="draft",
        created_at=None,
    )

    async def fake_get_component_spec(scope, session, artifact_version_id):
        return row

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.get_workflow(row.artifact_version_id, scope=object(), session=object())
    assert excinfo.value.status_code == 404


async def test_get_workflow_returns_its_components(monkeypatch):
    workflow_id = uuid.uuid4()
    spec_row = SimpleNamespace(
        artifact_version_id=workflow_id,
        schema_version="0.1.0",
        component_type="workflow",
        spec_json={},
        normalized_spec_sha256=None,
        annotation_state="draft",
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

    async def fake_get_component_spec(scope, session, artifact_version_id):
        return spec_row

    async def fake_list_workflow_components(scope, session, workflow_artifact_version_id):
        return [component_row]

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe_repo, "list_workflow_components", fake_list_workflow_components)
    result = await vqe_routes.get_workflow(workflow_id, scope=object(), session=object())
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
    from majorana_vqe.models import ScientificExperimentSpec

    spec = ScientificExperimentSpec(
        problem_version_id=uuid.uuid4(),
        representation_version_id=uuid.uuid4(),
        reference_state_version_id=uuid.uuid4(),
        ansatz_version_id=uuid.uuid4(),
        operator_pool_version_id=uuid.uuid4(),
        selection_version_id=uuid.uuid4(),
        growth_version_id=uuid.uuid4(),
        optimizer_version_id=uuid.uuid4(),
        compression_version_id=uuid.uuid4(),
        measurement_protocol_version_id=uuid.uuid4(),
        evaluation_protocol_version_id=uuid.uuid4(),
        stopping_protocol_version_id=uuid.uuid4(),
        seed=0,
    )
    body = vqe_routes.CreateExperimentRequest(
        workflow_artifact_version_id=uuid.uuid4(),
        protocol_version="0.1.0",
        seed=0,
    )

    async def fake_resolve_scientific_experiment_spec(*args, **kwargs):
        return spec

    async def fake_create_experiment(*args, **kwargs):
        raise vqe_repo.IdempotencyConflictError("reused for a different experiment")

    monkeypatch.setattr(
        vqe_repo, "resolve_scientific_experiment_spec", fake_resolve_scientific_experiment_spec
    )
    monkeypatch.setattr(vqe_repo, "create_experiment", fake_create_experiment)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.create_experiment(
            body, scope=object(), session=object(), request_idempotency_key="dup-key"
        )
    assert excinfo.value.status_code == 409


def test_create_experiment_request_rejects_client_supplied_component_ids():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        vqe_routes.CreateExperimentRequest(
            workflow_artifact_version_id=uuid.uuid4(),
            protocol_version="0.1.0",
            seed=0,
            ansatz_version_id=uuid.uuid4(),
        )


async def _fake_experiment(experiment_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=experiment_id,
        run_id=None,
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        schema_version="0.1.0",
        workflow_artifact_version_id=uuid.uuid4(),
        scientific_spec_json={},
        scientific_spec_sha256="a" * 64,
        protocol_version="0.1.0",
        request_idempotency_key="k",
        created_at=dt.datetime.now(dt.UTC),
    )


@pytest.mark.parametrize(
    "handler",
    [vqe_routes.cancel_experiment, vqe_routes.experiment_events, vqe_routes.materialize_experiment],
)
async def test_execution_stubs_return_409_not_fake_success(monkeypatch, handler):
    experiment_id = uuid.uuid4()

    async def fake_get_experiment(scope, session, eid):
        assert eid == experiment_id
        return await _fake_experiment(eid)

    monkeypatch.setattr(vqe_repo, "get_experiment", fake_get_experiment)
    with pytest.raises(HTTPException) as excinfo:
        await handler(experiment_id, scope=object(), session=object())
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "no_execution_started"
