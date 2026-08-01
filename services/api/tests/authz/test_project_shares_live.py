"""Project grants against live Postgres (migration 0042).

`test_authz_matrix.py::test_no_grant_means_no_second_door` proves that with no
row in `project_shares` nothing outside a workspace can reach into it. This file
is the other half: a row EXISTS, and the question is whether it opens exactly the
door it describes and not one millimetre more.

The cases are grouped by what would go wrong, not by which function they call:

1. The grant resolves, and only for the person it names.
2. The binding check — an artifact must be IN the shared project. This is the
   whole security boundary (`shares._bound_artifact`), so it is probed with a
   sibling artifact in the same workspace, an artifact in another workspace, and
   a version belonging to a different artifact.
3. The grant confers nothing on the grantee's own surfaces: their Vault, their
   project rail and their counts are unchanged by being granted something.
4. Revocation, expiry, project deletion and workspace deletion each close it.
5. Two people editing at once.
"""

import asyncio
import datetime as dt
import uuid

import pytest
from matrix_helpers import requires_db
from repo_test_helpers import delete_committed_tenants
from majorana_contracts import Scope
from majorana_contracts.enums import Role, ShareRole
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from majorana_api.db import engine_from_env, session_factory
from majorana_api.ids import uuid7
from majorana_api.orm import ProjectShare, Workspace
from majorana_api.repos import (
    AuthzError,
    NotFoundError,
    artifacts,
    audit,
    projects,
    shares,
    system,
    workspaces,
)

#: Tier gating is not what these suites are about: every one of them predates
#: the Team plan and each is pinning a different rule. A grantee that always
#: qualifies keeps them testing that rule. The gate itself is covered by
#: test_project_sharing_tier_live.py, which varies this deliberately.
ANY_TEAM_GRANTEE = lambda _grantee: True  # noqa: E731

pytestmark = requires_db


class Tenant:
    """One workspace, its owner, and enough content to share."""

    def __init__(self, *, user, workspace, scope):
        self.user = user
        self.workspace = workspace
        self.scope = scope
        self.project = None
        self.artifact = None
        self.version = None
        self.loose_artifact = None


async def build_tenant(session, tag: str, *, with_content: bool = True) -> Tenant:
    user, ws = await system.get_or_provision_user(
        session,
        workos_user_id=f"share-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@shares.test",
        display_name=f"{tag} person",
    )
    scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)
    tenant = Tenant(user=user, workspace=ws, scope=scope)
    if not with_content:
        return tenant
    tenant.project = await projects.create_project(scope, session, name=f"{tag} project")
    tenant.artifact = await artifacts.create_artifact(
        scope,
        session,
        slug=f"share-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"{tag} circuit",
        family="Bell",
        framework="qiskit",
    )
    tenant.version = await artifacts.create_version(
        scope,
        session,
        tenant.artifact.id,
        qasm_version="3.0",
        qasm="OPENQASM 3.0;",
        code="print('shared')",
        code_lang="python",
        fingerprint=f"fp-{tag}-{uuid.uuid4().hex[:8]}",
        export_status="lossless",
    )
    await projects.set_artifact_project(scope, session, tenant.artifact.id, tenant.project.id)
    # A second artifact in the SAME workspace, filed nowhere. Everything the
    # grant must not reach is represented by this row.
    tenant.loose_artifact = await artifacts.create_artifact(
        scope,
        session,
        slug=f"loose-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"{tag} unshared circuit",
        family="Bell",
        framework="qiskit",
    )
    await artifacts.create_version(
        scope,
        session,
        tenant.loose_artifact.id,
        qasm_version="3.0",
        qasm="OPENQASM 3.0;",
        code="print('private')",
        code_lang="python",
        fingerprint=f"loose-{tag}-{uuid.uuid4().hex[:8]}",
        export_status="lossless",
    )
    return tenant


@pytest.fixture
async def pair(db):
    """Alice owns a project; Bob is a stranger with his own workspace."""
    alice = await build_tenant(db, "alice")
    bob = await build_tenant(db, "bob")
    return alice, bob


async def grant(db, alice: Tenant, bob: Tenant, role=ShareRole.VIEWER, expires_at=None):
    share, grantee = await shares.grant_share(
        alice.scope,
        db,
        alice.project.id,
        email=bob.user.email,
        role=role,
        expires_at=expires_at,
        grantee_may_receive=ANY_TEAM_GRANTEE,
    )
    assert grantee.id == bob.user.id
    return share


