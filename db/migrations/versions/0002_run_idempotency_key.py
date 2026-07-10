"""runs.idempotency_key — dedupe for POST /v1/runs retries (02-architecture.md §3:
every mutating endpoint supports idempotency keys; agents retry).

Revision ID: 0002
Revises: 0001

Nullable; uniqueness is per-workspace and only where a key was supplied
(partial unique index), so keyless creates are unaffected.
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("idempotency_key", sa.Text(), nullable=True))
    op.create_index(
        "uq_runs_workspace_idempotency_key",
        "runs",
        ["workspace_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_runs_workspace_idempotency_key", table_name="runs")
    op.drop_column("runs", "idempotency_key")
