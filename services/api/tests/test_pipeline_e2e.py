"""Circuit E2E: POST /v1/runs → job → fixed pipeline → private artifact → SSE.

The live-provider test is explicitly gated and uses a non-executing sandbox double.
Provider-free tests execute only their fixed canned program through the local sandbox;
they never run live-model output outside the production boundary.

Live-DB test in the authz-suite mold: skipped without DATABASE_URL; CI runs it on
the per-PR Neon branch after migrate+seed.
"""

import asyncio
import json
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role
from majorana_frameworks import FrameworkProgram
from majorana_llm import (
    LLMClient,
    LLMResponse,
    default_llm,
    endpoint_for,
    model_for,
    resolve_provider,
)
from majorana_sandbox import ExecutionSpec, LocalSubprocessSandbox, Sandbox, SandboxResult

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_worker import handlers as worker_handlers
from majorana_worker.handlers import handle_run_execute

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="pipeline e2e needs DATABASE_URL"
)


def _live_provider_ready() -> bool:
    if resolve_provider() == "anthropic":
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    required_keys = {
        endpoint_for(model_for(stage))[1] for stage in ("route", "plan", "generate", "verify")
    }
    return all(os.environ.get(key) for key in required_keys)


requires_live_llm = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_LIVE_LLM") != "1" or not _live_provider_ready(),
    reason="live provider test requires MAJORANA_RUN_LIVE_LLM=1 and configured credentials",
)

SETTINGS = Settings(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


class _NonExecutingSandbox:
    provider = "non-executing-test-double"
    environment_id = "test-double:bell-evidence-v1"

    async def _execute(self, spec: ExecutionSpec) -> SandboxResult:
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=1,
            stdout="",
            stderr="",
            provider=self.provider,
            protected_result={
                "source_fingerprint": spec.source_fingerprint,
                "result": {
                    "counts": {"00": 512, "11": 512},
                    "success_probability": 1.0,
                },
                "resource_metrics": {"qubits": 2, "depth": 2, "two_qubit_gates": 1},
            },
        )


class _DeterministicSimpleLLM:
    """Provider-free responses for the fixed pipeline's three typed calls."""

    async def complete(self, request, *, on_delta=None):
        del on_delta
        if request.schema_name == "request_plan":
            payload = {
                "domain": "quantum information",
                "framework": "qiskit",
                "algorithm": "Bell",
                "problem_summary": "Prepare and measure a Bell state",
                "algorithm_rationale": "Hadamard plus CNOT creates the entangled pair",
                "parameters": {"shots": 1024, "seed": 7},
                "qubits_estimate": 2,
                "expected_runtime_sec": 10,
                "success_criteria": {"primary_metric": "counts"},
                "expected_output_keys": ["counts"],
            }
        elif request.schema_name == "generate_circuit":
            payload = {
                "source": (
                    "from qiskit import QuantumCircuit\n"
                    "FINAL_CIRCUIT = QuantumCircuit(2)\n"
                    "FINAL_CIRCUIT.h(0)\n"
                    "FINAL_CIRCUIT.cx(0, 1)\n"
                    'RESULT = {"counts": {"00": 512, "11": 512}}\n'
                )
            }
        elif request.schema_name == "intent_alignment":
            payload = {
                "decision": "ready",
                "confidence": "high",
                "severity": "none",
                "summary": "The request, source, protected result, and basic checks align.",
                "mismatches": [],
                "repair_instructions": [],
                "residual_risks": ["Strict quantum correctness was not verified."],
            }
        else:
            raise AssertionError(f"unexpected simple pipeline call: {request.schema_name}")
        return LLMResponse(
            text=json.dumps(payload),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


class _CountingSimpleLLM(_DeterministicSimpleLLM):
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def complete(self, request, *, on_delta=None):
        self.calls.append(request.schema_name)
        return await super().complete(request, on_delta=on_delta)


class _CrashBeforeSandboxResult:
    provider = "crash-before-result"
    environment_id = "test-double:crash-before-result-v1"

    async def _execute(self, _spec: ExecutionSpec) -> SandboxResult:
        raise asyncio.CancelledError


class _MustNotRunLLM:
    async def complete(self, _request, *, on_delta=None):
        del on_delta
        raise AssertionError("terminal replay must not call the model")


class _MustNotRunSandbox:
    provider = "must-not-run"
    environment_id = "test-double:must-not-run-v1"

    async def _execute(self, _spec: ExecutionSpec) -> SandboxResult:
        raise AssertionError("terminal replay must not enter the sandbox")


@pytest.fixture
async def env():
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        user, ws = await system.get_or_provision_user(
            session,
            workos_user_id=f"pipeline-e2e-{uuid.uuid4()}",
            email=f"pipeline-e2e-{uuid.uuid4().hex[:8]}@e2e.test",
        )
        await session.commit()
        scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)
        # Snapshot the fields run admission reads while the session is still
        # open. `user` itself is detached once this block exits, and `plan` has a
        # server default that a flush does not populate, so a later attribute
        # access on it would go looking for a session that is gone.
        identity = (User(id=user.id, email=user.email, plan=user.plan), ws)

    app = create_app(SETTINGS)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    # The REAL provisioned identity, not the (None, None) stub this used to be.
    # Run admission resolves the account's tier from the user now, so the stub
    # both crashed the route and stopped this suite exercising the gate every
    # real submission passes through.
    app.dependency_overrides[auth_deps.get_identity] = lambda: identity

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, factory, scope
    await engine.dispose()


