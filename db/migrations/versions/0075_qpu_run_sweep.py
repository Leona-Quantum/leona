"""What a Studio hardware sweep needs: `qpu_runs.sweep`.

Revision ID: 0075
Revises: 0069

ai-ops 349, "More hardware, and better handling of jobs": a Studio parameter
sweep submitted to hardware as one job, every point its own PUB, the same
one-job-many-PUBs mechanism migration 0066 already shipped for zero-noise
extrapolation.

`down_revision` is 0069, not the 0070 already on `dev` in this branch: four
other migrations were being written against 0069 at the same time this one
was, each claiming its own number in 0071-0074, and the orchestrator relinks
the actual landing order (this file's own number included) when they merge.
Branching from the shared ancestor rather than guessing which of five
in-flight migrations would land first is what keeps that relinking a rewrite
of `down_revision` fields instead of a merge conflict inside a migration body.

## Why a new column, not a key inside `mitigation`

`qpu_runs.mitigation` (migration 0066) already holds versioned, per-PUB extra
data — it could technically carry this too. It is not used for that here
because its own migration documents it as noise-mitigation inputs (the ZNE
opt-in, a readout calibration snapshot, folded-circuit counts), and a
parameter sweep is neither zero-noise extrapolation nor a calibration read.
Reusing it would mean either rewriting what `mitigation` means everywhere it
is documented, or leaving that documentation silently wrong for the next
reader — the "doc comment that stops matching what changed" failure mode this
codebase has records of elsewhere. A second column, versioned and NULL-until-
used the same way, costs one migration and keeps both names true.

## What goes in it

One JSON object, shaped by `majorana_qpu.sweep` (version 1), written in three
steps and never rewritten after the run finishes — mirroring 0066 exactly:

- **At submission, by the API**: `{"version": 1, "parameter_label": ...,
  "bindings": [{"label": ..., "qasm": ...}, ...]}`, one entry per swept point.
  The full per-point programs live on the row, not the job payload, for the
  same reason `qasm` itself does: the worker resubmits from the row, never
  from request memory.
- **At submit, by the worker**: each PUB's transpiled two-qubit gate count,
  added beside the request.
- **At completion, by the worker**, with `raw_counts`: every binding's raw
  counts, in binding order (including the one `raw_counts` already carries —
  see `majorana_qpu.sweep`'s docstring for why a sweep keeps the whole list
  rather than the "everything but the first" shape ZNE's folded counts use).

NULL means this run was not a sweep, which is true of every row written before
this migration and every ordinary single-circuit or ZNE submission after it.

## The CHECK

Only that it is an object, for the same reason 0066's is: the shape inside is
versioned and read defensively, and a CHECK on the inner shape would need
migrating every time the version moved without stopping a well-formed
document with wrong numbers in it.

## Privileges and row-level security

Nothing to add, checked the same way 0065 and 0066 were. `app_rw` holds
TABLE-level `select, insert, update` on `qpu_runs` (0034, re-asserted by 0052);
no migration grants column-level privileges, so a new column is covered by the
existing grant. The RLS policies from 0053 and 0054 are row predicates on
`workspace_id`, which a new column does not change.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0075"
down_revision = "0069"
branch_labels = None
depends_on = None

_CHECK = "ck_qpu_runs_sweep_object"


def upgrade() -> None:
    op.add_column(
        "qpu_runs",
        sa.Column("sweep", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_check_constraint(
        _CHECK,
        "qpu_runs",
        "sweep is null or jsonb_typeof(sweep) = 'object'",
    )


def downgrade() -> None:
    # Refuses rather than discards, like 0066 and every column before it that
    # holds provider-reported data: a sweep's per-point programs and counts
    # cannot be read back from IBM once the column is dropped.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM qpu_runs WHERE sweep IS NOT NULL) THEN
                RAISE EXCEPTION
                    'cannot downgrade 0075: qpu_run records carry sweep data';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_CHECK, "qpu_runs", type_="check")
    op.drop_column("qpu_runs", "sweep")
