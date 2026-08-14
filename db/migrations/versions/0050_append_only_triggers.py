"""Enforce append-only on run_events, audit_log and usage_events with triggers.

Revision ID: 0050
Revises: 0049
Create Date: 2026-08-14

The wall these three tables were said to have did not exist.

`0001_schema_v1.py:337-350` implements it as a grant:

    if exists (select 1 from pg_roles where rolname = 'app_rw') then
        ...
        revoke update, delete on run_events, audit_log, usage_events from app_rw;
    end if;

That is inert in production for two independent reasons, either of which alone
is sufficient:

1. **Nothing creates `app_rw`.** No migration, script, runbook or terraform in
   this repository issues `CREATE ROLE app_rw`. The `if exists` guard was added
   so CI branch databases and local scratch databases — which run migrations as
   the owner with no app roles present — would not fail. It succeeded at that,
   and in doing so it made the whole block a no-op everywhere, silently. A
   guard that is never satisfied is indistinguishable from a control that
   passed.

2. **The application does not connect as `app_rw`, and owns the tables.**
   `docs/runbooks/database.md:12` records the production role as `majorana_app`
   and states that it "owns every object, so Alembic can issue DDL";
   `docs/runbooks/database.md:29` and ADR-0024 both show the connection string
   using it. In PostgreSQL the owner of a table retains its privileges no matter
   what is granted to or revoked from some other role, so even a hand-created
   `app_rw` with the revoke correctly applied would not have constrained the
   application. The grant was aimed at a role the app never uses.

Five code comments asserted the control that was not there — the same claim,
worded slightly differently each place it was written down independently:
`services/api/src/majorana_api/repos/runs.py:4` ("run_events is append-only (DB
grant enforced)"), `services/api/src/majorana_api/repos/shares.py:693`
("audit_log is append-only by database grant"),
`services/api/src/majorana_api/repos/audit.py:1` and
`services/api/src/majorana_api/repos/usage.py:1` (module docstrings, "Append-only
(DB grant)"), and `services/api/tests/test_usage_spend_live.py:92-97` (a test
docstring citing the grant as the reason it writes an explicit `ts` instead of
backdating a row — the reason was correct, only the mechanism it named was
not). All five are corrected in this change.

A trigger is the mechanism this schema already uses where the guarantee has to
hold: `0018_license_assertions_append_only.py` protects `license_assertions`
with `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`. A trigger fires regardless
of which role issues the statement and regardless of who owns the table, which
is exactly the property the grant lacked. This revision applies that same
pattern to the three tables that were supposed to have it.

**What actually writes to these tables — checked against product code, and
independently checked again against the test suite, because the first check
only covered the former.** No UPDATE or DELETE against `run_events`,
`audit_log` or `usage_events` exists anywhere under `services/api/src` or
`packages/py`, and there is no retention, pruning or purge job. That much was
true the first time this docstring claimed "nowhere in `services/` or
`packages/py`" — but `services/api/tests/` is also under `services/`, and
`services/api/tests/repo_test_helpers.py::delete_committed_tenants` — the
teardown a handful of two-connection race tests use because they must COMMIT
real rows for a second connection to see them, unlike most of this suite,
which rolls back — deletes from all three tables to clean those rows up.
Traced to two callers that reach it for real: the
`test_run_allowance_race_live.py` test
`test_the_last_weekly_run_cannot_be_spent_twice_by_two_connections` commits a
`usage_events` row (`_record_tokens`, via `record_usage`) before its
`finally:` block calls `delete_committed_tenants`; the
`authz/test_project_shares_live.py` test that exercises `revoke_share` commits
an `audit_log` row (`record_audit` runs unconditionally inside it) before the
same cleanup runs. Both would have started raising SQLSTATE 55000 on their
very next run, against this migration alone. `run_events` has no traced
caller: all 11 current callers of `delete_committed_tenants`, and every
`repos/runs.py` function that can put a row in `run_events`
(`append_run_event`, and the two functions that call it internally,
`finish_run` and `fail_run_from_dead_letter`), were checked, and none is
reachable from any of them today. That is the current state, not a guarantee
the trigger relies on — the bypass below covers all three tables the same way
regardless of whether a caller currently needs it.

**The fix is a transaction-scoped bypass, not a weaker trigger.** The shared
trigger function checks a session GUC before raising:

    if current_setting('majorana.append_only_bypass', true) = 'on' then
        return coalesce(new, old);
    end if;

The second argument to `current_setting` makes it return NULL — rather than
raising "unrecognized configuration parameter" — when the GUC has never been
set in the session, so an ordinary write, which never sets it, still hits the
exception exactly as before this addition.
`services/api/tests/repo_test_helpers.py::delete_committed_tenants` issues
`SET LOCAL majorana.append_only_bypass = 'on'` at the start of its cleanup
transaction. `SET LOCAL` scopes the setting to that transaction: it cannot
leak past that transaction's COMMIT or ROLLBACK, so no other session, and no
later transaction on a connection the pool reuses, is affected.

Why a GUC, and not something that needs more privilege: the threat this
trigger defends against is an application bug or a careless code path
mutating evidence, not a hostile operator — it cannot defend against the
latter, because the app connects as `majorana_app`, which owns these tables,
and an owner can always `DROP TRIGGER`. A bypass reachable only by a
deliberate, greppable statement gives up almost nothing against the threat
this actually defends against, in exchange for the ability to clean up test
data. `ALTER TABLE ... DISABLE TRIGGER` was considered and rejected: it is
strictly stronger — it needs ownership, a GUC does not — but it takes an
ACCESS EXCLUSIVE lock, and several `delete_committed_tenants` callers are
themselves two-connection race tests; taking a table-level exclusive lock in
their own teardown risks blocking or deadlocking the tests it exists to
serve.

`scripts/check_append_only_bypass.py` (wired into the `py` job in `ci.yml`,
beside `check_raw_queries.py`) is what keeps the bypass from becoming a hole
instead of a control: it fails the build if the string
`majorana.append_only_bypass` appears in any Python file outside
`services/api/tests/` or `db/migrations/`, so the escape hatch cannot spread
into product code without CI catching it.

**Nothing is expected to break beyond the two cases above**, both of which
this same change fixes by giving `delete_committed_tenants` the bypass. Their
foreign keys (`run_events.run_id` → `runs.id`, `audit_log.workspace_id` →
`workspaces.id`, `audit_log.actor_user_id` → `users.id`,
`usage_events.workspace_id` → `workspaces.id`) are all declared without `ON
DELETE`, so they default to NO ACTION: deleting a parent row already fails on
the foreign key and never reaches this trigger. If a legitimate delete path is
ever needed in product code — a retention policy, or an erasure request — it
has to be written deliberately, which is the point.

The grant in 0001 is deliberately left in place. It is harmless where the role
does not exist, it becomes a second layer if `app_rw` is ever introduced
properly, and rewriting history in an applied migration is worse than leaving a
weak control standing underneath a strong one.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None

_FUNCTION = "majorana_reject_append_only_mutation"

#: Session GUC checked by the trigger before it raises. Set with `SET LOCAL`
#: (never plain `SET`) so it cannot outlive the transaction that requested it —
#: see this module's docstring for the full reasoning and the lint guard,
#: `scripts/check_append_only_bypass.py`, that keeps it out of product code.
_BYPASS_GUC = "majorana.append_only_bypass"

# The tables 0001 named in APPEND_ONLY, and the reason each is append-only, so
# the error a developer hits explains itself without a trip to this file.
_TABLES: tuple[tuple[str, str], ...] = (
    (
        "run_events",
        "run_events is append-only; the run timeline is evidence, append a superseding event",
    ),
    (
        "audit_log",
        "audit_log is append-only; an audit trail that can be edited is not an audit trail",
    ),
    (
        "usage_events",
        "usage_events is append-only; billing evidence is corrected by a compensating row",
    ),
)


def _trigger_name(table: str) -> str:
    return f"trg_{table}_append_only"


def upgrade() -> None:
    # One function, parameterised by the trigger argument, rather than three
    # near-identical functions. TG_ARGV[0] carries the per-table message so the
    # exception names the table the caller actually touched.
    op.execute(
        sa.text(
            f"""
            CREATE FUNCTION {_FUNCTION}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF current_setting('{_BYPASS_GUC}', true) = 'on' THEN
                    RETURN COALESCE(NEW, OLD);
                END IF;
                RAISE EXCEPTION '%', TG_ARGV[0]
                    USING ERRCODE = '55000';
            END;
            $$
            """
        )
    )
    for table, message in _TABLES:
        op.execute(
            sa.text(
                f"""
                CREATE TRIGGER {_trigger_name(table)}
                BEFORE UPDATE OR DELETE ON {table}
                FOR EACH ROW EXECUTE FUNCTION {_FUNCTION}('{message}')
                """
            )
        )


def downgrade() -> None:
    for table, _ in _TABLES:
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS {_trigger_name(table)} ON {table}"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_FUNCTION}()"))
