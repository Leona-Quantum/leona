"""RLS policy suite (ai-ops#143; docs/adr/0028-rls-defense-in-depth.md).

Proves the policies db/migrations/versions/0053_rls_defense_in_depth.py installs, the
way test_authz_matrix.py proves the repository-layer predicate: live Postgres, a
cross-workspace probe per protected table, and a positive control so a probe that
never fires cannot be mistaken for one that never leaks.

**This suite connects as `DATABASE_URL`, and that connection MUST be a non-superuser,
non-owner role equivalent to production's `majorana_api`.** `test_connecting_role_
cannot_bypass_rls` asserts this dynamically rather than trusting the CI wiring, because
a superuser or table-owner session bypasses every policy here regardless of GUC state —
see 0052's own note on testing a privilege change as a superuser, and 0053's module
docstring. `.github/workflows/ci.yml`'s `db` job creates that role before this runs;
run it locally against a database where the same is true (see the runbook section
`Connecting as app_rw`, or just `SET ROLE` to a role granted `app_rw` — see
`test_deliberately_broken_policy_is_caught` below for that exact technique used for a
different purpose).

Two data classes:

- **Live-probed (18 tables)** — every distinct join shape RLS uses (direct column;
  one hop via `artifacts`; two hops via `artifact_versions`; one hop via `runs`; one hop
  via `runs` through `agent_runs`'s shared primary key) proven against real rows from
  `rls_helpers.provision()`, with a positive control, a cross-tenant negative, and a
  fail-closed-when-unset check, for each.
- **Structurally verified (6 tables)** — `agent_steps`, `agent_llm_calls`,
  `candidate_verifications`, `candidate_semantic_reviews`,
  `candidate_verification_attempts`, `candidate_conversions`. Each uses a join shape
  already proven live on a sibling table in the same chain (agent_steps/agent_llm_calls
  are the identical one-hop-via-runs shape as run_events; the remaining four are the
  identical two-hop-via-run_candidates shape as candidate_executions), so this suite
  checks the DEPLOYED policy text names the right ancestor table and RLS is enabled,
  rather than re-deriving a full fixture chain for six more tables whose predicate
  shape has no way to differ from one already exercised with real rows. Reported as
  what it is: a structural assertion on the policy definition, not a live data probe —
  see the report to the orchestrator for the same distinction spelled out.
"""

import os

import pytest
from rls_helpers import TenantRows, provision, requires_db
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from majorana_api.db import engine_from_env, session_factory

pytestmark = requires_db

ENFORCE = "majorana.rls_enforce"
WORKSPACE = "majorana.workspace_id"

#: (table, id_column) for every table with a live-inserted row in both tenants.
#: `id_column` is the column this suite looks the row up by — the table's PK for
#: every table except `artifact_tags` (compound PK; `tag` alone is unique here
#: because the fixture writes a tenant-tagged literal) and `agent_runs` (its PK
#: IS `run_id`, it has no separate `id`).
LIVE_TABLES: tuple[tuple[str, str], ...] = (
    ("workspace_folders", "id"),
    ("projects", "id"),
    ("artifacts", "id"),
    ("artifact_versions", "id"),
    ("runs", "id"),
    ("usage_events", "id"),
    ("audit_log", "id"),
    ("qpu_runs", "id"),
    ("artifact_citations", "id"),
    ("artifact_tags", "tag"),
    ("artifact_sources", "id"),
    ("license_assertions", "id"),
    ("run_events", "id"),
    ("verification_records", "id"),
    ("agent_runs", "run_id"),
    ("run_plans", "id"),
    ("run_candidates", "id"),
    ("candidate_executions", "id"),
)

#: (table, ancestor table an EXISTS predicate must name). Verified structurally —
#: see the module docstring for why these six do not also get a data fixture.
STRUCTURAL_TABLES: tuple[tuple[str, str], ...] = (
    ("agent_steps", "runs"),
    ("agent_llm_calls", "runs"),
    ("candidate_verifications", "run_candidates"),
    ("candidate_semantic_reviews", "run_candidates"),
    ("candidate_verification_attempts", "run_candidates"),
    ("candidate_conversions", "run_candidates"),
)

#: Every table this migration protects — used by the enable/force checks below.
ALL_PROTECTED_TABLES: tuple[str, ...] = tuple(t for t, _ in LIVE_TABLES) + tuple(
    t for t, _ in STRUCTURAL_TABLES
)

#: The full classification's other three buckets (0053's docstring), asserted to
#: carry NO policy — a table moved into this list by accident, with no matching
#: change here, is exactly the regression this test exists to catch.
GLOBAL_AND_EXCLUDED_TABLES: tuple[str, ...] = (
    "users",
    "workspaces",
    "memberships",
    "jobs",
    "import_jobs",
    "import_items",
    "project_shares",
    "provider_credentials",
)


@pytest.fixture(scope="session")
def dataset():
    import asyncio

    async def _run() -> tuple[TenantRows, TenantRows]:
        engine = engine_from_env()
        try:
            return await provision(session_factory(engine))
        finally:
            await engine.dispose()

    return asyncio.run(_run())


