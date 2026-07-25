"""Live-DB test in the authz-suite mold: skipped without DATABASE_URL.

Proves the Phase 3 VQE Component Registry / Experiment repos end-to-end
against real Postgres: constraint enforcement the ORM/migration only declare
(PK/UNIQUE/FK/CHECK), workspace isolation across two independently
provisioned scopes, and the idempotent-create semantics for
vqe_experiments. Each test provisions its own fresh user/workspace so it is
safe to run repeatedly against the same throwaway database.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus
from majorana_contracts.enums import Framework as ContractFramework
from majorana_contracts.enums import Role
from majorana_vqe.models import (
    SCIENTIFIC_SPEC_ROLE_BINDINGS,
    AnnotationState,
    ComponentType,
    ExecutionStatus,
    FailureCode,
    Framework,
)
from sqlalchemy import delete, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import ArtifactVersion, VqeObservation
from majorana_api.repos import NotFoundError, artifacts as artifacts_repo, system, vqe

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="VQE repo live tests need DATABASE_URL"
)


@pytest.fixture
async def db():
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _new_scope(session, *, role: Role = Role.OWNER) -> Scope:
    user, ws = await system.get_or_provision_user(
        session,
        workos_user_id=f"vqe-live-{uuid.uuid4()}",
        email=f"vqe-{uuid.uuid4().hex[:8]}@live.test",
    )
    await session.flush()
    return Scope(user_id=user.id, workspace_id=ws.id, role=role)


async def _make_artifact_version(scope, session, *, slug: str) -> ArtifactVersion:
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title=slug,
        family=Algorithm.VQE,
        framework=ContractFramework.QISKIT,
    )
    return await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        code="",
        code_lang="python",
        fingerprint=f"fp-{uuid.uuid4()}",
        export_status=ExportStatus.LOSSLESS,
    )


async def _make_component_version(
    scope,
    session,
    *,
    slug: str,
    component_type: ComponentType,
) -> ArtifactVersion:
    version = await _make_artifact_version(scope, session, slug=slug)
    await vqe.create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.1.0",
        component_type=component_type,
    )
    return version


@requires_db
async def test_component_spec_create_get_list_round_trip(db):
    async with db() as session:
        scope = await _new_scope(session)
        version = await _make_artifact_version(scope, session, slug=f"ansatz-{uuid.uuid4()}")
        created = await vqe.create_component_spec(
            scope,
            session,
            artifact_version_id=version.id,
            schema_version="0.1.0",
            component_type=ComponentType.ANSATZ,
            spec_json={"kind": "uccsd"},
            annotation_state=AnnotationState.DRAFT,
        )
        await session.commit()

    async with db() as session:
        fetched = await vqe.get_component_spec(scope, session, version.id)
        assert fetched.artifact_version_id == created.artifact_version_id
        assert fetched.spec_json == {"kind": "uccsd"}

        listed = await vqe.list_component_specs(scope, session, component_type=ComponentType.ANSATZ)
        assert any(c.artifact_version_id == version.id for c in listed)

        listed_wrong_type = await vqe.list_component_specs(
            scope, session, component_type=ComponentType.MEASUREMENT
        )
        assert all(c.artifact_version_id != version.id for c in listed_wrong_type)


@requires_db
async def test_component_spec_pk_rejects_a_second_create_for_the_same_version(db):
    async with db() as session:
        scope = await _new_scope(session)
        version = await _make_artifact_version(scope, session, slug=f"pk-{uuid.uuid4()}")
        await vqe.create_component_spec(
            scope,
            session,
            artifact_version_id=version.id,
            schema_version="0.1.0",
            component_type=ComponentType.ANSATZ,
        )
        await session.commit()

    async with db() as session:
        with pytest.raises(IntegrityError):
            await vqe.create_component_spec(
                scope,
                session,
                artifact_version_id=version.id,
                schema_version="0.1.0",
                component_type=ComponentType.ANSATZ,
            )


@requires_db
async def test_workflow_components_create_list_and_reject_duplicate_role_ordinal(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow = await _make_component_version(
            scope,
            session,
            component_type=ComponentType.WORKFLOW,
            slug=f"workflow-{uuid.uuid4()}",
        )
        ansatz = await _make_component_version(
            scope,
            session,
            component_type=ComponentType.ANSATZ,
            slug=f"ansatz-{uuid.uuid4()}",
        )
        await vqe.create_workflow_component(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            component_role="ansatz",
            component_artifact_version_id=ansatz.id,
            ordinal=0,
        )
        await session.commit()

    async with db() as session:
        components = await vqe.list_workflow_components(scope, session, workflow.id)
        assert len(components) == 1
        assert components[0].component_role == "ansatz"

    async with db() as session:
        with pytest.raises(IntegrityError):
            await vqe.create_workflow_component(
                scope,
                session,
                workflow_artifact_version_id=workflow.id,
                component_role="ansatz",
                component_artifact_version_id=ansatz.id,
                ordinal=0,  # same (workflow, role, ordinal) as above
            )


@requires_db
async def test_workflow_component_rejects_role_type_mismatch(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow = await _make_component_version(
            scope,
            session,
            component_type=ComponentType.WORKFLOW,
            slug=f"workflow-mismatch-{uuid.uuid4()}",
        )
        measurement = await _make_component_version(
            scope,
            session,
            component_type=ComponentType.MEASUREMENT,
            slug=f"measurement-{uuid.uuid4()}",
        )
        with pytest.raises(vqe.InvalidWorkflowCompositionError, match="does not match"):
            await vqe.create_workflow_component(
                scope,
                session,
                workflow_artifact_version_id=workflow.id,
                component_role=ComponentType.ANSATZ.value,
                component_artifact_version_id=measurement.id,
                ordinal=0,
            )


@requires_db
async def test_scientific_spec_is_resolved_from_complete_workflow(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow = await _make_component_version(
            scope,
            session,
            component_type=ComponentType.WORKFLOW,
            slug=f"workflow-resolve-{uuid.uuid4()}",
        )
        expected: dict[ComponentType, uuid.UUID] = {}
        for role in SCIENTIFIC_SPEC_ROLE_BINDINGS:
            component = await _make_component_version(
                scope,
                session,
                component_type=role,
                slug=f"{role.value}-{uuid.uuid4()}",
            )
            expected[role] = component.id
            await vqe.create_workflow_component(
                scope,
                session,
                workflow_artifact_version_id=workflow.id,
                component_role=role.value,
                component_artifact_version_id=component.id,
                ordinal=0,
            )
        await session.commit()

    async with db() as session:
        spec = await vqe.resolve_scientific_experiment_spec(
            scope,
            session,
            workflow.id,
            dataset_snapshot_id="h2-sto3g-v1",
            initial_parameters=[0.0],
            seed=11,
        )
        for role, field_name in SCIENTIFIC_SPEC_ROLE_BINDINGS.items():
            assert getattr(spec, field_name) == expected[role]
        assert spec.seed == 11


@requires_db
async def test_component_spec_is_invisible_outside_its_workspace(db):
    async with db() as session:
        owner_scope = await _new_scope(session)
        version = await _make_artifact_version(owner_scope, session, slug=f"iso-{uuid.uuid4()}")
        await vqe.create_component_spec(
            owner_scope,
            session,
            artifact_version_id=version.id,
            schema_version="0.1.0",
            component_type=ComponentType.ANSATZ,
        )
        intruder_scope = await _new_scope(session)
        await session.commit()

    async with db() as session:
        with pytest.raises(NotFoundError):
            await vqe.get_component_spec(intruder_scope, session, version.id)
        # the owning workspace can still see it
        found = await vqe.get_component_spec(owner_scope, session, version.id)
        assert found.artifact_version_id == version.id


def _spec_kwargs(workflow_id: uuid.UUID, *, sha256: str, request_idempotency_key: str | None):
    return dict(
        workflow_artifact_version_id=workflow_id,
        schema_version="0.1.0",
        scientific_spec_json={"problem_version_id": str(uuid.uuid4())},
        scientific_spec_sha256=sha256,
        protocol_version="0.1.0",
        request_idempotency_key=request_idempotency_key,
    )


@requires_db
async def test_create_experiment_never_sets_run_id_and_is_idempotent(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow = await _make_component_version(
            scope,
            session,
            slug=f"exp-workflow-{uuid.uuid4()}",
            component_type=ComponentType.WORKFLOW,
        )
        await session.commit()

    key = f"idem-{uuid.uuid4()}"
    sha = "b" * 64

    async with db() as session:
        first = await vqe.create_experiment(
            scope,
            session,
            **_spec_kwargs(workflow.id, sha256=sha, request_idempotency_key=key),
        )
        await session.commit()

    assert first.run_id is None  # Phase 3 scope decision: spec only, no runs row yet

    async with db() as session:
        # same key, same request -> returns the existing row, not a duplicate
        second = await vqe.create_experiment(
            scope,
            session,
            **_spec_kwargs(workflow.id, sha256=sha, request_idempotency_key=key),
        )
        assert second.id == first.id

        # same key, different spec digest -> conflict, not a silent overwrite
        with pytest.raises(vqe.IdempotencyConflictError):
            await vqe.create_experiment(
                scope,
                session,
                **_spec_kwargs(workflow.id, sha256="c" * 64, request_idempotency_key=key),
            )

    async with db() as session:
        fetched = await vqe.get_experiment(scope, session, first.id)
        assert fetched.scientific_spec_sha256 == sha


@requires_db
async def test_experiment_is_invisible_outside_its_workspace(db):
    async with db() as session:
        owner_scope = await _new_scope(session)
        workflow = await _make_component_version(
            owner_scope,
            session,
            slug=f"exp-iso-{uuid.uuid4()}",
            component_type=ComponentType.WORKFLOW,
        )
        experiment = await vqe.create_experiment(
            owner_scope,
            session,
            **_spec_kwargs(workflow.id, sha256="d" * 64, request_idempotency_key=None),
        )
        intruder_scope = await _new_scope(session)
        await session.commit()

    async with db() as session:
        with pytest.raises(NotFoundError):
            await vqe.get_experiment(intruder_scope, session, experiment.id)


@requires_db
async def test_append_observation_enforces_all_its_invariants(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow = await _make_component_version(
            scope,
            session,
            slug=f"obs-{uuid.uuid4()}",
            component_type=ComponentType.WORKFLOW,
        )
        experiment = await vqe.create_experiment(
            scope,
            session,
            **_spec_kwargs(workflow.id, sha256="e" * 64, request_idempotency_key=None),
        )
        await session.commit()

    def _obs_kwargs(**overrides):
        kwargs = dict(
            attempt=1,
            framework=Framework.QISKIT,
            runtime_profile_id="qiskit-current-v1",
            runtime_image_digest="sha256:" + "0" * 64,
            adapter_release_id="adapter1",
            architecture="arm64",
            protocol_version="0.1.0",
            scientific_spec_sha256="e" * 64,
            hamiltonian_digest="a" * 64,
            status=ExecutionStatus.SUCCEEDED,
        )
        kwargs.update(overrides)
        return kwargs

    async with db() as session:
        # wrong spec digest: must be rejected before it ever reaches the DB
        with pytest.raises(ValueError):
            await vqe.append_observation(
                scope, session, experiment.id, **_obs_kwargs(scientific_spec_sha256="f" * 64)
            )

    async with db() as session:
        # succeeded status must not carry a failure_code
        with pytest.raises(ValueError):
            await vqe.append_observation(
                scope,
                session,
                experiment.id,
                **_obs_kwargs(
                    status=ExecutionStatus.SUCCEEDED, failure_code=FailureCode.RUNTIME_TIMEOUT
                ),
            )

    async with db() as session:
        # failed status requires a failure_code
        with pytest.raises(ValueError):
            await vqe.append_observation(
                scope, session, experiment.id, **_obs_kwargs(status=ExecutionStatus.FAILED)
            )

    async with db() as session:
        first = await vqe.append_observation(
            scope, session, experiment.id, **_obs_kwargs(attempt=1)
        )
        await session.commit()
    assert first.status == ExecutionStatus.SUCCEEDED.value

    async with db() as session:
        # a retry is attempt + 1, never a mutation of attempt 1 (ADR-0025)
        with pytest.raises(IntegrityError):
            await vqe.append_observation(scope, session, experiment.id, **_obs_kwargs(attempt=1))

    async with db() as session:
        await vqe.append_observation(
            scope,
            session,
            experiment.id,
            **_obs_kwargs(
                attempt=2,
                status=ExecutionStatus.FAILED,
                failure_code=FailureCode.RUNTIME_TIMEOUT,
            ),
        )
        await session.commit()

    async with db() as session:
        observations = await vqe.list_observations(scope, session, experiment.id)
        assert [o.attempt for o in observations] == [1, 2]
        assert observations[1].failure_code == FailureCode.RUNTIME_TIMEOUT.value


@requires_db
async def test_observation_rows_reject_update_and_delete(db):
    """The append-only claim is a PostgreSQL invariant, not just API style."""
    async with db() as session:
        scope = await _new_scope(session)
        workflow = await _make_component_version(
            scope,
            session,
            slug=f"obs-immutable-{uuid.uuid4()}",
            component_type=ComponentType.WORKFLOW,
        )
        experiment = await vqe.create_experiment(
            scope,
            session,
            **_spec_kwargs(workflow.id, sha256="9" * 64, request_idempotency_key=None),
        )
        observation = await vqe.append_observation(
            scope,
            session,
            experiment.id,
            attempt=1,
            framework=Framework.QISKIT,
            runtime_profile_id="qiskit-current-v1",
            runtime_image_digest="sha256:" + "0" * 64,
            adapter_release_id="adapter1",
            architecture="arm64",
            protocol_version="0.1.0",
            scientific_spec_sha256="9" * 64,
            hamiltonian_digest="8" * 64,
            status=ExecutionStatus.SUCCEEDED,
        )
        await session.commit()
        observation_id = observation.id

    async with db() as session:
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(VqeObservation)
                .where(VqeObservation.id == observation_id)
                .values(runtime_profile_id="tampered")
            )
            await session.commit()
        await session.rollback()

        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(delete(VqeObservation).where(VqeObservation.id == observation_id))
            await session.commit()
        await session.rollback()

        persisted = await session.get(VqeObservation, observation_id)
        assert persisted is not None
        assert persisted.runtime_profile_id == "qiskit-current-v1"
