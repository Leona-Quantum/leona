"""Saving to the Vault becomes a choice.

Revision ID: 0036
Revises: 0035

Until now every successful run put an artifact in the Vault, and the owner asked
for that to be the user's decision. The shape that survives the rest of the
product is NOT "skip the save": the Run surface's conversion tabs read the saved
artifact version (run events carry no QASM), and the next run in a conversation
forks from `run.artifact_version_id`. Both break silently if a run has no
artifact.

So a run still always materializes, and `kept_at` decides whether the result is
listed in the Vault. NULL means "this run has a record, but the user has not
asked to keep it"; a timestamp means it is theirs.

`workspaces.auto_keep_artifacts` is the settings toggle, default FALSE — the
owner asked for opt-in. It is read at save time, so flipping it does not
retroactively keep or unkeep anything.

The backfill is the load-bearing part of this migration: every existing artifact
is stamped kept, because they were all saved under a promise that they were being
kept. Without it this migration silently empties every Vault in the deployment.
"""

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("artifacts", sa.Column("kept_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "workspaces",
        sa.Column(
            "auto_keep_artifacts",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Everything that already exists was saved on the old promise. COALESCE
    # because created_at is nullable in the model; an artifact with no creation
    # time still must not vanish from the list.
    op.execute("UPDATE artifacts SET kept_at = COALESCE(created_at, now()) WHERE kept_at IS NULL")
    # The Vault list filters on this on every page load.
    op.create_index(
        "ix_artifacts_workspace_kept",
        "artifacts",
        ["workspace_id", "kept_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_artifacts_workspace_kept", table_name="artifacts")
    op.drop_column("workspaces", "auto_keep_artifacts")
    op.drop_column("artifacts", "kept_at")