async def _work_until_run_processed(
    factory,
    run_id: str,
    *,
    llm: LLMClient | None = None,
    sandbox: Sandbox | None = None,
) -> None:
    """Worker dispatch cycles until the requested queued run is handled."""
    live_llm = llm or default_llm()
    for _ in range(12):
        async with factory() as session:
            job = await system.claim_job(session, worker_id="e2e-test")
            assert job is not None, f"queue drained before run {run_id} was processed"
            job_id, payload, lease_token = job.id, job.payload, job.lease_token
            assert lease_token is not None
            await session.commit()
        try:
            async with factory() as session:
                await handle_run_execute(
                    session,
                    payload,
                    llm=live_llm,
                    sandbox=sandbox or _NonExecutingSandbox(),
                )
            status = "done"
        except Exception:
            status = "failed"
        async with factory() as session:
            await system.finish_job(
                session,
                job_id=job_id,
                lease_token=lease_token,
                status=status,
                last_error_kind="e2e_handler" if status == "failed" else None,
            )
            await session.commit()
        if payload.get("run_id") == run_id:
            assert status == "done"
            return
    raise AssertionError(f"job for run {run_id} not found in 12 claims")


@requires_db
async def test_simple_run_persists_typed_advisory_outcome_end_to_end(env):
    """API → queue → fixed worker → local sandbox → DB → API/SSE, without provider spend."""

    client, factory, scope = env
    response = await client.post(
        "/v1/runs",
        json={
            "task_prompt": "prepare a bell state and measure both qubits",
            "mode": "execute",
            "framework": "qiskit",
            "shots": 1024,
            "seed": 7,
        },
        headers={"Idempotency-Key": f"simple-e2e-{uuid.uuid4()}"},
    )
    assert response.status_code == 201, response.text
    run = response.json()

    await _work_until_run_processed(
        factory,
        run["id"],
        llm=_DeterministicSimpleLLM(),
        sandbox=LocalSubprocessSandbox(),
    )

    final = (await client.get(f"/v1/runs/{run['id']}")).json()
    assert final["status"] == "succeeded"
    assert final["verifier_decision"] == "inconclusive"
    assert final["artifact_version_id"]
    summary = final["verification_summary"]
    assert summary["decision"] == "inconclusive"
    assert summary["evidence_strength"] == "structural"
    assert summary["reason_code"] == "ai_review_aligned"
    assert summary["failure_class"] == "evidence_gap"
    assert summary["checks"] == [
        {"method": "structural", "result": "pass"},
        {"method": "return_contract", "result": "pass"},
        {"method": "success_criteria", "result": "pass"},
    ]

    events = (await client.get(f"/v1/runs/{run['id']}/events")).json()
    types = [event["type"] for event in events]
    assert types[0] == "run.queued"
    assert types[-1] == "run.finished"
    for expected in (
        "plan.produced",
        "code.generated",
        "sandbox.result",
        "artifact.saved",
    ):
        assert expected in types
    assert events[-1]["verification_summary"] == summary

    saved = next(event for event in events if event["type"] == "artifact.saved")
    async with factory() as session:
        version = await artifacts_repo.get_version(scope, session, uuid.UUID(saved["version_id"]))
    assert version.artifact_metadata["verification_summary"] == summary
    assert version.artifact_metadata["source"] == "simple_pipeline_candidate"
    assert version.fingerprint == FrameworkProgram(Framework.QISKIT, version.code).fingerprint

    async with client.stream("GET", f"/v1/runs/{run['id']}/events/stream") as stream:
        body = "".join([chunk async for chunk in stream.aiter_text()])
    sse_types = [
        line.removeprefix("event: ") for line in body.splitlines() if line.startswith("event: ")
    ]
    assert sse_types == types


