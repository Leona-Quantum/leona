"""DB-free route-handler tests for the Atlas VQE surface.

Mirrors test_qpu_routes.py: handlers are called directly with monkeypatched
repo functions, never through TestClient/HTTP. The most important behaviour
under test here is that candidate execution stays fail-closed and that a
workflow lookup refuses a non-workflow component.
"""

import datetime as dt
import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from majorana_vqe.portable import ComponentRoleBindingV03, workflow_semantic_digest_v03

from majorana_api.repos import vqe as vqe_repo
from majorana_api.routes import vqe as vqe_routes

ROOT = Path(__file__).resolve().parents[3]


def _settings():
    return SimpleNamespace(
        catalog_authority=SimpleNamespace(configured=False, workspace_id=None),
        vqe_candidate_execution=False,
        vqe_production_execution=False,
        developer_emails=frozenset(),
        team_emails=frozenset(),
        pro_emails=frozenset(),
        vqe_decision_hmac_key="test-vqe-decision-key-that-is-long-enough",
    )


def _identity():
    return (SimpleNamespace(email="vqe-test@example.com", plan=None), SimpleNamespace())


def test_standard_seed_does_not_claim_an_implementation_resolution():
    row = SimpleNamespace(
        semantic_key="workflow.h2.uccsd.v1",
        spec_json={},
    )
    profile = vqe_routes.uccsd_production_runtime_profile(
        vqe_routes.Framework.QISKIT
    )

    state = vqe_routes._implementation_resolution_for_profile(
        row=row,
        links=[],
        profile=profile,
        composition_state=vqe_routes.CompositionState.UNVALIDATED,
        settings=_settings(),
    )

    assert state is vqe_routes.ImplementationResolutionState.UNRESOLVED


def test_framework_specific_migration_requires_exact_runtime_binding_metadata():
    profile = vqe_routes.uccsd_production_runtime_profile(
        vqe_routes.Framework.QISKIT
    )
    row = SimpleNamespace(
        semantic_key="workflow.instance.digest",
        spec_json={
            "kind": "ansatz_migration_workflow_draft",
            "migration": "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
            "evaluator_provider": "qiskit",
        },
    )
    metadata = {
        "runtime_profile_id": profile.binding.runtime_profile_id,
        "adapter_release_id": profile.binding.adapter_release_id,
        "evidence_level": "runtime_qualified",
        "runtime_qualification": "private_qualified",
    }
    links = [
        SimpleNamespace(component_role=role, binding_metadata=metadata)
        for role in ("ansatz", "compilation_backend")
    ]

    assert vqe_routes._implementation_resolution_for_profile(
        row=row,
        links=links,
        profile=profile,
        composition_state=vqe_routes.CompositionState.MACHINE_VALIDATED,
        settings=SimpleNamespace(
            vqe_candidate_execution=False,
            vqe_production_execution=True,
        ),
    ) is vqe_routes.ImplementationResolutionState.RESOLVED

    links[0] = SimpleNamespace(
        component_role="ansatz",
        binding_metadata={**metadata, "runtime_profile_id": "different-runtime"},
    )
    assert vqe_routes._implementation_resolution_for_profile(
        row=row,
        links=links,
        profile=profile,
        composition_state=vqe_routes.CompositionState.MACHINE_VALIDATED,
        settings=SimpleNamespace(
            vqe_candidate_execution=False,
            vqe_production_execution=True,
        ),
    ) is vqe_routes.ImplementationResolutionState.UNRESOLVED


def test_framework_specific_migration_exposes_only_the_bound_framework():
    row = SimpleNamespace(
        semantic_key="workflow.instance.digest",
        spec_json={
            "migration": "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
            "evaluator_provider": "pennylane",
        },
    )

    profiles = vqe_routes._runtime_profiles_for_workflow(row)

    assert [profile.binding.framework.value for profile in profiles] == ["pennylane"]


def _scope() -> SimpleNamespace:
    return SimpleNamespace(user_id=uuid.uuid4(), workspace_id=uuid.uuid4())


