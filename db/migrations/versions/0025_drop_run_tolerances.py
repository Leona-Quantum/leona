"""Drop the unused runs.tolerances column.

Revision ID: 0025
Revises: 0024

#129 removed `tolerances` from the API request body, the `Run` contract, the
ORM and the worker's RunContext. Nothing ever read the value at any point in
that path, and the one verifier that honours a declared tolerance (exact_diag)
accepts it only in the tightening direction — the opposite of what an
unrestricted dict of floats on the run offers.

This is deliberately a SEPARATE migration from #129 rather than part of it.
deploy.yml applies migrations *before* it builds and rolls out the new image
(docs/runbooks/deploys.md), so dropping the column in the same change would
leave the still-serving old revision doing `SELECT ... runs.tolerances` against
a column that no longer exists — every run read 500s for the length of the
deploy. By the time this runs, no deployed revision maps the column.

The data is not preserved anywhere. That is the intent: it was never read, so
there is nothing in it to lose. downgrade() restores the column, not its
contents.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("runs", "tolerances")


def downgrade() -> None:
    op.add_column("runs", sa.Column("tolerances", JSONB))
