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
from majorana_api.tiers import DEVELOPER_PLAN, TEAM_PLAN, limits_for

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
    def __init__(
        self,
        client,
        project_id,
        grantee_email,
        cleanup,
        grantee_client=None,
        bystander_client=None,
        bystander_email=None,
    ):
        self.client = client
        self.project_id = project_id
        self.grantee_email = grantee_email
        self._cleanup = cleanup
        #: Built lazily, and only by the tests that need the other side: every
        #: case above this one varies the granter, and a second client staged
        #: for all of them would be a second identity override to keep correct.
        self.grantee_client = grantee_client
        self.bystander_client = bystander_client
        self.bystander_email = bystander_email

    async def grant(self, role: str = "editor") -> httpx.Response:
        return await self.client.post(
            f"/v1/workspace/projects/{self.project_id}/shares",
            json={"email": self.grantee_email, "role": role},
        )

    async def another_project(self, name: str) -> str:
        """A second project in the granter's workspace, made over HTTP.

        The membership cap counts grants the GRANTEE holds across every owner,
        so filling it from one owner measures the same number as filling it
        from four. What it cannot measure is the concurrent case — that is
        `test_membership_cap_race_live.py`, which needs two connections.
        """
        response = await self.client.post("/v1/workspace/projects", json={"name": name})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    async def grant_project(self, project_id: str, role: str = "editor") -> httpx.Response:
        return await self.client.post(
            f"/v1/workspace/projects/{project_id}/shares",
            json={"email": self.grantee_email, "role": role},
        )


async def _stage(*, granter_plan: str, grantee_plan: str):
    settings = Settings(**SETTINGS_KWARGS)
    engine = engine_from_env()
    factory = session_factory(engine)
    async with factory() as session:
        granter, granter_ws = await _party(session, "granter", granter_plan)
        grantee, _grantee_ws = await _party(session, "grantee", grantee_plan)
        # A second person on the same project. Only one test needs them, and it
        # is the one that matters most: leaving must take away the leaver's
        # access and nobody else's.
        bystander, bystander_ws = await _party(session, "bystander", grantee_plan)
        scope = Scope(user_id=granter.id, workspace_id=granter_ws.id, role=Role.OWNER)
        project = await projects_repo.create_project(scope, session, name="Tier gate")
        await session.commit()
        workspace_ids = [granter_ws.id, _grantee_ws.id, bystander_ws.id]
        user_ids = [granter.id, grantee.id, bystander.id]

    client = _client(factory, engine, scope, granter, granter_ws, settings)

    def _client_for(user, workspace):
        """A receiving account's own client, scoped to their own workspace.

        A grantee reaches a shared project from wherever they are — the grant
        is keyed on their user id, not on a workspace — so this is their
        personal workspace, exactly as it would be in a browser.
        """
        return _client(
            factory,
            engine,
            Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER),
            user,
            workspace,
            settings,
        )

    def grantee_client():
        return _client_for(grantee, _grantee_ws)

    def bystander_client():
        return _client_for(bystander, bystander_ws)

    async def cleanup():
        await client.aclose()
        await delete_committed_tenants(factory, workspace_ids, user_ids)
        await engine.dispose()

    return _Stage(
        client,
        str(project.id),
        grantee.email,
        cleanup,
        grantee_client,
        bystander_client,
        bystander.email,
    )


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


async def test_me_reports_the_tier_this_service_enforces():
    """The web app cannot resolve a plan-column tier and must be told it.

    `apps/web/lib/account-tier.ts` resolves a tier from the email allowlists,
    which is all a service with no database can do. An account on the Team plan
    by its `users.plan` column therefore reads as `free` in the browser, and the
    sidebar would offer it no Share button for a capability this service would
    have allowed. `/v1/me` carrying the resolved tier is what closes that.
    """
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        response = await stage.client.get("/v1/me")
        assert response.status_code == 200, response.text
        assert response.json()["tier"] == "team", response.text
    finally:
        await stage._cleanup()


async def test_me_reports_free_for_a_plan_string_nobody_recognises():
    stage = await _stage(granter_plan=UNKNOWN_PLAN, grantee_plan=TEAM_PLAN)
    try:
        response = await stage.client.get("/v1/me")
        assert response.status_code == 200, response.text
        assert response.json()["tier"] == "free", response.text
    finally:
        await stage._cleanup()