def _eligible_projection(
    workflow_artifact_version_id: uuid.UUID,
    *,
    framework: str = "qiskit",
    projection_sha256: str = "a" * 64,
) -> vqe_routes.WorkflowLaunchProjectionResource:
    now = dt.datetime.now(dt.UTC)
    return vqe_routes.WorkflowLaunchProjectionResource(
        workflow_artifact_version_id=workflow_artifact_version_id,
        workflow_semantic_key="h2.sto3g.actual_vqe.workflow.v0_2",
        registry_semantic_key="h2.sto3g.actual_vqe.workflow.v0_2",
        machine_validation_state="machine_validated",
        review_state="unreviewed",
        definition_state="available",
        composition_state="machine_validated",
        execution_policy_state="owner_waived_private",
        validated_draft_supported=False,
        experiment_creation=vqe_routes.ExperimentCreationProjectionResource(
            decision="eligible",
            launch_mode="direct",
            primary_reason_code=None,
            blockers=[],
        ),
        frameworks=[
            vqe_routes.FrameworkLaunchProjectionResource(
                framework=framework,
                runtime_profile_id=f"test-{framework}-runtime",
                implementation_resolution="resolved",
                runtime_qualification="qualified",
                live_readiness="ready",
                readiness_generation=uuid.uuid4(),
                readiness_expires_at=now + dt.timedelta(minutes=5),
                decision="eligible",
                primary_reason_code=None,
                blockers=[],
            )
        ],
        projection_sha256=projection_sha256,
        registry_snapshot_sha256="b" * 64,
        evaluated_at=now,
        expires_at=now + dt.timedelta(minutes=5),
    )


def _stub_eligible_launch(
    monkeypatch,
    workflow_artifact_version_id: uuid.UUID,
    *,
    framework: str = "qiskit",
    projection_sha256: str = "a" * 64,
) -> None:
    async def fake_get_component_spec(*args, **kwargs):
        return SimpleNamespace(artifact_version_id=workflow_artifact_version_id)

    async def fake_projection(*args, **kwargs):
        return _eligible_projection(
            workflow_artifact_version_id,
            framework=framework,
            projection_sha256=projection_sha256,
        )

    async def fake_append_launch_decision(*args, **kwargs):
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(vqe_repo, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe_routes, "_workflow_launch_projection", fake_projection)
    monkeypatch.setattr(vqe_repo, "append_launch_decision", fake_append_launch_decision)


@pytest.fixture(autouse=True)
def _stub_private_vault_filing(monkeypatch):
    async def keep_artifact(scope, session, artifact_id, *, workspace_artifact_limit):
        return SimpleNamespace(id=artifact_id)

    monkeypatch.setattr(vqe_routes.artifacts_repo, "keep_artifact", keep_artifact)


@pytest.mark.asyncio
async def test_private_vqe_filing_uses_the_authenticated_plan_limit(monkeypatch):
    captured = {}

    async def keep_artifact(scope, session, artifact_id, *, workspace_artifact_limit):
        captured.update(
            scope=scope,
            session=session,
            artifact_id=artifact_id,
            limit=workspace_artifact_limit,
        )
        return SimpleNamespace(id=artifact_id)

    monkeypatch.setattr(vqe_routes.artifacts_repo, "keep_artifact", keep_artifact)
    artifact_id = uuid.uuid4()
    identity = _identity()
    settings = _settings()
    await vqe_routes._file_private_artifact(
        "scope",
        "session",
        identity,
        settings,
        artifact_id,
    )

    expected = vqe_routes.limits_for(vqe_routes.tier_of(identity[0], settings)).private_artifacts
    assert captured == {
        "scope": "scope",
        "session": "session",
        "artifact_id": artifact_id,
        "limit": expected,
    }


