"""Live PostgreSQL invariants for the Phase 4.5 VQE registry.

Skipped without DATABASE_URL.  These tests deliberately exercise properties
that mocks cannot prove: foreign keys, uniqueness, immutable-row triggers,
workspace isolation, and one portable experiment resolving to multiple
framework executions.
"""

import asyncio
import datetime as dt
import hashlib
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus, RunMode
from majorana_contracts.enums import Framework as ContractFramework
from majorana_contracts.enums import Role
from majorana_vqe.models import ComponentType, ExecutionBinding, Framework
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentSemanticBinding,
    PortableScientificExperimentSpec,
    RegistryComponentResolution,
    RegistryResolution,
    ResolvedPortableExperiment,
    workflow_semantic_digest,
)
from majorana_vqe.result import (
    OptimizerWork,
    ParameterValue,
    ResourceObservation,
    VqeOptimizationSuccessResult,
)
from sqlalchemy import delete, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import VqeComponentSpec, VqeLaunchDecision, VqeObservation
from majorana_api.repos import (
    NotFoundError,
    artifacts as artifacts_repo,
    runs as runs_repo,
    system,
    vqe,
)

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
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"vqe-live-{uuid.uuid4()}",
        email=f"vqe-{uuid.uuid4().hex[:8]}@live.test",
    )
    await session.flush()
    return Scope(user_id=user.id, workspace_id=workspace.id, role=role)


async def _make_artifact_version(scope, session, *, slug: str):
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title=slug,
        family=Algorithm.VQE,
        framework=ContractFramework.QISKIT,
        kept=False,
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


async def _make_component(scope, session, component_type: ComponentType):
    slug = f"{component_type.value}-{uuid.uuid4()}"
    version = await _make_artifact_version(scope, session, slug=slug)
    spec = await vqe.create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.2.0",
        component_type=component_type,
        semantic_key=slug,
        spec_json={"schema_version": "0.2.0", "kind": component_type.value},
    )
    return version, spec


