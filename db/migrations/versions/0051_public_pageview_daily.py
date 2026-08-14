"""public_pageview_daily — give the pageview counter a memory longer than the log.

Revision ID: 0051
Revises: 0050

`#536` added a cookie-free public pageview counter that writes one JSON line per
request to the Vercel runtime log. It costs nothing and it answers a real
question, but a log is not a record: base-plan runtime logs retain for **one
day**. The 30-day window the project has today comes from the metered
Observability Plus add-on, and if that is ever switched off the history silently
collapses back to a day with nothing in this repo noticing. Measured 2026-08-14:
log lines were still present 19–20 days back and absent 30–31 days back, so the
add-on is on right now — which is exactly the kind of fact that should not be
load-bearing.

This table is the durable half. A scheduled job (`scripts/collect_pageviews.py`,
`.github/workflows/pageview-trends.yml`) reads the day's lines out of the log
while they still exist and writes one row per (day, route). The log stays the
transport; this becomes the memory.

## Why `day` is a DATE the emitter chose, not one this table computes

`apps/web/lib/pageview-signal.ts` stamps `day` at request time as
`now.toISOString().slice(0, 10)` — a UTC calendar day, fixed by the process that
saw the request. The collector copies that value through verbatim and never
computes a day of its own.

That is deliberate, and it is the whole answer to the "a scheduled cloud job's
'today' is UTC, not the owner's day" trap: a collector that derived the day from
its own clock would attribute traffic differently depending on what time the
cron happened to fire, and re-running it at a different hour would produce
different history. Here the boundary is decided once, at the edge, by the only
process that knows when the request actually happened. Re-running the collector
at any hour produces identical rows.

The consequence to know: **these are UTC days.** A "Monday" here starts at
00:00 UTC, not in Eshaan's timezone. Changing that later means changing the
emitter, not this table — and it would reinterpret every row already written, so
it is a decision to take once rather than drift into.

## Why upsert-replace, and why this table is NOT append-only

`views` is the total observed for a (day, route) pair, so a re-run must
overwrite rather than add — running the collector twice must not double the
count. The primary key exists to make that an `ON CONFLICT ... DO UPDATE`.

This is the opposite of the treatment `run_events`, `audit_log` and
`usage_events` got in `0050`, and the difference is real rather than an
oversight: those three are an audit trail, where a correction is a new row and
mutability is the bug. This is a rolling aggregate of an external source, where
the current day is legitimately incomplete until the day ends and the *next*
run is what completes it. Making it append-only would freeze partial counts as
permanent history.

`collected_at` records when the row was last written, so a stale figure is
visible as stale rather than being indistinguishable from a fresh zero.

## Why no workspace_id

These are counts of anonymous public-page requests. There is no tenant
dimension to scope — the counter carries no identifier of any kind, by design
("this counts pageviews, never people"). Nothing here is tenant data, so
nothing here belongs behind a `Scope`, and this table is deliberately not
reachable from the repository layer or any request handler.
"""

import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "public_pageview_daily",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("route", sa.Text(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.Column(
            "collected_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("day", "route", name="pk_public_pageview_daily"),
        sa.CheckConstraint("views >= 0", name="ck_public_pageview_daily_views_nonneg"),
    )
    # The only query this table is meant to serve is "the last N days, ordered",
    # for a trend line. The primary key already leads with `day`, so a range scan
    # on it is covered; no second index is added for a table that gains ~9 rows a
    # day and would spend more on index maintenance than it saves.


def downgrade() -> None:
    op.drop_table("public_pageview_daily")
