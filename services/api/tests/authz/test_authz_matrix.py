"""Authz matrix (Phase 1 step 4): every entity × every role × cross-workspace
probe against live Postgres. Scope A must never see, touch, or infer workspace
B's rows. The suite is a required CI gate — the moral replacement of the old
RLS check (05-security.md §1)."""

import pytest
from matrix_helpers import ALL_ROLES, any_team_grantee, requires_db, scope_for
from majorana_contracts import CommentTargetType
from majorana_contracts.enums import QpuRunStatus, Role, RunMode, UsageKind, VerificationMethod

from majorana_api.repos import (
    ADMIN_ROLES,
    WRITE_ROLES,
    AuthzError,
    NotFoundError,
    artifacts,
    audit,
    comments,
    folders,
    projects,
    qpu_runs,
    runs,
    shares,
    usage,
    workspaces,
)

#: Tier gating is not what these suites are about: every one of them predates
#: the Team plan and each is pinning a different rule. A grantee that always
#: qualifies keeps them testing that rule. The gate itself is covered by
#: test_project_sharing_tier_live.py, which varies this deliberately.

pytestmark = requires_db


async def test_cross_workspace_reads_rejected(db, dataset):
    a, b = dataset
    for role in ALL_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(NotFoundError):
            await artifacts.get_artifact(sa, db, b.artifact_id)
        with pytest.raises(NotFoundError):
            await artifacts.get_version(sa, db, b.version_id)
        with pytest.raises(NotFoundError):
            await runs.get_run(sa, db, b.run_id)
        with pytest.raises(NotFoundError):
            await folders.get_folder(sa, db, b.folder_id)
        with pytest.raises(NotFoundError):
            await projects.get_project(sa, db, b.project_id)
        assert await runs.list_run_events(sa, db, b.run_id) == []
        assert await runs.list_verification_records(sa, db, b.run_id) == []


async def test_cross_workspace_writes_rejected(db, dataset):
    a, b = dataset
    for role in WRITE_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(NotFoundError):
            await runs.append_run_event(sa, db, b.run_id, type="run.error", payload={})
        with pytest.raises(NotFoundError):
            await runs.update_run_status(sa, db, b.run_id, "cancelled")
        with pytest.raises(NotFoundError):
            await folders.set_run_folder(sa, db, b.run_id, b.folder_id)
        with pytest.raises(NotFoundError):
            await projects.rename_project(sa, db, b.project_id, name="taken")
        with pytest.raises(NotFoundError):
            await projects.delete_project(sa, db, b.project_id)
        with pytest.raises(NotFoundError):
            await projects.reorder_projects(sa, db, [b.project_id])
        with pytest.raises(NotFoundError):
            await projects.set_artifact_project(
                sa, db, b.artifact_id, b.project_id, workspace_artifact_limit=None
            )
        # Both halves of the filing, separately. Our OWN artifact must not be
        # filable under their project, and theirs must not be filable under
        # ours — one shared check would pass while either half leaked.
        with pytest.raises(NotFoundError):
            await projects.set_artifact_project(
                sa, db, a.artifact_id, b.project_id, workspace_artifact_limit=None
            )
        with pytest.raises(NotFoundError):
            await projects.set_artifact_project(
                sa, db, b.artifact_id, a.project_id, workspace_artifact_limit=None
            )
        with pytest.raises(NotFoundError):
            await runs.add_verification_record(
                sa, db, b.run_id, method=VerificationMethod.EXACT, result="fail"
            )
        with pytest.raises(NotFoundError):
            await artifacts.create_version(
                sa,
                db,
                b.artifact_id,
                qasm_version="3.0",
                qasm="OPENQASM 3.0;",
                code="x",
                code_lang="python",
                fingerprint="attack",
                export_status="lossless",
            )
        with pytest.raises(NotFoundError):
            await artifacts.create_artifact(
                sa,
                db,
                slug="attack-parent",
                title="x",
                family="Bell",
                framework="qiskit",
                parent_artifact_id=b.artifact_id,  # provenance edge across tenants
                kept=True,
            )
    for role in ADMIN_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(NotFoundError):
            await artifacts.set_visibility(sa, db, b.artifact_id, "public")
        with pytest.raises(NotFoundError):
            await artifacts.soft_delete_artifact(sa, db, b.artifact_id)


