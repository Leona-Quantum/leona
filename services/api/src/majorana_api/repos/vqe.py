"""VQE registry, portable experiments, executions, and evidence (Phase 4.5).

vqe_component_specs and vqe_workflow_components carry no workspace_id of
their own — identity is the referenced ArtifactVersion (ADR-0023), so every
read joins through artifact_versions -> artifacts to apply the workspace
predicate, the same pattern verification_records/run_events use through
runs. vqe_experiments carries workspace_id directly. vqe_executions and
vqe_observations are scoped through their parent experiment and deliberately
do not duplicate workspace_id.

Enum-typed parameters here come from majorana_vqe, not majorana_contracts.enums.
Portable identity, typed composition, and capability-specific result
validation are recomputed in this repository boundary; callers cannot supply
an authoritative hash independently from its content.

append_observation is strictly append-only (ADR-0025): a retry is a new row
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
)
from majorana_vqe.executable import (
    parse_executable_component,
    validate_h2_executable_composition,
)
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentSemanticBinding,
    ParameterSlotValue,
    PortableScientificExperimentSpec,
    RegistryComponentResolution,
    RegistryResolution,
    ResolvedPortableExperiment,
    normalized_component_spec_digest,
    portable_scientific_spec_digest,
    registry_resolution_digest,
    workflow_semantic_digest,
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


# --- component specs ---------------------------------------------------


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

    artifact_version_id is the primary key of vqe_component_specs (ADR-0023:
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
            if payload.get("schema_version") != "0.2.0" or not payload.get("kind"):
                raise ValueError("machine-validated workflow requires typed v0.2 metadata")
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
    if changed_role is not ComponentType.PARAMETER_OPTIMIZER:
        raise InvalidWorkflowCompositionError(
            "Phase 7.6 permits only parameter_optimizer swaps"
        )
    baseline_spec = await get_component_spec(
        scope,
        session,
        baseline_workflow_artifact_version_id,
        catalog_workspace_id=catalog_workspace_id,
    )
    if baseline_spec.component_type != ComponentType.WORKFLOW.value:
        raise InvalidWorkflowCompositionError("baseline is not a workflow")
    if baseline_spec.semantic_key != baseline_template_key:
        raise InvalidWorkflowCompositionError(
            "baseline Registry identity does not match the requested template"
        )
    template = workflow_by_key(baseline_template_key)
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
    candidate_spec = await _get_unique_component_by_semantic_digest(
        scope,
        session,
        semantic_key=candidate_component_semantic_key,
        normalized_spec_sha256=candidate_component_spec_sha256,
        catalog_workspace_id=catalog_workspace_id,
    )
    if set(baseline_by_role) != {
        selection.role
        for selection in selections
        if selection.component_semantic_key is not None
    }:
        raise InvalidWorkflowCompositionError(
            "baseline Registry composition does not match the template roles"
        )

    request_payload = {
        "schema_version": "0.1.0",
        "baseline_workflow_artifact_version_id": str(
            baseline_workflow_artifact_version_id
        ),
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
            component_version_id = candidate_spec.artifact_version_id
            binding = implementation_by_component.get(selection.component_semantic_key)
            binding_metadata = {
                "binding_key": binding.binding_key if binding else None,
                "evidence_level": binding.evidence_level.value if binding else "missing",
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
        "kind": "component_swap_workflow_draft",
        "request_sha256": request_sha256,
        "compatibility": dataclasses.asdict(compatibility),
        "execution_status": "blocked_until_runtime_qualified",
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
            "baseline_workflow_artifact_version_id": str(
                baseline_workflow_artifact_version_id
            ),
            "publication": "blocked",
            "scientific_release": "blocked",
        },
        code=code,
        code_lang="json",
        fingerprint=request_sha256,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="structured VQE Workflow draft is not a circuit export",
        limitations="Execution remains blocked until every binding is runtime-qualified.",
    )
    workflow_spec = await create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.1.0",
        component_type=ComponentType.WORKFLOW,
        semantic_key=f"workflow.instance.{request_sha256}",
        spec_json=workflow_payload,
        machine_validation_state=MachineValidationState.UNVALIDATED,
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
) -> ResolvedPortableExperiment:
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
    if workflow.machine_validation_state != MachineValidationState.MACHINE_VALIDATED.value:
        raise InvalidWorkflowCompositionError("workflow is not machine validated")
    approved_review_states = {
        ReviewState.HUMAN_REVIEWED.value,
        ReviewState.AUTHOR_CONFIRMED.value,
    }
    if review_policy == "approved":
        if workflow.review_state not in approved_review_states:
            raise InvalidWorkflowCompositionError("workflow is not scientifically reviewed")
    elif not (
        workflow.review_state == ReviewState.UNREVIEWED.value
        and workflow.semantic_key == H2_REVIEW_CANDIDATE_WORKFLOW_KEY
    ):
        raise InvalidWorkflowCompositionError(
            "owner-deferred execution is restricted to the frozen unreviewed H2 candidate"
        )

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
        elif not (
            component.review_state == ReviewState.UNREVIEWED.value
            and component.semantic_key == f"h2.sto3g.actual_vqe.v0_2.{role_type.value}"
        ):
            raise InvalidWorkflowCompositionError(
                "owner-deferred execution encountered a non-canonical H2 candidate component"
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
    if (
        review_policy == "h2_owner_deferred_candidate"
        and scientific_spec.workflow_semantic_digest != H2_REVIEW_CANDIDATE_WORKFLOW_DIGEST
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
    resolved: ResolvedPortableExperiment,
    request_idempotency_key: str | None = None,
    catalog_workspace_id: uuid.UUID | None = None,
) -> VqeExperimentRow:
    """Persist an immutable ScientificExperimentSpec (ADR-0023 spec/binding
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

    async def role_digests(
        links: list[VqeWorkflowComponentRow],
    ) -> dict[ComponentType, str]:
        result: dict[ComponentType, str] = {}
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
            result[role] = component.normalized_spec_sha256
        return result

    baseline_digests = await role_digests(baseline_links)
    candidate_digests = await role_digests(candidate_links)
    if set(baseline_digests) != set(candidate_digests):
        raise ComparisonIntegrityError("Workflow role sets differ")
    observed_changed = {
        role
        for role in baseline_digests
        if baseline_digests[role] != candidate_digests[role]
    }
    if observed_changed != {spec.changed_role}:
        raise ComparisonIntegrityError(
            "Workflow pair must differ in exactly the declared role"
        )
    server_fixed = {
        role: digest
        for role, digest in baseline_digests.items()
        if role is not spec.changed_role
    }
    if server_fixed != spec.fixed_component_digests:
        raise ComparisonIntegrityError("fixed component digests are not server-derived values")

    payload = spec.model_dump(mode="json")
    digest = _canonical_sha256(payload)
    existing = (
        await session.execute(
            select(VqeControlledComparisonSpecRow).where(
                VqeControlledComparisonSpecRow.workspace_id == scope.workspace_id,
                VqeControlledComparisonSpecRow.request_idempotency_key
                == request_idempotency_key,
            )
        )
    ).scalars().first()
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
            await session.execute(
                select(VqeControlledComparisonSpecRow).where(
                    VqeControlledComparisonSpecRow.workspace_id
                    == scope.workspace_id,
                    VqeControlledComparisonSpecRow.request_idempotency_key
                    == request_idempotency_key,
                )
            )
        ).scalars().first()
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
        await session.execute(
            select(VqeControlledComparisonSpecRow).where(
                VqeControlledComparisonSpecRow.id == comparison_spec_id,
                VqeControlledComparisonSpecRow.workspace_id == scope.workspace_id,
            )
        )
    ).scalars().first()
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
    spec_row = await get_controlled_comparison_spec(
        scope, session, run.comparison_spec_id
    )
    baseline_execution = await get_execution(
        scope, session, run.baseline_execution_id
    )
    candidate_execution = await get_execution(
        scope, session, run.candidate_execution_id
    )
    baseline_experiment = await get_experiment(
        scope, session, baseline_execution.experiment_id
    )
    candidate_experiment = await get_experiment(
        scope, session, candidate_execution.experiment_id
    )
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
                .where(
                    VqeControlledComparisonRunRow.comparison_spec_id
                    == comparison_spec_id
                )
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
    attempt — a retry is `attempt + 1`, matching ADR-0025's append-only
    contract. PostgreSQL also revokes UPDATE/DELETE from app_rw and rejects
    either mutation through a trigger (migration 0035).
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
