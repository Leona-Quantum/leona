"""Persist private, validated LLM research candidates as append-only evidence.

Revision ID: 0052
Revises: 0051

Scientific envelope identity and transport replay identity are intentionally
separate. A candidate remains unreviewed, private, and ineligible for
materialization until later reviewed transactions add new evidence records.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())
_FUNCTION = "majorana_reject_vqe_research_candidate_mutation"
_TABLES = (
    "vqe_research_candidate_envelopes",
    "vqe_research_candidate_persist_requests",
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
        "vqe_research_candidate_envelopes",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "source_snapshot_id",
            _UUID,
            sa.ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("envelope_version", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=False),
        sa.Column("policy_version", sa.Text(), nullable=False),
        sa.Column("response_schema_version", sa.Text(), nullable=False),
        sa.Column("repository_id", sa.BigInteger(), nullable=False),
        sa.Column("commit_sha", sa.Text(), nullable=False),
        sa.Column("snapshot_sha256", sa.Text(), nullable=False),
        sa.Column("input_bundle_sha256", sa.Text(), nullable=False),
        sa.Column("response_sha256", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("requested_model", sa.Text(), nullable=False),
        sa.Column("served_model", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("candidate_count", sa.Integer(), nullable=False),
        sa.Column("machine_validation_state", sa.Text(), nullable=False),
        sa.Column("human_review_state", sa.Text(), nullable=False),
        sa.Column("publication_eligible", sa.Boolean(), nullable=False),
        sa.Column("materialization_eligible", sa.Boolean(), nullable=False),
        sa.Column("envelope_json", _JSON, nullable=False),
        sa.Column("envelope_sha256", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "envelope_version = 'atlas.research-candidate-envelope.v1'",
            name="ck_vqe_research_candidate_envelopes_version",
        ),
        sa.CheckConstraint(
            "prompt_version = 'atlas.research-extraction.prompt.v1'",
            name="ck_vqe_research_candidate_envelopes_prompt",
        ),
        sa.CheckConstraint(
            "policy_version = 'atlas.research-candidate-policy.v1'",
            name="ck_vqe_research_candidate_envelopes_policy",
        ),
        sa.CheckConstraint(
            "response_schema_version = 'atlas.research-candidate-response.v1'",
            name="ck_vqe_research_candidate_envelopes_schema",
        ),
        sa.CheckConstraint(
            "commit_sha ~ '^[0-9a-f]{40}$'",
            name="ck_vqe_research_candidate_envelopes_commit",
        ),
        sa.CheckConstraint(
            "snapshot_sha256 ~ '^[0-9a-f]{64}$' and "
            "input_bundle_sha256 ~ '^[0-9a-f]{64}$' and "
            "response_sha256 ~ '^[0-9a-f]{64}$' and "
            "envelope_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_research_candidate_envelopes_digests",
        ),
        sa.CheckConstraint(
            "char_length(provider) between 1 and 64 and "
            "char_length(requested_model) between 1 and 128 and "
            "char_length(served_model) between 1 and 128",
            name="ck_vqe_research_candidate_envelopes_provider",
        ),
        sa.CheckConstraint(
            "input_tokens >= 0 and output_tokens >= 0 and candidate_count between 0 and 20",
            name="ck_vqe_research_candidate_envelopes_counts",
        ),
        sa.CheckConstraint(
            "machine_validation_state = 'schema_and_evidence_validated' and "
            "human_review_state = 'unreviewed' and "
            "publication_eligible = false and materialization_eligible = false",
            name="ck_vqe_research_candidate_envelopes_private_state",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(envelope_json) = 'object'",
            name="ck_vqe_research_candidate_envelopes_json",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "envelope_sha256",
            name="uq_vqe_research_candidate_envelopes_digest",
        ),
        sa.UniqueConstraint(
            "id",
            "workspace_id",
            name="uq_vqe_research_candidate_envelopes_scope",
        ),
    )
    op.create_index(
        "ix_vqe_research_candidate_envelopes_workspace_created",
        "vqe_research_candidate_envelopes",
        ["workspace_id", "created_at"],
    )
    op.create_index(
        "ix_vqe_research_candidate_envelopes_source",
        "vqe_research_candidate_envelopes",
        ["source_snapshot_id"],
    )

    op.create_table(
        "vqe_research_candidate_persist_requests",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, nullable=False),
        sa.Column("envelope_id", _UUID, nullable=False),
        sa.Column(
            "created_by_user_id",
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
            ["envelope_id", "workspace_id"],
            [
                "vqe_research_candidate_envelopes.id",
                "vqe_research_candidate_envelopes.workspace_id",
            ],
            ondelete="RESTRICT",
            name="fk_vqe_research_candidate_persist_requests_envelope_scope",
        ),
        sa.CheckConstraint(
            "char_length(idempotency_key) between 1 and 255",
            name="ck_vqe_research_candidate_persist_requests_key",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(request_descriptor_json) = 'object'",
            name="ck_vqe_research_candidate_persist_requests_json",
        ),
        sa.CheckConstraint(
            "request_descriptor_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_research_candidate_persist_requests_sha",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_vqe_research_candidate_persist_requests_idempotency",
        ),
    )
    op.create_index(
        "ix_vqe_research_candidate_persist_requests_envelope",
        "vqe_research_candidate_persist_requests",
        ["workspace_id", "envelope_id"],
    )

    op.execute(
        f"""
        create function {_FUNCTION}()
        returns trigger language plpgsql as $$
        begin
            raise exception 'VQE research candidate evidence is append-only';
        end;
        $$;
        """
    )
    for table in _TABLES:
        _append_only(table)


def downgrade() -> None:
    count = (
        op.get_bind()
        .execute(
            sa.text(
                "select (select count(*) from vqe_research_candidate_envelopes) + "
                "(select count(*) from vqe_research_candidate_persist_requests)"
            )
        )
        .scalar_one()
    )
    if count:
        raise RuntimeError("cannot downgrade 0052 while research candidate evidence exists")
    for table in reversed(_TABLES):
        op.execute(f"drop trigger if exists trg_{table}_append_only on {table}")
    op.execute(f"drop function if exists {_FUNCTION}()")
    op.drop_index(
        "ix_vqe_research_candidate_persist_requests_envelope",
        table_name="vqe_research_candidate_persist_requests",
    )
    op.drop_table("vqe_research_candidate_persist_requests")
    op.drop_index(
        "ix_vqe_research_candidate_envelopes_source",
        table_name="vqe_research_candidate_envelopes",
    )
    op.drop_index(
        "ix_vqe_research_candidate_envelopes_workspace_created",
        table_name="vqe_research_candidate_envelopes",
    )
    op.drop_table("vqe_research_candidate_envelopes")
