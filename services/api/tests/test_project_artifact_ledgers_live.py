"""Which ledger an artifact spends, against real Postgres (owner's rule, 2026-08-02).

Every test here corresponds to something that was **measured on `dev` before it
was changed**, not to something reasoned about. The four measurements, from
`scratchpad/probe_limits.py`:

| what was tried | what `dev` did |
|---|---|
| owner files 55 artifacts into their own 50-artifact project | all 55 landed |
| owner moves 6 artifacts into a SHARED project limited to 2 | all 6 landed |
| owner files 5 artifacts into a shared project | the individual count rose by 5 |
| owner shares six of their OWN projects | their shared-project count read 0 |

The rule those violate, in the owner's words:

> "free doesn't get access to project sharing. however they can still make
> projects just not share them. same 50-artifact limit applies to projects not
> shared across the board — unlimited non-shared projects can be created, but
> artifacts in nonshared projects count towards the normal artifact count. only
> artifacts in shared projects count towards the specifically shared artifact
> limit (limited by # of shared projects and the 50 artifact limit in each
> project)"

`test_project_contribution_live.py` covers the GUEST's path into a project, which
was the only path that ever enforced any of this. This file is about every other
one: the owner's own filing, moving between projects, and the count the plan cap
reads.

Committing, and therefore responsible for its own teardown — see
`delete_committed_tenants`.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, ShareRole
from repo_test_helpers import delete_committed_tenants

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import artifacts, projects, shares, system
from majorana_api.repos._project_limits import DEFAULT_PROJECT_ARTIFACT_LIMIT
from majorana_api.tiers import limits_for

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the artifact ledgers need DATABASE_URL"
)

pytestmark = requires_db

TEAM = limits_for("team")
FREE = limits_for("free")

#: Derived from the real `team` row rather than written out, for the reason
#: `matrix_helpers.any_team_grantee` gives: a hand-written `max_shared_projects=
#: None` here would exempt every grant in this file from the cap it is testing.
TEAM_ALLOWANCE = shares.ShareAllowance(
    may_receive=TEAM.project_sharing, max_shared_projects=TEAM.shared_projects
)


@pytest.fixture
async def factory():
    engine = engine_from_env()
    made = session_factory(engine)
    try:
        yield made
    finally:
        await engine.dispose()


@pytest.fixture
async def db(factory):
    async with factory() as session:
        try:
            yield session
        finally:
            await delete_committed_tenants(session)


class Tenant:
    def __init__(self, *, user, workspace, scope):
        self.user = user
        self.workspace = workspace
        self.scope = scope


async def tenant(session, tag: str) -> Tenant:
    user, ws = await system.get_or_provision_user(
        session,
        workos_user_id=f"ledger-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@ledger.test",
        display_name=f"{tag} person",
    )
    return Tenant(
        user=user,
        workspace=ws,
        scope=Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER),
    )


async def make_artifact(db, who: Tenant, *, kept: bool = True):
    return await artifacts.create_artifact(
        who.scope,
        db,
        slug=f"led-{uuid.uuid4().hex[:10]}",
        title="a circuit",
        family="Bell",
        framework="qiskit",
        kept=kept,
    )


async def share_with(db, owner: Tenant, project_id, grantee: Tenant):
    return await shares.grant_share(
        owner.scope,
        db,
        project_id,
        email=grantee.user.email,
        role=ShareRole.EDITOR,
        allowance_for=lambda _account: TEAM_ALLOWANCE,
    )


# --------------------------------------------------------------------------- #
# 1. The per-project limit binds the OWNER's own filing
# --------------------------------------------------------------------------- #


async def test_the_owner_cannot_file_past_their_own_projects_limit(db):
    """Measured on `dev`: 55 artifacts landed in a 50-artifact project.

    The limit was enforced in exactly one function, the one a guest goes
    through. Everything the owner did with their own Studio walked past it.
    """
    alice = await tenant(db, "alice")
    project = await projects.create_project(alice.scope, db, name="bounded")
    await projects.set_project_artifact_limit(alice.scope, db, project.id, max_artifacts=2)

    for _ in range(2):
        filed = await make_artifact(db, alice)
        await projects.set_artifact_project(
            alice.scope, db, filed.id, project.id, workspace_artifact_limit=None
        )

    over = await make_artifact(db, alice)
    with pytest.raises(artifacts.ProjectFull) as full:
        await projects.set_artifact_project(
            alice.scope, db, over.id, project.id, workspace_artifact_limit=None
        )
    assert full.value.held == 2
    assert full.value.limit == 2

    # Positive control: raising the limit lets the SAME artifact in, so the
    # refusal was the cap and not something the fixture accumulated.
    await projects.set_project_artifact_limit(alice.scope, db, project.id, max_artifacts=3)
    landed = await projects.set_artifact_project(
        alice.scope, db, over.id, project.id, workspace_artifact_limit=None
    )
    assert landed.project_id == project.id


async def test_the_limit_binds_a_shared_project_the_owner_fills_themselves(db):
    """Measured on `dev`: 6 artifacts moved into a project limited to 2 and shared.

    The sharpest of the four, because `contribute_artifact` was refusing a
    guest's third artifact from that exact project under a row lock while this
    call put six in. Under the owner's rule it is also the one that matters
    most: a shared project's contents spend no individual allowance, so if this
    limit does not hold, nothing bounds them at all.
    """
    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    project = await projects.create_project(alice.scope, db, name="shared and bounded")
    await projects.set_project_artifact_limit(alice.scope, db, project.id, max_artifacts=2)
    await share_with(db, alice, project.id, bob)

    landed = 0
    refused = 0
    for _ in range(6):
        artifact = await make_artifact(db, alice)
        try:
            await projects.set_artifact_project(
                alice.scope, db, artifact.id, project.id, workspace_artifact_limit=None
            )
            landed += 1
        except artifacts.ProjectFull:
            refused += 1
    assert (landed, refused) == (2, 4)


async def test_filing_an_artifact_already_in_a_project_respects_the_limit(db):
    """The second enforcement point, and the reason there have to be two.

    The project count is of KEPT artifacts, so an unkept one can be staged into
    a full project — `copy_shared_artifact` does exactly that on purpose. Keeping
    it is the moment it takes a slot, and a version of this that only guarded
    the move would let every copy walk in.
    """
    alice = await tenant(db, "alice")
    project = await projects.create_project(alice.scope, db, name="one only")
    await projects.set_project_artifact_limit(alice.scope, db, project.id, max_artifacts=1)

    first = await make_artifact(db, alice)
    await projects.set_artifact_project(
        alice.scope, db, first.id, project.id, workspace_artifact_limit=None
    )

    staged = await make_artifact(db, alice, kept=False)
    # Staging is allowed: it occupies nothing.
    await projects.set_artifact_project(
        alice.scope, db, staged.id, project.id, workspace_artifact_limit=None
    )
    with pytest.raises(artifacts.ProjectFull):
        await artifacts.keep_artifact(alice.scope, db, staged.id, workspace_artifact_limit=None)


async def test_a_project_with_no_limit_set_uses_the_default(db):
    """`max_artifacts IS NULL` is the DEFAULT, never unlimited.

    Every project predating migration 0043 reads NULL, so an unlimited reading
    would exempt exactly the oldest projects from the cap that was added for
    them.
    """
    alice = await tenant(db, "alice")
    project = await projects.create_project(alice.scope, db, name="never configured")
    assert project.max_artifacts is None
    assert shares.project_artifact_limit(project) == DEFAULT_PROJECT_ARTIFACT_LIMIT


# --------------------------------------------------------------------------- #
# 2. Which ledger the artifact spends
# --------------------------------------------------------------------------- #


async def test_artifacts_in_an_unshared_project_spend_the_individual_allowance(db):
    """The half of the rule that is unchanged, asserted so the other half cannot
    quietly take it with it."""
    alice = await tenant(db, "alice")
    project = await projects.create_project(alice.scope, db, name="mine alone")
    before = await artifacts.count_kept_against_quota(alice.scope, db)

    for _ in range(3):
        artifact = await make_artifact(db, alice)
        await projects.set_artifact_project(
            alice.scope, db, artifact.id, project.id, workspace_artifact_limit=None
        )

    assert await artifacts.count_kept_against_quota(alice.scope, db) == before + 3


async def test_sharing_a_project_takes_its_artifacts_off_the_individual_ledger(db):
    """Measured on `dev`: the count rose by 5 for artifacts in a shared project.

    Asserted in both directions in one test, because either alone passes against
    a count that is simply broken: the number moves when the grant appears, and
    the Vault total does not move at all.
    """
    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    project = await projects.create_project(alice.scope, db, name="to be shared")
    for _ in range(5):
        artifact = await make_artifact(db, alice)
        await projects.set_artifact_project(
            alice.scope, db, artifact.id, project.id, workspace_artifact_limit=None
        )

    quota_before = await artifacts.count_kept_against_quota(alice.scope, db)
    vault_before = await artifacts.count_kept(alice.scope, db)

    await share_with(db, alice, project.id, bob)

    assert await artifacts.count_kept_against_quota(alice.scope, db) == quota_before - 5
    assert await artifacts.count_kept(alice.scope, db) == vault_before, (
        "the Vault still lists them; only the allowance stopped counting them"
    )


async def test_the_allowance_refuses_on_the_quota_count_not_the_vault_total(db):
    """A workspace whose Vault is over its plan but whose quota is not still files.

    This is what makes the two counts worth being two functions. `reserve_artifact_slot`
    reading `count_kept` would refuse here, with the user looking at a Vault of
    rows the plan says they may not have — and no way to tell which.
    """
    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    project = await projects.create_project(alice.scope, db, name="shared overflow")
    await share_with(db, alice, project.id, bob)

    cap = FREE.private_artifacts
    held = await artifacts.count_kept_against_quota(alice.scope, db)
    for _ in range(cap + 5 - held):
        artifact = await make_artifact(db, alice)
        await projects.set_artifact_project(
            alice.scope, db, artifact.id, project.id, workspace_artifact_limit=None
        )

    assert await artifacts.count_kept(alice.scope, db) > cap
    assert await artifacts.count_kept_against_quota(alice.scope, db) == held
    # Refuses nothing: the quota count is what the cap reads.
    await artifacts.reserve_artifact_slot(alice.scope, db, cap)


async def test_moving_out_of_a_shared_project_spends_an_individual_slot(db):
    """The direction that stops "share, fill, unshare" being an unlimited Vault.

    Without the reservation on this branch an account could park an unbounded
    number of artifacts in a shared project and then walk them back into the
    Vault one PATCH at a time, with the cap reading a smaller number the whole
    way.
    """
    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    shared = await projects.create_project(alice.scope, db, name="shared")
    await share_with(db, alice, shared.id, bob)

    parked = await make_artifact(db, alice)
    await projects.set_artifact_project(
        alice.scope, db, parked.id, shared.id, workspace_artifact_limit=None
    )
    at_cap = await artifacts.count_kept_against_quota(alice.scope, db)

    with pytest.raises(artifacts.ArtifactCapReached) as full:
        await projects.set_artifact_project(
            alice.scope, db, parked.id, None, workspace_artifact_limit=at_cap
        )
    assert full.value.limit == at_cap

    # Positive control: one more slot and the same move goes through, so the
    # refusal was the allowance rather than the move being refused outright.
    moved = await projects.set_artifact_project(
        alice.scope, db, parked.id, None, workspace_artifact_limit=at_cap + 1
    )
    assert moved.project_id is None
    assert await artifacts.count_kept_against_quota(alice.scope, db) == at_cap + 1


async def test_moving_into_a_shared_project_is_never_refused(db):
    """It frees a slot. An account already over its cap must still be able to."""
    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    shared = await projects.create_project(alice.scope, db, name="shared")
    await share_with(db, alice, shared.id, bob)

    artifact = await make_artifact(db, alice)
    moved = await projects.set_artifact_project(
        alice.scope, db, artifact.id, shared.id, workspace_artifact_limit=0
    )
    assert moved.project_id == shared.id


async def test_a_no_op_move_spends_nothing(db):
    """Dragging a circuit onto the project it is already in, at a full project."""
    alice = await tenant(db, "alice")
    project = await projects.create_project(alice.scope, db, name="full")
    artifact = await make_artifact(db, alice)
    await projects.set_artifact_project(
        alice.scope, db, artifact.id, project.id, workspace_artifact_limit=None
    )
    await projects.set_project_artifact_limit(alice.scope, db, project.id, max_artifacts=1)

    again = await projects.set_artifact_project(
        alice.scope, db, artifact.id, project.id, workspace_artifact_limit=0
    )
    assert again.project_id == project.id


async def test_an_expired_grant_puts_the_artifacts_back_on_the_ledger(db):
    """The consequence of counting only LIVE grants, asserted rather than assumed.

    Stated in `_project_limits` and worth a test because it is the surprising
    direction: a workspace can end up over its cap without doing anything, and
    what that means is "files nothing new", not "loses rows".
    """
    import datetime as dt

    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    project = await projects.create_project(alice.scope, db, name="briefly shared")
    artifact = await make_artifact(db, alice)
    await projects.set_artifact_project(
        alice.scope, db, artifact.id, project.id, workspace_artifact_limit=None
    )
    soon = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=2)
    await shares.grant_share(
        alice.scope,
        db,
        project.id,
        email=bob.user.email,
        role=ShareRole.VIEWER,
        expires_at=soon,
        allowance_for=lambda _account: TEAM_ALLOWANCE,
    )
    await db.commit()
    while_live = await artifacts.count_kept_against_quota(alice.scope, db)

    import asyncio

    await asyncio.sleep(2.5)
    # A fresh transaction: `live_share_predicates` uses the transaction's clock,
    # so re-reading inside the same one would see the same `now()` forever.
    await db.rollback()
    assert await artifacts.count_kept_against_quota(alice.scope, db) == while_live + 1


# --------------------------------------------------------------------------- #
# 3. The shared-project cap counts both directions
# --------------------------------------------------------------------------- #


async def test_sharing_your_own_project_counts_toward_your_cap(db):
    """Measured on `dev`: six of her own projects shared, count read 0.

    So the cap was one an account could never reach by sharing its own work,
    which is the reading the owner ruled out.
    """
    alice = await tenant(db, "alice")
    assert await shares.count_shared_projects(db, alice.user.id) == 0

    for index in range(2):
        project = await projects.create_project(alice.scope, db, name=f"mine {index}")
        grantee = await tenant(db, f"grantee-{index}")
        await share_with(db, alice, project.id, grantee)

    assert await shares.count_shared_projects(db, alice.user.id) == 2


async def test_unshared_projects_are_unlimited_and_uncounted(db):
    """The other half of the owner's rule: "unlimited non-shared projects"."""
    alice = await tenant(db, "alice")
    for index in range(TEAM.shared_projects + 6):
        await projects.create_project(alice.scope, db, name=f"private {index}")
    assert await shares.count_shared_projects(db, alice.user.id) == 0
    assert len(await projects.list_projects(alice.scope, db)) == TEAM.shared_projects + 6


