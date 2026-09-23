"""Atlas workflow context on POST /v1/runs (routes/runs.py).

A later web PR sends `workflow_context`: the web app's Atlas planner's
deterministic, model-free read of the task — a pipeline of Atlas algorithm
blocks with each cited paper's cost formula evaluated at the user's problem
size. This file is the backend half: accept a well-formed context, forward it
to the worker only for an ordinary execute job (never for circuit
optimization/synthesis, which never plans), and refuse a malformed one at the
edge with a 422 rather than downstream in the worker.
"""

import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from majorana_api.orm import User, Workspace
from majorana_api.routes import runs
from majorana_api.settings import Settings


def _workflow_context(**overrides) -> dict:
    base: dict = dict(
        version=1,
        problem="vqe",
        problem_label="VQE for the H2 ground state",
        planner_path="/repository/plan/vqe",
    )
    base.update(overrides)
    return base


def _identity_and_settings():
    # A DEVELOPER identity, same as test_run_source_drafts.py: the per-tier
    # gate and the submission backstop are no-ops here, since this file is
    # about workflow_context wiring, not allowances.
    identity = (User(email="local-dev@majorana.test", plan=None), Workspace())
    settings = Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
    )
    return identity, settings


def _wire_create_run(monkeypatch, *, run_id: uuid.UUID) -> dict:
    """Stub every repo call `create_run` makes so it runs DB-free, and record
    what it would have written — the same shape test_run_source_drafts.py
    uses for `runs.create_run` itself."""
    captured: dict = {}

    async def create_run(_scope, _session, **values):
        captured["run"] = values
        return SimpleNamespace(id=run_id)

    async def append_event(*_args, **_kwargs):
        return None

    async def enqueue_job(_session, **values):
        captured["job"] = values

    async def no_runs_yet(*_args, **_kwargs):
        return {}

    async def no_queue(*_args, **_kwargs):
        return {}

    async def no_submissions_yet(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(runs.runs_repo, "queue_positions", no_queue)
    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", no_runs_yet)
    monkeypatch.setattr(
        runs.runs_repo, "count_submitted_runs_for_account_since", no_submissions_yet
    )
    monkeypatch.setattr(runs.runs_repo, "create_run", create_run)
    monkeypatch.setattr(runs.runs_repo, "append_run_event", append_event)
    monkeypatch.setattr(runs.system, "enqueue_job", enqueue_job)
    monkeypatch.setattr(runs, "_to_resource", lambda row, queue_position=None: row.id)
    return captured


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


def test_a_valid_workflow_context_is_accepted():
    body = runs.CreateRunRequest(
        task_prompt="Simulate H2 ground state energy with VQE",
        workflow_context=_workflow_context(
            reading=["Peruzzo et al. 2014"],
            params=[
                {
                    "key": "bondlength",
                    "label": "Bond length",
                    "value": 0.74,
                    "origin": "text",
                    "evidence": "0.74 A",
                }
            ],
            stages=[
                {
                    "depth": 0,
                    "capability": "ground-state-energy",
                    "method": "VQE",
                    "why": "first",
                }
            ],
            costs=[
                {
                    "id": "ansatz-depth",
                    "label": "Ansatz depth",
                    "value": 4.0,
                    "unit": "layers",
                    "formula": "O(1)",
                    "kind": "exact",
                    "source": "hardware-efficient ansatz",
                }
            ],
            suggestions=[{"title": "Try UCCSD", "body": "A chemistry-inspired ansatz."}],
            small_instance={"id": "h2-sto3g", "title": "H2 in STO-3G"},
        ),
    )
    assert body.workflow_context is not None
    assert body.workflow_context.problem == "vqe"
    assert body.workflow_context.costs[0].kind == "exact"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("reading", ["x"] * 9),
        ("params", [{"key": "a", "label": "A", "origin": "text"}] * 17),
        (
            "stages",
            [{"depth": 0, "capability": "c", "why": "first"}] * 33,
        ),
        (
            "costs",
            [{"id": "c", "label": "C", "unit": "u", "formula": "f", "kind": "exact"}] * 33,
        ),
        ("suggestions", [{"title": "t", "body": "b"}] * 7),
    ],
)
def test_oversize_lists_are_refused(field, value):
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(
            task_prompt="Simulate H2 ground state energy with VQE",
            workflow_context=_workflow_context(**{field: value}),
        )


def test_a_costs_entry_with_too_many_missing_entries_is_refused():
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(
            task_prompt="Simulate H2 ground state energy with VQE",
            workflow_context=_workflow_context(
                costs=[
                    {
                        "id": "c",
                        "label": "C",
                        "unit": "u",
                        "formula": "f",
                        "kind": "exact",
                        "missing": [f"m{i}" for i in range(13)],
                    }
                ]
            ),
        )


