"""VQE registry, portable experiments, executions, and evidence (Phase 4.5).

vqe_component_specs and vqe_workflow_components carry no workspace_id of
their own — identity is the referenced ArtifactVersion (ADR-0024), so every
read joins through artifact_versions -> artifacts to apply the workspace
predicate, the same pattern verification_records/run_events use through
runs. vqe_experiments carries workspace_id directly. vqe_executions and
vqe_observations are scoped through their parent experiment and deliberately
do not duplicate workspace_id.

Enum-typed parameters here come from majorana_vqe, not majorana_contracts.enums.
Portable identity, typed composition, and capability-specific result
validation are recomputed in this repository boundary; callers cannot supply
an authoritative hash independently from its content.

append_observation is strictly append-only (ADR-0026): a retry is a new row
with an incremented attempt, never a mutation of a prior one.
"""

import dataclasses
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus
from majorana_contracts.enums import Framework as ContractFramework
from majorana_vqe.models import (
    ComponentType,
    ExecutionBinding,
    MachineValidationState,
    ReviewState,
)
from majorana_vqe.controlled_comparison import (
    ControlledComparisonRunV1,
    ControlledComparisonSpecV1,
    ControlledComparisonStatus,
)
from majorana_vqe.executable import (
    H2_STO3G_HAMILTONIAN_DIGEST_SHA256,
    H2_UCCSD_APPLICABLE_ROLES,
    executable_component_scientific_payload,
    load_packaged_h2_uccsd_executable_component_specs,
    parse_executable_component,
    validate_h2_executable_composition,
    validate_h2_uccsd_executable_composition,
)
from majorana_vqe.migration import build_h2_fixed_to_uccsd_migration
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentRoleBindingV03,
    ComponentSemanticBinding,
    ParameterSlotValue,
    PortableScientificExperimentSpec,
    PortableScientificExperimentSpecV03,
    RegistryComponentResolution,
    RegistryResolution,
    RegistryResolutionV02,
    ResolvedPortableExperiment,
    ResolvedPortableExperimentV03,
    normalized_component_spec_digest,
    portable_scientific_spec_digest,
    portable_scientific_spec_v03_digest,
    registry_resolution_digest,
    registry_resolution_v02_digest,
    workflow_semantic_digest,
    workflow_semantic_digest_v03,
)
from majorana_vqe.result import EXECUTION_EVIDENCE_ADAPTER, ExecutionEvidence
from majorana_vqe.standard_catalog import (
    STANDARD_IMPLEMENTATIONS,
    WorkflowComponentSelection,
    check_workflow_compatibility,
    component_by_key,
    migrate_selection_configuration,
    workflow_by_key,
)
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion, Run
from ..orm import VqeComponentSpec as VqeComponentSpecRow
from ..orm import VqeExperiment as VqeExperimentRow
from ..orm import VqeExecution as VqeExecutionRow
from ..orm import VqeObservation as VqeObservationRow
from ..orm import VqeControlledComparisonRun as VqeControlledComparisonRunRow
from ..orm import VqeControlledComparisonSpec as VqeControlledComparisonSpecRow
from ..orm import VqeWorkflowComponent as VqeWorkflowComponentRow
from . import artifacts as artifacts_repo
from ._base import NotFoundError, RepoError, require_write


class IdempotencyConflictError(RepoError):
    """The HTTP request replay key was reused for a different experiment.

    Silently returning the earlier experiment would make the caller believe
    their (different) request was accepted; failing loudly forces a fresh
    key or reconciliation instead.
    """


class InvalidWorkflowCompositionError(RepoError):
    """A workflow cannot be represented losslessly as portable schema v0.2."""


class ComparisonIntegrityError(RepoError):
    """The comparison does not reference one controlled Workflow pair."""


@dataclass(frozen=True)
class SavedWorkflowDraft:
    artifact: Artifact
    version: ArtifactVersion
    workflow_spec: VqeComponentSpecRow
    links: tuple[VqeWorkflowComponentRow, ...]
    replayed: bool


H2_REVIEW_CANDIDATE_WORKFLOW_KEY = "h2.sto3g.actual_vqe.workflow.v0_2"
H2_REVIEW_CANDIDATE_WORKFLOW_DIGEST = (
    "ae7446e666697337823c86f4d23bc7d19f75c035e38ae6e06e6b4aa8910fb1c1"
)


def _uccsd_private_runtime_binding_metadata(
    *,
    role: ComponentType,
    semantic_key: str,
    evaluator_provider: str,
) -> dict[str, Any]:
    """Resolve evidence metadata from the qualified UCCSD ansatz binding.

    The OCI runtime qualifies the bounded H2 UCCSD capability as a composition.
    Only the ansatz has a public standard-catalog implementation binding; the
    dependent configured compilation role therefore carries the same
    capability-scoped runtime identity without fabricating a catalog binding.
    """

    bindings = [
        binding
        for binding in STANDARD_IMPLEMENTATIONS
        if binding.component_semantic_key == "ansatz.uccsd.v1"
        and binding.provider == evaluator_provider
        and binding.evidence_level.value == "runtime_qualified"
        and binding.runtime_profile_id is not None
        and binding.adapter_release_id is not None
    ]
    if len(bindings) != 1:
        raise InvalidWorkflowCompositionError(
            f"no unique qualified UCCSD runtime binding for {evaluator_provider!r}"
        )
    binding = bindings[0]
    return {
        "binding_key": (binding.binding_key if role is ComponentType.ANSATZ else None),
        "configured_component_semantic_key": semantic_key,
        "evidence_level": binding.evidence_level.value,
        "runtime_qualification": "private_qualified",
        "qualification_scope": "h2_sto3g_uccsd_v1",
        "runtime_profile_id": binding.runtime_profile_id,
        "adapter_release_id": binding.adapter_release_id,
        "publication": "blocked",
    }


# --- component specs ---------------------------------------------------


def _validate_machine_validated_workflow_payload(payload: dict[str, Any]) -> None:
    """Fail closed on every workflow metadata schema admitted by this repository.

    v0.2 predates the bounded UCCSD migration and remains immutable.  v0.3 is
    admitted only for the exact private H2 migration envelope; accepting an
    arbitrary ``schema_version=0.3.0`` object here would let untyped workflow
    metadata acquire a machine-validated label before its component links are
    resolved.
    """

    schema_version = payload.get("schema_version")
    kind = payload.get("kind")
    if schema_version == "0.2.0" and isinstance(kind, str) and kind:
        return
    if schema_version != "0.3.0" or kind != "ansatz_migration_workflow_draft":
        raise ValueError(
            "machine-validated workflow requires typed v0.2 metadata or "
            "the bounded H2 UCCSD v0.3 migration envelope"
        )

    expected_values: dict[str, object] = {
        "migration": "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
        "comparison_class": "controlled_capability_migration_not_one_component_swap",
        "primary_changed_role": ComponentType.ANSATZ.value,
        "dependent_changed_roles": [ComponentType.COMPILATION_BACKEND.value],
        "required_to_not_applicable_roles": sorted(
            role.value for role in set(PORTABLE_SCIENTIFIC_ROLES) - set(H2_UCCSD_APPLICABLE_ROLES)
        ),
        "parameter_policy": "reset_all",
        "execution_status": "private_qualification_candidate",
        "publication": "blocked",
        "scientific_release": "blocked",
    }
    for field, expected in expected_values.items():
        if payload.get(field) != expected:
            raise ValueError(f"invalid H2 UCCSD workflow migration field {field!r}")
    if payload.get("evaluator_provider") not in {"qiskit", "pennylane"}:
        raise ValueError("invalid H2 UCCSD workflow migration evaluator_provider")
    try:
        uuid.UUID(str(payload["baseline_workflow_artifact_version_id"]))
    except (KeyError, ValueError) as exc:
        raise ValueError("invalid H2 UCCSD workflow migration baseline identity") from exc
    request_sha256 = payload.get("request_sha256")
    if not (
        isinstance(request_sha256, str)
        and len(request_sha256) == 64
        and all(character in "0123456789abcdef" for character in request_sha256)
    ):
        raise ValueError("invalid H2 UCCSD workflow migration request digest")


