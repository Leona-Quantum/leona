"""Give workspace folders a user-controlled order.

Revision ID: 0040
Revises: 0039

Folders have been listed by `created_at, id` since migration 0006 — the order you
happened to make them in, which nobody chose and nobody can change. The owner
asked for drag-to-reorder in the Run sidebar, and ordering is not derivable from
anything already in the table.

`position` is a plain integer, not a fractional index. Reordering rewrites the
whole workspace's folders to 0..n-1 in one statement, because the client already
holds the complete ordered list (there are at most a few dozen folders in a
workspace, and the UI drag ends with the full order in hand). A fractional index
buys nothing here and costs a rebalancing path that would be exercised roughly
never and therefore be wrong when it ran.

NOT unique, deliberately. A unique constraint on (workspace_id, position) turns
every reorder into an ordering problem of its own — you cannot move folder 3 to
slot 1 without transiently colliding, so you need either a negative-offset dance
or DEFERRABLE. Ties are broken by `created_at, id`, exactly as before, so a
duplicated position degrades to the old behaviour rather than to a random order.

Backfilled by `created_at, id` so the list a user sees the moment this deploys is
byte-identical to the list they saw before it. `row_number()` is 1-based; the
subtraction makes the first folder 0 to match the array index the client sends.
"""

import sqlalchemy as sa
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_folders",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        """
        update workspace_folders as f
           set position = ordered.rn - 1
          from (
                select id,
                       row_number() over (
                           partition by workspace_id
                           order by created_at, id
                       ) as rn
                  from workspace_folders
               ) as ordered
         where f.id = ordered.id
        """
    )
    # Serves the list query's `order by position, created_at, id` within a
    # workspace. Folder counts are small, but this is the query that runs on
    # every sidebar render for every signed-in person.
    op.create_index(
        "ix_workspace_folders_workspace_position",
        "workspace_folders",
        ["workspace_id", "position"],
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_folders_workspace_position", table_name="workspace_folders")
    op.drop_column("workspace_folders", "position")
