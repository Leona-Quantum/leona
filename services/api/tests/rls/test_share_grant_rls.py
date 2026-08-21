"""The grant disjunct, proved against live Postgres (ai-ops#149; migration 0054).

`test_rls_policies.py` proves 0053: that a session in workspace B cannot reach workspace
A's rows. This suite proves the exception 0054 carves into that — a project SHARE — and,
more importantly, proves the exception is an exception rather than a hole.

**Same connecting-role requirement as its sibling.** Every assertion here is meaningless
as a superuser or as the table owner, both of which bypass RLS outright.
`test_rls_policies.py::test_connecting_role_cannot_bypass_rls` asserts that dynamically
for the whole directory and is not repeated here.

## What this suite is actually for

Two halves, and the second is the one that matters:

- **The feature still works with enforcement on.** Eleven code paths in `repos/shares.py`
  — seven reads and four writes — run here as the grantee, under
  `majorana.rls_enforce = on`, through the real repository functions rather than through
  hand-written SQL that resembles them. Every one of them failed before 0054, and the
  failure was silent: `list_shared_projects` returned zero rows and raised nothing.

- **The grant reaches ONLY what was shared.** Four negative controls, each aimed at a
  different way the disjunct could have been written too wide: a stranger, an expired
  grant, a sibling project in the same workspace, and the grantor's own audit history.
  A permissive policy passes the first half of this file and fails these.

The fail-closed control (`majorana.user_id` unset) is here for the same reason 0053's
suite has one: a disjunct that never fires and a disjunct that always fires both look
like "the tests pass" from the positive half alone.
"""

import dataclasses
import datetime as dt
import hashlib
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from rls_helpers import requires_db
from sqlalchemy import text

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import projects as projects_repo
from majorana_api.repos import shares, system

pytestmark = requires_db

GRANT_FN = "majorana_rls_shared_project_ids"


async def _arm(session, scope: Scope, *, enforce: bool = True, user_id: uuid.UUID | None = None):
    """What `repos/_base.py::set_rls_context` does, with the user GUC optionally withheld.

    Written out rather than calling `set_rls_context` so a test can arm the workspace GUC
    WITHOUT the user one — the fail-closed case, which that function cannot produce
    because it sets all three or none.
    """
    parts = [
        "set_config('majorana.rls_enforce', :enf, true)",
        "set_config('majorana.workspace_id', :ws, true)",
    ]
    params = {"enf": "on" if enforce else "off", "ws": str(scope.workspace_id)}
    if user_id is not None:
        parts.append("set_config('majorana.user_id', :uid, true)")
        params["uid"] = str(user_id)
    await session.execute(text("select " + ", ".join(parts)), params)


@dataclasses.dataclass(frozen=True)
class _Rows:
    """One tenant's ids. Only the four this suite actually probes."""

    workspace_id: uuid.UUID
    owner_user_id: uuid.UUID
    projects: uuid.UUID | None
    artifacts: uuid.UUID | None
    artifact_versions: uuid.UUID | None


class Fixture:
    """Grantor A (project + artifact + version, plus a SECOND unshared project),
    grantee B holding an editor grant on A's first project, and stranger C holding none."""

    def __init__(self, *, a, b, c, sibling_project, sibling_artifact):
        self.a = a
        self.b = b
        self.c = c
        self.sibling_project = sibling_project
        self.sibling_artifact = sibling_artifact
        self.grantor = Scope(user_id=a.owner_user_id, workspace_id=a.workspace_id, role=Role.OWNER)
        self.grantee = Scope(user_id=b.owner_user_id, workspace_id=b.workspace_id, role=Role.OWNER)
        self.stranger = Scope(user_id=c.owner_user_id, workspace_id=c.workspace_id, role=Role.OWNER)


@pytest.fixture(scope="module")
def engine():
    return engine_from_env()


@pytest.fixture(scope="module")
def sf(engine):
    return session_factory(engine)