@requires_db
@requires_live_llm
async def test_run_executes_end_to_end_with_real_fixed_pipeline(env):
    client, factory, scope = env

    resp = await client.post(
        "/v1/runs",
        json={"task_prompt": "prepare a bell state and measure both qubits"},
        headers={"Idempotency-Key": "e2e-key-1"},
    )
    assert resp.status_code == 201, resp.text
    run = resp.json()
    assert run["status"] == "queued"
    assert run["framework"] == "qiskit"  # owner default

    retry = await client.post(
        "/v1/runs",
        json={"task_prompt": "prepare a bell state and measure both qubits"},
        headers={"Idempotency-Key": "e2e-key-1"},
    )
    assert retry.json()["id"] == run["id"]  # idempotent

    await _work_until_run_processed(factory, run["id"])

    final = (await client.get(f"/v1/runs/{run['id']}")).json()
    assert final["status"] == "succeeded"
    assert final["started_at"] and final["finished_at"]
    assert final["verifier_decision"] == "inconclusive"
    assert final["verification_summary"]["decision"] == "inconclusive"
    assert final["verification_summary"]["evidence_strength"] == "structural"
    assert final["verification_summary"]["reason_code"] == "ai_review_aligned"
    assert final["artifact_version_id"]  # SAVE linked the writeback

    events = (await client.get(f"/v1/runs/{run['id']}/events")).json()
    types = [e["type"] for e in events]
    assert types[0] == "run.queued"
    assert types[1] == "run.started"
    assert types[-1] == "run.finished"
    assert "stage.started" not in types
    assert "stage.finished" not in types
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["verifier_decision"] == "inconclusive"
    assert events[-1]["evidence_strength"] == "structural"

    # The fixed pipeline exposes stable product events without legacy stages.
    for expected in (
        "plan.produced",
        "code.generated",
        "sandbox.result",
        "verification.semantic_review",
        "code.finalized",
        "artifact.saved",
    ):
        assert expected in types, f"missing {expected} in {types}"

    # The writeback landed a real artifact version (no library read API yet —
    # Phase 3 — so verify through the repository layer).
    saved = next(e for e in events if e["type"] == "artifact.saved")
    async with factory() as session:
        version = await artifacts_repo.get_version(scope, session, uuid.UUID(saved["version_id"]))
    assert version.export_status == "lossless"
    if version.qasm is not None:
        assert version.qasm_version == "3.0"
        assert version.qasm.startswith("OPENQASM 3.0;")
    assert version.fingerprint == FrameworkProgram(Framework.QISKIT, version.code).fingerprint
    assert version.artifact_metadata["canonical_representation"] == "framework_code"
    assert version.artifact_metadata["openqasm_role"] == "interchange"
    assert version.artifact_metadata["verification_summary"]["decision"] == "inconclusive"

    # SSE replay of the stored run: same rows, same order.
    async with client.stream("GET", f"/v1/runs/{run['id']}/events/stream") as stream:
        body = ""
        async for chunk in stream.aiter_text():
            body += chunk
    sse_types = [
        line.removeprefix("event: ") for line in body.splitlines() if line.startswith("event: ")
    ]
    assert sse_types == types


