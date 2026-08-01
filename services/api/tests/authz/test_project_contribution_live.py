"""Contributing INTO a project somebody else owns (migration 0043).

`test_project_shares_live.py` covers reading and editing what is already there.
This is the write that CREATES a row in another tenant's workspace, which session
49 deliberately did not build, and the reason it did not was accounting rather
than authorization: nothing let the owner say how much of their workspace a guest
could spend. `projects.max_artifacts` is that statement, and it is now the whole
of the accounting — see section 3.

So these cases are grouped by which wall is being tested:

1. The permission wall — the same one everything else in `shares.py` is behind.
   A viewer, a stranger, an expired grant and a revoked one each get nothing, and
   the contribution lands in the OWNER's workspace rather than the caller's.
2. The project cap — the owner's consent, including zero.
3. Which allowance the contribution spends. Since 2026-08-02 the answer is
   "the project's, and only the project's": a shared project's contents are
   outside the individual artifact allowance, so the owner's plan limit is not
   a wall a contribution can hit.
4. Concurrency — two contributors against the last slot.

Every one of them has a positive control: the same call, one condition changed,
succeeding. A refusal test that would pass against a function which refuses
everything is not a test of the refusal.
"""

import asyncio
import datetime as dt
import hashlib
import uuid

import pytest
from matrix_helpers import any_team_grantee, requires_db
from majorana_contracts import Scope
from majorana_contracts.enums import Role, ShareRole
from repo_test_helpers import delete_committed_tenants
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact, AuditLog
from majorana_api.repos import (
    AuthzError,
    NotFoundError,
    artifacts,
    projects,
    shares,
    system,
)
from majorana_api.tiers import limits_for

#: Tier gating is not what these suites are about: every one of them predates
#: the Team plan and each is pinning a different rule. A grantee that always
#: qualifies keeps them testing that rule. The gate itself is covered by
#: test_project_sharing_tier_live.py, which varies this deliberately.

pytestmark = requires_db

CODE = "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(2)\n"


class Tenant:
    def __init__(self, *, user, workspace, scope):
        self.user = user
        self.workspace = workspace
        self.scope = scope
        self.project = None


async def build_tenant(session, tag: str) -> Tenant:
    user, ws = await system.get_or_provision_user(
        session,
        workos_user_id=f"contrib-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@contrib.test",
        display_name=f"{tag} person",
    )
    scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)
    tenant = Tenant(user=user, workspace=ws, scope=scope)
    tenant.project = await projects.create_project(scope, session, name=f"{tag} project")
    return tenant


@pytest.fixture
async def pair(db):
    """Alice owns a project. Bob is an outsider with his own workspace."""
    return await build_tenant(db, "alice"), await build_tenant(db, "bob")


async def grant(db, alice, bob, role=ShareRole.EDITOR, expires_at=None):
    share, _grantee = await shares.grant_share(
        alice.scope,
        db,
        alice.project.id,
        email=bob.user.email,
        role=role,
        expires_at=expires_at,
        allowance_for=any_team_grantee,
    )
    return share


async def contribute(db, caller, project_id, *, title="Bob's circuit", code=CODE):
    return await shares.contribute_artifact(
        caller.scope,
        db,
        project_id,
        title=title,
        family="Bell",
        framework="qiskit",
        code=code,
        code_lang="python",
    )


# --------------------------------------------------------------------------- #
# 1. The permission wall
# --------------------------------------------------------------------------- #


