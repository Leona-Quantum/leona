"""Add provenance, rights, citation, and tag tables for catalog staging.

Revision ID: 0015
Revises: 0014

New tables only; nothing here is reachable from a public route yet
(repository Step 4 plan §5.2). license_assertions is append-only: a
correction is a new row with supersedes_assertion_id set, never an UPDATE
of reviewer_decision on an existing row.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_UUID = UUID(as_uuid=True)
_SHA256_HEX = "^[0-9a-f]{64}$"

SOURCE_KIND = ("git", "package", "upload", "benchmark_manifest", "literature")
LICENSE_ASSERTION_KIND = ("declared", "detected")
LICENSE_SCOPE = ("whole", "file", "variant")
LICENSE_DECISION = ("pending", "approved", "rejected", "quarantined")
CITATION_RELATION = (
    "describes",
    "original_source",
    "benchmark_reference",
    "implementation_of",
)


def _uuid_pk() -> sa.Column:
    return sa.Column("id", _UUID, primary_key=True)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
    )


def _check_in(column: str, values: tuple[str, ...], *, table: str) -> sa.CheckConstraint:
    quoted = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"{column} in ({quoted})", name=f"ck_{table}_{column}_enum")


def upgrade() -> None:
    op.create_table(
        "artifact_sources",
        _uuid_pk(),
        sa.Column(
            "artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("source_kind", sa.Text, nullable=False),
        sa.Column("repository", sa.Text),
        sa.Column("ref", sa.Text),
        sa.Column("path", sa.Text),
        sa.Column("package_version", sa.Text),
        sa.Column("retrieved_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("retrieval_metadata", JSONB),
        sa.Column("content_hash", sa.Text, nullable=False),
        _created_at(),
        _check_in("source_kind", SOURCE_KIND, table="artifact_sources"),
        sa.CheckConstraint(
            f"content_hash ~ '{_SHA256_HEX}'", name="ck_artifact_sources_content_hash_format"
        ),
    )

    op.create_table(
        "license_assertions",
        _uuid_pk(),
        sa.Column(
            "artifact_version_id", _UUID, sa.ForeignKey("artifact_versions.id"), nullable=False
        ),
        sa.Column("spdx_id", sa.Text),
        sa.Column("assertion_kind", sa.Text, nullable=False),
        sa.Column("evidence_hash", sa.Text),
        sa.Column("license_scope", sa.Text, nullable=False),
        sa.Column("confidence", sa.Numeric),
        sa.Column("reviewer_decision", sa.Text, nullable=False, server_default="pending"),
        sa.Column("reviewer_user_id", _UUID, sa.ForeignKey("users.id")),
        sa.Column("supersedes_assertion_id", _UUID, sa.ForeignKey("license_assertions.id")),
        _created_at(),
        _check_in("assertion_kind", LICENSE_ASSERTION_KIND, table="license_assertions"),
        _check_in("license_scope", LICENSE_SCOPE, table="license_assertions"),
        _check_in("reviewer_decision", LICENSE_DECISION, table="license_assertions"),
        sa.CheckConstraint(
            f"evidence_hash is null or evidence_hash ~ '{_SHA256_HEX}'",
            name="ck_license_assertions_evidence_hash_format",
        ),
        sa.CheckConstraint(
            "confidence is null or (confidence >= 0 and confidence <= 1)",
            name="ck_license_assertions_confidence_range",
        ),
    )
    op.create_index(
        "ix_license_assertions_version_created",
        "license_assertions",
        ["artifact_version_id", sa.text("created_at desc")],
    )

    op.create_table(
        "artifact_citations",
        _uuid_pk(),
        sa.Column("artifact_id", _UUID, sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("doi", sa.Text),
        sa.Column("arxiv_id", sa.Text),
        sa.Column("url", sa.Text),
        sa.Column("specification_ref", sa.Text),
        sa.Column("authors", JSONB),
        sa.Column("year", sa.Integer),
        sa.Column("relation", sa.Text, nullable=False),
        _created_at(),
        _check_in("relation", CITATION_RELATION, table="artifact_citations"),
        sa.CheckConstraint(
            "doi is not null or arxiv_id is not null or url is not null "
            "or specification_ref is not null",
            name="ck_artifact_citations_has_identifier",
        ),
        sa.CheckConstraint(
            "year is null or (year >= 1900 and year <= 2100)",
            name="ck_artifact_citations_year_range",
        ),
    )
    op.create_index("ix_artifact_citations_artifact", "artifact_citations", ["artifact_id"])

    op.create_table(
        "artifact_tags",
        sa.Column("artifact_id", _UUID, sa.ForeignKey("artifacts.id"), primary_key=True),
        sa.Column("tag", sa.Text, primary_key=True),
        _created_at(),
        sa.CheckConstraint(
            "tag ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(tag) <= 40",
            name="ck_artifact_tags_tag_format",
        ),
    )


def downgrade() -> None:
    connection = op.get_bind()
    counts = connection.execute(
        sa.text(
            "SELECT "
            "(SELECT count(*) FROM artifact_sources) + "
            "(SELECT count(*) FROM license_assertions) + "
            "(SELECT count(*) FROM artifact_citations) + "
            "(SELECT count(*) FROM artifact_tags)"
        )
    ).scalar_one()
    if counts:
        raise RuntimeError(
            "cannot downgrade 0015 while provenance/rights/citation/tag rows exist; "
            "remove or reset Step 4 staging data first"
        )

    op.drop_table("artifact_tags")
    op.drop_index("ix_artifact_citations_artifact", table_name="artifact_citations")
    op.drop_table("artifact_citations")
    op.drop_index("ix_license_assertions_version_created", table_name="license_assertions")
    op.drop_table("license_assertions")
    op.drop_table("artifact_sources")