@requires_db
async def test_simple_run_recovers_after_worker_interruption_without_duplicate_work(env):
    client, factory, _scope = env
    response = await client.post(
        "/v1/runs",
        json={
            "task_prompt": "prepare a bell state and measure both qubits",
            "mode": "execute",
            "framework": "qiskit",
            "shots": 1024,
            "seed": 7,
        },
        headers={"Idempotency-Key": f"simple-recovery-{uuid.uuid4()}"},
    )
    assert response.status_code == 201, response.text
    run_id = response.json()["id"]

    async with factory() as session:
        job = await system.claim_job(session, worker_id="e2e-recovery")
        assert job is not None
        assert job.payload["run_id"] == run_id
        payload = job.payload
        job_id = job.id
        lease_token = job.lease_token
        assert lease_token is not None
        await session.commit()

    llm = _CountingSimpleLLM()
    with pytest.raises(asyncio.CancelledError):
        async with factory() as session:
            await handle_run_execute(
                session,
                payload,
                llm=llm,
                sandbox=_CrashBeforeSandboxResult(),
            )

    interrupted = (await client.get(f"/v1/runs/{run_id}")).json()
    assert interrupted["status"] == "running"
    interrupted_events = (await client.get(f"/v1/runs/{run_id}/events")).json()
    assert [event["type"] for event in interrupted_events].count("plan.produced") == 1
    assert [event["type"] for event in interrupted_events].count("code.generated") == 1
    assert "sandbox.result" not in [event["type"] for event in interrupted_events]

    async with factory() as session:
        await handle_run_execute(
            session,
            payload,
            llm=llm,
            sandbox=_NonExecutingSandbox(),
        )
    async with factory() as session:
        await system.finish_job(
            session,
            job_id=job_id,
            lease_token=lease_token,
            status="done",
        )
        await session.commit()

    final = (await client.get(f"/v1/runs/{run_id}")).json()
    assert final["status"] == "succeeded"
    assert llm.calls.count("request_plan") == 1
    assert llm.calls.count("generate_circuit") == 1
    assert llm.calls.count("intent_alignment") == 1

    events_before_terminal_replay = (await client.get(f"/v1/runs/{run_id}/events")).json()
    types = [event["type"] for event in events_before_terminal_replay]
    assert types.count("run.started") == 1
    assert types.count("plan.produced") == 1
    assert types.count("code.generated") == 1
    assert types.count("sandbox.result") == 1
    assert types.count("artifact.saved") == 1
    assert types.count("run.finished") == 1

    async with factory() as session:
        await handle_run_execute(
            session,
            payload,
            llm=_MustNotRunLLM(),
            sandbox=_MustNotRunSandbox(),
        )
    assert (await client.get(f"/v1/runs/{run_id}/events")).json() == (events_before_terminal_replay)


@requires_db
async def test_simple_run_reconciles_transient_event_projection_failure(
    env,
    monkeypatch,
):
    client, factory, _scope = env
    original_emit = worker_handlers.RepoEventSink.emit
    failed_once = False

    async def flaky_emit(self, event_type, payload, *, event_id=None):
        nonlocal failed_once
        if event_type == "code.generated" and not failed_once:
            failed_once = True
            raise RuntimeError("event store temporarily unavailable")
        await original_emit(self, event_type, payload, event_id=event_id)

    monkeypatch.setattr(worker_handlers.RepoEventSink, "emit", flaky_emit)
    response = await client.post(
        "/v1/runs",
        json={
            "task_prompt": "prepare a bell state and measure both qubits",
            "mode": "execute",
            "framework": "qiskit",
        },
        headers={"Idempotency-Key": f"simple-event-recovery-{uuid.uuid4()}"},
    )
    assert response.status_code == 201, response.text
    run_id = response.json()["id"]

    await _work_until_run_processed(
        factory,
        run_id,
        llm=_DeterministicSimpleLLM(),
        sandbox=_NonExecutingSandbox(),
    )

    final = (await client.get(f"/v1/runs/{run_id}")).json()
    assert failed_once is True
    assert final["status"] == "succeeded"
    types = [event["type"] for event in (await client.get(f"/v1/runs/{run_id}/events")).json()]
    assert types.count("code.generated") == 1
    assert types.count("sandbox.result") == 1
    assert types.count("artifact.saved") == 1
    assert types.count("run.finished") == 1


@requires_db
async def test_cancel_queued_run_prevents_execution(env):
    client, factory, scope = env

    run = (await client.post("/v1/runs", json={"task_prompt": "cancel me"})).json()
    cancelled = await client.post(f"/v1/runs/{run['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    again = await client.post(f"/v1/runs/{run['id']}/cancel")
    assert again.status_code == 409  # terminal → second cancel conflicts

    await _work_until_run_processed(factory, run["id"])
    final = (await client.get(f"/v1/runs/{run['id']}")).json()
    assert final["status"] == "cancelled"
    events = (await client.get(f"/v1/runs/{run['id']}/events")).json()
    assert [event["type"] for event in events] == ["run.queued", "run.finished"]
    assert events[-1]["status"] == "cancelled"  # terminalized, but nothing executed