@pytest.mark.asyncio
async def test_private_vqe_filing_maps_a_full_vault_to_a_structured_refusal(monkeypatch):
    async def keep_artifact(scope, session, artifact_id, *, workspace_artifact_limit):
        raise vqe_routes.artifacts_repo.ArtifactCapReached(3, 3)

    monkeypatch.setattr(vqe_routes.artifacts_repo, "keep_artifact", keep_artifact)

    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes._file_private_artifact(
            "scope",
            "session",
            _identity(),
            _settings(),
            uuid.uuid4(),
        )

    assert excinfo.value.status_code == 429
    assert excinfo.value.detail == {
        "error": (
            "Your Studio holds 3 of 3 artifacts on this plan. "
            "Archive an artifact you no longer need and this VQE result will file."
        ),
        "reason": "artifact_allowance_exhausted",
        "used": 3,
        "limit": 3,
    }


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
        ("/atlas/workflows/ansatz-migrations", "POST"),
        ("/atlas/workflows/{workflow_artifact_version_id}", "GET"),
        ("/atlas/comparisons/{comparison_id}", "GET"),
        ("/vqe/capabilities", "GET"),
        ("/vqe/workflow-launch-projections", "GET"),
        (
            "/vqe/workflow-launch-projections/{workflow_artifact_version_id}",
            "GET",
        ),
        ("/vqe/validated-workflow-drafts", "POST"),
        ("/vqe/research-candidates", "GET"),
        ("/vqe/research-candidates/{envelope_id}/{candidate_local_id}", "GET"),
        ("/vqe/research-candidates/{envelope_id}/reviews", "POST"),
        (
            "/vqe/research-candidates/{envelope_id}/reviews/{review_id}/materialize",
            "POST",
        ),
        ("/vqe/experiments", "POST"),
        ("/vqe/controlled-comparisons", "POST"),
        ("/vqe/controlled-comparisons/{comparison_spec_id}", "GET"),
        ("/vqe/controlled-comparisons/{comparison_spec_id}/runs", "POST"),
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
        vqe_routes.create_ansatz_migration,
        vqe_routes.get_workflow,
        vqe_routes.get_comparison,
        vqe_routes.vqe_capabilities,
        vqe_routes.list_workflow_launch_projections,
        vqe_routes.get_workflow_launch_projection,
        vqe_routes.create_validated_workflow_draft,
        vqe_routes.list_research_candidate_envelopes,
        vqe_routes.get_research_candidate_review_view,
        vqe_routes.create_research_candidate_review,
        vqe_routes.materialize_research_candidate_review,
        vqe_routes.create_experiment,
        vqe_routes.get_experiment,
        vqe_routes.create_controlled_comparison,
        vqe_routes.get_controlled_comparison,
        vqe_routes.finalize_controlled_comparison_run,
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


def test_uccsd_execution_identity_requires_the_exact_component_set():
    identity = json.loads(
        (
            ROOT
            / "docs"
            / "atlas"
            / "fixtures"
            / "h2_sto3g"
            / "uccsd_scientific_identity_v0.3.json"
        ).read_text()
    )
    scientific_spec = identity["portable_spec"]

    assert vqe_routes._matches_h2_uccsd_component_identity(scientific_spec) is True

    migrated = json.loads(json.dumps(scientific_spec))
    for binding in migrated["component_bindings"]:
        if binding["applicability"] != "required":
            continue
        role = binding["role"]
        if role not in {"ansatz", "parameter_optimizer", "compilation_backend"}:
            binding["component_semantic_key"] = f"h2.sto3g.actual_vqe.v0_2.{role}"
    migrated["workflow_semantic_digest"] = workflow_semantic_digest_v03(
        [
            ComponentRoleBindingV03.model_validate(binding)
            for binding in migrated["component_bindings"]
        ]
    )
    assert vqe_routes._matches_h2_uccsd_component_identity(migrated) is True

    drifted = json.loads(json.dumps(scientific_spec))
    ansatz = next(item for item in drifted["component_bindings"] if item["role"] == "ansatz")
    ansatz["component_semantic_key"] = "ansatz.fixed_excitation.v1"
    assert vqe_routes._matches_h2_uccsd_component_identity(drifted) is False


