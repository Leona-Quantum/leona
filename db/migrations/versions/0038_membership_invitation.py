"""An invitation is something the invited person can be told about.

Revision ID: 0038
Revises: 0037

Migration 0037 gave a user more than one workspace, and the routes above it gave
an admin a way to attach somebody to one. What none of it gave the *invited*
person is any way to find out. They are attached silently: no email, no notice,
nothing in the switcher that distinguishes a workspace they were added to five
minutes ago from one they have been in for a month. Somebody has to tell them out
of band, and if nobody does, the invite does nothing at all.

Two columns, because a notice has to answer two questions the memberships table
could not:

`invited_by_user_id` — *who* added me. Without it the only honest sentence is
"you were added to X", which reads like something the system did. ON DELETE SET
NULL: an inviter's account going away must never be what refuses to delete it,
and the notice degrades to the impersonal wording rather than breaking.

`acknowledged_at` — whether the notice has been *seen*. NULL means outstanding.
A timestamp is written when the person opens the workspace, dismisses the notice,
or leaves — three different actions with one thing in common: afterwards they
know. The alternative was a client-side "seen" list, which forgets on every new
device and would re-announce a months-old membership to someone who cleared their
browser storage.

The backfill is the load-bearing part. Every membership that exists today was
either self-created or already known about out of band, so all of them are
stamped acknowledged. Without this line, the deploy that ships it tells every
existing user they have just been added to workspaces they have been working in
for weeks — including their own personal one, which nobody invited them to.

Deliberately NOT a separate `invitations` table. There is no pending state to
model: `add_member_by_email` grants access immediately (it can only name an
account that already exists on this deployment), so the membership row IS the
invitation, and a second table would be a second source of truth for the same
fact.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "memberships",
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_memberships_invited_by_user_id",
        "memberships",
        "users",
        ["invited_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Everything that already exists predates the notice. COALESCE because
    # created_at is nullable in the model, and an undated membership must not
    # become an announcement.
    op.execute(
        "UPDATE memberships SET acknowledged_at = COALESCE(created_at, now()) "
        "WHERE acknowledged_at IS NULL"
    )
    # The notice is read on every authenticated page load, for one user, and is
    # empty almost every time. Partial so the index holds only the outstanding
    # rows rather than every membership in the deployment.
    op.create_index(
        "ix_memberships_unacknowledged",
        "memberships",
        ["user_id"],
        postgresql_where=sa.text("acknowledged_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_memberships_unacknowledged", table_name="memberships")
    op.drop_constraint("fk_memberships_invited_by_user_id", "memberships", type_="foreignkey")
    op.drop_column("memberships", "acknowledged_at")
    op.drop_column("memberships", "invited_by_user_id")
