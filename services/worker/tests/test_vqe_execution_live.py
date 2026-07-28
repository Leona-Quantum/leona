"""Live durable worker integration for the Phase 5A VQE candidate.

The scientific runtime is replaced by its frozen raw report so this test
isolates the database/job lifecycle.  The real Linux images and network
boundary are qualified separately by scripts/qualify-vqe-phase5-runtime.py.
"""

import hashlib
import json
import os
import uuid
from pathlib import Path

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus, Role, RunMode
from majorana_contracts.enums import Framework as ContractFramework
from majorana_vqe.models import ComponentType, FailureCode, Framework
from majorana_vqe.portable import (
    PORTABLE_SCIENTIFIC_ROLES,
    ComponentSemanticBinding,
    PortableScientificExperimentSpec,
    RegistryComponentResolution,
    RegistryResolution,
    ResolvedPortableExperiment,
    workflow_semantic_digest,
)

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import artifacts, runs, system, vqe
from majorana_api.vqe_runtime_profiles import candidate_runtime_profile
from majorana_worker import handlers
from majorana_worker.errors import RetryableJobError
from majorana_worker.vqe_runtime import VqeRuntimeError, VqeRuntimeOutput

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="VQE worker live test needs DATABASE_URL",
)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@pytest.fixture
async def db():
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _scope(session) -> Scope:
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"vqe-worker-live-{uuid.uuid4()}",
        email=f"vqe-worker-{uuid.uuid4().hex[:8]}@live.test",
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


async def _workflow(scope: Scope, session):
    artifact = await artifacts.create_artifact(
        scope,
        session,
        slug=f"h2-worker-live-{uuid.uuid4()}",
        title="H2 worker live",
        family=Algorithm.VQE,
        framework=ContractFramework.QISKIT,
    )
    version = await artifacts.create_version(
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
    await vqe.create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.2.0",
        component_type=ComponentType.WORKFLOW,
        semantic_key=f"worker-live-{uuid.uuid4()}",
        spec_json={"schema_version": "0.2.0", "kind": "workflow"},
    )
    return version


def _resolved(workflow_id: uuid.UUID) -> ResolvedPortableExperiment:
    semantic_keys = {
        ComponentType.PARAMETER_OPTIMIZER: "optimizer.scipy_bounded_scalar.v1",
    }
    bindings = [
        ComponentSemanticBinding(
            role=role,
            component_type=role,
            component_semantic_key=semantic_keys.get(role, f"h2.worker.{role.value}"),
            component_spec_sha256=_digest(role.value),
        )
        for role in PORTABLE_SCIENTIFIC_ROLES
    ]
    return ResolvedPortableExperiment(
        scientific_spec=PortableScientificExperimentSpec(
            workflow_semantic_digest=workflow_semantic_digest(bindings),
            component_bindings=bindings,
            dataset_snapshot_sha256=_digest("h2-sto3g"),
            seed=0,
        ),
        registry_resolution=RegistryResolution(
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
        ),
    )


@requires_db
async def test_worker_persists_success_and_terminal_events(db, monkeypatch):
    async with db() as session:
        scope = await _scope(session)
        workflow = await _workflow(scope, session)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        profile = candidate_runtime_profile(Framework.QISKIT)
        execution = await vqe.create_execution(
            scope,
            session,
            experiment.id,
            binding=profile.binding,
        )
        run = await runs.create_run(
            scope,
            session,
            task_prompt="frozen H2 durable worker live test",
            mode=RunMode.EXECUTE,
            framework=ContractFramework.QISKIT,
            seed=0,
        )
        await runs.append_run_event(
            scope,
            session,
            run.id,
            type="run.queued",
            payload={"mode": "execute", "framework": "qiskit"},
        )
        await vqe.bind_execution_run(scope, session, execution.id, run_id=run.id)
        await session.commit()

        raw = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())

        async def frozen_runtime(_profile, **_kwargs):
            return VqeRuntimeOutput(payload=raw, bounded_stderr="")

        monkeypatch.setattr(handlers, "execute_candidate_image", frozen_runtime)
        await handlers.handle_vqe_execute(
            session,
            {
                "execution_id": str(execution.id),
                "run_id": str(run.id),
                "workspace_id": str(scope.workspace_id),
                "user_id": str(scope.user_id),
            },
        )

    async with db() as session:
        completed = await vqe.get_execution(scope, session, execution.id)
        observations = await vqe.list_observations(scope, session, execution.id)
        completed_run = await runs.get_run(scope, session, run.id)
        events = await runs.list_run_events(scope, session, run.id)
        assert completed.status == "succeeded"
        assert completed_run.status == "succeeded"
        assert len(observations) == 1
        assert observations[0].result_contract_json["scientific_spec_sha256"] == (
            experiment.scientific_spec_sha256
        )
        assert [event.type for event in events] == [
            "run.queued",
            "run.started",
            "run.finished",
        ]


@requires_db
async def test_retry_is_append_only_and_does_not_claim_terminal_failure(db, monkeypatch):
    async with db() as session:
        scope = await _scope(session)
        workflow = await _workflow(scope, session)
        experiment = await vqe.create_experiment(
            scope,
            session,
            workflow_artifact_version_id=workflow.id,
            resolved=_resolved(workflow.id),
        )
        profile = candidate_runtime_profile(Framework.PENNYLANE)
        execution = await vqe.create_execution(
            scope,
            session,
            experiment.id,
            binding=profile.binding,
        )
        run = await runs.create_run(
            scope,
            session,
            task_prompt="frozen H2 retry live test",
            mode=RunMode.EXECUTE,
            framework=ContractFramework.PENNYLANE,
            seed=0,
        )
        await vqe.bind_execution_run(scope, session, execution.id, run_id=run.id)
        await session.commit()

        async def unavailable(_profile, **_kwargs):
            raise VqeRuntimeError(
                "temporary local image outage",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=True,
            )

        monkeypatch.setattr(handlers, "execute_candidate_image", unavailable)
        with pytest.raises(RetryableJobError, match="temporary local image outage"):
            await handlers.handle_vqe_execute(
                session,
                {
                    "execution_id": str(execution.id),
                    "run_id": str(run.id),
                    "workspace_id": str(scope.workspace_id),
                    "user_id": str(scope.user_id),
                },
            )

    async with db() as session:
        retriable = await vqe.get_execution(scope, session, execution.id)
        observations = await vqe.list_observations(scope, session, execution.id)
        active_run = await runs.get_run(scope, session, run.id)
        assert retriable.status == "running"
        assert active_run.status == "running"
        assert [(item.attempt, item.status, item.failure_code) for item in observations] == [
            (1, "failed", "runtime_unavailable")
        ]
