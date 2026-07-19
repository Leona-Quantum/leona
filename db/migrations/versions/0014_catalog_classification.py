"""Add catalog classification, review/publication state, and version hash fields.

Revision ID: 0014
Revises: 0013

Every new column is nullable and additive: existing personal/team artifacts
are not classified by this schema and keep every new column NULL forever.
Only the Step 3 private staging path (services/api/src/majorana_api/repos/
catalog.py) populates them, and it hard-codes review_state='draft' and
publication_state='private' on every insert — never public, regardless of
caller input.
"""

from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

ARTIFACT_KIND = (
    "circuit",
    "gate",
    "algorithm_template",
    "state_preparation",
    "operator",
    "benchmark_instance",
    "literature_method",
)
EXECUTION_STATE = ("executable", "template_only", "documentation_only", "unsupported")
REVIEW_STATE = ("draft", "quarantined", "pending_review", "accepted", "rejected")
PUBLICATION_STATE = ("private", "staged", "public", "retracted", "deprecated")
AUTHORITATIVE_FRAMEWORK = ("qiskit", "pennylane", "cirq")
_SHA256_HEX = "^[0-9a-f]{64}$"


def _nullable_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} is null or {column} in ({quoted})"


def upgrade() -> None:
    op.add_column("artifacts", sa.Column("artifact_kind", sa.Text(), nullable=True))
    op.add_column("artifacts", sa.Column("execution_state", sa.Text(), nullable=True))
    op.add_column("artifacts", sa.Column("review_state", sa.Text(), nullable=True))
    op.add_column("artifacts", sa.Column("publication_state", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_artifacts_artifact_kind_enum",
        "artifacts",
        _nullable_check("artifact_kind", ARTIFACT_KIND),
    )
    op.create_check_constraint(
        "ck_artifacts_execution_state_enum",
        "artifacts",
        _nullable_check("execution_state", EXECUTION_STATE),
    )
    op.create_check_constraint(
        "ck_artifacts_review_state_enum",
        "artifacts",
        _nullable_check("review_state", REVIEW_STATE),
    )
    op.create_check_constraint(
        "ck_artifacts_publication_state_enum",
        "artifacts",
        _nullable_check("publication_state", PUBLICATION_STATE),
    )
    op.create_index(
        "ix_artifacts_review_state",
        "artifacts",
        ["review_state"],
        postgresql_where=sa.text("review_state is not null"),
    )
    op.create_index(
        "ix_artifacts_publication_state",
        "artifacts",
        ["publication_state"],
        postgresql_where=sa.text("publication_state is not null"),
    )

    op.add_column(
        "artifact_versions", sa.Column("metadata_schema_version", sa.Text(), nullable=True)
    )
    op.add_column(
        "artifact_versions", sa.Column("authoritative_framework", sa.Text(), nullable=True)
    )
    op.add_column(
        "artifact_versions",
        sa.Column("authoritative_framework_version", sa.Text(), nullable=True),
    )
    op.add_column("artifact_versions", sa.Column("source_language", sa.Text(), nullable=True))
    op.add_column("artifact_versions", sa.Column("source_blob_sha256", sa.Text(), nullable=True))
    op.add_column(
        "artifact_versions", sa.Column("normalized_source_hash", sa.Text(), nullable=True)
    )
    op.add_column("artifact_versions", sa.Column("semantic_fingerprint", sa.Text(), nullable=True))
    op.add_column(
        "artifact_versions",
        sa.Column("semantic_fingerprint_algorithm", sa.Text(), nullable=True),
    )
    op.add_column("artifact_versions", sa.Column("toolchain_digest", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_artifact_versions_authoritative_framework_enum",
        "artifact_versions",
        _nullable_check("authoritative_framework", AUTHORITATIVE_FRAMEWORK),
    )
    op.create_check_constraint(
        "ck_artifact_versions_source_blob_sha256_format",
        "artifact_versions",
        f"source_blob_sha256 is null or source_blob_sha256 ~ '{_SHA256_HEX}'",
    )
    op.create_check_constraint(
        "ck_artifact_versions_normalized_source_hash_format",
        "artifact_versions",
        f"normalized_source_hash is null or normalized_source_hash ~ '{_SHA256_HEX}'",
    )
    # Global exact-duplicate rejection (plan §5.1). Postgres excludes NULL from
    # uniqueness, so versions outside the catalog staging path (which never
    # populate this column) can never collide with each other. This is scoped
    # to catalog staging by convention, not a workspace predicate, because
    # artifact_versions carries no workspace_id (see repos/artifacts.py) — any
    # future writer of this column joins the same duplicate-rejection pool.
    op.create_unique_constraint(
        "uq_artifact_versions_normalized_source_hash",
        "artifact_versions",
        ["normalized_source_hash"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    staged = connection.execute(
        sa.text(
            "SELECT count(*) FROM artifacts "
            "WHERE review_state IS NOT NULL OR publication_state IS NOT NULL"
        )
    ).scalar_one()
    if staged:
        raise RuntimeError(
            "cannot downgrade 0014 while staged catalog artifacts exist; "
            "remove or reset Step 3 staging data first"
        )

    op.drop_constraint(
        "uq_artifact_versions_normalized_source_hash", "artifact_versions", type_="unique"
    )
    op.drop_constraint(
        "ck_artifact_versions_normalized_source_hash_format", "artifact_versions", type_="check"
    )
    op.drop_constraint(
        "ck_artifact_versions_source_blob_sha256_format", "artifact_versions", type_="check"
    )
    op.drop_constraint(
        "ck_artifact_versions_authoritative_framework_enum", "artifact_versions", type_="check"
    )
    op.drop_column("artifact_versions", "toolchain_digest")
    op.drop_column("artifact_versions", "semantic_fingerprint_algorithm")
    op.drop_column("artifact_versions", "semantic_fingerprint")
    op.drop_column("artifact_versions", "normalized_source_hash")
    op.drop_column("artifact_versions", "source_blob_sha256")
    op.drop_column("artifact_versions", "source_language")
    op.drop_column("artifact_versions", "authoritative_framework_version")
    op.drop_column("artifact_versions", "authoritative_framework")
    op.drop_column("artifact_versions", "metadata_schema_version")

    op.drop_index("ix_artifacts_publication_state", table_name="artifacts")
    op.drop_index("ix_artifacts_review_state", table_name="artifacts")
    op.drop_constraint("ck_artifacts_publication_state_enum", "artifacts", type_="check")
    op.drop_constraint("ck_artifacts_review_state_enum", "artifacts", type_="check")
    op.drop_constraint("ck_artifacts_execution_state_enum", "artifacts", type_="check")
    op.drop_constraint("ck_artifacts_artifact_kind_enum", "artifacts", type_="check")
    op.drop_column("artifacts", "publication_state")
    op.drop_column("artifacts", "review_state")
    op.drop_column("artifacts", "execution_state")
    op.drop_column("artifacts", "artifact_kind")
