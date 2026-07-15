"""Align stored artifact fingerprints with canonical OpenQASM.

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def _qasm_fingerprint(source: str) -> str:
    """Hash the already-normalized QASM emitted by migration 0008."""
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _updates(connection) -> list[dict[str, object]]:
    rows = list(
        connection.execute(
            sa.text("SELECT id, artifact_id, qasm FROM artifact_versions WHERE qasm IS NOT NULL")
        ).mappings()
    )
    updates: list[dict[str, object]] = []
    seen: dict[tuple[object, str], object] = {}
    for row in rows:
        digest = _qasm_fingerprint(row["qasm"])
        key = (row["artifact_id"], digest)
        previous = seen.get(key)
        if previous is not None and previous != row["id"]:
            raise RuntimeError(
                "cannot canonicalize duplicate artifact-version fingerprints for "
                f"artifact {row['artifact_id']}"
            )
        seen[key] = row["id"]
        updates.append(
            {
                "id": row["id"],
                "fingerprint": digest,
            }
        )
    return updates


def upgrade() -> None:
    connection = op.get_bind()
    updates = _updates(connection)
    if not updates:
        return

    connection.execute(
        sa.text(
            "UPDATE artifact_versions "
            "SET metadata = COALESCE(metadata, '{}'::jsonb) "
            "|| jsonb_build_object("
            "'_majorana_migrations', "
            "COALESCE(metadata->'_majorana_migrations', '{}'::jsonb) "
            "|| jsonb_build_object('0009_legacy_fingerprint', fingerprint)) "
            "WHERE id = :id"
        ),
        updates,
    )
    connection.execute(
        sa.text("UPDATE artifact_versions SET fingerprint = :fingerprint WHERE id = :id"),
        updates,
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE artifact_versions "
            "SET fingerprint = metadata #>> '{_majorana_migrations,0009_legacy_fingerprint}', "
            "metadata = metadata #- '{_majorana_migrations,0009_legacy_fingerprint}' "
            "WHERE metadata #>> '{_majorana_migrations,0009_legacy_fingerprint}' IS NOT NULL"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE artifact_versions "
            "SET metadata = metadata - '_majorana_migrations' "
            "WHERE metadata ? '_majorana_migrations' "
            "AND metadata->'_majorana_migrations' = '{}'::jsonb"
        )
    )