async def test_a_grantee_at_their_membership_cap_is_refused_the_next_project():
    """The owner's number: a person may be part of at most four projects.

    Counted on the RECEIVING account and enforced when a grant is made, so it
    bounds what one person can be pulled into rather than what one owner may
    give away — `MAX_SHARES_PER_PROJECT` is the other axis and they are not the
    same limit.
    """
    cap = limits_for("team").shared_projects
    assert cap is not None, "the team tier stopped capping memberships"
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        # The stage's own project is the first membership.
        assert (await stage.grant()).status_code == 201
        for index in range(cap - 1):
            project_id = await stage.another_project(f"Filler {index}")
            response = await stage.grant_project(project_id)
            assert response.status_code == 201, f"membership {index + 2}: {response.text}"

        one_too_many = await stage.another_project("One too many")
        refused = await stage.grant_project(one_too_many)
        assert refused.status_code == 409, refused.text
        detail = refused.json()["title"]
        assert "shared projects" in detail, detail
        # Says nothing about which plan they are on or how large its allowance
        # is: the granter typed an address, and the size of somebody else's
        # allowance is not a question they asked.
        assert str(cap) not in detail and "team" not in detail.lower(), detail
    finally:
        await stage._cleanup()


async def test_a_role_change_at_the_cap_is_not_a_new_membership():
    """Re-granting an existing member spends no slot, so it must not be refused.

    The cap is checked only where a NEW share row is created. Checked before
    that branch, demoting an editor to a viewer would be impossible for exactly
    the accounts most likely to want it — the ones that are full.
    """
    cap = limits_for("team").shared_projects
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        assert (await stage.grant("editor")).status_code == 201
        for index in range(cap - 1):
            project_id = await stage.another_project(f"Filler {index}")
            assert (await stage.grant_project(project_id)).status_code == 201
        # Full. Changing the role on one they already hold is still allowed.
        again = await stage.grant("viewer")
        assert again.status_code == 201, again.text
        assert again.json()["role"] == "viewer", again.text
    finally:
        await stage._cleanup()


async def test_a_grantee_can_leave_a_project_and_free_a_slot():
    """The move that makes the cap an allowance rather than a dead end.

    Nothing but the owner could free a membership before this route existed, so
    an account at its cap had to ask, out of band, to be let out of a project
    before it could accept another.
    """
    cap = limits_for("team").shared_projects
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        assert (await stage.grant()).status_code == 201
        for index in range(cap - 1):
            project_id = await stage.another_project(f"Filler {index}")
            assert (await stage.grant_project(project_id)).status_code == 201
        blocked = await stage.another_project("Blocked")
        assert (await stage.grant_project(blocked)).status_code == 409

        async with stage.grantee_client() as grantee:
            listed = await grantee.get("/v1/shared/projects")
            assert listed.status_code == 200, listed.text
            assert len(listed.json()) == cap, listed.text
            left = await grantee.delete(f"/v1/shared/projects/{stage.project_id}")
            assert left.status_code == 204, left.text
            # Gone from their own list, not merely from the count.
            after = await grantee.get("/v1/shared/projects")
            assert [row["id"] for row in after.json()] == [
                row["id"] for row in listed.json() if row["id"] != stage.project_id
            ], after.text
            # And leaving twice is a 404, not a second success.
            assert (
                await grantee.delete(f"/v1/shared/projects/{stage.project_id}")
            ).status_code == 404

        assert (await stage.grant_project(blocked)).status_code == 201
    finally:
        await stage._cleanup()


async def test_leaving_takes_away_the_leaver_s_access_and_nobody_else_s():
    """The predicate that makes `leave` safe is `grantee_user_id == caller`.

    Without it the statement matches every grant on the project, and one
    grantee walking away removes everybody else — a person with the weakest
    role on a project able to evict all the others. Written after a mutation
    check found nothing else in this suite touching a second grantee.
    """
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        assert (await stage.grant()).status_code == 201
        second = await stage.client.post(
            f"/v1/workspace/projects/{stage.project_id}/shares",
            json={"email": stage.bystander_email, "role": "viewer"},
        )
        assert second.status_code == 201, second.text

        async with stage.grantee_client() as grantee:
            assert (
                await grantee.delete(f"/v1/shared/projects/{stage.project_id}")
            ).status_code == (204)
        async with stage.bystander_client() as bystander:
            still_there = await bystander.get(f"/v1/shared/projects/{stage.project_id}")
            assert still_there.status_code == 200, still_there.text
        # And the owner's own list agrees: one grant left, not zero.
        listed = await stage.client.get(f"/v1/workspace/projects/{stage.project_id}/shares")
        assert [row["grantee_email"] for row in listed.json()] == [stage.bystander_email], (
            listed.text
        )
    finally:
        await stage._cleanup()


async def test_leaving_a_project_nobody_shared_is_a_404_not_a_probe():
    """The grantee side must not answer "does this project id exist"."""
    stage = await _stage(granter_plan=TEAM_PLAN, grantee_plan=TEAM_PLAN)
    try:
        assert (await stage.grant()).status_code == 201
        unshared = await stage.another_project("Never shared")
        async with stage.grantee_client() as grantee:
            # A real project id in a real workspace, simply not shared with them.
            assert (await grantee.delete(f"/v1/shared/projects/{unshared}")).status_code == 404
            # And one that names nothing at all answers identically.
            assert (await grantee.delete(f"/v1/shared/projects/{uuid.uuid4()}")).status_code == 404
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
