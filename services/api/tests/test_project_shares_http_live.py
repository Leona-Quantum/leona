"""Project sharing over real HTTP, against real Postgres (migration 0042).

`tests/authz/test_project_shares_live.py` proves the repository: what a grant
reaches and what it does not. It cannot prove the routes expose that correctly,
and the last two releases both produced a defect that lived exactly in that gap
— `PATCH /projects/{id}` returned a 500 with its repository tests, its behaviour
suite and the authz matrix all green, because the failure was a lazy load in the
handler rather than anything the repository did.

So this drives the endpoints. Two clients against one app, each with its own
scope: Alice, who owns a project, and Bob, who is granted it. What is only
checkable here:

- **Status codes are the contract.** A 404 for a project you cannot see and a
  403 for one you can but may not administer are different sentences to the
  client, and only the route decides which it sends.
- **The 409 conflict carries the winning version id.** Without it the web can
  say "try again" and nothing else, and trying again with the same stale id
  fails identically forever. The repository raises an exception object; whether
  its contents survive into JSON is a route question.
- **Serialization touches every field.** A shared artifact renders through the
  same mapper as an owned one, and the `SharedProject` resource is new — a field
  the ORM row leaves expired is a 500 on a read that succeeded.
- **The Vault cap on a copy.** It is enforced in the route, not the repository,
  deliberately, and a cap enforced nowhere looks exactly like a cap that passes.
"""

import datetime as dt
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import projects as projects_repo
from majorana_api.repos import system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="project share routes need DATABASE_URL"
)

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


class Party:
    def __init__(self, user, workspace, scope, client):
        self.user = user
        self.workspace = workspace
        self.scope = scope
        self.client = client


async def _provision(session, tag: str):
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"httpshare-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@httpshare.test",
        display_name=tag.title(),
    )
    return user, workspace


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
    """Alice with a project and two circuits — one filed, one not. Bob, a stranger.

    Committed rather than rolled back, because two ASGI apps over two sessions
    is the point: a fixture only one of them can see would make every
    cross-client assertion vacuously true.
    """
    from majorana_api.settings import Settings

    settings = Settings(**SETTINGS_KWARGS)
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        alice_user, alice_ws = await _provision(session, "alice")
        bob_user, bob_ws = await _provision(session, "bob")
        alice_scope = Scope(user_id=alice_user.id, workspace_id=alice_ws.id, role=Role.OWNER)
        project = await projects_repo.create_project(alice_scope, session, name="Shared work")
        artifact = await artifacts_repo.create_artifact(
            alice_scope,
            session,
            slug=f"http-share-{uuid.uuid4().hex[:8]}",
            title="Bell pair",
            family="Bell",
            framework="qiskit",
        )
        version = await artifacts_repo.create_version(
            alice_scope,
            session,
            artifact.id,
            qasm_version="3.0",
            qasm="OPENQASM 3.0;",
            code="print('original')",
            code_lang="python",
            fingerprint=f"http-{uuid.uuid4().hex[:8]}",
            export_status="lossless",
        )
        await projects_repo.set_artifact_project(alice_scope, session, artifact.id, project.id)
        unshared = await artifacts_repo.create_artifact(
            alice_scope,
            session,
            slug=f"http-private-{uuid.uuid4().hex[:8]}",
            title="Not in the project",
            family="Bell",
            framework="qiskit",
        )
        await session.commit()

    bob_scope = Scope(user_id=bob_user.id, workspace_id=bob_ws.id, role=Role.OWNER)
    alice = Party(
        alice_user,
        alice_ws,
        alice_scope,
        _client(factory, engine, alice_scope, alice_user, alice_ws, settings),
    )
    bob = Party(
        bob_user, bob_ws, bob_scope, _client(factory, engine, bob_scope, bob_user, bob_ws, settings)
    )
    try:
        yield {
            "alice": alice,
            "bob": bob,
            "project_id": str(project.id),
            "artifact_id": str(artifact.id),
            "version_id": str(version.id),
            "unshared_artifact_id": str(unshared.id),
            "factory": factory,
        }
    finally:
        await alice.client.aclose()
        await bob.client.aclose()
        await engine.dispose()


