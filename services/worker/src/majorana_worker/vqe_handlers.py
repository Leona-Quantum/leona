"""VQE-specific durable job handling.

This module keeps the VQE execution lifecycle out of the worker's shared
dispatch module.  The caller supplies the repository-backed run store and
event sink so this code remains compatible with the worker's existing scoped
persistence boundary without importing :mod:`majorana_worker.handlers`.
"""

import uuid
from collections.abc import Callable
from typing import Any, Protocol

from majorana_contracts import Scope
from majorana_contracts.enums import RunStatus
from majorana_vqe.models import ExecutionBinding
from majorana_vqe.result import ExecutionFailureResult

from majorana_api.db import AsyncSession
from majorana_api.repos import vqe as vqe_repo
from majorana_api.vqe_runtime_profiles import profile_for_binding

from .errors import RetryableJobError
from .vqe_runtime import (
    OptimizerAlgorithm,
    VqeRuntimeCancelled,
    VqeRuntimeError,
    build_success_evidence,
    execute_candidate_image,
)


class RunStore(Protocol):
    async def current_status(self) -> RunStatus: ...

    async def set_status(self, new: RunStatus, **fields: Any) -> None: ...

    async def finish(
        self,
        status: RunStatus,
        payload: dict[str, Any],
        **fields: Any,
    ) -> RunStatus: ...


class EventSink(Protocol):
    async def emit(
        self,
        type: str,
        payload: dict[str, Any],
        *,
        event_id: uuid.UUID | None = None,
    ) -> None: ...


RunStoreFactory = Callable[[Scope, AsyncSession, uuid.UUID], RunStore]
EventSinkFactory = Callable[[Scope, AsyncSession, uuid.UUID], EventSink]


def _ansatz_digest(scientific_spec_json: dict[str, Any]) -> str:
    for component in scientific_spec_json.get("component_bindings", []):
        if component.get("role") == "ansatz":
            return str(component["component_spec_sha256"])
    raise ValueError("portable scientific spec lacks an ansatz binding")


def optimizer_algorithm(
    scientific_spec_json: dict[str, Any],
) -> OptimizerAlgorithm:
    """Resolve only optimizer definitions admitted by the frozen registry."""
    frozen_h2_bounded_scalar = (
        "h2.sto3g.actual_vqe.v0_2.parameter_optimizer",
        "dabb6c8ff883eb2e5c969a988a7a416a7415025e6cfa163e98a29ba262e5645c",
    )
    for component in scientific_spec_json.get("component_bindings", []):
        if component.get("role") != "parameter_optimizer":
            continue
        semantic_key = component.get("component_semantic_key")
        if semantic_key == "optimizer.scipy_bounded_scalar.v1":
            return "scipy_minimize_scalar_bounded"
        if (
            semantic_key,
            component.get("component_spec_sha256"),
        ) == frozen_h2_bounded_scalar:
            # The owner-waived H2 v0.2 registry predates the canonical
            # component key. Accept only its exact reviewed digest; a reused
            # legacy key with different scientific content remains rejected.
            return "scipy_minimize_scalar_bounded"
        if semantic_key == "optimizer.slsqp.v1":
            return "scipy_slsqp"
        if semantic_key == "optimizer.cobyla.v1":
            return "scipy_cobyla"
        raise ValueError(f"unsupported optimizer semantic key {semantic_key!r}")
    raise ValueError("portable scientific spec lacks an optimizer binding")


