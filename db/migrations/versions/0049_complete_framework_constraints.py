"""Complete the additional-framework allowlists missed by revision 0048.

Revision ID: 0049
Revises: 0048

0048 widened candidate/tool history but left the three framework columns used
before a candidate exists on the original qiskit/cirq/pennylane constraint. A
Braket run therefore failed at its first ``runs`` insert. This migration widens
those remaining snapshots and fails closed on downgrade when new history exists.
"""

from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None

_FRAMEWORKS_OLD = ("qiskit", "cirq", "pennylane")
_FRAMEWORKS_ADDED = ("braket", "qibo", "qulacs")
_FRAMEWORKS_NEW = (*_FRAMEWORKS_OLD, *_FRAMEWORKS_ADDED)


def _in(column: str, values: tuple[str, ...], *, nullable: bool = False) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    expression = f"{column} in ({quoted})"
    return f"{column} is null or {expression}" if nullable else expression


def upgrade() -> None:
    op.drop_constraint("ck_framework_enum", "runs", type_="check")
    op.create_check_constraint("ck_framework_enum", "runs", _in("framework", _FRAMEWORKS_NEW))
    op.drop_constraint("ck_framework_enum", "artifacts", type_="check")
    op.create_check_constraint("ck_framework_enum", "artifacts", _in("framework", _FRAMEWORKS_NEW))
    op.drop_constraint(
        "ck_artifact_versions_authoritative_framework_enum",
        "artifact_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_artifact_versions_authoritative_framework_enum",
        "artifact_versions",
        _in("authoritative_framework", _FRAMEWORKS_NEW, nullable=True),
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM runs
                WHERE framework IN ('braket', 'qibo', 'qulacs')
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0049: additional-framework runs exist';
            END IF;
            IF EXISTS (
                SELECT 1 FROM artifacts
                WHERE framework IN ('braket', 'qibo', 'qulacs')
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0049: additional-framework artifacts exist';
            END IF;
            IF EXISTS (
                SELECT 1 FROM artifact_versions
                WHERE authoritative_framework IN ('braket', 'qibo', 'qulacs')
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0049: additional-framework versions exist';
            END IF;
        END $$
        """
    )
    op.drop_constraint(
        "ck_artifact_versions_authoritative_framework_enum",
        "artifact_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_artifact_versions_authoritative_framework_enum",
        "artifact_versions",
        _in("authoritative_framework", _FRAMEWORKS_OLD, nullable=True),
    )
    op.drop_constraint("ck_framework_enum", "artifacts", type_="check")
    op.create_check_constraint("ck_framework_enum", "artifacts", _in("framework", _FRAMEWORKS_OLD))
    op.drop_constraint("ck_framework_enum", "runs", type_="check")
    op.create_check_constraint("ck_framework_enum", "runs", _in("framework", _FRAMEWORKS_OLD))