async def _query_count(
    session_factory, *, enforce: bool, workspace_id, table: str, id_col: str, value
) -> int:
    """One fresh transaction per GUC state — no reliance on GUC carryover or reset."""
    async with session_factory() as session:
        if enforce:
            await session.execute(text(f"select set_config('{ENFORCE}', 'on', true)"))
        if workspace_id is not None:
            await session.execute(
                text(f"select set_config('{WORKSPACE}', :w, true)"), {"w": str(workspace_id)}
            )
        result = await session.execute(
            text(f"select count(*) from {table} where {id_col} = :v"), {"v": value}
        )
        await session.rollback()
        return result.scalar_one()


@pytest.fixture
def db_session_factory():
    engine = engine_from_env()
    yield session_factory(engine)


@pytest.mark.parametrize("table,id_col", LIVE_TABLES)
async def test_positive_control_own_row_visible(db_session_factory, dataset, table, id_col):
    """Sanity first, same reasoning as test_in_scope_access_works in the authz
    suite: a probe that can never see ANY row proves nothing about scoping."""
    a, _ = dataset
    a_value = getattr(a, table)
    count = await _query_count(
        db_session_factory,
        enforce=True,
        workspace_id=a.workspace_id,
        table=table,
        id_col=id_col,
        value=a_value,
    )
    assert count == 1, f"{table}: own row invisible even under the correct workspace GUC"


@pytest.mark.parametrize("table,id_col", LIVE_TABLES)
async def test_cross_tenant_row_invisible(db_session_factory, dataset, table, id_col):
    """The probe with teeth: workspace A's GUC must never reach workspace B's row."""
    a, b = dataset
    b_value = getattr(b, table)
    count = await _query_count(
        db_session_factory,
        enforce=True,
        workspace_id=a.workspace_id,
        table=table,
        id_col=id_col,
        value=b_value,
    )
    assert count == 0, f"{table}: workspace B's row leaked under workspace A's GUC"


@pytest.mark.parametrize("table,id_col", LIVE_TABLES)
async def test_fail_closed_when_workspace_guc_unset(db_session_factory, dataset, table, id_col):
    """Enforcement on, but the caller forgot to set majorana.workspace_id — the
    trap `auth/deps.py::_set_rls_context` exists to make impossible on the
    request path. Proves the DATABASE's half: zero rows, not someone else's."""
    a, _ = dataset
    a_value = getattr(a, table)
    count = await _query_count(
        db_session_factory,
        enforce=True,
        workspace_id=None,
        table=table,
        id_col=id_col,
        value=a_value,
    )
    assert count == 0, f"{table}: visible with enforcement on and no workspace GUC set"


@pytest.mark.parametrize("table,id_col", LIVE_TABLES)
async def test_default_off_matches_pre_rls_behavior(db_session_factory, dataset, table, id_col):
    """Enforcement OFF (the shipped default, production included) must reach
    BOTH tenants' rows — this is what "installing 0053 changes zero live
    behaviour" means as an assertion rather than a claim in the docstring."""
    a, b = dataset
    for value in (getattr(a, table), getattr(b, table)):
        count = await _query_count(
            db_session_factory,
            enforce=False,
            workspace_id=None,
            table=table,
            id_col=id_col,
            value=value,
        )
        assert count == 1, f"{table}: row invisible with enforcement OFF — a behaviour change"


async def test_all_protected_tables_have_rls_enabled_not_forced(db_session_factory):
    async with db_session_factory() as session:
        rows = (
            await session.execute(
                text(
                    "select relname, relrowsecurity, relforcerowsecurity from pg_class "
                    "where relnamespace = 'public'::regnamespace and relkind = 'r' "
                    "and relname = any(:names)"
                ),
                {"names": list(ALL_PROTECTED_TABLES)},
            )
        ).all()
        await session.rollback()
    found = {r.relname: r for r in rows}
    missing = set(ALL_PROTECTED_TABLES) - found.keys()
    assert not missing, f"protected table(s) not found in pg_class at all: {missing}"
    not_enabled = [t for t, r in found.items() if not r.relrowsecurity]
    assert not not_enabled, f"RLS not enabled on: {not_enabled}"
    # FORCE is a deliberate non-default here — 0053's docstring explains why. This
    # assertion is what would catch a future migration flipping it without also
    # updating that reasoning.
    forced = [t for t, r in found.items() if r.relforcerowsecurity]
    assert not forced, f"FORCE ROW LEVEL SECURITY set where 0053 deliberately left it off: {forced}"