async def test_an_editor_contributes_and_the_row_lands_in_the_owners_workspace(db, pair):
    """The positive control for every refusal below, and the point of the feature.

    The assertions that matter are not that it succeeded: they are WHERE the row
    is. An artifact created in the contributor's own workspace and merely listed
    through the grant would pass a naive version of this test and be a completely
    different feature.
    """
    alice, bob = pair
    await grant(db, alice, bob)

    access, artifact, version = await contribute(db, bob, alice.project.id)

    assert access.project_id == alice.project.id
    assert artifact.workspace_id == alice.workspace.id
    assert artifact.workspace_id != bob.workspace.id
    assert artifact.project_id == alice.project.id
    assert artifact.kept_at is not None
    assert version.code == CODE

    # Alice sees it in her own project without any share machinery.
    hers = await artifacts.list_artifacts(alice.scope, db, project_id=alice.project.id)
    assert artifact.id in {row.id for row, _meta in hers}

    # Bob's own Vault is untouched: he spent nothing of his own.
    his = await artifacts.list_artifacts(bob.scope, db)
    assert artifact.id not in {row.id for row, _meta in his}


async def test_a_viewer_cannot_contribute(db, pair):
    """And it must be the EXPLICIT gate that says so, not the role mapping.

    Two independent defences refuse a viewer here: `contribute_artifact`'s own
    `may_edit` check, and `_elevated` mapping VIEWER to `Role.VIEWER` so
    `require_write` refuses inside `create_artifact`. That redundancy is the
    design — but it means the explicit gate can be DELETED with every test still
    green, which is exactly what a mutation run found (and found in session 49
    for the same reason on the edit path).

    So this asserts which one answered. `require_write` says "role viewer cannot
    write", a sentence about a workspace role that the caller does not hold and
    that names none of the actual situation; the explicit gate says what is true.
    If this ever reads "cannot write", the first gate is gone.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.VIEWER)

    with pytest.raises(AuthzError) as refusal:
        await contribute(db, bob, alice.project.id)
    assert "shared with you read-only" in str(refusal.value)
    assert "cannot write" not in str(refusal.value)

    # Positive control: the same call with the role changed succeeds, so the
    # refusal above is about the role and not about anything else in the fixture.
    await grant(db, alice, bob, role=ShareRole.EDITOR)
    _access, artifact, _version = await contribute(db, bob, alice.project.id)
    assert artifact.workspace_id == alice.workspace.id


async def test_the_role_mapping_refuses_a_viewer_independently(db, pair):
    """The second defence, tested where the first cannot mask it.

    This is what makes the redundancy above real rather than assumed: with a
    VIEWER grant, the elevated scope alone must be unable to write. Asserted
    against `create_shared_version`, which reaches `require_write` through the
    same mapping, so if EDITOR/VIEWER were ever mapped to ADMIN/MEMBER this fails
    even though the explicit gate is untouched.
    """
    alice, bob = pair
    await grant(db, alice, bob, role=ShareRole.VIEWER)
    existing = await artifacts.create_artifact(
        alice.scope,
        db,
        slug=f"ro-{uuid.uuid4().hex[:8]}",
        title="alice's own",
        family="Bell",
        framework="qiskit",
    )
    await projects.set_artifact_project(
        alice.scope, db, existing.id, alice.project.id, workspace_artifact_limit=None
    )
    with pytest.raises(AuthzError):
        await shares.create_shared_version(
            bob.scope,
            db,
            alice.project.id,
            existing.id,
            expected_current_version_id=None,
            code="print('nope')",
            code_lang="python",
        )


async def test_no_grant_at_all_is_a_not_found(db, pair):
    alice, bob = pair
    with pytest.raises(NotFoundError):
        await contribute(db, bob, alice.project.id)


async def test_an_expired_grant_cannot_contribute(db, pair):
    """Staged the way the read side stages it: granted live, then moved past.

    `grant_share` refuses an expiry already in the past, so an expired grant can
    only be reached by ageing a live one — which is also how a real one expires.
    """
    alice, bob = pair
    share = await grant(
        db, alice, bob, expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
    )
    _access, artifact, _version = await contribute(db, bob, alice.project.id, title="while live")
    assert artifact.project_id == alice.project.id

    share.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
    await db.flush()

    with pytest.raises(NotFoundError):
        await contribute(db, bob, alice.project.id, title="after expiry")


async def test_a_revoked_grant_cannot_contribute(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    await contribute(db, bob, alice.project.id)  # works while the grant is live
    await shares.revoke_share(alice.scope, db, alice.project.id, grantee_user_id=bob.user.id)
    with pytest.raises(NotFoundError):
        await contribute(db, bob, alice.project.id)


async def test_a_grant_on_one_project_cannot_contribute_to_another(db, pair):
    """The binding check, from the write side.

    `_bound_artifact` proves a READ names an artifact inside the shared project.
    This is the same question for a create: a second project in the same
    workspace must be unreachable with a grant on the first.
    """
    alice, bob = pair
    other = await projects.create_project(alice.scope, db, name="alice second project")
    await grant(db, alice, bob)

    with pytest.raises(NotFoundError):
        await contribute(db, bob, other.id)

    assert not await artifacts.list_artifacts(alice.scope, db, project_id=other.id)


async def test_the_contribution_claims_no_verification_and_names_its_author(db, pair):
    """Bytes a person typed are not evidence, and the owner must be able to tell.

    Same rule as `create_shared_version` and `copy_shared_artifact`: evidence
    belongs to the execution that earned it. A contribution arriving verified
    would let an outsider write a PASS verdict into another tenant's project.
    """
    alice, bob = pair
    await grant(db, alice, bob)
    _access, _artifact, version = await contribute(db, bob, alice.project.id)

    summary = version.artifact_metadata["verification_summary"]
    assert summary["verified"] is False
    assert summary["decision"] is None
    assert summary["reason_code"] == "contributed_to_shared_project_not_verified"
    assert version.artifact_metadata["contributed_by_user_id"] == str(bob.user.id)
    assert version.artifact_metadata["contributed_from_workspace_id"] == str(bob.workspace.id)
    assert version.export_status == "unsupported"


async def test_the_audit_row_is_written_against_the_owning_workspace(db, pair):
    """Alice's admins read Alice's log. A row in Bob's is a row she never sees."""
    alice, bob = pair
    await grant(db, alice, bob)
    _access, artifact, _version = await contribute(db, bob, alice.project.id)

    rows = (
        (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.workspace_id == alice.workspace.id,
                    AuditLog.action == "project_share.artifact_contributed",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].target_id == artifact.id
    assert rows[0].actor_user_id == bob.user.id
    assert rows[0].meta["contributor_workspace_id"] == str(bob.workspace.id)

    in_bobs_log = (
        (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.workspace_id == bob.workspace.id,
                    AuditLog.action == "project_share.artifact_contributed",
                )
            )
        )
        .scalars()
        .all()
    )
    assert in_bobs_log == []


