"""DB-free tests for server-resolved portable VQE experiment identity v0.2."""

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from majorana_vqe.models import (
    ComponentType,
    MachineValidationState,
    ReviewState,
)
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    normalized_component_spec_digest,
    portable_scientific_spec_digest,
)

from majorana_api.repos import vqe

_FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "atlas"
    / "fixtures"
    / "h2_sto3g"
    / "executable_components_v0.2.json"
)


def _component(
    component_type: ComponentType,
    spec_json: dict,
    component_id: uuid.UUID | None = None,
):
    return SimpleNamespace(
        artifact_version_id=component_id or uuid.uuid4(),
        component_type=component_type.value,
        semantic_key=f"h2.v0_2.{component_type.value}",
        spec_json=spec_json,
        normalized_spec_sha256=normalized_component_spec_digest(
            component_type=component_type,
            spec_json=spec_json,
        ),
        machine_validation_state=MachineValidationState.MACHINE_VALIDATED.value,
        review_state=ReviewState.HUMAN_REVIEWED.value,
    )


def _complete_workflow():
    payload = json.loads(_FIXTURE.read_text())
    workflow = _component(
        ComponentType.WORKFLOW,
        {"schema_version": "0.2.0", "kind": "h2_executable_workflow"},
    )
    components = {role: _component(role, payload[role.value]) for role in PORTABLE_SCIENTIFIC_ROLES}
    links = [
        SimpleNamespace(
            component_role=role.value,
            component_artifact_version_id=component.artifact_version_id,
            ordinal=0,
        )
        for role, component in components.items()
    ]
    return workflow, components, links


def _install_repo_fakes(monkeypatch, workflow, components, links):
    by_id = {workflow.artifact_version_id: workflow}
    by_id.update({component.artifact_version_id: component for component in components.values()})

    async def fake_get_component_spec(scope, session, artifact_version_id, **kwargs):
        return by_id[artifact_version_id]

    async def fake_list_workflow_components(scope, session, workflow_artifact_version_id, **kwargs):
        assert workflow_artifact_version_id == workflow.artifact_version_id
        return links

    monkeypatch.setattr(vqe, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe, "list_workflow_components", fake_list_workflow_components)


async def test_resolver_builds_portable_identity_and_separate_registry_resolution(
    monkeypatch,
):
    workflow, components, links = _complete_workflow()
    _install_repo_fakes(monkeypatch, workflow, components, links)

    resolved = await vqe.resolve_scientific_experiment_spec(
        object(),
        object(),
        workflow.artifact_version_id,
        approved_seed=7,
    )

    assert {binding.role for binding in resolved.scientific_spec.component_bindings} == set(
        PORTABLE_SCIENTIFIC_ROLES
    )
    assert resolved.scientific_spec.seed == 7
    assert resolved.registry_resolution.workflow_artifact_version_id == (
        workflow.artifact_version_id
    )
    assert portable_scientific_spec_digest(resolved.scientific_spec)


async def test_resolver_rejects_missing_required_role(monkeypatch):
    workflow, components, links = _complete_workflow()
    links = [link for link in links if link.component_role != ComponentType.OPERATOR_POOL.value]
    _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="operator_pool"):
        await vqe.resolve_scientific_experiment_spec(
            object(), object(), workflow.artifact_version_id
        )


async def test_resolver_rejects_role_component_type_mismatch(monkeypatch):
    workflow, components, links = _complete_workflow()
    components[ComponentType.ANSATZ].component_type = ComponentType.OPERATOR_POOL.value
    _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="references component_type"):
        await vqe.resolve_scientific_experiment_spec(
            object(), object(), workflow.artifact_version_id
        )


async def test_resolver_rejects_unreviewed_component(monkeypatch):
    workflow, components, links = _complete_workflow()
    components[ComponentType.ANSATZ].review_state = ReviewState.UNREVIEWED.value
    _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="not scientifically reviewed"):
        await vqe.resolve_scientific_experiment_spec(
            object(), object(), workflow.artifact_version_id
        )


async def test_resolver_rejects_unreviewed_workflow(monkeypatch):
    workflow, components, links = _complete_workflow()
    workflow.review_state = ReviewState.UNREVIEWED.value
    _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="workflow is not"):
        await vqe.resolve_scientific_experiment_spec(
            object(), object(), workflow.artifact_version_id
        )


async def test_owner_deferred_policy_accepts_only_digest_pinned_h2_candidate(
    monkeypatch,
):
    workflow, components, links = _complete_workflow()
    workflow.review_state = ReviewState.UNREVIEWED.value
    workflow.semantic_key = vqe.H2_REVIEW_CANDIDATE_WORKFLOW_KEY
    for role, component in components.items():
        component.review_state = ReviewState.UNREVIEWED.value
        component.semantic_key = f"h2.sto3g.actual_vqe.v0_2.{role.value}"
    _install_repo_fakes(monkeypatch, workflow, components, links)

    resolved = await vqe.resolve_scientific_experiment_spec(
        object(),
        object(),
        workflow.artifact_version_id,
        review_policy="h2_owner_deferred_candidate",
    )

    assert (
        resolved.scientific_spec.workflow_semantic_digest == vqe.H2_REVIEW_CANDIDATE_WORKFLOW_DIGEST
    )


