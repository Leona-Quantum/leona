"""VQE Component Registry and Experiment persistence (Phase 3, ADR-0023/0025).

vqe_component_specs and vqe_workflow_components carry no workspace_id of
their own — identity is the referenced ArtifactVersion (ADR-0023), so every
read joins through artifact_versions -> artifacts to apply the workspace
predicate, the same pattern verification_records/run_events use through
runs. vqe_experiments and vqe_observations DO carry workspace_id directly
(an experiment is workspace-owned data, not just annotation on someone
else's artifact).

Enum-typed parameters here (ComponentType, AnnotationState, Framework,
ExecutionStatus, FailureCode) come from majorana_vqe.models, not
majorana_contracts.enums — the VQE domain package's own closed vocabularies
are the source of truth these columns are CHECK-constrained against
(migration 0035), not the general product enums. Full ScientificExperimentSpec
validation (business-rule validators, safe-label checks) stays in the route
layer, which already owns request-body validation for everything else; this
module receives already-validated primitives, exactly like every other repo.

append_observation is strictly append-only (ADR-0025): a retry is a new row
with an incremented attempt, never a mutation of a prior one. A duplicate
attempt number is a genuine caller bug and is left to surface as the
uq_vqe_observations_experiment_attempt IntegrityError rather than silently
resolved here.
"""

