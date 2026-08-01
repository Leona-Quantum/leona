"""Index the run allowance query, which was the only unindexed hot path.

Revision ID: 0039
Revises: 0038

`count_execute_runs_since` is the per-tier weekly allowance check, and it runs on
every single run submission. It filters `runs` on `user_id`, `mode` and
`created_at` — and every index on that table leads with `workspace_id`:

    ix_runs_workspace_created       (workspace_id, created_at DESC)
    ix_runs_workspace_folder        (workspace_id, folder_id)
    ix_runs_workspace_conversation  (workspace_id, conversation_id, created_at)
    uq_runs_workspace_idempotency_key (workspace_id, idempotency_key)

None of them can serve a `user_id` predicate, and a foreign key does not index
the referencing side in Postgres, so the query was a sequential scan of the whole
table. Measured on a scratch copy of this schema carrying 36,000 runs — 120
accounts a few months into steady use:

    Seq Scan on runs ... rows=42, Rows Removed by Filter: 35958
    Buffers: shared hit=693        Execution Time: 14.225 ms

    Index Only Scan using ix_runs_user_mode_created ... rows=42
    Buffers: shared hit=4 read=3   Execution Time: 2.068 ms

The 7x is not the argument. The argument is the shape: the scan costs
O(every run ever created by anybody) and the index costs O(this user's execute
runs inside the window), which the allowance itself bounds at five for a free
account. One is a number that grows with the product's success on the admission
path of the thing that makes it grow; the other is flat. The 693 buffers touched
per submission are also 693 pages of shared_buffers evicted for every other
query on a 1.7 GB instance.

`count_runs_by_mode_since` — the flat abuse backstop next to it — is deliberately
NOT given an index here. It binds `workspace_id`, so it already rides
`ix_runs_workspace_created`; measured on the same 36,000 rows it reads 7 buffers
in 0.2 ms.

Column order is equality, equality, range: `user_id` and `mode` are both `=`
predicates and `created_at` is the `>=`, so the range has to come last or the
index cannot seek. DESC on `created_at` matches `ix_runs_workspace_created` and
costs nothing either way for a count.

CONCURRENTLY is deliberately NOT used. It cannot run inside a transaction, and
this project applies migrations through Alembic's transactional runner in
`deploy.yml`; a non-transactional step there would leave a failure half-applied.
`runs` is small in absolute terms (thousands of rows), so the exclusive lock a
plain CREATE INDEX takes is measured in milliseconds. Revisit if this table ever
reaches the millions, when the lock — not the scan — becomes the problem.
"""

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_runs_user_mode_created",
        "runs",
        ["user_id", "mode", sa.text("created_at desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_runs_user_mode_created", table_name="runs")