async def test_global_and_excluded_tables_carry_no_policy(db_session_factory):
    async with db_session_factory() as session:
        rows = (
            await session.execute(
                text(
                    "select relname, relrowsecurity from pg_class "
                    "where relnamespace = 'public'::regnamespace and relkind = 'r' "
                    "and relname = any(:names)"
                ),
                {"names": list(GLOBAL_AND_EXCLUDED_TABLES)},
            )
        ).all()
        await session.rollback()
    found = {r.relname: r.relrowsecurity for r in rows}
    missing = set(GLOBAL_AND_EXCLUDED_TABLES) - found.keys()
    assert not missing, f"expected-global table(s) not found: {missing}"
    enabled = [t for t, has_rls in found.items() if has_rls]
    assert not enabled, (
        f"RLS enabled on a table classified GLOBAL/excluded in 0053's docstring: {enabled} — "
        "either the classification changed and the docstring is stale, or this is a real "
        "regression that would break identity bootstrap, worker job leasing, or the shares "
        "'second door'"
    )


@pytest.mark.parametrize("table,ancestor", STRUCTURAL_TABLES)
async def test_structural_policy_shape(db_session_factory, table, ancestor):
    """Not a data probe — see the module docstring's 'structurally verified' note.
    Confirms RLS is enabled and the deployed policy's predicate actually names the
    ancestor table this suite's live probes already prove the shape for."""
    async with db_session_factory() as session:
        row = (
            await session.execute(
                text(
                    "select c.relrowsecurity, p.qual, p.with_check "
                    "from pg_class c "
                    "join pg_policies p on p.tablename = c.relname and p.schemaname = 'public' "
                    "where c.relnamespace = 'public'::regnamespace and c.relname = :t"
                ),
                {"t": table},
            )
        ).one_or_none()
        await session.rollback()
    assert row is not None, f"{table}: no RLS policy found at all"
    assert row.relrowsecurity, f"{table}: RLS not enabled"
    assert ancestor in row.qual, f"{table}: USING clause does not reference {ancestor}: {row.qual}"
    assert ancestor in row.with_check, (
        f"{table}: WITH CHECK clause does not reference {ancestor}: {row.with_check}"
    )
    assert "majorana.rls_enforce" in row.qual, f"{table}: policy has no enforcement escape hatch"


async def test_connecting_role_cannot_bypass_rls(db_session_factory):
    """The load-bearing assumption of every test above, checked rather than
    trusted: if this connection bypasses RLS, every zero-rows assertion in this
    file would also be zero rows for a policy that does not exist. Fails loudly
    instead of passing for the wrong reason."""
    async with db_session_factory() as session:
        row = (
            await session.execute(
                text(
                    "select rolname, rolsuper, rolbypassrls from pg_roles "
                    "where rolname = current_user"
                )
            )
        ).one()
        await session.rollback()
    assert not row.rolsuper, (
        f"connected as {row.rolname!r}, which IS a superuser — this suite's DATABASE_URL "
        "must point at a role equivalent to majorana_api, not the CI/migration superuser. "
        "Every assertion above is meaningless under this connection."
    )
    assert not row.rolbypassrls, (
        f"connected as {row.rolname!r}, which carries BYPASSRLS — same failure mode as "
        "SUPERUSER above: every policy in this file is invisible to this session."
    )


async def test_deliberately_broken_policy_is_caught(dataset):
    """The suite's own control: prove a weakened policy actually flips these
    assertions, so 'every test passed' cannot mean 'the probes have no teeth'.

    Requires DATABASE_URL_OWNER — a role that owns the tables (able to ALTER
    POLICY), skipped otherwise since altering a policy needs a privilege this
    suite's own non-owner connection deliberately does not have. Everything
    happens inside ONE transaction that is rolled back, using `SET LOCAL ROLE`
    to run the actual probe as the non-owner role from inside that same
    transaction — the owner session's uncommitted ALTER POLICY is visible
    there (same session), and nothing is ever committed, so no other test
    (and no window against production, since this only ever targets a test
    database) sees the weakened policy at any point.
    """
    owner_url = os.environ.get("DATABASE_URL_OWNER")
    if not owner_url:
        pytest.skip("DATABASE_URL_OWNER not set — see this test's docstring")
    # Same upgrade db.py::engine_from_env applies: a plain `postgresql://` scheme
    # resolves to the psycopg2 dialect, which is not a dependency here.
    if owner_url.startswith("postgresql://"):
        owner_url = owner_url.replace("postgresql://", "postgresql+psycopg://", 1)
    api_url = os.environ["DATABASE_URL"]
    api_role = api_url.split("://", 1)[1].split(":", 1)[0]

    a, b = dataset
    engine = create_async_engine(owner_url)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("begin"))
            await conn.execute(
                text("alter policy tenant_isolation on projects using (true) with check (true)")
            )
            await conn.execute(text(f"set local role {api_role}"))
            await conn.execute(text(f"select set_config('{ENFORCE}', 'on', true)"))
            await conn.execute(
                text(f"select set_config('{WORKSPACE}', :w, true)"), {"w": str(a.workspace_id)}
            )
            leaked = (
                await conn.execute(
                    text("select count(*) from projects where id = :v"), {"v": b.projects}
                )
            ).scalar_one()
            await conn.execute(text("reset role"))
            await conn.execute(text("rollback"))
    finally:
        await engine.dispose()

    assert leaked == 1, (
        "weakening the policy to USING(true) did not surface workspace B's row — "
        "this suite's cross-tenant assertions would not catch a real regression"
    )