async def _grant(stage, role="viewer", expires_at=None):
    body = {"email": stage["bob"].user.email, "role": role}
    if expires_at is not None:
        body["expires_at"] = expires_at
    response = await stage["alice"].client.post(
        f"/v1/workspace/projects/{stage['project_id']}/shares", json=body
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_the_whole_grant_lifecycle_over_http(stage):
    granted = await _grant(stage)
    assert granted["grantee_email"] == stage["bob"].user.email
    assert granted["role"] == "viewer"
    assert granted["granted_by_email"] == stage["alice"].user.email

    listed = await stage["alice"].client.get(f"/v1/workspace/projects/{stage['project_id']}/shares")
    assert listed.status_code == 200
    assert [row["grantee_email"] for row in listed.json()] == [stage["bob"].user.email]

    mine = await stage["bob"].client.get("/v1/shared/projects")
    assert mine.status_code == 200
    shared = [row for row in mine.json() if row["id"] == stage["project_id"]]
    assert len(shared) == 1
    assert shared[0]["name"] == "Shared work"
    assert shared[0]["owner_workspace_name"] == stage["alice"].workspace.name
    assert shared[0]["artifact_count"] == 1
    assert shared[0]["role"] == "viewer"
    # Every field of a brand-new resource, serialized once. A model whose ORM
    # row was expired by a preceding UPDATE fails here and nowhere else.
    assert shared[0]["shared_by_email"] == stage["alice"].user.email
    assert shared[0]["revision"]

    revoked = await stage["alice"].client.delete(
        f"/v1/workspace/projects/{stage['project_id']}/shares/{stage['bob'].user.id}"
    )
    assert revoked.status_code == 204
    after = await stage["bob"].client.get("/v1/shared/projects")
    assert [row for row in after.json() if row["id"] == stage["project_id"]] == []


async def test_a_stranger_gets_404_everywhere(stage):
    """No grant: every shared route answers "not found", never "forbidden".

    404 rather than 403 on purpose — 403 would confirm the project exists, which
    is a fact about another tenant.
    """
    project_id, artifact_id = stage["project_id"], stage["artifact_id"]
    client = stage["bob"].client
    for method, path in [
        ("GET", f"/v1/shared/projects/{project_id}"),
        ("GET", f"/v1/shared/projects/{project_id}/artifacts"),
        ("GET", f"/v1/shared/projects/{project_id}/artifacts/{artifact_id}"),
        ("GET", f"/v1/shared/projects/{project_id}/artifacts/{artifact_id}/versions"),
    ]:
        response = await client.request(method, path)
        assert response.status_code == 404, f"{path} answered {response.status_code}"

    assert (
        await client.post(f"/v1/shared/projects/{project_id}/artifacts/{artifact_id}/copy", json={})
    ).status_code == 404
    assert (
        await client.post(
            f"/v1/shared/projects/{project_id}/artifacts/{artifact_id}/versions",
            json={"expected_current_version_id": None, "code": "x", "code_lang": "python"},
        )
    ).status_code == 404
    # And Bob cannot administer a project he cannot see.
    assert (await client.get(f"/v1/workspace/projects/{project_id}/shares")).status_code == 404


async def test_the_binding_check_holds_over_http(stage):
    """Alice's other artifact, requested through the project Bob was granted."""
    await _grant(stage, role="editor")
    response = await stage["bob"].client.get(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['unshared_artifact_id']}"
    )
    assert response.status_code == 404


async def test_a_viewer_is_refused_the_save_and_an_editor_is_not(stage):
    await _grant(stage, role="viewer")
    refused = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/versions",
        json={
            "expected_current_version_id": stage["version_id"],
            "code": "print('viewer')",
            "code_lang": "python",
        },
    )
    # AuthzError from the repository — the app's handler turns it into a 403,
    # which is the right answer here: Bob can see this project, so hiding the
    # reason would leave him with no way to know he needs a different grant.
    assert refused.status_code == 403, refused.text

    await _grant(stage, role="editor")
    saved = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/versions",
        json={
            "expected_current_version_id": stage["version_id"],
            "code": "print('editor was here')",
            "code_lang": "python",
        },
    )
    assert saved.status_code == 201, saved.text
    body = saved.json()
    assert body["code"] == "print('editor was here')"
    assert body["verification_summary"] is None or body["verification_summary"].get("decision") in (
        None,
        "inconclusive",
    )


async def test_a_stale_save_answers_409_and_names_the_winner(stage):
    """The field the whole conflict flow is built on."""
    await _grant(stage, role="editor")
    winner = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/versions",
        json={
            "expected_current_version_id": stage["version_id"],
            "code": "print('first')",
            "code_lang": "python",
        },
    )
    assert winner.status_code == 201
    winner_id = winner.json()["id"]

    stale = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/versions",
        json={
            "expected_current_version_id": stage["version_id"],  # still the old one
            "code": "print('second')",
            "code_lang": "python",
        },
    )
    assert stale.status_code == 409, stale.text
    # RFC 7807, which is what `app._problem` turns every refusal into: the
    # sentence is `title` and the typed fields are its SIBLINGS, not nested
    # under `detail`. Asserted in that shape here because the web parses this
    # exact body — the first draft of `project-shares.ts` read `detail` and
    # would have shipped a dead "open theirs" button with every test green.
    body = stale.json()
    assert body["title"].startswith("Somebody else saved")
    assert body["reason"] == "version_conflict"
    assert body["current_version_id"] == winner_id

    # Re-submitting with what the refusal reported succeeds. That IS the
    # overwrite, and it required being handed the thing being overwritten.
    retry = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/versions",
        json={
            "expected_current_version_id": winner_id,
            "code": "print('second')",
            "code_lang": "python",
        },
    )
    assert retry.status_code == 201, retry.text


