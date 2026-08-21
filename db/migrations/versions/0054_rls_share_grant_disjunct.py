"""The grant disjunct: let a share punch through RLS, scoped to what was shared (ai-ops#149).

Revision ID: 0054
Revises: 0053

## The ruling this migration executes

`db/migrations/versions/0053_rls_defense_in_depth.py` installed row-level security on 24
tenant tables and named, in its own docstring, the one thing that had to be resolved
before `MAJORANA_RLS_ENFORCED` could ever be set:

> `project_shares` … Any future policy here has to key on `grantee_user_id` against a
> user-id GUC, which this migration does not introduce. Left as a named follow-up, not
> silently.

and, two paragraphs later, that the exclusion's blast radius is bigger than the one
table — `projects`, `artifacts` and `artifact_versions` are all read THROUGH a grant by
`repos/shares.py`, all three DO carry a workspace-keyed policy, and under enforcement all
three would filter a grantee's rows out silently.

Owner ruling on EshMis/ai-ops#149 picks option 1 — "let a grant punch through RLS, scoped
tightly to exactly what was shared" — and sequences it before launch. This migration is
that change, and nothing else.

## This was measured, not predicted

Before writing a line of SQL, the real `repos/shares.py` functions were run against live
Postgres as the restricted `majorana_api` role, with `majorana.rls_enforce` set to `on`,
on the schema as 0053 left it. Every one of them broke, and broke the silent way:

    resolve_share          NotFoundError: shared project
    list_shared_projects   returned 0 rows          <- no error, no log line
    get_shared_project     NotFoundError: shared project
    list_shared_artifacts  NotFoundError: shared project
    get_shared_version     NotFoundError: shared project

With enforcement off, the same calls returned the grantee's data. So 0053's warning was
right and is now a measurement rather than a reading of the code.

## The shape

One new GUC and one new disjunct. `repos/_base.py::set_rls_context` — still the only
function in the tree that sets any of these, still called from the one place,
`auth/deps.py::get_scope` — now sets `majorana.user_id` alongside `majorana.workspace_id`
in the same statement, so the two can never drift apart or be armed separately.

## The obvious shape does not work, and finding that out is half of this migration

ai-ops#149's own research sketched the disjunct as a plain `EXISTS` against the grants
table. Written that way it does not run. Postgres refuses, at query time, with:

    infinite recursion detected in policy for relation "project_shares"

and the cycle is short: the policy on `artifacts` reads `project_shares` -> which has its
own policy, reaching the row through `projects` -> whose policy reads `project_shares`.
Three tables, one loop, and it fires on an ordinary artifact lookup rather than on
anything exotic.

That is the case the standard's second shape exists for — the same research note said so
in passing ("or, where the lookup is recursive or hot enough to matter, as a
`SECURITY DEFINER` helper function called from the policy"), and it turns out to be the
required shape here rather than an optimization. So the grant lookup lives in ONE
function:

    majorana_rls_shared_project_ids() -> setof uuid, STABLE, SECURITY DEFINER

`SECURITY DEFINER` makes it run as the function's owner, which is the tables' owner. 0053
deliberately does not set `FORCE ROW LEVEL SECURITY` on any table (see its docstring's
own section on why), so the owner is not bound by policies and the read of
`project_shares` inside this function evaluates no policy at all. That is what breaks the
cycle — and it is a real dependency between the two migrations, not an incidental one:
**if `FORCE ROW LEVEL SECURITY` is ever set on `project_shares`, this function re-enters
its policy and the recursion comes back.** `tests/rls/test_share_grant_rls.py` asserts
FORCE is off for exactly that reason, so the day someone sets it, a test says why.

Three consequences worth stating:

- `project_shares`'s OWN policy keeps the plain `EXISTS (… FROM projects …)` form. It is
  the only one of the four that does, and it is what the function's existence lets the
  other three stop doing.
- The function is `STABLE`, so the planner may evaluate it once per statement rather than
  once per row — the performance half of why the standard offers this shape.
- `search_path` is pinned and `EXECUTE` is revoked from `PUBLIC` and granted to `app_rw`,
  because a `SECURITY DEFINER` function with a mutable search path is a privilege
  escalation primitive, not a style question.

The disjunct itself, added to the policies on the three tables a grant reaches through:

    OR <the row's project> IN (SELECT majorana_rls_shared_project_ids())

where the function is, in full:

    SELECT s.project_id FROM project_shares s
     WHERE s.grantee_user_id = current_setting('majorana.user_id', true)::uuid
       AND (s.expires_at IS NULL OR s.expires_at > now())

Four properties of that predicate are load-bearing:

1. **It is scoped to the shared project, not to the grantor's workspace.** A grant on
   one project does not make a second project in the same workspace readable. This is
   the same boundary `repos/shares.py::_bound_artifact` enforces in application code
   (`artifact.project_id == access.project_id`, which its own docstring calls "the
   security boundary of the whole feature"); the policy now states it a second time, in
   the database, rather than trusting the first statement of it.

2. **`expires_at` is in the policy, and that is a gain rather than a transcription.**
   Today expiry lives only in `_project_limits.live_share_predicates()`, which a future
   query can forget. In the policy, an expired grant stops returning rows at the
   database, on every path, including one nobody has written yet.

3. **It fails closed when the GUC is unset.** `current_setting(name, true)` returns NULL
   rather than raising, and `s.grantee_user_id = NULL` is never true for any row — so a
   session that never armed the user GUC gets exactly the pre-0054 behaviour, not a
   wider one. The same argument 0053 makes for `majorana.workspace_id`.

4. **A NULL `project_id` cannot widen anything.** `artifacts.project_id` is nullable — an
   artifact can live outside any project — and `s.project_id = artifacts.project_id` is
   NULL, never true, for those rows. An unfiled artifact is therefore reachable only by
   its own workspace, which is what it was before this migration.

## `project_shares` gets its first policy, and it needs BOTH halves

The table is read from two directions, and a policy with only one of them breaks the
other:

- The **granting** half (`list_shares`, `grant_share`, `revoke_share`,
  `revoke_all_shares`) belongs to the workspace that owns the project, and reaches the
  row through `projects`. So: an EXISTS against `projects.workspace_id`.
- The **using** half (`resolve_share` and everything built on it) belongs to the
  grantee, whose session carries their OWN workspace id. So: `grantee_user_id` against
  the user GUC.

The grantee half deliberately does NOT carry the `expires_at` clause, unlike the three
disjuncts above. An expired grant must stay visible to `leave_shared_project`, which
DELETEs the grantee's own row — and to the owning workspace's admin list, which is where
an expired grant gets cleaned up. Expiry is what stops a grant granting ACCESS TO DATA,
which is exactly where the clause is applied; it is not a reason to make the grant row
itself unreachable to the two parties named on it.

## `audit_log`, and the `RETURNING` trap that a FOR INSERT policy alone walks into

`repos/shares.py` writes audit rows for a shared edit against the OWNING workspace, on
purpose — its own comment says the row records "WHICH person, in a workspace they are not
a member of". Under enforcement that INSERT fails the workspace-keyed WITH CHECK.

Widening `audit_log`'s existing policy to `USING` a grant would be a real leak: it would
hand a grantee the grantor's entire audit history, which is not what was shared. So the
grant reaches `audit_log` through its own narrow predicate — the row must be written BY
this caller (`actor_user_id`) INTO a workspace this caller holds a live grant into —
never through 0053's policy, which keeps evaluating workspace-only.

**A `FOR INSERT ... WITH CHECK` policy is not enough on its own, and the reason is worth
writing down because it is invisible until it bites.** PostgreSQL applies the SELECT
policy to an `INSERT` that carries a `RETURNING` clause, on top of the insert's own
`WITH CHECK`. SQLAlchemy's unit of work emits `INSERT … RETURNING` for every mapped row,
to read back server-generated columns — so an ORM insert can never be satisfied by a
`FOR INSERT` policy alone. Measured here rather than reasoned about: with only the INSERT
policy in place, a raw `insert into audit_log (…) values (…)` succeeded and the identical
row through `repos/audit.py::record_audit` failed, in the same transaction, with the same
GUCs, one statement apart. Adding `returning id` to the raw insert reproduced the failure
exactly.

So `audit_log` gets TWO new policies with the same predicate: `FOR INSERT WITH CHECK` and
`FOR SELECT USING`. The SELECT half exposes only rows this caller themselves authored —
information they already hold, by definition, because they are the actor named on it —
and nothing of the grantor's own history. `audit_log` is append-only by 0050's trigger,
so no UPDATE or DELETE path exists for either to apply to.

Anything else in this codebase that adds a `FOR INSERT` policy will need the same pair.

## The second defect this found, which is 0053's and not this change's

Building the suite below turned up a hard failure that has nothing to do with sharing,
and it is the more serious of the two:

    select count(*) from runs
    ERROR:  invalid input syntax for type uuid: ""

as the restricted role, on a connection where `majorana.workspace_id` was set in an
EARLIER, already-committed transaction — **with enforcement off**.

`set_config(name, value, true)` is `SET LOCAL`: at commit the value reverts to whatever
the session had before, and for a custom GUC that has never been set at session level
that is the EMPTY STRING, not "unset". `current_setting(name, true)` then returns `''`
rather than NULL, and `''::uuid` raises. It is not a filter that fails open or closed —
the statement errors.

0053 reasoned, correctly for a fresh connection, that a caller which never sets the GUCs
is indistinguishable from one that does not exist, and built its whole escape hatch on
that: the worker, `catalog_admin.py`'s scripts, an operator's `psql`, and its own
`downgrade()` all rely on it. On a POOLED connection the premise does not hold. The first
request to arm the GUCs leaves `''` behind on that physical connection, and the next
caller to reach a protected table over it gets a 500 instead of the permissive behaviour
0053 promises — including callers that never touch RLS at all.

Nothing is broken today, for the same reason nothing else here is: `Settings.rls_enforced`
is False everywhere, so `set_rls_context` returns without executing anything and no
connection ever acquires the empty value. It would have broken on the day of the flip,
in a way that reads as "the API is down", not as "sharing is empty".

So this migration rewrites **all 24** of 0053's policies, not only the three the grant
disjunct touches, replacing every

    current_setting('majorana.<x>', true)::uuid
with
    nullif(current_setting('majorana.<x>', true), '')::uuid

which is NULL for both spellings of absent and restores the property 0053 intended. The
grant disjunct made this urgent rather than merely latent: it reads its GUC from inside a
STABLE function, which the planner may evaluate as an InitPlan BEFORE the enforcement
gate is tested, so the OR cannot be relied on to skip the cast.

`downgrade()` restores 0053's exact original text, empty-string bug included, because a
downgrade's job is to put back what was there rather than to leave a fix behind under a
revision that never contained one.

## Enforcement is still OFF, and this migration does not change that

Every predicate below keeps 0053's `current_setting('majorana.rls_enforce', true) IS
DISTINCT FROM 'on'` gate as its first disjunct, `Settings.rls_enforced` still defaults to
False everywhere including production, and flipping it stays a separate deliberate step.
This migration is safe to run against production the moment it merges: it changes which
SQL objects exist, not what any live request returns.

What it DOES change is that the flip is no longer known-broken. 0053's "**Do not flip
`MAJORANA_RLS_ENFORCED` until this is resolved**" is what this migration resolves.
"""