async def test_the_cap_refuses_the_owner_past_their_last_shared_project(db):
    """The refusal names the OWNER's account, not the grantee's."""
    alice = await tenant(db, "alice")
    for index in range(TEAM.shared_projects):
        project = await projects.create_project(alice.scope, db, name=f"shared {index}")
        grantee = await tenant(db, f"g-{index}")
        await share_with(db, alice, project.id, grantee)
    assert await shares.count_shared_projects(db, alice.user.id) == TEAM.shared_projects

    one_too_many = await projects.create_project(alice.scope, db, name="the fifth")
    extra = await tenant(db, "extra")
    with pytest.raises(shares.ShareError) as refusal:
        await share_with(db, alice, one_too_many.id, extra)
    assert "this account" in str(refusal.value)
    assert "that person" not in str(refusal.value)


async def test_a_second_grant_on_an_already_shared_project_costs_the_owner_nothing(db):
    """Otherwise an owner at their cap could not add a second reviewer.

    The check has to ask whether the project is shared BEFORE the insert; after
    it, every project is, and the second grant would be charged as a new one.
    """
    alice = await tenant(db, "alice")
    projects_made = []
    for index in range(TEAM.shared_projects):
        project = await projects.create_project(alice.scope, db, name=f"shared {index}")
        grantee = await tenant(db, f"first-{index}")
        await share_with(db, alice, project.id, grantee)
        projects_made.append(project)
    assert await shares.count_shared_projects(db, alice.user.id) == TEAM.shared_projects

    second_reviewer = await tenant(db, "second-reviewer")
    share, _grantee = await share_with(db, alice, projects_made[0].id, second_reviewer)
    assert share.project_id == projects_made[0].id
    assert await shares.count_shared_projects(db, alice.user.id) == TEAM.shared_projects


