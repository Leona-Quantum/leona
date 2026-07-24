import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

from majorana_contracts.enums import Algorithm
from majorana_contracts.plan import Plan
from majorana_worker import agent_store
from majorana_worker.agent_store import RepoAgentStore


def _plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build a Bell state",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
        }
    )


def test_repo_store_maps_plan_revision_without_legacy_inference() -> None:
    plan = _plan()
    plan_json = plan.model_dump(mode="json")
    fingerprint = hashlib.sha256(
        json.dumps(plan_json, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    row = SimpleNamespace(
        id=uuid4(),
        run_id=uuid4(),
        revision=2,
        parent_plan_id=uuid4(),
        plan=plan_json,
        plan_fingerprint=fingerprint,
        replan_reason="clarify request",
    )

    record = RepoAgentStore._plan_revision(row)

    assert record.plan_id == row.id
    assert record.revision == 2
    assert record.parent_plan_id == row.parent_plan_id
    assert record.plan_fingerprint == fingerprint


def test_repo_store_maps_typed_semantic_review() -> None:
    candidate_id = uuid4()
    execution_id = uuid4()
    review_id = uuid4()
    fingerprint = "a" * 64
    review_row = SimpleNamespace(
        id=review_id,
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint=fingerprint,
        attempt_seq=2,
        decision="ready",
        confidence="high",
        severity="none",
        reason_code="semantic_ready",
        failure_class=None,
        retry_target="none",
        feedback={"summary": "aligned"},
    )
    review = RepoAgentStore._semantic_review(review_row)

    assert review.decision.value == "ready"
    assert review.retry_target.value == "none"


async def test_repo_store_detects_only_non_simple_progress_as_legacy(monkeypatch) -> None:
    store = RepoAgentStore(object(), object())

    async def simple_steps(*_args):
        return [SimpleNamespace(tool_call_id="simple:plan:1")]

    monkeypatch.setattr(agent_store.agent_repo, "list_steps", simple_steps)
    assert await store.has_legacy_progress(uuid4()) is False

    async def legacy_steps(*_args):
        return [SimpleNamespace(tool_call_id="model-selected-step")]

    monkeypatch.setattr(agent_store.agent_repo, "list_steps", legacy_steps)
    assert await store.has_legacy_progress(uuid4()) is True


async def test_repo_store_detects_step_less_historical_plan(monkeypatch) -> None:
    store = RepoAgentStore(object(), object())

    async def no_steps(*_args):
        return []

    async def historical_plan(*_args):
        return SimpleNamespace(id=uuid4())

    async def no_candidates(*_args):
        return []

    monkeypatch.setattr(agent_store.agent_repo, "list_steps", no_steps)
    monkeypatch.setattr(agent_store.agent_repo, "latest_plan_revision", historical_plan)
    monkeypatch.setattr(agent_store.agent_repo, "list_candidates", no_candidates)

    assert await store.has_legacy_progress(uuid4()) is True


async def test_repo_store_can_decode_historical_strict_step(monkeypatch) -> None:
    store = RepoAgentStore(object(), object())
    row = SimpleNamespace(
        tool_call_id="legacy-strict-1",
        name="strict_verify",
        status="completed",
        state="verified",
        result={"decision": "pass"},
        error_code=None,
        error_message=None,
    )

    async def historical_step(*_args):
        return row

    monkeypatch.setattr(agent_store.agent_repo, "get_step", historical_step)

    result = await store.completed_tool_call(uuid4(), row.tool_call_id)

    assert result is not None
    assert result.name.value == "strict_verify"
    assert result.state.value == "verified"