def test_hardware_efficient_execution_identity_requires_the_exact_component_set():
    identity = json.loads(
        (
            ROOT
            / "docs"
            / "atlas"
            / "fixtures"
            / "h2_sto3g"
            / "hardware_efficient_scientific_identity_v0.4.json"
        ).read_text()
    )
    scientific_spec = identity["portable_spec"]

    assert vqe_routes._matches_h2_hardware_efficient_component_identity(scientific_spec) is True
    drifted = json.loads(json.dumps(scientific_spec))
    ansatz = next(item for item in drifted["component_bindings"] if item["role"] == "ansatz")
    ansatz["component_semantic_key"] = "ansatz.uccsd.v1"
    assert vqe_routes._matches_h2_hardware_efficient_component_identity(drifted) is False


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
            workflow_spec=SimpleNamespace(
                semantic_key="workflow.instance.test",
                spec_json={"execution_status": "private_qualification_candidate"},
            ),
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
        identity=_identity(),
        settings=_settings(),
        request_idempotency_key="request-1",
    )
    assert result.workflow_artifact_version_id == version_id
    assert captured["candidate_component_semantic_key"] == "optimizer.slsqp.v1"
    assert "runtime_profile_id" not in captured
    assert "package_version" not in captured


async def test_create_ansatz_migration_passes_only_bounded_owner_choices(monkeypatch):
    baseline_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    version_id = uuid.uuid4()
    captured = {}

    async def fake_save(scope, session, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            artifact=SimpleNamespace(id=artifact_id),
            version=SimpleNamespace(id=version_id, fingerprint="c" * 64),
            workflow_spec=SimpleNamespace(
                semantic_key="workflow.instance.uccsd",
                spec_json={"execution_status": "private_qualification_candidate"},
            ),
            replayed=False,
        )

    monkeypatch.setattr(
        vqe_repo,
        "save_h2_uccsd_migration_workflow_draft",
        fake_save,
    )
    body = vqe_routes.CreateAnsatzMigrationRequest(
        baseline_workflow_artifact_version_id=baseline_id,
        migration="h2_fixed_excitation_slsqp_to_uccsd_slsqp",
        evaluator_provider="pennylane",
    )
    result = await vqe_routes.create_ansatz_migration(
        body,
        scope=object(),
        session=object(),
        identity=_identity(),
        settings=_settings(),
        request_idempotency_key="migration-1",
    )

    assert result.workflow_artifact_version_id == version_id
    assert captured == {
        "baseline_workflow_artifact_version_id": baseline_id,
        "evaluator_provider": "pennylane",
        "request_idempotency_key": "migration-1",
        "catalog_workspace_id": None,
    }


async def test_create_hardware_efficient_migration_uses_its_bounded_repository_path(
    monkeypatch,
):
    baseline_id = uuid.uuid4()
    version_id = uuid.uuid4()
    captured = {}

    async def fake_save(scope, session, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            artifact=SimpleNamespace(id=uuid.uuid4()),
            version=SimpleNamespace(id=version_id, fingerprint="d" * 64),
            workflow_spec=SimpleNamespace(
                semantic_key="workflow.instance.hardware-efficient",
                spec_json={"execution_status": "private_qualification_candidate"},
            ),
            replayed=False,
        )

    monkeypatch.setattr(
        vqe_repo,
        "save_h2_hardware_efficient_migration_workflow_draft",
        fake_save,
    )
    body = vqe_routes.CreateAnsatzMigrationRequest(
        baseline_workflow_artifact_version_id=baseline_id,
        migration="h2_uccsd_slsqp_to_hardware_efficient_slsqp",
        evaluator_provider="qiskit",
    )
    result = await vqe_routes.create_ansatz_migration(
        body,
        scope=object(),
        session=object(),
        identity=_identity(),
        settings=_settings(),
        request_idempotency_key="hardware-efficient-1",
    )

    assert result.workflow_artifact_version_id == version_id
    assert result.execution_status == "private_qualification_candidate"
    assert captured["baseline_workflow_artifact_version_id"] == baseline_id


def test_workflow_swap_request_accepts_only_admitted_private_optimizers():
    common = {
        "baseline_workflow_artifact_version_id": uuid.uuid4(),
        "baseline_template_key": "workflow.h2.fixed_excitation.v1",
        "changed_role": "parameter_optimizer",
        "candidate_component_spec_sha256": "b" * 64,
        "configuration": {},
        "evaluator_provider": "pennylane",
    }
    for semantic_key in ("optimizer.slsqp.v1", "optimizer.cobyla.v1"):
        request = vqe_routes.CreateWorkflowSwapRequest(
            **common,
            candidate_component_semantic_key=semantic_key,
        )
        assert request.candidate_component_semantic_key == semantic_key


