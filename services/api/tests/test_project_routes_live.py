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
    assert set(project) == {"id", "workspace_id", "name", "created_at", "updated_at"}, (
        "the resource is the contract; an extra field here is an unversioned change"
    )

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