async def test_a_copy_lands_in_the_callers_workspace_and_is_filed(stage):
    await _grant(stage)
    response = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/copy",
        json={},
    )
    assert response.status_code == 201, response.text
    copy = response.json()
    assert copy["workspace_id"] == str(stage["bob"].workspace.id)
    assert copy["id"] != stage["artifact_id"]
    # Filed, so it appears in Bob's Studio — the route keeps it, having checked
    # the cap first.
    assert copy["kept_at"] is not None
    # And it claims nothing. A copy of verified work is not verified work.
    assert copy["verifier_decision"] is None

    listed = await stage["bob"].client.get("/v1/artifacts")
    assert copy["id"] in {row["id"] for row in listed.json()}
    # Alice's own list is unchanged by somebody copying out of it.
    alice_listed = await stage["alice"].client.get("/v1/artifacts")
    assert copy["id"] not in {row["id"] for row in alice_listed.json()}


async def test_refusals_arrive_as_sentences(stage):
    project_id = stage["project_id"]
    client = stage["alice"].client

    to_self = await client.post(
        f"/v1/workspace/projects/{project_id}/shares",
        json={"email": stage["alice"].user.email, "role": "viewer"},
    )
    assert to_self.status_code == 409
    assert "already have access" in to_self.json()["title"]

    unknown = await client.post(
        f"/v1/workspace/projects/{project_id}/shares",
        json={"email": "nobody-here@httpshare.test", "role": "viewer"},
    )
    assert unknown.status_code == 404

    past = await client.post(
        f"/v1/workspace/projects/{project_id}/shares",
        json={
            "email": stage["bob"].user.email,
            "role": "viewer",
            "expires_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat(),
        },
    )
    assert past.status_code == 409
    assert "future" in past.json()["title"]

    naive = await client.post(
        f"/v1/workspace/projects/{project_id}/shares",
        json={
            "email": stage["bob"].user.email,
            "role": "viewer",
            "expires_at": "2027-01-01T00:00:00",  # no offset
        },
    )
    assert naive.status_code == 422

    bad_role = await client.post(
        f"/v1/workspace/projects/{project_id}/shares",
        json={"email": stage["bob"].user.email, "role": "owner"},
    )
    assert bad_role.status_code == 422


async def test_an_expired_grant_is_simply_absent(stage):
    """Set an expiry a moment ahead, then read past it."""
    from sqlalchemy import update

    from majorana_api.orm import ProjectShare

    await _grant(
        stage, expires_at=(dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat()
    )
    assert (
        await stage["bob"].client.get(f"/v1/shared/projects/{stage['project_id']}")
    ).status_code == 200

    async with stage["factory"]() as session:
        await session.execute(
            update(ProjectShare)
            .where(ProjectShare.project_id == uuid.UUID(stage["project_id"]))
            .values(expires_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1))
        )
        await session.commit()

    assert (
        await stage["bob"].client.get(f"/v1/shared/projects/{stage['project_id']}")
    ).status_code == 404
    mine = await stage["bob"].client.get("/v1/shared/projects")
    assert [row for row in mine.json() if row["id"] == stage["project_id"]] == []
    # Alice still sees the row: an expired grant is extendable, not vanished.
    listed = await stage["alice"].client.get(f"/v1/workspace/projects/{stage['project_id']}/shares")
    assert len(listed.json()) == 1


async def test_deleting_the_project_closes_every_grant(stage):
    await _grant(stage)
    deleted = await stage["alice"].client.delete(f"/v1/workspace/projects/{stage['project_id']}")
    assert deleted.status_code == 204
    assert (
        await stage["bob"].client.get(f"/v1/shared/projects/{stage['project_id']}")
    ).status_code == 404


async def test_stop_sharing_with_everybody(stage):
    await _grant(stage)
    response = await stage["alice"].client.delete(
        f"/v1/workspace/projects/{stage['project_id']}/shares"
    )
    assert response.status_code == 204
    assert (
        await stage["alice"].client.get(f"/v1/workspace/projects/{stage['project_id']}/shares")
    ).json() == []