# --------------------------------------------------------------------------- #
# 2. The project cap — the owner's consent
# --------------------------------------------------------------------------- #


async def test_a_new_project_resolves_to_the_platform_default(db, pair):
    alice, _bob = pair
    assert alice.project.max_artifacts is None
    assert shares.project_artifact_limit(alice.project) == shares.DEFAULT_PROJECT_ARTIFACT_LIMIT


async def test_the_project_cap_refuses_the_one_past_it(db, pair):
    alice, bob = pair
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=2)
    await grant(db, alice, bob)

    await contribute(db, bob, alice.project.id, title="one")
    await contribute(db, bob, alice.project.id, title="two")
    with pytest.raises(shares.ShareError) as refusal:
        await contribute(db, bob, alice.project.id, title="three")
    assert "2-circuit limit" in str(refusal.value)

    # Positive control: raising the limit lets the SAME call through, so the
    # refusal was the cap rather than anything accumulated by the two writes.
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=3)
    _access, artifact, _version = await contribute(db, bob, alice.project.id, title="three")
    assert artifact.title == "three"


async def test_a_zero_limit_means_edit_but_do_not_add(db, pair):
    """The permission an owner sharing finished work for review actually wants.

    The limit is set AFTER the work is filed, which is both the real sequence —
    fill a project, then freeze it — and the only one available since 2026-08-02:
    the per-project limit binds every path that files into the project, the
    OWNER'S included. It has to. An owner exempt from it would have an unbounded
    artifact allowance the moment they shared a project, because a shared
    project's contents are outside the individual allowance.
    """
    alice, bob = pair
    await grant(db, alice, bob)

    # ...editing what is already there still works, which is what makes zero
    # a different thing from downgrading the grant to viewer.
    existing = await artifacts.create_artifact(
        alice.scope,
        db,
        slug=f"a-{uuid.uuid4().hex[:8]}",
        title="alice's own",
        family="Bell",
        framework="qiskit",
    )
    await artifacts.create_version(
        alice.scope,
        db,
        existing.id,
        qasm_version=None,
        qasm=None,
        code="print(1)",
        code_lang="python",
        fingerprint=f"f-{uuid.uuid4().hex[:8]}",
        export_status="unsupported",
    )
    existing = await projects.set_artifact_project(
        alice.scope, db, existing.id, alice.project.id, workspace_artifact_limit=None
    )
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=0)

    with pytest.raises(shares.ShareError) as refusal:
        await contribute(db, bob, alice.project.id)
    assert "does not accept new circuits" in str(refusal.value)

    _access, _artifact, version = await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        existing.id,
        expected_current_version_id=existing.current_version_id,
        code="print(2)",
        code_lang="python",
    )
    assert version.code == "print(2)"

    # And the owner is bound by the same zero. Without this the exemption above
    # would be an unbounded allowance rather than a frozen project.
    another = await artifacts.create_artifact(
        alice.scope,
        db,
        slug=f"a2-{uuid.uuid4().hex[:8]}",
        title="alice's second",
        family="Bell",
        framework="qiskit",
    )
    with pytest.raises(artifacts.ProjectFull):
        await projects.set_artifact_project(
            alice.scope, db, another.id, alice.project.id, workspace_artifact_limit=None
        )