async def _tenant(session, tag: str):
    """One workspace with one owner. Deliberately NOT `rls_helpers.provision`.

    `provision` builds a row in all 24 protected tables, which is what its own suite
    needs and more than this one does — and two of those inserts are the problem:
    `artifact_tags` is keyed on a per-tenant literal, and `test_rls_policies.py
    ::test_default_off_matches_pre_rls_behavior` asserts it finds EXACTLY ONE row for
    that literal. This suite's fixture is function-scoped (its tests expire grants and
    leave projects, so they cannot share one), so calling `provision` here would insert
    that same tag once per test and fail a sibling suite in the same CI step — a suite
    this file did not touch and whose failure would read as a policy regression.

    So: four rows, built through the repository layer, and nothing that another suite
    counts.
    """
    user, ws = await system.get_or_provision_user(
        session,
        workos_user_id=f"rls-share-{tag}-{uuid.uuid4()}",
        email=f"rls-share-{tag}-{uuid.uuid4().hex[:8]}@rls.test",
    )
    return user, ws


@pytest.fixture
async def fx(sf) -> Fixture:
    async with sf() as s:
        a_user, a_ws = await _tenant(s, "grantor")
        b_user, b_ws = await _tenant(s, "grantee")
        # A third tenant, holding no grant on anything. "Workspace B sees nothing" is a
        # weaker control than "a user who is a grantee of NOTHING sees nothing".
        c_user, c_ws = await _tenant(s, "stranger")

        grantor = Scope(user_id=a_user.id, workspace_id=a_ws.id, role=Role.OWNER)

        project = await projects_repo.create_project(grantor, s, name="shared project")
        artifact = await artifacts_repo.create_artifact(
            grantor,
            s,
            slug=f"shared-{uuid.uuid4().hex[:10]}",
            title="shared circuit",
            family="Bell",
            framework="qiskit",
            project_id=project.id,
            kept=True,
        )
        version = await artifacts_repo.create_version(
            grantor,
            s,
            artifact.id,
            qasm_version="3.0",
            qasm="OPENQASM 3.0;",
            code="pass",
            code_lang="python",
            fingerprint=hashlib.sha256(f"shared-{artifact.id}".encode()).hexdigest(),
            export_status="lossless",
        )

        # A SECOND project in the SAME workspace, holding its own artifact. Nothing is
        # ever granted on it: it is what proves the disjunct keys on the PROJECT rather
        # than on the grantor's workspace.
        sibling_project = await projects_repo.create_project(grantor, s, name="unshared sibling")
        sibling_artifact = await artifacts_repo.create_artifact(
            grantor,
            s,
            slug=f"sibling-{uuid.uuid4().hex[:10]}",
            title="not shared",
            family="Bell",
            framework="qiskit",
            project_id=sibling_project.id,
            kept=True,
        )

        await s.execute(
            text(
                "insert into project_shares (id, project_id, grantee_user_id, role, "
                "granted_by_user_id, expires_at) "
                "values (:id, :pid, :gid, 'editor', :by, null)"
            ),
            {"id": uuid.uuid4(), "pid": project.id, "gid": b_user.id, "by": a_user.id},
        )
        await s.commit()

    return Fixture(
        a=_Rows(a_ws.id, a_user.id, project.id, artifact.id, version.id),
        b=_Rows(b_ws.id, b_user.id, None, None, None),
        c=_Rows(c_ws.id, c_user.id, None, None, None),
        sibling_project=sibling_project.id,
        sibling_artifact=sibling_artifact.id,
    )


# --------------------------------------------------------------------------------------
# The mechanism itself: the helper function 0054 had to introduce, and its preconditions.
# --------------------------------------------------------------------------------------


async def test_grant_function_is_stable_security_definer_with_pinned_search_path(sf):
    """The three properties that make the function safe and non-recursive.

    A SECURITY DEFINER function runs with its owner's privileges. Without `search_path`
    pinned, a caller who can create objects can shadow an unqualified name inside it and
    have the owner execute their code — which is why this is asserted rather than assumed.
    """
    async with sf() as s:
        row = (
            await s.execute(
                text(
                    "select p.prosecdef, p.provolatile, p.proconfig "
                    "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                    "where p.proname = :fn and n.nspname = 'public'"
                ),
                {"fn": GRANT_FN},
            )
        ).first()
    assert row is not None, f"{GRANT_FN}() is missing — 0054 did not run"
    secdef, volatility, config = row
    assert secdef is True, "must be SECURITY DEFINER or the policy recursion returns"
    assert volatility == "s", "must be STABLE so the planner can hoist it out of the row loop"
    assert config and any(c.startswith("search_path=") for c in config), (
        "SECURITY DEFINER without a pinned search_path is a privilege-escalation primitive"
    )