async def handle_vqe_execute(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    scope: Scope,
    run_store_factory: RunStoreFactory,
    event_sink_factory: EventSinkFactory,
) -> None:
    """Execute one frozen H2 candidate and append capability-specific evidence."""
    execution_id = uuid.UUID(payload["execution_id"])
    run_id = uuid.UUID(payload["run_id"])
    execution = await vqe_repo.get_execution(scope, session, execution_id)
    if execution.run_id != run_id:
        raise ValueError("VQE job run does not match execution binding")
    if execution.status in {"succeeded", "failed", "cancelled"}:
        return
    run_store = run_store_factory(scope, session, run_id)
    if await run_store.current_status() is RunStatus.CANCELLED:
        await vqe_repo.transition_execution(
            scope,
            session,
            execution.id,
            new_status="cancelled",
        )
        await session.commit()
        return
    if execution.status == "queued":
        execution = await vqe_repo.transition_execution(
            scope,
            session,
            execution.id,
            new_status="running",
        )
        await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
        await event_sink_factory(scope, session, run_id).emit(
            "run.started",
            {},
            event_id=uuid.uuid5(run_id, "run.started"),
        )

    experiment = await vqe_repo.get_experiment(scope, session, execution.experiment_id)
    binding = ExecutionBinding.model_validate(execution.execution_binding_json)
    profile = profile_for_binding(binding)
    selected_optimizer = optimizer_algorithm(experiment.scientific_spec_json)
    try:
        runtime_output = await execute_candidate_image(
            profile,
            optimizer_algorithm=selected_optimizer,
            cancel_requested=lambda: _cancel_requested(run_store),
        )
        if await run_store.current_status() is RunStatus.CANCELLED:
            current_execution = await vqe_repo.get_execution(
                scope,
                session,
                execution.id,
            )
            if current_execution.status == "running":
                await vqe_repo.transition_execution(
                    scope,
                    session,
                    execution.id,
                    new_status="cancelled",
                )
                await session.commit()
            return
        evidence = build_success_evidence(
            runtime_output.payload,
            binding=binding,
            scientific_spec_sha256=experiment.scientific_spec_sha256,
            registry_resolution_sha256=experiment.registry_resolution_sha256,
            ansatz_semantic_digest=_ansatz_digest(experiment.scientific_spec_json),
            seed=int(experiment.scientific_spec_json["seed"]),
            expected_optimizer_algorithm=selected_optimizer,
        )
    except VqeRuntimeCancelled:
        current_execution = await vqe_repo.get_execution(scope, session, execution.id)
        if current_execution.status in {"planned", "queued", "running"}:
            await vqe_repo.transition_execution(
                scope,
                session,
                execution.id,
                new_status="cancelled",
            )
            await session.commit()
        return
    except VqeRuntimeError as exc:
        failure_code = exc.failure_code
        failure = ExecutionFailureResult(
            scientific_spec_sha256=experiment.scientific_spec_sha256,
            registry_resolution_sha256=experiment.registry_resolution_sha256,
            framework=binding.framework,
            runtime_profile_id=binding.runtime_profile_id,
            runtime_image_digest=binding.container_digest,
            adapter_release_id=binding.adapter_release_id,
            provider_versions=binding.provider_versions,
            hamiltonian_exact_digest=(
                "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
            ),
            seed=int(experiment.scientific_spec_json["seed"]),
            status="failed",
            failure_code=failure_code,
            failure_detail=str(exc)[:500],
        )
        observation = await vqe_repo.append_observation(
            scope,
            session,
            execution.id,
            attempt=None,
            evidence=failure,
        )
        attempt = observation.attempt
        if exc.retryable:
            await session.commit()
            raise RetryableJobError(str(exc)) from exc
        await vqe_repo.transition_execution(
            scope,
            session,
            execution.id,
            new_status="failed",
        )
        await event_sink_factory(scope, session, run_id).emit(
            "run.error",
            {
                "stage": "final_execute",
                "code": failure_code.value,
                "message": str(exc)[:2000],
            },
            event_id=uuid.uuid5(run_id, f"run.error.vqe.{attempt}"),
        )
        await run_store.finish(
            RunStatus.FAILED,
            {
                "status": RunStatus.FAILED,
                "reason_code": failure_code.value,
            },
        )
        return

    current_execution = await vqe_repo.get_execution(scope, session, execution.id)
    if current_execution.status in {"succeeded", "failed", "cancelled"}:
        return
    await vqe_repo.append_observation(
        scope,
        session,
        execution.id,
        attempt=None,
        evidence=evidence,
        evidence_json={
            "stderr_was_empty": not bool(runtime_output.bounded_stderr),
            "human_review_state": "owner_waived",
            "production_runtime_status": binding.production_runtime_status,
        },
    )
    await vqe_repo.transition_execution(
        scope,
        session,
        execution.id,
        new_status="succeeded",
    )
    await run_store.finish(
        RunStatus.SUCCEEDED,
        {
            "status": RunStatus.SUCCEEDED,
        },
    )


async def _cancel_requested(run_store: RunStore) -> bool:
    return await run_store.current_status() is RunStatus.CANCELLED