async def test_lists_and_aggregates_scoped(db, dataset):
    a, b = dataset
    for role in ALL_ROLES:
        sa = scope_for(a, role)
        # list_artifacts returns (artifact, current-version metadata) pairs since
        # the Vault list started carrying the evidence grade.
        assert {x.id for x, _metadata in await artifacts.list_artifacts(sa, db, limit=1000)} == {
            a.starter_artifact_id,
            a.artifact_id,
        }
        assert {r.id for r in await runs.list_runs(sa, db, limit=1000)} == {a.run_id}
        assert {f.id for f in await folders.list_folders(sa, db)} == {a.folder_id}
        assert {p.id for p in await projects.list_projects(sa, db)} == {a.project_id}
        member_ids = {m.user_id for m in await workspaces.list_members(sa, db)}
        assert set(a.users.values()) == member_ids
        assert (await workspaces.get_workspace(sa, db)).id == a.workspace_id
    import datetime as dt

    since = dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)
    sa = scope_for(a, Role.OWNER)
    assert await usage.sum_usage(sa, db, kind=UsageKind.RUN, since=since) == a.usage_quantity
    audit_ws = {row.workspace_id for row in await audit.list_audit(sa, db, limit=1000)}
    assert audit_ws == {a.workspace_id}


async def test_in_scope_access_works(db, dataset):
    """Sanity: the NotFounds above are scoping, not missing data."""
    a, _ = dataset
    sa = scope_for(a, Role.MEMBER)
    assert (await artifacts.get_artifact(sa, db, a.artifact_id)).id == a.artifact_id
    assert (await artifacts.get_version(sa, db, a.version_id)).id == a.version_id
    assert (await runs.get_run(sa, db, a.run_id)).id == a.run_id
    assert (await folders.get_folder(sa, db, a.folder_id)).id == a.folder_id
    assert (await projects.get_project(sa, db, a.project_id)).id == a.project_id
    assert (await artifacts.get_artifact(sa, db, a.artifact_id)).project_id == a.project_id
    events = await runs.list_run_events(sa, db, a.run_id)
    assert [e.seq for e in events] == [1, 2]
    event = await runs.append_run_event(sa, db, a.run_id, type="run.finished", payload={})
    assert event.seq == 3  # rolled back by the db fixture


async def test_role_gates_live(db, dataset):
    a, _ = dataset
    viewer = scope_for(a, Role.VIEWER)
    with pytest.raises(AuthzError):
        await runs.create_run(viewer, db, task_prompt="x", mode=RunMode.EXECUTE, framework="qiskit")
    with pytest.raises(AuthzError):
        await folders.create_folder(viewer, db, name="viewer cannot create")
    with pytest.raises(AuthzError):
        await folders.set_run_folder(viewer, db, a.run_id, a.folder_id)
    with pytest.raises(AuthzError):
        await projects.create_project(viewer, db, name="viewer cannot create")
    with pytest.raises(AuthzError):
        await projects.rename_project(viewer, db, a.project_id, name="viewer cannot rename")
    with pytest.raises(AuthzError):
        await projects.delete_project(viewer, db, a.project_id)
    with pytest.raises(AuthzError):
        await projects.reorder_projects(viewer, db, [a.project_id])
    with pytest.raises(AuthzError):
        await projects.set_artifact_project(
            viewer, db, a.artifact_id, None, workspace_artifact_limit=None
        )
    with pytest.raises(AuthzError):
        await runs.append_run_event(viewer, db, a.run_id, type="run.error", payload={})
    member = scope_for(a, Role.MEMBER)
    with pytest.raises(AuthzError):
        await artifacts.soft_delete_artifact(member, db, a.artifact_id)
    with pytest.raises(AuthzError):
        await audit.list_audit(member, db)


