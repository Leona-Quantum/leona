"""schema v1 — all entities from plans/archive/rebuild/04-database.md §2
(archived; live schema authority is majorana/docs/runbooks/database.md)

Revision ID: 0001
Revises: None

Enum values are hardcoded snapshots of majorana-contracts 0.1.0 (enums.py /
events.py) — migrations are frozen history and must not import live code.
Additive enum changes land as new migrations altering the CHECK constraint.
`api_keys` is reserved, not built (post-MVP). No FTS index yet: there is no
explanation-text column in v1; pg_trgm on artifacts.title covers MVP search.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, INET, UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

WORKSPACE_KIND = ("personal", "team")
ROLE = ("owner", "admin", "member", "viewer")
FRAMEWORK = ("qiskit", "pennylane", "cirq")
VISIBILITY = ("private", "public")
FAMILY = (
    "VQE",
    "QAOA",
    "Grover",
    "Bell",
    "GHZ",
    "QFT",
    "QPE",
    "AmplitudeEstimation",
    "StatePreparation",
    "CircuitSynthesis",
    "GateDecomposition",
    "Transpilation",
    "Simulation",
    "ErrorCorrection",
    "other",
)
EXPORT_STATUS = ("lossless", "lossy_with_reason", "download_only", "unsupported")
RUN_MODE = ("execute", "ideate", "explain")
RUN_STATUS = ("queued", "running", "succeeded", "failed", "cancelled")
VERIFIER_DECISION = ("pass", "fail", "inconclusive")
VERIFICATION_METHOD = (
    "exact",
    "statistical",
    "brute_force",
    "exact_diag",
    "return_contract",
    "qasm_parse",
)
VERIFICATION_RESULT = ("pass", "fail")
JOB_STATUS = ("queued", "running", "done", "failed", "dead")
USAGE_KIND = ("run", "llm_tokens", "sandbox_seconds")
RUN_EVENT_TYPE = (
    "run.queued",
    "run.started",
    "stage.started",
    "stage.finished",
    "plan.produced",
    "llm.call",
    "llm.delta",
    "code.generated",
    "sandbox.result",
    "verification.result",
    "baseline.result",
    "export.classified",
    "artifact.saved",
    "run.error",
    "run.finished",
)

# Append-only tables: no UPDATE/DELETE for the app role (04-database.md §1).
APPEND_ONLY = ("run_events", "audit_log", "usage_events")


def _uuid_pk() -> sa.Column:
    # UUIDv7, generated app-side — no server default on purpose.
    return sa.Column("id", UUID(as_uuid=True), primary_key=True)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def _check_in(column: str, values: tuple[str, ...]) -> sa.CheckConstraint:
    quoted = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"{column} in ({quoted})", name=f"ck_{column}_enum")


def upgrade() -> None:
    op.execute("create extension if not exists pg_trgm")

    op.create_table(
        "users",
        _uuid_pk(),
        sa.Column("workos_user_id", sa.Text, nullable=False, unique=True),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("display_name", sa.Text),
        sa.Column("plan", sa.Text, nullable=False, server_default="free"),
        _created_at(),
        _updated_at(),
    )

    op.create_table(
        "workspaces",
        _uuid_pk(),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("owner_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("plan", sa.Text, nullable=False, server_default="free"),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True)),
        _created_at(),
        _updated_at(),
        _check_in("kind", WORKSPACE_KIND),
    )

    op.create_table(
        "memberships",
        sa.Column(
            "workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), primary_key=True
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.Text, nullable=False),
        _created_at(),
        _updated_at(),
        _check_in("role", ROLE),
    )
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])

    op.create_table(
        "artifacts",
        _uuid_pk(),
        sa.Column(
            "workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("slug", sa.Text, nullable=False, unique=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("family", sa.Text, nullable=False),
        sa.Column("framework", sa.Text, nullable=False),
        sa.Column("visibility", sa.Text, nullable=False, server_default="private"),
        sa.Column("parent_artifact_id", UUID(as_uuid=True), sa.ForeignKey("artifacts.id")),
        # FK to artifact_versions added below (circular reference).
        sa.Column("current_version_id", UUID(as_uuid=True)),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True)),
        _created_at(),
        _updated_at(),
        _check_in("family", FAMILY),
        _check_in("framework", FRAMEWORK),
        _check_in("visibility", VISIBILITY),
    )
    op.create_index(
        "ix_artifacts_workspace_family_created",
        "artifacts",
        ["workspace_id", "family", sa.text("created_at desc")],
    )
    op.create_index(
        "ix_artifacts_public_browse",
        "artifacts",
        ["visibility", "family", sa.text("created_at desc")],
        postgresql_where=sa.text("visibility = 'public' and deleted_at is null"),
    )
    op.create_index(
        "ix_artifacts_title_trgm",
        "artifacts",
        ["title"],
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )

    op.create_table(
        "artifact_versions",
        _uuid_pk(),
        sa.Column("artifact_id", UUID(as_uuid=True), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("ir_version", sa.Text, nullable=False),
        sa.Column("ir", JSONB, nullable=False),
        sa.Column("code", sa.Text, nullable=False),
        sa.Column("code_lang", sa.Text, nullable=False),
        sa.Column("fingerprint", sa.Text, nullable=False),
        sa.Column("export_status", sa.Text, nullable=False),
        sa.Column("export_reason", sa.Text),
        sa.Column("qasm", sa.Text),
        sa.Column("resource_estimates", JSONB),
        sa.Column("limitations", sa.Text),
        _created_at(),
        _check_in("export_status", EXPORT_STATUS),
        sa.UniqueConstraint("artifact_id", "seq", name="uq_artifact_versions_seq"),
        sa.UniqueConstraint("artifact_id", "fingerprint", name="uq_artifact_versions_fingerprint"),
    )
    op.create_foreign_key(
        "fk_artifacts_current_version",
        "artifacts",
        "artifact_versions",
        ["current_version_id"],
        ["id"],
    )

    op.create_table(
        "runs",
        _uuid_pk(),
        sa.Column(
            "workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("artifact_version_id", UUID(as_uuid=True), sa.ForeignKey("artifact_versions.id")),
        sa.Column("task_prompt", sa.Text, nullable=False),
        sa.Column("mode", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="queued"),
        sa.Column("framework", sa.Text, nullable=False),
        sa.Column("seed", sa.BigInteger),
        sa.Column("shots", sa.Integer),
        sa.Column("tolerances", JSONB),
        sa.Column("timeout_s", sa.Integer),
        sa.Column("sandbox_provider", sa.Text),
        sa.Column("sandbox_meta", JSONB),
        sa.Column("verifier_decision", sa.Text),
        sa.Column("residual_risks", sa.Text),
        sa.Column("baseline", JSONB),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True)),
        _created_at(),
        _updated_at(),
        _check_in("mode", RUN_MODE),
        _check_in("status", RUN_STATUS),
        _check_in("framework", FRAMEWORK),
        sa.CheckConstraint(
            "verifier_decision is null or verifier_decision in ('pass', 'fail', 'inconclusive')",
            name="ck_verifier_decision_enum",
        ),
    )
    op.create_index(
        "ix_runs_workspace_created", "runs", ["workspace_id", sa.text("created_at desc")]
    )

    op.create_table(
        "run_events",
        _uuid_pk(),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column(
            "ts", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        _created_at(),
        _check_in("type", RUN_EVENT_TYPE),
        # Powers both replay and SSE resume (Last-Event-ID).
        sa.UniqueConstraint("run_id", "seq", name="uq_run_events_seq"),
    )

    op.create_table(
        "verification_records",
        _uuid_pk(),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("method", sa.Text, nullable=False),
        sa.Column("params", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("result", sa.Text, nullable=False),
        sa.Column("details", JSONB),
        _created_at(),
        _check_in("method", VERIFICATION_METHOD),
        _check_in("result", VERIFICATION_RESULT),
    )
    op.create_index("ix_verification_records_run_id", "verification_records", ["run_id"])

    op.create_table(
        "jobs",
        _uuid_pk(),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="queued"),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("runs.id")),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("locked_by", sa.Text),
        sa.Column("locked_at", sa.TIMESTAMP(timezone=True)),
        sa.Column(
            "run_after",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_error", sa.Text),
        _created_at(),
        _updated_at(),
        _check_in("status", JOB_STATUS),
    )
    # Worker wakeups poll (status, run_after) — no LISTEN/NOTIFY through PgBouncer.
    op.create_index("ix_jobs_status_run_after", "jobs", ["status", "run_after"])

    op.create_table(
        "usage_events",
        _uuid_pk(),
        sa.Column(
            "workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("quantity", sa.Numeric, nullable=False),
        sa.Column("meta", JSONB),
        sa.Column(
            "ts", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        _created_at(),
        _check_in("kind", USAGE_KIND),
    )
    op.create_index("ix_usage_events_workspace_ts", "usage_events", ["workspace_id", "ts"])

    op.create_table(
        "audit_log",
        _uuid_pk(),
        sa.Column("workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id")),
        sa.Column("actor_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("target_kind", sa.Text),
        sa.Column("target_id", UUID(as_uuid=True)),
        sa.Column("ip", INET),
        sa.Column(
            "ts", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("meta", JSONB),
        _created_at(),
    )
    op.create_index("ix_audit_log_workspace_ts", "audit_log", ["workspace_id", "ts"])

    # Grants for app_rw (applied only where the role exists — CI branch DBs and
    # local scratch DBs run migrations as the owner without app roles present).
    op.execute(
        """
        do $$
        begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant usage on schema public to app_rw;
                grant select, insert, update, delete on all tables in schema public to app_rw;
                revoke update, delete on run_events, audit_log, usage_events from app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_artifacts_current_version", "artifacts", type_="foreignkey")
    for table in (
        "audit_log",
        "usage_events",
        "jobs",
        "verification_records",
        "run_events",
        "runs",
        "artifact_versions",
        "artifacts",
        "memberships",
        "workspaces",
        "users",
    ):
        op.drop_table(table)
    op.execute("drop extension if exists pg_trgm")
