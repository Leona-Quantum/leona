"""`/v1/presence` over real HTTP, against real Postgres (proposal 9, migration 0070).

Drives the routes a browser calls, one client per person, and pins the rules an
owner would want to know about:

- **Every current member, viewer included, may heartbeat and read.** Presence
  carries no content — it says "I am looking at this", not anything about what
  the looker may do once there — so there is no write-role gate the way
  `test_comments_live.py` has for posting.
- **Every route refuses another workspace's things with the same 404 it gives
  for a thing that does not exist**, byte for byte, so a probe learns nothing.
- **A viewer never sees themselves in the list.** Heartbeating is not the same
  as watching your own name appear.
- **A former member's row stops counting** once they leave, even before it is
  pruned.
- **Heartbeating is metered per person; reading is not.**

Lives in `authz/` so CI's authz step runs it as `majorana_api`, the role
production connects as. It commits (several clients, several sessions), so it
removes what it wrote.
"""

import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, RunMode
from matrix_helpers import requires_db
from repo_test_helpers import delete_committed_tenants
from sqlalchemy import func, select

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Presence, User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system, workspaces
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


def _client(factory, engine, scope, user, workspace, **overrides) -> httpx.AsyncClient:
    app = create_app(Settings(**{**SETTINGS, **overrides}))
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _targets(scope, session, tag):
    run = await runs_repo.create_run(
        scope, session, task_prompt=f"presence {tag}", mode=RunMode.EXECUTE, framework="qiskit"
    )
    notebook, _version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug=f"presence-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"Notebook {tag}",
        kind="lesson",
        summary="",
        language="en",
        framework={"name": "qiskit"},
        request={},
        run_id=None,
    )
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=f"presence-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"Circuit {tag}",
        family="Bell",
        framework="qiskit",
        kept=True,
    )
    return {"run": run.id, "notebook": notebook.id, "artifact": artifact.id}


@pytest.fixture
async def stage():
    """Workspace A: owner, admin, member, viewer, and a member who will leave.
    Workspace B: its owner. Each workspace has a run, a notebook and a saved
    circuit."""
    engine = engine_from_env()
    factory = session_factory(engine)
    tag = uuid.uuid4().hex[:8]
    people = {}
    async with factory() as session:
        for name in ("owner", "admin", "member", "viewer", "leaver", "bob"):
            user, personal = await system.get_or_provision_user(
                session,
                workos_user_id=f"presence-{name}-{tag}",
                email=f"{name}-{tag}@presence.test",
                display_name=f"{name.title()} {tag}",
            )
            people[name] = (user, personal)
        owner_user, ws_a = people["owner"]
        bob_user, ws_b = people["bob"]
        owner_scope = Scope(user_id=owner_user.id, workspace_id=ws_a.id, role=Role.OWNER)
        roles = {
            "owner": Role.OWNER,
            "admin": Role.ADMIN,
            "member": Role.MEMBER,
            "viewer": Role.VIEWER,
            "leaver": Role.MEMBER,
        }
        for name, role in roles.items():
            if name != "owner":
                await workspaces.add_member(
                    owner_scope, session, user_id=people[name][0].id, role=role
                )
        bob_scope = Scope(user_id=bob_user.id, workspace_id=ws_b.id, role=Role.OWNER)
        targets_a = await _targets(owner_scope, session, f"a-{tag}")
        targets_b = await _targets(bob_scope, session, f"b-{tag}")
        await session.commit()

    scopes = {
        name: Scope(user_id=people[name][0].id, workspace_id=ws_a.id, role=role)
        for name, role in roles.items()
    }
    scopes["bob"] = bob_scope
    clients = {
        name: _client(
            factory,
            engine,
            scopes[name],
            people[name][0],
            ws_b if name == "bob" else ws_a,
        )
        for name in scopes
    }
    try:
        yield {
            "tag": tag,
            "factory": factory,
            "engine": engine,
            "people": people,
            "scopes": scopes,
            "clients": clients,
            "a": targets_a,
            "b": targets_b,
            "ws_a": ws_a.id,
            "ws_b": ws_b.id,
            "owner_scope": owner_scope,
        }
    finally:
        for client in clients.values():
            await client.aclose()
        await delete_committed_tenants(
            factory,
            [personal.id for _user, personal in people.values()],
            [user.id for user, _personal in people.values()],
        )
        await engine.dispose()


async def _beat(client, target_type, target_id):
    return await client.post(
        "/v1/presence/heartbeat",
        json={"target_type": target_type, "target_id": str(target_id)},
    )


async def _who(client, target_type, target_id):
    return await client.get(
        "/v1/presence", params={"target_type": target_type, "target_id": str(target_id)}
    )