from __future__ import annotations

from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None

# Identifiers cannot be bind parameters in any SQL dialect, so these policies are composed
# from this file's own fixed constants — never from anything outside it. Same trade, and
# the same SAST false-positive shape, that 0052's and 0053's module docstrings cover.

_ENFORCE_GATE = "current_setting('majorana.rls_enforce', true) is distinct from 'on'"

_POLICY_NAME = "tenant_isolation"
_SHARE_POLICY_NAME = "share_grant"
_AUDIT_INSERT_POLICY_NAME = "share_grant_audit_insert"
_AUDIT_SELECT_POLICY_NAME = "share_grant_audit_readback"

_GRANT_FN = "majorana_rls_shared_project_ids"


def _guc(name: str, *, fixed: bool) -> str:
    """One GUC read, in either spelling.

    `fixed=True` is this migration's; `fixed=False` reproduces 0053's exactly, so
    `downgrade()` restores what was there rather than a corrected version of it. See the
    module docstring's section on the empty-string defect for why the two differ.
    """
    raw = f"current_setting('majorana.{name}', true)"
    return f"nullif({raw}, '')::uuid" if fixed else f"{raw}::uuid"


#: 0053's `_DIRECT_TABLES`, copied verbatim. Copied rather than imported: a migration has
#: to keep meaning what it meant on the day it ran, and importing another revision's
#: private constant would make this file's behaviour change if that one were ever edited.
_DIRECT_TABLES: tuple[str, ...] = (
    "workspace_folders",
    "projects",
    "artifacts",
    "runs",
    "usage_events",
    "audit_log",
    "qpu_runs",
)

