"""Row-level security, as defense-in-depth behind the app layer (ai-ops#143).

Revision ID: 0053
Revises: 0052

## The ruling this migration executes

`docs/adr/0004-app-layer-authz.md` made the repository-layer `Scope` predicate the
PRIMARY and ONLY tenant-isolation control, with a stated reversal trigger: "RLS returns
as defense-in-depth before regulated-enterprise deals." Owner ruling on EshMis/ai-ops#143
fires that trigger and removes the condition: "A regulated-enterprise deal is in sight,
so begin RLS now across the tenant tables. and remove the condition, RLS is important
regardless." `docs/adr/0028-rls-defense-in-depth.md` records the decision this migration
implements; ADR-0004's status line now points at it.

RLS here is explicitly SECOND, not a replacement. The authz matrix suite
(services/api/tests/authz/test_authz_matrix.py) remains the primary, required-CI
control — 155 tests proving the repository-layer predicate — and this migration adds a
database-enforced backstop for the case that suite cannot cover by construction: an
application bug (or a future caller) that runs a query with no `Scope` predicate at all.

## Table classification — every table in orm.py, decided and written down

Deciding this per table, in writing, is the deliverable ai-ops#143 asked for as much as
the SQL is. Four classes:

**DIRECTLY SCOPED** — carries a `workspace_id` column read straight off the row (7):
  workspace_folders, projects, artifacts, runs, usage_events, audit_log, qpu_runs.
  `audit_log.workspace_id` is nullable — see its policy below.

**TRANSITIVELY SCOPED** — reached by one join to a directly-scoped table, or two to
reach one through another transitively-scoped table (17):
  artifact_versions, artifact_citations, artifact_tags        -> artifacts
  artifact_sources, license_assertions                        -> artifact_versions -> artifacts
  run_events, verification_records, agent_runs,
    agent_steps, agent_llm_calls, run_candidates              -> runs
  run_plans                                                   -> runs (agent_runs shares its PK)
  candidate_executions, candidate_verifications,
    candidate_semantic_reviews, candidate_verification_attempts,
    candidate_conversions                                     -> run_candidates -> runs

**GLOBAL / IDENTITY** — deliberately carries NO policy (3): `users`, `workspaces`,
  `memberships`. These are the tables a caller has to be able to read BEFORE a
  `workspace_id` is known at all: `auth/deps.py::get_identity` provisions a user and
  resolves their personal workspace from a bearer token alone, and
  `resolve_active_workspace` / the workspace switcher read a user's FULL membership
  list, in every workspace they belong to, to decide which one `Scope.workspace_id`
  becomes. A workspace_id-keyed policy on any of these three would break the exact code
  path that derives a workspace_id, before it exists. `workspaces` is also not "some
  workspace's data" — its row IS the tenant — so a same-shaped policy would be
  circular here in a way it is not for `artifacts` or `runs`. These three keep exactly
  the protection they have today: the app-layer `Scope` checks in `repos/system.py` and
  `repos/workspaces.py`, which is what AGENTS.md's authz invariant already requires of
  `system.py` as the one module allowed to work before a `Scope` exists.

**SYSTEM / WORKER-WIDE** — deliberately carries NO policy (3): `jobs`, `import_jobs`,
  `import_items`. The worker leases and processes `jobs` across every workspace by
  design — that is what a job queue is — and `import_jobs`/`import_items` are the
  catalog importer's own batch bookkeeping, driven by `catalog_admin.py`'s standalone
  scripts outside any request's `Scope`. Neither `import_jobs` nor `import_items` even
  carries a `workspace_id` column to key a policy on. `jobs.run_id` does point at a
  workspace-scoped row, but the worker's whole access pattern — lease the next
  runnable job, whichever workspace it belongs to — is cross-tenant by requirement, not
  by oversight, and giving it a policy would mean teaching it to set a GUC it has no
  natural single value for. It is covered instead by the escape hatch below.

**DELIBERATELY EXCLUDED, DIFFERENT SHAPE NEEDED** — two tables where a workspace_id
  policy would be actively wrong, not merely incomplete (2):
  - `project_shares` — the repository layer's OWN "second door"
    (`repos/shares.py`'s module docstring calls it exactly that): a grant lets a user
    in workspace B read a project that lives in workspace A. A policy of
    `workspace_id-of-owning-project = current GUC` would refuse the grantee's own read
    of their OWN grant, which is the feature working as designed, not a leak. Any
    future policy here has to key on `grantee_user_id` against a user-id GUC, which
    this migration does not introduce. Left as a named follow-up, not silently.

    **This exclusion's blast radius is bigger than the one table**, and is a hard
    blocker on ever setting `MAJORANA_RLS_ENFORCED`, not merely an open follow-up
    (found in review, PR 709 — Aikido). `resolve_share` and every function built on it
    (`get_shared_project`, `get_shared_artifact`, `get_shared_version`, …) deliberately
    read `projects`/`artifacts`/`artifact_versions` — all THREE of which this migration
    DOES protect — keyed on the grant, not on `scope.workspace_id`
    (`repos/shares.py:784`: *"Deliberately keyed on `scope.user_id` and not on
    `scope.workspace_id`"*). Under RLS enforcement, the grantee's session carries their
    OWN workspace_id in the GUC, and the shared project/artifact/version rows live in
    the GRANTOR's workspace — a different uuid. The repository layer's own predicate
    already permits this by design; a workspace_id-keyed RLS policy on `projects`/
    `artifacts`/`artifact_versions` does not know about grants at all, so it would
    filter every one of these rows out, silently, for every Team-tier customer using
    project sharing, the moment enforcement turns on. **Do not flip
    `MAJORANA_RLS_ENFORCED` until this is resolved** — either the shares code path
    needs a way to widen its RLS context to the grantor's workspace for the duration
    of a shared read, or these three policies need a second, grant-aware disjunct. Not
    designed here: it is a product/architecture decision (does a grantee's session get
    to look "through" a grant at the database layer, and how is that bounded so it
    cannot widen into a general cross-tenant escape) and belongs in its own reviewed
    change, not as a rider on defense-in-depth going in disabled.
  - `provider_credentials` — the ORM's own docstring is explicit that this table is
    scoped by `user_id`, deliberately NOT `workspace_id`, because a provider account
    follows the person between workspaces. A workspace_id policy would be scoping it on
    a column the design says is not the tenant boundary for this table. Same follow-up
    shape as above: a user-id GUC, not this migration's.

7 + 17 + 3 + 3 + 2 = 32, which is every table `orm.py` declares.

## The escape hatch: two GUCs, not one, and enforcement is OFF by default

Every policy below has the shape:

    current_setting('majorana.rls_enforce', true) IS DISTINCT FROM 'on'
    OR <tenant predicate>

`current_setting(name, true)` returns NULL rather than raising when the GUC was never
set — that `true` is what makes "nobody has touched this session" read as
"permissive" rather than as an error. So a session that never sets EITHER GUC —
migrations (run as `majorana_app`, the owner, which is a bypass in its own right — see
below), the worker, `catalog_admin.py`'s standalone scripts, a `psql` operator session,
this file's own `downgrade()` — behaves EXACTLY as it did before this migration ever
ran. Nothing above needed a code change to keep working, and that is deliberate: it is
the "give them an explicit, auditable escape" requirement, satisfied by construction
rather than by naming each caller. The escape is auditable because there is exactly one
function in the whole tree that sets `majorana.rls_enforce` —
`repos/_base.py::set_rls_context`, called from exactly one place,
`auth/deps.py::get_scope` — so "does this code path enforce RLS" is answered by "does
it run through `get_scope`", not by reading every call site. (The SQL lives in the
repository layer rather than in `auth/deps.py` itself because
`scripts/check_raw_queries.py` only allows raw SQL there plus `db.py`/`orm.py`.)

`majorana.rls_enforce` only becomes `'on'` when `Settings.rls_enforced` is `True`
(`settings.py`, env var `MAJORANA_RLS_ENFORCED`), and that defaults to `False`
EVERYWHERE, production included, for this PR. So this migration is safe to run against
production the moment it merges: it changes what SQL objects exist, not what any live
request returns, until a separate, deliberate flip sets the env var. That flip is
follow-up work, not part of this PR — see the ADR.

Once enforcement IS on, the fail-closed direction is real and worth stating plainly: a
caller that reaches a protected table WITHOUT `majorana.workspace_id` set (the GUC is
missing, not merely empty) evaluates `<column> = current_setting(..., true)::uuid` as
`<column> = NULL`, which is never true for any row — zero rows, not an error, not
someone else's rows. Fail-closed, but silent, which is exactly why `auth/deps.py`
documents itself as the one and only place that has to get this right.

## FORCE ROW LEVEL SECURITY: deliberately NOT set, on any table

`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is what creates the policies' bite for
everyone who is not the table owner. `FORCE ROW LEVEL SECURITY` additionally binds the
owner — `majorana_app` — to its own policies. This migration enables but does not
force, and that is a decision, not an omission:

- `majorana_app` is the migration credential and nothing else (0052's own docstring).
  It never serves a request, never calls `auth/deps.py`, and therefore never has a
  `workspace_id` GUC to be bound by. FORCE would not add a control against a caller
  that does not exist; it would only make an already-permissive-by-construction
  session ALSO evaluate the permissive branch of every policy on every statement, for
  no behavioural difference, since the GUC state is identical either way (unset).
- It genuinely would cost something if a future backfill or an operator's `psql`
  session, connected as `majorana_app` for exactly the reason that role exists — DDL
  and cross-tenant maintenance — needed to read or repair a row across workspaces.
  FORCE would require that session to also set the GUCs it has no natural single value
  for, the same objection the `jobs` table classification makes above, just for people
  instead of the worker.
- `majorana_api` — the role that DOES serve requests — is not the owner of any of
  these tables (0052: `app_rw` holds `SELECT/INSERT/UPDATE/DELETE`, never ownership),
  so it is bound by every policy below regardless of FORCE. FORCE only ever changes
  what the OWNER experiences, and the owner is not on the request path.

If that ever stops being true — if `majorana_app` (or anything with ownership-level
access) is ever put on a request path — this reasoning needs revisiting, and FORCE
becomes the missing control at that point, not before.

## BYPASSRLS, re-checked here for the role that actually matters

0052 already asserts `app_rw` itself carries no BYPASSRLS (a NOLOGIN privilege bundle
cannot anyway, in the versions Postgres has shipped, but it is asserted regardless).
What actually decides whether a REQUEST bypasses these policies is the LOGIN role
`majorana_api`, granted membership in `app_rw` out-of-band per
`docs/runbooks/database.md` § *Connecting as `app_rw`* — a role this migration cannot
see on every environment it runs against (CI's throwaway databases have no
`majorana_api`; production has carried it since 2026-08-17). So the check below is
guarded exactly like 0052's own per-table grant guards: silent where the role does not
exist yet, loud where it exists and is wrong. The runtime RLS test suite
(`services/api/tests/rls/`) asserts the SAME fact dynamically, against whatever role it
actually connects as, which is the authoritative check — this one is the belt to that
suspenders, firing for real the moment this migration runs against production, where
`majorana_api` already exists.
"""

