"""ix_runs_workspace_id_desc — make run history cost your own rows, not everyone's.

Revision ID: 0051
Revises: 0050

`GET /v1/runs` is `repos.runs.list_runs`, and it reads:

    WHERE workspace_id = :ws [AND status = :s] [AND id < :cursor]
    ORDER BY id DESC LIMIT :n

`runs` had no index leading with `workspace_id` and ordered by `id`. The nearest
was `ix_runs_workspace_created (workspace_id, created_at DESC)`, on the wrong
column: run ids are uuid7 and so *are* time-ordered, but that is a fact about how
we mint them, not one the planner can use.

What Postgres did instead is the interesting part, and it is not the missing sort
you would expect. It scanned the PRIMARY KEY backwards — `id` is the ordering
column, so no sort is needed — and applied `workspace_id` as a filter, discarding
every row belonging to somebody else until it had collected fifty of yours.

That is why this is a launch concern rather than a tidy-up. **The cost is
proportional to how many OTHER workspaces are active, not to the size of your own
history.** One tenant on a quiet table pays nothing; the same query on a shared
table pays for everyone's runs interleaved ahead of its own, and it gets worse
with every account that signs up. It is the shape that degrades precisely as the
product succeeds.

Measured, not argued. 40,022 runs across 129 workspaces (migration 0039's own
"36,000 runs / 120 accounts a few months into steady use"), Postgres 17, first
page, `EXPLAIN (ANALYZE, BUFFERS)`:

    before   Index Scan Backward using runs_pkey   5,893 rows discarded
             160 buffers                           0.504 ms
    after    Index Scan using ix_runs_workspace_id_desc       0 discarded
             53 buffers                            0.096 ms

5.2x faster, a third of the buffers, and — the number that matters — the 5,893
discarded rows become 0 and stop growing with the tenant count.

`status` is deliberately NOT in the index. The filtered variant is measured too
(0.253 ms before, 0.258 ms after): it keeps the index for ordering and filters
`status` from the heap, which is a wash. A four-value column with no selectivity
does not earn a place in a composite key, and adding it would slow every write to
the most write-heavy table in the schema to buy nothing.

DESC is written explicitly rather than relying on backward scanning, so the index
also serves the cursor form (`id < :cursor ORDER BY id DESC`) as a plain forward
scan from the cursor.

Index only: no column added, no data rewritten, no lock beyond what a plain
CREATE INDEX takes. Reversible by dropping it, and the query then plans exactly
as it does today. CONCURRENTLY is not used because Alembic runs each migration
inside a transaction, which forbids it; `runs` is small enough at present that
the ordinary build is brief, and the deploy already holds a maintenance window
for the migration step.
"""

import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_runs_workspace_id_desc",
        "runs",
        ["workspace_id", sa.text("id desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_runs_workspace_id_desc", table_name="runs")