# --------------------------------------------------------------------------- #
# 1. The grant resolves, and only for the person it names
# --------------------------------------------------------------------------- #


async def test_a_grant_opens_the_project_for_its_grantee(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)

    access = await shares.resolve_share(bob.scope, db, alice.project.id)
    assert access.project_id == alice.project.id
    assert access.owner_workspace_id == alice.workspace.id
    assert access.owner_workspace_name == alice.workspace.name
    assert access.role is ShareRole.VIEWER
    assert access.may_edit is False

    _access, rows = await shares.list_shared_artifacts(bob.scope, db, alice.project.id)
    assert {artifact.id for artifact, _meta in rows} == {alice.artifact.id}

    _a, artifact, _metadata = await shares.get_shared_artifact(
        bob.scope, db, alice.project.id, alice.artifact.id
    )
    assert artifact.title == "alice circuit"
    _a, _artifact, version = await shares.get_shared_version(
        bob.scope, db, alice.project.id, alice.artifact.id, alice.version.id
    )
    assert version.code == "print('shared')"


async def test_the_grant_names_one_person_and_nobody_else(db, pair):
    """A third account with its own workspace sees nothing at all."""
    alice, bob = pair
    carol = await build_tenant(db, "carol", with_content=False)
    await grant(db, alice, bob)

    with pytest.raises(NotFoundError):
        await shares.resolve_share(carol.scope, db, alice.project.id)
    assert await shares.list_shared_projects(carol.scope, db) == []


async def test_the_grant_follows_the_person_not_their_workspace(db, pair):
    """Bob keeps the grant while acting in a DIFFERENT workspace of his own.

    The grant is on `grantee_user_id`, so it is Bob's to use wherever he is. What
    must NOT happen is the other members of that workspace gaining anything —
    their user id is not on the row, which `test_the_grant_names_one_person`
    covers from the other side.
    """
    alice, bob = pair
    await grant(db, alice, bob)
    second, _membership = await system.create_team_workspace(
        db, owner=bob.user, name="Bob's other team", owned_workspace_limit=None
    )
    elsewhere = Scope(user_id=bob.user.id, workspace_id=second.id, role=Role.OWNER)

    access = await shares.resolve_share(elsewhere, db, alice.project.id)
    assert access.project_id == alice.project.id


async def test_list_shares_names_the_grantee_and_the_granter(db, pair):
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    rows = await shares.list_shares(alice.scope, db, alice.project.id)
    assert len(rows) == 1
    share, grantee, granter = rows[0]
    assert share.role == "editor"
    assert grantee.email == bob.user.email
    assert granter is not None and granter.id == alice.user.id


# --------------------------------------------------------------------------- #
# 2. The binding check — THE security boundary
# --------------------------------------------------------------------------- #