async def test_the_cap_counts_only_what_the_project_actually_holds(db, pair):
    """Deleted, unkept and ungrouped artifacts are not the project's contents.

    The count and the listing must describe the same set. If the cap counted rows
    the grantee cannot see, a project would refuse contributions while looking
    empty — which is a refusal nobody can act on.
    """
    alice, bob = pair
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=1)
    await grant(db, alice, bob)

    # Two artifacts in Alice's workspace that must not count: one filed nowhere,
    # one filed in the project and then soft-deleted.
    loose = await artifacts.create_artifact(
        alice.scope,
        db,
        slug=f"loose-{uuid.uuid4().hex[:8]}",
        title="ungrouped",
        family="Bell",
        framework="qiskit",
    )
    assert loose.project_id is None
    doomed = await artifacts.create_artifact(
        alice.scope,
        db,
        slug=f"gone-{uuid.uuid4().hex[:8]}",
        title="deleted",
        family="Bell",
        framework="qiskit",
    )
    await projects.set_artifact_project(
        alice.scope, db, doomed.id, alice.project.id, workspace_artifact_limit=None
    )
    await artifacts.soft_delete_artifact(alice.scope, db, doomed.id)

    _access, artifact, _version = await contribute(db, bob, alice.project.id)
    assert artifact.project_id == alice.project.id

    # Asserted through `get_shared_project`, which is what the grantee's page
    # actually calls. A dedicated counting helper would be a second place for
    # these predicates to be written, and a test of a function the product does
    # not use proves nothing about the product.
    header = await shares.get_shared_project(bob.scope, db, alice.project.id)
    assert (header.artifact_count, header.artifact_limit) == (1, 1)


