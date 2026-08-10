"""Private Phase 6 system E2E over WorkOS-shaped JWT, PostgreSQL, and real OCI Docker.

This is deliberately opt-in. CI provides an isolated PostgreSQL 17 database,
provisions the frozen H2 workflow for the same identity, pulls the approved
image before the test, and then sets ``--pull=never`` execution mode. The local
JWKS issuer exercises the production verification code without claiming that a
real WorkOS tenant or the production Cloud SQL database was used.
"""

from __future__ import annotations

import datetime as dt
import hashlib
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
from majorana_worker import __main__ as worker_main
from majorana_worker.handlers import handle_vqe_execute

requires_production_e2e = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_VQE_PRODUCTION_E2E") != "1"
    or "DATABASE_URL" not in os.environ
    or "MAJORANA_VQE_E2E_WORKFLOW_ID" not in os.environ,
    reason="requires explicit production E2E gate, isolated PostgreSQL, and provisioned H2 workflow",
)

CLIENT_ID = "client_vqe_production_e2e"
SUBJECT = "vqe-production-e2e"
# This is an intentionally public, CI-only key for the disposable test ledger.
# It must never be reused by a deployed service. Keeping it explicit here makes
# the production Settings contract testable without weakening the requirement
# for a separately provisioned secret in a real environment.
DECISION_HMAC_KEY = "phase12-private-e2e-decision-ledger-key"


def _production_e2e_settings(*, issuer: str) -> Settings:
    return Settings(
        workos_client_id=CLIENT_ID,
        workos_jwt_issuer=issuer,
        workos_jwks_url=f"{issuer}/jwks",
        web_origin="http://test",
        environment="production",
        vqe_production_execution=True,
        vqe_decision_hmac_key=DECISION_HMAC_KEY,
        # This identity exists only inside the disposable CI database. The
        # E2E deliberately saves more than the free tier's ten artifacts while
        # proving Qiskit/PennyLane and controlled-swap persistence. Classify
        # that synthetic operator explicitly instead of weakening the
        # production artifact cap or making scientific results unkept.
        developer_emails=frozenset({"vqe-production-e2e@majorana.test"}),
    )


def test_production_e2e_settings_contract_is_valid_without_runtime() -> None:
    """Fail cheaply before PostgreSQL setup and six OCI image pulls."""

    settings = _production_e2e_settings(issuer="https://issuer.invalid")
    assert settings.environment == "production"
    assert settings.vqe_production_execution is True
    assert len(settings.vqe_decision_hmac_key) >= 32


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