async def test_a_grant_does_not_reach_a_sibling_artifact(db, pair):
    """The row that would leak if `artifact.project_id` were not compared.

    `loose_artifact` is in Alice's workspace, so the elevated scope CAN read it;
    the only thing standing between Bob and it is the project binding.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)

    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, alice.loose_artifact.id)
    with pytest.raises(NotFoundError):
        await shares.list_shared_versions(bob.scope, db, alice.project.id, alice.loose_artifact.id)
    with pytest.raises(NotFoundError):
        await shares.copy_shared_artifact(bob.scope, db, alice.project.id, alice.loose_artifact.id)
    with pytest.raises(NotFoundError):
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            alice.loose_artifact.id,
            expected_current_version_id=None,
            code="x",
            code_lang="python",
        )
    # And the starter artifact every workspace is provisioned with, for the same
    # reason: it is in Alice's workspace and in no project.
    starter = (
        await db.execute(
            select(artifacts.Artifact.id).where(
                artifacts.Artifact.workspace_id == alice.workspace.id,
                artifacts.Artifact.slug == system.starter_bell_slug(alice.workspace.id),
            )
        )
    ).scalar_one()
    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, starter)


async def test_a_grant_does_not_reach_another_workspaces_artifact(db, pair):
    """Bob's OWN artifact id, presented against Alice's shared project."""
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, bob.artifact.id)
    with pytest.raises(NotFoundError):
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            bob.artifact.id,
            expected_current_version_id=None,
            code="x",
            code_lang="python",
        )


async def test_a_version_of_another_artifact_is_not_readable(db, pair):
    """`get_version` binds the workspace, so only the artifact check stops this."""
    alice, bob = pair
    await grant(db, alice, bob)
    loose_version = (
        await db.execute(
            select(artifacts.ArtifactVersion).where(
                artifacts.ArtifactVersion.artifact_id == alice.loose_artifact.id
            )
        )
    ).scalar_one()
    with pytest.raises(NotFoundError):
        await shares.get_shared_version(
            bob.scope, db, alice.project.id, alice.artifact.id, loose_version.id
        )


async def test_an_unkept_artifact_in_a_shared_project_stays_hidden(db, pair):
    """A materialized-but-unfiled run is not part of the Vault, share or no share."""
    alice, bob = pair
    unkept = await artifacts.create_artifact(
        alice.scope,
        db,
        slug=f"unkept-{uuid.uuid4().hex[:8]}",
        title="not filed yet",
        family="Bell",
        framework="qiskit",
        kept=False,
    )
    await projects.set_artifact_project(alice.scope, db, unkept.id, alice.project.id)
    await grant(db, alice, bob)

    _access, rows = await shares.list_shared_artifacts(bob.scope, db, alice.project.id)
    assert {artifact.id for artifact, _m in rows} == {alice.artifact.id}
    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, unkept.id)


async def test_a_deleted_artifact_leaves_the_shared_view(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    await artifacts.soft_delete_artifact(alice.scope, db, alice.artifact.id)
    _access, rows = await shares.list_shared_artifacts(bob.scope, db, alice.project.id)
    assert rows == []
    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, alice.artifact.id)


async def test_an_editor_cannot_perform_admin_operations(db, pair):
    """The role mapping, stated as a fact rather than as a denylist.

    EDITOR becomes a MEMBER-level scope inside the owning workspace, so every
    `require_admin` operation refuses it — deleting an artifact, publishing one —
    without anybody maintaining a list of forbidden calls that a new function
    could be added outside of.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    access = await shares.resolve_share(bob.scope, db, alice.project.id)
    elevated = shares._elevated(access, bob.user.id)
    assert elevated.role is Role.MEMBER
    assert elevated.workspace_id == alice.workspace.id

    with pytest.raises(AuthzError):
        await artifacts.soft_delete_artifact(elevated, db, alice.artifact.id)
    with pytest.raises(AuthzError):
        await artifacts.set_visibility(elevated, db, alice.artifact.id, "public")
    with pytest.raises(AuthzError):
        await audit.list_audit(elevated, db)

    viewer_access = shares.SharedAccess(
        project_id=access.project_id,
        project_name=access.project_name,
        owner_workspace_id=access.owner_workspace_id,
        owner_workspace_name=access.owner_workspace_name,
        role=ShareRole.VIEWER,
        granted_by_user_id=access.granted_by_user_id,
        expires_at=None,
        shared_at=access.shared_at,
    )
    assert shares._elevated(viewer_access, bob.user.id).role is Role.VIEWER


async def test_a_grantee_cannot_reshare_or_manage(db, pair):
    """No transitive grants: the grant confers no authority over the project."""
    alice, bob = pair
    carol = await build_tenant(db, "carol", with_content=False)
    await grant(db, alice, bob, role=ShareRole.EDITOR)

    # Bob's own scope names his own workspace, so Alice's project is simply not
    # there — the grant gave him contents, never the container.
    with pytest.raises(NotFoundError):
        await shares.grant_share(
            bob.scope,
            db,
            alice.project.id,
            email=carol.user.email,
            role=ShareRole.VIEWER,
            grantee_may_receive=ANY_TEAM_GRANTEE,
        )
    with pytest.raises(NotFoundError):
        await shares.list_shares(bob.scope, db, alice.project.id)
    with pytest.raises(NotFoundError):
        await shares.revoke_share(bob.scope, db, alice.project.id, grantee_user_id=bob.user.id)
    with pytest.raises(NotFoundError):
        await projects.rename_project(bob.scope, db, alice.project.id, name="mine now")
    with pytest.raises(NotFoundError):
        await projects.delete_project(bob.scope, db, alice.project.id)
    with pytest.raises(NotFoundError):
        await projects.set_artifact_project(bob.scope, db, alice.artifact.id, None)


