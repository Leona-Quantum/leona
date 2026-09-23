"""Course cohorts and certificates.

Revision ID: 0074
Revises: 0073

Proposal 8 (ai-ops 349, "Notebooks and courses for a class"), the cohorts and
certificates slice. The gradebook (PR 965) and due dates (PR 969, 972) are
already built; this adds the two pieces still open from that proposal, minus
LTI (needs a platform registration and signing keys — a new credential, out of
scope here) and signed Open Badges 3.0 (out of scope — the hosted-assertion
model needs no signing key at all).

## Numbering

`0074`, revising `0073` (notifications). Written as `0071` against `0069`; renumbered
at landing after presence (`0070`), tour signals (`0071`), notebook share links (`0072`)
and notifications (`0073`) landed first. Nothing below depends on the number.

## Two features, three tables

**Cohorts** (`course_cohorts`, `course_cohort_members`): the course creator
names groups ("Section A") and puts members in one each, so the gradebook and
its CSV can be filtered to a section. A member is in AT MOST ONE cohort per
course — `course_cohort_members`' primary key is `(course_id, user_id)`, so
moving someone is an upsert, never a second row to reconcile against the
first. No due-date override: `course_gradebook`'s due dates live on
`course_modules` and are read module-by-module across every member in one
query (`courses.py`'s `_is_late`/`can_be_missed`), with no per-member branch
anywhere in it. A cohort-level override would mean that query joining out to
`course_cohort_members` for every row it reads, on every gradebook read,
forever, to serve a feature nothing has asked for yet — the clean seam is a
per-member due date, not a per-cohort one, and it does not exist. Filtering is
a read-side concern and needs no override to be useful today.

**Certificates** (`course_certificates`): once a member has passed every
graded exercise in the course, they can claim one, choosing the name printed
on it. It is shown and downloadable as an Open Badges 2.0 hosted assertion at
a PUBLIC, anonymous URL — `05-security.md` §1a's "new anonymous route" — which
is why its primary key is not `uuid7()`: that scheme (`ids.py`) is 74 bits of
randomness after its sortable prefix, fine for a row nobody but its own
workspace ever addresses, and wrong for one whose id IS the credential that
gates a public read. `repos/certificates.py` mints this table's `id` from
`secrets.token_bytes(16)` laid into a UUID column with no version or variant
bits forced — a full 128 bits of OS-CSPRNG entropy, at the cost of the value
not being a spec-conformant UUID, which nothing here needs it to be.

## Row-level security

`course_cohorts` and `course_cohort_members` get 0059's own `_child_policy`
text unchanged: the tenant resolves through `courses`, same shape as
`course_modules`/`course_turns`, so no live probe entry is warranted in
`tests/rls/test_rls_policies.py` for the same reason those two never got one
(its docstring's "every distinct join shape" — this is not a new one).

`course_certificates` carries that same child policy PLUS a second, `for
select`-only, permissive policy: a row is also visible when its `id` matches
`leona.public_certificate_id`, a GUC only `repos/certificates.py`'s public read
path ever sets (mirroring `repos/news.py`'s `leona.news_workspace_id`). Two
policies rather than one wider predicate because the escape hatch must never
reach `with check` — the public path only ever selects, and a policy declared
`for select` cannot be consulted for an insert, update or delete no matter
what its `using` clause says. Both policies are permissive-by-default the
0053 way: `majorana.rls_enforce` off (production, today) makes every row
visible regardless, so installing this changes no live behaviour.

RLS enforcement is not what makes the public certificate route safe, and
`docs/adr/0028-rls-defense-in-depth.md` says why: enforcement is off in every
deployed environment. The actual boundary is that `repos/certificates.py`'s
public function is the only caller that ever sets `leona.public_certificate_id`,
selects a fixed, name-checked column list (never `select *`), and is reached
only from a route that requires no `Scope` at all. RLS here is the second lock
on a door the first lock already holds shut.

## Downgrade refuses once data exists

Same rule as 0059, 0064, 0065, 0067: a cohort a person named, a membership they
assigned, or a certificate someone claimed cannot be reconstructed from
anything else in the database, so the downgrade refuses rather than discards it.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def _child_policy(table: str) -> str:
    """0059's own policy text for a table that resolves its tenant through
    `courses`, unchanged — see this migration's docstring on why that is
    deliberate rather than an oversight."""
    predicate = (
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        f"select 1 from courses c where c.id = {table}.course_id and "
        "c.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )
    return (
        f"create policy tenant_isolation on {table} for all using ({predicate}) "
        f"with check ({predicate})"
    )


def upgrade() -> None:
    # ------------------------------------------------------------------ cohorts
    op.create_table(
        "course_cohorts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("course_id", "name", name="uq_course_cohorts_course_name"),
        # Trivially unique (id alone is the primary key); Postgres requires the
        # constraint to exist before course_cohort_members' composite foreign
        # key can name it — the same reason 0068 adds one on comments.
        sa.UniqueConstraint("course_id", "id", name="uq_course_cohorts_course_identity"),
        sa.CheckConstraint(
            "char_length(name) between 1 and 80", name="ck_course_cohorts_name_length"
        ),
    )
    op.create_index("ix_course_cohorts_course_id", "course_cohorts", ["course_id"])

    op.create_table(
        "course_cohort_members",
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cohort_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        # A member is in AT MOST ONE cohort per course: the primary key IS that
        # rule, not a unique index policed beside it. Moving someone is an
        # upsert onto this key (`ON CONFLICT (course_id, user_id) DO UPDATE`),
        # never a delete-then-insert racing a concurrent read.
        sa.PrimaryKeyConstraint("course_id", "user_id", name="pk_course_cohort_members"),
        # Ties this row's cohort to the SAME course, so a cohort id from another
        # course can never be written here — the same shape 0068 uses to keep a
        # comment_mentions row in its comment's workspace.
        sa.ForeignKeyConstraint(
            ["course_id", "cohort_id"],
            ["course_cohorts.course_id", "course_cohorts.id"],
            name="fk_course_cohort_members_cohort_same_course",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    # "Everyone in this cohort" (the gradebook filter): `WHERE course_id = :c AND
    # cohort_id = :cohort`, an index seek rather than a scan of the course's roster.
    op.create_index(
        "ix_course_cohort_members_cohort", "course_cohort_members", ["course_id", "cohort_id"]
    )

    op.execute("alter table course_cohorts enable row level security")
    op.execute(_child_policy("course_cohorts"))
    op.execute("alter table course_cohort_members enable row level security")
    op.execute(_child_policy("course_cohort_members"))

    # -------------------------------------------------------------- certificates
    op.create_table(
        "course_certificates",
        # NOT uuid7() — see this migration's docstring. 128 bits from the OS
        # CSPRNG, minted by `repos/certificates.py::new_certificate_id`.
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Chosen by the learner at claim time (default their display name).
        # Printed on the badge and shown on the public page; never their email.
        sa.Column("recipient_name", sa.Text(), nullable=False),
        # A SNAPSHOT of `courses.title` at claim time, not a live read of it.
        # Two reasons, one of which is load-bearing: a certificate is a
        # historical record and should keep saying what the course was called
        # the day it was earned, even if the course is renamed afterward; and
        # `repos.certificates.public_assertion_row` — the anonymous read this
        # column exists for — must resolve the whole assertion from ONE table.
        # A join out to `courses` for its title would need `courses`' OWN RLS
        # policy to carry a matching public escape valve too, which it does
        # not: under enforcement (tests only; off in every deployed
        # environment) the join would silently return no course at all. This
        # column is what makes the public route need no escape valve on any
        # table but its own.
        sa.Column("course_title", sa.Text(), nullable=False),
        sa.Column(
            "issued_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["revoked_by_user_id"], ["users.id"]),
        # One certificate per member per course: claiming again returns the
        # existing row (`repos.certificates.claim_certificate` is a get-or-create),
        # revoked or not, rather than accumulating a second credential for the
        # same completion.
        sa.UniqueConstraint("course_id", "user_id", name="uq_course_certificates_course_member"),
        sa.CheckConstraint(
            "char_length(recipient_name) between 1 and 200",
            name="ck_course_certificates_recipient_name_length",
        ),
        # Same bound as `ck_courses_title_length` (0059): a snapshot of a title
        # that length already bounds.
        sa.CheckConstraint(
            "char_length(course_title) between 1 and 240",
            name="ck_course_certificates_course_title_length",
        ),
        sa.CheckConstraint(
            "(revoked_at is null) = (revoked_by_user_id is null)",
            name="ck_course_certificates_revocation_pair",
        ),
    )
    op.create_index("ix_course_certificates_course_id", "course_certificates", ["course_id"])

    op.execute("alter table course_certificates enable row level security")
    op.execute(_child_policy("course_certificates"))
    # The public hosted-assertion read: a row is also visible, for SELECT only,
    # when its id is the one the caller's request named. `for select` (not `for
    # all`) so this can never be consulted for an insert, update or delete —
    # see the module docstring's "must never reach `with check`".
    op.execute(
        "create policy public_certificate_read on course_certificates for select using ("
        "id = nullif(current_setting('leona.public_certificate_id', true), '')::uuid)"
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update, delete
              on course_cohorts, course_cohort_members, course_certificates to app_rw;
          end if;
        end
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from course_certificates) then
            raise exception 'cannot downgrade 0074: a certificate has been claimed';
          end if;
          if exists (select 1 from course_cohort_members) then
            raise exception 'cannot downgrade 0074: a cohort has members assigned';
          end if;
          if exists (select 1 from course_cohorts) then
            raise exception 'cannot downgrade 0074: a cohort has been created';
          end if;
        end
        $$;
        """
    )
    op.drop_index("ix_course_certificates_course_id", table_name="course_certificates")
    op.drop_table("course_certificates")
    op.drop_index("ix_course_cohort_members_cohort", table_name="course_cohort_members")
    op.drop_table("course_cohort_members")
    op.drop_index("ix_course_cohorts_course_id", table_name="course_cohorts")
    op.drop_table("course_cohorts")
