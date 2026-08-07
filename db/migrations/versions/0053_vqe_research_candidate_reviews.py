"""Append-only, evidence-bound human review records for research candidates.

Revision ID: vqe_0053
Revises: vqe_0052

Review evidence never mutates an LLM envelope. A human edit creates a new
reviewed candidate version, while transport replay identity remains separate
from scientific review identity.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "vqe_0053"
down_revision = "vqe_0052"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())
_FUNCTION = "majorana_reject_vqe_research_review_mutation"
_TABLES = (
    "vqe_research_candidate_reviews",
    "vqe_research_candidate_review_requests",
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
        "vqe_research_candidate_reviews",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, nullable=False),
        sa.Column("envelope_id", _UUID, nullable=False),
        sa.Column("previous_review_id", _UUID, nullable=True),
        sa.Column(
            "reviewer_user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("candidate_local_id", sa.Text(), nullable=False),
        sa.Column("review_kind", sa.Text(), nullable=False),
        sa.Column("independence_state", sa.Text(), nullable=False),
        sa.Column("disposition", sa.Text(), nullable=False),
        sa.Column("source_snapshot_sha256", sa.Text(), nullable=False),
        sa.Column("evidence_bundle_sha256", sa.Text(), nullable=False),
        sa.Column("base_candidate_sha256", sa.Text(), nullable=False),
        sa.Column("reviewed_candidate_json", _JSON, nullable=False),
        sa.Column("reviewed_candidate_sha256", sa.Text(), nullable=False),
        sa.Column("decisions_json", _JSON, nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("review_sha256", sa.Text(), nullable=False),
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
            name="fk_vqe_research_candidate_reviews_envelope_scope",
        ),
        sa.ForeignKeyConstraint(
            ["previous_review_id", "workspace_id"],
            ["vqe_research_candidate_reviews.id", "vqe_research_candidate_reviews.workspace_id"],
            ondelete="RESTRICT",
            name="fk_vqe_research_candidate_reviews_previous_scope",
        ),
        sa.CheckConstraint(
            "candidate_local_id ~ '^candidate_[a-z0-9][a-z0-9_.-]{0,63}$'",
            name="ck_vqe_research_candidate_reviews_candidate",
        ),
        sa.CheckConstraint(
            "review_kind = 'workspace_human_review' and independence_state = 'not_asserted'",
            name="ck_vqe_research_candidate_reviews_attestation",
        ),
        sa.CheckConstraint(
            "disposition in ('accepted', 'rejected', 'needs_resolution')",
            name="ck_vqe_research_candidate_reviews_disposition",
        ),
        sa.CheckConstraint(
            "source_snapshot_sha256 ~ '^[0-9a-f]{64}$' and "
            "evidence_bundle_sha256 ~ '^[0-9a-f]{64}$' and "
            "base_candidate_sha256 ~ '^[0-9a-f]{64}$' and "
            "reviewed_candidate_sha256 ~ '^[0-9a-f]{64}$' and "
            "review_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_research_candidate_reviews_digests",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(reviewed_candidate_json) = 'object' and "
            "jsonb_typeof(decisions_json) = 'array'",
            name="ck_vqe_research_candidate_reviews_json",
        ),
        sa.CheckConstraint(
            "char_length(rationale) between 1 and 2000",
            name="ck_vqe_research_candidate_reviews_rationale",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_vqe_research_candidate_reviews_scope"),
        sa.UniqueConstraint(
            "workspace_id",
            "envelope_id",
            "candidate_local_id",
            "review_sha256",
            name="uq_vqe_research_candidate_reviews_identity",
        ),
    )
    op.create_index(
        "ix_vqe_research_candidate_reviews_queue",
        "vqe_research_candidate_reviews",
        ["workspace_id", "envelope_id", "candidate_local_id", "created_at"],
    )

    op.create_table(
        "vqe_research_candidate_review_requests",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, nullable=False),
        sa.Column("review_id", _UUID, nullable=False),
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
            ["review_id", "workspace_id"],
            ["vqe_research_candidate_reviews.id", "vqe_research_candidate_reviews.workspace_id"],
            ondelete="RESTRICT",
            name="fk_vqe_research_candidate_review_requests_review_scope",
        ),
        sa.CheckConstraint(
            "char_length(idempotency_key) between 1 and 255",
            name="ck_vqe_research_candidate_review_requests_key",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(request_descriptor_json) = 'object'",
            name="ck_vqe_research_candidate_review_requests_json",
        ),
        sa.CheckConstraint(
            "request_descriptor_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_research_candidate_review_requests_sha",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_vqe_research_candidate_review_requests_idempotency",
        ),
    )

    op.execute(
        f"""
        create function {_FUNCTION}()
        returns trigger language plpgsql as $$
        begin
            raise exception 'VQE research candidate review evidence is append-only';
        end;
        $$;
        """
    )
    for table in _TABLES:
        _append_only(table)


def downgrade() -> None:
    count = (
        op.get_bind()
        .execute(sa.text("select count(*) from vqe_research_candidate_reviews"))
        .scalar_one()
    )
    if count:
        raise RuntimeError("cannot downgrade 0053 with append-only review evidence")
    for table in reversed(_TABLES):
        op.execute(f"drop trigger if exists trg_{table}_append_only on {table}")
        op.drop_table(table)
    op.execute(f"drop function if exists {_FUNCTION}()")
