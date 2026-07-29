"""A user can be in more than one workspace, and one of them is current.

Revision ID: 0037
Revises: 0036

Every request has so far derived its Scope from the caller's *personal*
workspace, because that was the only tenant the product exposed. Collaboration
needs a second answer to "which workspace is this request acting in", and there
are two shapes it can take: a per-request header the browser sends, or a
server-side pointer.

This is the pointer, and the reason is failure mode rather than elegance. With a
header, every proxy route in the web app has to forward it, and a route that
forgets it does not error — it silently acts on the personal workspace, so the
user reads one workspace's Vault while their runs land in another. With a
column, `get_scope` is the only code that decides, and no route can forget.

NULL means the personal workspace, so every existing row already has the right
value and there is nothing to backfill. The pointer is a preference, not a
grant: it is re-checked against `memberships` on every request, and a stale one
(access revoked, workspace deleted) resolves back to personal rather than
locking the user out.

ON DELETE SET NULL because workspaces are soft-deleted today; if one is ever
removed for real, the pointer must not be what refuses the delete.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("active_workspace_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_active_workspace_id",
        "users",
        "workspaces",
        ["active_workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_active_workspace_id", "users", type_="foreignkey")
    op.drop_column("users", "active_workspace_id")