async def test_no_grant_means_no_second_door(db, dataset):
    """The share axis (migration 0042), with the dataset's zero grants.

    `repos/shares.py` is the only module in the package that can reach a row
    outside `scope.workspace_id`, so every function in it has to answer NotFound
    for every role when no grant exists — including the ones that take an id the
    caller could plausibly have seen, like their OWN artifact against somebody
    else's project.

    This is the assertion the feature makes *conditionally* false, and stating it
    here is what keeps "conditionally" honest: the condition is a row in
    `project_shares`, and `test_project_shares_live.py` is where a row exists.
    """
    a, b = dataset
    for role in ALL_ROLES:
        sa = scope_for(a, role)
        assert await shares.list_shared_projects(sa, db) == []
        with pytest.raises(NotFoundError):
            await shares.resolve_share(sa, db, b.project_id)
        with pytest.raises(NotFoundError):
            await shares.get_shared_project(sa, db, b.project_id)
        with pytest.raises(NotFoundError):
            await shares.list_shared_artifacts(sa, db, b.project_id)
        with pytest.raises(NotFoundError):
            await shares.get_shared_artifact(sa, db, b.project_id, b.artifact_id)
        with pytest.raises(NotFoundError):
            await shares.list_shared_versions(sa, db, b.project_id, b.artifact_id)
        with pytest.raises(NotFoundError):
            await shares.get_shared_version(sa, db, b.project_id, b.artifact_id, b.version_id)
        with pytest.raises(NotFoundError):
            await shares.copy_shared_artifact(sa, db, b.project_id, b.artifact_id)
        with pytest.raises(NotFoundError):
            await shares.create_shared_version(
                sa,
                db,
                b.project_id,
                b.artifact_id,
                expected_current_version_id=b.version_id,
                code="x",
                code_lang="python",
            )
        # Our own artifact against their project, and their artifact against
        # ours. Neither pairing is reachable, and one shared check would pass
        # while either half leaked — the same argument set_artifact_project's
        # probes make one axis down.
        with pytest.raises(NotFoundError):
            await shares.get_shared_artifact(sa, db, b.project_id, a.artifact_id)
        with pytest.raises(NotFoundError):
            await shares.get_shared_artifact(sa, db, a.project_id, b.artifact_id)

    for role in ADMIN_ROLES:  # the granting half binds workspace_id like everything else
        sa = scope_for(a, role)
        with pytest.raises(NotFoundError):
            await shares.list_shares(sa, db, b.project_id)
        with pytest.raises(NotFoundError):
            await shares.grant_share(
                sa,
                db,
                b.project_id,
                email="whoever@authz.test",
                role="viewer",
                allowance_for=any_team_grantee,
            )
        with pytest.raises(NotFoundError):
            await shares.revoke_share(sa, db, b.project_id, grantee_user_id=b.users[Role.OWNER])
        with pytest.raises(NotFoundError):
            await shares.revoke_all_shares(sa, db, b.project_id)


async def test_granting_is_an_admin_action(db, dataset):
    """A member can create a project; only an admin can put a door in it."""
    a, b = dataset
    for role in (Role.MEMBER, Role.VIEWER):
        sa = scope_for(a, role)
        with pytest.raises(AuthzError):
            await shares.list_shares(sa, db, a.project_id)
        with pytest.raises(AuthzError):
            await shares.grant_share(
                sa,
                db,
                a.project_id,
                email=f"b-{Role.MEMBER}@authz.test",
                role="viewer",
                allowance_for=any_team_grantee,
            )
        with pytest.raises(AuthzError):
            await shares.revoke_share(sa, db, a.project_id, grantee_user_id=b.users[Role.OWNER])
        with pytest.raises(AuthzError):
            await shares.revoke_all_shares(sa, db, a.project_id)


async def test_the_test_unscoped_query_leaks(db, dataset):
    """Prove the probes have teeth: WITHOUT the workspace predicate, workspace
    B's row IS reachable — only the repository layer stands in between. A
    deliberately-broken (predicate-dropping) implementation fails the matrix."""
    from sqlalchemy import select

    from majorana_api.orm import Artifact

    _, b = dataset
    leaked = (
        (await db.execute(select(Artifact).where(Artifact.id == b.artifact_id))).scalars().all()
    )
    assert leaked, "cross-workspace row invisible even without predicate — probes prove nothing"


async def test_the_test_forged_scope_reaches_data(db, dataset):
    """A scope whose workspace_id is forged DOES reach the other workspace:
    scope integrity is the auth layer's job (step 5), and this suite would
    catch a scope-derivation bug as a leak."""
    a, b = dataset
    forged = scope_for(b, Role.OWNER).model_copy(update={"user_id": a.users[Role.OWNER]})
    assert (await artifacts.get_artifact(forged, db, b.artifact_id)).id == b.artifact_id


