"""Pipeline E2E (Phase 2 Output — headless run demo): POST /v1/runs → jobs row →
worker handler drives the REAL stage handlers (plan→generate→simulate→verify→
baseline→export→save) → full run_events choreography → SSE replay.

Providers are injected: a deterministic FakeLLM (canned Bell plan + code) and the
LocalSubprocessSandbox, so the honest end-to-end path runs in CI without a paid
LLM/Vercel account. The real providers are drop-in (handlers default to them).

Live-DB test in the authz-suite mold: skipped without DATABASE_URL; CI runs it on
the per-PR Neon branch after migrate+seed.
"""

import json
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_llm import FakeLLM
from majorana_llm.models import model_for
from majorana_sandbox import LocalSubprocessSandbox

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_worker.handlers import handle_run_execute

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="pipeline e2e needs DATABASE_URL"
)

SETTINGS = Settings(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

# --- Deterministic model outputs for the Bell task ---------------------------

_PLAN = {
    "domain": "education",
    "framework": "qiskit",
    "algorithm": "Bell",
    "problem_summary": "Prepare a Bell state and measure both qubits",
    "algorithm_rationale": "Hadamard on q0 then CX entangles the pair into (|00>+|11>)/sqrt2",
    "parameters": {"shots": 1024},
    "qubits_estimate": 2,
    "expected_runtime_sec": 5,
    "success_criteria": {"primary_metric": "fidelity"},
    "expected_output_keys": ["counts"],
}

# Pure-stdlib code (no qiskit needed in the test venv): emits the circuit as
# OpenQASM 2 and a JSON result on the last line — exactly the contract the
# simulate handler consumes.
_CODE = """```python
import json

qasm = (
    'OPENQASM 2.0;\\n'
    'include "qelib1.inc";\\n'
    'qreg q[2];\\n'
    'creg c[2];\\n'
    'h q[0];\\n'
    'cx q[0],q[1];\\n'
    'measure q[0] -> c[0];\\n'
    'measure q[1] -> c[1];'
)
print(qasm)
print(json.dumps({"counts": {"00": 512, "11": 512}}))
```"""


def _fake_llm() -> FakeLLM:
    return FakeLLM({model_for("plan"): json.dumps(_PLAN), model_for("generate"): _CODE})


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

    app = create_app(SETTINGS)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (None, None)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, factory, scope
    await engine.dispose()


async def _work_until_run_processed(factory, run_id: str) -> None:
    """Worker dispatch cycles with injected fake providers, until the job for
    `run_id` is handled. Other queued jobs (e.g. the seed fixture's run.execute
    row) go through the same real path."""
    for _ in range(12):
        async with factory() as session:
            job = await system.claim_job(session, worker_id="e2e-test")
            assert job is not None, f"queue drained before run {run_id} was processed"
            job_id, payload = job.id, job.payload
            await session.commit()
        try:
            async with factory() as session:
                await handle_run_execute(
                    session, payload, llm=_fake_llm(), sandbox=LocalSubprocessSandbox()
                )
            status = "done"
        except Exception:
            status = "failed"
        async with factory() as session:
            await system.finish_job(session, job_id=job_id, status=status)
            await session.commit()
        if payload.get("run_id") == run_id:
            assert status == "done"
            return
    raise AssertionError(f"job for run {run_id} not found in 12 claims")


@requires_db
async def test_run_executes_end_to_end_with_real_stages(env):
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
    # A real verification ran and passed — no longer the spine's "inconclusive".
    assert final["verifier_decision"] == "pass"
    assert final["artifact_version_id"]  # SAVE linked the writeback

    events = (await client.get(f"/v1/runs/{run['id']}/events")).json()
    types = [e["type"] for e in events]
    assert types[0] == "run.queued"
    assert types[1] == "run.started"
    assert types[-1] == "run.finished"
    assert types.count("stage.started") == types.count("stage.finished") == 7
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["verifier_decision"] == "pass"

    # The real stages each left their event.
    for expected in (
        "plan.produced",
        "llm.call",
        "code.generated",
        "sandbox.result",
        "verification.result",
        "baseline.result",
        "export.classified",
        "artifact.saved",
    ):
        assert expected in types, f"missing {expected} in {types}"

    export = next(e for e in events if e["type"] == "export.classified")
    assert export["status"] == "lossless"  # Bell → Qiskit is faithful

    # The writeback landed a real artifact version (no library read API yet —
    # Phase 3 — so verify through the repository layer).
    saved = next(e for e in events if e["type"] == "artifact.saved")
    async with factory() as session:
        version = await artifacts_repo.get_version(scope, session, uuid.UUID(saved["version_id"]))
    assert version.export_status == "lossless"
    assert version.fingerprint  # canonical IR fingerprint recorded
    assert version.qasm and "cx q[0],q[1]" in version.qasm

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
    types = [e["type"] for e in (await client.get(f"/v1/runs/{run['id']}/events")).json()]
    assert types == ["run.queued"]  # nothing executed
