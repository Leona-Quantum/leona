"""`GET /v1/qpu/runs` over real HTTP, against real Postgres (proposal 5, increment 2).

`test_authz_matrix.py` proves `qpu_runs_repo.list_records` applies the workspace
predicate. This proves the route exposes it and nothing else: two clients on one
app, Alice and Bob, each in their own workspace with their own hardware runs,
and every read Alice can make returns her rows only. What is only checkable here:

- **The route adds no way around the repository.** No query parameter names a
  workspace, and a cursor or fingerprint copied from Bob's run does not reach it.
- **Paging walks every row once, newest first**, over rows another request
  committed, not rows a double returned.
- **Serialization reads the real columns.** `backend_name` (migration 0065) and
  `qasm` come back from the database, not from a fixture object with the right
  attribute names.

Lives in `authz/` so CI's authz step runs it as `majorana_api`, the role
production connects as. It commits (two clients over two sessions), so it
removes what it wrote.
"""

import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import QpuRunStatus, Role
from matrix_helpers import requires_db
from repo_test_helpers import delete_committed_tenants

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import User
from majorana_api.repos import qpu_runs as qpu_runs_repo
from majorana_api.repos import system
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


async def _run(scope, session, *, fingerprint: str, backend: str | None, done: bool):
    record = await qpu_runs_repo.create_record(
        scope,
        session,
        device_id="ibm.open_plan",
        provider="ibm",
        shots=128,
        qasm=f"OPENQASM 3.0; // {fingerprint}",
        source_fingerprint=fingerprint,
        estimate_basis="free_tier_allowance",
        estimated_total_usd=None,
        rate_source="https://example.invalid/rates",
        rate_confirmed_on="2026-09-22",
    )
    await qpu_runs_repo.transition(
        scope,
        session,
        record.id,
        QpuRunStatus.RUNNING,
        provider_job_id=f"job-{uuid.uuid4().hex[:8]}",
        backend_name=backend,
    )
    if done:
        await qpu_runs_repo.transition(
            scope, session, record.id, QpuRunStatus.DONE, raw_counts={"0": 70, "1": 58}
        )
    return record.id


def _client(factory, engine, scope, user, workspace, settings) -> httpx.AsyncClient:
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def stage():
    settings = Settings(**SETTINGS)
    engine = engine_from_env()
    factory = session_factory(engine)
    tag = uuid.uuid4().hex[:8]
    async with factory() as session:
        alice_user, alice_ws = await system.get_or_provision_user(
            session, workos_user_id=f"qpuhist-alice-{tag}", email=f"alice-{tag}@qpuhist.test"
        )
        bob_user, bob_ws = await system.get_or_provision_user(
            session, workos_user_id=f"qpuhist-bob-{tag}", email=f"bob-{tag}@qpuhist.test"
        )
        alice_scope = Scope(user_id=alice_user.id, workspace_id=alice_ws.id, role=Role.OWNER)
        bob_scope = Scope(user_id=bob_user.id, workspace_id=bob_ws.id, role=Role.OWNER)
        shared_circuit = f"fnv1a-shared-{tag}"
        # Created oldest first; UUIDv7 ids sort the same way.
        alice_runs = [
            await _run(
                alice_scope,
                session,
                fingerprint=f"fnv1a-a1-{tag}",
                backend="ibm_brisbane",
                done=True,
            ),
            await _run(alice_scope, session, fingerprint=shared_circuit, backend=None, done=True),
            await _run(
                alice_scope,
                session,
                fingerprint=f"fnv1a-a3-{tag}",
                backend="ibm_torino",
                done=False,
            ),
        ]
        bob_run = await _run(
            bob_scope, session, fingerprint=f"fnv1a-b1-{tag}", backend="ibm_kyiv", done=True
        )
        # Bob ran the same circuit as Alice, so a fingerprint query cannot tell
        # workspaces apart by the circuit alone.
        bob_same_circuit = await _run(
            bob_scope, session, fingerprint=shared_circuit, backend="ibm_kyiv", done=True
        )
        await session.commit()

    alice = _client(factory, engine, alice_scope, alice_user, alice_ws, settings)
    bob = _client(factory, engine, bob_scope, bob_user, bob_ws, settings)
    try:
        yield {
            "alice": alice,
            "alice_scope": alice_scope,
            "factory": factory,
            "bob": bob,
            "alice_runs": alice_runs,
            "bob_runs": [bob_run, bob_same_circuit],
            "bob_fingerprint": f"fnv1a-b1-{tag}",
            "shared_circuit": shared_circuit,
        }
    finally:
        await alice.aclose()
        await bob.aclose()
        await delete_committed_tenants(
            factory, [alice_ws.id, bob_ws.id], [alice_user.id, bob_user.id]
        )
        await engine.dispose()


