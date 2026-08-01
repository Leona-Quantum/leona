"""The project endpoints over real HTTP, against real Postgres.

The repository suite proves the SQL and the scoping; `test_artifact_routes.py`
exists because a correct, scoped, role-gated repository primitive was once
reachable from no route at all, so the Library's Delete button only wrote a
localStorage tombstone. These drive the actual ASGI app so that "the endpoint
exists, accepts that body, and returns that shape" is asserted rather than
assumed — including the two orderings that are silently wrong if reversed:
`/order` declared before `/{project_id}`, and a 204 that carries no body.
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
from majorana_api.orm import User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import shares as shares_repo
from majorana_api.repos import system
from majorana_api.settings import Settings

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="project route e2e needs DATABASE_URL"
)

pytestmark = requires_db

SETTINGS = Settings(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


@pytest.fixture
async def client():
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"project-routes-{uuid.uuid4()}",
            email=f"project-routes-{uuid.uuid4().hex[:8]}@routes.test",
        )
        await session.commit()
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        identity = (User(id=user.id, email=user.email, plan=user.plan), workspace)

    app = create_app(SETTINGS)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: identity

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as made:
        yield made, factory, scope
    await engine.dispose()


async def _artifact(factory, scope) -> str:
    async with factory() as session:
        artifact = await artifacts_repo.create_artifact(
            scope,
            session,
            slug=f"route-live-{uuid.uuid4().hex[:12]}",
            title="filed work",
            family="Bell",
            framework="qiskit",
        )
        await artifacts_repo.keep_artifact(scope, session, artifact.id)
        await session.commit()
        return str(artifact.id)


async def test_create_list_rename_and_delete_over_http(client):
    made, _factory, _scope = client

    created = await made.post("/v1/workspace/projects", json={"name": "Bell states"})
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["name"] == "Bell states"
    assert set(project) == {
        "id",
        "workspace_id",
        "name",
        "max_artifacts",
        "created_at",
        "updated_at",
    }, "the resource is the contract; an extra field here is an unversioned change"
    # Resolved, never NULL: the column is unset on a new project and the wire
    # carries the platform default rather than making every client know it.
    assert project["max_artifacts"] == shares_repo.DEFAULT_PROJECT_ARTIFACT_LIMIT

    listed = await made.get("/v1/workspace/projects")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [project["id"]]

    renamed = await made.patch(
        f"/v1/workspace/projects/{project['id']}", json={"name": "Bell pairs"}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Bell pairs"

    deleted = await made.delete(f"/v1/workspace/projects/{project['id']}")
    assert deleted.status_code == 204
    assert deleted.content == b"", "a 204 carrying a body breaks the web's DELETE proxy"
    assert (await made.get("/v1/workspace/projects")).json() == []


async def test_the_patch_changes_the_name_the_limit_or_both(client):
    """One PATCH, three shapes — and the rename-only body still works.

    `name` was required on this route before migration 0043 and is optional now,
    which is the widening direction: a web build that lands before this API deploy
    keeps sending `{"name": ...}` and keeps working. The reverse — making
    `max_artifacts` required — would have broken every existing client.
    """
    made, _factory, _scope = client
    project = (await made.post("/v1/workspace/projects", json={"name": "limits"})).json()
    path = f"/v1/workspace/projects/{project['id']}"

    only_limit = await made.patch(path, json={"max_artifacts": 3})
    assert only_limit.status_code == 200, only_limit.text
    assert only_limit.json()["max_artifacts"] == 3
    assert only_limit.json()["name"] == "limits"

    both = await made.patch(path, json={"name": "limits renamed", "max_artifacts": 0})
    assert both.status_code == 200, both.text
    assert (both.json()["name"], both.json()["max_artifacts"]) == ("limits renamed", 0)

    only_name = await made.patch(path, json={"name": "limits again"})
    assert only_name.status_code == 200, only_name.text
    assert only_name.json()["max_artifacts"] == 0, "a rename must not reset the limit"

    assert (await made.patch(path, json={})).status_code == 422
    assert (await made.patch(path, json={"max_artifacts": -1})).status_code == 422
    assert (await made.patch(path, json={"max_artifacts": 501})).status_code == 422
    assert (await made.patch(path, json={"max_artifacts": None})).status_code == 422, (
        "the API can move the limit but must not un-choose it back to the default"
    )


async def test_the_order_route_is_not_swallowed_by_the_project_id_route(client):
    """FastAPI matches in declaration order.

    Declared after `/{project_id}`, this request would be parsed as a rename of
    a project literally named "order" and fail on the UUID — a 422 that looks
    like a client bug rather than a routing one.
    """
    made, _factory, _scope = client
    first = (await made.post("/v1/workspace/projects", json={"name": "alpha"})).json()
    second = (await made.post("/v1/workspace/projects", json={"name": "beta"})).json()

    reordered = await made.patch(
        "/v1/workspace/projects/order", json={"order": [second["id"], first["id"]]}
    )
    assert reordered.status_code == 200, reordered.text
    assert [item["name"] for item in reordered.json()] == ["beta", "alpha"]
    assert [item["name"] for item in (await made.get("/v1/workspace/projects")).json()] == [
        "beta",
        "alpha",
    ], "the arrangement has to survive the next read, not just be echoed back"


async def test_filing_an_artifact_shows_up_on_the_artifact_resource(client):
    """The whole point of the migration: the sidebar groups from this field.

    Carried on the artifact rather than fetched as a separate assignments map,
    so this asserts BOTH the PATCH's answer and what the LIST says afterwards —
    a route that returned the new value without persisting it would pass the
    first check alone.
    """
    made, factory, scope = client
    project = (await made.post("/v1/workspace/projects", json={"name": "alpha"})).json()
    artifact_id = await _artifact(factory, scope)

    filed = await made.patch(
        f"/v1/artifacts/{artifact_id}/project", json={"project_id": project["id"]}
    )
    assert filed.status_code == 200, filed.text
    assert filed.json()["project_id"] == project["id"]

    # A bare JSON array, not a {"items": [...]} envelope — the list resource's
    # actual shape, confirmed by this call rather than assumed from the paging
    # helper's name on the web side.
    rows = {row["id"]: row for row in (await made.get("/v1/artifacts")).json()}
    assert rows[artifact_id]["project_id"] == project["id"]

    unfiled = await made.patch(f"/v1/artifacts/{artifact_id}/project", json={"project_id": None})
    assert unfiled.status_code == 200
    assert unfiled.json()["project_id"] is None


async def test_deleting_a_project_leaves_its_artifact_in_the_list_ungrouped(client):
    made, factory, scope = client
    project = (await made.post("/v1/workspace/projects", json={"name": "alpha"})).json()
    artifact_id = await _artifact(factory, scope)
    await made.patch(f"/v1/artifacts/{artifact_id}/project", json={"project_id": project["id"]})

    assert (await made.delete(f"/v1/workspace/projects/{project['id']}")).status_code == 204

    rows = {row["id"]: row for row in (await made.get("/v1/artifacts")).json()}
    assert artifact_id in rows, "deleting the container must not remove the contents"
    assert rows[artifact_id]["project_id"] is None


async def test_a_project_from_another_workspace_is_not_found_over_http(client):
    """The repository answers NotFoundError; this asserts the STATUS it becomes.

    A repo that scopes correctly behind a handler that reports the refusal as a
    500 is still a broken product, and only an HTTP-level check sees it.
    """
    made, _factory, _scope = client
    stranger = uuid.uuid4()
    assert (
        await made.patch(f"/v1/workspace/projects/{stranger}", json={"name": "x"})
    ).status_code == 404
    assert (await made.delete(f"/v1/workspace/projects/{stranger}")).status_code == 404
    assert (
        await made.patch("/v1/workspace/projects/order", json={"order": [str(stranger)]})
    ).status_code == 404


async def test_a_name_that_is_only_whitespace_is_refused(client):
    """A name of spaces normalizes to empty and must not create a nameless row.

    The 422 body is the API's fixed problem+json envelope — `{"title":
    "validation failed", "code": "validation_error"}` and nothing else. So the
    fact that `CreateProjectRequest` says "project name cannot be blank" rather
    than borrowing the folder wording is a source-level distinction only; it
    reaches logs and developers, never this response. Asserted here as what is
    actually observable, rather than as a claim about the body that would have
    quietly passed on the wrong message once the envelope changed.
    """
    made, _factory, _scope = client
    refused = await made.post("/v1/workspace/projects", json={"name": "   "})
    assert refused.status_code == 422
    assert (await made.get("/v1/workspace/projects")).json() == []


async def test_a_refused_combined_patch_leaves_the_name_alone(client):
    """The rename must not survive a refusal on the limit.

    `update_workspace_project` applies the rename and then the limit, and the two
    need different roles — write for the rename, ADMIN for the limit. A MEMBER
    therefore gets the rename applied and then an `AuthzError`, which reads like a
    partial write.

    It is not one, and this MEASURES that rather than reasoning about FastAPI's
    dependency teardown: `get_session` commits only after the handler returns, so
    an exception propagating out of it skips the commit and the session rolls back
    on close. Asserted over real HTTP because that ordering is a property of the
    framework rather than of this route — the kind that changes under an upgrade
    with nobody editing this file.
    """
    made, factory, scope = client
    project = (await made.post("/v1/workspace/projects", json={"name": "keep this name"})).json()

    app = create_app(SETTINGS)
    app.state.engine = made._transport.app.state.engine
    app.state.session_factory = factory
    member = Scope(user_id=scope.user_id, workspace_id=scope.workspace_id, role=Role.MEMBER)
    app.dependency_overrides[auth_deps.get_scope] = lambda: member
    app.dependency_overrides[auth_deps.get_identity] = made._transport.app.dependency_overrides[
        auth_deps.get_identity
    ]

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as as_member:
        refused = await as_member.patch(
            f"/v1/workspace/projects/{project['id']}",
            json={"name": "renamed by a member", "max_artifacts": 5},
        )
        # Positive control, and it is load-bearing: MEMBER is inside the write
        # allowlist, so a rename-ONLY patch must succeed. Without this the 403
        # could be the RENAME being refused rather than the limit, and "the name
        # did not change" would be trivially true.
        rename_only = await as_member.patch(
            f"/v1/workspace/projects/{project['id']}", json={"name": "renamed by a member"}
        )

    assert refused.status_code == 403, refused.text
    assert rename_only.status_code == 200, rename_only.text

    # Put the name back, so the assertion below is about the REFUSED patch only.
    await made.patch(f"/v1/workspace/projects/{project['id']}", json={"name": "keep this name"})

    after = (await made.get("/v1/workspace/projects")).json()
    row = next(item for item in after if item["id"] == project["id"])
    assert row["name"] == "keep this name", "the rename must not survive the refusal"
    assert row["max_artifacts"] == shares_repo.DEFAULT_PROJECT_ARTIFACT_LIMIT
