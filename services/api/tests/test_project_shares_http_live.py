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
from repo_test_helpers import delete_committed_tenants
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import projects as projects_repo
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_api.tiers import TEAM_PLAN, limits_for, tier_of

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


async def _provision(session, tag: str, *, plan: str = TEAM_PLAN):
    """A party in this suite, on the Team plan unless a test says otherwise.

    Sharing is a Team-plan capability on both ends, so a free-tier Alice cannot
    reach any of the routes below and a free-tier Bob cannot be granted. That is
    the product rule and it has its own suite; here it would only mean every
    test asserting 403 on its fixture instead of on its subject.

    The plan is set on the row rather than through an allowlist because that is
    the durable signal — `tiers.tier_of` resolves `users.plan` without consulting
    any environment variable, so this fixture does not depend on how the process
    was configured.
    """
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"httpshare-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@httpshare.test",
        display_name=tag.title(),
    )
    user.plan = plan
    await session.flush()
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
            kept=True,
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
        await projects_repo.set_artifact_project(
            alice_scope, session, artifact.id, project.id, workspace_artifact_limit=None
        )
        unshared = await artifacts_repo.create_artifact(
            alice_scope,
            session,
            slug=f"http-private-{uuid.uuid4().hex[:8]}",
            title="Not in the project",
            family="Bell",
            framework="qiskit",
            kept=True,
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
        await delete_committed_tenants(
            factory, [alice_ws.id, bob_ws.id], [alice_user.id, bob_user.id]
        )
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


# --------------------------------------------------------------------------- #
# Contributing a new circuit (migration 0043)
# --------------------------------------------------------------------------- #

CONTRIBUTED = "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(3)\n"


async def test_an_editor_can_add_a_circuit_and_both_parties_then_see_it(stage):
    """The round trip the repository test cannot make: two clients, one project.

    Bob POSTs and Alice GETs. The assertion that matters is Alice's list — a
    contribution that only Bob can see through his own grant would pass every
    single-client test and be the wrong feature.
    """
    await _grant(stage, role="editor")

    created = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts",
        json={"title": "GHZ state", "family": "GHZ", "framework": "qiskit", "code": CONTRIBUTED},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["title"] == "GHZ state"
    assert body["workspace_id"] == str(stage["alice"].workspace.id)
    assert body["kept_at"] is not None
    # Serialization touches every field of the resource, through the same mapper
    # an owned artifact uses — a column the ORM left expired is a 500 here.
    #
    # And the resource claims NOTHING. `VerificationSummary.decision` is required,
    # the stored summary has none, so `parse_verification_summary` drops the whole
    # object rather than inventing a verdict — which is the same answer the
    # grantee's own edits give, and the reason the Vault list renders absence
    # rather than defaulting to verified.
    assert body["verification_summary"] is None
    assert body["verifier_decision"] is None
    assert body["evidence_strength"] is None

    hers = await stage["alice"].client.get("/v1/artifacts")
    assert hers.status_code == 200
    assert "GHZ state" in {row["title"] for row in hers.json()}

    his = await stage["bob"].client.get("/v1/artifacts")
    assert "GHZ state" not in {row["title"] for row in his.json()}


async def test_a_viewer_gets_403_and_a_stranger_gets_404(stage):
    """Two different sentences, and only the route decides which is sent.

    403 means "this exists and you may not"; 404 means "as far as you are
    concerned there is nothing here". Sending 403 to a stranger would confirm the
    project id is real to anybody who guesses one.
    """
    body = {"title": "nope", "family": "Bell", "framework": "qiskit", "code": CONTRIBUTED}
    path = f"/v1/shared/projects/{stage['project_id']}/artifacts"

    stranger = await stage["bob"].client.post(path, json=body)
    assert stranger.status_code == 404, stranger.text

    await _grant(stage, role="viewer")
    viewer = await stage["bob"].client.post(path, json=body)
    assert viewer.status_code == 403, viewer.text

    await _grant(stage, role="editor")
    editor = await stage["bob"].client.post(path, json=body)
    assert editor.status_code == 201, editor.text


async def test_a_full_project_answers_409_with_a_sentence_the_web_can_show(stage):
    """RFC 7807 `title`, not `detail`.

    The web reads refusals from `title` — session 49 shipped a client reading
    `payload.detail`, which this API never sends, so every share refusal would
    have rendered a generic fallback. Asserted here rather than trusted.
    """
    await _grant(stage, role="editor")
    limit = await stage["alice"].client.patch(
        f"/v1/workspace/projects/{stage['project_id']}", json={"max_artifacts": 1}
    )
    assert limit.status_code == 200, limit.text

    # The project already holds Alice's own filed circuit, so it is at 1 of 1.
    refused = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts",
        json={
            "title": "one too many",
            "family": "Bell",
            "framework": "qiskit",
            "code": CONTRIBUTED,
        },
    )
    assert refused.status_code == 409, refused.text
    payload = refused.json()
    assert "1-circuit limit" in payload["title"]
    assert payload.get("detail") is None


