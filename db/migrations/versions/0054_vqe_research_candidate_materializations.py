"""Append-only reviewed research-candidate materialization evidence.

Revision ID: 0054
Revises: vqe_0053

Materialization is an explicit private action over one accepted review.  It is
not component publication or execution qualification.  The request ledger is
kept separate from the scientific materialization identity.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0054"
down_revision = "vqe_0053"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())
_FUNCTION = "majorana_reject_vqe_research_materialization_mutation"
_TABLES = (
    "vqe_research_candidate_materializations",
    "vqe_research_candidate_materialization_requests",
)


def _append_only(table: str) -> None:
    op.execute(
        f"""
        create trigger trg_{table}_append_only
        before update or delete on {table}
        for each row execute function {_FUNCTION}();
        """
    )
    op.execute(
        f"""
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert on {table} to app_rw;
                revoke update, delete on {table} from app_rw;
            end if;
        end $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "vqe_research_candidate_materializations",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, nullable=False),
        sa.Column("envelope_id", _UUID, nullable=False),
        sa.Column("review_id", _UUID, nullable=False),
        sa.Column(
            "created_by_user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "artifact_id",
            _UUID,
            sa.ForeignKey("artifacts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("materialization_schema_version", sa.Text(), nullable=False),
        sa.Column("source_snapshot_sha256", sa.Text(), nullable=False),
        sa.Column("evidence_bundle_sha256", sa.Text(), nullable=False),
        sa.Column("review_sha256", sa.Text(), nullable=False),
        sa.Column("reviewed_candidate_sha256", sa.Text(), nullable=False),
        sa.Column("license_expression", sa.Text(), nullable=False),
        sa.Column("license_gate", sa.Text(), nullable=False),
        sa.Column("compatibility_contract_json", _JSON, nullable=False),
        sa.Column("compatibility_contract_sha256", sa.Text(), nullable=False),
        sa.Column("materialized_bundle_json", _JSON, nullable=False),
        sa.Column("materialized_bundle_sha256", sa.Text(), nullable=False),
        sa.Column("publication_eligible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("execution_eligible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["envelope_id", "workspace_id"],
            [
                "vqe_research_candidate_envelopes.id",
                "vqe_research_candidate_envelopes.workspace_id",
            ],
            ondelete="RESTRICT",
            name="fk_vqe_research_candidate_materializations_envelope_scope",
        ),
        sa.ForeignKeyConstraint(
            ["review_id", "workspace_id"],
            ["vqe_research_candidate_reviews.id", "vqe_research_candidate_reviews.workspace_id"],
            ondelete="RESTRICT",
            name="fk_vqe_research_candidate_materializations_review_scope",
        ),
        sa.CheckConstraint(
            "materialization_schema_version = 'atlas.research-candidate-materialization.v1'",
            name="ck_vqe_research_candidate_materializations_schema",
        ),
        sa.CheckConstraint(
            "source_snapshot_sha256 ~ '^[0-9a-f]{64}$' and "
            "evidence_bundle_sha256 ~ '^[0-9a-f]{64}$' and "
            "review_sha256 ~ '^[0-9a-f]{64}$' and "
            "reviewed_candidate_sha256 ~ '^[0-9a-f]{64}$' and "
            "compatibility_contract_sha256 ~ '^[0-9a-f]{64}$' and "
            "materialized_bundle_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_research_candidate_materializations_digests",
        ),
        sa.CheckConstraint(
            "license_gate = 'source_declared_spdx_private_metadata_only_v1' and "
            "char_length(license_expression) between 1 and 100",
            name="ck_vqe_research_candidate_materializations_license",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(compatibility_contract_json) = 'object' and "
            "jsonb_typeof(materialized_bundle_json) = 'object'",
            name="ck_vqe_research_candidate_materializations_json",
        ),
        sa.CheckConstraint(
            "publication_eligible = false and execution_eligible = false",
            name="ck_vqe_research_candidate_materializations_private_only",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_vqe_research_materializations_scope"),
        sa.UniqueConstraint(
            "workspace_id",
            "review_id",
            name="uq_vqe_research_materializations_review",
        ),
    )
    op.create_index(
        "ix_vqe_research_candidate_materializations_workspace_created",
        "vqe_research_candidate_materializations",
        ["workspace_id", "created_at"],
    )

    op.create_table(
        "vqe_research_candidate_materialization_requests",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, nullable=False),
        sa.Column("materialization_id", _UUID, nullable=False),
        sa.Column(
            "requested_by_user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("request_descriptor_json", _JSON, nullable=False),
        sa.Column("request_descriptor_sha256", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["materialization_id", "workspace_id"],
            [
                "vqe_research_candidate_materializations.id",
                "vqe_research_candidate_materializations.workspace_id",
            ],
            ondelete="RESTRICT",
            name="fk_vqe_research_materialization_requests_scope",
        ),
        sa.CheckConstraint(
            "char_length(idempotency_key) between 1 and 255",
            name="ck_vqe_research_materialization_requests_key",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(request_descriptor_json) = 'object' and "
            "request_descriptor_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_research_materialization_requests_descriptor",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_vqe_research_materialization_requests_idempotency",
        ),
    )

    op.execute(
        f"""
        create function {_FUNCTION}()
        returns trigger language plpgsql as $$
        begin
            raise exception 'VQE research candidate materialization evidence is append-only';
        end;
        $$;
        """
    )
    for table in _TABLES:
        _append_only(table)


def downgrade() -> None:
    count = (
        op.get_bind()
        .execute(sa.text("select count(*) from vqe_research_candidate_materializations"))
        .scalar_one()
    )
    if count:
        raise RuntimeError("cannot downgrade 0054 with append-only materialization evidence")
    for table in reversed(_TABLES):
        op.execute(f"drop trigger if exists trg_{table}_append_only on {table}")
        op.drop_table(table)
    op.execute(f"drop function if exists {_FUNCTION}()")