def test_an_unknown_cost_kind_is_refused():
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(
            task_prompt="Simulate H2 ground state energy with VQE",
            workflow_context=_workflow_context(
                costs=[{"id": "c", "label": "C", "unit": "u", "formula": "f", "kind": "guessed"}]
            ),
        )


def test_an_extra_field_is_refused():
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(
            task_prompt="Simulate H2 ground state energy with VQE",
            workflow_context=_workflow_context(unexpected_field="nope"),
        )


def test_a_nan_value_is_refused():
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(
            task_prompt="Simulate H2 ground state energy with VQE",
            workflow_context=_workflow_context(
                params=[{"key": "a", "label": "A", "origin": "text", "value": float("nan")}]
            ),
        )


def test_a_planner_path_outside_repository_plan_is_refused():
    with pytest.raises(ValidationError, match="planner_path"):
        runs.CreateRunRequest(
            task_prompt="Simulate H2 ground state energy with VQE",
            workflow_context=_workflow_context(planner_path="/something/else"),
        )


# --------------------------------------------------------------------------
# create_run wiring: forwarded on execute, absent otherwise, never on
# circuit optimization/synthesis
# --------------------------------------------------------------------------


async def test_workflow_context_lands_in_the_job_payload_for_a_normal_run(scope, monkeypatch):
    run_id = uuid.uuid4()
    body = runs.CreateRunRequest(
        task_prompt="Simulate H2 ground state energy with VQE",
        workflow_context=_workflow_context(),
    )
    captured = _wire_create_run(monkeypatch, run_id=run_id)
    identity, settings = _identity_and_settings()

    result = await runs.create_run(body, scope, object(), identity, settings)

    assert result == run_id
    assert captured["job"]["kind"] == "run.execute"
    assert captured["job"]["payload"]["workflow_context"] == body.workflow_context.model_dump(
        mode="json"
    )


async def test_workflow_context_absent_leaves_the_payload_unchanged(scope, monkeypatch):
    run_id = uuid.uuid4()
    body = runs.CreateRunRequest(task_prompt="Bell state on 2 qubits")
    captured = _wire_create_run(monkeypatch, run_id=run_id)
    identity, settings = _identity_and_settings()

    result = await runs.create_run(body, scope, object(), identity, settings)

    assert result == run_id
    assert "workflow_context" not in captured["job"]["payload"]
    # Otherwise identical to the payload shape from before this field existed.
    assert captured["job"]["payload"] == {
        "run_id": str(run_id),
        "workspace_id": str(scope.workspace_id),
        "user_id": str(scope.user_id),
        "response_locale": "en",
        "allow_ai_assumptions": False,
        "source_intent": "verify",
    }


async def test_workflow_context_is_not_forwarded_for_circuit_optimization(scope, monkeypatch):
    run_id = uuid.uuid4()
    body = runs.CreateRunRequest(
        task_prompt="Compile this Studio circuit",
        mode="execute",
        circuit_optimization={
            "compiler": "qiskit",
            "qubit_count": 1,
            "operations": [{"gate": "H", "qubits": [0]}],
        },
        workflow_context=_workflow_context(),
    )
    captured = _wire_create_run(monkeypatch, run_id=run_id)

    async def no_gate(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runs, "_enforce_execute_backstop", no_gate)

    result = await runs.create_run(body, scope, object(), object(), object())

    assert result == run_id
    assert captured["job"]["kind"] == "circuit.optimize"
    assert "workflow_context" not in captured["job"]["payload"]


async def test_workflow_context_is_not_forwarded_for_circuit_synthesis(scope, monkeypatch):
    run_id = uuid.uuid4()
    body = runs.CreateRunRequest(
        task_prompt="Synthesize this Studio circuit for a line target",
        mode="execute",
        circuit_synthesis={
            "qubit_count": 2,
            "operations": [
                {"gate": "H", "qubits": [0]},
                {"gate": "CX", "qubits": [0, 1]},
            ],
            "target": {"connectivity": "line"},
            "objective": "two_qubit_count",
        },
        workflow_context=_workflow_context(),
    )
    captured = _wire_create_run(monkeypatch, run_id=run_id)

    async def no_gate(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runs, "_enforce_execute_backstop", no_gate)

    result = await runs.create_run(body, scope, object(), object(), object())

    assert result == run_id
    assert captured["job"]["kind"] == "circuit.synthesize"
    assert "workflow_context" not in captured["job"]["payload"]
