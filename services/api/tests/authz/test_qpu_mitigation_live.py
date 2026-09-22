"""`qpu_runs.mitigation` against real Postgres (proposal 5, increment 4; migration 0066).

The unit tests prove what the worker and the route pass; this proves what the
column keeps. What is only checkable here:

- **The three writes compose on the real row.** The API writes the ZNE request,
  the RUNNING transition writes the calibration, the DONE transition writes the
  folded counts, and the document read back over HTTP has all three, with
  `raw_counts` untouched beside it.
- **A later transition that brings no mitigation keeps what is there.** None
  means "not given", the same rule `backend_name` follows.
- **The CHECK refuses a document that is not an object**, as the role
  production connects as.

Lives in `authz/` so CI runs it as `majorana_api`. It commits, so it removes
what it wrote.
"""

import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import QpuRunStatus, Role
from matrix_helpers import requires_db
from repo_test_helpers import delete_committed_tenants
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import User
from majorana_api.repos import qpu_runs as qpu_runs_repo
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_qpu.mitigation import merged_after_submit, requested_zne_record, with_folded_counts

pytestmark = requires_db

SETTINGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

READOUT = {
    "register": "c",
    "calibrated_at": "2026-09-22T03:00:00+00:00",
    "bits": [
        {
            "clbit": 0,
            "qubit": 4,
            "prob_meas1_prep0": 0.0158,
            "prob_meas0_prep1": 0.0548,
            "source": "backend_properties",
        }
    ],
}
RAW = {"0": 470, "1": 554}
FOLDED = [RAW, {"0": 430, "1": 594}, {"0": 400, "1": 624}]


async def _record(scope, session, *, mitigation):
    return await qpu_runs_repo.create_record(
        scope,
        session,
        device_id="ibm.open_plan",
        provider="ibm",
        shots=1024,
        qasm="OPENQASM 3.0; // mitigation",
        source_fingerprint=f"fnv1a-mit-{uuid.uuid4().hex[:8]}",
        estimate_basis="free_tier_allowance",
        estimated_total_usd=None,
        rate_source="https://example.invalid/rates",
        rate_confirmed_on="2026-09-22",
        mitigation=mitigation,
    )


@pytest.fixture
async def stage():
    settings = Settings(**SETTINGS)
    engine = engine_from_env()
    factory = session_factory(engine)
    tag = uuid.uuid4().hex[:8]
    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session, workos_user_id=f"qpumit-{tag}", email=f"mit-{tag}@qpumit.test"
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        await session.commit()
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    try:
        yield {"factory": factory, "scope": scope, "client": client}
    finally:
        await client.aclose()
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()


async def test_request_calibration_and_folded_counts_compose_on_the_row(stage):
    scope, factory = stage["scope"], stage["factory"]
    async with factory() as session:
        record = await _record(scope, session, mitigation=requested_zne_record())
        submitted = merged_after_submit(
            record.mitigation,
            {"version": 1, "readout": READOUT, "zne": {"two_qubit_gates": [2, 6, 10]}},
        )
        await qpu_runs_repo.transition(
            scope,
            session,
            record.id,
            QpuRunStatus.RUNNING,
            provider_job_id="job-mit",
            backend_name="ibm_brisbane",
            mitigation=submitted,
        )
        running = await qpu_runs_repo.get_record(scope, session, record.id)
        await qpu_runs_repo.transition(
            scope,
            session,
            record.id,
            QpuRunStatus.DONE,
            raw_counts=RAW,
            mitigation=with_folded_counts(running.mitigation, FOLDED),
        )
        await session.commit()
        record_id = record.id

    response = await stage["client"].get(f"/v1/qpu/runs/{record_id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["raw_counts"] == RAW
    mitigation = body["mitigation"]
    assert mitigation["version"] == 1
    assert mitigation["readout"] == READOUT
    assert mitigation["zne"] == {
        "scale_factors": [1, 3, 5],
        "folding": "global",
        "two_qubit_gates": [2, 6, 10],
        "counts": {"3": FOLDED[1], "5": FOLDED[2]},
    }

    history = await stage["client"].get("/v1/qpu/runs")
    assert history.status_code == 200
    (item,) = [item for item in history.json()["items"] if item["id"] == str(record_id)]
    assert item["mitigation"] == mitigation


async def test_a_transition_without_mitigation_keeps_the_calibration(stage):
    scope, factory = stage["scope"], stage["factory"]
    async with factory() as session:
        record = await _record(scope, session, mitigation=None)
        assert record.mitigation is None
        # SQL NULL, not the JSON value null: a plain JSONB column writes an
        # explicit None as 'null'::jsonb, which the CHECK refuses and which would
        # make `mitigation IS NULL` false for a run with nothing recorded.
        is_null = await session.execute(
            text("select mitigation is null from qpu_runs where id = :id"), {"id": record.id}
        )
        assert is_null.scalar_one() is True
        await qpu_runs_repo.transition(
            scope,
            session,
            record.id,
            QpuRunStatus.RUNNING,
            provider_job_id="job-plain",
            mitigation=merged_after_submit(None, {"version": 1, "readout": READOUT}),
        )
        await qpu_runs_repo.transition(
            scope, session, record.id, QpuRunStatus.DONE, raw_counts=RAW, mitigation=None
        )
        await session.commit()
        done = await qpu_runs_repo.get_record(scope, session, record.id)
    assert done.mitigation == {"version": 1, "readout": READOUT}
    assert done.raw_counts == RAW


async def test_the_column_refuses_a_document_that_is_not_an_object(stage):
    scope, factory = stage["scope"], stage["factory"]
    async with factory() as session:
        record = await _record(scope, session, mitigation=None)
        await session.commit()
        with pytest.raises(IntegrityError, match="ck_qpu_runs_mitigation_object"):
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.RUNNING,
                provider_job_id="job-bad",
                mitigation=["not", "an", "object"],  # type: ignore[arg-type]
            )
        await session.rollback()