async def test_the_grantees_header_carries_the_limit_it_will_be_refused_by(stage):
    """One number, read from the same place the refusal is computed from."""
    await _grant(stage, role="editor")
    await stage["alice"].client.patch(
        f"/v1/workspace/projects/{stage['project_id']}", json={"max_artifacts": 4}
    )
    header = await stage["bob"].client.get(f"/v1/shared/projects/{stage['project_id']}")
    assert header.status_code == 200, header.text
    assert header.json()["artifact_limit"] == 4
    assert header.json()["artifact_count"] == 1


async def test_a_contribution_route_takes_no_workspace_from_the_caller(stage):
    """`extra="forbid"`, so a caller-supplied scope is a 422 rather than ignored."""
    await _grant(stage, role="editor")
    response = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts",
        json={
            "title": "smuggled",
            "family": "Bell",
            "framework": "qiskit",
            "code": CONTRIBUTED,
            "workspace_id": str(stage["bob"].workspace.id),
        },
    )
    assert response.status_code == 422, response.text


async def test_an_oversized_or_blank_contribution_is_refused_at_the_boundary(stage):
    await _grant(stage, role="editor")
    path = f"/v1/shared/projects/{stage['project_id']}/artifacts"
    base = {"family": "Bell", "framework": "qiskit"}

    too_big = await stage["bob"].client.post(
        path, json={**base, "title": "huge", "code": "x" * 100_001}
    )
    assert too_big.status_code == 422, too_big.text

    blank = await stage["bob"].client.post(path, json={**base, "title": "   ", "code": CONTRIBUTED})
    assert blank.status_code == 422, blank.text

    empty_code = await stage["bob"].client.post(path, json={**base, "title": "ok", "code": ""})
    assert empty_code.status_code == 422, empty_code.text


# --------------------------------------------------------------------------- #
# The two new refusals, over the wire (2026-08-02)
# --------------------------------------------------------------------------- #


