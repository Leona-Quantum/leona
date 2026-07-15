"""Authz matrix (Phase 1 step 4): every entity × every role × cross-workspace
probe against live Postgres. Scope A must never see, touch, or infer workspace
B's rows. The suite is a required CI gate — the moral replacement of the old
RLS check (05-security.md §1)."""

import pytest
from matrix_helpers import ALL_ROLES, requires_db, scope_for
from majorana_contracts.enums import Role, RunMode, UsageKind, VerificationMethod

from majorana_api.repos import (
    ADMIN_ROLES,
    WRITE_ROLES,
    AuthzError,
    NotFoundError,
    artifacts,
    audit,
    folders,
    runs,
    usage,
    workspaces,
)

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
        assert {x.id for x in await artifacts.list_artifacts(sa, db, limit=1000)} == {
            a.starter_artifact_id,
            a.artifact_id,
        }
        assert {r.id for r in await runs.list_runs(sa, db, limit=1000)} == {a.run_id}
        assert {f.id for f in await folders.list_folders(sa, db)} == {a.folder_id}
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
        await runs.append_run_event(viewer, db, a.run_id, type="run.error", payload={})
    member = scope_for(a, Role.MEMBER)
    with pytest.raises(AuthzError):
        await artifacts.soft_delete_artifact(member, db, a.artifact_id)
    with pytest.raises(AuthzError):
        await audit.list_audit(member, db)


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
