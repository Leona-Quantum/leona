"""Sharing a project is a Team-plan capability, on both ends, over real HTTP.

`test_project_shares_http_live.py` puts both parties on the Team plan and then
tests what sharing does. This is the other half: what it does when one of them
is not, which is the state every account in this deployment is in today.

Both ends matter and they are not the same refusal:

- The **granter** is refused 403 before the project id is resolved, so a free
  account cannot use this route to learn which project ids exist.
- The **grantee** is refused 409, because the request is the wrong shape rather
  than the plan being wrong — the address is the part to change.

The two are separately reachable, and a version of this gate that checked only
the granter would pass every test that varied the granter. So each case here
varies exactly one side and holds the other at Team.

Committing, and therefore responsible for its own teardown.
"""

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
from majorana_api.repos import projects as projects_repo
from majorana_api.repos import system
from majorana_api.settings import Settings
from majorana_api.tiers import DEVELOPER_PLAN, TEAM_PLAN

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the sharing tier gate needs DATABASE_URL"
)

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

#: `users.plan` has no CHECK constraint and `resolve_tier` maps an unrecognised
#: value to `free`. The seed data already contains one of these ("pro"), so the
#: fall-through is a real state and not a hypothetical.
UNKNOWN_PLAN = "pro"


async def _party(session, tag: str, plan: str):
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"tiergate-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@tiergate.test",
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


class _Stage:
    def __init__(self, client, project_id, grantee_email, cleanup):
        self.client = client
        self.project_id = project_id
        self.grantee_email = grantee_email
        self._cleanup = cleanup

    async def grant(self, role: str = "editor") -> httpx.Response:
        return await self.client.post(
            f"/v1/workspace/projects/{self.project_id}/shares",
            json={"email": self.grantee_email, "role": role},
        )


async def _stage(*, granter_plan: str, grantee_plan: str):
    settings = Settings(**SETTINGS_KWARGS)
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        granter, granter_ws = await _party(session, "granter", granter_plan)
        grantee, _grantee_ws = await _party(session, "grantee", grantee_plan)
        scope = Scope(user_id=granter.id, workspace_id=granter_ws.id, role=Role.OWNER)
        project = await projects_repo.create_project(scope, session, name="Tier gate")
        await session.commit()
        workspace_ids = [granter_ws.id, _grantee_ws.id]
        user_ids = [granter.id, grantee.id]

    client = _client(factory, engine, scope, granter, granter_ws, settings)

    async def cleanup():
        await client.aclose()
        await delete_committed_tenants(factory, workspace_ids, user_ids)
        await engine.dispose()

    return _Stage(client, str(project.id), grantee.email, cleanup)


async def test_a_free_granter_is_refused_403_with_a_reason_the_web_can_key_off():
    stage = await _stage(granter_plan="free", grantee_plan=TEAM_PLAN)
    try:
        response = await stage.grant()
        assert response.status_code == 403, response.text
        body = response.json()
        assert body["reason"] == "project_sharing_not_in_plan", body
        # The English sentence has to stand alone for any client that does not
        # know the reason code.
        assert "Team plan" in body["title"], body
    finally:
        await stage._cleanup()


async def test_a_free_grantee_is_refused_409_and_the_refusal_names_no_plan():
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan="free")
    try:
        response = await stage.grant()
        assert response.status_code == 409, response.text
        detail = response.json()["title"]
        assert "Team plan" in detail, detail
        # A granter typed an address. Telling them which plan it is on would
        # answer a question about somebody else's account that they did not ask
        # and are not entitled to.
        assert "free" not in detail.lower(), detail
    finally:
        await stage._cleanup()


async def test_a_plan_string_nobody_recognises_grants_nothing():
    """`users.plan` has no CHECK constraint, so this is a reachable row state."""
    stage = await _stage(granter_plan=UNKNOWN_PLAN, grantee_plan=TEAM_PLAN)
    try:
        response = await stage.grant()
        assert response.status_code == 403, response.text
    finally:
        await stage._cleanup()


async def test_the_granter_is_refused_before_the_project_is_resolved():
    """A free account must not be able to probe which project ids exist.

    Same route, same caller, one real project id and one that names nothing. If
    the tier check ran after the project lookup, these would answer 403 and 404
    and the difference would be an existence oracle.
    """
    stage = await _stage(granter_plan="free", grantee_plan=TEAM_PLAN)
    try:
        real = await stage.grant()
        missing = await stage.client.post(
            f"/v1/workspace/projects/{uuid.uuid4()}/shares",
            json={"email": stage.grantee_email, "role": "editor"},
        )
        assert real.status_code == 403, real.text
        assert missing.status_code == 403, missing.text
    finally:
        await stage._cleanup()


async def test_both_ends_on_the_team_plan_is_the_case_that_works():
    """The positive control. Without it every assertion above passes if the
    route were simply broken for everybody."""
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        response = await stage.grant()
        assert response.status_code == 201, response.text
    finally:
        await stage._cleanup()


async def test_the_operator_tier_keeps_every_team_capability():
    """`developer` is the operator's and the collaborators' tier.

    The gate asks `limits.project_sharing`, not `tier == "team"`. Had it asked
    the second question, the account that runs the deployment would have lost
    the ability to share its own projects the moment this shipped.
    """
    stage = await _stage(granter_plan=DEVELOPER_PLAN, grantee_plan=DEVELOPER_PLAN)
    try:
        response = await stage.grant()
        assert response.status_code == 201, response.text
    finally:
        await stage._cleanup()