async def _all_pages(client, **params):
    items, cursor, pages = [], None, 0
    while True:
        query = dict(params, limit=2)
        if cursor:
            query["cursor"] = cursor
        response = await client.get("/v1/qpu/runs", params=query)
        assert response.status_code == 200, response.text
        body = response.json()
        items.extend(body["items"])
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            return items, pages
        assert pages < 10, "paging did not terminate"


async def test_each_workspace_lists_only_its_own_runs_newest_first(stage):
    alice_items, pages = await _all_pages(stage["alice"])
    assert [item["id"] for item in alice_items] == [str(i) for i in reversed(stage["alice_runs"])]
    # Three rows at two per page: a full page with a cursor, then a short one.
    assert pages == 2
    assert not {str(i) for i in stage["bob_runs"]} & {item["id"] for item in alice_items}

    bob_items, _ = await _all_pages(stage["bob"])
    assert [item["id"] for item in bob_items] == [str(i) for i in reversed(stage["bob_runs"])]


async def test_the_history_carries_the_machine_and_the_program_from_the_row(stage):
    items, _ = await _all_pages(stage["alice"])
    by_id = {item["id"]: item for item in items}
    first, second, third = (by_id[str(i)] for i in stage["alice_runs"])
    assert first["backend_name"] == "ibm_brisbane"
    assert second["backend_name"] is None
    assert third["backend_name"] == "ibm_torino"
    assert first["status"] == "done" and first["raw_counts"] == {"0": 70, "1": 58}
    assert third["status"] == "running" and third["raw_counts"] is None
    assert first["qasm"].startswith("OPENQASM 3.0;")


async def test_nothing_copied_from_another_workspace_reaches_its_rows(stage):
    alice = stage["alice"]
    bob_run = stage["bob_runs"][0]

    single = await alice.get(f"/v1/qpu/runs/{bob_run}")
    assert single.status_code == 404

    by_fingerprint = await alice.get(
        "/v1/qpu/runs", params={"source_fingerprint": stage["bob_fingerprint"]}
    )
    assert by_fingerprint.status_code == 200
    assert by_fingerprint.json()["items"] == []

    # The one circuit both of them ran: Alice gets her run of it, never Bob's.
    shared = await alice.get("/v1/qpu/runs", params={"source_fingerprint": stage["shared_circuit"]})
    assert [item["id"] for item in shared.json()["items"]] == [str(stage["alice_runs"][1])]

    # Bob's newest id as a cursor: still only Alice's rows below it.
    after_bob = await alice.get("/v1/qpu/runs", params={"cursor": str(stage["bob_runs"][-1])})
    assert after_bob.status_code == 200
    ids = {item["id"] for item in after_bob.json()["items"]}
    assert ids <= {str(i) for i in stage["alice_runs"]}
    assert ids, "positive control: Alice's older rows sit below Bob's newest id"


async def _plan(factory, stmt) -> str:
    from sqlalchemy import text
    from sqlalchemy.dialects import postgresql

    sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    async with factory() as session:
        # A tiny table is sequentially scanned whatever the index says.
        await session.execute(text("set local enable_seqscan = off"))
        return "\n".join(row[0] for row in (await session.execute(text("EXPLAIN " + sql))).all())


async def test_the_history_and_the_restore_lookup_ride_their_indexes(stage):
    """Migration 0065's two indexes, asserted against the statements the
    repository builds rather than a copy of the SQL (the reason
    `list_records_stmt` is split out). Without them the planner walks the
    primary key backwards and filters out every other workspace's runs."""
    scope, factory = stage["alice_scope"], stage["factory"]

    page = await _plan(factory, qpu_runs_repo.list_records_stmt(scope, limit=25))
    assert "ix_qpu_runs_workspace_id_desc" in page, page

    after_cursor = await _plan(
        factory, qpu_runs_repo.list_records_stmt(scope, cursor=stage["alice_runs"][-1], limit=25)
    )
    assert "ix_qpu_runs_workspace_id_desc" in after_cursor, after_cursor

    restore = await _plan(
        factory,
        qpu_runs_repo.list_records_stmt(scope, limit=1, source_fingerprint=stage["shared_circuit"]),
    )
    assert "ix_qpu_runs_workspace_fingerprint_id_desc" in restore, restore
    # Served by the index's own order, not sorted after the fact.
    assert "Sort" not in restore, restore