from __future__ import annotations

from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None

# Every table name below is a literal drawn from this fixed, reviewed list — never
# interpolated from anything outside this file. Table and column names are SQL
# identifiers and cannot be bind parameters in any dialect, so f-string composition is
# the only way to generate 24 near-identical policies without hand-duplicating the SQL
# 24 times; see 0052's module docstring for why that is a correct trade here and not
# merely a convenient one.

#: (table, "workspace_id") — the tenant predicate reads the column directly.
_DIRECT_TABLES: tuple[str, ...] = (
    "workspace_folders",
    "projects",
    "artifacts",
    "runs",
    "usage_events",
    "audit_log",
    "qpu_runs",
)

#: (table, EXISTS predicate reaching a directly-scoped ancestor). Each predicate is
#: written against the ancestor's OWN `workspace_id` column, never against another
#: policy's evaluation, so it holds regardless of what runs first.
_TRANSITIVE_TABLES: tuple[tuple[str, str], ...] = (
    (
        "artifact_versions",
        "exists (select 1 from artifacts a where a.id = artifact_versions.artifact_id "
        "and a.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "artifact_citations",
        "exists (select 1 from artifacts a where a.id = artifact_citations.artifact_id "
        "and a.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "artifact_tags",
        "exists (select 1 from artifacts a where a.id = artifact_tags.artifact_id "
        "and a.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "artifact_sources",
        "exists (select 1 from artifact_versions v join artifacts a on a.id = v.artifact_id "
        "where v.id = artifact_sources.artifact_version_id "
        "and a.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "license_assertions",
        "exists (select 1 from artifact_versions v join artifacts a on a.id = v.artifact_id "
        "where v.id = license_assertions.artifact_version_id "
        "and a.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "run_events",
        "exists (select 1 from runs r where r.id = run_events.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "verification_records",
        "exists (select 1 from runs r where r.id = verification_records.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "agent_runs",
        "exists (select 1 from runs r where r.id = agent_runs.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        # run_plans.run_id references agent_runs.run_id, which shares its primary key
        # with runs.id — so this is one join to runs, not two.
        "run_plans",
        "exists (select 1 from runs r where r.id = run_plans.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "agent_steps",
        "exists (select 1 from runs r where r.id = agent_steps.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "agent_llm_calls",
        "exists (select 1 from runs r where r.id = agent_llm_calls.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "run_candidates",
        "exists (select 1 from runs r where r.id = run_candidates.run_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "candidate_executions",
        "exists (select 1 from run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_executions.candidate_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "candidate_verifications",
        "exists (select 1 from run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_verifications.candidate_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "candidate_semantic_reviews",
        "exists (select 1 from run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_semantic_reviews.candidate_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "candidate_verification_attempts",
        "exists (select 1 from run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_verification_attempts.candidate_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
    (
        "candidate_conversions",
        "exists (select 1 from run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_conversions.candidate_id "
        "and r.workspace_id = current_setting('majorana.workspace_id', true)::uuid)",
    ),
)

_ENFORCE_GATE = "current_setting('majorana.rls_enforce', true) is distinct from 'on'"

_POLICY_NAME = "tenant_isolation"


def _direct_predicate(table: str) -> str:
    return (
        f"{_ENFORCE_GATE} or {table}.workspace_id = "
        "current_setting('majorana.workspace_id', true)::uuid"
    )


def _create_policy(table: str, predicate: str) -> None:
    # `table` and `_POLICY_NAME` are drawn from this file's own fixed, reviewed
    # constants (never from anything outside it) — the same false-positive shape
    # 0052's module docstring already covers for a role name: an identifier
    # cannot be a bind parameter in any SQL dialect, so f-string composition is
    # the only way to generate these, and a SAST rule tuned for string-built
    # queries over untrusted input cannot tell the difference from here.
    op.execute(f"alter table {table} enable row level security")
    op.execute(
        f"create policy {_POLICY_NAME} on {table} "
        f"for all using ({predicate}) with check ({predicate})"
    )


def _drop_policy(table: str) -> None:
    op.execute(f"drop policy if exists {_POLICY_NAME} on {table}")
    op.execute(f"alter table {table} disable row level security")


def upgrade() -> None:
    for table in _DIRECT_TABLES:
        _create_policy(table, _direct_predicate(table))

    for table, exists_predicate in _TRANSITIVE_TABLES:
        predicate = f"{_ENFORCE_GATE} or {exists_predicate}"
        _create_policy(table, predicate)

    # Belt to the runtime suite's suspenders — see the module docstring's BYPASSRLS
    # section. Guarded on the role existing at all: CI's throwaway databases never
    # create `majorana_api`, and this must not fail a migration chain that has no
    # opinion about a role it never provisioned.
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'majorana_api') then
            if exists (
              select 1 from pg_roles
              where rolname = 'majorana_api' and (rolbypassrls or rolsuper)
            ) then
              raise exception
                'majorana_api carries BYPASSRLS or SUPERUSER — every policy this '
                'migration creates is invisible to it. This is the exact hole '
                'ai-ops#143 exists to close; fix the role before trusting this '
                'migration.';
            end if;
          end if;
        end
        $$;
        """
    )


def downgrade() -> None:
    # Reverse order: transitive tables first, since their EXISTS predicates name the
    # direct tables' `workspace_id` column but not the direct tables' policies, so
    # there is no ordering dependency either way — reversed anyway, to read as the
    # mirror of upgrade() rather than a second list somebody has to keep in sync.
    for table, _ in reversed(_TRANSITIVE_TABLES):
        _drop_policy(table)
    for table in reversed(_DIRECT_TABLES):
        _drop_policy(table)
