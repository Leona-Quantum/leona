"""Persist copyable native framework renderings on artifact versions.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("artifact_versions", sa.Column("framework_variants", JSONB))


def downgrade() -> None:
    op.drop_column("artifact_versions", "framework_variants")
