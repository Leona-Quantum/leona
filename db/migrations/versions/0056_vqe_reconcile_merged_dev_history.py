"""Reconcile databases stamped by the pre-merge VQE migration history.

Revision ID: vqe_reconcile_0056
Revises: vqe_merge_0055

The feature branch originally assigned ``0046`` and ``0047`` to VQE schema
changes.  ``dev`` later assigned those same Alembic identifiers to the artifact
upstream-identity and run idempotency changes.  The corrected graph gives the
VQE branch the unique identifiers ``vqe_0046`` and ``vqe_0047`` and merges both
branches after dev ``0048`` and legacy VQE ``0054``.

A database already stamped ``0054`` by the old feature-only graph will not run
the newly visible dev branch: the merge revision can establish graph ancestry,
but it cannot retroactively execute migrations hidden by the legacy stamp.
This compatibility revision therefore verifies and, only when absent, adds the
three dev columns and two supporting indexes.  It also verifies the framework
and tool check constraints introduced by dev ``0048``.  The revision repeats
the official 0046 backfill and duplicate preflight so a legacy stamp cannot
silently weaken catalog identity.

The downgrade is intentionally a no-op.  This revision owns no schema in the
corrected graph: below this revision both the dev and VQE branches are already
ancestors of the merge point, so removing repaired objects here would make the
database inconsistent with the target revision.  Downgrading below the merge
point invokes the original dev migration downgrades, which own those objects.
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "vqe_reconcile_0056"
down_revision = "vqe_merge_0055"
branch_labels = None
depends_on = None

_IDENTITY_INDEX = "ux_artifacts_workspace_upstream_identity"
_PROVENANCE_INDEX = "ix_import_items_artifact_recency"
_DUPLICATE_SAMPLE_SIZE = 20

_FRAMEWORKS_OLD = ("qiskit", "cirq", "pennylane")
_FRAMEWORKS_NEW = (*_FRAMEWORKS_OLD, "braket", "qibo", "qulacs")
_TOOL_NAMES_OLD = (
    "request_plan",
    "simulate_qiskit",
    "simulate_cirq",
    "simulate_pennylane",
    "verify_intent_alignment",
    "convert_to_openqasm",
    "publish_artifact",
    "replan",
    "review_candidate",
    "strict_verify",
    "materialize_artifact",
)
_TOOL_NAMES_NEW = (*_TOOL_NAMES_OLD, "simulate_braket", "simulate_qibo", "simulate_qulacs")

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

_CONSTRAINT_INFO = sa.text(
    """
    SELECT pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint AS con
      JOIN pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = current_schema()
       AND rel.relname = :table_name
       AND con.conname = :constraint_name
       AND con.contype = 'c'
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


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def _ensure_expanded_check_constraint(
    bind,
    *,
    table_name: str,
    constraint_name: str,
    column_name: str,
    old_values: tuple[str, ...],
    required_values: tuple[str, ...],
) -> None:
    row = (
        bind.execute(
            _CONSTRAINT_INFO,
            {"table_name": table_name, "constraint_name": constraint_name},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise RuntimeError(
            f"cannot reconcile {constraint_name}: expected check constraint is absent"
        )

    definition = _normalized_ddl(row["definition"])
    required_tokens = {f"'{value}'" for value in required_values}
    quoted_values = set(re.findall(r"'[^']+'", definition))
    if quoted_values == required_tokens and column_name in definition:
        return

    old_tokens = {f"'{value}'" for value in old_values}
    if quoted_values != old_tokens or column_name not in definition:
        raise RuntimeError(
            f"cannot reconcile {constraint_name}: existing definition is incompatible: "
            f"{definition!r}"
        )

    op.drop_constraint(constraint_name, table_name, type_="check")
    op.create_check_constraint(
        constraint_name,
        table_name,
        _in(column_name, required_values),
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
        "Resolve catalog ownership before applying revision vqe_reconcile_0056."
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
    _ensure_expanded_check_constraint(
        bind,
        table_name="run_candidates",
        constraint_name="ck_run_candidates_framework",
        column_name="framework",
        old_values=_FRAMEWORKS_OLD,
        required_values=_FRAMEWORKS_NEW,
    )
    _ensure_expanded_check_constraint(
        bind,
        table_name="agent_steps",
        constraint_name="ck_agent_steps_name",
        column_name="name",
        old_values=_TOOL_NAMES_OLD,
        required_values=_TOOL_NAMES_NEW,
    )


def downgrade() -> None:
    # This revision repairs schema invariants already declared by the corrected
    # merged ancestry. The owning dev migrations remove them below the merge.
    return None