async def test_the_grantee_can_read_the_room_before_writing(db, pair):
    """Through the header the page renders, not through a helper written for a test.

    The count and the limit have to reach the grantee BEFORE they type something
    and lose it to a 409, and they arrive on the same resource that names the
    project — so the number the button is derived from is the number the refusal
    is computed from.
    """
    alice, bob = pair
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=7)
    await grant(db, alice, bob)
    header = await shares.get_shared_project(bob.scope, db, alice.project.id)
    assert (header.artifact_count, header.artifact_limit) == (0, 7)

    _access, _artifact, _version = await contribute(db, bob, alice.project.id)
    header = await shares.get_shared_project(bob.scope, db, alice.project.id)
    assert (header.artifact_count, header.artifact_limit) == (1, 7)

    # And the LIST the sidebar renders agrees with the header the page renders.
    listed = [row for row in await shares.list_shared_projects(bob.scope, db)]
    assert [(r.artifact_count, r.artifact_limit) for r in listed] == [(1, 7)]


async def test_only_an_admin_of_the_owning_workspace_may_move_the_limit(db, pair):
    """A grantee raising their own ceiling would make the cap decorative.

    The elevated scope a share builds is `Role.MEMBER`, and
    `set_project_artifact_limit` requires ADMIN, so the mapping refuses this
    without a denylist. This test pins that the limit is behind ADMIN and not
    behind `require_write`, because MEMBER passes `require_write`.
    """
    alice, _bob = pair
    member = Scope(user_id=alice.user.id, workspace_id=alice.workspace.id, role=Role.MEMBER)
    with pytest.raises(AuthzError):
        await projects.set_project_artifact_limit(member, db, alice.project.id, max_artifacts=99)
    project = await projects.set_project_artifact_limit(
        alice.scope, db, alice.project.id, max_artifacts=99
    )
    assert project.max_artifacts == 99


async def test_the_limit_is_bounded_at_both_ends(db, pair):
    alice, _bob = pair
    for bad in (-1, shares.MAX_PROJECT_ARTIFACT_LIMIT + 1):
        with pytest.raises(ValueError):
            await projects.set_project_artifact_limit(
                alice.scope, db, alice.project.id, max_artifacts=bad
            )
    assert projects.MAX_PROJECT_ARTIFACT_LIMIT == shares.MAX_PROJECT_ARTIFACT_LIMIT


async def test_the_limit_is_not_reachable_across_workspaces(db, pair):
    alice, bob = pair
    await grant(db, alice, bob)
    with pytest.raises(NotFoundError):
        await projects.set_project_artifact_limit(
            bob.scope, db, alice.project.id, max_artifacts=500
        )


# --------------------------------------------------------------------------- #
# 3. Which allowance a contribution spends — and which one it stopped spending
# --------------------------------------------------------------------------- #


async def test_the_project_limit_is_the_only_wall_a_contribution_hits(db, pair):
    """The owner's plan allowance no longer bounds a contribution (2026-08-02).

    It used to, and the reason it stopped is not permissiveness. A contribution
    lands in a shared project by construction, and a shared project's contents
    are outside `count_kept_against_quota` — so comparing this write to
    `private_artifacts` compared it to a number that cannot see it. The refusal
    would have fired on the owner's unrelated private Vault.

    The wall that is left is the one the owner sets. Both halves are asserted
    here so that deleting the refusal a second time cannot pass: the project's
    own limit still refuses, and a full Vault does not.
    """
    alice, bob = pair
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=1)
    await grant(db, alice, bob)

    _access, first, _version = await contribute(db, bob, alice.project.id, title="first")
    assert first.title == "first"
    with pytest.raises(shares.ShareError) as refusal:
        await contribute(db, bob, alice.project.id, title="second")
    assert "1-circuit limit" in str(refusal.value)
    assert "plan limit" not in str(refusal.value)

    # Positive control: raising the OWNER'S project limit is what lets it in, so
    # the refusal above was the project cap and nothing else.
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=5)
    _access, second, _version = await contribute(db, bob, alice.project.id, title="second")
    assert second.title == "second"