#: 0053's `_TRANSITIVE_TABLES`, as (table, ancestor, join). The predicate is rebuilt here
#: from its parts rather than copied as a finished string, because the GUC read inside it
#: is the thing this migration is changing.
_TRANSITIVE_TABLES: tuple[tuple[str, str], ...] = (
    ("artifact_versions", "artifacts a where a.id = artifact_versions.artifact_id and a"),
    ("artifact_citations", "artifacts a where a.id = artifact_citations.artifact_id and a"),
    ("artifact_tags", "artifacts a where a.id = artifact_tags.artifact_id and a"),
    (
        "artifact_sources",
        "artifact_versions v join artifacts a on a.id = v.artifact_id "
        "where v.id = artifact_sources.artifact_version_id and a",
    ),
    (
        "license_assertions",
        "artifact_versions v join artifacts a on a.id = v.artifact_id "
        "where v.id = license_assertions.artifact_version_id and a",
    ),
    ("run_events", "runs r where r.id = run_events.run_id and r"),
    ("verification_records", "runs r where r.id = verification_records.run_id and r"),
    ("agent_runs", "runs r where r.id = agent_runs.run_id and r"),
    # run_plans.run_id references agent_runs.run_id, which shares its primary key with
    # runs.id — so this is one join to runs, not two. (0053's own note.)
    ("run_plans", "runs r where r.id = run_plans.run_id and r"),
    ("agent_steps", "runs r where r.id = agent_steps.run_id and r"),
    ("agent_llm_calls", "runs r where r.id = agent_llm_calls.run_id and r"),
    ("run_candidates", "runs r where r.id = run_candidates.run_id and r"),
    (
        "candidate_executions",
        "run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_executions.candidate_id and r",
    ),
    (
        "candidate_verifications",
        "run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_verifications.candidate_id and r",
    ),
    (
        "candidate_semantic_reviews",
        "run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_semantic_reviews.candidate_id and r",
    ),
    (
        "candidate_verification_attempts",
        "run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_verification_attempts.candidate_id and r",
    ),
    (
        "candidate_conversions",
        "run_candidates rc join runs r on r.id = rc.run_id "
        "where rc.id = candidate_conversions.candidate_id and r",
    ),
)