async def test_grant_function_is_not_executable_by_public(sf):
    """It reports which projects a NAMED user holds a grant on, so PUBLIC is wrong."""
    async with sf() as s:
        acl = (
            await s.execute(
                text(
                    "select coalesce(array_to_string(p.proacl, ','), '') from pg_proc p "
                    "join pg_namespace n on n.oid = p.pronamespace "
                    "where p.proname = :fn and n.nspname = 'public'"
                ),
                {"fn": GRANT_FN},
            )
        ).scalar_one()
    # An empty ACL means "default", and the default for a function is EXECUTE to PUBLIC.
    # PUBLIC's entry is the one with an EMPTY grantee, i.e. it starts with "=" — a named
    # grantee's reads "postgres=X/postgres", which is not the same thing at all.
    assert acl, "proacl is default — the REVOKE FROM PUBLIC did not happen"
    public_entries = [e for e in acl.split(",") if e.startswith("=")]
    assert not public_entries, f"EXECUTE is still granted to PUBLIC: {acl}"


async def test_project_shares_does_not_force_row_level_security(sf):
    """0054's recursion fix DEPENDS on the owner not being bound by policies.

    `SECURITY DEFINER` breaks the `artifacts -> project_shares -> projects -> artifacts`
    cycle only because the function's owner bypasses RLS. FORCE removes that bypass, and
    the recursion — an ordinary artifact lookup failing outright — comes straight back.
    If this test is what failed for you: the fix is not to force, it is to rewrite the
    policies so the grant lookup does not read `project_shares` at all.
    """
    async with sf() as s:
        forced = (
            await s.execute(
                text(
                    "select c.relforcerowsecurity from pg_class c "
                    "join pg_namespace n on n.oid = c.relnamespace "
                    "where n.nspname = 'public' and c.relname = 'project_shares'"
                )
            )
        ).scalar_one()
    assert forced is False, (
        "FORCE ROW LEVEL SECURITY on project_shares re-enters the policy from inside "
        f"{GRANT_FN}() and restores the infinite recursion 0054 exists to avoid"
    )


# --------------------------------------------------------------------------------------
# The feature works with enforcement on. Every one of these failed before 0054.
# --------------------------------------------------------------------------------------


async def test_every_shared_read_path_returns_data_under_enforcement(sf, fx):
    """Seven reads, through the real repository functions.

    Before 0054 all seven failed, and `list_shared_projects` failed by returning an empty
    list rather than raising — which is the whole reason this suite exists.
    """
    a = fx.a
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)

        access = await shares.resolve_share(fx.grantee, s, a.projects)
        assert access.project_id == a.projects

        rows = await shares.list_shared_projects(fx.grantee, s)
        assert [r.access.project_id for r in rows] == [a.projects]

        shown = await shares.get_shared_project(fx.grantee, s, a.projects)
        assert shown.access.project_id == a.projects

        # (artifact, current-version metadata) pairs, not bare rows.
        _, listed = await shares.list_shared_artifacts(fx.grantee, s, a.projects)
        assert a.artifacts in {artifact.id for artifact, _meta in listed}

        _, artifact, _ = await shares.get_shared_artifact(fx.grantee, s, a.projects, a.artifacts)
        assert artifact.id == a.artifacts

        _, _, versions = await shares.list_shared_versions(fx.grantee, s, a.projects, a.artifacts)
        assert a.artifact_versions in {v.id for v in versions}

        _, _, version = await shares.get_shared_version(
            fx.grantee, s, a.projects, a.artifacts, a.artifact_versions
        )
        assert version.id == a.artifact_versions