def _digest(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def _resolved(workflow_id: uuid.UUID, *, variant: str = "base") -> ResolvedPortableExperiment:
    bindings = [
        ComponentSemanticBinding(
            role=role,
            component_type=role,
            component_semantic_key=f"h2.{variant}.{role.value}",
            component_spec_sha256=_digest(f"{variant}:{role.value}"),
        )
        for role in PORTABLE_SCIENTIFIC_ROLES
    ]
    scientific = PortableScientificExperimentSpec(
        workflow_semantic_digest=workflow_semantic_digest(bindings),
        component_bindings=bindings,
        dataset_snapshot_sha256=_digest("h2-sto3g-dataset"),
        seed=0,
    )
    resolution = RegistryResolution(
        workflow_artifact_version_id=workflow_id,
        components=[
            RegistryComponentResolution(
                role=binding.role,
                artifact_version_id=uuid.uuid4(),
                component_semantic_key=binding.component_semantic_key,
                component_spec_sha256=binding.component_spec_sha256,
            )
            for binding in bindings
        ],
    )
    return ResolvedPortableExperiment(
        scientific_spec=scientific,
        registry_resolution=resolution,
    )


def _binding(framework: Framework) -> ExecutionBinding:
    return ExecutionBinding(
        framework=framework,
        provider_versions={framework.value: "test-version"},
        runtime_profile_id=f"{framework.value}-test-profile",
        adapter_release_id=f"{framework.value}-adapter-0.1.0",
        container_digest="sha256:" + ("1" if framework is Framework.QISKIT else "2") * 64,
        architecture="linux-x86_64",
        protocol_version="0.2.0",
    )


def _success(experiment, execution) -> VqeOptimizationSuccessResult:
    return VqeOptimizationSuccessResult(
        scientific_spec_sha256=experiment.scientific_spec_sha256,
        registry_resolution_sha256=experiment.registry_resolution_sha256,
        framework=execution.framework,
        runtime_profile_id=execution.runtime_profile_id,
        runtime_image_digest=execution.runtime_image_digest,
        adapter_release_id=execution.adapter_release_id,
        provider_versions=execution.provider_versions,
        hamiltonian_exact_digest=_digest("h2-hamiltonian"),
        seed=0,
        status="succeeded",
        capability="h2_sto3g_actual_vqe_v1",
        best_energy_ha=-1.1373060357534,
        exact_energy_ha=-1.1373060357534,
        absolute_error_ha=0.0,
        final_state_fidelity=1.0,
        iterations=1,
        converged=True,
        optimizer_work=OptimizerWork(
            iterations=1,
            energy_evaluations=2,
            gradient_evaluations=0,
            hessian_evaluations=0,
        ),
        parameter_count=1,
        initial_parameters=[ParameterValue(slot_id="theta.0", float64_hex="0000000000000000")],
        final_parameters=[ParameterValue(slot_id="theta.0", float64_hex="bfcc9d4f00000000")],
        initial_parameters_sha256=_digest("initial"),
        final_parameters_sha256=_digest("final"),
        ansatz_semantic_digest=_digest("ansatz"),
        canonical_circuit_sha256=_digest("canonical-circuit"),
        compilation_protocol_sha256=_digest("compilation-protocol"),
        energy_trajectory=[-1.0, -1.1373060357534],
        resources=[
            ResourceObservation(
                stage="canonical_logical",
                metric_protocol_sha256=_digest("canonical-circuit"),
                qubits=4,
                parameter_count=1,
            ),
            ResourceObservation(
                stage="common_basis_compiled",
                metric_protocol_sha256=_digest("compilation-protocol"),
                qubits=4,
                depth=83,
                gate_count=152,
                two_qubit_gate_count=48,
                parameter_count=1,
            ),
        ],
    )


@requires_db
async def test_component_round_trip_and_workspace_isolation(db):
    async with db() as session:
        owner = await _new_scope(session)
        intruder = await _new_scope(session)
        version, created = await _make_component(owner, session, ComponentType.ANSATZ)
        await session.commit()

    async with db() as session:
        fetched = await vqe.get_component_spec(owner, session, version.id)
        assert fetched.normalized_spec_sha256 == created.normalized_spec_sha256
        with pytest.raises(NotFoundError):
            await vqe.get_component_spec(intruder, session, version.id)


@requires_db
async def test_same_scientific_content_is_allowed_in_distinct_workspaces(db):
    """A public mirror must not block a private provenance record."""
    async with db() as session:
        first = await _new_scope(session)
        second = await _new_scope(session)
        for scope in (first, second):
            version = await _make_artifact_version(
                scope, session, slug=f"shared-content-{uuid.uuid4()}"
            )
            await vqe.create_component_spec(
                scope,
                session,
                artifact_version_id=version.id,
                schema_version="0.2.0",
                component_type=ComponentType.ANSATZ,
                semantic_key="h2.shared.ansatz",
                spec_json={"schema_version": "0.2.0", "kind": "shared"},
            )
        await session.commit()


@requires_db
async def test_workflow_link_is_immutable_and_duplicate_role_is_rejected(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        ansatz, _ = await _make_component(scope, session, ComponentType.ANSATZ)
        link = await vqe.create_workflow_component(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            component_role=ComponentType.ANSATZ.value,
            component_artifact_version_id=ansatz.id,
            ordinal=0,
        )
        await session.commit()
        link_id = link.id

    async with db() as session:
        with pytest.raises(IntegrityError):
            await vqe.create_workflow_component(
                scope,
                session,
                workflow_artifact_version_id=workflow.id,
                component_role=ComponentType.ANSATZ.value,
                component_artifact_version_id=ansatz.id,
                ordinal=0,
            )

    async with db() as session:
        with pytest.raises(DBAPIError, match="immutable"):
            await session.execute(
                update(VqeComponentSpec)
                .where(VqeComponentSpec.artifact_version_id == workflow.id)
                .values(schema_version="tampered")
            )
            await session.commit()
        await session.rollback()
        assert link_id


@requires_db
async def test_experiment_idempotency_and_resolution_are_immutable(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        resolved = _resolved(workflow.id)
        first = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=resolved,
            request_idempotency_key="same-request",
        )
        await session.commit()
        first_id = first.id

    async with db() as session:
        replay = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=resolved,
            request_idempotency_key="same-request",
        )
        assert replay.id == first_id
        with pytest.raises(vqe.IdempotencyConflictError):
            await vqe.create_experiment(
                scope,
                session,
                workflow_artifact_version_id=workflow.id,
                resolved=_resolved(workflow.id, variant="different"),
                request_idempotency_key="same-request",
            )


@requires_db
async def test_one_experiment_has_independent_qiskit_and_pennylane_executions(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        qiskit = await vqe.create_execution(
            scope, session, experiment.id, binding=_binding(Framework.QISKIT)
        )
        pennylane = await vqe.create_execution(
            scope, session, experiment.id, binding=_binding(Framework.PENNYLANE)
        )
        await vqe.append_observation(
            scope, session, qiskit.id, attempt=1, evidence=_success(experiment, qiskit)
        )
        await vqe.append_observation(
            scope,
            session,
            pennylane.id,
            attempt=1,
            evidence=_success(experiment, pennylane),
        )
        await session.commit()

    async with db() as session:
        executions = await vqe.list_executions(scope, session, experiment.id)
        assert {row.framework for row in executions} == {"qiskit", "pennylane"}
        assert len(await vqe.list_observations(scope, session, qiskit.id)) == 1
        assert len(await vqe.list_observations(scope, session, pennylane.id)) == 1


@requires_db
async def test_execution_run_binding_and_lifecycle_are_fenced(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        execution = await vqe.create_execution(
            scope,
            session,
            experiment.id,
            binding=_binding(Framework.QISKIT),
        )
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt="frozen H2 candidate",
            mode=RunMode.EXECUTE,
            framework=ContractFramework.QISKIT,
            seed=0,
            timeout_s=300,
            idempotency_key=f"vqe-live-{uuid.uuid4()}",
        )
        queued = await vqe.bind_execution_run(
            scope,
            session,
            execution.id,
            run_id=run.id,
        )
        assert queued.status == "queued"
        assert queued.run_id == run.id
        running = await vqe.transition_execution(
            scope,
            session,
            execution.id,
            new_status="running",
        )
        assert running.status == "running"
        succeeded = await vqe.transition_execution(
            scope,
            session,
            execution.id,
            new_status="succeeded",
        )
        assert succeeded.status == "succeeded"
        with pytest.raises(ValueError, match="illegal VQE execution transition"):
            await vqe.transition_execution(
                scope,
                session,
                execution.id,
                new_status="failed",
            )


@requires_db
async def test_observation_rows_reject_update_and_delete(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        execution = await vqe.create_execution(
            scope, session, experiment.id, binding=_binding(Framework.QISKIT)
        )
        observation = await vqe.append_observation(
            scope, session, execution.id, attempt=1, evidence=_success(experiment, execution)
        )
        await session.commit()
        observation_id = observation.id

    async with db() as session:
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(VqeObservation)
                .where(VqeObservation.id == observation_id)
                .values(status="failed")
            )
            await session.commit()
        await session.rollback()

        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(delete(VqeObservation).where(VqeObservation.id == observation_id))
            await session.commit()


@requires_db
async def test_runtime_readiness_rejects_delayed_older_heartbeat(db):
    """A delayed worker transaction cannot overwrite fresher availability."""

    profile = f"phase12-profile-{uuid.uuid4()}"
    generation = uuid.uuid4()
    observed_at = dt.datetime.now(dt.UTC)
    async with db() as session:
        await system.upsert_vqe_runtime_readiness(
            session,
            runtime_profile_id=profile,
            generation=generation,
            worker_id="worker-current",
            status="ready",
            detail_sha256=_digest("current-ready"),
            observed_at=observed_at,
            expires_at=observed_at + dt.timedelta(minutes=2),
        )
        await session.commit()

    async with db() as session:
        await system.upsert_vqe_runtime_readiness(
            session,
            runtime_profile_id=profile,
            generation=uuid.uuid4(),
            worker_id="worker-delayed",
            status="unavailable",
            detail_sha256=_digest("delayed-unavailable"),
            observed_at=observed_at - dt.timedelta(seconds=1),
            expires_at=observed_at + dt.timedelta(seconds=30),
        )
        await session.commit()

    async with db() as session:
        row = await system.get_vqe_runtime_readiness(
            session,
            runtime_profile_id=profile,
        )
        assert row is not None
        assert row.generation == generation
        assert row.worker_id == "worker-current"
        assert row.status == "ready"
        assert row.observed_at == observed_at


@requires_db
async def test_launch_decision_rows_reject_update_and_delete(db):
    """Operational decisions are immutable evidence, not editable status rows."""

    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        decision = await vqe.append_launch_decision(
            scope,
            session,
            actor_hmac_sha256=_digest("actor"),
            request_id=f"phase12-{uuid.uuid4()}",
            action="create_experiment",
            workflow_artifact_version_id=workflow.id,
            experiment_id=None,
            decision="blocked",
            primary_reason_code="vqe_runtime_readiness_unknown",
            blockers_json=[
                {
                    "reason_code": "vqe_runtime_readiness_unknown",
                    "field": "live_readiness",
                    "retryable": True,
                }
            ],
            projection_sha256=_digest("projection"),
            registry_snapshot_sha256=_digest("registry"),
            readiness_snapshot_json=[],
        )
        await session.commit()
        decision_id = decision.id

    async with db() as session:
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(VqeLaunchDecision)
                .where(VqeLaunchDecision.id == decision_id)
                .values(decision="accepted")
            )
            await session.commit()
        await session.rollback()

        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                delete(VqeLaunchDecision).where(VqeLaunchDecision.id == decision_id)
            )
            await session.commit()