async def create_component_spec(
    scope: Scope,
    session: AsyncSession,
    *,
    artifact_version_id: uuid.UUID,
    schema_version: str,
    component_type: ComponentType,
    semantic_key: str | None = None,
    spec_json: dict[str, Any] | None = None,
    normalized_spec_sha256: str | None = None,
    machine_validation_state: MachineValidationState = MachineValidationState.UNVALIDATED,
    review_state: ReviewState = ReviewState.UNREVIEWED,
) -> VqeComponentSpecRow:
    """Attach typed VQE metadata to an existing, in-scope ArtifactVersion.

    artifact_version_id is the primary key of vqe_component_specs (ADR-0024:
    component identity IS the ArtifactVersion), so this is a create, not an
    upsert — a spec that needs to change belongs on a new ArtifactVersion,
    matching how artifacts.create_version already treats versions as
    immutable. A second create for the same artifact_version_id surfaces as
    a primary-key IntegrityError rather than silently overwriting.
    """
    require_write(scope)
    version = await artifacts_repo.get_version(scope, session, artifact_version_id)
    artifact = (
        (
            await session.execute(
                select(Artifact).where(
                    Artifact.id == version.artifact_id,
                    Artifact.workspace_id == scope.workspace_id,
                    Artifact.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .one()
    )
    payload = spec_json if spec_json is not None else {}
    if machine_validation_state is MachineValidationState.MACHINE_VALIDATED:
        if component_type in PORTABLE_SCIENTIFIC_ROLES:
            # "machine_validated" is an observed validator outcome, never a
            # caller assertion.  Parsing here means no import path can promote
            # arbitrary JSON by setting an enum value.
            parse_executable_component(component_type, payload)
        elif component_type is ComponentType.WORKFLOW:
            _validate_machine_validated_workflow_payload(payload)
        else:
            raise ValueError(
                f"no executable validator exists for {component_type.value!r}; "
                "leave machine_validation_state=unvalidated"
            )
    if review_state in {ReviewState.HUMAN_REVIEWED, ReviewState.AUTHOR_CONFIRMED}:
        if artifact.review_state != "accepted":
            raise ValueError(
                "scientific review cannot be promoted unless the owning Artifact "
                "has an accepted human review decision"
            )
    computed_digest = normalized_component_spec_digest(
        component_type=component_type,
        spec_json=payload,
    )
    if normalized_spec_sha256 is not None and normalized_spec_sha256 != computed_digest:
        raise ValueError("normalized_spec_sha256 does not match canonical component content")
    spec = VqeComponentSpecRow(
        artifact_version_id=artifact_version_id,
        schema_version=schema_version,
        component_type=component_type.value,
        semantic_key=semantic_key or artifact.slug,
        spec_json=payload,
        normalized_spec_sha256=computed_digest,
        machine_validation_state=machine_validation_state.value,
        review_state=review_state.value,
    )
    session.add(spec)
    await session.flush()
    await session.refresh(spec)
    return spec


def _readable_artifact_predicate(
    scope: Scope,
    *,
    catalog_workspace_id: uuid.UUID | None,
):
    own = Artifact.workspace_id == scope.workspace_id
    if catalog_workspace_id is None:
        return own
    published_system = (
        (Artifact.workspace_id == catalog_workspace_id)
        & (Artifact.review_state == "accepted")
        & (Artifact.publication_state == "public")
    )
    return or_(own, published_system)


async def get_component_spec(
    scope: Scope,
    session: AsyncSession,
    artifact_version_id: uuid.UUID,
    *,
    catalog_workspace_id: uuid.UUID | None = None,
) -> VqeComponentSpecRow:
    stmt = (
        select(VqeComponentSpecRow)
        .join(ArtifactVersion, VqeComponentSpecRow.artifact_version_id == ArtifactVersion.id)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            VqeComponentSpecRow.artifact_version_id == artifact_version_id,
            _readable_artifact_predicate(
                scope,
                catalog_workspace_id=catalog_workspace_id,
            ),
            Artifact.deleted_at.is_(None),
        )
    )
    spec = (await session.execute(stmt)).scalars().first()
    if spec is None:
        raise NotFoundError("vqe component spec")
    return spec


async def list_component_specs(
    scope: Scope,
    session: AsyncSession,
    *,
    component_type: ComponentType | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
    catalog_workspace_id: uuid.UUID | None = None,
) -> list[VqeComponentSpecRow]:
    stmt = (
        select(VqeComponentSpecRow)
        .join(ArtifactVersion, VqeComponentSpecRow.artifact_version_id == ArtifactVersion.id)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            _readable_artifact_predicate(
                scope,
                catalog_workspace_id=catalog_workspace_id,
            ),
            Artifact.deleted_at.is_(None),
        )
        .order_by(VqeComponentSpecRow.artifact_version_id.desc())
        .limit(limit)
    )
    if component_type is not None:
        stmt = stmt.where(VqeComponentSpecRow.component_type == component_type.value)
    if cursor is not None:
        stmt = stmt.where(VqeComponentSpecRow.artifact_version_id < cursor)
    return list((await session.execute(stmt)).scalars().all())


# --- workflow components -------------------------------------------------


async def create_workflow_component(
    scope: Scope,
    session: AsyncSession,
    *,
    workflow_artifact_version_id: uuid.UUID,
    component_role: str,
    component_artifact_version_id: uuid.UUID,
    ordinal: int,
    binding_metadata: dict[str, Any] | None = None,
    catalog_workspace_id: uuid.UUID | None = None,
) -> VqeWorkflowComponentRow:
    """Link a component into a workflow's composition.

    Both VQE component specs are resolved through the scoped repo first, so
    an invalid/cross-workspace reference, non-workflow parent, or role/type
    mismatch fails before a row is created. A duplicate (workflow, role, ordinal) surfaces as the
    uq_vqe_workflow_components_role_ordinal IntegrityError.
    """
    require_write(scope)
    workflow = await get_component_spec(scope, session, workflow_artifact_version_id)
    if workflow.component_type != ComponentType.WORKFLOW.value:
        raise InvalidWorkflowCompositionError("workflow_artifact_version_id is not a workflow")
    component = await get_component_spec(
        scope,
        session,
        component_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if component.component_type == ComponentType.WORKFLOW.value:
        raise InvalidWorkflowCompositionError("a workflow cannot be linked as a leaf component")
    if component_role != component.component_type:
        raise InvalidWorkflowCompositionError(
            f"component_role={component_role!r} does not match "
            f"component_type={component.component_type!r}"
        )
    link = VqeWorkflowComponentRow(
        id=uuid7(),
        workflow_artifact_version_id=workflow_artifact_version_id,
        component_role=component_role,
        component_artifact_version_id=component_artifact_version_id,
        ordinal=ordinal,
        binding_metadata=binding_metadata,
    )
    session.add(link)
    await session.flush()
    await session.refresh(link)
    return link


async def list_workflow_components(
    scope: Scope,
    session: AsyncSession,
    workflow_artifact_version_id: uuid.UUID,
    *,
    catalog_workspace_id: uuid.UUID | None = None,
) -> list[VqeWorkflowComponentRow]:
    await get_component_spec(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    stmt = (
        select(VqeWorkflowComponentRow)
        .where(VqeWorkflowComponentRow.workflow_artifact_version_id == workflow_artifact_version_id)
        .order_by(VqeWorkflowComponentRow.component_role, VqeWorkflowComponentRow.ordinal)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _get_unique_component_by_semantic_digest(
    scope: Scope,
    session: AsyncSession,
    *,
    semantic_key: str,
    normalized_spec_sha256: str,
    catalog_workspace_id: uuid.UUID | None,
) -> VqeComponentSpecRow:
    stmt = (
        select(VqeComponentSpecRow)
        .join(ArtifactVersion, VqeComponentSpecRow.artifact_version_id == ArtifactVersion.id)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            VqeComponentSpecRow.semantic_key == semantic_key,
            VqeComponentSpecRow.normalized_spec_sha256 == normalized_spec_sha256,
            _readable_artifact_predicate(
                scope,
                catalog_workspace_id=catalog_workspace_id,
            ),
            Artifact.deleted_at.is_(None),
        )
    )
    rows = list((await session.execute(stmt)).scalars().all())
    if not rows:
        raise NotFoundError("vqe component semantic digest")
    if len(rows) != 1:
        raise InvalidWorkflowCompositionError(
            "component semantic key and digest resolve ambiguously"
        )
    return rows[0]


async def save_component_swap_workflow_draft(
    scope: Scope,
    session: AsyncSession,
    *,
    baseline_workflow_artifact_version_id: uuid.UUID,
    baseline_template_key: str,
    changed_role: ComponentType,
    candidate_component_semantic_key: str,
    candidate_component_spec_sha256: str,
    configuration: tuple[tuple[str, str], ...],
    evaluator_provider: Literal["qiskit", "pennylane"],
    request_idempotency_key: str,
    catalog_workspace_id: uuid.UUID | None,
) -> SavedWorkflowDraft:
    """Persist one immutable structured swap draft with server-owned resolution."""

    require_write(scope)
    executable_optimizer_algorithms = {
        "optimizer.slsqp.v1": "scipy_slsqp",
        "optimizer.cobyla.v1": "scipy_cobyla",
    }
    if changed_role is not ComponentType.PARAMETER_OPTIMIZER:
        raise InvalidWorkflowCompositionError(
            "private executable swaps permit only parameter_optimizer changes"
        )
    if candidate_component_semantic_key not in executable_optimizer_algorithms:
        raise InvalidWorkflowCompositionError(
            "candidate optimizer is not admitted to the private executable slice"
        )
    baseline_spec = await get_component_spec(
        scope,
        session,
        baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if baseline_spec.component_type != ComponentType.WORKFLOW.value:
        raise InvalidWorkflowCompositionError("baseline is not a workflow")
    template = workflow_by_key(baseline_template_key)
    if baseline_spec.semantic_key not in {
        baseline_template_key,
        template.registry_semantic_key,
    }:
        raise InvalidWorkflowCompositionError(
            "baseline Registry identity does not match the requested template"
        )
    candidate_definition = component_by_key(candidate_component_semantic_key)
    if candidate_definition.component_type is not changed_role:
        raise InvalidWorkflowCompositionError("candidate component role mismatch")
    migrated = migrate_selection_configuration(
        configuration,
        candidate_component_key=candidate_component_semantic_key,
    )
    if migrated.requires_explicit_acceptance:
        raise InvalidWorkflowCompositionError(
            "configuration contains fields unsupported by the candidate"
        )
    selections = tuple(
        WorkflowComponentSelection(
            role=selection.role,
            component_semantic_key=(
                candidate_component_semantic_key
                if selection.role is changed_role
                else selection.component_semantic_key
            ),
            applicability=selection.applicability,
            configuration=migrated.migrated
            if selection.role is changed_role
            else selection.configuration,
            bound_contracts=selection.bound_contracts,
        )
        for selection in template.selections
    )
    candidate_template = dataclasses.replace(template, selections=selections)
    compatibility = check_workflow_compatibility(candidate_template)
    if not compatibility.compatible:
        raise InvalidWorkflowCompositionError(
            "candidate swap is incompatible: "
            + ",".join(issue.code for issue in compatibility.issues)
        )

    baseline_links = await list_workflow_components(
        scope,
        session,
        baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    baseline_by_role = {ComponentType(link.component_role): link for link in baseline_links}
    candidate_definition_spec = await _get_unique_component_by_semantic_digest(
        scope,
        session,
        semantic_key=candidate_component_semantic_key,
        normalized_spec_sha256=candidate_component_spec_sha256,
        catalog_workspace_id=catalog_workspace_id,
    )
    if set(baseline_by_role) != {
        selection.role for selection in selections if selection.component_semantic_key is not None
    }:
        raise InvalidWorkflowCompositionError(
            "baseline Registry composition does not match the template roles"
        )
    baseline_optimizer_link = baseline_by_role[ComponentType.PARAMETER_OPTIMIZER]
    baseline_optimizer_spec = await get_component_spec(
        scope,
        session,
        baseline_optimizer_link.component_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )

    request_payload = {
        "schema_version": "0.1.0",
        "baseline_workflow_artifact_version_id": str(baseline_workflow_artifact_version_id),
        "baseline_template_key": baseline_template_key,
        "changed_role": changed_role.value,
        "candidate_component_semantic_key": candidate_component_semantic_key,
        "candidate_component_spec_sha256": candidate_component_spec_sha256,
        "configuration": list(migrated.migrated),
        "evaluator_provider": evaluator_provider,
    }
    request_sha256 = hashlib.sha256(
        json.dumps(request_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    slug_material = f"{scope.workspace_id}:{request_idempotency_key}".encode()
    slug = f"vqe-swap-{hashlib.sha256(slug_material).hexdigest()[:32]}"
    existing = await artifacts_repo.get_artifact_by_slug(scope, session, slug)
    if existing is not None:
        if existing.current_version_id is None:
            raise IdempotencyConflictError("existing swap artifact has no version")
        version = await artifacts_repo.get_version(
            scope,
            session,
            existing.current_version_id,
        )
        metadata = version.artifact_metadata or {}
        if metadata.get("request_sha256") != request_sha256:
            raise IdempotencyConflictError(
                "Idempotency-Key was reused for a different component swap"
            )
        workflow_spec = await get_component_spec(scope, session, version.id)
        links = await list_workflow_components(scope, session, version.id)
        return SavedWorkflowDraft(existing, version, workflow_spec, tuple(links), True)

    private_qualification_candidate = baseline_spec.semantic_key == template.registry_semantic_key
    configured_optimizer_spec = candidate_definition_spec
    if private_qualification_candidate:
        configured_optimizer_payload = dict(baseline_optimizer_spec.spec_json)
        configured_optimizer_payload["algorithm"] = executable_optimizer_algorithms[
            candidate_component_semantic_key
        ]
        for field in (
            "initial_trust_region_radius_float64_hex",
            "final_trust_region_radius_float64_hex",
            "constraint_tolerance_float64_hex",
        ):
            configured_optimizer_payload.pop(field, None)
        if candidate_component_semantic_key == "optimizer.cobyla.v1":
            configured_optimizer_payload.update(
                {
                    "initial_trust_region_radius_float64_hex": "3ff0000000000000",
                    "final_trust_region_radius_float64_hex": "3e45798ee2308c3a",
                    "constraint_tolerance_float64_hex": "3d719799812dea11",
                }
            )
        configurable_payload_fields = {
            "lower_bound_float64_hex": "lower_bound_float64_hex",
            "upper_bound_float64_hex": "upper_bound_float64_hex",
            "energy_tolerance_float64_hex": "energy_tolerance_float64_hex",
            "max_objective_evaluations": "max_function_evaluations",
            "initial_trust_region_radius_float64_hex": ("initial_trust_region_radius_float64_hex"),
            "final_trust_region_radius_float64_hex": ("final_trust_region_radius_float64_hex"),
            "constraint_tolerance_float64_hex": "constraint_tolerance_float64_hex",
        }
        unsupported_private_configuration = set(dict(migrated.migrated)) - set(
            configurable_payload_fields
        )
        if unsupported_private_configuration:
            raise InvalidWorkflowCompositionError(
                "private executable swap cannot represent configuration fields: "
                + ",".join(sorted(unsupported_private_configuration))
            )
        for configuration_key, payload_key in configurable_payload_fields.items():
            configured_value = dict(migrated.migrated).get(configuration_key)
            if configured_value is None:
                continue
            configured_optimizer_payload[payload_key] = (
                int(configured_value)
                if configuration_key == "max_objective_evaluations"
                else configured_value
            )
        try:
            parse_executable_component(
                ComponentType.PARAMETER_OPTIMIZER,
                configured_optimizer_payload,
            )
        except ValueError as exc:
            raise InvalidWorkflowCompositionError(
                f"configured optimizer is not executable: {exc}"
            ) from exc
        configured_workflow_specs: dict[ComponentType, dict[str, object]] = {}
        for role, link in baseline_by_role.items():
            component = await get_component_spec(
                scope,
                session,
                link.component_artifact_version_id,
                catalog_workspace_id=catalog_workspace_id,
            )
            configured_workflow_specs[role] = (
                configured_optimizer_payload
                if role is ComponentType.PARAMETER_OPTIMIZER
                else component.spec_json
            )
        try:
            validate_h2_executable_composition(configured_workflow_specs)
        except ValueError as exc:
            raise InvalidWorkflowCompositionError(
                f"configured optimizer swap violates H2 invariants: {exc}"
            ) from exc
        configured_optimizer_digest = normalized_component_spec_digest(
            component_type=ComponentType.PARAMETER_OPTIMIZER,
            spec_json=configured_optimizer_payload,
        )
        configured_optimizer_artifact = await artifacts_repo.create_artifact(
            scope,
            session,
            slug=f"{slug}-configured-optimizer",
            title=(
                f"Configured {candidate_definition.display_name} optimizer for H2 controlled swap"
            ),
            family=Algorithm.VQE,
            framework=ContractFramework(evaluator_provider),
        )
        configured_optimizer_code = json.dumps(
            configured_optimizer_payload,
            sort_keys=True,
            indent=2,
        )
        configured_optimizer_version = await artifacts_repo.create_version(
            scope,
            session,
            configured_optimizer_artifact.id,
            qasm_version=None,
            qasm=None,
            metadata={
                "source": "vqe_component_swap_configuration",
                "definition_artifact_version_id": str(
                    candidate_definition_spec.artifact_version_id
                ),
                "definition_semantic_key": candidate_component_semantic_key,
                "definition_spec_sha256": candidate_component_spec_sha256,
                "publication": "blocked",
                "scientific_release": "blocked",
            },
            code=configured_optimizer_code,
            code_lang="json",
            fingerprint=configured_optimizer_digest,
            export_status=ExportStatus.UNSUPPORTED,
            export_reason="configured optimizer is not a circuit export",
        )
        configured_optimizer_spec = await create_component_spec(
            scope,
            session,
            artifact_version_id=configured_optimizer_version.id,
            schema_version="0.2.0",
            component_type=ComponentType.PARAMETER_OPTIMIZER,
            semantic_key=candidate_component_semantic_key,
            spec_json=configured_optimizer_payload,
            normalized_spec_sha256=configured_optimizer_digest,
            machine_validation_state=MachineValidationState.MACHINE_VALIDATED,
            review_state=ReviewState.UNREVIEWED,
        )

    resolved_links: list[tuple[ComponentType, uuid.UUID, dict[str, Any]]] = []
    implementation_by_component = {
        binding.component_semantic_key: binding
        for binding in STANDARD_IMPLEMENTATIONS
        if binding.component_semantic_key == candidate_component_semantic_key
        and binding.provider == "scipy"
    }
    for selection in selections:
        if selection.component_semantic_key is None:
            continue
        if selection.role is changed_role:
            component_version_id = configured_optimizer_spec.artifact_version_id
            binding = implementation_by_component.get(selection.component_semantic_key)
            binding_metadata = {
                "binding_key": binding.binding_key if binding else None,
                "evidence_level": binding.evidence_level.value if binding else "missing",
                "definition_artifact_version_id": str(
                    candidate_definition_spec.artifact_version_id
                ),
                "configuration_artifact_version_id": (
                    str(configured_optimizer_spec.artifact_version_id)
                    if private_qualification_candidate
                    else None
                ),
            }
        else:
            link = baseline_by_role[selection.role]
            component_version_id = link.component_artifact_version_id
            binding_metadata = link.binding_metadata or {}
        resolved_links.append((selection.role, component_version_id, binding_metadata))

    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title="H2 optimizer-swap Workflow draft",
        family=Algorithm.VQE,
        framework=ContractFramework(evaluator_provider),
        parent_artifact_id=None,
    )
    workflow_payload = {
        **request_payload,
        "schema_version": "0.2.0",
        "kind": "component_swap_workflow_draft",
        "request_sha256": request_sha256,
        "compatibility": dataclasses.asdict(compatibility),
        "execution_status": (
            "private_qualification_candidate"
            if private_qualification_candidate
            else "blocked_until_runtime_qualified"
        ),
    }
    code = json.dumps(workflow_payload, sort_keys=True, indent=2)
    version = await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "vqe_component_swap",
            "request_sha256": request_sha256,
            "baseline_workflow_artifact_version_id": str(baseline_workflow_artifact_version_id),
            "publication": "blocked",
            "scientific_release": "blocked",
        },
        code=code,
        code_lang="json",
        fingerprint=request_sha256,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="structured VQE Workflow draft is not a circuit export",
        limitations=(
            "Private owner-waived qualification candidate; public execution and "
            "scientific performance claims remain blocked."
        ),
    )
    workflow_spec = await create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.2.0",
        component_type=ComponentType.WORKFLOW,
        semantic_key=f"workflow.instance.{request_sha256}",
        spec_json=workflow_payload,
        machine_validation_state=(
            MachineValidationState.MACHINE_VALIDATED
            if private_qualification_candidate
            else MachineValidationState.UNVALIDATED
        ),
        review_state=ReviewState.UNREVIEWED,
    )
    links = tuple(
        [
            await create_workflow_component(
                scope,
                session,
                workflow_artifact_version_id=version.id,
                component_role=role.value,
                component_artifact_version_id=component_version_id,
                ordinal=0,
                binding_metadata=binding_metadata,
                catalog_workspace_id=catalog_workspace_id,
            )
            for role, component_version_id, binding_metadata in resolved_links
        ]
    )
    return SavedWorkflowDraft(artifact, version, workflow_spec, links, False)


async def save_h2_uccsd_migration_workflow_draft(
    scope: Scope,
    session: AsyncSession,
    *,
    baseline_workflow_artifact_version_id: uuid.UUID,
    evaluator_provider: Literal["qiskit", "pennylane"],
    request_idempotency_key: str,
    catalog_workspace_id: uuid.UUID | None,
) -> SavedWorkflowDraft:
    """Persist the private fixed-excitation/SLSQP -> UCCSD migration.

    This is deliberately separate from ``save_component_swap_workflow_draft``:
    the primary ansatz change also changes the dependent compilation protocol,
    makes three adaptive-only roles inapplicable, and resets all parameters.
    """

    require_write(scope)
    baseline = await get_component_spec(
        scope,
        session,
        baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if not (
        baseline.component_type == ComponentType.WORKFLOW.value
        and baseline.machine_validation_state == MachineValidationState.MACHINE_VALIDATED.value
        and baseline.review_state == ReviewState.UNREVIEWED.value
        and baseline.spec_json.get("kind") == "component_swap_workflow_draft"
        and baseline.spec_json.get("changed_role") == ComponentType.PARAMETER_OPTIMIZER.value
        and baseline.spec_json.get("candidate_component_semantic_key") == "optimizer.slsqp.v1"
        and baseline.spec_json.get("execution_status") == "private_qualification_candidate"
    ):
        raise InvalidWorkflowCompositionError(
            "UCCSD migration baseline must be the machine-validated private "
            "fixed-excitation SLSQP workflow"
        )

    await resolve_scientific_experiment_spec(
        scope,
        session,
        baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
        review_policy="h2_owner_deferred_candidate",
    )
    baseline_links = await list_workflow_components(
        scope,
        session,
        baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    baseline_by_role = {ComponentType(link.component_role): link for link in baseline_links}
    if set(baseline_by_role) != set(PORTABLE_SCIENTIFIC_ROLES):
        raise InvalidWorkflowCompositionError("SLSQP baseline does not contain all v0.2 roles")

    request_payload = {
        "schema_version": "0.1.0",
        "baseline_workflow_artifact_version_id": str(baseline_workflow_artifact_version_id),
        "migration": "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
        "comparison_class": "controlled_capability_migration_not_one_component_swap",
        "primary_changed_role": ComponentType.ANSATZ.value,
        "dependent_changed_roles": [ComponentType.COMPILATION_BACKEND.value],
        "required_to_not_applicable_roles": sorted(
            role.value for role in set(PORTABLE_SCIENTIFIC_ROLES) - set(H2_UCCSD_APPLICABLE_ROLES)
        ),
        "parameter_policy": "reset_all",
        "evaluator_provider": evaluator_provider,
    }
    request_sha256 = hashlib.sha256(
        json.dumps(request_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    slug_material = f"{scope.workspace_id}:{request_idempotency_key}".encode()
    slug = f"vqe-uccsd-migration-{hashlib.sha256(slug_material).hexdigest()[:32]}"
    existing = await artifacts_repo.get_artifact_by_slug(scope, session, slug)
    if existing is not None:
        if existing.current_version_id is None:
            raise IdempotencyConflictError("existing UCCSD migration has no version")
        version = await artifacts_repo.get_version(
            scope,
            session,
            existing.current_version_id,
        )
        if (version.artifact_metadata or {}).get("request_sha256") != request_sha256:
            raise IdempotencyConflictError(
                "Idempotency-Key was reused for a different UCCSD migration"
            )
        workflow_spec = await get_component_spec(scope, session, version.id)
        links = await list_workflow_components(scope, session, version.id)
        return SavedWorkflowDraft(existing, version, workflow_spec, tuple(links), True)

    uccsd_specs = load_packaged_h2_uccsd_executable_component_specs()
    candidate_specs: dict[ComponentType, dict[str, object]] = {}
    resolved_links: list[tuple[ComponentType, uuid.UUID, dict[str, Any]]] = []
    changed_roles = {
        ComponentType.ANSATZ,
        ComponentType.COMPILATION_BACKEND,
    }
    semantic_keys = {
        ComponentType.ANSATZ: "ansatz.uccsd.v1",
        ComponentType.COMPILATION_BACKEND: ("compilation.h2.uccsd.canonical_logical.v1"),
    }

    for role in H2_UCCSD_APPLICABLE_ROLES:
        if role not in changed_roles:
            link = baseline_by_role[role]
            component = await get_component_spec(
                scope,
                session,
                link.component_artifact_version_id,
                catalog_workspace_id=catalog_workspace_id,
            )
            baseline_payload = executable_component_scientific_payload(
                role,
                parse_executable_component(role, component.spec_json),
            )
            candidate_payload = executable_component_scientific_payload(
                role,
                parse_executable_component(role, uccsd_specs[role]),
            )
            if baseline_payload != candidate_payload:
                raise InvalidWorkflowCompositionError(
                    f"UCCSD migration would silently change preserved role {role.value!r}"
                )
            candidate_specs[role] = component.spec_json
            resolved_links.append(
                (
                    role,
                    link.component_artifact_version_id,
                    link.binding_metadata or {},
                )
            )
            continue

        configured_payload = uccsd_specs[role]
        configured_digest = normalized_component_spec_digest(
            component_type=role,
            spec_json=configured_payload,
        )
        component_artifact = await artifacts_repo.create_artifact(
            scope,
            session,
            slug=f"{slug}-{role.value}",
            title=f"Configured H2 UCCSD {role.value}",
            family=Algorithm.VQE,
            framework=ContractFramework(evaluator_provider),
        )
        component_code = json.dumps(configured_payload, sort_keys=True, indent=2)
        component_version = await artifacts_repo.create_version(
            scope,
            session,
            component_artifact.id,
            qasm_version=None,
            qasm=None,
            metadata={
                "source": "h2_uccsd_packaged_executable_seed_v0.3",
                "semantic_key": semantic_keys[role],
                "publication": "blocked",
                "scientific_release": "blocked",
            },
            code=component_code,
            code_lang="json",
            fingerprint=configured_digest,
            export_status=ExportStatus.UNSUPPORTED,
            export_reason="configured VQE component is not a circuit export",
        )
        component_spec = await create_component_spec(
            scope,
            session,
            artifact_version_id=component_version.id,
            schema_version=str(configured_payload["schema_version"]),
            component_type=role,
            semantic_key=semantic_keys[role],
            spec_json=configured_payload,
            normalized_spec_sha256=configured_digest,
            machine_validation_state=MachineValidationState.MACHINE_VALIDATED,
            review_state=ReviewState.UNREVIEWED,
        )
        candidate_specs[role] = configured_payload
        resolved_links.append(
            (
                role,
                component_spec.artifact_version_id,
                _uccsd_private_runtime_binding_metadata(
                    role=role,
                    semantic_key=semantic_keys[role],
                    evaluator_provider=evaluator_provider,
                ),
            )
        )

    try:
        validate_h2_uccsd_executable_composition(candidate_specs)
    except ValueError as exc:
        raise InvalidWorkflowCompositionError(
            f"configured UCCSD migration violates H2 invariants: {exc}"
        ) from exc

    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title="H2 fixed-excitation to UCCSD migration draft",
        family=Algorithm.VQE,
        framework=ContractFramework(evaluator_provider),
    )
    workflow_payload = {
        **request_payload,
        "schema_version": "0.3.0",
        "kind": "ansatz_migration_workflow_draft",
        "request_sha256": request_sha256,
        "execution_status": "private_qualification_candidate",
        "publication": "blocked",
        "scientific_release": "blocked",
    }
    code = json.dumps(workflow_payload, sort_keys=True, indent=2)
    version = await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "vqe_ansatz_migration",
            "request_sha256": request_sha256,
            "baseline_workflow_artifact_version_id": str(baseline_workflow_artifact_version_id),
            "publication": "blocked",
            "scientific_release": "blocked",
        },
        code=code,
        code_lang="json",
        fingerprint=request_sha256,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="structured VQE Workflow migration is not a circuit export",
        limitations=(
            "Private owner-waived qualification candidate; not a one-component "
            "comparison; public execution and scientific claims remain blocked."
        ),
    )
    workflow_spec = await create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.3.0",
        component_type=ComponentType.WORKFLOW,
        semantic_key=f"workflow.instance.{request_sha256}",
        spec_json=workflow_payload,
        machine_validation_state=MachineValidationState.MACHINE_VALIDATED,
        review_state=ReviewState.UNREVIEWED,
    )
    links = tuple(
        [
            await create_workflow_component(
                scope,
                session,
                workflow_artifact_version_id=version.id,
                component_role=role.value,
                component_artifact_version_id=component_version_id,
                ordinal=0,
                binding_metadata=binding_metadata,
                catalog_workspace_id=catalog_workspace_id,
            )
            for role, component_version_id, binding_metadata in resolved_links
        ]
    )

    # Resolve from the rows just persisted, then validate the complete
    # migration against the baseline. This prevents the stored workflow
    # metadata from becoming more authoritative than its component links.
    await resolve_uccsd_scientific_experiment_spec(
        scope,
        session,
        version.id,
        catalog_workspace_id=catalog_workspace_id,
    )
    return SavedWorkflowDraft(artifact, version, workflow_spec, links, False)


async def resolve_scientific_experiment_spec(
    scope: Scope,
    session: AsyncSession,
    workflow_artifact_version_id: uuid.UUID,
    *,
    catalog_workspace_id: uuid.UUID | None = None,
    approved_seed: int = 0,
    review_policy: Literal[
        "approved",
        "h2_owner_deferred_candidate",
    ] = "approved",
) -> ResolvedPortableExperiment | ResolvedPortableExperimentV03:
    """Build portable schema v0.2 and a separate registry-resolution proof.

    Client input selects only a Workflow. Component semantic keys, normalized
    content digests, dataset snapshot, parameter slots, and seed are all
    server-resolved from reviewed typed components or server policy.
    """
    workflow = await get_component_spec(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if workflow.component_type != ComponentType.WORKFLOW.value:
        raise InvalidWorkflowCompositionError("artifact version is not a VQE workflow")
    if workflow.spec_json.get("kind") == "ansatz_migration_workflow_draft":
        if review_policy != "h2_owner_deferred_candidate":
            raise InvalidWorkflowCompositionError(
                "private UCCSD migration requires the owner-deferred candidate policy"
            )
        return await resolve_uccsd_scientific_experiment_spec(
            scope,
            session,
            workflow_artifact_version_id,
            catalog_workspace_id=catalog_workspace_id,
            approved_seed=approved_seed,
        )
    if workflow.machine_validation_state != MachineValidationState.MACHINE_VALIDATED.value:
        raise InvalidWorkflowCompositionError("workflow is not machine validated")
    approved_review_states = {
        ReviewState.HUMAN_REVIEWED.value,
        ReviewState.AUTHOR_CONFIRMED.value,
    }
    owner_deferred_baseline = (
        workflow.review_state == ReviewState.UNREVIEWED.value
        and workflow.semantic_key == H2_REVIEW_CANDIDATE_WORKFLOW_KEY
    )
    owner_deferred_optimizer_swap = (
        workflow.review_state == ReviewState.UNREVIEWED.value
        and workflow.spec_json.get("kind") == "component_swap_workflow_draft"
        and workflow.spec_json.get("changed_role") == ComponentType.PARAMETER_OPTIMIZER.value
        and workflow.spec_json.get("candidate_component_semantic_key")
        in {"optimizer.slsqp.v1", "optimizer.cobyla.v1"}
        and workflow.spec_json.get("execution_status") == "private_qualification_candidate"
    )
    baseline_swap_components: dict[ComponentType, VqeWorkflowComponentRow] = {}
    if review_policy == "approved":
        if workflow.review_state not in approved_review_states:
            raise InvalidWorkflowCompositionError("workflow is not scientifically reviewed")
    elif not (owner_deferred_baseline or owner_deferred_optimizer_swap):
        raise InvalidWorkflowCompositionError(
            "owner-deferred execution is restricted to the frozen H2 baseline "
            "or a server-validated private optimizer swap"
        )
    elif owner_deferred_optimizer_swap:
        try:
            baseline_workflow_id = uuid.UUID(
                str(workflow.spec_json["baseline_workflow_artifact_version_id"])
            )
        except (KeyError, ValueError) as exc:
            raise InvalidWorkflowCompositionError(
                "optimizer swap lacks a valid frozen baseline identity"
            ) from exc
        baseline_workflow = await get_component_spec(
            scope,
            session,
            baseline_workflow_id,
            catalog_workspace_id=catalog_workspace_id,
        )
        if (
            baseline_workflow.semantic_key != H2_REVIEW_CANDIDATE_WORKFLOW_KEY
            or baseline_workflow.review_state != ReviewState.UNREVIEWED.value
            or baseline_workflow.machine_validation_state
            != MachineValidationState.MACHINE_VALIDATED.value
        ):
            raise InvalidWorkflowCompositionError(
                "optimizer swap baseline is not the frozen owner-deferred H2 workflow"
            )
        baseline_swap_components = {
            ComponentType(link.component_role): link
            for link in await list_workflow_components(
                scope,
                session,
                baseline_workflow_id,
                catalog_workspace_id=catalog_workspace_id,
            )
        }

    links = await list_workflow_components(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    semantic_bindings: list[ComponentSemanticBinding] = []
    registry_components: list[RegistryComponentResolution] = []
    typed_specs: dict[ComponentType, dict[str, object]] = {}
    seen_roles: set[ComponentType] = set()
    for link in links:
        try:
            role_type = ComponentType(link.component_role)
        except ValueError as exc:
            raise InvalidWorkflowCompositionError(
                f"unknown workflow component role {link.component_role!r}"
            ) from exc
        if role_type not in PORTABLE_SCIENTIFIC_ROLES:
            raise InvalidWorkflowCompositionError(
                f"PortableScientificExperimentSpec v0.2 cannot represent component role "
                f"{role_type.value!r}; add a versioned spec field before execution"
            )
        if link.ordinal != 0 or role_type in seen_roles:
            raise InvalidWorkflowCompositionError(
                f"PortableScientificExperimentSpec v0.2 requires exactly one ordinal=0 "
                f"component for role {role_type.value!r}"
            )
        component = await get_component_spec(
            scope,
            session,
            link.component_artifact_version_id,
            catalog_workspace_id=catalog_workspace_id,
        )
        if component.component_type != role_type.value:
            raise InvalidWorkflowCompositionError(
                f"workflow role {role_type.value!r} references component_type "
                f"{component.component_type!r}"
            )
        computed_digest = normalized_component_spec_digest(
            component_type=role_type,
            spec_json=component.spec_json,
        )
        if computed_digest != component.normalized_spec_sha256:
            raise InvalidWorkflowCompositionError(
                f"component {component.artifact_version_id} normalized digest mismatch"
            )
        if component.machine_validation_state != MachineValidationState.MACHINE_VALIDATED.value:
            raise InvalidWorkflowCompositionError(
                f"component {component.semantic_key!r} is not machine validated"
            )
        if review_policy == "approved":
            if component.review_state not in approved_review_states:
                raise InvalidWorkflowCompositionError(
                    f"component {component.semantic_key!r} is not scientifically reviewed"
                )
        elif owner_deferred_baseline:
            if not (
                component.review_state == ReviewState.UNREVIEWED.value
                and component.semantic_key == f"h2.sto3g.actual_vqe.v0_2.{role_type.value}"
            ):
                raise InvalidWorkflowCompositionError(
                    "owner-deferred execution encountered a non-canonical H2 candidate component"
                )
        elif role_type is ComponentType.PARAMETER_OPTIMIZER:
            expected_private_optimizers = {
                "optimizer.slsqp.v1": "scipy_slsqp",
                "optimizer.cobyla.v1": "scipy_cobyla",
            }
            if not (
                component.review_state == ReviewState.UNREVIEWED.value
                and component.semantic_key in expected_private_optimizers
                and component.spec_json.get("algorithm")
                == expected_private_optimizers[component.semantic_key]
            ):
                raise InvalidWorkflowCompositionError(
                    "private optimizer swap does not resolve to its configured component"
                )
        else:
            baseline_link = baseline_swap_components.get(role_type)
            if (
                baseline_link is None
                or baseline_link.component_artifact_version_id != component.artifact_version_id
                or component.review_state != ReviewState.UNREVIEWED.value
                or component.semantic_key != f"h2.sto3g.actual_vqe.v0_2.{role_type.value}"
            ):
                raise InvalidWorkflowCompositionError(
                    f"private optimizer swap changed fixed role {role_type.value!r}"
                )
        semantic_bindings.append(
            ComponentSemanticBinding(
                role=role_type,
                component_type=role_type,
                component_semantic_key=component.semantic_key,
                component_spec_sha256=computed_digest,
            )
        )
        registry_components.append(
            RegistryComponentResolution(
                role=role_type,
                artifact_version_id=component.artifact_version_id,
                component_semantic_key=component.semantic_key,
                component_spec_sha256=computed_digest,
            )
        )
        typed_specs[role_type] = component.spec_json
        seen_roles.add(role_type)

    missing = set(PORTABLE_SCIENTIFIC_ROLES) - seen_roles
    if missing:
        raise InvalidWorkflowCompositionError(
            "workflow is missing required scientific component roles: "
            + ", ".join(sorted(role.value for role in missing))
        )

    try:
        executable = validate_h2_executable_composition(typed_specs)
    except ValueError as exc:
        raise InvalidWorkflowCompositionError(str(exc)) from exc

    initial_slots = [
        ParameterSlotValue(
            slot_id=slot.slot_id,
            float64_hex=slot.initial_float64_hex,
        )
        for slot in executable.ansatz.parameter_slots
    ]
    scientific_spec = PortableScientificExperimentSpec(
        workflow_semantic_digest=workflow_semantic_digest(semantic_bindings),
        component_bindings=semantic_bindings,
        dataset_snapshot_sha256=executable.problem.dataset_snapshot_sha256,
        initial_parameter_slots=initial_slots,
        seed=approved_seed,
    )
    if owner_deferred_baseline and (
        scientific_spec.workflow_semantic_digest != H2_REVIEW_CANDIDATE_WORKFLOW_DIGEST
    ):
        raise InvalidWorkflowCompositionError(
            "owner-deferred H2 candidate workflow digest does not match the frozen manifest"
        )
    registry_resolution = RegistryResolution(
        workflow_artifact_version_id=workflow_artifact_version_id,
        components=registry_components,
    )
    return ResolvedPortableExperiment(
        scientific_spec=scientific_spec,
        registry_resolution=registry_resolution,
    )


async def resolve_uccsd_scientific_experiment_spec(
    scope: Scope,
    session: AsyncSession,
    workflow_artifact_version_id: uuid.UUID,
    *,
    catalog_workspace_id: uuid.UUID | None = None,
    approved_seed: int = 0,
) -> ResolvedPortableExperimentV03:
    """Resolve only the server-authored private H₂ UCCSD migration as v0.3."""

    workflow = await get_component_spec(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    expected_na_roles = sorted(
        role.value for role in set(PORTABLE_SCIENTIFIC_ROLES) - set(H2_UCCSD_APPLICABLE_ROLES)
    )
    if not (
        workflow.component_type == ComponentType.WORKFLOW.value
        and workflow.machine_validation_state == MachineValidationState.MACHINE_VALIDATED.value
        and workflow.review_state == ReviewState.UNREVIEWED.value
        and workflow.spec_json.get("kind") == "ansatz_migration_workflow_draft"
        and workflow.spec_json.get("comparison_class")
        == "controlled_capability_migration_not_one_component_swap"
        and workflow.spec_json.get("primary_changed_role") == ComponentType.ANSATZ.value
        and workflow.spec_json.get("dependent_changed_roles")
        == [ComponentType.COMPILATION_BACKEND.value]
        and workflow.spec_json.get("required_to_not_applicable_roles") == expected_na_roles
        and workflow.spec_json.get("parameter_policy") == "reset_all"
        and workflow.spec_json.get("execution_status") == "private_qualification_candidate"
    ):
        raise InvalidWorkflowCompositionError(
            "workflow is not the server-validated private H2 UCCSD migration"
        )
    try:
        baseline_workflow_id = uuid.UUID(
            str(workflow.spec_json["baseline_workflow_artifact_version_id"])
        )
    except (KeyError, ValueError) as exc:
        raise InvalidWorkflowCompositionError(
            "UCCSD migration lacks a valid SLSQP baseline identity"
        ) from exc
    baseline = await get_component_spec(
        scope,
        session,
        baseline_workflow_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if not (
        baseline.spec_json.get("kind") == "component_swap_workflow_draft"
        and baseline.spec_json.get("changed_role") == ComponentType.PARAMETER_OPTIMIZER.value
        and baseline.spec_json.get("candidate_component_semantic_key") == "optimizer.slsqp.v1"
        and baseline.spec_json.get("execution_status") == "private_qualification_candidate"
    ):
        raise InvalidWorkflowCompositionError(
            "UCCSD migration baseline is not the private SLSQP workflow"
        )

    baseline_resolved = await resolve_scientific_experiment_spec(
        scope,
        session,
        baseline_workflow_id,
        catalog_workspace_id=catalog_workspace_id,
        approved_seed=approved_seed,
        review_policy="h2_owner_deferred_candidate",
    )
    baseline_links = {
        ComponentType(link.component_role): link
        for link in await list_workflow_components(
            scope,
            session,
            baseline_workflow_id,
            catalog_workspace_id=catalog_workspace_id,
        )
    }
    links = await list_workflow_components(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if len(links) != len(H2_UCCSD_APPLICABLE_ROLES):
        raise InvalidWorkflowCompositionError(
            "UCCSD workflow must contain exactly its 11 applicable role links"
        )

    seen_roles: set[ComponentType] = set()
    typed_specs: dict[ComponentType, dict[str, object]] = {}
    scientific_by_role: dict[ComponentType, tuple[str, str]] = {}
    registry_components: list[RegistryComponentResolution] = []
    changed_roles = {
        ComponentType.ANSATZ,
        ComponentType.COMPILATION_BACKEND,
    }
    expected_changed_keys = {
        ComponentType.ANSATZ: "ansatz.uccsd.v1",
        ComponentType.COMPILATION_BACKEND: ("compilation.h2.uccsd.canonical_logical.v1"),
    }
    for link in links:
        try:
            role = ComponentType(link.component_role)
        except ValueError as exc:
            raise InvalidWorkflowCompositionError(
                f"unknown UCCSD workflow role {link.component_role!r}"
            ) from exc
        if role not in H2_UCCSD_APPLICABLE_ROLES or link.ordinal != 0 or role in seen_roles:
            raise InvalidWorkflowCompositionError(
                f"invalid or duplicate UCCSD workflow role {role.value!r}"
            )
        component = await get_component_spec(
            scope,
            session,
            link.component_artifact_version_id,
            catalog_workspace_id=catalog_workspace_id,
        )
        if (
            component.component_type != role.value
            or component.machine_validation_state != MachineValidationState.MACHINE_VALIDATED.value
            or component.review_state != ReviewState.UNREVIEWED.value
        ):
            raise InvalidWorkflowCompositionError(
                f"UCCSD component {role.value!r} violates private validation policy"
            )
        full_digest = normalized_component_spec_digest(
            component_type=role,
            spec_json=component.spec_json,
        )
        if full_digest != component.normalized_spec_sha256:
            raise InvalidWorkflowCompositionError(
                f"UCCSD component {role.value!r} normalized digest mismatch"
            )
        if role in changed_roles:
            if component.semantic_key != expected_changed_keys[role]:
                raise InvalidWorkflowCompositionError(
                    f"UCCSD changed role {role.value!r} has the wrong semantic key"
                )
        else:
            baseline_link = baseline_links.get(role)
            if (
                baseline_link is None
                or baseline_link.component_artifact_version_id != component.artifact_version_id
            ):
                raise InvalidWorkflowCompositionError(
                    f"UCCSD migration changed preserved role {role.value!r}"
                )

        parsed = parse_executable_component(role, component.spec_json)
        scientific_payload = executable_component_scientific_payload(role, parsed)
        scientific_digest = normalized_component_spec_digest(
            component_type=role,
            spec_json=scientific_payload,
        )
        typed_specs[role] = component.spec_json
        scientific_by_role[role] = (component.semantic_key, scientific_digest)
        registry_components.append(
            RegistryComponentResolution(
                role=role,
                artifact_version_id=component.artifact_version_id,
                component_semantic_key=component.semantic_key,
                component_spec_sha256=scientific_digest,
            )
        )
        seen_roles.add(role)
    if seen_roles != set(H2_UCCSD_APPLICABLE_ROLES):
        raise InvalidWorkflowCompositionError("UCCSD workflow applicable role set mismatch")

    try:
        executable = validate_h2_uccsd_executable_composition(typed_specs)
    except ValueError as exc:
        raise InvalidWorkflowCompositionError(str(exc)) from exc
    bindings: list[ComponentRoleBindingV03] = []
    for role in PORTABLE_SCIENTIFIC_ROLES:
        if role not in seen_roles:
            bindings.append(
                ComponentRoleBindingV03(
                    role=role,
                    component_type=role,
                    applicability="not_applicable",
                )
            )
            continue
        semantic_key, scientific_digest = scientific_by_role[role]
        bindings.append(
            ComponentRoleBindingV03(
                role=role,
                component_type=role,
                component_semantic_key=semantic_key,
                component_spec_sha256=scientific_digest,
            )
        )
    scientific_spec = PortableScientificExperimentSpecV03(
        workflow_semantic_digest=workflow_semantic_digest_v03(bindings),
        component_bindings=bindings,
        dataset_snapshot_sha256=executable.problem.dataset_snapshot_sha256,
        initial_parameter_slots=[
            ParameterSlotValue(
                slot_id=slot.slot_id,
                float64_hex=slot.initial_float64_hex,
            )
            for slot in executable.ansatz.parameter_slots
        ],
        seed=approved_seed,
    )
    registry_resolution = RegistryResolutionV02(
        workflow_artifact_version_id=workflow_artifact_version_id,
        components=registry_components,
    )
    resolved = ResolvedPortableExperimentV03(
        scientific_spec=scientific_spec,
        registry_resolution=registry_resolution,
    )

    baseline_specs: dict[ComponentType, dict[str, object]] = {}
    baseline_v03_bindings: list[ComponentRoleBindingV03] = []
    for role, link in baseline_links.items():
        component = await get_component_spec(
            scope,
            session,
            link.component_artifact_version_id,
            catalog_workspace_id=catalog_workspace_id,
        )
        baseline_specs[role] = component.spec_json
        baseline_scientific_payload = executable_component_scientific_payload(
            role,
            parse_executable_component(role, component.spec_json),
        )
        baseline_v03_bindings.append(
            ComponentRoleBindingV03(
                role=role,
                component_type=role,
                component_semantic_key=component.semantic_key,
                component_spec_sha256=normalized_component_spec_digest(
                    component_type=role,
                    spec_json=baseline_scientific_payload,
                ),
            )
        )
    baseline_executable = validate_h2_executable_composition(baseline_specs)
    baseline_v03_spec = PortableScientificExperimentSpecV03(
        workflow_semantic_digest=workflow_semantic_digest_v03(baseline_v03_bindings),
        component_bindings=baseline_v03_bindings,
        dataset_snapshot_sha256=(baseline_resolved.scientific_spec.dataset_snapshot_sha256),
        initial_parameter_slots=baseline_resolved.scientific_spec.initial_parameter_slots,
        seed=baseline_resolved.scientific_spec.seed,
    )
    build_h2_fixed_to_uccsd_migration(
        baseline_spec=baseline_v03_spec,
        baseline_source_spec_v02_sha256=portable_scientific_spec_digest(
            baseline_resolved.scientific_spec
        ),
        candidate_spec=scientific_spec,
        baseline_hamiltonian_sha256=H2_STO3G_HAMILTONIAN_DIGEST_SHA256,
        candidate_hamiltonian_sha256=H2_STO3G_HAMILTONIAN_DIGEST_SHA256,
        baseline_reference_energy_float64_hex=(
            baseline_executable.evaluation.reference_energy_float64_hex
        ),
        candidate_reference_energy_float64_hex=(executable.evaluation.reference_energy_float64_hex),
    )
    return resolved


# --- experiments -----------------------------------------------------------


def _experiment_matches(
    existing: VqeExperimentRow,
    *,
    workflow_artifact_version_id: uuid.UUID,
    scientific_spec_sha256: str,
) -> bool:
    return (
        existing.workflow_artifact_version_id == workflow_artifact_version_id
        and existing.scientific_spec_sha256 == scientific_spec_sha256
    )


async def find_experiment_by_request_idempotency_key(
    scope: Scope, session: AsyncSession, request_idempotency_key: str
) -> VqeExperimentRow | None:
    stmt = select(VqeExperimentRow).where(
        VqeExperimentRow.workspace_id == scope.workspace_id,
        VqeExperimentRow.request_idempotency_key == request_idempotency_key,
    )
    return (await session.execute(stmt)).scalars().first()


async def create_experiment(
    scope: Scope,
    session: AsyncSession,
    *,
    workflow_artifact_version_id: uuid.UUID,
    resolved: ResolvedPortableExperiment | ResolvedPortableExperimentV03,
    request_idempotency_key: str | None = None,
    catalog_workspace_id: uuid.UUID | None = None,
) -> VqeExperimentRow:
    """Persist an immutable ScientificExperimentSpec (ADR-0024 spec/binding
    separation). Deliberately does not create a `runs` row or enqueue a job:
    the portable experiment remains framework-independent. A separate
    execution mutation may later bind it to a server-owned candidate or
    promoted ExecutionBinding and durable Run.

    Both digests are recomputed here from validated models. Route callers
    cannot supply a digest independently from its JSON payload.

    Reusing request_idempotency_key for a request naming a different workflow or
    spec digest raises IdempotencyConflictError instead of silently
    returning the earlier experiment. A concurrent creator racing the same
    key is resolved by the partial unique index
    (ix_vqe_experiments_workspace_request_idempotency): the loser rolls back and
    re-reads the winner.
    """
    require_write(scope)
    workflow = await get_component_spec(
        scope,
        session,
        workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if workflow.component_type != ComponentType.WORKFLOW.value:
        raise InvalidWorkflowCompositionError("workflow_artifact_version_id is not a workflow")
    if resolved.registry_resolution.workflow_artifact_version_id != workflow_artifact_version_id:
        raise InvalidWorkflowCompositionError("registry resolution names a different workflow")
    if isinstance(resolved, ResolvedPortableExperimentV03):
        scientific_spec_sha256 = portable_scientific_spec_v03_digest(resolved.scientific_spec)
        resolution_sha256 = registry_resolution_v02_digest(resolved.registry_resolution)
    else:
        scientific_spec_sha256 = portable_scientific_spec_digest(resolved.scientific_spec)
        resolution_sha256 = registry_resolution_digest(resolved.registry_resolution)

    if request_idempotency_key is not None:
        existing = await find_experiment_by_request_idempotency_key(
            scope, session, request_idempotency_key
        )
        if existing is not None:
            if not _experiment_matches(
                existing,
                workflow_artifact_version_id=workflow_artifact_version_id,
                scientific_spec_sha256=scientific_spec_sha256,
            ):
                raise IdempotencyConflictError(
                    f"request idempotency key {request_idempotency_key!r} "
                    "was already used for a different experiment"
                )
            return existing

    experiment = VqeExperimentRow(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        schema_version=resolved.scientific_spec.schema_version,
        workflow_artifact_version_id=workflow_artifact_version_id,
        scientific_spec_json=resolved.scientific_spec.model_dump(mode="json"),
        scientific_spec_sha256=scientific_spec_sha256,
        registry_resolution_json=resolved.registry_resolution.model_dump(mode="json"),
        registry_resolution_sha256=resolution_sha256,
        request_idempotency_key=request_idempotency_key,
    )
    session.add(experiment)
    try:
        await session.flush()
    except IntegrityError:
        if request_idempotency_key is None:
            raise
        # A concurrent creator committed the same key between our lookup and
        # this flush; rollback discards this session's uncommitted insert
        # and expires its ORM objects so the re-read below is fresh.
        await session.rollback()
        winner = await find_experiment_by_request_idempotency_key(
            scope, session, request_idempotency_key
        )
        if winner is None:
            raise
        if not _experiment_matches(
            winner,
            workflow_artifact_version_id=workflow_artifact_version_id,
            scientific_spec_sha256=scientific_spec_sha256,
        ):
            raise IdempotencyConflictError(
                f"request idempotency key {request_idempotency_key!r} "
                "was already used for a different experiment"
            ) from None
        return winner
    await session.refresh(experiment)
    return experiment


async def get_experiment(
    scope: Scope, session: AsyncSession, experiment_id: uuid.UUID
) -> VqeExperimentRow:
    stmt = select(VqeExperimentRow).where(
        VqeExperimentRow.id == experiment_id,
        VqeExperimentRow.workspace_id == scope.workspace_id,
    )
    experiment = (await session.execute(stmt)).scalars().first()
    if experiment is None:
        raise NotFoundError("vqe experiment")
    return experiment


async def list_experiments(
    scope: Scope,
    session: AsyncSession,
    *,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[VqeExperimentRow]:
    stmt = (
        select(VqeExperimentRow)
        .where(VqeExperimentRow.workspace_id == scope.workspace_id)
        .order_by(VqeExperimentRow.id.desc())
        .limit(limit)
    )
    if cursor is not None:
        stmt = stmt.where(VqeExperimentRow.id < cursor)
    return list((await session.execute(stmt)).scalars().all())


# --- controlled comparisons -----------------------------------------------


def _canonical_sha256(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _validate_concrete_comparison_configuration(
    *,
    label: str,
    declared: dict[str, str],
    optimizer_spec_json: dict[str, Any],
) -> None:
    """Bind client-facing comparison labels to an executable optimizer spec.

    Structured-only definitions may not expose provider configuration yet.  A
    concrete executable optimizer does, and accepting invented or mismatched
    fields there would let a comparison claim a change that the immutable
    Workflow does not contain.
    """

    if "algorithm" not in optimizer_spec_json:
        return
    if "algorithm" not in declared:
        raise ComparisonIntegrityError(
            f"{label} configuration must declare the server-resolved algorithm"
        )
    for key, value in declared.items():
        actual = optimizer_spec_json.get(key)
        if actual is None or isinstance(actual, (dict, list)):
            raise ComparisonIntegrityError(
                f"{label} configuration field is not present in the immutable optimizer"
            )
        canonical_actual = (
            json.dumps(actual, separators=(",", ":")) if isinstance(actual, bool) else str(actual)
        )
        if value != canonical_actual:
            raise ComparisonIntegrityError(
                f"{label} configuration does not match the immutable optimizer"
            )


async def create_controlled_comparison_spec(
    scope: Scope,
    session: AsyncSession,
    *,
    spec: ControlledComparisonSpecV1,
    request_idempotency_key: str,
    catalog_workspace_id: uuid.UUID | None = None,
) -> VqeControlledComparisonSpecRow:
    require_write(scope)
    if spec.changed_role is not ComponentType.PARAMETER_OPTIMIZER:
        raise ComparisonIntegrityError("Phase 7.6 permits only an optimizer swap")
    for version_id in (
        spec.baseline_workflow_artifact_version_id,
        spec.candidate_workflow_artifact_version_id,
    ):
        row = await get_component_spec(
            scope,
            session,
            version_id,
            catalog_workspace_id=catalog_workspace_id,
        )
        if row.component_type != ComponentType.WORKFLOW.value:
            raise ComparisonIntegrityError("comparison endpoint requires Workflow versions")
    baseline_links = await list_workflow_components(
        scope,
        session,
        spec.baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    candidate_links = await list_workflow_components(
        scope,
        session,
        spec.candidate_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )

    async def role_components(
        links: list[VqeWorkflowComponentRow],
    ) -> dict[ComponentType, VqeComponentSpecRow]:
        result: dict[ComponentType, VqeComponentSpecRow] = {}
        for link in links:
            role = ComponentType(link.component_role)
            if role in result:
                raise ComparisonIntegrityError("duplicate Workflow component role")
            component = await get_component_spec(
                scope,
                session,
                link.component_artifact_version_id,
                catalog_workspace_id=catalog_workspace_id,
            )
            result[role] = component
        return result

    baseline_components = await role_components(baseline_links)
    candidate_components = await role_components(candidate_links)
    baseline_digests = {
        role: component.normalized_spec_sha256 for role, component in baseline_components.items()
    }
    candidate_digests = {
        role: component.normalized_spec_sha256 for role, component in candidate_components.items()
    }
    if set(baseline_digests) != set(candidate_digests):
        raise ComparisonIntegrityError("Workflow role sets differ")
    observed_changed = {
        role for role in baseline_digests if baseline_digests[role] != candidate_digests[role]
    }
    if observed_changed != {spec.changed_role}:
        raise ComparisonIntegrityError("Workflow pair must differ in exactly the declared role")
    server_fixed = {
        role: digest for role, digest in baseline_digests.items() if role is not spec.changed_role
    }
    if server_fixed != spec.fixed_component_digests:
        raise ComparisonIntegrityError("fixed component digests are not server-derived values")
    _validate_concrete_comparison_configuration(
        label="baseline",
        declared=spec.baseline_configuration,
        optimizer_spec_json=baseline_components[ComponentType.PARAMETER_OPTIMIZER].spec_json,
    )
    _validate_concrete_comparison_configuration(
        label="candidate",
        declared=spec.candidate_configuration,
        optimizer_spec_json=candidate_components[ComponentType.PARAMETER_OPTIMIZER].spec_json,
    )

    payload = spec.model_dump(mode="json")
    digest = _canonical_sha256(payload)
    existing = (
        (
            await session.execute(
                select(VqeControlledComparisonSpecRow).where(
                    VqeControlledComparisonSpecRow.workspace_id == scope.workspace_id,
                    VqeControlledComparisonSpecRow.request_idempotency_key
                    == request_idempotency_key,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        if existing.spec_sha256 != digest:
            raise IdempotencyConflictError(
                "comparison idempotency key was used for different content"
            )
        return existing
    row = VqeControlledComparisonSpecRow(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        baseline_workflow_artifact_version_id=spec.baseline_workflow_artifact_version_id,
        candidate_workflow_artifact_version_id=spec.candidate_workflow_artifact_version_id,
        changed_role=spec.changed_role.value,
        spec_json=payload,
        spec_sha256=digest,
        request_idempotency_key=request_idempotency_key,
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError:
        winner = (
            (
                await session.execute(
                    select(VqeControlledComparisonSpecRow).where(
                        VqeControlledComparisonSpecRow.workspace_id == scope.workspace_id,
                        VqeControlledComparisonSpecRow.request_idempotency_key
                        == request_idempotency_key,
                    )
                )
            )
            .scalars()
            .first()
        )
        if winner is None:
            raise
        if winner.spec_sha256 != digest:
            raise IdempotencyConflictError(
                "comparison idempotency key was used for different content"
            ) from None
        return winner
    await session.refresh(row)
    return row


async def get_controlled_comparison_spec(
    scope: Scope,
    session: AsyncSession,
    comparison_spec_id: uuid.UUID,
) -> VqeControlledComparisonSpecRow:
    row = (
        (
            await session.execute(
                select(VqeControlledComparisonSpecRow).where(
                    VqeControlledComparisonSpecRow.id == comparison_spec_id,
                    VqeControlledComparisonSpecRow.workspace_id == scope.workspace_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise NotFoundError("controlled comparison spec")
    return row


async def append_controlled_comparison_run(
    scope: Scope,
    session: AsyncSession,
    *,
    run: ControlledComparisonRunV1,
) -> VqeControlledComparisonRunRow:
    require_write(scope)
    spec_row = await get_controlled_comparison_spec(scope, session, run.comparison_spec_id)
    baseline_execution = await get_execution(scope, session, run.baseline_execution_id)
    candidate_execution = await get_execution(scope, session, run.candidate_execution_id)
    baseline_experiment = await get_experiment(scope, session, baseline_execution.experiment_id)
    candidate_experiment = await get_experiment(scope, session, candidate_execution.experiment_id)
    if (
        baseline_experiment.workflow_artifact_version_id
        != spec_row.baseline_workflow_artifact_version_id
        or candidate_experiment.workflow_artifact_version_id
        != spec_row.candidate_workflow_artifact_version_id
    ):
        raise ComparisonIntegrityError(
            "execution pair does not belong to the comparison Workflow pair"
        )
    payload = run.model_dump(mode="json")
    row = VqeControlledComparisonRunRow(
        id=uuid7(),
        comparison_spec_id=run.comparison_spec_id,
        baseline_execution_id=run.baseline_execution_id,
        candidate_execution_id=run.candidate_execution_id,
        status=run.status.value,
        run_json=payload,
        run_sha256=_canonical_sha256(payload),
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def finalize_controlled_comparison_run(
    scope: Scope,
    session: AsyncSession,
    *,
    comparison_spec_id: uuid.UUID,
    baseline_execution_id: uuid.UUID,
    candidate_execution_id: uuid.UUID,
) -> VqeControlledComparisonRunRow:
    """Recompute and append one provider-specific controlled comparison."""

    spec_row = await get_controlled_comparison_spec(scope, session, comparison_spec_id)
    existing_run = (
        (
            await session.execute(
                select(VqeControlledComparisonRunRow).where(
                    VqeControlledComparisonRunRow.comparison_spec_id == comparison_spec_id,
                    VqeControlledComparisonRunRow.baseline_execution_id == baseline_execution_id,
                    VqeControlledComparisonRunRow.candidate_execution_id == candidate_execution_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing_run is not None:
        return existing_run
    spec = ControlledComparisonSpecV1.model_validate(spec_row.spec_json)
    baseline_execution = await get_execution(scope, session, baseline_execution_id)
    candidate_execution = await get_execution(scope, session, candidate_execution_id)
    if baseline_execution.status != "succeeded" or candidate_execution.status != "succeeded":
        raise ComparisonIntegrityError("comparison executions must both have succeeded")
    baseline_experiment = await get_experiment(scope, session, baseline_execution.experiment_id)
    candidate_experiment = await get_experiment(scope, session, candidate_execution.experiment_id)
    baseline_observations = [
        item
        for item in await list_observations(scope, session, baseline_execution.id)
        if item.status == "succeeded"
    ]
    candidate_observations = [
        item
        for item in await list_observations(scope, session, candidate_execution.id)
        if item.status == "succeeded"
    ]
    if not baseline_observations or not candidate_observations:
        raise ComparisonIntegrityError("successful comparison execution lacks evidence")
    baseline_observation = baseline_observations[-1]
    candidate_observation = candidate_observations[-1]

    def bindings(experiment: VqeExperimentRow) -> dict[ComponentType, dict[str, Any]]:
        return {
            ComponentType(item["role"]): item
            for item in experiment.scientific_spec_json["component_bindings"]
        }

    baseline_bindings = bindings(baseline_experiment)
    candidate_bindings = bindings(candidate_experiment)
    fixed_roles = set(baseline_bindings) - {spec.changed_role}
    fixed_binding_match = all(
        baseline_bindings[role] == candidate_bindings.get(role) for role in fixed_roles
    )
    declared_fixed_match = all(
        baseline_bindings.get(role, {}).get("component_spec_sha256") == digest
        for role, digest in spec.fixed_component_digests.items()
    )
    baseline_changed = baseline_bindings.get(spec.changed_role)
    candidate_changed = candidate_bindings.get(spec.changed_role)
    changed_role_only = (
        set(baseline_bindings) == set(candidate_bindings)
        and fixed_binding_match
        and baseline_changed is not None
        and candidate_changed is not None
        and baseline_changed != candidate_changed
    )
    baseline_result = baseline_observation.result_contract_json
    candidate_result = candidate_observation.result_contract_json

    def comparable_resources(result: dict[str, Any]) -> dict[str, Any]:
        return {
            item["stage"]: item
            for item in result["resources"]
            if item["stage"] in {"canonical_logical", "common_basis_compiled"}
        }

    invariant_audit = {
        "workflow_pair_matches_spec": (
            baseline_experiment.workflow_artifact_version_id
            == spec.baseline_workflow_artifact_version_id
            and candidate_experiment.workflow_artifact_version_id
            == spec.candidate_workflow_artifact_version_id
        ),
        "same_component_roles": set(baseline_bindings) == set(candidate_bindings),
        "only_declared_role_changed": changed_role_only,
        "declared_fixed_digests_match": declared_fixed_match,
        "same_dataset_snapshot": (
            baseline_experiment.scientific_spec_json["dataset_snapshot_sha256"]
            == candidate_experiment.scientific_spec_json["dataset_snapshot_sha256"]
        ),
        "same_initial_parameters": (
            baseline_experiment.scientific_spec_json["initial_parameter_slots"]
            == candidate_experiment.scientific_spec_json["initial_parameter_slots"]
        ),
        "same_seed": (
            baseline_experiment.scientific_spec_json["seed"]
            == candidate_experiment.scientific_spec_json["seed"]
        ),
        "same_evaluator_provider": (baseline_execution.framework == candidate_execution.framework),
        "same_runtime_profile": (
            baseline_execution.runtime_profile_id == candidate_execution.runtime_profile_id
        ),
        "same_runtime_image": (
            baseline_execution.runtime_image_digest == candidate_execution.runtime_image_digest
        ),
        "same_adapter_release": (
            baseline_execution.adapter_release_id == candidate_execution.adapter_release_id
        ),
        "same_canonical_input": (
            baseline_result.get("hamiltonian_exact_digest")
            == candidate_result.get("hamiltonian_exact_digest")
            and baseline_result.get("initial_parameters_sha256")
            == candidate_result.get("initial_parameters_sha256")
            and baseline_result.get("ansatz_semantic_digest")
            == candidate_result.get("ansatz_semantic_digest")
            and baseline_result.get("canonical_circuit_sha256")
            == candidate_result.get("canonical_circuit_sha256")
            and baseline_result.get("compilation_protocol_sha256")
            == candidate_result.get("compilation_protocol_sha256")
        ),
        "same_canonical_circuit_metrics": (
            comparable_resources(baseline_result) == comparable_resources(candidate_result)
        ),
    }

    def metric_summary(
        observation: VqeObservationRow,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        trajectory = result.get("energy_trajectory") or []
        return {
            "execution_id": str(observation.execution_id),
            "result_contract_sha256": observation.result_contract_sha256,
            "optimization": {
                "best_energy_ha": result["best_energy_ha"],
                "absolute_error_ha": result["absolute_error_ha"],
                "converged": result["converged"],
                "iterations": result["iterations"],
                "optimizer_work": result["optimizer_work"],
                "final_parameters": result["final_parameters"],
                "final_state_fidelity": result["final_state_fidelity"],
                "trajectory_sha256": _canonical_sha256(trajectory),
            },
            "resources": comparable_resources(result),
            "wall_time_s": result.get("supplementary_evidence", {}).get("wall_time_s"),
        }

    run = ControlledComparisonRunV1(
        comparison_spec_id=comparison_spec_id,
        baseline_execution_id=baseline_execution_id,
        candidate_execution_id=candidate_execution_id,
        status=(
            ControlledComparisonStatus.COMPARABLE
            if all(invariant_audit.values())
            else ControlledComparisonStatus.COMPARABILITY_FAILED
        ),
        invariant_audit=invariant_audit,
        metric_observations={
            "framework": baseline_execution.framework,
            "baseline": metric_summary(baseline_observation, baseline_result),
            "candidate": metric_summary(candidate_observation, candidate_result),
        },
        terminal_reason=(
            None
            if all(invariant_audit.values())
            else "server-recomputed controlled-comparison invariant failed"
        ),
    )
    return await append_controlled_comparison_run(scope, session, run=run)


async def list_controlled_comparison_runs(
    scope: Scope,
    session: AsyncSession,
    comparison_spec_id: uuid.UUID,
) -> list[VqeControlledComparisonRunRow]:
    await get_controlled_comparison_spec(scope, session, comparison_spec_id)
    return list(
        (
            await session.execute(
                select(VqeControlledComparisonRunRow)
                .where(VqeControlledComparisonRunRow.comparison_spec_id == comparison_spec_id)
                .order_by(VqeControlledComparisonRunRow.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


# --- executions and observations -------------------------------------------


def _execution_identity(
    *,
    scientific_spec_sha256: str,
    binding: ExecutionBinding,
) -> str:
    payload = {
        "protocol": "majorana-vqe-execution-identity-v1",
        "scientific_spec_sha256": scientific_spec_sha256,
        "binding": binding.model_dump(mode="json"),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


async def create_execution(
    scope: Scope,
    session: AsyncSession,
    experiment_id: uuid.UUID,
    *,
    binding: ExecutionBinding,
) -> VqeExecutionRow:
    """Bind one portable experiment to one server-approved runtime profile."""
    require_write(scope)
    experiment = await get_experiment(scope, session, experiment_id)
    identity = _execution_identity(
        scientific_spec_sha256=experiment.scientific_spec_sha256,
        binding=binding,
    )
    existing = (
        (
            await session.execute(
                select(VqeExecutionRow).where(
                    VqeExecutionRow.experiment_id == experiment.id,
                    VqeExecutionRow.execution_identity_sha256 == identity,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    execution = VqeExecutionRow(
        id=uuid7(),
        experiment_id=experiment.id,
        run_id=None,
        framework=binding.framework.value,
        provider_versions=binding.provider_versions,
        runtime_profile_id=binding.runtime_profile_id,
        runtime_image_digest=binding.container_digest,
        adapter_release_id=binding.adapter_release_id,
        execution_binding_json=binding.model_dump(mode="json"),
        execution_identity_sha256=identity,
        status="planned",
    )
    try:
        async with session.begin_nested():
            session.add(execution)
            await session.flush()
    except IntegrityError:
        winner = (
            (
                await session.execute(
                    select(VqeExecutionRow).where(
                        VqeExecutionRow.experiment_id == experiment.id,
                        VqeExecutionRow.execution_identity_sha256 == identity,
                    )
                )
            )
            .scalars()
            .first()
        )
        if winner is None:
            raise
        return winner
    await session.refresh(execution)
    return execution


async def bind_execution_run(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    run_id: uuid.UUID,
) -> VqeExecutionRow:
    """Attach the one durable Run that owns this execution's job lifecycle."""
    require_write(scope)
    execution = await get_execution(scope, session, execution_id)
    run = (
        (
            await session.execute(
                select(Run).where(
                    Run.id == run_id,
                    Run.workspace_id == scope.workspace_id,
                    Run.user_id == scope.user_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if run is None:
        raise NotFoundError("run")
    experiment = await get_experiment(scope, session, execution.experiment_id)
    if run.mode != "execute":
        raise ValueError("VQE execution requires an execute-mode durable run")
    if run.framework != execution.framework:
        raise ValueError("VQE run framework does not match the execution binding")
    if run.seed != int(experiment.scientific_spec_json["seed"]):
        raise ValueError("VQE run seed does not match the portable scientific spec")
    if run.status != "queued":
        raise ValueError("VQE execution can bind only a queued durable run")
    if execution.run_id is not None:
        if execution.run_id == run.id:
            return execution
        raise ValueError("VQE execution is already bound to a different run")
    result = await session.execute(
        update(VqeExecutionRow)
        .where(
            VqeExecutionRow.id == execution.id,
            VqeExecutionRow.status == "planned",
            VqeExecutionRow.run_id.is_(None),
        )
        .values(run_id=run.id, status="queued", updated_at=func.now())
    )
    if result.rowcount != 1:
        session.expire(execution)
        # `execution` is expired so every ORM attribute access may perform IO.
        # Reuse the immutable function argument instead of reading `.id` from
        # the expired instance outside SQLAlchemy's async greenlet context.
        winner = await get_execution(scope, session, execution_id)
        if winner.run_id == run.id and winner.status in {
            "queued",
            "running",
            "succeeded",
            "failed",
            "cancelled",
        }:
            return winner
        raise ValueError("VQE execution left planned state before run binding")
    await session.refresh(execution)
    return execution


_EXECUTION_TRANSITIONS = {
    "planned": {"queued", "cancelled"},
    "queued": {"running", "cancelled", "failed"},
    "running": {"succeeded", "cancelled", "failed"},
    "succeeded": set(),
    "cancelled": set(),
    "failed": set(),
}


async def transition_execution(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    new_status: Literal[
        "queued",
        "running",
        "succeeded",
        "cancelled",
        "failed",
    ],
) -> VqeExecutionRow:
    """Apply the closed execution lifecycle with an optimistic state fence."""
    require_write(scope)
    execution = await get_execution(scope, session, execution_id)
    current = execution.status
    if new_status == current:
        return execution
    if new_status not in _EXECUTION_TRANSITIONS.get(current, set()):
        raise ValueError(f"illegal VQE execution transition {current!r} -> {new_status!r}")
    result = await session.execute(
        update(VqeExecutionRow)
        .where(
            VqeExecutionRow.id == execution.id,
            VqeExecutionRow.status == current,
        )
        .values(status=new_status, updated_at=func.now())
    )
    if result.rowcount != 1:
        raise ValueError("VQE execution state changed concurrently")
    await session.refresh(execution)
    return execution


async def get_execution(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    for_update: bool = False,
) -> VqeExecutionRow:
    stmt = (
        select(VqeExecutionRow)
        .join(VqeExperimentRow, VqeExecutionRow.experiment_id == VqeExperimentRow.id)
        .where(
            VqeExecutionRow.id == execution_id,
            VqeExperimentRow.workspace_id == scope.workspace_id,
        )
        .execution_options(populate_existing=True)
    )
    if for_update:
        stmt = stmt.with_for_update(of=VqeExecutionRow)
    execution = (await session.execute(stmt)).scalars().first()
    if execution is None:
        raise NotFoundError("vqe execution")
    return execution


async def list_executions(
    scope: Scope,
    session: AsyncSession,
    experiment_id: uuid.UUID,
) -> list[VqeExecutionRow]:
    await get_experiment(scope, session, experiment_id)
    stmt = (
        select(VqeExecutionRow)
        .where(VqeExecutionRow.experiment_id == experiment_id)
        .order_by(VqeExecutionRow.id)
    )
    return list((await session.execute(stmt)).scalars().all())


async def append_observation(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    attempt: int | None,
    evidence: ExecutionEvidence | dict[str, Any],
    detail_object_uri: str | None = None,
    detail_sha256: str | None = None,
    detail_size_bytes: int | None = None,
    evidence_json: dict[str, Any] | None = None,
) -> VqeObservationRow:
    """Append one execution-evidence row. Never call this to correct a prior
    attempt — a retry is `attempt + 1`, matching ADR-0026's append-only
    contract. PostgreSQL also revokes UPDATE/DELETE from app_rw and rejects
    either mutation through a trigger (migration 0039).
    """
    require_write(scope)
    execution = await get_execution(
        scope,
        session,
        execution_id,
        for_update=attempt is None,
    )
    if attempt is None:
        current_attempt = await session.scalar(
            select(func.coalesce(func.max(VqeObservationRow.attempt), 0)).where(
                VqeObservationRow.execution_id == execution.id
            )
        )
        attempt = int(current_attempt or 0) + 1
    experiment = await get_experiment(scope, session, execution.experiment_id)
    persisted_binding = ExecutionBinding.model_validate(execution.execution_binding_json)
    validated = EXECUTION_EVIDENCE_ADAPTER.validate_python(evidence)
    if validated.scientific_spec_sha256 != experiment.scientific_spec_sha256:
        raise ValueError(
            "observation scientific_spec_sha256 does not match the experiment it is evidence for"
        )
    if validated.registry_resolution_sha256 != experiment.registry_resolution_sha256:
        raise ValueError("observation registry resolution does not match its experiment")
    if validated.framework is not persisted_binding.framework:
        raise ValueError("observation framework does not match its execution binding")
    if validated.runtime_profile_id != persisted_binding.runtime_profile_id:
        raise ValueError("observation runtime profile does not match its execution binding")
    if validated.runtime_image_digest != persisted_binding.container_digest:
        raise ValueError("observation image digest does not match its execution binding")
    if validated.adapter_release_id != persisted_binding.adapter_release_id:
        raise ValueError("observation adapter release does not match its execution binding")
    if validated.provider_versions != persisted_binding.provider_versions:
        raise ValueError("observation provider versions do not match its execution binding")
    detail_values = (detail_object_uri, detail_sha256, detail_size_bytes)
    if any(value is not None for value in detail_values) and not all(
        value is not None for value in detail_values
    ):
        raise ValueError("detail_object_uri/detail_sha256/detail_size_bytes are all-or-none")
    result_json = validated.model_dump(mode="json")
    result_sha256 = hashlib.sha256(
        json.dumps(result_json, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    failure_code = getattr(validated, "failure_code", None)
    observation = VqeObservationRow(
        id=uuid7(),
        execution_id=execution.id,
        attempt=attempt,
        status=validated.status,
        result_contract_json=result_json,
        result_contract_sha256=result_sha256,
        detail_object_uri=detail_object_uri,
        detail_sha256=detail_sha256,
        detail_size_bytes=detail_size_bytes,
        evidence_json=evidence_json,
        failure_code=failure_code.value if failure_code is not None else None,
    )
    session.add(observation)
    await session.flush()
    await session.refresh(observation)
    return observation


async def list_observations(
    scope: Scope, session: AsyncSession, execution_id: uuid.UUID
) -> list[VqeObservationRow]:
    await get_execution(scope, session, execution_id)
    stmt = (
        select(VqeObservationRow)
        .where(VqeObservationRow.execution_id == execution_id)
        .order_by(VqeObservationRow.attempt)
    )
    return list((await session.execute(stmt)).scalars().all())