# --------------------------------------------------------------------------- #
# 3. Being granted something changes nothing about the grantee's own surfaces
# --------------------------------------------------------------------------- #


async def test_a_shared_project_never_enters_the_grantees_own_lists(db, pair):
    """The second door must not widen the first one.

    If a shared artifact appeared in Bob's own Vault list, every count, quota and
    aggregate downstream of it would silently start describing two tenants.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)

    own_artifacts = {a.id for a, _m in await artifacts.list_artifacts(bob.scope, db, limit=1000)}
    assert alice.artifact.id not in own_artifacts
    assert bob.artifact.id in own_artifacts

    own_projects = {p.id for p in await projects.list_projects(bob.scope, db)}
    assert alice.project.id not in own_projects

    with pytest.raises(NotFoundError):
        await projects.get_project(bob.scope, db, alice.project.id)
    with pytest.raises(NotFoundError):
        await artifacts.get_artifact(bob.scope, db, alice.artifact.id)
    with pytest.raises(NotFoundError):
        await artifacts.get_version(bob.scope, db, alice.version.id)

    _ws, _members, bob_kept, _runs = await workspaces.get_overview(bob.scope, db)
    # His starter, his shared-project circuit and his loose one. Three of his
    # own, and none of Alice's — the number is spelled out rather than compared
    # to a count taken before the grant, because a count that did not move is
    # also what a query returning nothing at all looks like.
    assert bob_kept == 3


async def test_the_owners_counts_are_unchanged_by_sharing(db, pair):
    alice, bob = pair
    _ws, _m, before, _r = await workspaces.get_overview(alice.scope, db)
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    _ws, _m, after, _r = await workspaces.get_overview(alice.scope, db)
    assert before == after


async def test_list_shared_projects_reports_count_and_revision(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    rows = await shares.list_shared_projects(bob.scope, db)
    assert len(rows) == 1
    row = rows[0]
    assert row.access.project_id == alice.project.id
    assert row.artifact_count == 1
    assert row.granted_by is not None and row.granted_by.email == alice.user.email
    assert row.revision >= row.project_updated_at

    detail = await shares.get_shared_project(bob.scope, db, alice.project.id)
    assert detail.artifact_count == row.artifact_count
    assert detail.revision == row.revision


async def test_the_revision_moves_when_the_contents_change(db, pair):
    """The signal a polling client uses to say "somebody else edited this"."""
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    before = (await shares.get_shared_project(bob.scope, db, alice.project.id)).revision
    await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        alice.artifact.id,
        expected_current_version_id=alice.version.id,
        code="print('edited')",
        code_lang="python",
    )
    after = (await shares.get_shared_project(bob.scope, db, alice.project.id)).revision
    assert after > before


# --------------------------------------------------------------------------- #
# 4. Every way the door closes
# --------------------------------------------------------------------------- #


async def test_revoking_closes_it_on_the_next_call(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    assert await shares.resolve_share(bob.scope, db, alice.project.id)

    await shares.revoke_share(alice.scope, db, alice.project.id, grantee_user_id=bob.user.id)

    with pytest.raises(NotFoundError):
        await shares.resolve_share(bob.scope, db, alice.project.id)
    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, alice.artifact.id)
    assert await shares.list_shared_projects(bob.scope, db) == []
    assert await shares.list_shares(alice.scope, db, alice.project.id) == []


async def test_revoking_a_grant_that_is_not_there_says_so(db, pair):
    alice, bob = pair
    with pytest.raises(NotFoundError):
        await shares.revoke_share(alice.scope, db, alice.project.id, grantee_user_id=bob.user.id)


async def test_an_expired_grant_resolves_to_nothing(db, pair):
    alice, bob = pair
    share = await grant(
        db,
        alice,
        bob,
        expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1),
    )
    assert await shares.resolve_share(bob.scope, db, alice.project.id)

    share.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
    await db.flush()

    with pytest.raises(NotFoundError):
        await shares.resolve_share(bob.scope, db, alice.project.id)
    with pytest.raises(NotFoundError):
        await shares.get_shared_artifact(bob.scope, db, alice.project.id, alice.artifact.id)
    assert await shares.list_shared_projects(bob.scope, db) == []
    # The row is still there, and the owner still sees it — an expired grant is
    # a thing you can extend, not a thing that vanished.
    assert len(await shares.list_shares(alice.scope, db, alice.project.id)) == 1


async def test_an_expiry_in_the_past_is_refused_at_the_grant(db, pair):
    alice, bob = pair
    with pytest.raises(shares.ShareError):
        await grant(
            db,
            alice,
            bob,
            expires_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1),
        )


async def test_deleting_the_project_takes_its_grants_with_it(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    await projects.delete_project(alice.scope, db, alice.project.id)

    remaining = (
        (await db.execute(select(ProjectShare).where(ProjectShare.project_id == alice.project.id)))
        .scalars()
        .all()
    )
    assert remaining == []
    with pytest.raises(NotFoundError):
        await shares.resolve_share(bob.scope, db, alice.project.id)
    # The artifact survives the project, ungrouped — and is no longer reachable
    # through a grant that no longer exists.
    survivor = await artifacts.get_artifact(alice.scope, db, alice.artifact.id)
    assert survivor.project_id is None


async def test_deleting_the_owning_workspace_closes_every_grant(db, pair):
    """Driven through `system.delete_workspace`, not by setting the column.

    Stamping `deleted_at` by hand would prove only that the resolver reads that
    column. What has to be true is that the PRODUCT's delete closes the grant,
    and that depends on a fact this test would otherwise assume: that deleting a
    workspace is a soft delete. If it ever became a hard one the grants would go
    with it by foreign key and this would still pass — but if it became a
    different soft flag, a hand-written `deleted_at` would keep passing while
    every shared project stayed readable out of a deleted tenant.
    """
    alice, bob = pair
    # A personal workspace cannot be deleted, so the share is moved onto a team
    # workspace of Alice's — which is also the realistic case for sharing.
    team, _membership = await system.create_team_workspace(
        db, owner=alice.user, name="Alice's team", owned_workspace_limit=None
    )
    team_scope = Scope(user_id=alice.user.id, workspace_id=team.id, role=Role.OWNER)
    team_project = await projects.create_project(team_scope, db, name="team project")
    team_artifact = await artifacts.create_artifact(
        team_scope,
        db,
        slug=f"team-{uuid.uuid4().hex[:8]}",
        title="team circuit",
        family="Bell",
        framework="qiskit",
    )
    await artifacts.create_version(
        team_scope,
        db,
        team_artifact.id,
        qasm_version=None,
        qasm=None,
        code="pass",
        code_lang="python",
        fingerprint=f"team-{uuid.uuid4().hex[:8]}",
        export_status="unsupported",
    )
    await projects.set_artifact_project(team_scope, db, team_artifact.id, team_project.id)
    await shares.grant_share(
        team_scope,
        db,
        team_project.id,
        email=bob.user.email,
        role=ShareRole.VIEWER,
        grantee_may_receive=ANY_TEAM_GRANTEE,
    )
    assert await shares.resolve_share(bob.scope, db, team_project.id)

    assert await system.delete_workspace(db, user=alice.user, workspace_id=team.id) is True
    await db.flush()

    with pytest.raises(NotFoundError):
        await shares.resolve_share(bob.scope, db, team_project.id)
    assert [
        row
        for row in await shares.list_shared_projects(bob.scope, db)
        if row.access.project_id == team_project.id
    ] == []
    # The row is still there — a deleted workspace is recoverable with a SQL
    # prompt, and a grant erased by the delete would not come back with it.
    assert (
        await db.execute(select(Workspace.deleted_at).where(Workspace.id == team.id))
    ).scalar_one() is not None


async def test_revoke_all_reports_what_it_closed(db, pair):
    alice, bob = pair
    carol = await build_tenant(db, "carol", with_content=False)
    await grant(db, alice, bob)
    await shares.grant_share(
        alice.scope,
        db,
        alice.project.id,
        email=carol.user.email,
        role=ShareRole.VIEWER,
        grantee_may_receive=ANY_TEAM_GRANTEE,
    )
    assert await shares.revoke_all_shares(alice.scope, db, alice.project.id) == 2
    assert await shares.revoke_all_shares(alice.scope, db, alice.project.id) == 0
    with pytest.raises(NotFoundError):
        await shares.resolve_share(bob.scope, db, alice.project.id)


# --------------------------------------------------------------------------- #
# 5. Refusals at the grant
# --------------------------------------------------------------------------- #


async def test_granting_to_yourself_is_refused(db, pair):
    alice, _bob = pair
    with pytest.raises(shares.ShareError):
        await shares.grant_share(
            alice.scope,
            db,
            alice.project.id,
            email=alice.user.email,
            role=ShareRole.VIEWER,
            grantee_may_receive=ANY_TEAM_GRANTEE,
        )


async def test_granting_to_an_existing_member_is_refused(db, pair):
    """They already have it through the front door; a grant would look revocable."""
    alice, bob = pair
    await workspaces.add_member(alice.scope, db, user_id=bob.user.id, role=Role.MEMBER)
    with pytest.raises(shares.ShareError):
        await shares.grant_share(
            alice.scope,
            db,
            alice.project.id,
            email=bob.user.email,
            role=ShareRole.VIEWER,
            grantee_may_receive=ANY_TEAM_GRANTEE,
        )


async def test_granting_to_an_unknown_address_is_a_not_found(db, pair):
    alice, _bob = pair
    with pytest.raises(NotFoundError):
        await shares.grant_share(
            alice.scope,
            db,
            alice.project.id,
            email="nobody-at-all@shares.test",
            role=ShareRole.VIEWER,
            grantee_may_receive=ANY_TEAM_GRANTEE,
        )


async def test_the_email_match_is_case_and_space_insensitive(db, pair):
    alice, bob = pair
    await shares.grant_share(
        alice.scope,
        db,
        alice.project.id,
        email=f"  {bob.user.email.upper()}  ",
        role=ShareRole.VIEWER,
        grantee_may_receive=ANY_TEAM_GRANTEE,
    )
    assert await shares.resolve_share(bob.scope, db, alice.project.id)


async def test_granting_twice_is_a_role_change_not_a_second_door(db, pair):
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.VIEWER)
    await grant(db, alice, bob, role=ShareRole.EDITOR)

    rows = await shares.list_shares(alice.scope, db, alice.project.id)
    assert len(rows) == 1
    assert (await shares.resolve_share(bob.scope, db, alice.project.id)).role is ShareRole.EDITOR


async def test_the_database_refuses_a_second_row_for_the_same_person(db, pair):
    """What actually makes "one grant per person" true under two admins at once.

    The read-then-write in `grant_share` narrows the window; this index closes
    it. Asserted directly because a test of the repository function can only ever
    exercise the narrow path.
    """
    alice, bob = pair
    await grant(db, alice, bob)
    db.add(
        ProjectShare(
            id=uuid7(),
            project_id=alice.project.id,
            grantee_user_id=bob.user.id,
            role="editor",
            granted_by_user_id=alice.user.id,
        )
    )
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_the_share_count_is_capped(db, pair):
    alice, bob = pair
    for index in range(shares.MAX_SHARES_PER_PROJECT):
        extra = await build_tenant(db, f"extra{index}", with_content=False)
        await shares.grant_share(
            alice.scope,
            db,
            alice.project.id,
            email=extra.user.email,
            role=ShareRole.VIEWER,
            grantee_may_receive=ANY_TEAM_GRANTEE,
        )
    with pytest.raises(shares.ShareError):
        await shares.grant_share(
            alice.scope,
            db,
            alice.project.id,
            email=bob.user.email,
            role=ShareRole.VIEWER,
            grantee_may_receive=ANY_TEAM_GRANTEE,
        )


# --------------------------------------------------------------------------- #
# 6. Two people editing at once
# --------------------------------------------------------------------------- #


async def test_an_editor_can_save_and_the_save_claims_nothing(db, pair):
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    _access, _artifact, version = await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        alice.artifact.id,
        expected_current_version_id=alice.version.id,
        code="print('bob was here')",
        code_lang="python",
    )
    assert version.code == "print('bob was here')"
    assert version.artifact_metadata["source"] == "shared_project_edit"
    assert version.artifact_metadata["edited_by_user_id"] == str(bob.user.id)
    assert version.artifact_metadata["verification_summary"]["verified"] is False

    # It became the artifact's current version, in ALICE's workspace.
    refreshed = await artifacts.get_artifact(alice.scope, db, alice.artifact.id)
    assert refreshed.current_version_id == version.id


async def test_a_viewer_cannot_save(db, pair):
    """Refused, and refused by the FIRST of the two gates.

    A viewer is stopped twice: `_bound_artifact`'s explicit `need_edit` check,
    and — if that were ever deleted — `require_write` inside `create_version`,
    because `_elevated` maps a viewer grant to a VIEWER scope. That redundancy is
    the design, but it also means removing the explicit check breaks no test:
    deleting it and running this whole suite leaves everything green, which is
    exactly what a mutation run reported.

    So the assertion is on WHICH gate answers. The two raise different sentences,
    and pinning the first one is what makes "two independent gates" a checkable
    claim rather than a comment. If the explicit check is ever removed the
    behaviour stays correct and this test still fails — which is the right
    outcome for a deliberate defence being quietly dropped.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.VIEWER)
    with pytest.raises(AuthzError) as caught:
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            alice.artifact.id,
            expected_current_version_id=alice.version.id,
            code="print('nope')",
            code_lang="python",
        )
    assert "read-only" in str(caught.value), (
        f"refused by {caught.value!r} — that is `require_write`, the SECOND gate. "
        "The explicit editor check in `_bound_artifact` is gone."
    )