@requires_db
async def test_concurrent_identical_execution_creation_returns_one_row(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        experiment_id = experiment.id
        await session.commit()

    async def create_once():
        async with db() as session:
            row = await vqe.create_execution(
                scope,
                session,
                experiment_id,
                binding=_binding(Framework.QISKIT),
            )
            await session.commit()
            return row.id

    first, second = await asyncio.gather(create_once(), create_once())
    assert first == second

    async with db() as session:
        rows = await vqe.list_executions(scope, session, experiment_id)
        assert len(rows) == 1


@requires_db
async def test_concurrent_attempt_allocation_is_unique_and_monotonic(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        execution = await vqe.create_execution(
            scope,
            session,
            experiment.id,
            binding=_binding(Framework.QISKIT),
        )
        experiment_id = experiment.id
        execution_id = execution.id
        await session.commit()

    async def append_once():
        async with db() as session:
            current_experiment = await vqe.get_experiment(scope, session, experiment_id)
            current_execution = await vqe.get_execution(scope, session, execution_id)
            row = await vqe.append_observation(
                scope,
                session,
                execution_id,
                attempt=None,
                evidence=_success(current_experiment, current_execution),
            )
            await session.commit()
            return row.attempt

    attempts = await asyncio.gather(append_once(), append_once())
    assert sorted(attempts) == [1, 2]


@requires_db
async def test_concurrent_run_binding_has_exactly_one_winner(db):
    async with db() as session:
        scope = await _new_scope(session)
        workflow, _ = await _make_component(scope, session, ComponentType.WORKFLOW)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        execution = await vqe.create_execution(
            scope,
            session,
            experiment.id,
            binding=_binding(Framework.QISKIT),
        )
        runs = [
            await runs_repo.create_run(
                scope,
                session,
                task_prompt=f"concurrent binding {index}",
                mode=RunMode.EXECUTE,
                framework=ContractFramework.QISKIT,
                seed=0,
                timeout_s=300,
                idempotency_key=f"vqe-bind-{uuid.uuid4()}",
            )
            for index in range(2)
        ]
        execution_id = execution.id
        run_ids = [run.id for run in runs]
        await session.commit()

    async def bind_once(run_id):
        async with db() as session:
            try:
                row = await vqe.bind_execution_run(
                    scope,
                    session,
                    execution_id,
                    run_id=run_id,
                )
                await session.commit()
                return row.run_id
            except ValueError:
                await session.rollback()
                return None

    results = await asyncio.gather(*(bind_once(run_id) for run_id in run_ids))
    assert sum(result is not None for result in results) == 1
    assert next(result for result in results if result is not None) in run_ids
