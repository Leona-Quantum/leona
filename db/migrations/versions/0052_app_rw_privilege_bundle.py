"""app_rw — the privilege set the application should connect with, provisioned for real.

Revision ID: 0052
Revises: 0051

The audit on ai-ops 127 found that the application owns every table it uses.
There is a dedicated `majorana_app` role — it is not `postgres`, which is better
than the code alone could show — but it is the OWNER, so "restrict database
permissions" is unsatisfied in the way that matters: an ORM mistake or an
injection-adjacent bug has DDL reach, and in PostgreSQL an owner keeps its
privileges no matter what is granted or revoked elsewhere.

## What this migration is, and what it deliberately is not

It creates `app_rw` and puts the right privileges on it. It does **not** change
who connects. Those are two separate acts and only the first belongs in version
control: the second is a credential and a Cloud Run env var, and is written up in
`docs/runbooks/database.md` § Connecting as app_rw.

That split is also what makes this migration safe to land on its own. Creating a
role the application does not use changes nothing about how the application
behaves — every query still runs as `majorana_app`, exactly as it did before.
The flip is a separate act because it is the one that can take the site down if
a privilege turns out to be missing, so it wants its own verification and its
own rollback, not because it is being deferred.

## A LOGIN role would have been the obvious shape, and is the wrong one

`app_rw` is created `NOLOGIN`. It is a privilege *bundle*, not an account: the
Cloud SQL login user is created out of band with a password, and granted
membership in this role. Two reasons, and the second is the one that decides it:

- A password cannot live in a migration, and a role created here with `LOGIN`
  and no password is a role that either cannot be used or gets a password
  attached by hand later, off the record.
- The privilege SET is the thing worth reviewing in a diff, and the credential is
  the thing that must never be in one. Separating them means this file can be
  read for what it grants without anyone having to trust that a secret was
  handled properly elsewhere.

## Why the default privileges line is not optional

`GRANT ... ON ALL TABLES IN SCHEMA public` is a snapshot: it grants on the tables
that exist *now*. Without `ALTER DEFAULT PRIVILEGES`, the very next migration
that adds a table would produce one `app_rw` cannot read — and the failure would
land in production, on one endpoint, as a permission error, at whatever hour the
deploy ran. `ALTER DEFAULT PRIVILEGES` is what makes the grant
hold for tables that do not exist yet.

It is written WITHOUT `FOR ROLE`, which is load-bearing and looks like an
omission. Naming `majorana_app` explicitly is the obvious version and it breaks
CI: migrations there run as `pg` against a throwaway database where no
`majorana_app` role exists, and `ALTER DEFAULT PRIVILEGES FOR ROLE` on a missing
role is an error, so the whole deploy-blocking migration chain would fail on
every branch. Omitting it defaults to the CURRENT role — which is whoever ran
the migration, which is precisely the role that just created the tables, in CI
and in production alike. Correct and portable for the same reason.

This is the same class of quiet, delayed failure as the bug this migration
exists to fix, which is why it is stated here rather than left to be noticed.

## The three append-only tables are re-revoked after the grant

`GRANT INSERT, SELECT, UPDATE, DELETE ON ALL TABLES` reaches `run_events`,
`audit_log` and `usage_events` too, and those are append-only. 0050 enforces that
with triggers, which bind the owner as well and are the real control — but a
grant that hands out UPDATE and DELETE on them, on the assumption that something
downstream will refuse it, is the exact shape of the mistake 0001 made in the
other direction. So the revoke is re-issued here, immediately after the grant.
Two layers, neither relying on the other.

## No CREATE on the schema

Explicitly revoked rather than merely not granted. `public` grants CREATE to
`PUBLIC` by default on PostgreSQL below 15; this database is 17, where that
default was removed, so the revoke is belt-and-braces and costs nothing. Without
it the whole point — no DDL from the application's connection — would depend on
a server default that a restore from an older dump could reintroduce.
"""

from __future__ import annotations

from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None

# Every statement below is a literal, with no interpolation anywhere.
#
# The first draft built these with f-strings over a ROLE constant, which reads as
# tidier and drew a SQL-injection finding from Sourcery on every line. The finding
# is a false positive on its own terms - the value is a module constant, not input
# - but the fix it implies, binding a parameter, is not available either: a role
# name is an IDENTIFIER, and identifiers cannot be bind parameters in any SQL
# dialect. So the choice was between a permanently-suppressed warning and no
# interpolation at all.
#
# No interpolation is simply better here. A migration is a fixed artifact that
# runs once against one schema; it has nothing to be generic about, and the
# literal form is what a reviewer can check against the grant they expect.