async def test_a_full_project_refuses_a_move_with_409_and_not_429(stage):
    """The status code IS the contract, and these two walls are different walls.

    429 sends a user to the pricing page; 409 sends them to the project they are
    filing into. The repository raises two different exception types and only the
    route decides which becomes which, so a handler catching one branch for both
    is invisible everywhere except here.
    """
    alice = stage["alice"]
    limit = await alice.client.patch(
        f"/v1/workspace/projects/{stage['project_id']}",
        json={"max_artifacts": 1},
    )
    assert limit.status_code == 200, limit.text

    response = await alice.client.patch(
        f"/v1/artifacts/{stage['unshared_artifact_id']}/project",
        json={"project_id": stage["project_id"]},
    )
    assert response.status_code == 409, response.text
    # RFC 9457: the sentence a person reads is `title`, and the typed fields are
    # its siblings. Reading `detail` here would be reading FastAPI's shape rather
    # than the one the web client parses.
    problem = response.json()
    assert problem["reason"] == "project_artifact_limit_reached"
    assert problem["limit"] == 1
    assert problem["used"] == 1
    assert "1 of its 1 artifacts" in problem["title"]

    # Positive control: the same request against a project with room succeeds,
    # so the 409 was the limit rather than the route refusing every move.
    raised = await alice.client.patch(
        f"/v1/workspace/projects/{stage['project_id']}",
        json={"max_artifacts": 5},
    )
    assert raised.status_code == 200, raised.text
    moved = await alice.client.patch(
        f"/v1/artifacts/{stage['unshared_artifact_id']}/project",
        json={"project_id": stage["project_id"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["project_id"] == stage["project_id"]


async def test_a_zero_limit_says_so_rather_than_showing_a_full_up_counter(stage):
    """ "holds 0 of its 0 artifacts" is arithmetically true and reads as a bug."""
    alice = stage["alice"]
    await alice.client.patch(
        f"/v1/workspace/projects/{stage['project_id']}",
        json={"max_artifacts": 0},
    )
    response = await alice.client.patch(
        f"/v1/artifacts/{stage['unshared_artifact_id']}/project",
        json={"project_id": stage["project_id"]},
    )
    assert response.status_code == 409, response.text
    title = response.json()["title"]
    assert "limit is 0" in title
    assert "0 of its 0" not in title


async def test_the_usage_endpoint_reports_the_count_the_cap_enforces(stage):
    """A shared project's contents leave the allowance the screen shows.

    The number on the account page and the number a refusal is measured against
    have to be one number. They were the same integer until this change and are
    not any more, so this reads the endpoint before and after the grant and
    requires it to move.
    """
    alice = stage["alice"]
    before = await alice.client.get("/v1/usage")
    assert before.status_code == 200, before.text
    filed_before = before.json()["artifacts"]["used"]
    assert before.json()["shared_projects"]["used"] == 0

    await _grant(stage, role="viewer")

    after = await alice.client.get("/v1/usage")
    assert after.status_code == 200, after.text
    body = after.json()
    assert body["artifacts"]["used"] == filed_before - 1, (
        "the one artifact in the now-shared project should have left the allowance"
    )
    # ...and the sharing itself is now on the account's own ledger.
    assert body["shared_projects"]["used"] == 1
    assert body["shared_projects"]["limit"] == 4


async def test_a_copy_into_a_shared_project_is_not_refused_at_the_private_cap(stage):
    """The pre-check has to ask the same question the authoritative check asks.

    `keep_artifact` skips the individual allowance entirely when the artifact
    lands in a SHARED project. The copy route's cheap pre-check read only the
    quota count, so a Team account at its private cap copying into one of its
    OWN shared projects got a 429 from the pre-check for a write the check below
    it would have accepted. Found by CodeRabbit on PR 216, two lines under a
    comment claiming the two numbers agreed.

    Driven from Bob's side, because Bob is the one who holds a grant and can
    copy. His own project is shared back to Alice so that the copy's target
    carries a live grant.
    """
    await _grant(stage, role="viewer")
    bob, alice = stage["bob"], stage["alice"]

    async with stage["factory"]() as session:
        bobs_project = await projects_repo.create_project(bob.scope, session, name="Bob's shared")
        await session.commit()

    shared_back = await bob.client.post(
        f"/v1/workspace/projects/{bobs_project.id}/shares",
        json={"email": alice.user.email, "role": "viewer"},
    )
    assert shared_back.status_code == 201, shared_back.text

    # Bob is now at the free tier's private cap. `_provision` puts both parties
    # on the Team plan, so fill to THAT number rather than to a literal.
    async with stage["factory"]() as session:
        limits = limits_for(tier_of(bob.user, Settings(**SETTINGS_KWARGS)))
        held = await artifacts_repo.count_kept_against_quota(bob.scope, session)
        for index in range(limits.private_artifacts - held):
            await artifacts_repo.create_artifact(
                bob.scope,
                session,
                slug=f"fill-{index}-{uuid.uuid4().hex[:8]}",
                title=f"filler {index}",
                family="Bell",
                framework="qiskit",
                kept=True,
            )
        await session.commit()
        assert await artifacts_repo.count_kept_against_quota(bob.scope, session) == (
            limits.private_artifacts
        )

    # Into the UNGROUPED list: spends a slot, and there is none. The control that
    # says Bob really is at his cap, so the success below is not a full-up
    # fixture that never filled.
    refused = await bob.client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/copy",
        json={},
    )
    assert refused.status_code == 429, refused.text
    assert refused.json()["reason"] == "artifact_allowance_exhausted"

    # Into his own SHARED project: spends nothing, so it must land.
    accepted = await bob.client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/copy",
        json={"target_project_id": str(bobs_project.id)},
    )
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["project_id"] == str(bobs_project.id)


async def test_a_copy_into_another_workspaces_project_is_a_404_not_an_oracle(stage):
    """The pre-check resolves the target through the caller's scope first.

    `is_project_shared` takes a bare id. Asking it about an id the caller has not
    been proven to own would make the 429 an oracle for "is that project shared?"
    on any uuid — a small leak, and the reason the scoped getter runs first.
    """
    await _grant(stage, role="viewer")
    response = await stage["bob"].client.post(
        f"/v1/shared/projects/{stage['project_id']}/artifacts/{stage['artifact_id']}/copy",
        json={"target_project_id": stage["project_id"]},  # Alice's project, not Bob's
    )
    assert response.status_code == 404, response.text


# --------------------------------------------------------------------------- #
# The import route's allowance (2026-08-02, second PR)
# --------------------------------------------------------------------------- #

PUBLIC_IMPORT = {
    "family": "Bell",
    "framework": "qiskit",
    # Binds FINAL_CIRCUIT because the route refuses source that binds neither it
    # nor RESULT — the catalog published 87 records this rejects, and the point
    # of the gate is that they stop reaching the Vault. A fixture that binds
    # nothing would be exercising the allowance against something the route can
    # no longer be asked to file.
    "code": (
        "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n\n"
        "FINAL_CIRCUIT = qc\n"
    ),
    "code_lang": "python",
    "source_url": "https://example.org/atlas",
    "source_license": "CC-BY-4.0",
    "introduction": "An imported public reference.",
    "explanation": "Two qubits entangled.",
    "verification": "Not verified in this workspace.",
}


async def test_importing_a_public_reference_spends_the_artifact_allowance(stage):
    """Measured over real HTTP before this was fixed: 35 imports, all 201, a
    free-tier workspace holding 36 against a cap of 25.

    The handler took `scope` and `session` and no `CurrentIdentity`, so it had no
    account to resolve a tier from and could not have checked a cap. A route that
    writes a metered row and does not take the identity is not enforcing an
    allowance, whatever the rest of the service does.
    """
    alice = stage["alice"]
    limits = limits_for(tier_of(alice.user, Settings(**SETTINGS_KWARGS)))
    cap = limits.private_artifacts
    assert cap is not None, "this test needs a metered tier to have a boundary to reach"

    async with stage["factory"]() as session:
        held = await artifacts_repo.count_kept_against_quota(alice.scope, session)

    statuses = []
    for index in range(cap - held + 3):
        response = await alice.client.post(
            "/v1/artifacts/import-public",
            json={
                **PUBLIC_IMPORT,
                "source_slug": f"public-circuit-{index}-{uuid.uuid4().hex[:8]}",
                "title": f"Public circuit {index}",
                "source_title": f"Public circuit {index}",
            },
        )
        statuses.append(response.status_code)

    assert 429 in statuses, (
        f"every import was accepted ({sorted(set(statuses))}); the cap is not on this route"
    )
    assert statuses.count(201) == cap - held, (
        f"filed {statuses.count(201)} of the {cap - held} slots that were free"
    )

    async with stage["factory"]() as session:
        final = await artifacts_repo.count_kept_against_quota(alice.scope, session)
    assert final == cap, f"the workspace holds {final} against a cap of {cap}"


async def test_re_importing_something_already_imported_spends_nothing(stage):
    """Idempotent on the source slug, and that is load-bearing for the cap.

    An account at its limit must still be able to open what it already has. If
    the second import spent a slot, the refusal would arrive for a row the
    workspace already holds — and the count would climb past the cap on repeat
    requests, which is the bypass in a different shape.
    """
    alice = stage["alice"]
    payload = {
        **PUBLIC_IMPORT,
        "source_slug": f"repeatable-{uuid.uuid4().hex[:8]}",
        "title": "Repeatable reference",
        "source_title": "Repeatable reference",
    }
    first = await alice.client.post("/v1/artifacts/import-public", json=payload)
    assert first.status_code == 201, first.text

    async with stage["factory"]() as session:
        after_first = await artifacts_repo.count_kept_against_quota(alice.scope, session)

    second = await alice.client.post("/v1/artifacts/import-public", json=payload)
    assert second.status_code in (200, 201), second.text
    assert second.json()["id"] == first.json()["id"]

    async with stage["factory"]() as session:
        after_second = await artifacts_repo.count_kept_against_quota(alice.scope, session)
    assert after_second == after_first, "a repeat import spent a second slot"


async def test_a_public_record_that_is_not_a_circuit_never_reaches_the_vault(stage):
    """The catalog published 87 prose records — an operator's representative form,
    a literature method's ingredient list — as `framework: "Qiskit"`, and this
    route filed the paragraph as an artifact's executable code with
    `code_lang: "text"`.

    Asserted over real HTTP and against the real count rather than in a unit test
    with a mocked repo: what matters is that nothing lands, and a double cannot
    tell you that.
    """
    alice = stage["alice"]
    async with stage["factory"]() as session:
        before = await artifacts_repo.count_kept_against_quota(alice.scope, session)

    response = await alice.client.post(
        "/v1/artifacts/import-public",
        json={
            **PUBLIC_IMPORT,
            "source_slug": f"operator-annihilation-{uuid.uuid4().hex[:8]}",
            "title": "Fermionic annihilation operator",
            "source_title": "Fermionic annihilation operator",
            "code": (
                "OPERATOR: Fermionic annihilation operator\n"
                "REPRESENTATIVE FORM: a_p\n\n"
                "This is a mathematical operator record, not an executable circuit."
            ),
            "code_lang": "text",
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["reason"] == "public_source_not_executable_code"

    async with stage["factory"]() as session:
        after = await artifacts_repo.count_kept_against_quota(alice.scope, session)
    assert after == before, "a record this product cannot run was filed anyway"
