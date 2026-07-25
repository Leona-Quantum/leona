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

import hashlib
import json
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_vqe.models import (
    ComponentType,
    ExecutionBinding,
    MachineValidationState,
    ReviewState,
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
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion
from ..orm import VqeComponentSpec as VqeComponentSpecRow
from ..orm import VqeExperiment as VqeExperimentRow
from ..orm import VqeExecution as VqeExecutionRow
from ..orm import VqeObservation as VqeObservationRow
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


async def resolve_scientific_experiment_spec(
    scope: Scope,
    session: AsyncSession,
    workflow_artifact_version_id: uuid.UUID,
    *,
    catalog_workspace_id: uuid.UUID | None = None,
    approved_seed: int = 0,
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
    if workflow.review_state not in {
        ReviewState.HUMAN_REVIEWED.value,
        ReviewState.AUTHOR_CONFIRMED.value,
    }:
        raise InvalidWorkflowCompositionError("workflow is not scientifically reviewed")

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
        if component.review_state not in {
            ReviewState.HUMAN_REVIEWED.value,
            ReviewState.AUTHOR_CONFIRMED.value,
        }:
            raise InvalidWorkflowCompositionError(
                f"component {component.semantic_key!r} is not scientifically reviewed"
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
    there is no approved ExecutionBinding to resolve a framework/runtime
    against until Phase 5 ships real, promoted runtime profiles (ADR-0024) —
    run_id stays null here.

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
    session.add(execution)
    await session.flush()
    await session.refresh(execution)
    return execution


async def get_execution(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
) -> VqeExecutionRow:
    stmt = (
        select(VqeExecutionRow)
        .join(VqeExperimentRow, VqeExecutionRow.experiment_id == VqeExperimentRow.id)
        .where(
            VqeExecutionRow.id == execution_id,
            VqeExperimentRow.workspace_id == scope.workspace_id,
        )
    )
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
    attempt: int,
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
    execution = await get_execution(scope, session, execution_id)
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
