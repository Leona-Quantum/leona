"""Merge the latest dev and VQE migration histories.

Revision ID: vqe_merge_0055
Revises: 0048, 0054

The dev history retains its numeric revision identifiers.  VQE revisions use a
dedicated ``vqe_`` namespace, except for the legacy terminal ``0054`` stamp
which remains addressable for databases created before the histories merged.
This no-op merge revision declares that both branches are required.
"""

revision = "vqe_merge_0055"
down_revision = ("0048", "0054")
branch_labels = None
depends_on = None


def upgrade() -> None:
    return None


def downgrade() -> None:
    return None
