"""Replace the private circuit IR with OpenQASM as the artifact source of truth.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op
from qiskit import qasm2, qasm3
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def _normalize_qasm(source: str) -> str:
    """Freeze the Qiskit-backed normalization used by this migration."""
    if source.lstrip().upper().startswith("OPENQASM 2.0;"):
        circuit = qasm2.loads(
            source,
            strict=True,
            custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS,
        )
    else:
        circuit = qasm3.loads(source)
    return qasm3.dumps(circuit)


def upgrade() -> None:
    op.add_column("artifact_versions", sa.Column("qasm_version", sa.Text))
    op.add_column("artifact_versions", sa.Column("metadata", JSONB))
    op.execute(
        """
        UPDATE artifact_versions
        SET metadata = jsonb_build_object(
            'legacy_ir', ir,
            'legacy_ir_version', ir_version
        )
        """
    )
    connection = op.get_bind()
    legacy_programs = list(
        connection.execute(
            sa.text("SELECT id, qasm FROM artifact_versions WHERE qasm IS NOT NULL")
        ).mappings()
    )
    for row in legacy_programs:
        canonical_qasm = _normalize_qasm(row["qasm"])
        connection.execute(
            sa.text(
                "UPDATE artifact_versions SET qasm = :qasm, qasm_version = '3.0' WHERE id = :id"
            ),
            {"id": row["id"], "qasm": canonical_qasm},
        )
    op.create_check_constraint(
        "ck_artifact_versions_qasm_version",
        "artifact_versions",
        "(qasm IS NULL AND qasm_version IS NULL) OR (qasm IS NOT NULL AND qasm_version = '3.0')",
    )
    op.drop_column("artifact_versions", "ir")
    op.drop_column("artifact_versions", "ir_version")


def downgrade() -> None:
    op.add_column("artifact_versions", sa.Column("ir_version", sa.Text))
    op.add_column("artifact_versions", sa.Column("ir", JSONB))
    op.execute(
        """
        UPDATE artifact_versions
        SET ir_version = CASE
                WHEN metadata ? 'legacy_ir_version' THEN metadata->>'legacy_ir_version'
                ELSE 'openqasm-bridge-v1'
            END,
            ir = CASE
                WHEN metadata ? 'legacy_ir' THEN metadata->'legacy_ir'
                ELSE jsonb_build_object('qasm', qasm, 'qasm_version', qasm_version)
            END
        """
    )
    op.alter_column("artifact_versions", "ir_version", nullable=False)
    op.alter_column("artifact_versions", "ir", nullable=False)
    op.drop_constraint("ck_artifact_versions_qasm_version", "artifact_versions", type_="check")
    op.drop_column("artifact_versions", "metadata")
    op.drop_column("artifact_versions", "qasm_version")
