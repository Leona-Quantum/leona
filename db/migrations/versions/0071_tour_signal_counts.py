"""Guided-tour step signal counts (ai-ops 326).

Revision ID: 0071
Revises: 0070

## What this stores, and what it deliberately does not

The guided tours already emit ten kinds of signal — `apps/web/lib/tour/signal.ts`
— carrying a track name and a step name and nothing else. Until now nothing
listened: they used to reach Vercel Web Analytics, which the owner switched off
for cost (ai-ops 308), and ai-ops 324 deferred picking a new destination until
the website's move to Google Cloud landed. It has, so this is that destination —
his stated preference on 324, option 1: "our own API, on a small endpoint that
stores the counts."

This table holds exactly one row per `(day, track, step, kind)` and one integer:
how many times that combination happened, ever, on that UTC calendar day. It
carries no IP, no user id, no user agent, no session identifier and no
timestamp finer than the day — there is no column any of those could go in.
`day` is a `date`, not a `timestamptz`; the route computes it from
`datetime.now(timezone.utc).date()` before the row is touched, so the boundary
is always UTC midnight regardless of which Cloud Run region or which reader's
clock produced the request.

## Row-level security — GLOBAL, same reason as the three 0053 already names

0053's classification (`db/migrations/versions/0053_rls_defense_in_depth.py`)
sorts every table into one of five groups. This table fits none of the four
that carry tenant data, because it has no `workspace_id` and no `user_id`
column at all — there is no tenant to key a policy on. It belongs with the
**GLOBAL / IDENTITY** and **SYSTEM / WORKER-WIDE** groups for the same reason
0053 gives those: it "deliberately carries NO policy", not because enforcement
happens to be off (it is, everywhere, per 0053 — this migration does not touch
`majorana.rls_enforce` and does not flip it), but because a workspace- or
user-scoped predicate would have nothing on this row to compare against. A
policy of `workspace_id = current_setting(...)` on a table with no
`workspace_id` column is not a stricter version of protection, it is a
category error.

So: `ENABLE ROW LEVEL SECURITY` is **not** called here, and no `CREATE POLICY`
is written. RLS as a mechanism stays exactly as 0053 left it — installed on the
32 (now 33, since 0069) tables that classification names, not enforced anywhere
— and this migration adds a 34th table outside that mechanism entirely, the
same way `jobs`, `import_jobs` and `import_items` sit outside it today. The
protection this table actually needs is bounded cardinality on `track`/`step`/
`kind`, enforced at the API layer (services/api's route validates every value
against a fixed, mechanically-derived vocabulary before it ever reaches a
query) and by the two CHECK constraints below as a second, independent line.

## Why an upsert primary key rather than an identity column plus a unique index

`(day, track, step, kind)` is the natural key and every write is
`INSERT ... ON CONFLICT (day, track, step, kind) DO UPDATE SET count = count +
1` (`repos/tour_signals.py`), so making that tuple the primary key is the
direct statement of what the table is — the conflict target IS the identity of
the row — rather than a synthetic id sitting beside a separately-declared
unique constraint that says the same thing twice.

## `kind` is CHECKed against a literal list, `track`/`step` are not

`kind` is the ten-member closed enum in `signal.ts` and is expected to change
about as often as the product ships a new category of tour interaction —
rarely, and always alongside a code review of this migration's sibling. Written
out as a literal here rather than imported, the same choice 0069 makes for
`_SCOPES`: a later kind needs its own migration to widen this CHECK, which is
the review point, and this file keeps saying what it said on the day it ran
even after the enum gains a member.

`track` and `step` are not CHECKed against a literal list, on purpose — that
list is `services/api/src/majorana_api/tour_signal_vocabulary.py`, which mirrors
the live tour definitions in `apps/web/lib/tour/tracks.ts` and is expected to
change every time a tour gains or loses a step. A DB CHECK constraint listing
every track and step would need a migration for every tour edit, which is
exactly the coupling the vocabulary module and its web-side drift test
(`apps/web/lib/tour/signal-vocabulary.test.ts`) exist to avoid. What IS
CHECKed here is shape: non-empty, bounded length — a floor under "some string",
not a ceiling that has to track tour content.

## Grants

No explicit GRANT/REVOKE. 0052's `ALTER DEFAULT PRIVILEGES` already hands
`app_rw` select/insert/update/delete on every table a migration creates; unlike
`comments` or `personal_access_tokens`, this table has no "the row must never
disappear" property (0068/0069's argument for revoking DELETE) — there is no
audit or credential story here, only a count, and leaving DELETE granted keeps
open the ordinary future need to prune old days. So the default stands
unmodified, and that is a decision, not an oversight.

## Downgrade

Drops the table outright. There is no "cannot downgrade while rows exist" guard
of the kind 0069 puts on tokens: unlike a live credential, a lost aggregate
count is not an active thing you break by deleting its record — it is a metric
that stops being answerable for that stretch of history, which is the same
cost dropping any other analytics table has.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None

#: Mirrors `apps/web/lib/tour/signal.ts`'s `TOUR_SIGNAL_KINDS` and
#: `services/api/src/majorana_api/tour_signal_vocabulary.py`'s `TOUR_SIGNAL_KINDS`.
#: Written out as a literal rather than imported — see the module docstring.
_KINDS = (
    "tour_started",
    "step_done",
    "step_skipped",
    "did_it_for_me",
    "offline_skip",
    "tour_done",
    "tour_left",
    "step_missed",
    "ask_show_me",
    "ask_nala",
)


def upgrade() -> None:
    op.create_table(
        "tour_signal_counts",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("track", sa.Text(), nullable=False),
        sa.Column("step", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("day", "track", "step", "kind", name="pk_tour_signal_counts"),
        sa.CheckConstraint(
            "char_length(track) between 1 and 64", name="ck_tour_signal_counts_track_length"
        ),
        sa.CheckConstraint(
            "char_length(step) between 1 and 64", name="ck_tour_signal_counts_step_length"
        ),
        sa.CheckConstraint(
            "kind = any(array[{members}]::text[])".format(
                members=", ".join(f"'{kind}'" for kind in _KINDS)
            ),
            name="ck_tour_signal_counts_kind",
        ),
        sa.CheckConstraint("count >= 0", name="ck_tour_signal_counts_count_nonnegative"),
    )
    # The owner's read path (`services/api/scripts/tour_signal_counts.py`) asks
    # for a date range first and a track/kind breakdown second; the primary key
    # already leads with `day`, so this index only exists for the query shape
    # that does NOT start from a day — "which steps in `build` do people miss" —
    # without a full scan of every day on record.
    op.create_index(
        "ix_tour_signal_counts_track_step_kind",
        "tour_signal_counts",
        ["track", "step", "kind"],
    )


def downgrade() -> None:
    op.drop_table("tour_signal_counts")
