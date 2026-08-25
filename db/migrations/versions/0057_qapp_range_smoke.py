"""The result of running a generated Qapp at the TOP of its own declared input range.

ai-ops#180, and the owner's ruling on it, quoted: *"Smoke at both ends but only
warn the creator, publish either way."*

## What was wrong

Publication requires one successful sandbox run against the Qapp's own input
schema (`repos/qapps.py::set_visibility`). The value chooser that generation's
smoke run uses (`majorana_worker.handlers._qapp_smoke_value`) takes the schema
default, else the first enum value, else the **minimum** of a number range. So a
Qapp declaring `shots 1 to 20000` was proven at 1 shot and published on it. The
first visitor to move the slider to the top could get a timeout or an
out-of-memory instead — a run that is still paid for and still counts against
the per-qapp and per-deployment hourly ceilings that 0056 installed.

## Why this is a column and not an event

The warning has to reach the creator at the moment they decide to publish, which
is minutes or days after the run that generated the Qapp has scrolled away. A
run event is emitted once, to whoever happens to be watching. This is a property
of the **version** — it is true of that exact `quantum_source` against that exact
`input_schema` and it stops being true the moment either changes — so it lives
beside them and is replaced with them.

## Nullable, and NULL is a third value

`NULL` means *nobody ever asked*. Every `qapp_versions` row that exists when this
migration runs is NULL and none of them will ever be backfilled: the answer can
only be produced by spending a sandbox, and spending one per historical row to
fill in a warning nobody is waiting for is not worth the money.

That makes NULL distinct from `not_applicable` (asked; the schema declares no
upper bound, so the top of the range IS the bottom and there was nothing new to
run) and from `failed` (asked; it broke). A reader that renders NULL as a pass
is wrong, and `QappRangeSmoke` says so on the field.

## No CHECK constraint on `status`

Deliberate, and the opposite of what the other Qapp columns do. `qapp_executions.status`
carries a CHECK because a bad value there breaks the state machine the worker
drives. This column is *advisory text shown to one person*: a value the API's
`QappRangeSmokeStatus` does not know deserializes to a validation error at the
boundary, which is where it should be caught, and does not deserve a migration
to add a fifth status later. Additive-only within /v1 means new statuses are
expected.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "qapp_versions",
        sa.Column("range_smoke", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("qapp_versions", "range_smoke")