async def test_every_shared_write_path_succeeds_under_enforcement(sf, fx):
    """Four writes. Each one writes an `audit_log` row into the GRANTOR's workspace.

    They are the reason `audit_log` needed BOTH a `FOR INSERT` and a `FOR SELECT` policy:
    SQLAlchemy emits `INSERT … RETURNING`, and PostgreSQL applies the SELECT policy to a
    RETURNING clause on top of the insert's own WITH CHECK.
    """
    a = fx.a
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        _, artifact, _ = await shares.get_shared_artifact(fx.grantee, s, a.projects, a.artifacts)
        _, _, saved = await shares.create_shared_version(
            fx.grantee,
            s,
            a.projects,
            a.artifacts,
            expected_current_version_id=artifact.current_version_id,
            code="print('edited through a share')",
            code_lang="python",
        )
        assert saved.artifact_id == a.artifacts
        await s.commit()

    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        _, copy = await shares.copy_shared_artifact(
            fx.grantee, s, a.projects, a.artifacts, target_project_id=None
        )
        # The copy lands in the GRANTEE's own workspace — through the ordinary tenant
        # predicate, not through the grant.
        assert copy.workspace_id == fx.grantee.workspace_id
        await s.commit()

    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        _, contributed, _ = await shares.contribute_artifact(
            fx.grantee,
            s,
            a.projects,
            title="contributed under enforcement",
            family="Bell",
            framework="qiskit",
            code="print('contributed')",
            code_lang="python",
        )
        # Created already filed into the shared project (0054) rather than filed a moment
        # later — there is no transient state in which this row belongs to no project.
        assert contributed.workspace_id == fx.grantor.workspace_id
        assert contributed.project_id == a.projects
        await s.commit()

    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        await shares.leave_shared_project(fx.grantee, s, a.projects)
        await s.commit()

    # And the grant really is gone afterwards.
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        with pytest.raises(Exception):
            await shares.resolve_share(fx.grantee, s, a.projects)


# --------------------------------------------------------------------------------------
# The negative controls. A policy written too wide passes everything above and fails here.
# --------------------------------------------------------------------------------------


async def test_a_user_with_no_grant_sees_nothing(sf, fx):
    """The stranger holds no grant on anything, and is not in the grantor's workspace."""
    a = fx.a
    async with sf() as s:
        await _arm(s, fx.stranger, user_id=fx.stranger.user_id)
        assert (await s.execute(text(f"select count(*) from {GRANT_FN}()"))).scalar_one() == 0
        for table, ident in (
            ("projects", a.projects),
            ("artifacts", a.artifacts),
            ("artifact_versions", a.artifact_versions),
        ):
            found = (
                await s.execute(
                    text(f"select count(*) from {table} where id = cast(:i as uuid)"),
                    {"i": str(ident)},
                )
            ).scalar_one()
            assert found == 0, f"a stranger reached {table} through the grant disjunct"


async def test_an_expired_grant_stops_returning_rows_at_the_database(sf, fx):
    """The clause that is a GAIN over the app layer rather than a copy of it.

    Expiry lives in `_project_limits.live_share_predicates()` today, which a future query
    can forget. In the policy it holds on every path, including one nobody has written.
    """
    a = fx.a
    async with sf() as s:
        await s.execute(
            text(
                "update project_shares set expires_at = :t "
                "where project_id = cast(:p as uuid) and grantee_user_id = cast(:g as uuid)"
            ),
            {
                "t": dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1),
                "p": str(a.projects),
                "g": str(fx.grantee.user_id),
            },
        )
        await s.commit()

    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        assert (await s.execute(text(f"select count(*) from {GRANT_FN}()"))).scalar_one() == 0
        reached = (
            await s.execute(
                text("select count(*) from artifacts where id = cast(:i as uuid)"),
                {"i": str(a.artifacts)},
            )
        ).scalar_one()
        assert reached == 0, "an expired grant still reached the shared artifact"
        # The grant ROW itself stays visible to its grantee, deliberately: that is what
        # `leave_shared_project` deletes and what the owner's admin list cleans up.
        rows = (
            await s.execute(
                text(
                    "select count(*) from project_shares where grantee_user_id = cast(:g as uuid)"
                ),
                {"g": str(fx.grantee.user_id)},
            )
        ).scalar_one()
        assert rows == 1, "an expired grant row must stay reachable by the person named on it"


async def test_a_grant_does_not_reach_a_sibling_project_in_the_same_workspace(sf, fx):
    """The property that separates 'scoped to what was shared' from 'scoped to the tenant'.

    The sibling project and its artifact live in the SAME workspace as the shared one and
    are granted to nobody. A disjunct keyed on the grantor's workspace rather than on the
    project passes every positive test above and fails this one.
    """
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        for table, ident in (
            ("projects", fx.sibling_project),
            ("artifacts", fx.sibling_artifact),
        ):
            found = (
                await s.execute(
                    text(f"select count(*) from {table} where id = cast(:i as uuid)"),
                    {"i": str(ident)},
                )
            ).scalar_one()
            assert found == 0, f"the grant reached an unshared {table} in the grantor's workspace"