async def test_capabilities_reports_the_h2_capability_as_unavailable():
    response = await vqe_routes.vqe_capabilities(scope=object())
    assert {status.capability for status in response.capabilities} == {
        "h2_sto3g_exact_energy",
        "h2_sto3g_actual_vqe_v1",
        "h2_sto3g_uccsd_v1",
        "h2_sto3g_hardware_efficient_ry_cx_v1",
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
            session=SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock()),
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
    (ADR-0027) committed under docs/atlas/corpus/comparisons/."""
    result = await vqe_routes.get_comparison("peruzzo2014_vs_shen2017", scope=object())
    assert result["comparison_id"] == "peruzzo2014_vs_shen2017"
    assert result["is_manual_gold"] is False
    assert result["human_validated"] is False


async def test_get_comparison_404s_for_an_unknown_report():
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.get_comparison("does-not-exist", scope=object())
    assert excinfo.value.status_code == 404


async def test_controlled_comparison_resource_is_private_and_publication_blocked(
    monkeypatch,
):
    comparison_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    baseline_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    created_at = dt.datetime.now(dt.UTC)

    async def fake_list_controlled_comparison_runs(scope, session, requested_id):
        assert requested_id == comparison_id
        return []

    monkeypatch.setattr(
        vqe_repo,
        "list_controlled_comparison_runs",
        fake_list_controlled_comparison_runs,
    )
    resource = await vqe_routes._to_controlled_comparison_resource(
        object(),
        object(),
        SimpleNamespace(
            id=comparison_id,
            workspace_id=workspace_id,
            baseline_workflow_artifact_version_id=baseline_id,
            candidate_workflow_artifact_version_id=candidate_id,
            changed_role="parameter_optimizer",
            spec_json={"schema_version": "1.0.0"},
            spec_sha256="a" * 64,
            created_at=created_at,
        ),
    )

    assert resource.scientific_review == "unreviewed"
    assert resource.execution_policy == "owner_waived_private"
    assert resource.visibility == "private"
    assert resource.publication == "blocked"
    assert resource.runs == []


async def test_create_experiment_translates_idempotency_conflict_to_409(monkeypatch):
    workflow_id = uuid.uuid4()
    body = vqe_routes.CreateExperimentRequest(
        workflow_artifact_version_id=workflow_id,
        expected_projection_sha256="a" * 64,
    )

    async def fake_resolve_scientific_experiment_spec(*args, **kwargs):
        return object()

    async def fake_create_experiment(*args, **kwargs):
        raise vqe_repo.IdempotencyConflictError("reused for a different experiment")

    monkeypatch.setattr(
        vqe_repo, "resolve_scientific_experiment_spec", fake_resolve_scientific_experiment_spec
    )
    monkeypatch.setattr(vqe_repo, "create_experiment", fake_create_experiment)
    _stub_eligible_launch(monkeypatch, workflow_id)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.create_experiment(
            body,
            scope=_scope(),
            session=SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock()),
            settings=_settings(),
            request_idempotency_key="dup-key",
        )
    assert excinfo.value.status_code == 409


async def test_eligible_projection_scientific_mismatch_is_an_invariant_failure(
    monkeypatch,
):
    """An eligible→strict-resolver contradiction is observable and fail-closed."""

    workflow_id = uuid.uuid4()
    observed: list[dict] = []

    async def fake_resolve_scientific_experiment_spec(*args, **kwargs):
        raise vqe_repo.InvalidWorkflowCompositionError("deliberate invariant drift")

    def fake_observe_launch_decision(**kwargs):
        observed.append(kwargs)

    monkeypatch.setattr(
        vqe_repo,
        "resolve_scientific_experiment_spec",
        fake_resolve_scientific_experiment_spec,
    )
    monkeypatch.setattr(
        vqe_routes,
        "_observe_launch_decision",
        fake_observe_launch_decision,
    )
    _stub_eligible_launch(monkeypatch, workflow_id)
    session = SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock())

    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.create_experiment(
            vqe_routes.CreateExperimentRequest(
                workflow_artifact_version_id=workflow_id,
                expected_projection_sha256="a" * 64,
            ),
            scope=_scope(),
            session=session,
            settings=_settings(),
            request_idempotency_key="eligible-invariant-drift",
            request_id="phase12-invariant-test",
        )

    assert excinfo.value.status_code == 422
    assert excinfo.value.detail["reason_code"] == (
        "vqe_eligible_create_scientific_mismatch"
    )
    assert observed[-1]["decision"] == "invariant_rejected"
    assert observed[-1]["invariant_failure"] is True
    session.rollback.assert_awaited_once()
    session.commit.assert_awaited_once()


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
            identity=_identity(),
            settings=_settings(),
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
                expected_projection_sha256="a" * 64,
            ),
            scope=object(),
            session=object(),
            settings=_settings(),
            idempotency_key="candidate-request",
        )
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "candidate_execution_disabled"


async def test_local_candidate_execution_binds_recoverable_qualified_oci_profile(
    monkeypatch,
):
    experiment_id = uuid.uuid4()
    workflow_id = uuid.uuid4()
    run_id = uuid.uuid4()
    captured = {}

    async def fake_get_experiment(scope, session, requested_experiment_id):
        assert requested_experiment_id == experiment_id
        identity = json.loads(
            (
                ROOT
                / "docs"
                / "atlas"
                / "evidence"
                / "phase76"
                / "h2_baseline_scientific_identity_v0.1.json"
            ).read_text()
        )
        return SimpleNamespace(
            id=experiment_id,
            workflow_artifact_version_id=workflow_id,
            scientific_spec_json=identity["identity"]["portable_spec"],
        )

    async def fake_create_execution(scope, session, requested_experiment_id, *, binding):
        captured["binding"] = binding
        return SimpleNamespace(
            id=uuid.uuid4(),
            experiment_id=requested_experiment_id,
            run_id=run_id,
            framework=binding.framework.value,
            runtime_profile_id=binding.runtime_profile_id,
            runtime_image_digest=binding.container_digest,
            adapter_release_id=binding.adapter_release_id,
            execution_identity_sha256="e" * 64,
            execution_binding_json=binding.model_dump(mode="json"),
            status="planned",
            created_at=None,
            updated_at=None,
        )

    async def fake_list_observations(scope, session, execution_id):
        return []

    monkeypatch.setattr(vqe_repo, "get_experiment", fake_get_experiment)
    monkeypatch.setattr(vqe_repo, "create_execution", fake_create_execution)
    monkeypatch.setattr(vqe_repo, "list_observations", fake_list_observations)
    _stub_eligible_launch(monkeypatch, workflow_id)
    settings = SimpleNamespace(
        catalog_authority=SimpleNamespace(configured=False, workspace_id=None),
        vqe_candidate_execution=True,
        vqe_production_execution=False,
        vqe_decision_hmac_key="test-vqe-decision-key-that-is-long-enough",
    )

    result = await vqe_routes.start_execution(
        experiment_id,
        vqe_routes.StartExecutionRequest(
            requested_capability="h2_sto3g_actual_vqe_v1",
            preferred_framework="qiskit",
            expected_projection_sha256="a" * 64,
        ),
        scope=_scope(),
        session=SimpleNamespace(commit=AsyncMock()),
        settings=settings,
        idempotency_key="local-qualified-oci",
    )

    binding = captured["binding"]
    assert binding.runtime_profile_id.endswith("-production-v2")
    assert binding.container_digest_kind == "oci_manifest_digest"
    assert binding.production_runtime_status == "qualified"
    assert result.publication == "blocked"


async def test_hardware_efficient_execution_requires_the_production_gate(
    monkeypatch,
):
    identity = json.loads(
        (
            ROOT
            / "docs"
            / "atlas"
            / "fixtures"
            / "h2_sto3g"
            / "hardware_efficient_scientific_identity_v0.4.json"
        ).read_text()
    )
    workflow_id = uuid.uuid4()

    async def fake_get_experiment(scope, session, experiment_id):
        return SimpleNamespace(
            id=experiment_id,
            workflow_artifact_version_id=workflow_id,
            scientific_spec_json=identity["portable_spec"],
        )

    monkeypatch.setattr(vqe_repo, "get_experiment", fake_get_experiment)
    settings = SimpleNamespace(
        catalog_authority=SimpleNamespace(configured=False, workspace_id=None),
        vqe_candidate_execution=True,
        vqe_production_execution=False,
        vqe_decision_hmac_key="test-vqe-decision-key-that-is-long-enough",
    )
    _stub_eligible_launch(monkeypatch, workflow_id)
    with pytest.raises(HTTPException) as excinfo:
        await vqe_routes.start_execution(
            uuid.uuid4(),
            vqe_routes.StartExecutionRequest(
                requested_capability="h2_sto3g_hardware_efficient_ry_cx_v1",
                preferred_framework="qiskit",
                expected_projection_sha256="a" * 64,
            ),
            scope=_scope(),
            session=SimpleNamespace(commit=AsyncMock()),
            settings=settings,
            idempotency_key="hardware-efficient-without-production-gate",
        )

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "hardware_efficient_requires_qualified_runtime"


async def test_hardware_efficient_execution_uses_exact_qualified_profile(monkeypatch):
    identity = json.loads(
        (
            ROOT
            / "docs"
            / "atlas"
            / "fixtures"
            / "h2_sto3g"
            / "hardware_efficient_scientific_identity_v0.4.json"
        ).read_text()
    )
    experiment_id = uuid.uuid4()
    workflow_id = uuid.uuid4()
    run_id = uuid.uuid4()
    captured = {}

    async def fake_get_experiment(scope, session, requested_experiment_id):
        assert requested_experiment_id == experiment_id
        return SimpleNamespace(
            id=experiment_id,
            workflow_artifact_version_id=workflow_id,
            scientific_spec_json=identity["portable_spec"],
        )

    async def fake_create_execution(scope, session, requested_experiment_id, *, binding):
        captured["binding"] = binding
        return SimpleNamespace(
            id=uuid.uuid4(),
            experiment_id=requested_experiment_id,
            run_id=run_id,
            framework=binding.framework.value,
            runtime_profile_id=binding.runtime_profile_id,
            runtime_image_digest=binding.container_digest,
            adapter_release_id=binding.adapter_release_id,
            execution_identity_sha256="e" * 64,
            execution_binding_json=binding.model_dump(mode="json"),
            status="planned",
            created_at=None,
            updated_at=None,
        )

    async def fake_list_observations(scope, session, execution_id):
        return []

    monkeypatch.setattr(vqe_repo, "get_experiment", fake_get_experiment)
    monkeypatch.setattr(vqe_repo, "create_execution", fake_create_execution)
    monkeypatch.setattr(vqe_repo, "list_observations", fake_list_observations)
    _stub_eligible_launch(monkeypatch, workflow_id)
    settings = SimpleNamespace(
        catalog_authority=SimpleNamespace(configured=False, workspace_id=None),
        vqe_candidate_execution=False,
        vqe_production_execution=True,
        vqe_decision_hmac_key="test-vqe-decision-key-that-is-long-enough",
    )

    result = await vqe_routes.start_execution(
        experiment_id,
        vqe_routes.StartExecutionRequest(
            requested_capability="h2_sto3g_hardware_efficient_ry_cx_v1",
            preferred_framework="qiskit",
            expected_projection_sha256="a" * 64,
        ),
        scope=_scope(),
        session=object(),
        settings=settings,
        idempotency_key="hardware-efficient-qualified",
    )

    binding = captured["binding"]
    assert binding.runtime_profile_id == ("h2-hardware-efficient-qiskit-linux-x86_64-production-v1")
    assert binding.container_digest == (
        "sha256:1bd4a30499fdb945ee61a89b703d28287eabe2d4dedf610c8a9b4fef6fee555d"
    )
    assert result.production_runtime_status == "qualified"
    assert result.scientific_review == "unreviewed"
    assert result.execution_policy == "owner_waived_private"
    assert result.runtime_qualification == "qualified_private"
    assert result.publication == "blocked"


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
        identity=_identity(),
        settings=_settings(),
    )

    bundle = json.loads(captured["code"])
    assert result.artifact_version_id == version_id
    assert bundle["execution"]["id"] == str(execution_id)
    assert bundle["observation"]["id"] == str(observation_id)
    assert bundle["scientific_experiment"]["spec_sha256"] == "a" * 64
    assert captured["resource_estimates"] == {"stages": []}
