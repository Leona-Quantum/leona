"""Add append-only VQE source assertions and implementation candidates.

Revision ID: 0042
Revises: 0041

This is private staging. Rows are observations and proposals, not published
Component Definitions, verified implementations, or scientific claims.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())
_IMMUTABLE_FUNCTION = "majorana_reject_vqe_source_staging_mutation"
_IMMUTABLE_TABLES = (
    "github_metadata_assertions",
    "vqe_component_implementation_candidates",
)


def _grant_append_only(table: str) -> None:
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
        "github_metadata_assertions",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "snapshot_id",
            _UUID,
            sa.ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("assertion_key", sa.Text(), nullable=False),
        sa.Column("extractor_version", sa.Text(), nullable=False),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("predicate", sa.Text(), nullable=False),
        sa.Column("observed", sa.Boolean(), nullable=False),
        sa.Column("evidence_paths", _JSON, nullable=False),
        sa.Column("evidence_content_sha256", _JSON, nullable=False),
        sa.Column("assertion_json", _JSON, nullable=False),
        sa.Column("assertion_sha256", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "char_length(assertion_key) between 1 and 512",
            name="ck_github_metadata_assertions_key",
        ),
        sa.CheckConstraint(
            "char_length(extractor_version) between 1 and 100",
            name="ck_github_metadata_assertions_extractor",
        ),
        sa.CheckConstraint(
            "char_length(source_key) between 1 and 100",
            name="ck_github_metadata_assertions_source",
        ),
        sa.CheckConstraint(
            "predicate in ("
            "'license_file_present', "
            "'citation_file_present', "
            "'dependency_declaration_present', "
            "'ci_workflow_present'"
            ")",
            name="ck_github_metadata_assertions_predicate",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(evidence_paths) = 'array'",
            name="ck_github_metadata_assertions_paths",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(evidence_content_sha256) = 'array'",
            name="ck_github_metadata_assertions_evidence_digests",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(assertion_json) = 'object'",
            name="ck_github_metadata_assertions_json",
        ),
        sa.CheckConstraint(
            "assertion_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_github_metadata_assertions_sha",
        ),
        sa.UniqueConstraint(
            "snapshot_id",
            "assertion_key",
            name="uq_github_metadata_assertions_snapshot_key",
        ),
    )
    op.create_index(
        "ix_github_metadata_assertions_snapshot",
        "github_metadata_assertions",
        ["snapshot_id"],
    )

    op.create_table(
        "vqe_component_implementation_candidates",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "snapshot_id",
            _UUID,
            sa.ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("candidate_key", sa.Text(), nullable=False),
        sa.Column("adapter_version", sa.Text(), nullable=False),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("provider_key", sa.Text(), nullable=False),
        sa.Column("component_semantic_key", sa.Text()),
        sa.Column("match_state", sa.Text(), nullable=False),
        sa.Column("candidate_json", _JSON, nullable=False),
        sa.Column("candidate_sha256", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "char_length(candidate_key) between 1 and 512",
            name="ck_vqe_component_implementation_candidates_key",
        ),
        sa.CheckConstraint(
            "char_length(adapter_version) between 1 and 100",
            name="ck_vqe_component_implementation_candidates_adapter",
        ),
        sa.CheckConstraint(
            "char_length(source_key) between 1 and 100",
            name="ck_vqe_component_implementation_candidates_source",
        ),
        sa.CheckConstraint(
            "char_length(provider_key) between 1 and 100",
            name="ck_vqe_component_implementation_candidates_provider",
        ),
        sa.CheckConstraint(
            "component_semantic_key is null or "
            "char_length(component_semantic_key) between 1 and 200",
            name="ck_vqe_component_implementation_candidates_semantic_key",
        ),
        sa.CheckConstraint(
            "match_state in ('unmatched', 'matched_existing', 'rejected')",
            name="ck_vqe_component_implementation_candidates_match_state",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(candidate_json) = 'object'",
            name="ck_vqe_component_implementation_candidates_json",
        ),
        sa.CheckConstraint(
            "candidate_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_component_implementation_candidates_sha",
        ),
        sa.UniqueConstraint(
            "snapshot_id",
            "candidate_key",
            name="uq_vqe_component_implementation_candidates_snapshot_key",
        ),
    )
    op.create_index(
        "ix_vqe_component_implementation_candidates_snapshot",
        "vqe_component_implementation_candidates",
        ["snapshot_id"],
    )
    op.create_index(
        "ix_vqe_component_implementation_candidates_match",
        "vqe_component_implementation_candidates",
        ["match_state", "provider_key"],
    )

    op.execute(
        f"""
        create function {_IMMUTABLE_FUNCTION}()
        returns trigger
        language plpgsql
        as $$
        begin
            raise exception 'VQE source staging evidence is append-only';
        end;
        $$;
        """
    )
    for table in _IMMUTABLE_TABLES:
        op.execute(
            f"""
            create trigger trg_{table}_append_only
            before update or delete on {table}
            for each row execute function {_IMMUTABLE_FUNCTION}();
            """
        )
        _grant_append_only(table)


def downgrade() -> None:
    connection = op.get_bind()
    count = connection.execute(
        sa.text(
            """
            select
                (select count(*) from github_metadata_assertions)
              + (select count(*) from vqe_component_implementation_candidates)
            """
        )
    ).scalar_one()
    if count:
        raise RuntimeError("cannot downgrade 0042 while VQE source staging evidence exists")

    for table in reversed(_IMMUTABLE_TABLES):
        op.execute(f"drop trigger if exists trg_{table}_append_only on {table}")
    op.execute(f"drop function if exists {_IMMUTABLE_FUNCTION}()")

    op.drop_index(
        "ix_vqe_component_implementation_candidates_match",
        table_name="vqe_component_implementation_candidates",
    )
    op.drop_index(
        "ix_vqe_component_implementation_candidates_snapshot",
        table_name="vqe_component_implementation_candidates",
    )
    op.drop_table("vqe_component_implementation_candidates")
    op.drop_index(
        "ix_github_metadata_assertions_snapshot",
        table_name="github_metadata_assertions",
    )
    op.drop_table("github_metadata_assertions")