async def test_the_received_count_is_still_its_own_number(db):
    """`count_shared_project_memberships` answers what the shared-with-me list shows.

    It stopped being the cap's number and did not stop being a number: the list
    of somebody else's projects a person can open is exactly the received half.
    """
    alice = await tenant(db, "alice")
    bob = await tenant(db, "bob")
    mine = await projects.create_project(alice.scope, db, name="alice's")
    theirs = await projects.create_project(bob.scope, db, name="bob's")
    await share_with(db, alice, mine.id, bob)
    await share_with(db, bob, theirs.id, alice)

    assert await shares.count_shared_projects(db, alice.user.id) == 2
    assert await shares.count_shared_project_memberships(db, alice.user.id) == 1
    assert len(await shares.list_shared_projects(alice.scope, db)) == 1


async def test_an_unlimited_owner_is_not_capped(db):
    """The positive control every reservation in this service carries.

    Without it each cap test above also passes against a reservation that
    refuses every second caller — a cap that works by being broken.
    """
    alice = await tenant(db, "alice")
    unlimited = shares.ShareAllowance(may_receive=True, max_shared_projects=None)
    for index in range(TEAM.shared_projects + 3):
        project = await projects.create_project(alice.scope, db, name=f"unbounded {index}")
        grantee = await tenant(db, f"u-{index}")
        await shares.grant_share(
            alice.scope,
            db,
            project.id,
            email=grantee.user.email,
            role=ShareRole.VIEWER,
            allowance_for=lambda _account: unlimited,
        )
    assert await shares.count_shared_projects(db, alice.user.id) == TEAM.shared_projects + 3
