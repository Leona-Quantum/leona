"""Pipeline spine E2E (Phase 2 step 1 exit check): POST /v1/runs → jobs row →
worker handler drives the executor → run_events choreography → SSE replay.

Live-DB test in the authz-suite mold: skipped without DATABASE_URL; CI runs it
on the per-PR Neon branch after migrate+seed; locally use a disposable branch
(it commits its fixture rows).
"""

import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_api.jobs import RUN_EXECUTE_JOB_KIND
from majorana_worker.handlers import HANDLERS

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="pipeline e2e needs DATABASE_URL"
)

SETTINGS = Settings(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
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


async def _work_one_job(factory, expected_kind: str) -> None:
    """One worker dispatch cycle, exactly as __main__ sequences it."""
    async with factory() as session:
        job = await system.claim_job(session, worker_id="e2e-test")
        assert job is not None, "expected a queued job"
        assert job.kind == expected_kind
        job_id, payload = job.id, job.payload
        await session.commit()
    async with factory() as session:
        await HANDLERS[expected_kind](session, payload)
    async with factory() as session:
        await system.finish_job(session, job_id=job_id, status="done")
        await session.commit()


@requires_db
async def test_run_executes_end_to_end_with_full_event_log(env):
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

    # idempotent retry returns the same run, creates nothing
    retry = await client.post(
        "/v1/runs",
        json={"task_prompt": "prepare a bell state and measure both qubits"},
        headers={"Idempotency-Key": "e2e-key-1"},
    )
    assert retry.json()["id"] == run["id"]

    await _work_one_job(factory, RUN_EXECUTE_JOB_KIND)

    final = (await client.get(f"/v1/runs/{run['id']}")).json()
    assert final["status"] == "succeeded"
    assert final["started_at"] and final["finished_at"]

    events = (await client.get(f"/v1/runs/{run['id']}/events")).json()
    types = [e["type"] for e in events]
    assert types[0] == "run.queued"
    assert types[1] == "run.started"
    assert types[-1] == "run.finished"
    assert types.count("stage.started") == types.count("stage.finished") == 7
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["status"] == "succeeded"
    # the spine must not claim verification it never did
    assert events[-1]["verifier_decision"] == "inconclusive"

    # SSE replay of the stored run: same rows, same order, ends after run.finished
    async with client.stream("GET", f"/v1/runs/{run['id']}/events/stream") as stream:
        body = ""
        async for chunk in stream.aiter_text():
            body += chunk
    sse_types = [
        line.removeprefix("event: ") for line in body.splitlines() if line.startswith("event: ")
    ]
    assert sse_types == types

    # SSE resume: Last-Event-ID skips already-seen events
    async with client.stream(
        "GET",
        f"/v1/runs/{run['id']}/events/stream",
        headers={"Last-Event-ID": str(len(events) - 1)},
    ) as stream:
        tail = ""
        async for chunk in stream.aiter_text():
            tail += chunk
    assert "event: run.finished" in tail
    assert "event: run.queued" not in tail


@requires_db
async def test_cancel_queued_run_prevents_execution(env):
    client, factory, scope = env

    run = (await client.post("/v1/runs", json={"task_prompt": "cancel me"})).json()
    cancelled = await client.post(f"/v1/runs/{run['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    # terminal → second cancel conflicts
    again = await client.post(f"/v1/runs/{run['id']}/cancel")
    assert again.status_code == 409

    # the queued job is claimed but the executor no-ops on the cancelled run
    await _work_one_job(factory, RUN_EXECUTE_JOB_KIND)
    final = (await client.get(f"/v1/runs/{run['id']}")).json()
    assert final["status"] == "cancelled"
    types = [e["type"] for e in (await client.get(f"/v1/runs/{run['id']}/events")).json()]
    assert types == ["run.queued"]  # nothing executed
