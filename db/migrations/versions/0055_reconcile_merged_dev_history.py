"""Reconcile databases stamped by the pre-merge VQE migration history.

Revision ID: 0055
Revises: 0054

The feature branch originally assigned ``0046`` and ``0047`` to VQE schema
changes.  ``dev`` later assigned those same Alembic identifiers to the artifact
upstream-identity and run idempotency changes.  The corrected graph gives the
VQE branch the unique identifiers ``vqe_0046`` and ``vqe_0047`` and merges both
branches at ``0048``.

A database already stamped ``0054`` by the old feature-only graph will not run
the newly visible dev branch: Alembic correctly considers every ancestor of
``0054`` applied.  This compatibility revision therefore verifies and, only
when absent, adds the three dev columns and two supporting indexes.  It repeats
the official 0046 backfill and duplicate preflight so a legacy stamp cannot
silently weaken catalog identity.

The downgrade is intentionally a no-op.  This revision owns no schema in the
corrected graph: at revision ``0054`` the dev 0046/0047 branch is already an
ancestor of the 0048 merge point, so removing its columns here would make the
database inconsistent with the target revision.  Downgrading below the merge
point invokes the original dev migration downgrades, which own those objects.
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None

_IDENTITY_INDEX = "ux_artifacts_workspace_upstream_identity"
_PROVENANCE_INDEX = "ix_import_items_artifact_recency"
_DUPLICATE_SAMPLE_SIZE = 20

_COLUMN_INFO = sa.text(
    """
    SELECT data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = :table_name
       AND column_name = :column_name
    """
)

_INDEX_INFO = sa.text(
    """
    SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS indexdef,
           pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_class AS idx
      JOIN pg_namespace AS ns ON ns.oid = idx.relnamespace
      JOIN pg_index AS i ON i.indexrelid = idx.oid
     WHERE ns.nspname = current_schema()
       AND idx.relname = :index_name
    """
)

_BACKFILL = sa.text(
    """
    UPDATE artifacts AS a
       SET upstream_identity = latest.upstream_identity
      FROM (
           SELECT DISTINCT ON (resulting_artifact_id)
                  resulting_artifact_id,
                  upstream_identity
             FROM import_items
            WHERE resulting_artifact_id IS NOT NULL
            ORDER BY resulting_artifact_id, created_at DESC, id DESC
           ) AS latest
     WHERE a.id = latest.resulting_artifact_id
       AND a.upstream_identity IS DISTINCT FROM latest.upstream_identity
    """
)

_DUPLICATES = sa.text(
    f"""
    SELECT workspace_id, upstream_identity, count(*) AS n
      FROM artifacts
     WHERE upstream_identity IS NOT NULL
       AND deleted_at IS NULL
     GROUP BY workspace_id, upstream_identity
    HAVING count(*) > 1
     ORDER BY n DESC, upstream_identity
     LIMIT {_DUPLICATE_SAMPLE_SIZE}
    """
)

_DUPLICATE_TOTAL = sa.text(
    """
    SELECT count(*) FROM (
           SELECT 1
             FROM artifacts
            WHERE upstream_identity IS NOT NULL
              AND deleted_at IS NULL
            GROUP BY workspace_id, upstream_identity
           HAVING count(*) > 1
           ) AS clashes
    """
)


def _ensure_nullable_text_column(bind, table_name: str, column_name: str) -> None:
    row = (
        bind.execute(
            _COLUMN_INFO,
            {"table_name": table_name, "column_name": column_name},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        op.add_column(table_name, sa.Column(column_name, sa.Text(), nullable=True))
        return
    if row["data_type"] != "text" or row["is_nullable"] != "YES":
        raise RuntimeError(
            f"cannot reconcile {table_name}.{column_name}: expected nullable text, "
            f"found data_type={row['data_type']!r}, is_nullable={row['is_nullable']!r}"
        )


def _normalized_ddl(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace('"', "").lower()).strip()


def _ensure_index(
    bind,
    *,
    index_name: str,
    table_name: str,
    columns: list[object],
    unique: bool,
    required_definition_fragments: tuple[str, ...],
    postgresql_where=None,
) -> None:
    row = bind.execute(_INDEX_INFO, {"index_name": index_name}).mappings().one_or_none()
    if row is None:
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )
        return

    indexdef = _normalized_ddl(row["indexdef"])
    predicate = _normalized_ddl(row["predicate"] or "")
    if bool(row["indisunique"]) is not unique:
        raise RuntimeError(
            f"cannot reconcile index {index_name}: uniqueness does not match the contract"
        )
    searchable = f"{indexdef} {predicate}"
    missing = [fragment for fragment in required_definition_fragments if fragment not in searchable]
    if missing:
        raise RuntimeError(
            f"cannot reconcile index {index_name}: existing definition is incompatible; "
            f"missing {missing!r} from {searchable!r}"
        )


def _fail_on_duplicate_upstream_identities(bind) -> None:
    total_clashes = int(bind.execute(_DUPLICATE_TOTAL).scalar_one())
    if not total_clashes:
        return
    sample = bind.execute(_DUPLICATES).all()
    detail = ", ".join(
        f"{row.upstream_identity!r} x{row.n} in workspace {row.workspace_id}" for row in sample
    )
    if total_clashes > len(sample):
        detail += f", and {total_clashes - len(sample)} more"
    raise RuntimeError(
        "cannot reconcile upstream_identity: "
        f"{total_clashes} identity/workspace pairs are duplicated ({detail}). "
        "Resolve catalog ownership before applying revision 0055."
    )


def upgrade() -> None:
    bind = op.get_bind()
    _ensure_nullable_text_column(bind, "artifacts", "upstream_identity")
    _ensure_nullable_text_column(bind, "license_assertions", "claim_hash")
    _ensure_nullable_text_column(bind, "runs", "idempotency_request_hash")

    bind.execute(_BACKFILL)
    _fail_on_duplicate_upstream_identities(bind)

    _ensure_index(
        bind,
        index_name=_IDENTITY_INDEX,
        table_name="artifacts",
        columns=["workspace_id", "upstream_identity"],
        unique=True,
        postgresql_where=sa.text("upstream_identity IS NOT NULL AND deleted_at IS NULL"),
        required_definition_fragments=(
            "(workspace_id, upstream_identity)",
            "upstream_identity is not null",
            "deleted_at is null",
        ),
    )
    _ensure_index(
        bind,
        index_name=_PROVENANCE_INDEX,
        table_name="import_items",
        columns=["resulting_artifact_id", sa.text("created_at desc"), sa.text("id desc")],
        unique=False,
        required_definition_fragments=("(resulting_artifact_id, created_at desc, id desc)",),
    )


def downgrade() -> None:
    # 0055 repairs the schema invariant already declared by 0054's corrected
    # ancestry.  The owning dev migrations remove these objects below 0048.
    return None
