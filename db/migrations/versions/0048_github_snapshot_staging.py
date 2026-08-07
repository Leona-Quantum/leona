"""Add immutable private staging for bounded GitHub metadata snapshots.

Revision ID: 0048
Revises: 0047, vqe_0047

Phase 7 S4 persists the already bounded and content-verified snapshot produced
by ``github_snapshot.py``.  It deliberately does not create a public Artifact,
Component Definition, or verification claim.  The request ledger separates
HTTP/operator idempotency from the scientific/source identity:

    repository numeric id + immutable commit + importer policy version

Snapshot rows, selected metadata bytes, and request bindings are append-only.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0048"
down_revision = ("0047", "vqe_0047")
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())
_IMMUTABLE_FUNCTION = "majorana_reject_github_snapshot_mutation"
_IMMUTABLE_TABLES = (
    "github_repository_snapshots",
    "github_repository_snapshot_files",
    "github_snapshot_import_requests",
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
        "github_repository_snapshots",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("repository_id", sa.BigInteger(), nullable=False),
        sa.Column("repository_node_id", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("canonical_repository_url", sa.Text(), nullable=False),
        sa.Column("requested_ref", sa.Text()),
        sa.Column("default_branch", sa.Text(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("disabled", sa.Boolean(), nullable=False),
        sa.Column("api_version", sa.Text(), nullable=False),
        sa.Column("commit_sha", sa.Text(), nullable=False),
        sa.Column("tree_sha", sa.Text(), nullable=False),
        sa.Column("tree_entry_count", sa.Integer(), nullable=False),
        sa.Column("tree_manifest_sha256", sa.Text(), nullable=False),
        sa.Column("selected_metadata_bytes", sa.Integer(), nullable=False),
        sa.Column("metadata_manifest_sha256", sa.Text(), nullable=False),
        sa.Column("skipped_oversized_paths", _JSON, nullable=False, server_default="[]"),
        sa.Column("importer_policy_version", sa.Text(), nullable=False),
        sa.Column("audit_manifest_json", _JSON, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "repository_id > 0",
            name="ck_github_repository_snapshots_repository_id",
        ),
        sa.CheckConstraint(
            "char_length(full_name) between 3 and 140",
            name="ck_github_repository_snapshots_full_name",
        ),
        sa.CheckConstraint(
            "canonical_repository_url ~ '^https://github[.]com/[^/]+/[^/]+$'",
            name="ck_github_repository_snapshots_canonical_url",
        ),
        sa.CheckConstraint(
            "requested_ref is null or char_length(requested_ref) between 1 and 255",
            name="ck_github_repository_snapshots_requested_ref",
        ),
        sa.CheckConstraint(
            "commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'",
            name="ck_github_repository_snapshots_commit_sha",
        ),
        sa.CheckConstraint(
            "tree_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'",
            name="ck_github_repository_snapshots_tree_sha",
        ),
        sa.CheckConstraint(
            "tree_entry_count between 0 and 100000",
            name="ck_github_repository_snapshots_tree_count",
        ),
        sa.CheckConstraint(
            "selected_metadata_bytes between 0 and 2097152",
            name="ck_github_repository_snapshots_metadata_bytes",
        ),
        sa.CheckConstraint(
            "tree_manifest_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_github_repository_snapshots_tree_manifest_sha",
        ),
        sa.CheckConstraint(
            "metadata_manifest_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_github_repository_snapshots_metadata_manifest_sha",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(skipped_oversized_paths) = 'array'",
            name="ck_github_repository_snapshots_skipped_paths_json",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(audit_manifest_json) = 'object'",
            name="ck_github_repository_snapshots_audit_json",
        ),
        sa.CheckConstraint(
            "char_length(importer_policy_version) between 1 and 100",
            name="ck_github_repository_snapshots_policy_version",
        ),
        sa.UniqueConstraint(
            "repository_id",
            "commit_sha",
            "importer_policy_version",
            name="uq_github_repository_snapshots_identity",
        ),
    )
    op.create_index(
        "ix_github_repository_snapshots_name_created",
        "github_repository_snapshots",
        ["full_name", "created_at"],
    )

    op.create_table(
        "github_repository_snapshot_files",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "snapshot_id",
            _UUID,
            sa.ForeignKey("github_repository_snapshots.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("blob_sha", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.Text(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "char_length(path) between 1 and 1024",
            name="ck_github_repository_snapshot_files_path",
        ),
        sa.CheckConstraint(
            "mode in ('100644', '100755')",
            name="ck_github_repository_snapshot_files_mode",
        ),
        sa.CheckConstraint(
            "blob_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'",
            name="ck_github_repository_snapshot_files_blob_sha",
        ),
        sa.CheckConstraint(
            "size between 0 and 262144 and octet_length(content) = size",
            name="ck_github_repository_snapshot_files_size",
        ),
        sa.CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_github_repository_snapshot_files_content_sha",
        ),
        sa.UniqueConstraint(
            "snapshot_id",
            "path",
            name="uq_github_repository_snapshot_files_path",
        ),
    )
    op.create_index(
        "ix_github_repository_snapshot_files_snapshot",
        "github_repository_snapshot_files",
        ["snapshot_id"],
    )

    op.create_table(
        "github_snapshot_import_requests",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("idempotency_key", sa.Text(), nullable=False, unique=True),
        sa.Column(
            "snapshot_id",
            _UUID,
            sa.ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("request_descriptor_json", _JSON, nullable=False),
        sa.Column("request_descriptor_sha256", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "char_length(idempotency_key) between 1 and 255",
            name="ck_github_snapshot_import_requests_key",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(request_descriptor_json) = 'object'",
            name="ck_github_snapshot_import_requests_descriptor_json",
        ),
        sa.CheckConstraint(
            "request_descriptor_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_github_snapshot_import_requests_descriptor_sha",
        ),
    )
    op.create_index(
        "ix_github_snapshot_import_requests_snapshot",
        "github_snapshot_import_requests",
        ["snapshot_id"],
    )

    op.execute(
        f"""
        create function {_IMMUTABLE_FUNCTION}()
        returns trigger
        language plpgsql
        as $$
        begin
            raise exception 'GitHub snapshot staging evidence is append-only';
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
                (select count(*) from github_repository_snapshots)
              + (select count(*) from github_repository_snapshot_files)
              + (select count(*) from github_snapshot_import_requests)
            """
        )
    ).scalar_one()
    if count:
        raise RuntimeError("cannot downgrade 0048 while GitHub snapshot staging evidence exists")

    for table in reversed(_IMMUTABLE_TABLES):
        op.execute(f"drop trigger if exists trg_{table}_append_only on {table}")
    op.execute(f"drop function if exists {_IMMUTABLE_FUNCTION}()")

    op.drop_index(
        "ix_github_snapshot_import_requests_snapshot",
        table_name="github_snapshot_import_requests",
    )
    op.drop_table("github_snapshot_import_requests")
    op.drop_index(
        "ix_github_repository_snapshot_files_snapshot",
        table_name="github_repository_snapshot_files",
    )
    op.drop_table("github_repository_snapshot_files")
    op.drop_index(
        "ix_github_repository_snapshots_name_created",
        table_name="github_repository_snapshots",
    )
    op.drop_table("github_repository_snapshots")
