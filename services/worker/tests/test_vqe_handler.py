import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import RunStatus
from majorana_vqe.models import FailureCode, Framework

from majorana_api.vqe_runtime_profiles import candidate_runtime_profile
from majorana_worker import handlers
from majorana_worker.errors import RetryableJobError
from majorana_worker.vqe_runtime import VqeRuntimeError, VqeRuntimeOutput

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"


class Session:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


class RunStore:
    instances: list["RunStore"] = []

    def __init__(self, scope, session, run_id) -> None:
        self.status = RunStatus.QUEUED
        self.finished: RunStatus | None = None
        self.__class__.instances.append(self)

    async def current_status(self) -> RunStatus:
        return self.status

    async def set_status(self, status: RunStatus, **fields) -> None:
        self.status = status

    async def finish(self, status: RunStatus, payload, **fields) -> RunStatus:
        self.status = status
        self.finished = status
        return status


class EventSink:
    events: list[tuple[str, dict]] = []

    def __init__(self, scope, session, run_id) -> None:
        pass

    async def emit(self, event_type, payload, **kwargs) -> None:
        self.__class__.events.append((event_type, payload))


def _install_common(monkeypatch):
    execution_id = uuid.uuid4()
    run_id = uuid.uuid4()
    experiment_id = uuid.uuid4()
    profile = candidate_runtime_profile(Framework.QISKIT)
    state = {
        "execution": SimpleNamespace(
            id=execution_id,
            run_id=run_id,
            experiment_id=experiment_id,
            status="queued",
            execution_binding_json=profile.binding.model_dump(mode="json"),
        ),
        "observations": [],
    }
    experiment = SimpleNamespace(
        scientific_spec_sha256="1" * 64,
        registry_resolution_sha256="2" * 64,
        scientific_spec_json={
            "seed": 0,
            "component_bindings": [
                {"role": "ansatz", "component_spec_sha256": "3" * 64},
                {
                    "role": "parameter_optimizer",
                    "component_semantic_key": "optimizer.scipy_bounded_scalar.v1",
                    "component_spec_sha256": "4" * 64,
                },
            ],
        },
    )

    async def get_execution(scope, session, requested_id):
        assert requested_id == execution_id
        return state["execution"]

    async def transition(scope, session, requested_id, *, new_status):
        assert requested_id == execution_id
        state["execution"].status = new_status
        return state["execution"]

    async def get_experiment(scope, session, requested_id):
        assert requested_id == experiment_id
        return experiment

    async def list_observations(scope, session, requested_id):
        return list(state["observations"])

    async def append_observation(scope, session, requested_id, *, evidence, **kwargs):
        state["observations"].append(evidence)
        return SimpleNamespace(attempt=len(state["observations"]))

    monkeypatch.setattr(handlers, "RepoRunStateStore", RunStore)
    monkeypatch.setattr(handlers, "RepoEventSink", EventSink)
    monkeypatch.setattr(handlers.vqe_repo, "get_execution", get_execution)
    monkeypatch.setattr(handlers.vqe_repo, "transition_execution", transition)
    monkeypatch.setattr(handlers.vqe_repo, "get_experiment", get_experiment)
    monkeypatch.setattr(handlers.vqe_repo, "list_observations", list_observations)
    monkeypatch.setattr(handlers.vqe_repo, "append_observation", append_observation)
    payload = {
        "execution_id": str(execution_id),
        "run_id": str(run_id),
        "workspace_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
    }
    return state, payload


def test_optimizer_algorithm_accepts_only_exact_frozen_h2_legacy_digest():
    binding = {
        "role": "parameter_optimizer",
        "component_semantic_key": "h2.sto3g.actual_vqe.v0_2.parameter_optimizer",
        "component_spec_sha256": (
            "dabb6c8ff883eb2e5c969a988a7a416a7415025e6cfa163e98a29ba262e5645c"
        ),
    }
    assert (
        handlers._optimizer_algorithm({"component_bindings": [binding]})
        == "scipy_minimize_scalar_bounded"
    )

    binding["component_spec_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="unsupported optimizer semantic key"):
        handlers._optimizer_algorithm({"component_bindings": [binding]})


async def test_vqe_handler_persists_success_and_closes_both_lifecycles(monkeypatch):
    RunStore.instances.clear()
    EventSink.events.clear()
    state, payload = _install_common(monkeypatch)
    report = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())

    async def execute(profile, **kwargs):
        return VqeRuntimeOutput(payload=report, bounded_stderr="")

    monkeypatch.setattr(handlers, "execute_candidate_image", execute)
    await handlers.handle_vqe_execute(Session(), payload)

    assert state["execution"].status == "succeeded"
    assert len(state["observations"]) == 1
    assert state["observations"][0].status == "succeeded"
    assert RunStore.instances[-1].finished is RunStatus.SUCCEEDED
    assert EventSink.events == [("run.started", {})]


async def test_vqe_handler_appends_retry_observation_without_false_terminal_state(monkeypatch):
    RunStore.instances.clear()
    EventSink.events.clear()
    state, payload = _install_common(monkeypatch)

    async def execute(profile, **kwargs):
        raise VqeRuntimeError(
            "temporary Docker outage",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=True,
        )

    monkeypatch.setattr(handlers, "execute_candidate_image", execute)
    session = Session()
    with pytest.raises(RetryableJobError, match="temporary Docker outage"):
        await handlers.handle_vqe_execute(session, payload)

    assert state["execution"].status == "running"
    assert len(state["observations"]) == 1
    assert state["observations"][0].status == "failed"
    assert RunStore.instances[-1].finished is None
    assert session.commits == 1
