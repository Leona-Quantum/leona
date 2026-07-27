"""Server-owned Implementation Binding resolution for the bounded H2 slice."""

from __future__ import annotations

import dataclasses

from .models import ComponentType
from .standard_catalog import (
    STANDARD_IMPLEMENTATIONS,
    BindingKind,
    ComponentImplementationBinding,
    EvidenceLevel,
    RoleApplicability,
    StandardWorkflowTemplate,
    check_workflow_compatibility,
)

EXECUTABLE_PLAN_SCHEMA_VERSION = "0.1.0"
_EVALUATOR_ROLES = frozenset(
    {
        ComponentType.REFERENCE_STATE,
        ComponentType.ANSATZ,
        ComponentType.MEASUREMENT,
    }
)


class ExecutablePlanResolutionError(ValueError):
    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


@dataclasses.dataclass(frozen=True)
class ResolvedRoleBinding:
    role: ComponentType
    component_semantic_key: str
    binding_key: str
    provider: str
    package: str
    package_version: str
    binding_kind: BindingKind
    evidence_level: EvidenceLevel
    evidence_locators: tuple[str, ...]
    supported_configuration_fields: tuple[str, ...]
    known_incompatibilities: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class ExecutablePlan:
    schema_version: str
    workflow_key: str
    evaluator_provider: str
    runtime_profile_id: str
    adapter_release_id: str
    role_bindings: tuple[ResolvedRoleBinding, ...]


def _evidence_is_sufficient(binding: ComponentImplementationBinding) -> bool:
    if binding.binding_kind in (BindingKind.PROVIDER_NATIVE, BindingKind.ATLAS_ADAPTER):
        return binding.evidence_level is EvidenceLevel.RUNTIME_QUALIFIED
    return binding.evidence_level in (
        EvidenceLevel.ADAPTER_TESTED,
        EvidenceLevel.RUNTIME_QUALIFIED,
    )


def resolve_executable_plan(
    workflow: StandardWorkflowTemplate,
    *,
    evaluator_provider: str,
    implementations: tuple[ComponentImplementationBinding, ...] = STANDARD_IMPLEMENTATIONS,
) -> ExecutablePlan:
    """Resolve all role bindings without accepting client package/runtime input."""

    compatibility = check_workflow_compatibility(workflow)
    if not compatibility.compatible:
        raise ExecutablePlanResolutionError(
            "incompatible_workflow",
            ",".join(issue.code for issue in compatibility.issues),
        )
    if evaluator_provider not in ("qiskit", "pennylane"):
        raise ExecutablePlanResolutionError(
            "unsupported_evaluator_provider",
            evaluator_provider,
        )

    resolved: list[tuple[ResolvedRoleBinding, ComponentImplementationBinding]] = []
    for selection in workflow.selections:
        if selection.applicability in (
            RoleApplicability.NOT_APPLICABLE,
            RoleApplicability.FORBIDDEN,
        ):
            continue
        if selection.component_semantic_key is None:
            if selection.applicability is RoleApplicability.OPTIONAL:
                continue
            raise ExecutablePlanResolutionError(
                "missing_required_component",
                selection.role.value,
            )
        candidates = [
            binding
            for binding in implementations
            if binding.component_semantic_key == selection.component_semantic_key
        ]
        if selection.role in _EVALUATOR_ROLES:
            candidates = [
                binding for binding in candidates if binding.provider == evaluator_provider
            ]
        if not candidates:
            raise ExecutablePlanResolutionError(
                "missing_binding",
                f"{selection.role.value}:{selection.component_semantic_key}",
            )
        qualified = [binding for binding in candidates if _evidence_is_sufficient(binding)]
        if not qualified:
            raise ExecutablePlanResolutionError(
                "insufficient_binding_evidence",
                f"{selection.role.value}:{selection.component_semantic_key}",
            )
        if len(qualified) != 1:
            raise ExecutablePlanResolutionError(
                "ambiguous_binding",
                f"{selection.role.value}:{selection.component_semantic_key}",
            )
        binding = qualified[0]
        resolved.append(
            (
                ResolvedRoleBinding(
                    role=selection.role,
                    component_semantic_key=selection.component_semantic_key,
                    binding_key=binding.binding_key,
                    provider=binding.provider,
                    package=binding.package,
                    package_version=binding.package_version,
                    binding_kind=binding.binding_kind,
                    evidence_level=binding.evidence_level,
                    evidence_locators=binding.evidence_locators,
                    supported_configuration_fields=binding.supported_configuration_fields,
                    known_incompatibilities=binding.known_incompatibilities,
                ),
                binding,
            )
        )

    runtime_profiles = {
        binding.runtime_profile_id
        for _, binding in resolved
        if binding.provider == evaluator_provider and binding.runtime_profile_id is not None
    }
    adapter_releases = {
        binding.adapter_release_id
        for _, binding in resolved
        if binding.provider == evaluator_provider and binding.adapter_release_id is not None
    }
    if len(runtime_profiles) != 1 or len(adapter_releases) != 1:
        raise ExecutablePlanResolutionError(
            "incoherent_evaluator_runtime",
            f"runtime_profiles={sorted(runtime_profiles)}, adapters={sorted(adapter_releases)}",
        )

    return ExecutablePlan(
        schema_version=EXECUTABLE_PLAN_SCHEMA_VERSION,
        workflow_key=workflow.workflow_key,
        evaluator_provider=evaluator_provider,
        runtime_profile_id=next(iter(runtime_profiles)),
        adapter_release_id=next(iter(adapter_releases)),
        role_bindings=tuple(item for item, _ in resolved),
    )
