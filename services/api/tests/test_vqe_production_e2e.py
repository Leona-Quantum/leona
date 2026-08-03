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
from majorana_worker.handlers import handle_vqe_execute

requires_production_e2e = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_VQE_PRODUCTION_E2E") != "1"
    or "DATABASE_URL" not in os.environ
    or "MAJORANA_VQE_E2E_WORKFLOW_ID" not in os.environ,
    reason="requires explicit production E2E gate, isolated PostgreSQL, and provisioned H2 workflow",
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
    response = await client.post(
        f"/v1/vqe/experiments/{experiment_id}/executions",
        headers={"Idempotency-Key": f"phase78-execution-{label}-{framework}"},
        json={
            "requested_capability": requested_capability,
            "preferred_framework": framework,
        },
    )
    assert response.status_code == 201, response.text
    execution = response.json()
    assert execution["production_runtime_status"] == "qualified"
    assert execution["review_state"] == "owner_waived"

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
    assert final["status"] == "succeeded"
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
async def test_workos_contract_postgres_and_real_oci_runtime_end_to_end():
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
        # This identity exists only inside the disposable CI database. The
        # E2E deliberately saves more than the free tier's ten artifacts while
        # proving Qiskit/PennyLane and controlled-swap persistence. Classify
        # that synthetic operator explicitly instead of weakening the
        # production artifact cap or making scientific results unkept.
        developer_emails=frozenset({"vqe-production-e2e@majorana.test"}),
    )
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

            baseline_response = await client.post(
                "/v1/vqe/experiments",
                headers={"Idempotency-Key": "phase78-baseline-experiment"},
                json={"workflow_artifact_version_id": os.environ["MAJORANA_VQE_E2E_WORKFLOW_ID"]},
            )
            assert baseline_response.status_code == 201, baseline_response.text
            baseline_experiment = baseline_response.json()

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
            swap_response = await client.post(
                "/v1/atlas/workflows/swaps",
                headers={"Idempotency-Key": "phase78-cobyla-swap"},
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
            assert swap_response.status_code == 201, swap_response.text
            swap = swap_response.json()
            assert swap["execution_status"] == "private_qualification_candidate"
            assert swap["visibility"] == "private"

            candidate_response = await client.post(
                "/v1/vqe/experiments",
                headers={"Idempotency-Key": "phase78-candidate-experiment"},
                json={"workflow_artifact_version_id": swap["workflow_artifact_version_id"]},
            )
            assert candidate_response.status_code == 201, candidate_response.text
            candidate_experiment = candidate_response.json()

            executions: dict[str, dict] = {}
            for framework in ("qiskit", "pennylane"):
                executions[f"baseline_{framework}"] = await _execute_and_finish(
                    client=client,
                    factory=factory,
                    experiment_id=baseline_experiment["id"],
                    framework=framework,
                    label="baseline",
                )
                executions[f"candidate_{framework}"] = await _execute_and_finish(
                    client=client,
                    factory=factory,
                    experiment_id=candidate_experiment["id"],
                    framework=framework,
                    label="candidate",
                )

            slsqp_response = await client.post(
                "/v1/atlas/workflows/swaps",
                headers={"Idempotency-Key": "phase78-uccsd-slsqp-prerequisite"},
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

            uccsd_experiment_response = await client.post(
                "/v1/vqe/experiments",
                headers={"Idempotency-Key": "phase78-uccsd-experiment"},
                json={"workflow_artifact_version_id": migration["workflow_artifact_version_id"]},
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

            hardware_efficient_experiment_response = await client.post(
                "/v1/vqe/experiments",
                headers={"Idempotency-Key": "phase79-hardware-efficient-experiment"},
                json={
                    "workflow_artifact_version_id": hardware_efficient_migration[
                        "workflow_artifact_version_id"
                    ]
                },
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
                for item in baseline_experiment["scientific_spec_json"]["component_bindings"]
                if item["role"] != "parameter_optimizer"
            }
            comparison_response = await client.post(
                "/v1/vqe/controlled-comparisons",
                headers={"Idempotency-Key": "phase78-controlled-comparison"},
                json={
                    "baseline_workflow_artifact_version_id": os.environ[
                        "MAJORANA_VQE_E2E_WORKFLOW_ID"
                    ],
                    "candidate_workflow_artifact_version_id": swap["workflow_artifact_version_id"],
                    "changed_role": "parameter_optimizer",
                    "fixed_component_digests": fixed_component_digests,
                    "baseline_configuration": {"algorithm": "scipy_minimize_scalar_bounded"},
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
                        "baseline_execution_id": executions[f"baseline_{framework}"]["id"],
                        "candidate_execution_id": executions[f"candidate_{framework}"]["id"],
                    },
                )
                assert run_response.status_code == 201, run_response.text
                comparison_runs[framework] = run_response.json()
                assert comparison_runs[framework]["status"] == "comparable"
                assert all(comparison_runs[framework]["run_json"]["invariant_audit"].values())
                materialize_response = await client.post(
                    f"/v1/vqe/executions/{executions[f'candidate_{framework}']['id']}/materialize"
                )
                assert materialize_response.status_code == 200, materialize_response.text
                artifacts[framework] = materialize_response.json()
                assert artifacts[framework]["visibility"] == "private"
                assert artifacts[framework]["publication"] == "blocked"

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
            for framework, artifact in artifacts.items():
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
                    f"/v1/vqe/executions/{executions[f'candidate_{framework}']['id']}"
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
            "kind": "phase78_private_ci_e2e",
            "source_commit": os.environ.get("GITHUB_SHA"),
            "workos_auth": "synthetic_contract_only",
            "database": "disposable_postgresql_17",
            "runtime_host": "github_actions_dedicated_docker",
            "baseline_workflow_artifact_version_id": os.environ["MAJORANA_VQE_E2E_WORKFLOW_ID"],
            "candidate_workflow_artifact_version_id": swap["workflow_artifact_version_id"],
            "changed_roles": ["parameter_optimizer"],
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
