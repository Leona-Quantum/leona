"""DB-free semantic tests for server-constructed VQE scientific specs."""

import uuid
from types import SimpleNamespace

import pytest
from majorana_vqe.models import SCIENTIFIC_SPEC_ROLE_BINDINGS, ComponentType

from majorana_api.repos import vqe


def _component(component_type: ComponentType, component_id: uuid.UUID | None = None):
    return SimpleNamespace(
        artifact_version_id=component_id or uuid.uuid4(),
        component_type=component_type.value,
    )


def _complete_workflow():
    workflow = _component(ComponentType.WORKFLOW)
    components = {role: _component(role) for role in SCIENTIFIC_SPEC_ROLE_BINDINGS}
    links = [
        SimpleNamespace(
            component_role=role.value,
            component_artifact_version_id=component.artifact_version_id,
            ordinal=0,
        )
        for role, component in components.items()
    ]
    return workflow, components, links


async def _install_repo_fakes(monkeypatch, workflow, components, links):
    by_id = {workflow.artifact_version_id: workflow}
    by_id.update({component.artifact_version_id: component for component in components.values()})

    async def fake_get_component_spec(scope, session, artifact_version_id):
        return by_id[artifact_version_id]

    async def fake_list_workflow_components(scope, session, workflow_artifact_version_id):
        assert workflow_artifact_version_id == workflow.artifact_version_id
        return links

    monkeypatch.setattr(vqe, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe, "list_workflow_components", fake_list_workflow_components)


async def test_resolver_builds_every_component_id_from_workflow(monkeypatch):
    workflow, components, links = _complete_workflow()
    await _install_repo_fakes(monkeypatch, workflow, components, links)

    spec = await vqe.resolve_scientific_experiment_spec(
        object(),
        object(),
        workflow.artifact_version_id,
        dataset_snapshot_id="h2-sto3g-v1",
        initial_parameters=[0.0, 0.1],
        seed=7,
    )

    for role, field_name in SCIENTIFIC_SPEC_ROLE_BINDINGS.items():
        assert getattr(spec, field_name) == components[role].artifact_version_id
    assert spec.dataset_snapshot_id == "h2-sto3g-v1"
    assert spec.initial_parameters == [0.0, 0.1]
    assert spec.seed == 7


async def test_resolver_rejects_missing_required_role(monkeypatch):
    workflow, components, links = _complete_workflow()
    links = [link for link in links if link.component_role != ComponentType.OPERATOR_POOL.value]
    await _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="operator_pool"):
        await vqe.resolve_scientific_experiment_spec(
            object(),
            object(),
            workflow.artifact_version_id,
            dataset_snapshot_id=None,
            initial_parameters=[],
            seed=0,
        )


async def test_resolver_rejects_role_component_type_mismatch(monkeypatch):
    workflow, components, links = _complete_workflow()
    components[ComponentType.ANSATZ].component_type = ComponentType.OPERATOR_POOL.value
    await _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="references component_type"):
        await vqe.resolve_scientific_experiment_spec(
            object(),
            object(),
            workflow.artifact_version_id,
            dataset_snapshot_id=None,
            initial_parameters=[],
            seed=0,
        )


async def test_resolver_rejects_component_not_representable_in_spec_v01(monkeypatch):
    workflow, components, links = _complete_workflow()
    extra = _component(ComponentType.ERROR_MITIGATION)
    components[ComponentType.ERROR_MITIGATION] = extra
    links.append(
        SimpleNamespace(
            component_role=ComponentType.ERROR_MITIGATION.value,
            component_artifact_version_id=extra.artifact_version_id,
            ordinal=0,
        )
    )
    await _install_repo_fakes(monkeypatch, workflow, components, links)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="cannot represent"):
        await vqe.resolve_scientific_experiment_spec(
            object(),
            object(),
            workflow.artifact_version_id,
            dataset_snapshot_id=None,
            initial_parameters=[],
            seed=0,
        )
