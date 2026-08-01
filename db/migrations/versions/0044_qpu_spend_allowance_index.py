"""Index the hardware spend allowance query, added with the allowance itself.

Revision ID: 0044
Revises: 0043

`qpu_runs.authorized_spend_since` is the weekly hardware spend check, and it
runs on every billed submission. It filters `qpu_runs` on `user_id` and
`created_at`, and migration 0034 gave that table one index beyond its primary
key:

    ix_qpu_runs_workspace_created   (workspace_id, created_at DESC)

Which cannot serve a `user_id` predicate — a foreign key does not index the
referencing side in Postgres — so the sum was a sequential scan of every
hardware run the platform has ever recorded.

Added in the same migration as the allowance rather than after a slow query is
noticed, because 0039 already learned this on `runs`: the shape is what matters,
not today's row count. The scan costs O(every hardware run by anybody) and the
index costs O(this account's runs inside the window), which the allowance itself
bounds. `qpu_runs` is small today only because the submission gate has never
been open in production; the first week it is, this is the admission path for
every hardware job on the platform.

Column order is equality then range: `user_id` is the `=` predicate and
`created_at` the `>=`, so the range comes last or the index cannot seek. DESC
matches `ix_qpu_runs_workspace_created` and costs nothing either way for a sum.

The status/submitted_at exclusion in `_authorized_spend` is deliberately NOT in
the index. It removes a rare state — a record that errored before ever reaching
the provider — so it filters almost nothing, and carrying two more columns
through every index entry to save a heap fetch on a set the window already
bounds is a cost with no purchase.

CONCURRENTLY is deliberately not used, for the reason 0039 states: it cannot run
inside a transaction, and `deploy.yml` applies migrations through Alembic's
transactional runner, where a non-transactional step would leave a failure
half-applied.
"""

import sqlalchemy as sa
from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_qpu_runs_user_created",
        "qpu_runs",
        ["user_id", sa.text("created_at desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_qpu_runs_user_created", table_name="qpu_runs")