import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_vqe.models import (
    AnnotationState,
    ComponentType,
    ExecutionStatus,
    FailureCode,
    Framework,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion
from ..orm import VqeComponentSpec as VqeComponentSpecRow
from ..orm import VqeExperiment as VqeExperimentRow
from ..orm import VqeObservation as VqeObservationRow
from ..orm import VqeWorkflowComponent as VqeWorkflowComponentRow
from . import artifacts as artifacts_repo
from ._base import NotFoundError, RepoError, require_write


class IdempotencyConflictError(RepoError):
    """idempotency_key was reused for a materially different experiment.

    Silently returning the earlier experiment would make the caller believe
    their (different) request was accepted; failing loudly forces a fresh
    key or reconciliation instead.
    """


# --- component specs ---------------------------------------------------


async def create_component_spec(
    scope: Scope,
    session: AsyncSession,
    *,
    artifact_version_id: uuid.UUID,
    schema_version: str,
    component_type: ComponentType,
    spec_json: dict[str, Any] | None = None,
    normalized_spec_sha256: str | None = None,
    annotation_state: AnnotationState = AnnotationState.DRAFT,
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
    await artifacts_repo.get_version(scope, session, artifact_version_id)
    spec = VqeComponentSpecRow(
        artifact_version_id=artifact_version_id,
        schema_version=schema_version,
        component_type=component_type.value,
        spec_json=spec_json if spec_json is not None else {},
        normalized_spec_sha256=normalized_spec_sha256,
        annotation_state=annotation_state.value,
    )
    session.add(spec)
    await session.flush()
    await session.refresh(spec)
    return spec


async def get_component_spec(
    scope: Scope, session: AsyncSession, artifact_version_id: uuid.UUID
) -> VqeComponentSpecRow:
    stmt = (
        select(VqeComponentSpecRow)
        .join(ArtifactVersion, VqeComponentSpecRow.artifact_version_id == ArtifactVersion.id)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(
            VqeComponentSpecRow.artifact_version_id == artifact_version_id,
            Artifact.workspace_id == scope.workspace_id,
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
) -> list[VqeComponentSpecRow]:
    stmt = (
        select(VqeComponentSpecRow)
        .join(ArtifactVersion, VqeComponentSpecRow.artifact_version_id == ArtifactVersion.id)
        .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
        .where(Artifact.workspace_id == scope.workspace_id, Artifact.deleted_at.is_(None))
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
) -> VqeWorkflowComponentRow:
    """Link a component into a workflow's composition.

    Both ArtifactVersions are resolved through the scoped artifact repo
    first, so an invalid or cross-workspace reference fails here instead of
    creating a link only a later read would discover is broken. A duplicate
    (workflow, role, ordinal) surfaces as the
    uq_vqe_workflow_components_role_ordinal IntegrityError.
    """
    require_write(scope)
    await artifacts_repo.get_version(scope, session, workflow_artifact_version_id)
    await artifacts_repo.get_version(scope, session, component_artifact_version_id)
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
    scope: Scope, session: AsyncSession, workflow_artifact_version_id: uuid.UUID
) -> list[VqeWorkflowComponentRow]:
    await artifacts_repo.get_version(scope, session, workflow_artifact_version_id)  # scope check
    stmt = (
        select(VqeWorkflowComponentRow)
        .where(VqeWorkflowComponentRow.workflow_artifact_version_id == workflow_artifact_version_id)
        .order_by(VqeWorkflowComponentRow.component_role, VqeWorkflowComponentRow.ordinal)
    )
    return list((await session.execute(stmt)).scalars().all())


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


async def find_experiment_by_idempotency_key(
    scope: Scope, session: AsyncSession, idempotency_key: str
) -> VqeExperimentRow | None:
    stmt = select(VqeExperimentRow).where(
        VqeExperimentRow.workspace_id == scope.workspace_id,
        VqeExperimentRow.idempotency_key == idempotency_key,
    )
    return (await session.execute(stmt)).scalars().first()


async def create_experiment(
    scope: Scope,
    session: AsyncSession,
    *,
    workflow_artifact_version_id: uuid.UUID,
    schema_version: str,
    scientific_spec_json: dict[str, Any],
    scientific_spec_sha256: str,
    protocol_version: str,
    idempotency_key: str | None = None,
) -> VqeExperimentRow:
    """Persist an immutable ScientificExperimentSpec (ADR-0023 spec/binding
    separation). Deliberately does not create a `runs` row or enqueue a job:
    there is no approved ExecutionBinding to resolve a framework/runtime
    against until Phase 5 ships real, promoted runtime profiles (ADR-0024) —
    run_id stays null here.

    scientific_spec_sha256 is the caller's already-computed canonical digest
    (majorana_vqe.canonical.scientific_experiment_spec_digest, called from
    the route layer where the spec is validated) — this layer trusts it and
    persists it, it does not recompute it, keeping this module free of a
    majorana_vqe.canonical dependency.

    Reusing idempotency_key for a request naming a different workflow or
    spec digest raises IdempotencyConflictError instead of silently
    returning the earlier experiment. A concurrent creator racing the same
    key is resolved by the partial unique index
    (ix_vqe_experiments_workspace_idempotency): the loser rolls back and
    re-reads the winner.
    """
    require_write(scope)
    await artifacts_repo.get_version(scope, session, workflow_artifact_version_id)

    if idempotency_key is not None:
        existing = await find_experiment_by_idempotency_key(scope, session, idempotency_key)
        if existing is not None:
            if not _experiment_matches(
                existing,
                workflow_artifact_version_id=workflow_artifact_version_id,
                scientific_spec_sha256=scientific_spec_sha256,
            ):
                raise IdempotencyConflictError(
                    f"idempotency key {idempotency_key!r} was already used for a different experiment"
                )
            return existing

    experiment = VqeExperimentRow(
        id=uuid7(),
        run_id=None,
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        schema_version=schema_version,
        workflow_artifact_version_id=workflow_artifact_version_id,
        scientific_spec_json=scientific_spec_json,
        scientific_spec_sha256=scientific_spec_sha256,
        protocol_version=protocol_version,
        idempotency_key=idempotency_key,
    )
    session.add(experiment)
    try:
        await session.flush()
    except IntegrityError:
        if idempotency_key is None:
            raise
        # A concurrent creator committed the same key between our lookup and
        # this flush; rollback discards this session's uncommitted insert
        # and expires its ORM objects so the re-read below is fresh.
        await session.rollback()
        winner = await find_experiment_by_idempotency_key(scope, session, idempotency_key)
        if winner is None:
            raise
        if not _experiment_matches(
            winner,
            workflow_artifact_version_id=workflow_artifact_version_id,
            scientific_spec_sha256=scientific_spec_sha256,
        ):
            raise IdempotencyConflictError(
                f"idempotency key {idempotency_key!r} was already used for a different experiment"
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


# --- observations (append-only, ADR-0025) -----------------------------------


async def append_observation(
    scope: Scope,
    session: AsyncSession,
    experiment_id: uuid.UUID,
    *,
    attempt: int,
    framework: Framework,
    runtime_profile_id: str,
    runtime_image_digest: str,
    adapter_release_id: str,
    architecture: str,
    protocol_version: str,
    scientific_spec_sha256: str,
    status: ExecutionStatus,
    provider_versions: dict[str, str] | None = None,
    dataset_snapshot_id: str | None = None,
    hamiltonian_digest: str | None = None,
    summary_json: dict[str, Any] | None = None,
    detail_object_uri: str | None = None,
    detail_sha256: str | None = None,
    detail_size_bytes: int | None = None,
    evidence_json: dict[str, Any] | None = None,
    failure_code: FailureCode | None = None,
) -> VqeObservationRow:
    """Append one execution-evidence row. Never call this to correct a prior
    attempt — a retry is `attempt + 1`, matching ADR-0025's append-only
    contract; the DB has no UPDATE grant for app_rw on this table.
    """
    require_write(scope)
    experiment = await get_experiment(scope, session, experiment_id)
    if scientific_spec_sha256 != experiment.scientific_spec_sha256:
        raise ValueError(
            "observation scientific_spec_sha256 does not match the experiment it is evidence for"
        )
    if (status is ExecutionStatus.FAILED) != (failure_code is not None):
        raise ValueError("failed status requires a failure_code; succeeded status forbids one")
    observation = VqeObservationRow(
        id=uuid7(),
        experiment_id=experiment.id,
        attempt=attempt,
        framework=framework.value,
        provider_versions=provider_versions,
        runtime_profile_id=runtime_profile_id,
        runtime_image_digest=runtime_image_digest,
        adapter_release_id=adapter_release_id,
        architecture=architecture,
        dataset_snapshot_id=dataset_snapshot_id,
        protocol_version=protocol_version,
        scientific_spec_sha256=scientific_spec_sha256,
        hamiltonian_digest=hamiltonian_digest,
        status=status.value,
        summary_json=summary_json,
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
    scope: Scope, session: AsyncSession, experiment_id: uuid.UUID
) -> list[VqeObservationRow]:
    await get_experiment(scope, session, experiment_id)  # scope check
    stmt = (
        select(VqeObservationRow)
        .where(VqeObservationRow.experiment_id == experiment_id)
        .order_by(VqeObservationRow.attempt)
    )
    return list((await session.execute(stmt)).scalars().all())