async def test_the_grantee_cannot_read_the_grantors_audit_history(sf, fx):
    """`audit_log`'s new policies are narrow on purpose.

    A grantee may write the audit row their own shared edit produces, and may read that
    row back (which `INSERT … RETURNING` requires). They must not gain the grantor's log.
    """
    a = fx.a
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        _, artifact, _ = await shares.get_shared_artifact(fx.grantee, s, a.projects, a.artifacts)
        await shares.create_shared_version(
            fx.grantee,
            s,
            a.projects,
            a.artifacts,
            expected_current_version_id=artifact.current_version_id,
            code="print('audited')",
            code_lang="python",
        )
        await s.commit()

    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        mine = (
            await s.execute(
                text(
                    "select count(*) from audit_log where workspace_id = cast(:w as uuid) "
                    "and actor_user_id = cast(:u as uuid)"
                ),
                {"w": str(a.workspace_id), "u": str(fx.grantee.user_id)},
            )
        ).scalar_one()
        assert mine >= 1, "the grantee cannot read back the audit row they just wrote"

        theirs = (
            await s.execute(
                text(
                    "select count(*) from audit_log where workspace_id = cast(:w as uuid) "
                    "and actor_user_id <> cast(:u as uuid)"
                ),
                {"w": str(a.workspace_id), "u": str(fx.grantee.user_id)},
            )
        ).scalar_one()
        assert theirs == 0, "the grantee reached audit rows written by the grantor"


async def test_the_disjunct_fails_closed_when_the_user_guc_is_unset(sf, fx):
    """A session with the workspace GUC but no user GUC gets exactly pre-0054 behaviour.

    `current_setting(name, true)` is NULL when unset, and `= NULL` is never true — so the
    grant half contributes nothing rather than everything. This is the control that tells
    a disjunct which never fires apart from one which always does.
    """
    a = fx.a
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=None)
        assert (await s.execute(text(f"select count(*) from {GRANT_FN}()"))).scalar_one() == 0
        reached = (
            await s.execute(
                text("select count(*) from artifacts where id = cast(:i as uuid)"),
                {"i": str(a.artifacts)},
            )
        ).scalar_one()
        assert reached == 0, "the grant disjunct fired with no user id armed"


# --------------------------------------------------------------------------------------
# The defect 0054 fixes that has nothing to do with sharing. See the migration docstring.
# --------------------------------------------------------------------------------------


async def test_a_stale_empty_guc_is_permissive_rather_than_an_error(sf, fx):
    """`SET LOCAL` leaves `''` behind on the connection, and `''::uuid` RAISES.

    This is the shape 0053's escape hatch was built on and did not have: "a caller that
    never sets the GUCs is indistinguishable from one that does not exist" holds on a
    fresh connection and fails on a pooled one, because after any earlier transaction
    armed them, `current_setting(name, true)` returns the empty string rather than NULL.

    Reproduced against 0053 as:

        select count(*) from runs
        ERROR:  invalid input syntax for type uuid: ""

    with enforcement OFF — not a filter that failed open or closed, a statement that
    errored. The worker, `catalog_admin.py` and any operator `psql` session all depend on
    the permissive path this broke.

    The test arms the GUCs, ends that transaction, and then reads as the callers who
    never set them do.
    """
    async with sf() as s:
        await _arm(s, fx.grantee, user_id=fx.grantee.user_id)
        await s.commit()

        # Same connection, new transaction, nothing armed — exactly the worker's position
        # behind a pool. Every protected join shape, not only the simple ones.
        stale = (
            await s.execute(text("select current_setting('majorana.workspace_id', true)"))
        ).scalar_one()
        assert stale == "", (
            "this test is only meaningful when the GUC is left as an empty string; "
            f"got {stale!r} — if this is None, SET LOCAL semantics changed"
        )
        for table in (
            "runs",
            "artifacts",
            "artifact_versions",
            "audit_log",
            "candidate_executions",
        ):
            # The assertion is that this does not RAISE. A count is what a permissive
            # policy returns; the pre-0054 behaviour was an exception, not a smaller count.
            await s.execute(text(f"select count(*) from {table}"))
