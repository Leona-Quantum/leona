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

    # Reach the schema and the objects in it, but never create in it.
    op.execute("grant usage on schema public to app_rw")
    op.execute("revoke create on schema public from app_rw")

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