#: (table, the expression naming that row's project) — the three tables `repos/shares.py`
#: reads through a grant, and the only three. Measured, not assumed; see the docstring.
_GRANT_REACHABLE: dict[str, str] = {
    # A shared project's own row: `resolve_share` joins it, `get_shared_project` returns it.
    "projects": "projects.id",
    # `list_shared_artifacts` / `_bound_artifact`. A NULL `project_id` cannot match.
    "artifacts": "artifacts.project_id",
    # `list_shared_versions`, `get_shared_version`, and the INSERT `create_shared_version`
    # makes — hence this serving as WITH CHECK as well as USING.
    "artifact_versions": (
        "(select a.project_id from artifacts a where a.id = artifact_versions.artifact_id)"
    ),
}

#: The one place the grants table is read from inside a policy. SECURITY DEFINER so the
#: read evaluates no policy and the cycle in the module docstring cannot form; STABLE so
#: the planner may hoist it out of the per-row loop; `search_path` pinned because a
#: SECURITY DEFINER function without that is an escalation primitive.
#:
#: `now()` rather than a literal so the clock deciding expiry is the database's — the same
#: choice, for the same reason, `_project_limits.live_share_predicates()` makes.
_GRANT_FN_SQL = f"""
create or replace function {_GRANT_FN}()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.project_id
    from project_shares s
   where s.grantee_user_id = {_guc("user_id", fixed=True)}
     and (s.expires_at is null or s.expires_at > now())
$fn$
"""


