"""Fail-closed tests for the private H2 hardware-efficient migration."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from majorana_vqe.executable import (
    H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES,
    H2_HARDWARE_EFFICIENT_MIGRATED_SEMANTIC_KEYS,
    H2_UCCSD_MIGRATED_SEMANTIC_KEYS,
    build_h2_uccsd_scientific_identity,
)
from majorana_vqe.models import ComponentType, MachineValidationState, ReviewState
from majorana_vqe.portable import normalized_component_spec_digest

from majorana_api.repos import vqe

_FIXTURE_DIR = Path(__file__).resolve().parents[3] / "docs" / "atlas" / "fixtures" / "h2_sto3g"


def _workflow_payload() -> dict[str, object]:
    return {
        "schema_version": "0.4.0",
        "kind": "ansatz_migration_workflow_draft",
        "baseline_workflow_artifact_version_id": str(uuid.uuid4()),
        "migration": "h2_uccsd_slsqp_to_hardware_efficient_slsqp",
        "comparison_class": "controlled_capability_migration_not_one_component_swap",
        "primary_changed_role": ComponentType.ANSATZ.value,
        "dependent_changed_roles": [ComponentType.COMPILATION_BACKEND.value],
        "preserved_not_applicable_roles": [
            ComponentType.GROWTH_BATCHING.value,
            ComponentType.OPERATOR_POOL.value,
            ComponentType.SEARCH_SELECTION.value,
        ],
        "parameter_policy": "reset_all",
        "evaluator_provider": "qiskit",
        "request_sha256": "a" * 64,
        "execution_status": "private_qualification_candidate",
        "publication": "blocked",
        "scientific_release": "blocked",
    }


def test_machine_validated_gate_accepts_only_bounded_hardware_efficient_v04():
    payload = _workflow_payload()
    vqe._validate_machine_validated_workflow_payload(payload)

    for field, invalid_value in (
        ("comparison_class", "controlled_one_component_swap"),
        ("dependent_changed_roles", []),
        ("preserved_not_applicable_roles", []),
        ("execution_status", "blocked_until_runtime_qualified"),
        ("evaluator_provider", "unregistered"),
        ("publication", "public"),
    ):
        with pytest.raises(ValueError, match="H2 hardware-efficient workflow migration"):
            vqe._validate_machine_validated_workflow_payload({**payload, field: invalid_value})


def test_private_runtime_metadata_is_bound_to_the_exact_qualified_profile():
    metadata = vqe._hardware_efficient_private_runtime_binding_metadata(
        semantic_key="ansatz.hardware_efficient_ry_cx.v1",
        evaluator_provider="pennylane",
    )

    assert metadata["evidence_level"] == "runtime_qualified"
    assert metadata["runtime_qualification"] == "private_qualified"
    assert metadata["qualification_scope"] == ("h2_sto3g_hardware_efficient_ry_cx_v1")
    assert metadata["evaluator_provider"] == "pennylane"
    assert metadata["runtime_profile_id"] == (
        "h2-hardware-efficient-pennylane-linux-x86_64-production-v1"
    )
    assert metadata["adapter_release_id"] == (
        "majorana-h2-hardware-efficient-pennylane-adapter-0.4.0"
    )
    assert metadata["oci_manifest_digest"] == (
        "sha256:f6977dcf8cdd99b198c739f6d1f33c98dcf840235a40f66c5632dd5adddeb207"
    )
    assert metadata["publication"] == "blocked"


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


def _link(
    role: ComponentType,
    component: SimpleNamespace,
    *,
    pending_runtime: bool = False,
) -> SimpleNamespace:
    metadata = None
    if pending_runtime:
        metadata = vqe._hardware_efficient_private_runtime_binding_metadata(
            semantic_key=component.semantic_key,
            evaluator_provider="qiskit",
        )
    return SimpleNamespace(
        component_role=role.value,
        component_artifact_version_id=component.artifact_version_id,
        ordinal=0,
        binding_metadata=metadata,
    )


def _composition() -> SimpleNamespace:
    uccsd_specs = {
        ComponentType(role): spec
        for role, spec in json.loads(
            (_FIXTURE_DIR / "executable_components_uccsd_v0.3.json").read_text()
        ).items()
    }
    candidate_specs = {
        ComponentType(role): spec
        for role, spec in json.loads(
            (_FIXTURE_DIR / "executable_components_hardware_efficient_v0.4.json").read_text()
        ).items()
    }
    baseline_components = {
        role: _component(role, H2_UCCSD_MIGRATED_SEMANTIC_KEYS[role], payload)
        for role, payload in uccsd_specs.items()
    }
    changed = {ComponentType.ANSATZ, ComponentType.COMPILATION_BACKEND}
    candidate_components = {
        role: (
            _component(
                role,
                H2_HARDWARE_EFFICIENT_MIGRATED_SEMANTIC_KEYS[role],
                candidate_specs[role],
            )
            if role in changed
            else baseline_components[role]
        )
        for role in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES
    }
    baseline_workflow = _component(
        ComponentType.WORKFLOW,
        "workflow.instance.uccsd",
        {
            "kind": "ansatz_migration_workflow_draft",
            "migration": "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
            "execution_status": "private_qualification_candidate",
        },
    )
    candidate_payload = _workflow_payload()
    candidate_payload["baseline_workflow_artifact_version_id"] = str(
        baseline_workflow.artifact_version_id
    )
    candidate_workflow = _component(
        ComponentType.WORKFLOW,
        "workflow.instance.hardware-efficient",
        candidate_payload,
    )
    baseline_identity = build_h2_uccsd_scientific_identity(
        semantic_keys=H2_UCCSD_MIGRATED_SEMANTIC_KEYS,
        specs=uccsd_specs,
        hamiltonian_digest_sha256=vqe.H2_STO3G_HAMILTONIAN_DIGEST_SHA256,
    )
    return SimpleNamespace(
        baseline_workflow=baseline_workflow,
        candidate_workflow=candidate_workflow,
        baseline_components=baseline_components,
        candidate_components=candidate_components,
        baseline_links=[_link(role, component) for role, component in baseline_components.items()],
        candidate_links=[
            _link(role, component, pending_runtime=role in changed)
            for role, component in candidate_components.items()
        ],
        baseline_resolved=SimpleNamespace(scientific_spec=baseline_identity.portable_spec),
    )


def _install_fakes(monkeypatch, composition: SimpleNamespace) -> None:
    by_id = {
        composition.baseline_workflow.artifact_version_id: composition.baseline_workflow,
        composition.candidate_workflow.artifact_version_id: composition.candidate_workflow,
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
        return composition.candidate_links

    async def fake_resolve_uccsd(*args, **kwargs):
        return composition.baseline_resolved

    monkeypatch.setattr(vqe, "get_component_spec", fake_get_component_spec)
    monkeypatch.setattr(vqe, "list_workflow_components", fake_list_workflow_components)
    monkeypatch.setattr(
        vqe,
        "resolve_uccsd_scientific_experiment_spec",
        fake_resolve_uccsd,
    )


async def test_hardware_efficient_resolver_preserves_every_non_ansatz_role(monkeypatch):
    composition = _composition()
    _install_fakes(monkeypatch, composition)

    resolved = await vqe.resolve_hardware_efficient_scientific_experiment_spec(
        object(),
        object(),
        composition.candidate_workflow.artifact_version_id,
    )

    assert resolved.scientific_spec.schema_version == "0.3.0"
    assert len(resolved.scientific_spec.initial_parameter_slots) == 8
    by_role = {binding.role: binding for binding in resolved.scientific_spec.component_bindings}
    assert by_role[ComponentType.ANSATZ].component_semantic_key == (
        "ansatz.hardware_efficient_ry_cx.v1"
    )
    assert by_role[ComponentType.COMPILATION_BACKEND].component_semantic_key == (
        "compilation.h2.hardware_efficient_ry_cx.canonical_logical.v1"
    )
    assert len(resolved.registry_resolution.components) == len(
        H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES
    )


async def test_hardware_efficient_resolver_rejects_hidden_preserved_role_replacement(
    monkeypatch,
):
    composition = _composition()
    role = ComponentType.MEASUREMENT
    original = composition.candidate_components[role]
    lookalike = _component(role, original.semantic_key, original.spec_json)
    composition.candidate_components[role] = lookalike
    composition.candidate_links = [
        _link(role, lookalike) if link.component_role == role.value else link
        for link in composition.candidate_links
    ]
    _install_fakes(monkeypatch, composition)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="changed preserved role"):
        await vqe.resolve_hardware_efficient_scientific_experiment_spec(
            object(),
            object(),
            composition.candidate_workflow.artifact_version_id,
        )


async def test_hardware_efficient_resolver_rejects_overstated_runtime_evidence(monkeypatch):
    composition = _composition()
    ansatz_link = next(
        link
        for link in composition.candidate_links
        if link.component_role == ComponentType.ANSATZ.value
    )
    ansatz_link.binding_metadata["runtime_profile_id"] = "unqualified-profile"
    _install_fakes(monkeypatch, composition)

    with pytest.raises(vqe.InvalidWorkflowCompositionError, match="overstates runtime evidence"):
        await vqe.resolve_hardware_efficient_scientific_experiment_spec(
            object(),
            object(),
            composition.candidate_workflow.artifact_version_id,
        )
