"""Private Phase 6 system E2E over WorkOS-shaped JWT, Neon, and real OCI Docker.

This is deliberately opt-in. CI provides a disposable Neon branch, provisions
the frozen H2 workflow for the same identity, pulls the approved image before
the test, and then sets ``--pull=never`` execution mode. The local JWKS issuer
exercises the production verification code without claiming that a real WorkOS
tenant was used.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from majorana_api.app import create_app
from majorana_api.auth import jwt as auth_jwt
from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_worker.handlers import handle_vqe_execute

requires_production_e2e = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_VQE_PRODUCTION_E2E") != "1"
    or "DATABASE_URL" not in os.environ
    or "MAJORANA_VQE_E2E_WORKFLOW_ID" not in os.environ,
    reason="requires explicit production E2E gate, Neon, and provisioned H2 workflow",
)

CLIENT_ID = "client_vqe_production_e2e"
SUBJECT = "vqe-production-e2e"


class _JwksHandler(BaseHTTPRequestHandler):
    jwks: dict[str, object] = {}

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/jwks":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(self.jwks).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def _start_jwks_server() -> tuple[ThreadingHTTPServer, threading.Thread, object]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": "phase6-e2e", "use": "sig", "alg": "RS256"})
    _JwksHandler.jwks = {"keys": [jwk]}
    server = ThreadingHTTPServer(("127.0.0.1", 0), _JwksHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, private_key


def _token(private_key: object, issuer: str) -> str:
    now = dt.datetime.now(dt.UTC)
    return pyjwt.encode(
        {
            "iss": issuer,
            "sub": SUBJECT,
            "sid": "session_phase6_e2e",
            "client_id": CLIENT_ID,
            "iat": now,
            "exp": now + dt.timedelta(minutes=10),
            "email": "vqe-production-e2e@majorana.test",
            "name": "VQE production E2E",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "phase6-e2e"},
    )


@requires_production_e2e
@pytest.mark.parametrize("framework", ["qiskit", "pennylane"])
async def test_workos_contract_neon_and_real_oci_runtime_end_to_end(framework: str):
    server, thread, private_key = _start_jwks_server()
    issuer = f"http://127.0.0.1:{server.server_port}"
    auth_jwt._jwk_client.cache_clear()
    engine = engine_from_env()
    factory = session_factory(engine)
    settings = Settings(
        workos_client_id=CLIENT_ID,
        workos_jwt_issuer=issuer,
        workos_jwks_url=f"{issuer}/jwks",
        web_origin="http://test",
        environment="production",
        vqe_production_execution=True,
    )
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = factory
    headers = {"Authorization": f"Bearer {_token(private_key, issuer)}"}

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=headers,
        ) as client:
            me = await client.get("/v1/me")
            assert me.status_code == 200, me.text

            experiment_response = await client.post(
                "/v1/vqe/experiments",
                headers={"Idempotency-Key": f"phase6-production-e2e-experiment-{framework}"},
                json={"workflow_artifact_version_id": os.environ["MAJORANA_VQE_E2E_WORKFLOW_ID"]},
            )
            assert experiment_response.status_code == 201, experiment_response.text
            experiment = experiment_response.json()

            execution_response = await client.post(
                f"/v1/vqe/experiments/{experiment['id']}/executions",
                headers={"Idempotency-Key": f"phase6-production-e2e-execution-{framework}"},
                json={
                    "requested_capability": "h2_sto3g_actual_vqe_v1",
                    "preferred_framework": framework,
                },
            )
            assert execution_response.status_code == 201, execution_response.text
            execution = execution_response.json()
            assert execution["production_runtime_status"] == "qualified"
            assert execution["review_state"] == "owner_waived"

        async with factory() as session:
            job = await system.claim_job(
                session,
                worker_id="phase6-production-e2e",
                lease_seconds=300,
            )
            assert job is not None
            assert job.kind == "vqe.execute"
            assert job.payload["execution_id"] == execution["id"]
            lease_token = job.lease_token
            assert lease_token is not None
            payload = dict(job.payload)
            await session.commit()

        async with factory() as session:
            await handle_vqe_execute(session, payload)

        async with factory() as session:
            await system.finish_job(
                session,
                job_id=job.id,
                lease_token=lease_token,
                status="done",
            )
            await session.commit()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=headers,
        ) as client:
            final_response = await client.get(f"/v1/vqe/executions/{execution['id']}")
            assert final_response.status_code == 200, final_response.text
            final = final_response.json()

        assert final["status"] == "succeeded"
        assert final["production_runtime_status"] == "qualified"
        assert len(final["observations"]) == 1
        result = final["observations"][0]["result_contract_json"]
        assert result["status"] == "succeeded"
        assert result["absolute_error_ha"] <= 1e-10
        assert result["supplementary_evidence"]["public_execution"] == "blocked"
        assert result["supplementary_evidence"]["production_runtime_status"] == "qualified"
    finally:
        await engine.dispose()
        auth_jwt._jwk_client.cache_clear()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
