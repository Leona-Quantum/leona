"""Which physical machine ran a hardware job: `qpu_runs.backend_name`.

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


def upgrade() -> None:
    op.add_column("qpu_runs", sa.Column("backend_name", sa.Text(), nullable=True))
    op.create_check_constraint(
        _CHECK,
        "qpu_runs",
        "backend_name is null or char_length(backend_name) between 1 and 120",
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
    op.drop_constraint(_CHECK, "qpu_runs", type_="check")
    op.drop_column("qpu_runs", "backend_name")
