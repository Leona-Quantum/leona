"""DB-free fail-closed tests for the private H2 UCCSD migration resolver."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from majorana_vqe.executable import (
    H2_SLSQP_SEMANTIC_KEYS,
    H2_UCCSD_APPLICABLE_ROLES,
    H2_UCCSD_SEMANTIC_KEYS,
    H2SemanticSelection,
    build_h2_scientific_identity,
)
from majorana_vqe.models import ComponentType, MachineValidationState, ReviewState
from majorana_vqe.portable import normalized_component_spec_digest

from majorana_api.repos import vqe

_FIXTURE_DIR = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "atlas"
    / "fixtures"
    / "h2_sto3g"
)


def _component(
    role: ComponentType,
    semantic_key: str,
    spec_json: dict[str, object],
) -> SimpleNamespace:
    return SimpleNamespace(
        artifact_version_id=uuid.uuid4(),
        component_type=role.value,
        semantic_key=semantic_key,
        spec_json=spec_json,
        normalized_spec_sha256=normalized_component_spec_digest(
            component_type=role,
            spec_json=spec_json,
        ),
        machine_validation_state=MachineValidationState.MACHINE_VALIDATED.value,
        review_state=ReviewState.UNREVIEWED.value,
    )


def _link(role: ComponentType, component: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(
        component_role=role.value,
        component_artifact_version_id=component.artifact_version_id,
        ordinal=0,
    )


def _composition() -> SimpleNamespace:
    baseline_payloads = {
        ComponentType(role): spec
        for role, spec in json.loads(
            (_FIXTURE_DIR / "executable_components_v0.2.json").read_text()
        ).items()
    }
    uccsd_payloads = {
        ComponentType(role): spec
        for role, spec in json.loads(
            (_FIXTURE_DIR / "executable_components_uccsd_v0.3.json").read_text()
        ).items()
    }
    baseline_payloads[ComponentType.PARAMETER_OPTIMIZER] = uccsd_payloads[
        ComponentType.PARAMETER_OPTIMIZER
    ]
    baseline_components = {
        role: _component(role, H2_SLSQP_SEMANTIC_KEYS[role], payload)
        for role, payload in baseline_payloads.items()
    }
    baseline_links = [
        _link(role, component) for role, component in baseline_components.items()
    ]
    baseline_workflow = _component(
        ComponentType.WORKFLOW,
        "workflow.instance.slsqp",
        {
            "kind": "component_swap_workflow_draft",
            "changed_role": ComponentType.PARAMETER_OPTIMIZER.value,
            "candidate_component_semantic_key": "optimizer.slsqp.v1",
            "execution_status": "private_qualification_candidate",
        },
    )
    candidate_workflow = _component(
        ComponentType.WORKFLOW,
        "workflow.instance.uccsd",
        {
            "kind": "ansatz_migration_workflow_draft",
            "comparison_class": (
                "controlled_capability_migration_not_one_component_swap"
            ),
            "primary_changed_role": ComponentType.ANSATZ.value,
            "dependent_changed_roles": [ComponentType.COMPILATION_BACKEND.value],
            "required_to_not_applicable_roles": [
                ComponentType.GROWTH_BATCHING.value,
                ComponentType.OPERATOR_POOL.value,
                ComponentType.SEARCH_SELECTION.value,
            ],
            "parameter_policy": "reset_all",
            "execution_status": "private_qualification_candidate",
            "baseline_workflow_artifact_version_id": str(
                baseline_workflow.artifact_version_id
            ),
        },
    )
    candidate_components = {
        role: (
            _component(role, H2_UCCSD_SEMANTIC_KEYS[role], uccsd_payloads[role])
            if role
            in {
                ComponentType.ANSATZ,
                ComponentType.COMPILATION_BACKEND,
            }
            else baseline_components[role]
        )
        for role in H2_UCCSD_APPLICABLE_ROLES
    }
    candidate_links = [
        _link(role, component) for role, component in candidate_components.items()
    ]
    baseline_identity = build_h2_scientific_identity(
        selections=[
            H2SemanticSelection(role=role, component_semantic_key=key)
            for role, key in H2_SLSQP_SEMANTIC_KEYS.items()
        ],
        specs=baseline_payloads,
        hamiltonian_digest_sha256=vqe.H2_STO3G_HAMILTONIAN_DIGEST_SHA256,
    )
    return SimpleNamespace(
        baseline_workflow=baseline_workflow,
        candidate_workflow=candidate_workflow,
        baseline_components=baseline_components,
        candidate_components=candidate_components,
        baseline_links=baseline_links,
        candidate_links=candidate_links,
        baseline_resolved=SimpleNamespace(
            scientific_spec=baseline_identity.portable_spec
        ),
    )


def _install_fakes(monkeypatch, composition: SimpleNamespace) -> None:
    by_id = {
        composition.baseline_workflow.artifact_version_id: (
            composition.baseline_workflow
        ),
        composition.candidate_workflow.artifact_version_id: (
            composition.candidate_workflow
        ),
        **{
            component.artifact_version_id: component
            for component in composition.baseline_components.values()
        },
        **{
            component.artifact_version_id: component
            for component in composition.candidate_components.values()
        },
    }

    async def fake_get_component_spec(scope, session, artifact_version_id, **kwargs):
        return by_id[artifact_version_id]

    async def fake_list_workflow_components(
        scope,
        session,
        workflow_artifact_version_id,
        **kwargs,
    ):
        if workflow_artifact_version_id == composition.baseline_workflow.artifact_version_id:
            return composition.baseline_links
        assert (
            workflow_artifact_version_id
            == composition.candidate_workflow.artifact_version_id
        )
        return composition.candidate_links

    async def fake_resolve_baseline(*args, **kwargs):
        return composition.baseline_resolved

    monkeypatch.setattr(vqe, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(
        vqe,
        "list_workflow_components",
        fake_list_workflow_components,
    )
    monkeypatch.setattr(
        vqe,
        "resolve_scientific_experiment_spec",
        fake_resolve_baseline,
    )


async def test_uccsd_resolver_normalizes_baseline_and_candidate_to_v03(monkeypatch):
    composition = _composition()
    _install_fakes(monkeypatch, composition)

    resolved = await vqe.resolve_uccsd_scientific_experiment_spec(
        object(),
        object(),
        composition.candidate_workflow.artifact_version_id,
    )

    assert resolved.scientific_spec.schema_version == "0.3.0"
    assert len(resolved.scientific_spec.initial_parameter_slots) == 3
    by_role = {
        binding.role: binding
        for binding in resolved.scientific_spec.component_bindings
    }
    assert {
        role
        for role, binding in by_role.items()
        if binding.applicability == "not_applicable"
    } == {
        ComponentType.OPERATOR_POOL,
        ComponentType.SEARCH_SELECTION,
        ComponentType.GROWTH_BATCHING,
    }
    assert len(resolved.registry_resolution.components) == len(
        H2_UCCSD_APPLICABLE_ROLES
    )


async def test_uccsd_resolver_rejects_retained_adaptive_only_role(monkeypatch):
    composition = _composition()
    composition.candidate_links.append(
        _link(
            ComponentType.OPERATOR_POOL,
            composition.baseline_components[ComponentType.OPERATOR_POOL],
        )
    )
    _install_fakes(monkeypatch, composition)

    with pytest.raises(
        vqe.InvalidWorkflowCompositionError,
        match="exactly its 11 applicable role links",
    ):
        await vqe.resolve_uccsd_scientific_experiment_spec(
            object(),
            object(),
            composition.candidate_workflow.artifact_version_id,
        )


async def test_uccsd_resolver_rejects_hidden_optimizer_replacement(monkeypatch):
    composition = _composition()
    baseline_optimizer = composition.baseline_components[
        ComponentType.PARAMETER_OPTIMIZER
    ]
    lookalike = _component(
        ComponentType.PARAMETER_OPTIMIZER,
        baseline_optimizer.semantic_key,
        baseline_optimizer.spec_json,
    )
    composition.candidate_components[ComponentType.PARAMETER_OPTIMIZER] = lookalike
    composition.candidate_links = [
        (
            _link(ComponentType.PARAMETER_OPTIMIZER, lookalike)
            if link.component_role == ComponentType.PARAMETER_OPTIMIZER.value
            else link
        )
        for link in composition.candidate_links
    ]
    _install_fakes(monkeypatch, composition)

    with pytest.raises(
        vqe.InvalidWorkflowCompositionError,
        match="changed preserved role 'parameter_optimizer'",
    ):
        await vqe.resolve_uccsd_scientific_experiment_spec(
            object(),
            object(),
            composition.candidate_workflow.artifact_version_id,
        )