async def test_owner_deferred_policy_rejects_lookalike_unreviewed_workflow(
    monkeypatch,
):
    workflow, components, links = _complete_workflow()
    workflow.review_state = ReviewState.UNREVIEWED.value
    workflow.semantic_key = vqe.H2_REVIEW_CANDIDATE_WORKFLOW_KEY
    for role, component in components.items():
        component.review_state = ReviewState.UNREVIEWED.value
        component.semantic_key = f"h2.sto3g.actual_vqe.v0_2.{role.value}"
    components[ComponentType.ANSATZ].semantic_key = "h2.lookalike.ansatz"
    _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(
        vqe.InvalidWorkflowCompositionError,
        match="non-canonical H2 candidate",
    ):
        await vqe.resolve_scientific_experiment_spec(
            object(),
            object(),
            workflow.artifact_version_id,
            review_policy="h2_owner_deferred_candidate",
        )


async def test_owner_deferred_policy_accepts_only_optimizer_changed_private_swap(
    monkeypatch,
):
    baseline, components, baseline_links = _complete_workflow()
    baseline.review_state = ReviewState.UNREVIEWED.value
    baseline.semantic_key = vqe.H2_REVIEW_CANDIDATE_WORKFLOW_KEY
    for role, component in components.items():
        component.review_state = ReviewState.UNREVIEWED.value
        component.semantic_key = f"h2.sto3g.actual_vqe.v0_2.{role.value}"

    slsqp_payload = dict(components[ComponentType.PARAMETER_OPTIMIZER].spec_json)
    slsqp_payload["algorithm"] = "scipy_slsqp"
    slsqp = _component(ComponentType.PARAMETER_OPTIMIZER, slsqp_payload)
    slsqp.review_state = ReviewState.UNREVIEWED.value
    slsqp.semantic_key = "optimizer.slsqp.v1"
    candidate = _component(
        ComponentType.WORKFLOW,
        {
            "kind": "component_swap_workflow_draft",
            "changed_role": "parameter_optimizer",
            "candidate_component_semantic_key": "optimizer.slsqp.v1",
            "baseline_workflow_artifact_version_id": str(baseline.artifact_version_id),
            "execution_status": "private_qualification_candidate",
        },
    )
    candidate.review_state = ReviewState.UNREVIEWED.value
    candidate.semantic_key = "workflow.instance.slsqp"
    candidate_links = [
        SimpleNamespace(
            component_role=link.component_role,
            component_artifact_version_id=(
                slsqp.artifact_version_id
                if link.component_role == ComponentType.PARAMETER_OPTIMIZER.value
                else link.component_artifact_version_id
            ),
            ordinal=0,
        )
        for link in baseline_links
    ]
    by_id = {
        baseline.artifact_version_id: baseline,
        candidate.artifact_version_id: candidate,
        slsqp.artifact_version_id: slsqp,
        **{component.artifact_version_id: component for component in components.values()},
    }

    async def fake_get_component_spec(scope, session, artifact_version_id, **kwargs):
        return by_id[artifact_version_id]

    async def fake_list_workflow_components(
        scope,
        session,
        workflow_artifact_version_id,
        **kwargs,
    ):
        if workflow_artifact_version_id == baseline.artifact_version_id:
            return baseline_links
        assert workflow_artifact_version_id == candidate.artifact_version_id
        return candidate_links

    monkeypatch.setattr(vqe, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe, "list_workflow_components", fake_list_workflow_components)

    resolved = await vqe.resolve_scientific_experiment_spec(
        object(),
        object(),
        candidate.artifact_version_id,
        review_policy="h2_owner_deferred_candidate",
    )
    resolved_by_role = {
        binding.role: binding for binding in resolved.scientific_spec.component_bindings
    }
    assert (
        resolved_by_role[ComponentType.PARAMETER_OPTIMIZER].component_semantic_key
        == "optimizer.slsqp.v1"
    )
    assert all(
        resolved_by_role[role].component_spec_sha256 == components[role].normalized_spec_sha256
        for role in PORTABLE_SCIENTIFIC_ROLES
        if role is not ComponentType.PARAMETER_OPTIMIZER
    )


async def test_resolver_rejects_component_not_representable_in_spec_v02(monkeypatch):
    workflow, components, links = _complete_workflow()
    extra = _component(
        ComponentType.ERROR_MITIGATION,
        {"schema_version": "0.2.0", "kind": "none"},
    )
    components[ComponentType.ERROR_MITIGATION] = extra
    links.append(
        SimpleNamespace(
            component_role=ComponentType.ERROR_MITIGATION.value,
            component_artifact_version_id=extra.artifact_version_id,
            ordinal=0,
        )
    )
    _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="cannot represent"):
        await vqe.resolve_scientific_experiment_spec(
            object(), object(), workflow.artifact_version_id
        )