async def test_a_stale_save_is_refused_and_names_the_winner(db, pair):
    """The lost update this whole parameter exists to prevent.

    Bob and the owner both hold version 1. The owner saves version 2. Bob's save,
    still declaring version 1, must be refused — and refused with the id of what
    actually won, because "someone else changed this" is unusable without it.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    winner = await artifacts.create_version(
        alice.scope,
        db,
        alice.artifact.id,
        qasm_version=None,
        qasm=None,
        code="print('alice saved first')",
        code_lang="python",
        fingerprint=f"alice-{uuid.uuid4().hex[:8]}",
        export_status="unsupported",
    )

    with pytest.raises(shares.VersionConflict) as caught:
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            alice.artifact.id,
            expected_current_version_id=alice.version.id,  # stale
            code="print('bob had not seen it')",
            code_lang="python",
        )
    assert caught.value.current_version_id == winner.id

    # Re-submitting with what the conflict reported IS the overwrite: it requires
    # having been handed the thing being overwritten, which is the point.
    _a, _art, saved = await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        alice.artifact.id,
        expected_current_version_id=winner.id,
        code="print('bob had not seen it')",
        code_lang="python",
    )
    assert saved.seq > winner.seq


async def test_declaring_no_version_conflicts_with_any_version(db, pair):
    """`None` is an assertion too — "this circuit was empty when I opened it"."""
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    with pytest.raises(shares.VersionConflict) as caught:
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            alice.artifact.id,
            expected_current_version_id=None,
            code="x",
            code_lang="python",
        )
    assert caught.value.current_version_id == alice.version.id


async def test_an_oversized_save_is_refused(db, pair):
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    with pytest.raises(shares.ShareError):
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            alice.artifact.id,
            expected_current_version_id=alice.version.id,
            code="x" * (shares.MAX_SHARED_CODE_CHARS + 1),
            code_lang="python",
        )


# --------------------------------------------------------------------------- #
# 7. Copying out
# --------------------------------------------------------------------------- #


async def test_a_copy_lands_in_the_callers_workspace_carrying_no_verdict(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    _access, copy = await shares.copy_shared_artifact(
        bob.scope, db, alice.project.id, alice.artifact.id
    )
    assert copy.workspace_id == bob.workspace.id
    assert copy.id != alice.artifact.id
    # Unkept: the Vault cap is enforced where an artifact is FILED, and a copy
    # that arrived already filed would walk around it.
    assert copy.kept_at is None

    version = await artifacts.get_version(bob.scope, db, copy.current_version_id)
    assert version.code == alice.version.code
    assert version.artifact_metadata["verification_summary"]["verified"] is False
    assert version.artifact_metadata["source"]["kind"] == "shared_project"
    assert "no verification evidence of its own" in version.limitations

    # Alice's row is untouched.
    original = await artifacts.get_artifact(alice.scope, db, alice.artifact.id)
    assert original.current_version_id == alice.version.id


async def test_two_copies_of_the_same_circuit_are_two_artifacts(db, pair):
    """The fingerprint is namespaced, so the second copy is not a reinstatement."""
    alice, bob = pair
    await grant(db, alice, bob)
    _a, first = await shares.copy_shared_artifact(
        bob.scope, db, alice.project.id, alice.artifact.id
    )
    _a, second = await shares.copy_shared_artifact(
        bob.scope, db, alice.project.id, alice.artifact.id
    )
    assert first.id != second.id
    assert first.current_version_id != second.current_version_id


async def test_a_copy_cannot_be_filed_into_someone_elses_project(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    with pytest.raises(NotFoundError):
        await shares.copy_shared_artifact(
            bob.scope,
            db,
            alice.project.id,
            alice.artifact.id,
            target_project_id=alice.project.id,  # Alice's, not Bob's
        )


async def test_a_copy_can_be_filed_into_the_callers_own_project(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    _a, copy = await shares.copy_shared_artifact(
        bob.scope,
        db,
        alice.project.id,
        alice.artifact.id,
        target_project_id=bob.project.id,
    )
    assert copy.project_id == bob.project.id


# --------------------------------------------------------------------------- #
# 8. The audit trail lives in the workspace that owns the project
# --------------------------------------------------------------------------- #


async def test_every_mutation_is_audited_against_the_owning_workspace(db, pair):
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        alice.artifact.id,
        expected_current_version_id=alice.version.id,
        code="print('audited')",
        code_lang="python",
    )
    await shares.copy_shared_artifact(bob.scope, db, alice.project.id, alice.artifact.id)
    await shares.revoke_share(alice.scope, db, alice.project.id, grantee_user_id=bob.user.id)

    rows = await audit.list_audit(alice.scope, db, limit=1000)
    actions = [row.action for row in rows if row.action.startswith("project_share.")]
    assert set(actions) == {
        "project_share.granted",
        "project_share.version_saved",
        "project_share.artifact_copied",
        "project_share.revoked",
    }
    for row in rows:
        assert row.workspace_id == alice.workspace.id
    # The edit is attributed to Bob, inside Alice's workspace — both halves, or
    # the log answers "somebody" and "somewhere".
    saved = next(r for r in rows if r.action == "project_share.version_saved")
    assert saved.actor_user_id == bob.user.id
    assert saved.meta["editor_workspace_id"] == str(bob.workspace.id)

    # And Bob cannot read that log: the audit trail belongs to the workspace.
    assert not [
        row
        for row in await audit.list_audit(bob.scope, db, limit=1000)
        if row.workspace_id == alice.workspace.id
    ]


# --------------------------------------------------------------------------- #
# 9. Two admins granting at the same time, in two real transactions
# --------------------------------------------------------------------------- #


async def test_two_concurrent_grants_produce_one_row(db, pair):
    """A genuine interleaving, not a simulated one.

    Everything above runs in a single rolled-back transaction, which cannot show
    what two connections do to each other. This commits a small fixture, races
    two independent sessions at it, and cleans up after itself.

    Both callers should succeed — a grant is idempotent on the person — and the
    result must be exactly one row with one of the two roles, never two doors.
    """
    alice, bob = pair
    await db.commit()  # the racers are different connections; they must see it

    engine = engine_from_env()
    factory = session_factory(engine)

    async def attempt(role: ShareRole) -> str | None:
        async with factory() as session:
            try:
                await shares.grant_share(
                    alice.scope,
                    session,
                    alice.project.id,
                    email=bob.user.email,
                    role=role,
                    grantee_may_receive=ANY_TEAM_GRANTEE,
                )
                await session.commit()
                return None
            except Exception as exc:  # reported, not swallowed
                await session.rollback()
                return f"{type(exc).__name__}: {exc}"

    try:
        outcomes = await asyncio.gather(attempt(ShareRole.VIEWER), attempt(ShareRole.EDITOR))
        async with factory() as session:
            rows = (
                (
                    await session.execute(
                        select(ProjectShare).where(ProjectShare.project_id == alice.project.id)
                    )
                )
                .scalars()
                .all()
            )
        assert [o for o in outcomes if o] == [], outcomes
        assert len(rows) == 1
        assert rows[0].role in {"viewer", "editor"}
    finally:
        # The commit above put this fixture beyond the reach of the `db`
        # fixture's rollback, so removing it is this test's job. Everything, not
        # just the shares and the project it hangs on: leaving the workspaces
        # behind is what broke two unrelated suites on a clean database, and
        # "the existing session-scoped fixture leaves rows too" is a description
        # of the same bug rather than a reason to repeat it.
        await delete_committed_tenants(
            factory,
            [alice.workspace.id, bob.workspace.id],
            [alice.user.id, bob.user.id],
        )
        await engine.dispose()
