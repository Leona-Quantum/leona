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
happened that did not. A NULL hash is read as "cannot compare" and takes the
old behaviour — the pre-existing runs are all terminal long before this ships,
so the branch is unreachable in practice and honest where it is not.
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