def _live_grant_on(project_expr: str) -> str:
    return f"{project_expr} in (select {_GRANT_FN}())"


def _tenant_predicate(table: str, *, fixed: bool) -> str:
    """0053's predicate for one table, in either spelling of the GUC read."""
    ws = _guc("workspace_id", fixed=fixed)
    for name, join in _TRANSITIVE_TABLES:
        if name == table:
            return f"{_ENFORCE_GATE} or exists (select 1 from {join}.workspace_id = {ws})"
    return f"{_ENFORCE_GATE} or {table}.workspace_id = {ws}"


def _policy_predicate(table: str, *, fixed: bool, with_grant: bool) -> str:
    predicate = _tenant_predicate(table, fixed=fixed)
    if with_grant and table in _GRANT_REACHABLE:
        predicate = f"{predicate} or {_live_grant_on(_GRANT_REACHABLE[table])}"
    return predicate


#: `project_shares` has no policy at all before this migration — 0053 excluded it. Both
#: halves are needed; see the module docstring. This is the ONE predicate that still reads
#: `project_shares`'s sibling tables directly, and the one the helper function frees the
#: others from having to.
#:
#: **The two halves are NOT interchangeable between reading and writing, and getting that
#: wrong is a privilege escalation rather than a mistake of degree.** A single
#: `FOR ALL USING (p) WITH CHECK (p)` policy would evaluate the grantee half on INSERT
#: too — and on an INSERT the row's `grantee_user_id` is whatever the writer put there.
#: Any caller could then write themselves a grant on any project id and read it back
#: through the disjuncts above. The app layer refuses that (`grant_share` requires ADMIN
#: and reaches the project through `scope.workspace_id`), so it was never reachable
#: through the API — but a backstop that can be talked into issuing its own credential is
#: worse than no backstop on that table, which is the whole thing 0053 excluded it to
#: avoid getting wrong. Caught by CodeRabbit's suggestion to add a write-side control,
#: which is exactly the test that fails against the single-policy version.
#:
#: So the grantee half appears ONLY where reading and removing happen:
#:
#:   SELECT  owner-workspace OR grantee-self   `resolve_share`, and the grantor's admin list
#:   DELETE  owner-workspace OR grantee-self   `leave_shared_project` (grantee removes their
#:                                             own row) and `revoke_share` (owner removes it)
#:   INSERT  owner-workspace ONLY              only the workspace that owns the project may
#:                                             create a grant on it
#:   UPDATE  owner-workspace ONLY              `grant_share` is idempotent on the person, so
#:                                             a role change is an UPDATE and belongs to the
#:                                             owner for the same reason the INSERT does
_SHARES_OWNER_HALF = (
    "exists (select 1 from projects p where p.id = project_shares.project_id "
    f"and p.workspace_id = {_guc('workspace_id', fixed=True)})"
)

_SHARES_GRANTEE_HALF = f"project_shares.grantee_user_id = {_guc('user_id', fixed=True)}"

#: Reading and removing: either party named on the row.
_SHARES_READ_PREDICATE = f"{_ENFORCE_GATE} or {_SHARES_OWNER_HALF} or {_SHARES_GRANTEE_HALF}"

#: Creating and changing: the owning workspace only. Never the grantee half — see above.
_SHARES_WRITE_PREDICATE = f"{_ENFORCE_GATE} or {_SHARES_OWNER_HALF}"

#: `audit_log` carries no `project_id`, so the grant is reached through the row's
#: `workspace_id` — and narrowed by `actor_user_id`, which `record_audit` stamps from the
#: scope. Together they describe exactly the shared-edit rows: written BY this caller,
#: INTO a workspace this caller holds a live grant into. Nothing else qualifies.
_AUDIT_GRANT_PREDICATE = (
    f"{_ENFORCE_GATE} "
    f"or (audit_log.actor_user_id = {_guc('user_id', fixed=True)} "
    "and exists (select 1 from projects p "
    f"where p.id in (select {_GRANT_FN}()) "
    "and p.workspace_id = audit_log.workspace_id))"
)