async def test_a_full_vault_does_not_refuse_a_contribution(db, pair):
    """Alice's own Vault is at a free tier's cap; Bob's contribution still lands.

    The inverse of the test this replaces, which asserted that artifacts filed
    elsewhere in Alice's workspace spent the allowance a contribution compared
    against. Under the owner's rule they no longer meet: hers count against her
    plan, the project's do not.
    """
    alice, bob = pair
    await grant(db, alice, bob)
    free_cap = limits_for("free").private_artifacts
    held = await artifacts.count_kept_against_quota(alice.scope, db)
    for index in range(free_cap - held):
        await artifacts.create_artifact(
            alice.scope,
            db,
            slug=f"else-{index}-{uuid.uuid4().hex[:8]}",
            title=f"not in the project {index}",
            family="Bell",
            framework="qiskit",
        )
    assert await artifacts.count_kept_against_quota(alice.scope, db) == free_cap
    with pytest.raises(artifacts.ArtifactCapReached):
        # The control: Alice really is at her cap, so the contribution below is
        # not landing because the fixture failed to fill it.
        await artifacts.reserve_artifact_slot(alice.scope, db, free_cap)

    _access, artifact, _version = await contribute(db, bob, alice.project.id)
    assert artifact.workspace_id == alice.workspace.id


async def test_a_contribution_does_not_spend_the_owners_allowance(db, pair):
    """The count the cap reads must not move when a guest writes into the project."""
    alice, bob = pair
    await grant(db, alice, bob)
    before = await artifacts.count_kept_against_quota(alice.scope, db)
    vault_before = await artifacts.count_kept(alice.scope, db)

    await contribute(db, bob, alice.project.id)

    assert await artifacts.count_kept_against_quota(alice.scope, db) == before
    # ...but the Vault DOES list it. The two numbers differing by exactly this
    # row is the whole of the change, and asserting only the first would pass
    # against a version that lost the artifact entirely.
    assert await artifacts.count_kept(alice.scope, db) == vault_before + 1


# --------------------------------------------------------------------------- #
# 4. Two contributors against the last slot
# --------------------------------------------------------------------------- #