def upgrade() -> None:
    # `CREATE ROLE` has no IF NOT EXISTS, and this must be re-runnable: CI builds
    # several databases on one server, so the role can already exist from an
    # earlier database's migration run on the same cluster.
    #
    # Unconditional otherwise - NOT wrapped in a "skip if we lack permission"
    # guard. That guard is precisely what made 0001's version of this inert
    # everywhere, silently, and 0050 is a whole migration about the cost of it.
    # If the connecting role cannot create a role, this migration SHOULD fail
    # loudly, because a deploy that cannot provision the privilege set has not
    # done the thing it reports doing.
    op.execute(
        """
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = 'app_rw') then
            create role app_rw nologin;
          end if;
        end
        $$;
        """
    )

    # The attributes are asserted UNCONDITIONALLY, outside the branch above.
    #
    # Raised in review, and it is the same bug this migration exists to correct,
    # one level up: `if not exists ... create` means a role that ALREADY exists is
    # accepted whatever it is. Somebody debugging the flip creates `app_rw` by
    # hand with LOGIN, or a restored dump carries one with CREATEROLE, and the
    # migration reports success over a role that is nothing like the one this file
    # describes. A guard that only fires on a fresh database is not a guard.
    #
    # ALTER ROLE is idempotent, so stating them every run costs nothing and makes
    # the file the authority on what `app_rw` is rather than a description of how
    # it was first made. NOLOGIN matters most: it is what keeps this a privilege
    # bundle rather than an account, and therefore what keeps the credential out
    # of version control.
    #
    # ## Only NOLOGIN, because it is the one a non-superuser can always set
    #
    # The first version also stated NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
    # NOREPLICATION and NOBYPASSRLS. It FAILED the production deploy:
    #
    #     permission denied to alter role
    #     DETAIL: Only roles with the SUPERUSER attribute may change the
    #             SUPERUSER attribute.
    #
    # PostgreSQL requires the corresponding privilege to set these AT ALL, even
    # to the value the role already holds. On Cloud SQL `majorana_app` has
    # `cloudsqlsuperuser`, which grants CREATEROLE and is emphatically NOT
    # SUPERUSER, so that statement could never have succeeded there.
    #
    # It passed locally because the local run was Docker's `postgres`, a real
    # superuser. That is the whole lesson, and it is why this file says it
    # rather than quietly dropping the words: A PRIVILEGE MIGRATION TESTED AS A
    # SUPERUSER HAS NOT BEEN TESTED. Re-run against a role built to mirror
    # `majorana_app` - LOGIN, CREATEROLE, database owner, no SUPERUSER - it
    # immediately found a second: NOCREATEDB needs the CREATEDB attribute by the
    # same rule.
    #
    # NOLOGIN is the one that matters and the one a CREATEROLE holder can always
    # set on a role it administers. Everything else is checked below.
    op.execute("alter role app_rw nologin")

    # Everything that cannot be SET here is CHECKED, and refused loudly.
    #
    # Dropping the other five words silently would recreate exactly the hole this
    # migration exists to close: an `app_rw` carrying SUPERUSER or BYPASSRLS would
    # sail through, and the deploy would report that it had provisioned a
    # restricted role. Clearing any of them needs a privilege the migration
    # credential does not have, and therefore a human - so this says so instead of
    # pretending.
    op.execute(
        """
        do $$
        declare
          bad text;
        begin
          select string_agg(attr, ', ') into bad from (
            select 'SUPERUSER' as attr from pg_roles where rolname = 'app_rw' and rolsuper
            union all
            select 'REPLICATION' from pg_roles where rolname = 'app_rw' and rolreplication
            union all
            select 'BYPASSRLS' from pg_roles where rolname = 'app_rw' and rolbypassrls
            union all
            select 'CREATEDB' from pg_roles where rolname = 'app_rw' and rolcreatedb
            union all
            select 'CREATEROLE' from pg_roles where rolname = 'app_rw' and rolcreaterole
          ) s;
          if bad is not null then
            raise exception
              'app_rw carries %, which this migration cannot clear with the privileges it '
              'runs under. Clear it as a superuser and re-run the deploy - the role is NOT '
              'the restricted bundle this file describes.', bad;
          end if;
        end
        $$;
        """
    )

    # And the same argument one level further out: attributes are not the only
    # thing an existing role carries. MEMBERSHIPS are inherited, so an `app_rw`
    # that is already a member of some other role passes that role's privileges
    # straight through the bundle - and the whole design here is that the login
    # user's effective privileges are exactly the grants written in this file.
    #
    # Raised in review. Revoked rather than merely detected, and the loop is
    # deliberate: naming the roles to revoke would only cover the ones somebody
    # thought of, and this must hold against a restored dump nobody has read.
    # `format(%I)` quotes each identifier, so a role name needing quoting cannot
    # break the statement.
    #
    # Safe to run every deploy: on a database built from these migrations there
    # are no memberships to revoke and this is a no-op. It never touches
    # membership IN app_rw - the login user granted at cutover keeps its
    # membership, which is the one direction that must survive.
    op.execute(
        """
        do $$
        declare
          granted text;
        begin
          for granted in
            select r.rolname
            from pg_auth_members m
            join pg_roles r on r.oid = m.roleid
            where m.member = 'app_rw'::regrole
          loop
            execute format('revoke %I from app_rw', granted);
          end loop;
        end
        $$;
        """
    )

    # Reach the schema and the objects in it, but never create in it.
    op.execute("grant usage on schema public to app_rw")
    op.execute("revoke create on schema public from app_rw")
    # And revoke it from PUBLIC, which every role is a member of implicitly.
    #
    # Raised in review, and it is a real hole rather than tidiness: revoking CREATE
    # from `app_rw` alone leaves the grant it INHERITS from PUBLIC untouched, so
    # the role could still create objects in the schema through the back door.
    # PostgreSQL 15 removed that default and this database is 17, so on a database
    # built from these migrations it is already absent — but a database restored
    # from an older dump carries the old grant with it, and that is precisely the
    # database nobody re-checks. The owner keeps CREATE regardless of this line,
    # because ownership is not a grant, so migrations are unaffected.
    op.execute("revoke create on schema public from public")

    # The data-plane verbs, and only those. No TRUNCATE (it is DDL-shaped and
    # nothing in the application issues one), no REFERENCES, no TRIGGER.
    op.execute("grant select, insert, update, delete on all tables in schema public to app_rw")
    # Sequences back every `bigserial` primary key; without USAGE an INSERT fails
    # on nextval() rather than on the table, which is a confusing way to find out.
    op.execute("grant usage, select on all sequences in schema public to app_rw")

    # Tables and sequences that do not exist yet. No `FOR ROLE` - see the module
    # docstring; it defaults to the current role, which is the one creating them.
    op.execute(
        "alter default privileges in schema public "
        "grant select, insert, update, delete on tables to app_rw"
    )
    op.execute(
        "alter default privileges in schema public grant usage, select on sequences to app_rw"
    )

    # Append-only, re-asserted at the grant layer. See the module docstring.
    # Spelled out rather than looped, for the same reason as above: the three
    # table names are the thing a reviewer is checking.
    op.execute("revoke update, delete on run_events from app_rw")
    op.execute("revoke update, delete on audit_log from app_rw")
    op.execute("revoke update, delete on usage_events from app_rw")

    # The other four tables this repository has already decided are narrower than
    # full CRUD, taken back for the same reason.
    #
    # `grant ... on all tables` is a blunt instrument, and the three append-only
    # tables above are NOT the only ones it over-grants. Eight earlier migrations
    # carry per-table `app_rw` grants behind the same inert `if exists` guard, and
    # two of them are deliberately narrower than the schema-wide line in 0001:
    #
    #   0034_qpu_runs.py:96-97          qpu_runs: select, insert, update - NO delete
    #   0026_verification_v2_evidence   run_plans, candidate_semantic_reviews,
    #     .py:321-324                   candidate_verification_attempts:
    #                                   select, insert only - NO update, NO delete
    #
    # Those guards have never fired, because nothing ever created `app_rw` - so
    # the intent was recorded and never enforced. This migration is the first
    # thing that makes the role real, which makes it the first thing that could
    # QUIETLY WIDEN them: a blanket grant here would hand the application DELETE
    # on `qpu_runs` and UPDATE on the verification-evidence tables, and the only
    # trace that this was ever decided otherwise would be two dead code paths.
    #
    # Found by reading all nine `app_rw` migrations rather than the two this file
    # already knew about.
    op.execute("revoke delete on qpu_runs from app_rw")
    op.execute(
        "revoke update, delete on run_plans, candidate_semantic_reviews, "
        "candidate_verification_attempts from app_rw"
    )

    # Alembic's own bookkeeping, taken back completely.
    #
    # `grant ... on all tables` reached `alembic_version` too, which is a real
    # escalation and not a tidiness point: that table is the record of which
    # migrations have run. An injection path or a leaked application credential
    # could rewrite the version row, and the next `alembic upgrade head` would
    # then SKIP migrations that had never actually been applied - leaving the
    # schema in a state the deploy reports as current. The damage outlives the
    # incident and is invisible in the application.
    #
    # ALL, not just update/delete: nothing in the application has any business
    # reading this table either, and the migration credential is the owner, which
    # keeps full access regardless of what is revoked here. Raised in review.
    op.execute("revoke all on alembic_version from app_rw")


def downgrade() -> None:
    # Default privileges must come off before the role can be dropped - they are
    # recorded as a dependency on it, and `DROP ROLE` refuses while any remain.
    # This is the step that is easy to leave out and turns a downgrade into a
    # confusing "role cannot be dropped because objects depend on it".
    op.execute(
        "alter default privileges in schema public "
        "revoke select, insert, update, delete on tables from app_rw"
    )
    op.execute(
        "alter default privileges in schema public revoke usage, select on sequences from app_rw"
    )
    op.execute("revoke all on all tables in schema public from app_rw")
    op.execute("revoke all on all sequences in schema public from app_rw")
    op.execute("revoke all on schema public from app_rw")
    # Deliberately NOT dropped. Once the Cloud SQL login user has been granted
    # membership, dropping this role would break the application's connection -
    # and a downgrade is run to get OUT of trouble, not into more of it. Removing
    # the role is a manual step, documented beside the flip it reverses.
