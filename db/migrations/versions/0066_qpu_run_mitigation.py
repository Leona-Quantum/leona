"""What a hardware run needs for mitigation: `qpu_runs.mitigation`.

Revision ID: 0066
Revises: 0065

Proposal 5, increment 4 (ai-ops 349; natively, not through Mitiq, per the
owner's ruling on ai-ops 361).

## What goes in it

One JSON object, shaped by `majorana_qpu.mitigation` (version 1), written in
three steps and never rewritten after the run finishes:

- **At submission, by the API**, only when the user opted in to zero-noise
  extrapolation: `{"version": 1, "zne": {"scale_factors": [1, 3, 5], ...}}`.
  The request lives on the row because the worker reads every attested value
  from the row, never from the job payload.
- **At submit, by the worker**, with the provider job id: the readout
  calibration the backend reported for each measured bit's physical qubit, and
  for ZNE each PUB's transpiled two-qubit gate count.
- **At completion, by the worker**, with `raw_counts`: the counts of the 3x and
  5x folded circuits.

`raw_counts` is untouched by any of it. It stays the counts of the circuit the
user submitted, exactly as the provider returned them; the folded counts are
extra evidence beside it, and the corrections themselves are computed where
they are displayed, from these stored inputs.

NULL means nothing was recorded, which is true of every row written before this
migration and of any run whose backend reported no calibration.

## The CHECK

Only that it is an object. The shape inside is versioned and read defensively
by the web, which refuses a version it does not know; a CHECK that validated the
inner shape would have to be migrated every time the version moved, and would
still not stop a well-formed document with wrong numbers in it.

## Privileges and row-level security

Nothing to add, checked the same way 0065 checked it. `app_rw` holds TABLE-level
`select, insert, update` on `qpu_runs` (0034, re-asserted by 0052, which also
re-revoked DELETE); no migration grants column-level privileges, so a new column
is covered by the existing grant. The RLS policies from 0053 and 0054 are row
predicates on `workspace_id`, which a new column does not change.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None

_CHECK = "ck_qpu_runs_mitigation_object"


def upgrade() -> None:
    op.add_column(
        "qpu_runs",
        sa.Column("mitigation", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_check_constraint(
        _CHECK,
        "qpu_runs",
        "mitigation is null or jsonb_typeof(mitigation) = 'object'",
    )


def downgrade() -> None:
    # Refuses rather than discards, like 0034, 0064 and 0065: a calibration
    # snapshot and a folded circuit's counts are provider-reported and cannot be
    # read back from IBM once the column is dropped.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM qpu_runs WHERE mitigation IS NOT NULL) THEN
                RAISE EXCEPTION
                    'cannot downgrade 0066: qpu_run records carry mitigation data';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_CHECK, "qpu_runs", type_="check")
    op.drop_column("qpu_runs", "mitigation")
