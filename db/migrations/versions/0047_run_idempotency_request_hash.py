"""runs.idempotency_request_hash — make a reused Idempotency-Key answer honestly.

Revision ID: 0047
Revises: 0046

`0002` added the key and the partial unique index. What it did not add was any
record of WHAT was submitted under that key, so `POST /v1/runs` returned the
stored run for a reused key no matter how different the new body was: a client
that reused a key by accident got somebody else's run back, described as its
own, with a 201. Storing the hash of the admitted request is what lets the
second submission be told apart from a retry and refused with a 409.

Nullable, and deliberately not backfilled. Rows created before this migration
have no recorded request, and inventing one would mean claiming a comparison
happened that did not.

A NULL hash is therefore **non-comparable, and the route fails closed on it** —
a reused key against such a row is refused with 409 rather than answered with
the stored run. "Cannot compare" is precisely when returning a run is unsafe;
letting those rows through would keep the defect this column exists to close
reachable for every pre-migration key. The exposure is minutes wide (runs go
terminal quickly, and this migration runs during deploy), and inside it a loud
refusal beats a possibly-wrong run.
"""

import sqlalchemy as sa
from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("idempotency_request_hash", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "idempotency_request_hash")
