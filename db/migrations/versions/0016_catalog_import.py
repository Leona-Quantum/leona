"""Add durable catalog import batch/item tracking.

Revision ID: 0016
Revises: 0015

Step 5a scope only: the schema and state machine for a durable, resumable,
item-independent import pipeline, exercised by one controlled local/file
fixture provider (repos/catalog_import.py). No network fetcher, SSRF
hardening, or external adapter (bootstrap manifest, MQT Bench, QASMBench)
is introduced here — those are a separate, explicitly scoped later slice
(repository Step 5 plan §5.3, §7.1).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

_UUID = UUID(as_uuid=True)
_SHA256_HEX = "^[0-9a-f]{64}$"

# Closed allowlist. Grows only when a real network adapter is implemented
# and its adversarial fixture tests pass (plan §5.3 Step 5 Done-when).
IMPORT_PROVIDER = ("local_fixture",)
IMPORT_JOB_STATUS = (
    "queued",
    "running",
    "completed",
    "completed_with_rejections",
    "failed",
    "dead",
)
# quarantined here means "raw bytes safely stored, awaiting parse" (plan §6
# step 4) — a normal pipeline stage, distinct from the catalog review_state
# quarantine (migration 0014/0015) which is a legal/rights hold.
IMPORT_ITEM_STATE = (
    "queued",
    "fetching",
    "quarantined",
    "parsing",
    "staged",
    "rejected",
    "retry_wait",
    "dead",
)


def _uuid_pk() -> sa.Column:
    return sa.Column("id", _UUID, primary_key=True)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
    )


def _check_in(column: str, values: tuple[str, ...], *, table: str) -> sa.CheckConstraint:
    quoted = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"{column} in ({quoted})", name=f"ck_{table}_{column}_enum")


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        _uuid_pk(),
        sa.Column("job_id", _UUID, sa.ForeignKey("jobs.id"), nullable=False, unique=True),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("upstream_ref", sa.Text, nullable=False),
        sa.Column("idempotency_key", sa.Text, nullable=False, unique=True),
        sa.Column("status", sa.Text, nullable=False, server_default="queued"),
        sa.Column("item_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("accepted_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rejected_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("dead_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True)),
        _created_at(),
        _updated_at(),
        _check_in("provider", IMPORT_PROVIDER, table="import_jobs"),
        _check_in("status", IMPORT_JOB_STATUS, table="import_jobs"),
    )

    op.create_table(
        "import_items",
        _uuid_pk(),
        sa.Column("import_job_id", _UUID, sa.ForeignKey("import_jobs.id"), nullable=False),
        sa.Column("upstream_identity", sa.Text, nullable=False),
        sa.Column("state", sa.Text, nullable=False, server_default="queued"),
        sa.Column("failure_code", sa.Text),
        sa.Column("raw_metadata", JSONB),
        sa.Column("source_blob_sha256", sa.Text),
        sa.Column("resulting_artifact_id", _UUID, sa.ForeignKey("artifacts.id")),
        sa.Column("resulting_version_id", _UUID, sa.ForeignKey("artifact_versions.id")),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer, nullable=False, server_default="3"),
        _created_at(),
        _updated_at(),
        sa.UniqueConstraint(
            "import_job_id", "upstream_identity", name="uq_import_items_job_identity"
        ),
        _check_in("state", IMPORT_ITEM_STATE, table="import_items"),
        sa.CheckConstraint(
            f"source_blob_sha256 is null or source_blob_sha256 ~ '{_SHA256_HEX}'",
            name="ck_import_items_source_blob_sha256_format",
        ),
        sa.CheckConstraint(
            "attempts >= 0 and max_attempts >= 1 and attempts <= max_attempts + 1",
            name="ck_import_items_attempts_bounded",
        ),
    )
    op.create_index("ix_import_items_job_state", "import_items", ["import_job_id", "state"])


def downgrade() -> None:
    connection = op.get_bind()
    counts = connection.execute(
        sa.text("SELECT (SELECT count(*) FROM import_items) + (SELECT count(*) FROM import_jobs)")
    ).scalar_one()
    if counts:
        raise RuntimeError(
            "cannot downgrade 0016 while import job/item rows exist; "
            "drain or reset Step 5a import data first"
        )

    op.drop_index("ix_import_items_job_state", table_name="import_items")
    op.drop_table("import_items")
    op.drop_table("import_jobs")
