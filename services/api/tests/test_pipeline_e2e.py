"""Agent E2E: POST /v1/runs → job → durable tool loop → verified artifact → SSE.

The successful execution test is explicitly gated on a configured real LLM. Generated
code is not executed by this orchestration test: a deterministic sandbox double returns
provider-owned evidence, so the test cannot accidentally grant network access.

Live-DB test in the authz-suite mold: skipped without DATABASE_URL; CI runs it on
the per-PR Neon branch after migrate+seed.
"""

import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role
from majorana_frameworks import FrameworkProgram
from majorana_llm import LLMClient, default_llm
from majorana_sandbox import ExecutionSpec, SandboxResult

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


def _live_provider_ready() -> bool:
    provider = os.environ.get("MAJORANA_LLM_PROVIDER", "").strip().lower()
    if provider == "anthropic":
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    if provider == "openai":
        return bool(os.environ.get("OPENAI_API_KEY") and os.environ.get("DEEPSEEK_API_KEY"))
    return bool(os.environ.get("ANTHROPIC_API_KEY")) or bool(
        os.environ.get("OPENAI_API_KEY") and os.environ.get("DEEPSEEK_API_KEY")
    )


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


async def _work_until_run_processed(factory, run_id: str, *, llm: LLMClient | None = None) -> None:
    """Worker dispatch cycles with the configured real provider until the job is handled."""
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
                    session, payload, llm=live_llm, sandbox=_NonExecutingSandbox()
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
@requires_live_llm
async def test_run_executes_end_to_end_with_real_agent_tools(env):
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
    assert "stage.started" not in types
    assert "stage.finished" not in types
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["verifier_decision"] == "pass"
    # A pass must say what it was proved by. Bell-state runs plan `statistical`, so
    # the grade here should be the strong one — if this reads "structural" the run
    # passed on contract checks alone and the plan quietly asked for no physics.
    assert events[-1]["evidence_strength"] == "physical"

    # The durable tool loop exposes stable product events without legacy stages.
    for expected in (
        "plan.produced",
        "code.generated",
        "sandbox.result",
        "verification.result",
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
    assert version.metadata["canonical_representation"] == "framework_code"
    assert version.metadata["openqasm_role"] == "interchange"

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
    events = (await client.get(f"/v1/runs/{run['id']}/events")).json()
    assert [event["type"] for event in events] == ["run.queued", "run.finished"]
    assert events[-1]["status"] == "cancelled"  # terminalized, but nothing executed