async def test_every_role_including_viewer_may_heartbeat_and_read(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    for name in ("owner", "admin", "member", "viewer"):
        beat = await _beat(clients[name], "run", run)
        assert beat.status_code == 204, (name, beat.text)
        read = await _who(clients[name], "run", run)
        assert read.status_code == 200, (name, read.text)


async def test_who_is_here_excludes_the_caller_and_includes_everyone_else(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    for name in ("owner", "member", "viewer"):
        assert (await _beat(clients[name], "run", run)).status_code == 204

    owner_sees = (await _who(clients["owner"], "run", run)).json()["viewers"]
    assert {v["user_id"] for v in owner_sees} == {
        str(stage["scopes"]["member"].user_id),
        str(stage["scopes"]["viewer"].user_id),
    }, "the owner is never told they are looking at their own screen"

    member_sees = (await _who(clients["member"], "run", run)).json()["viewers"]
    assert {v["user_id"] for v in member_sees} == {
        str(stage["scopes"]["owner"].user_id),
        str(stage["scopes"]["viewer"].user_id),
    }

    # Somebody who never heartbeated is not "here".
    admin_sees = (await _who(clients["admin"], "run", run)).json()["viewers"]
    assert str(stage["scopes"]["admin"].user_id) not in {v["user_id"] for v in admin_sees}


async def test_every_route_answers_another_workspace_with_the_404_of_nothing(stage):
    member, bob = stage["clients"]["member"], stage["clients"]["bob"]
    assert (await _beat(member, "run", stage["a"]["run"])).status_code == 204

    absent = await _who(bob, "run", uuid.uuid4())
    assert absent.status_code == 404
    nothing = absent.content

    for kind in ("run", "notebook", "artifact"):
        foreign_read = await _who(bob, kind, stage["a"][kind])
        assert (foreign_read.status_code, foreign_read.content) == (404, nothing)
        foreign_beat = await _beat(bob, kind, stage["a"][kind])
        assert (foreign_beat.status_code, foreign_beat.content) == (404, nothing)

    # And A's presence is untouched: Bob's refused heartbeat wrote nothing.
    owner_sees = (await stage["clients"]["owner"].get(
        "/v1/presence", params={"target_type": "run", "target_id": str(stage["a"]["run"])}
    )).json()["viewers"]
    assert str(stage["scopes"]["bob"].user_id) not in {v["user_id"] for v in owner_sees}


async def test_a_heartbeat_updates_in_place_not_a_second_row(stage):
    """Two beats from the same person on the same thing: one row, freshened."""
    member = stage["clients"]["member"]
    run = stage["a"]["run"]
    for _ in range(3):
        assert (await _beat(member, "run", run)).status_code == 204
    async with stage["factory"]() as session:
        count = (
            await session.execute(
                select(func.count()).select_from(Presence).where(
                    Presence.workspace_id == stage["ws_a"],
                    Presence.user_id == stage["scopes"]["member"].user_id,
                    Presence.target_id == run,
                )
            )
        ).scalar_one()
    assert count == 1, "three heartbeats on the same thing is one row, not three"


async def test_a_former_member_stops_counting_as_here(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    assert (await _beat(clients["leaver"], "run", run)).status_code == 204
    owner_sees = (await _who(clients["owner"], "run", run)).json()["viewers"]
    assert str(stage["scopes"]["leaver"].user_id) in {v["user_id"] for v in owner_sees}

    async with stage["factory"]() as session:
        await workspaces.remove_member(
            stage["owner_scope"], session, user_id=stage["scopes"]["leaver"].user_id
        )
        await session.commit()

    owner_sees_after = (await _who(clients["owner"], "run", run)).json()["viewers"]
    assert str(stage["scopes"]["leaver"].user_id) not in {v["user_id"] for v in owner_sees_after}, (
        "a former member's row is dropped on read, even before it is pruned"
    )


async def test_heartbeat_is_metered_per_person_and_reading_is_not(stage):
    scopes, people = stage["scopes"], stage["people"]
    tight = {
        name: _client(
            stage["factory"],
            stage["engine"],
            scopes[name],
            people[name][0],
            people["owner"][1],
            presence_rate_limit_per_minute=2,
        )
        for name in ("member", "admin")
    }
    try:
        run = stage["a"]["run"]
        assert (await _beat(tight["member"], "run", run)).status_code == 204
        assert (await _beat(tight["member"], "run", run)).status_code == 204
        refused = await _beat(tight["member"], "run", run)
        assert refused.status_code == 429
        assert refused.json()["reason"] == "presence_rate_limited"
        assert int(refused.headers["Retry-After"]) >= 1
        # A different person is not charged against the member's ceiling.
        assert (await _beat(tight["admin"], "run", run)).status_code == 204
        # Reading is never metered, no matter how many heartbeats preceded it.
        for _ in range(5):
            assert (await _who(tight["member"], "run", run)).status_code == 200
    finally:
        for client in tight.values():
            await client.aclose()


async def test_display_name_and_handle_are_served_the_same_way_comments_derives_them(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    assert (await _beat(clients["member"], "run", run)).status_code == 204
    seen = (await _who(clients["owner"], "run", run)).json()["viewers"]
    [viewer] = seen
    assert viewer["display_name"] == f"Member {stage['tag']}"
    assert viewer["handle"] == f"member-{stage['tag']}"


async def test_presence_on_a_notebook_and_a_saved_circuit_works_the_same_as_a_run(stage):
    clients = stage["clients"]
    for kind in ("notebook", "artifact"):
        target = stage["a"][kind]
        assert (await _beat(clients["member"], kind, target)).status_code == 204
        seen = (await _who(clients["owner"], kind, target)).json()["viewers"]
        assert [v["user_id"] for v in seen] == [str(stage["scopes"]["member"].user_id)]