async def test_hardware_runs_are_invisible_across_workspaces(db, dataset):
    """`qpu_runs` through the paths the run history and Studio read (proposal 5,
    increment 2). Workspace B's run carries counts and a backend name; for every
    role in A it is absent from the single read, from every page of the list,
    and from a fingerprint query naming B's exact circuit.

    The own-workspace assertions are the positive control: a list that returned
    nothing at all would pass every "B is absent" line below."""
    a, b = dataset
    for role in ALL_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(LookupError):
            await qpu_runs.get_record(sa, db, b.qpu_run_id)

        seen = []
        cursor = None
        while True:
            page = await qpu_runs.list_records(sa, db, cursor=cursor, limit=2)
            seen.extend(page)
            if len(page) < 2:
                break
            cursor = page[-1].id
        assert a.qpu_run_id in {row.id for row in seen}
        assert b.qpu_run_id not in {row.id for row in seen}
        assert {row.workspace_id for row in seen} == {a.workspace_id}

        assert await qpu_runs.list_records(sa, db, source_fingerprint=b.qpu_fingerprint) == []
        own = await qpu_runs.list_records(sa, db, source_fingerprint=a.qpu_fingerprint)
        assert [row.id for row in own] == [a.qpu_run_id]
        assert own[0].backend_name == "ibm_authz_a"

        # A cursor is not a way in: B's own id as the cursor still returns only
        # A's rows below it, never B's.
        after_b = await qpu_runs.list_records(sa, db, cursor=b.qpu_run_id, limit=100)
        assert {row.workspace_id for row in after_b} <= {a.workspace_id}


async def test_hardware_runs_cannot_be_moved_across_workspaces(db, dataset):
    """LookupError, not ValueError. B's run is DONE, so a transition that could
    SEE it would refuse DONE -> ERROR as an illegal move instead; only the
    workspace predicate produces "not visible" here."""
    a, b = dataset
    for role in WRITE_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(LookupError):
            await qpu_runs.transition(
                sa, db, b.qpu_run_id, QpuRunStatus.ERROR, backend_name="ibm_attack"
            )


async def test_comments_are_invisible_and_untouchable_across_workspaces(db, dataset):
    """Comments and mentions (migration 0068), through every repository entry point.

    Workspace B has a comment on its run that mentions B's member. For every role
    in A: B's thread is absent (the target check refuses before any comment is
    read), B's comment cannot be edited, deleted or replied to, a comment cannot
    be posted onto B's run, and nothing of B's reaches A's mentions inbox or A's
    list of people to mention.

    The positive control is A's own thread, read under the same roles: a list
    function that returned nothing at all would pass every "B is absent" line.
    """
    a, b = dataset
    for role in ALL_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(NotFoundError):
            await comments.list_comments(
                sa, db, target_type=CommentTargetType.RUN, target_id=b.run_id
            )
        own = await comments.list_comments(
            sa, db, target_type=CommentTargetType.RUN, target_id=a.run_id
        )
        assert [row.id for row in own.comments] == [a.comment_id]
        assert {row.workspace_id for row in own.comments} == {a.workspace_id}

        people = await comments.list_people(sa, db)
        assert {p.user_id for p in people} == set(a.users.values())

        inbox = await comments.list_mentions(sa, db, limit=100)
        assert b.comment_id not in {row.id for row in inbox.comments}
        if role == Role.MEMBER:
            assert [row.id for row in inbox.comments] == [a.comment_id]

    for role in WRITE_ROLES:
        sa = scope_for(a, role)
        with pytest.raises(NotFoundError):
            await comments.create_comment(
                sa, db, target_type=CommentTargetType.RUN, target_id=b.run_id, body="x"
            )
        # B's comment as the PARENT of a reply on A's own run: the parent is
        # looked up on this target in this workspace, so it is absent.
        with pytest.raises(NotFoundError):
            await comments.create_comment(
                sa,
                db,
                target_type=CommentTargetType.RUN,
                target_id=a.run_id,
                body="x",
                parent_id=b.comment_id,
            )
        with pytest.raises(NotFoundError):
            await comments.update_comment(sa, db, b.comment_id, body="taken")
        with pytest.raises(NotFoundError):
            await comments.delete_comment(sa, db, b.comment_id)


async def test_a_viewer_reads_comments_and_writes_none(db, dataset):
    a, _ = dataset
    viewer = scope_for(a, Role.VIEWER)
    thread = await comments.list_comments(
        viewer, db, target_type=CommentTargetType.RUN, target_id=a.run_id
    )
    assert [row.id for row in thread.comments] == [a.comment_id]
    with pytest.raises(AuthzError):
        await comments.create_comment(
            viewer, db, target_type=CommentTargetType.RUN, target_id=a.run_id, body="x"
        )
    with pytest.raises(AuthzError):
        await comments.update_comment(viewer, db, a.comment_id, body="x")
    with pytest.raises(AuthzError):
        await comments.delete_comment(viewer, db, a.comment_id)
