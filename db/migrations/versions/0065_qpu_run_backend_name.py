"""Which physical machine ran a hardware job: `qpu_runs.backend_name`, and the two
indexes the run history reads through.

Revision ID: 0065
Revises: 0064

Proposal 5, increment 2 (ai-ops 349, "run history and the device record").

## Why the row needs it

`qpu_runs.device_id` is Leona's catalog key (`ibm.open_plan`), not a machine.
The IBM adapter submits to `service.least_busy(operational=True,
simulator=False)`, so two runs of the same circuit under the same `device_id`
can land on two different processors with different error rates, and nothing
on the row said which. A history of measured-against-ideal distances is only a
device record if each distance is attached to the device that produced it.

## What goes in it, and what never does

The name IBM reported for the backend the job was handed to (for example
`ibm_brisbane`), written by the worker in the same transition that stores the
provider job id. NULL means "not reported", and it stays NULL for every row
that existed before this migration: those jobs ran somewhere, but nothing
recorded where, and a backfill could only guess. The bound matches
`majorana_qpu.models.MAX_BACKEND_NAME_CHARS`, which the adapter applies before
the value reaches the worker, so a name the provider returns too long becomes
NULL there instead of failing this CHECK in the transaction that also has to
record the provider job id.

## The indexes

`qpu_runs_repo.list_records` is `GET /v1/qpu/runs`, and it reads:

    WHERE workspace_id = :ws [AND source_fingerprint = :fp] [AND id < :cursor]
    ORDER BY id DESC LIMIT :n

0034's `ix_qpu_runs_workspace_created (workspace_id, created_at)` is on the wrong
ordering column, for the reason 0051 gives about `runs`: the ids are uuid7 and so
time-ordered, but that is how we mint them, not something the planner can use.
Without an index on `(workspace_id, id)` the plan is the primary key scanned
backwards with `workspace_id` as a filter, so one workspace's first page costs
every other workspace's newer runs.

- `ix_qpu_runs_workspace_id_desc (workspace_id, id DESC)` serves the history page
  and its cursor, exactly as `ix_runs_workspace_id_desc` does for runs.
- `ix_qpu_runs_workspace_fingerprint_id_desc (workspace_id, source_fingerprint,
  id DESC)` serves the fingerprint form. It earns its place because of who calls
  it and what they usually get: Studio asks it (`limit=1`) every time a reader
  opens a circuit that has an OpenQASM export, and the usual answer is "never
  ran on hardware". With only the first index, that answer means walking every
  run the workspace has before concluding there is none; with this one it is a
  single descent that finds nothing. The write cost is small because inserts
  into this table are bounded by hardware submissions.

Equality columns first, then the ordering column, so both can seek and neither
sorts. DESC is written out so the cursor form is a forward scan from the cursor.
CONCURRENTLY is not used, for the reason 0044 and 0051 state: Alembic runs each
migration inside a transaction.

## Privileges and row-level security

Nothing to add, and that was checked rather than assumed. `app_rw` holds
TABLE-level `select, insert, update` on `qpu_runs` (0034, re-asserted by 0052,
which also re-revoked DELETE); no migration grants column-level privileges, so
a new column is covered by the existing grant. The RLS policies from 0053 and
0054 are row predicates on `workspace_id`, which a new column does not change.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None

_CHECK = "ck_qpu_runs_backend_name"


_HISTORY_INDEX = "ix_qpu_runs_workspace_id_desc"
_FINGERPRINT_INDEX = "ix_qpu_runs_workspace_fingerprint_id_desc"


def upgrade() -> None:
    op.add_column("qpu_runs", sa.Column("backend_name", sa.Text(), nullable=True))
    op.create_check_constraint(
        _CHECK,
        "qpu_runs",
        "backend_name is null or char_length(backend_name) between 1 and 120",
    )
    op.create_index(_HISTORY_INDEX, "qpu_runs", ["workspace_id", sa.text("id desc")])
    op.create_index(
        _FINGERPRINT_INDEX, "qpu_runs", ["workspace_id", "source_fingerprint", sa.text("id desc")]
    )


def downgrade() -> None:
    # Refuses rather than discards, like 0034 and 0064: a recorded backend name
    # is provider-attested and cannot be recovered once the column is dropped.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM qpu_runs WHERE backend_name IS NOT NULL) THEN
                RAISE EXCEPTION
                    'cannot downgrade 0065: qpu_run records carry a provider-reported backend name';
            END IF;
        END $$
        """
    )
    op.drop_index(_FINGERPRINT_INDEX, table_name="qpu_runs")
    op.drop_index(_HISTORY_INDEX, table_name="qpu_runs")
    op.drop_constraint(_CHECK, "qpu_runs", type_="check")
    op.drop_column("qpu_runs", "backend_name")