def _token(private_key: object, issuer: str, *, session_id: str) -> str:
    now = dt.datetime.now(dt.UTC)
    return pyjwt.encode(
        {
            "iss": issuer,
            "sub": SUBJECT,
            "sid": session_id,
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


async def _launch_projection(
    client: httpx.AsyncClient,
    workflow_artifact_version_id: str,
) -> dict:
    response = await client.get(
        f"/v1/vqe/workflow-launch-projections/{workflow_artifact_version_id}"
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _create_experiment(
    *,
    client: httpx.AsyncClient,
    workflow_artifact_version_id: str,
    idempotency_key: str,
) -> httpx.Response:
    projection = await _launch_projection(client, workflow_artifact_version_id)
    assert projection["experiment_creation"]["decision"] == "eligible", projection
    return await client.post(
        "/v1/vqe/experiments",
        headers={"Idempotency-Key": idempotency_key},
        json={
            "workflow_artifact_version_id": workflow_artifact_version_id,
            "expected_projection_sha256": projection["projection_sha256"],
        },
    )


async def _execute_and_finish(
    *,
    client: httpx.AsyncClient,
    factory,
    experiment_id: str,
    framework: str,
    label: str,
    requested_capability: str = "h2_sto3g_actual_vqe_v1",
    expected_cnot_count: int = 48,
    expected_depth: int = 83,
    expected_parameter_count: int = 1,
) -> dict:
    # Emulate the production worker's periodic readiness publisher immediately
    # before each start. This probes the exact digest-pinned OCI images already
    # pulled by CI and persists a fresh, short-lived lease. No API request path
    # invokes Docker and no availability is hard-coded in the test.
    await worker_main._publish_vqe_runtime_readiness(
        factory,
        worker_id="phase12-production-e2e",
    )
    experiment_response = await client.get(f"/v1/vqe/experiments/{experiment_id}")
    assert experiment_response.status_code == 200, experiment_response.text
    workflow_artifact_version_id = experiment_response.json()["workflow_artifact_version_id"]
    projection = await _launch_projection(client, workflow_artifact_version_id)
    framework_projection = next(
        item for item in projection["frameworks"] if item["framework"] == framework
    )
    assert framework_projection["decision"] == "eligible", framework_projection
    response = await client.post(
        f"/v1/vqe/experiments/{experiment_id}/executions",
        headers={"Idempotency-Key": f"phase78-execution-{label}-{framework}"},
        json={
            "requested_capability": requested_capability,
            "preferred_framework": framework,
            "expected_projection_sha256": projection["projection_sha256"],
        },
    )
    assert response.status_code == 201, response.text
    execution = response.json()
    assert execution["production_runtime_status"] == "qualified"
    assert execution["review_state"] == "unreviewed"
    assert execution["scientific_review"] == "unreviewed"
    assert execution["execution_policy"] == "owner_waived_private"
    assert execution["runtime_qualification"] == "qualified_private"
    assert execution["publication"] == "blocked"

    async with factory() as session:
        job = await system.claim_job(
            session,
            worker_id="phase76-s12-production-e2e",
            lease_seconds=300,
        )
        assert job is not None
        assert job.kind == "vqe.execute"
        assert job.payload["execution_id"] == execution["id"]
        assert job.lease_token is not None
        payload = dict(job.payload)
        lease_token = job.lease_token
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

    final_response = await client.get(f"/v1/vqe/executions/{execution['id']}")
    assert final_response.status_code == 200, final_response.text
    final = final_response.json()
    failure_diagnostic = [
        {
            "failure_code": observation["result_contract_json"].get("failure_code"),
            "failure_detail": observation["result_contract_json"].get("failure_detail"),
        }
        for observation in final.get("observations", [])
        if observation.get("status") == "failed"
    ]
    assert final["status"] == "succeeded", {
        "status": final["status"],
        "failure_observations": failure_diagnostic,
    }
    assert final["production_runtime_status"] == "qualified"
    assert len(final["observations"]) == 1
    result = final["observations"][0]["result_contract_json"]
    assert result["status"] == "succeeded"
    assert result["absolute_error_ha"] <= 1e-10
    assert result["parameter_count"] == expected_parameter_count
    common_basis = next(
        item for item in result["resources"] if item["stage"] == "common_basis_compiled"
    )
    assert common_basis["two_qubit_gate_count"] == expected_cnot_count
    assert common_basis["depth"] == expected_depth
    assert common_basis["parameter_count"] == expected_parameter_count
    assert result["supplementary_evidence"]["public_execution"] == "blocked"
    assert result["supplementary_evidence"]["production_runtime_status"] == "qualified"
    return final


@requires_production_e2e
async def test_workos_contract_postgres_and_real_oci_runtime_end_to_end(monkeypatch):
    # GitHub Actions sets CI=true for every step.  The production executor must
    # continue to reject that marker in application code, so the dedicated-host
    # simulation removes it only inside this explicit, opt-in E2E test.  This
    # does not add a production bypass: the worker unit suite separately proves
    # that CI=true is rejected when presented to the executor.
    if os.environ.get("GITHUB_ACTIONS") == "true":
        assert os.environ.get("CI") == "true"
        monkeypatch.delenv("CI")
    server, thread, private_key = _start_jwks_server()
    issuer = f"http://127.0.0.1:{server.server_port}"
    auth_jwt._jwk_client.cache_clear()
    engine = engine_from_env()
    factory = session_factory(engine)
    settings = _production_e2e_settings(issuer=issuer)
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = factory
    headers = {
        "Authorization": (
            f"Bearer {_token(private_key, issuer, session_id='session_phase78_first')}"
        )
    }

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=headers,
        ) as client:
            me = await client.get("/v1/me")
            assert me.status_code == 200, me.text

            seed_response = await _create_experiment(
                client=client,
                workflow_artifact_version_id=os.environ["MAJORANA_VQE_E2E_WORKFLOW_ID"],
                idempotency_key="private-mvp-seed-experiment",
            )
            assert seed_response.status_code == 201, seed_response.text

            components_response = await client.get(
                "/v1/atlas/components",
                params={"component_type": "parameter_optimizer", "limit": 200},
            )
            assert components_response.status_code == 200, components_response.text
            cobyla = next(
                item
                for item in components_response.json()["components"]
                if item["semantic_key"] == "optimizer.cobyla.v1"
            )
            slsqp = next(
                item
                for item in components_response.json()["components"]
                if item["semantic_key"] == "optimizer.slsqp.v1"
            )
            slsqp_response = await client.post(
                "/v1/atlas/workflows/swaps",
                headers={"Idempotency-Key": "private-mvp-slsqp-swap"},
                json={
                    "baseline_workflow_artifact_version_id": os.environ[
                        "MAJORANA_VQE_E2E_WORKFLOW_ID"
                    ],
                    "baseline_template_key": "workflow.h2.fixed_excitation.v1",
                    "changed_role": "parameter_optimizer",
                    "candidate_component_semantic_key": "optimizer.slsqp.v1",
                    "candidate_component_spec_sha256": slsqp["normalized_spec_sha256"],
                    "configuration": {},
                    "evaluator_provider": "qiskit",
                },
            )
            assert slsqp_response.status_code == 201, slsqp_response.text
            slsqp_workflow = slsqp_response.json()
            assert slsqp_workflow["execution_status"] == "private_qualification_candidate"
            assert slsqp_workflow["visibility"] == "private"

            slsqp_experiment_response = await _create_experiment(
                client=client,
                workflow_artifact_version_id=slsqp_workflow["workflow_artifact_version_id"],
                idempotency_key="private-mvp-slsqp-experiment",
            )
            assert slsqp_experiment_response.status_code == 201, slsqp_experiment_response.text
            slsqp_experiment = slsqp_experiment_response.json()
            slsqp_optimizer = next(
                item
                for item in slsqp_experiment["scientific_spec_json"]["component_bindings"]
                if item["role"] == "parameter_optimizer"
            )
            assert slsqp_optimizer["component_semantic_key"] == "optimizer.slsqp.v1"

            cobyla_response = await client.post(
                "/v1/atlas/workflows/swaps",
                headers={"Idempotency-Key": "private-mvp-cobyla-swap"},
                json={
                    "baseline_workflow_artifact_version_id": os.environ[
                        "MAJORANA_VQE_E2E_WORKFLOW_ID"
                    ],
                    "baseline_template_key": "workflow.h2.fixed_excitation.v1",
                    "changed_role": "parameter_optimizer",
                    "candidate_component_semantic_key": "optimizer.cobyla.v1",
                    "candidate_component_spec_sha256": cobyla["normalized_spec_sha256"],
                    "configuration": {},
                    "evaluator_provider": "qiskit",
                },
            )
            assert cobyla_response.status_code == 201, cobyla_response.text
            cobyla_workflow = cobyla_response.json()
            assert cobyla_workflow["execution_status"] == "private_qualification_candidate"
            assert cobyla_workflow["visibility"] == "private"

            cobyla_experiment_response = await _create_experiment(
                client=client,
                workflow_artifact_version_id=cobyla_workflow["workflow_artifact_version_id"],
                idempotency_key="private-mvp-cobyla-experiment",
            )
            assert cobyla_experiment_response.status_code == 201, cobyla_experiment_response.text
            cobyla_experiment = cobyla_experiment_response.json()
            cobyla_optimizer = next(
                item
                for item in cobyla_experiment["scientific_spec_json"]["component_bindings"]
                if item["role"] == "parameter_optimizer"
            )
            assert cobyla_optimizer["component_semantic_key"] == "optimizer.cobyla.v1"

            executions: dict[str, dict] = {}
            for framework in ("qiskit", "pennylane"):
                executions[f"slsqp_{framework}"] = await _execute_and_finish(
                    client=client,
                    factory=factory,
                    experiment_id=slsqp_experiment["id"],
                    framework=framework,
                    label="slsqp",
                )
                executions[f"cobyla_{framework}"] = await _execute_and_finish(
                    client=client,
                    factory=factory,
                    experiment_id=cobyla_experiment["id"],
                    framework=framework,
                    label="cobyla",
                )

            migration_response = await client.post(
                "/v1/atlas/workflows/ansatz-migrations",
                headers={"Idempotency-Key": "phase78-uccsd-migration"},
                json={
                    "baseline_workflow_artifact_version_id": slsqp_workflow[
                        "workflow_artifact_version_id"
                    ],
                    "migration": "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
                    "evaluator_provider": "qiskit",
                },
            )
            assert migration_response.status_code == 201, migration_response.text
            migration = migration_response.json()
            assert migration["execution_status"] == "private_qualification_candidate"
            assert migration["visibility"] == "private"

            uccsd_experiment_response = await _create_experiment(
                client=client,
                workflow_artifact_version_id=migration["workflow_artifact_version_id"],
                idempotency_key="phase78-uccsd-experiment",
            )
            assert uccsd_experiment_response.status_code == 201, uccsd_experiment_response.text
            uccsd_experiment = uccsd_experiment_response.json()
            uccsd_bindings = {
                item["role"]: item
                for item in uccsd_experiment["scientific_spec_json"]["component_bindings"]
            }
            assert uccsd_bindings["ansatz"]["component_semantic_key"] == "ansatz.uccsd.v1"
            assert (
                uccsd_bindings["compilation_backend"]["component_semantic_key"]
                == "compilation.h2.uccsd.canonical_logical.v1"
            )
            assert {
                uccsd_bindings[role]["applicability"]
                for role in ("operator_pool", "search_selection", "growth_batching")
            } == {"not_applicable"}

            uccsd_executions: dict[str, dict] = {}
            uccsd_artifacts: dict[str, dict] = {}
            for framework in ("qiskit", "pennylane"):
                uccsd_executions[framework] = await _execute_and_finish(
                    client=client,
                    factory=factory,
                    experiment_id=uccsd_experiment["id"],
                    framework=framework,
                    label="uccsd",
                    requested_capability="h2_sto3g_uccsd_v1",
                    expected_cnot_count=56,
                    expected_depth=96,
                    expected_parameter_count=3,
                )
                materialize_response = await client.post(
                    f"/v1/vqe/executions/{uccsd_executions[framework]['id']}/materialize"
                )
                assert materialize_response.status_code == 200, materialize_response.text
                uccsd_artifacts[framework] = materialize_response.json()
                assert uccsd_artifacts[framework]["visibility"] == "private"
                assert uccsd_artifacts[framework]["publication"] == "blocked"

            hardware_efficient_migration_response = await client.post(
                "/v1/atlas/workflows/ansatz-migrations",
                headers={"Idempotency-Key": "phase79-hardware-efficient-migration"},
                json={
                    "baseline_workflow_artifact_version_id": migration[
                        "workflow_artifact_version_id"
                    ],
                    "migration": "h2_uccsd_slsqp_to_hardware_efficient_slsqp",
                    "evaluator_provider": "qiskit",
                },
            )
            assert hardware_efficient_migration_response.status_code == 201, (
                hardware_efficient_migration_response.text
            )
            hardware_efficient_migration = hardware_efficient_migration_response.json()
            assert (
                hardware_efficient_migration["execution_status"]
                == "private_qualification_candidate"
            )
            assert hardware_efficient_migration["visibility"] == "private"

            hardware_efficient_experiment_response = await _create_experiment(
                client=client,
                workflow_artifact_version_id=hardware_efficient_migration[
                    "workflow_artifact_version_id"
                ],
                idempotency_key="phase79-hardware-efficient-experiment",
            )
            assert hardware_efficient_experiment_response.status_code == 201, (
                hardware_efficient_experiment_response.text
            )
            hardware_efficient_experiment = hardware_efficient_experiment_response.json()
            hardware_efficient_bindings = {
                item["role"]: item
                for item in hardware_efficient_experiment["scientific_spec_json"][
                    "component_bindings"
                ]
            }
            assert (
                hardware_efficient_bindings["ansatz"]["component_semantic_key"]
                == "ansatz.hardware_efficient_ry_cx.v1"
            )
            assert (
                hardware_efficient_bindings["compilation_backend"]["component_semantic_key"]
                == "compilation.h2.hardware_efficient_ry_cx.canonical_logical.v1"
            )
            assert {
                hardware_efficient_bindings[role]["applicability"]
                for role in ("operator_pool", "search_selection", "growth_batching")
            } == {"not_applicable"}

            hardware_efficient_executions: dict[str, dict] = {}
            hardware_efficient_artifacts: dict[str, dict] = {}
            for framework in ("qiskit", "pennylane"):
                hardware_efficient_executions[framework] = await _execute_and_finish(
                    client=client,
                    factory=factory,
                    experiment_id=hardware_efficient_experiment["id"],
                    framework=framework,
                    label="hardware-efficient",
                    requested_capability="h2_sto3g_hardware_efficient_ry_cx_v1",
                    expected_cnot_count=6,
                    expected_depth=7,
                    expected_parameter_count=8,
                )
                materialize_response = await client.post(
                    "/v1/vqe/executions/"
                    f"{hardware_efficient_executions[framework]['id']}/materialize"
                )
                assert materialize_response.status_code == 200, materialize_response.text
                hardware_efficient_artifacts[framework] = materialize_response.json()
                assert hardware_efficient_artifacts[framework]["visibility"] == "private"
                assert hardware_efficient_artifacts[framework]["publication"] == "blocked"

            fixed_component_digests = {
                item["role"]: item["component_spec_sha256"]
                for item in slsqp_experiment["scientific_spec_json"]["component_bindings"]
                if item["role"] != "parameter_optimizer"
            }
            comparison_response = await client.post(
                "/v1/vqe/controlled-comparisons",
                headers={"Idempotency-Key": "private-mvp-slsqp-cobyla-comparison"},
                json={
                    "baseline_workflow_artifact_version_id": slsqp_workflow[
                        "workflow_artifact_version_id"
                    ],
                    "candidate_workflow_artifact_version_id": cobyla_workflow[
                        "workflow_artifact_version_id"
                    ],
                    "changed_role": "parameter_optimizer",
                    "fixed_component_digests": fixed_component_digests,
                    "baseline_configuration": {"algorithm": "scipy_slsqp"},
                    "candidate_configuration": {"algorithm": "scipy_cobyla"},
                    "metric_protocol_sha256": fixed_component_digests["evaluation_protocol"],
                    "budget_protocol_sha256": fixed_component_digests["stopping_protocol"],
                },
            )
            assert comparison_response.status_code == 201, comparison_response.text
            comparison = comparison_response.json()
            comparison_runs: dict[str, dict] = {}
            artifacts: dict[str, dict] = {}
            for framework in ("qiskit", "pennylane"):
                run_response = await client.post(
                    f"/v1/vqe/controlled-comparisons/{comparison['id']}/runs",
                    json={
                        "baseline_execution_id": executions[f"slsqp_{framework}"]["id"],
                        "candidate_execution_id": executions[f"cobyla_{framework}"]["id"],
                    },
                )
                assert run_response.status_code == 201, run_response.text
                comparison_runs[framework] = run_response.json()
                assert comparison_runs[framework]["status"] == "comparable"
                assert all(comparison_runs[framework]["run_json"]["invariant_audit"].values())
                for variant in ("slsqp", "cobyla"):
                    execution_key = f"{variant}_{framework}"
                    materialize_response = await client.post(
                        f"/v1/vqe/executions/{executions[execution_key]['id']}/materialize"
                    )
                    assert materialize_response.status_code == 200, materialize_response.text
                    artifacts[execution_key] = materialize_response.json()
                    assert artifacts[execution_key]["visibility"] == "private"
                    assert artifacts[execution_key]["publication"] == "blocked"

            negative_response = await client.post(
                "/v1/atlas/workflows/swaps",
                headers={"Idempotency-Key": "phase78-negative-swap"},
                json={
                    "baseline_workflow_artifact_version_id": os.environ[
                        "MAJORANA_VQE_E2E_WORKFLOW_ID"
                    ],
                    "baseline_template_key": "workflow.h2.fixed_excitation.v1",
                    "changed_role": "parameter_optimizer",
                    "candidate_component_semantic_key": "optimizer.cobyla.v1",
                    "candidate_component_spec_sha256": cobyla["normalized_spec_sha256"],
                    "configuration": {"max_objective_evaluations": "1"},
                    "evaluator_provider": "qiskit",
                },
            )
            assert negative_response.status_code == 422, negative_response.text

        reopened_headers = {
            "Authorization": (
                f"Bearer {_token(private_key, issuer, session_id='session_phase78_second')}"
            )
        }
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers=reopened_headers,
        ) as reopened_client:
            reopened_me = await reopened_client.get("/v1/me")
            assert reopened_me.status_code == 200, reopened_me.text
            reopened_comparison_response = await reopened_client.get(
                f"/v1/vqe/controlled-comparisons/{comparison['id']}"
            )
            assert reopened_comparison_response.status_code == 200
            reopened_comparison = reopened_comparison_response.json()
            assert {item["id"] for item in reopened_comparison["runs"]} == {
                item["id"] for item in comparison_runs.values()
            }
            for execution_key, artifact in artifacts.items():
                artifact_response = await reopened_client.get(
                    f"/v1/artifacts/{artifact['artifact_id']}"
                )
                assert artifact_response.status_code == 200, artifact_response.text
                version_response = await reopened_client.get(
                    f"/v1/artifacts/{artifact['artifact_id']}/versions/current"
                )
                assert version_response.status_code == 200, version_response.text
                assert version_response.json()["id"] == artifact["artifact_version_id"]
                execution_response = await reopened_client.get(
                    f"/v1/vqe/executions/{executions[execution_key]['id']}"
                )
                assert execution_response.status_code == 200
                assert execution_response.json()["status"] == "succeeded"
            for framework, artifact in uccsd_artifacts.items():
                artifact_response = await reopened_client.get(
                    f"/v1/artifacts/{artifact['artifact_id']}"
                )
                assert artifact_response.status_code == 200, artifact_response.text
                version_response = await reopened_client.get(
                    f"/v1/artifacts/{artifact['artifact_id']}/versions/current"
                )
                assert version_response.status_code == 200, version_response.text
                assert version_response.json()["id"] == artifact["artifact_version_id"]
                execution_response = await reopened_client.get(
                    f"/v1/vqe/executions/{uccsd_executions[framework]['id']}"
                )
                assert execution_response.status_code == 200
                assert execution_response.json()["status"] == "succeeded"
            for framework, artifact in hardware_efficient_artifacts.items():
                artifact_response = await reopened_client.get(
                    f"/v1/artifacts/{artifact['artifact_id']}"
                )
                assert artifact_response.status_code == 200, artifact_response.text
                version_response = await reopened_client.get(
                    f"/v1/artifacts/{artifact['artifact_id']}/versions/current"
                )
                assert version_response.status_code == 200, version_response.text
                assert version_response.json()["id"] == artifact["artifact_version_id"]
                execution_response = await reopened_client.get(
                    f"/v1/vqe/executions/{hardware_efficient_executions[framework]['id']}"
                )
                assert execution_response.status_code == 200
                assert execution_response.json()["status"] == "succeeded"

        evidence = {
            "schema_version": "1.0.0",
            "kind": "private_component_first_mvp_ci_e2e",
            "source_commit": os.environ.get("GITHUB_SHA"),
            "authentication_evidence": "synthetic_contract",
            "database": "disposable_postgresql_17",
            "runtime_host": "github_actions_dedicated_docker",
            "baseline_workflow_artifact_version_id": slsqp_workflow["workflow_artifact_version_id"],
            "candidate_workflow_artifact_version_id": cobyla_workflow[
                "workflow_artifact_version_id"
            ],
            "baseline_optimizer": "optimizer.slsqp.v1",
            "candidate_optimizer": "optimizer.cobyla.v1",
            "changed_roles": ["parameter_optimizer"],
            "golden_journeys": {
                "primary_fixed_excitation_slsqp": "passed",
                "controlled_slsqp_to_cobyla": "passed",
                "same_subject_session_reopen": "passed",
                "live_workos_same_account_reopen": "not_run",
            },
            "execution_ids": {name: item["id"] for name, item in executions.items()},
            "comparison_spec_id": comparison["id"],
            "comparison_run_ids": {name: item["id"] for name, item in comparison_runs.items()},
            "materialized_artifact_ids": {
                name: item["artifact_version_id"] for name, item in artifacts.items()
            },
            "uccsd_migration": {
                "comparison_class": "controlled_capability_migration_not_one_component_swap",
                "primary_changed_role": "ansatz",
                "dependent_changed_roles": ["compilation_backend"],
                "required_to_not_applicable_roles": [
                    "growth_batching",
                    "operator_pool",
                    "search_selection",
                ],
                "workflow_artifact_version_id": migration["workflow_artifact_version_id"],
                "experiment_id": uccsd_experiment["id"],
                "execution_ids": {name: item["id"] for name, item in uccsd_executions.items()},
                "materialized_artifact_ids": {
                    name: item["artifact_version_id"] for name, item in uccsd_artifacts.items()
                },
            },
            "hardware_efficient_migration": {
                "comparison_class": "controlled_capability_migration_not_one_component_swap",
                "primary_changed_role": "ansatz",
                "dependent_changed_roles": ["compilation_backend"],
                "workflow_artifact_version_id": hardware_efficient_migration[
                    "workflow_artifact_version_id"
                ],
                "experiment_id": hardware_efficient_experiment["id"],
                "execution_ids": {
                    name: item["id"] for name, item in hardware_efficient_executions.items()
                },
                "materialized_artifact_ids": {
                    name: item["artifact_version_id"]
                    for name, item in hardware_efficient_artifacts.items()
                },
                "public_execution": False,
                "performance_claim": False,
            },
            "session_reopen": "passed",
            "failure_path": "passed",
            "public_execution": False,
            "publication": False,
            "evidence_digest_sha256": hashlib.sha256(
                json.dumps(
                    {
                        "executions": executions,
                        "comparison_runs": comparison_runs,
                        "artifacts": artifacts,
                        "uccsd_executions": uccsd_executions,
                        "uccsd_artifacts": uccsd_artifacts,
                        "hardware_efficient_executions": hardware_efficient_executions,
                        "hardware_efficient_artifacts": hardware_efficient_artifacts,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest(),
        }
        evidence_path = os.environ.get("MAJORANA_VQE_E2E_EVIDENCE_PATH")
        if evidence_path:
            with open(evidence_path, "w", encoding="utf-8") as handle:
                json.dump(evidence, handle, sort_keys=True, indent=2)
                handle.write("\n")
    finally:
        await engine.dispose()
        auth_jwt._jwk_client.cache_clear()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
