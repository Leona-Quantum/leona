"""A project can be granted to someone outside the workspace that owns it.

Revision ID: 0042
Revises: 0041

Until now there was exactly one way into an artifact row and it was the workspace
it lives in. This table is a **second door**, and the whole design of it is about
keeping that door narrow enough to reason about.

Four choices worth the words:

- **The grantee is a USER, not a workspace.** Access follows the person: whichever
  of their own workspaces is active, a shared project is theirs to open. Granting
  to a workspace would hand every current *and future* member of that workspace a
  way into another tenant's rows — a door whose width changes later without the
  granter doing anything.
- **Revoking DELETEs the row.** The obvious alternative, a `revoked_at` stamp,
  adds a narrowing predicate to every query that reads this table, and the failure
  mode of forgetting one is that access WIDENS. A deleted row cannot be forgotten.
  The history is not lost: `audit_log` records the grant and the revoke, and that
  table is append-only by grant, which this one deliberately is not.
- **`expires_at` is the only narrowing predicate that survives**, and it is
  evaluated in exactly one function (`repos/shares.resolve_share`). Everything
  else in the codebase takes the resolved access object rather than this row.
- **CASCADE on `project_id`.** A grant to a project that no longer exists is not a
  thing; deleting the project must take its grants with it, and it must not be
  possible to leave one behind by forgetting a line in the repository. This is the
  opposite call from `artifacts.project_id` (0041, no cascade) for the opposite
  reason: there, the contents are the user's work and must survive their
  container; here, the row IS the container's own permission.

`grantee_user_id` gets its own index. Postgres indexes the *referenced* side of a
foreign key, not the referencing one, and "which projects are shared with me" is
the query behind every render of the grantee's rail. `(project_id, grantee_user_id)`
is unique and serves the other direction as a prefix scan, so `project_id` needs no
second index of its own.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_shares",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("grantee_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # 'viewer' | 'editor' — a ShareRole, deliberately NOT the workspace Role.
        # Reusing Role would make `require_write(scope)` look like it answers a
        # question about a grant, and it does not.
        sa.Column("role", sa.Text, nullable=False),
        sa.Column(
            "granted_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        # NULL = the grant does not expire. A time-limited share is the one thing
        # that makes an over-broad grant self-correcting, so it is here from the
        # start rather than added once somebody has shared something forever.
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True)),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # One row per (project, person). A second grant to the same person is a role
    # change, not a second door — and under two concurrent grants it is the
    # database that has to say so, not the repository's read-then-write.
    op.create_index(
        "uq_project_shares_project_grantee",
        "project_shares",
        ["project_id", "grantee_user_id"],
        unique=True,
    )
    op.create_index("ix_project_shares_grantee", "project_shares", ["grantee_user_id"])
    op.execute(
        """
        do $$
        begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update, delete on project_shares to app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_project_shares_grantee", table_name="project_shares")
    op.drop_index("uq_project_shares_project_grantee", table_name="project_shares")
    op.drop_table("project_shares")