def _replace_policy(table: str, predicate: str) -> None:
    """Drop and recreate rather than ALTER POLICY.

    `alter policy … using (…) with check (…)` would work, but a create-from-scratch is
    what `downgrade()` has to reverse, and a policy whose full text is written in one
    place reads the same way in `pg_policies` as it does here.
    """
    op.execute(f"drop policy if exists {_POLICY_NAME} on {table}")
    op.execute(
        f"create policy {_POLICY_NAME} on {table} "
        f"for all using ({predicate}) with check ({predicate})"
    )


def _all_tables() -> tuple[str, ...]:
    return _DIRECT_TABLES + tuple(name for name, _ in _TRANSITIVE_TABLES)


def upgrade() -> None:
    op.execute(_GRANT_FN_SQL)
    # A SECURITY DEFINER function is executable by PUBLIC unless told otherwise, and this
    # one reports which projects a named user holds a grant on. Guarded on `app_rw`
    # existing exactly like 0052's and 0053's own role blocks: roles are cluster-wide and
    # not every database this runs against provisioned one.
    op.execute(f"revoke all on function {_GRANT_FN}() from public")
    op.execute(
        f"""
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant execute on function {_GRANT_FN}() to app_rw;
          end if;
        end
        $$;
        """
    )

    # All 24, not only the three the grant touches: the other 21 are rewritten for the
    # empty-string defect alone. See the module docstring.
    for table in _all_tables():
        _replace_policy(table, _policy_predicate(table, fixed=True, with_grant=True))

    op.execute("alter table project_shares enable row level security")
    # Four policies rather than one FOR ALL — see the predicates above for why the
    # grantee half must not reach INSERT or UPDATE.
    op.execute(
        f"create policy {_SHARE_POLICY_NAME}_read on project_shares "
        f"for select using ({_SHARES_READ_PREDICATE})"
    )
    op.execute(
        f"create policy {_SHARE_POLICY_NAME}_delete on project_shares "
        f"for delete using ({_SHARES_READ_PREDICATE})"
    )
    op.execute(
        f"create policy {_SHARE_POLICY_NAME}_insert on project_shares "
        f"for insert with check ({_SHARES_WRITE_PREDICATE})"
    )
    op.execute(
        f"create policy {_SHARE_POLICY_NAME}_update on project_shares "
        f"for update using ({_SHARES_WRITE_PREDICATE}) "
        f"with check ({_SHARES_WRITE_PREDICATE})"
    )

    # INSERT and SELECT, deliberately not FOR ALL: a grantee may write the audit row their
    # own shared edit produces and read that row back, and must not gain the grantor's
    # audit history. The SELECT half is not optional — see the RETURNING section above.
    op.execute(
        f"create policy {_AUDIT_INSERT_POLICY_NAME} on audit_log "
        f"for insert with check ({_AUDIT_GRANT_PREDICATE})"
    )
    op.execute(
        f"create policy {_AUDIT_SELECT_POLICY_NAME} on audit_log "
        f"for select using ({_AUDIT_GRANT_PREDICATE})"
    )


def downgrade() -> None:
    op.execute(f"drop policy if exists {_AUDIT_SELECT_POLICY_NAME} on audit_log")
    op.execute(f"drop policy if exists {_AUDIT_INSERT_POLICY_NAME} on audit_log")
    for suffix in ("read", "delete", "insert", "update"):
        op.execute(f"drop policy if exists {_SHARE_POLICY_NAME}_{suffix} on project_shares")
    op.execute("alter table project_shares disable row level security")
    # 0053's exact original text, empty-string bug included — a downgrade puts back what
    # was there rather than leaving a fix behind under a revision that never had one.
    for table in reversed(_all_tables()):
        _replace_policy(table, _policy_predicate(table, fixed=False, with_grant=False))
    # Last: by now nothing references it, and dropping it earlier would leave a window
    # where the policies above still named a function that was gone.
    op.execute(f"drop function if exists {_GRANT_FN}()")
