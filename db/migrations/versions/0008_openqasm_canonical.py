"""Replace the private circuit IR with OpenQASM as the artifact source of truth.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("artifact_versions", sa.Column("qasm_version", sa.Text))
    op.add_column("artifact_versions", sa.Column("metadata", JSONB))
    # Preserve provenance and non-circuit annotations before removing the old
    # overloaded IR document. OpenQASM becomes the circuit source of truth;
    # metadata is descriptive only.
    op.execute("UPDATE artifact_versions SET metadata = ir")
    op.execute(
        """
        UPDATE artifact_versions
        SET qasm_version = CASE
            WHEN qasm ~* '^\\s*OPENQASM\\s+3' THEN '3.0'
            WHEN qasm IS NOT NULL THEN '2.0'
            ELSE NULL
        END
        """
    )
    op.create_check_constraint(
        "ck_artifact_versions_qasm_version",
        "artifact_versions",
        "(qasm IS NULL AND qasm_version IS NULL) OR "
        "(qasm IS NOT NULL AND qasm_version IN ('2.0', '3.0'))",
    )
    op.drop_column("artifact_versions", "ir")
    op.drop_column("artifact_versions", "ir_version")


def downgrade() -> None:
    op.add_column("artifact_versions", sa.Column("ir_version", sa.Text))
    op.add_column("artifact_versions", sa.Column("ir", JSONB))
    op.execute(
        """
        UPDATE artifact_versions
        SET ir_version = COALESCE(metadata->>'ir_version', 'openqasm-bridge-v1'),
            ir = COALESCE(metadata, '{}'::jsonb)
        """
    )
    op.alter_column("artifact_versions", "ir_version", nullable=False)
    op.alter_column("artifact_versions", "ir", nullable=False)
    op.drop_constraint("ck_artifact_versions_qasm_version", "artifact_versions", type_="check")
    op.drop_column("artifact_versions", "metadata")
    op.drop_column("artifact_versions", "qasm_version")