async def test_two_contributors_racing_the_last_slot_produce_one_artifact(db, pair):
    """The reason `contribute_artifact` locks the project row.

    Both callers read the count, both see room for one, and without the lock both
    insert — leaving the owner with an artifact they never consented to. Two REAL
    transactions on two connections, because a race staged inside one session is
    not a race at all.
    """
    alice, bob = pair
    carol = await build_tenant(db, "carol")
    await projects.set_project_artifact_limit(alice.scope, db, alice.project.id, max_artifacts=1)
    await grant(db, alice, bob)
    await grant(db, alice, carol)
    await db.commit()

    engine = engine_from_env()
    factory = session_factory(engine)
    project_id = alice.project.id
    outcomes: list[str] = []

    async def attempt(caller: Tenant, title: str) -> None:
        async with factory() as session:
            try:
                await shares.contribute_artifact(
                    caller.scope,
                    session,
                    project_id,
                    title=title,
                    family="Bell",
                    framework="qiskit",
                    code=CODE,
                    code_lang="python",
                )
                await session.commit()
                outcomes.append(f"wrote:{title}")
            except shares.ShareError:
                await session.rollback()
                outcomes.append(f"refused:{title}")

    try:
        await asyncio.gather(attempt(bob, "bob's"), attempt(carol, "carol's"))
        assert sorted(o.split(":")[0] for o in outcomes) == ["refused", "wrote"]

        async with factory() as session:
            held = (
                (
                    await session.execute(
                        select(Artifact).where(
                            Artifact.project_id == project_id,
                            Artifact.deleted_at.is_(None),
                            Artifact.kept_at.is_not(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(held) == 1
    finally:
        # This test COMMITS, so its rows are beyond the `db` fixture's rollback
        # and removing them is this test's job. Two suites that never mention
        # sharing broke on a CLEAN database in session 49 purely because one
        # committing test left its workspaces behind.
        await delete_committed_tenants(
            factory,
            [alice.workspace.id, bob.workspace.id, carol.workspace.id],
            [alice.user.id, bob.user.id, carol.user.id],
        )
        await engine.dispose()


# --------------------------------------------------------------------------- #
# 5. An address that matches more than one account
# --------------------------------------------------------------------------- #


async def test_an_ambiguous_email_is_refused_rather_than_guessed(db, pair):
    """`users.email` has no unique constraint, and duplicates really happen.

    Only `workos_user_id` is unique. Switching WorkOS environments mints a new
    `sub` for the same person — the reason `repos/identity_migration.py` exists —
    so one address can name two rows.

    `_user_by_email` was `.first()` with no ORDER BY, which granted to whichever
    row came back and then DISPLAYED the address, so it looked correct. The
    likely victim is the orphaned account: the grant shows in the owner's list
    and the person never sees the project.

    Refusing is the rule `identity_migration` already set for this table. Found
    by driving a share in a browser and noticing the grantee id was not the one
    the fixture had made.
    """
    alice, bob = pair
    twin, _twin_ws = await system.get_or_provision_user(
        db,
        workos_user_id=f"twin-{uuid.uuid4()}",
        email=bob.user.email.upper(),  # same address, different case and sub
        display_name="the same person, after an environment switch",
    )
    assert twin.id != bob.user.id

    with pytest.raises(shares.ShareError) as refusal:
        await shares.grant_share(
            alice.scope,
            db,
            alice.project.id,
            email=bob.user.email,
            role=ShareRole.EDITOR,
            expires_at=None,
            allowance_for=any_team_grantee,
        )
    assert "2 accounts" in str(refusal.value)

    # And nothing was granted — a refusal that still wrote a row would be worse
    # than the guess it replaced.
    assert await shares.list_shares(alice.scope, db, alice.project.id) == []


async def test_a_single_account_is_still_found_case_insensitively(db, pair):
    """The positive control. One row at the address grants exactly as before."""
    alice, bob = pair
    share, grantee = await shares.grant_share(
        alice.scope,
        db,
        alice.project.id,
        email=bob.user.email.upper(),
        role=ShareRole.EDITOR,
        expires_at=None,
        allowance_for=any_team_grantee,
    )
    assert grantee.id == bob.user.id
    assert share.grantee_user_id == bob.user.id


async def test_editing_a_contributed_circuit_and_undoing_reinstates_the_original(db, pair):
    """The round trip the fingerprint fix exists for, which nothing else covered.

    `create_version` treats the fingerprint as exact content identity and
    REINSTATES a matching row rather than writing a second one. The first draft
    mixed a `uuid7()` nonce into the contributed fingerprint, so the contribution
    and a later edit back to those exact bytes hashed differently — and the
    artifact ended up holding two versions with identical code, the thing
    reinstatement exists to prevent.

    Both writers now hash the content alone, so this is a two-version history:
    the contribution, and the edit. Undoing returns to the first.
    """
    alice, bob = pair
    await grant(db, alice, bob)
    _access, artifact, first = await contribute(db, bob, alice.project.id, code=CODE)

    edited = CODE + "FINAL_CIRCUIT.h(1)\n"
    _a, _art, second = await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        artifact.id,
        expected_current_version_id=first.id,
        code=edited,
        code_lang="python",
    )
    assert second.id != first.id

    _a, _art, undone = await shares.create_shared_version(
        bob.scope,
        db,
        alice.project.id,
        artifact.id,
        expected_current_version_id=second.id,
        code=CODE,
        code_lang="python",
    )
    assert undone.id == first.id, "returning to identical bytes must reinstate, not duplicate"

    versions = await artifacts.list_versions(alice.scope, db, artifact.id)
    assert len(versions) == 2, [v.seq for v in versions]
    assert first.fingerprint == hashlib.sha256(CODE.encode()).hexdigest()
