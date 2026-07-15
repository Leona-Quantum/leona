"""Add durable tool-calling agent state and candidate evidence.

Revision ID: 0010
Revises: 0009
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("run_id", _UUID, sa.ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("state", sa.Text(), nullable=False, server_default="new"),
        sa.Column("plan_id", _UUID),
        sa.Column("plan", _JSON),
        sa.Column("publication", _JSON),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "state IN ('new','planned','executed','repair_required','verified',"
            "'qasm_attempted','published','completed','failed','cancelled')",
            name="ck_agent_runs_state",
        ),
    )
    op.create_table(
        "agent_steps",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("run_id", _UUID, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tool_call_id", sa.Text(), nullable=False),
        sa.Column("tool_call_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("arguments", _JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default="started"),
        sa.Column("state", sa.Text()),
        sa.Column("result", _JSON),
        sa.Column("error_code", sa.Text()),
        sa.Column("error_message", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True)),
        sa.UniqueConstraint("run_id", "tool_call_id", name="uq_agent_steps_tool_call"),
        sa.CheckConstraint("status IN ('started','completed')", name="ck_agent_steps_status"),
        sa.CheckConstraint(
            "name IN ('request_plan','simulate_qiskit','simulate_cirq','simulate_pennylane',"
            "'verify_intent_alignment','convert_to_openqasm','publish_artifact')",
            name="ck_agent_steps_name",
        ),
        sa.CheckConstraint(
            "char_length(tool_call_id) BETWEEN 1 AND 200",
            name="ck_agent_steps_tool_call_length",
        ),
    )
    op.create_index("ix_agent_steps_run_created", "agent_steps", ["run_id", "created_at"])
    op.create_table(
        "run_candidates",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("run_id", _UUID, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("parent_candidate_id", _UUID, sa.ForeignKey("run_candidates.id")),
        sa.Column("plan_id", _UUID, nullable=False),
        sa.Column("framework", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="created"),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("run_id", "revision", name="uq_run_candidates_revision"),
        sa.UniqueConstraint("run_id", "tool_call_id", name="uq_run_candidates_tool_call"),
        sa.CheckConstraint("revision >= 1", name="ck_run_candidates_revision"),
        sa.CheckConstraint(
            "char_length(source) BETWEEN 1 AND 200000", name="ck_run_candidates_source_length"
        ),
        sa.CheckConstraint(
            "source_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_run_candidates_fingerprint"
        ),
        sa.CheckConstraint(
            "framework IN ('qiskit','cirq','pennylane')", name="ck_run_candidates_framework"
        ),
        sa.CheckConstraint(
            "status IN ('created','executed','repair_required','verified','published')",
            name="ck_run_candidates_status",
        ),
    )
    op.create_index("ix_run_candidates_run", "run_candidates", ["run_id", "revision"])
    op.create_table(
        "candidate_executions",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "candidate_id",
            _UUID,
            sa.ForeignKey("run_candidates.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("environment_fingerprint", sa.Text(), nullable=False),
        sa.Column("sandbox_provider", sa.Text(), nullable=False),
        sa.Column("exit_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("result", _JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("observation", _JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("duration_ms >= 0", name="ck_candidate_executions_duration"),
        sa.CheckConstraint(
            "source_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_candidate_executions_source_fingerprint",
        ),
        sa.CheckConstraint(
            "environment_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_candidate_executions_environment_fingerprint",
        ),
    )
    op.create_table(
        "candidate_verifications",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "candidate_id",
            _UUID,
            sa.ForeignKey("run_candidates.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "execution_id",
            _UUID,
            sa.ForeignKey("candidate_executions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column(
            "deterministic_checks", _JSON, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("critic", _JSON),
        sa.Column("repair", _JSON),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "decision IN ('pass','fail','inconclusive')", name="ck_candidate_verifications_decision"
        ),
        sa.CheckConstraint(
            "source_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_candidate_verifications_fingerprint",
        ),
    )
    op.create_table(
        "candidate_conversions",
        sa.Column(
            "candidate_id",
            _UUID,
            sa.ForeignKey("run_candidates.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("qasm", sa.Text()),
        sa.Column("reason", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status IN ('available','unavailable')", name="ck_candidate_conversions_status"
        ),
        sa.CheckConstraint(
            "source_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_candidate_conversions_fingerprint",
        ),
    )
    op.execute(
        """
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update, delete on
                    agent_runs, agent_steps, run_candidates, candidate_executions,
                    candidate_verifications, candidate_conversions to app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_table("candidate_conversions")
    op.drop_table("candidate_verifications")
    op.drop_table("candidate_executions")
    op.drop_index("ix_run_candidates_run", table_name="run_candidates")
    op.drop_table("run_candidates")
    op.drop_index("ix_agent_steps_run_created", table_name="agent_steps")
    op.drop_table("agent_steps")
    op.drop_table("agent_runs")
