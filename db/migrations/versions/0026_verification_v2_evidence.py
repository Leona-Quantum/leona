"""Expand persistence for Verification v2 evidence and routing.

Revision ID: 0026
Revises: 0025

This is expand-first. Legacy agent_runs.plan/plan_id and candidate_verifications
remain intact while immutable Plan revisions, semantic reviews, and strict
verification attempts become available. Downgrade removes only revision-1 rows
that are reproducible from the legacy columns; it refuses to discard new evidence.
"""

from __future__ import annotations

import hashlib
import json
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())

_AGENT_STATES_OLD = (
    "new",
    "planned",
    "executed",
    "repair_required",
    "resource_exhausted",
    "verified",
    "qasm_attempted",
    "published",
    "completed",
    "failed",
    "cancelled",
)
_AGENT_STATES_NEW = (
    *_AGENT_STATES_OLD,
    "reviewed",
    "replan_required",
    "ready_for_strict_verification",
    "inconclusive",
    "materialized",
)
_RESULTS_OLD = ("pass", "fail", "skipped")
_RESULTS_NEW = (*_RESULTS_OLD, "unavailable", "error")
_SEMANTIC_DECISIONS = ("ready", "code_repair", "replan", "inconclusive")
_FINAL_DECISIONS = ("pass", "fail", "inconclusive")
_FAILURE_CLASSES = (
    "candidate_defect",
    "plan_defect",
    "evidence_gap",
    "capability_limit",
    "verifier_failure",
    "evidence_conflict",
)
_RETRY_TARGETS = ("code_generation", "planning", "simulation", "verification", "none")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def _plan_fingerprint(plan: object) -> str:
    canonical = json.dumps(plan, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def upgrade() -> None:
    op.create_table(
        "run_plans",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "run_id",
            _UUID,
            sa.ForeignKey("agent_runs.run_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("parent_plan_id", _UUID),
        sa.Column("plan", _JSON, nullable=False),
        sa.Column("plan_fingerprint", sa.Text(), nullable=False),
        sa.Column("replan_reason", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("run_id", "revision", name="uq_run_plans_run_revision"),
        sa.UniqueConstraint("run_id", "id", name="uq_run_plans_run_id"),
        sa.ForeignKeyConstraint(
            ["run_id", "parent_plan_id"],
            ["run_plans.run_id", "run_plans.id"],
            name="fk_run_plans_parent_same_run",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_run_plans_revision"),
        sa.CheckConstraint("plan_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_run_plans_fingerprint"),
        sa.CheckConstraint(
            "(revision = 1 AND parent_plan_id IS NULL) OR "
            "(revision > 1 AND parent_plan_id IS NOT NULL)",
            name="ck_run_plans_parent_revision",
        ),
    )
    op.create_index("ix_run_plans_run_revision", "run_plans", ["run_id", "revision"])

    op.add_column("agent_runs", sa.Column("current_plan_id", _UUID))

    bind = op.get_bind()
    legacy_rows = bind.execute(
        sa.text(
            "SELECT run_id, plan_id, plan FROM agent_runs WHERE plan IS NOT NULL ORDER BY run_id"
        )
    ).mappings()
    for row in legacy_rows:
        plan_id = row["plan_id"] or uuid.uuid5(row["run_id"], "majorana:legacy-plan")
        if row["plan_id"] is None:
            bind.execute(
                sa.text("UPDATE agent_runs SET plan_id = :plan_id WHERE run_id = :run_id"),
                {"plan_id": plan_id, "run_id": row["run_id"]},
            )
        bind.execute(
            sa.text(
                "INSERT INTO run_plans "
                "(id, run_id, revision, parent_plan_id, plan, plan_fingerprint, replan_reason) "
                "VALUES (:id, :run_id, 1, NULL, CAST(:plan AS jsonb), :fingerprint, NULL)"
            ),
            {
                "id": plan_id,
                "run_id": row["run_id"],
                "plan": json.dumps(row["plan"], sort_keys=True, separators=(",", ":")),
                "fingerprint": _plan_fingerprint(row["plan"]),
            },
        )
        bind.execute(
            sa.text("UPDATE agent_runs SET current_plan_id = :plan_id WHERE run_id = :run_id"),
            {"plan_id": plan_id, "run_id": row["run_id"]},
        )

    op.create_foreign_key(
        "fk_agent_runs_current_plan_same_run",
        "agent_runs",
        "run_plans",
        ["run_id", "current_plan_id"],
        ["run_id", "id"],
    )
    op.drop_constraint("fk_run_candidates_plan_same_run", "run_candidates", type_="foreignkey")
    op.create_foreign_key(
        "fk_run_candidates_plan_same_run",
        "run_candidates",
        "run_plans",
        ["run_id", "plan_id"],
        ["run_id", "id"],
    )

    op.create_table(
        "candidate_semantic_reviews",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("candidate_id", _UUID, nullable=False),
        sa.Column("execution_id", _UUID, nullable=False),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("attempt_seq", sa.Integer(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Text()),
        sa.Column("severity", sa.Text()),
        sa.Column("reason_code", sa.Text(), nullable=False),
        sa.Column("failure_class", sa.Text()),
        sa.Column("retry_target", sa.Text(), nullable=False),
        sa.Column("feedback", _JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("candidate_id", "attempt_seq", name="uq_semantic_reviews_attempt"),
        sa.UniqueConstraint(
            "id",
            "candidate_id",
            "execution_id",
            "source_fingerprint",
            name="uq_semantic_reviews_binding",
        ),
        sa.ForeignKeyConstraint(
            ["execution_id", "candidate_id", "source_fingerprint"],
            [
                "candidate_executions.id",
                "candidate_executions.candidate_id",
                "candidate_executions.source_fingerprint",
            ],
            name="fk_semantic_reviews_execution_binding",
        ),
        sa.CheckConstraint("attempt_seq >= 1", name="ck_semantic_reviews_attempt"),
        sa.CheckConstraint(
            _in("decision", _SEMANTIC_DECISIONS), name="ck_semantic_reviews_decision"
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR confidence IN ('high','medium','low')",
            name="ck_semantic_reviews_confidence",
        ),
        sa.CheckConstraint(
            "severity IS NULL OR severity IN ('none','minor','major','blocking')",
            name="ck_semantic_reviews_severity",
        ),
        sa.CheckConstraint(
            "failure_class IS NULL OR " + _in("failure_class", _FAILURE_CLASSES),
            name="ck_semantic_reviews_failure_class",
        ),
        sa.CheckConstraint(_in("retry_target", _RETRY_TARGETS), name="ck_semantic_reviews_retry"),
        sa.CheckConstraint(
            "source_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_semantic_reviews_fingerprint"
        ),
        sa.CheckConstraint(
            "char_length(reason_code) BETWEEN 1 AND 120", name="ck_semantic_reviews_reason"
        ),
    )
    op.create_index(
        "ix_semantic_reviews_candidate_attempt",
        "candidate_semantic_reviews",
        ["candidate_id", "attempt_seq"],
    )

    op.create_table(
        "candidate_verification_attempts",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("candidate_id", _UUID, nullable=False),
        sa.Column("execution_id", _UUID, nullable=False),
        sa.Column("semantic_review_id", _UUID, nullable=False),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("attempt_seq", sa.Integer(), nullable=False),
        sa.Column("checks", _JSON, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("evidence_strength", sa.Text()),
        sa.Column("claim_coverage", _JSON, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("reason_code", sa.Text(), nullable=False),
        sa.Column("candidate_defect_observed", sa.Boolean(), nullable=False),
        sa.Column("failure_class", sa.Text()),
        sa.Column("retry_target", sa.Text(), nullable=False),
        sa.Column(
            "unverified_claims", _JSON, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("verifier_version", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("candidate_id", "attempt_seq", name="uq_verification_attempts_attempt"),
        sa.ForeignKeyConstraint(
            ["execution_id", "candidate_id", "source_fingerprint"],
            [
                "candidate_executions.id",
                "candidate_executions.candidate_id",
                "candidate_executions.source_fingerprint",
            ],
            name="fk_verification_attempts_execution_binding",
        ),
        sa.ForeignKeyConstraint(
            ["semantic_review_id", "candidate_id", "execution_id", "source_fingerprint"],
            [
                "candidate_semantic_reviews.id",
                "candidate_semantic_reviews.candidate_id",
                "candidate_semantic_reviews.execution_id",
                "candidate_semantic_reviews.source_fingerprint",
            ],
            name="fk_verification_attempts_review_binding",
        ),
        sa.CheckConstraint("attempt_seq >= 1", name="ck_verification_attempts_attempt"),
        sa.CheckConstraint(
            _in("decision", _FINAL_DECISIONS), name="ck_verification_attempts_decision"
        ),
        sa.CheckConstraint(
            "evidence_strength IS NULL OR evidence_strength IN ('physical','structural')",
            name="ck_verification_attempts_strength",
        ),
        sa.CheckConstraint(
            "failure_class IS NULL OR " + _in("failure_class", _FAILURE_CLASSES),
            name="ck_verification_attempts_failure_class",
        ),
        sa.CheckConstraint(
            _in("retry_target", _RETRY_TARGETS), name="ck_verification_attempts_retry"
        ),
        sa.CheckConstraint(
            "source_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_verification_attempts_fingerprint",
        ),
        sa.CheckConstraint(
            "decision <> 'inconclusive' OR candidate_defect_observed = false",
            name="ck_verification_attempts_inconclusive_no_defect",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(checks) = 'array' AND jsonb_typeof(claim_coverage) = 'array' "
            "AND jsonb_typeof(unverified_claims) = 'array'",
            name="ck_verification_attempts_json_arrays",
        ),
        sa.CheckConstraint(
            "char_length(reason_code) BETWEEN 1 AND 120",
            name="ck_verification_attempts_reason",
        ),
        sa.CheckConstraint(
            "char_length(verifier_version) BETWEEN 1 AND 120",
            name="ck_verification_attempts_version",
        ),
    )
    op.create_index(
        "ix_verification_attempts_candidate_attempt",
        "candidate_verification_attempts",
        ["candidate_id", "attempt_seq"],
    )

    op.drop_constraint("ck_agent_runs_state", "agent_runs", type_="check")
    op.create_check_constraint("ck_agent_runs_state", "agent_runs", _in("state", _AGENT_STATES_NEW))
    op.drop_constraint("ck_result_enum", "verification_records", type_="check")
    op.create_check_constraint(
        "ck_result_enum", "verification_records", _in("result", _RESULTS_NEW)
    )

    op.execute(
        """
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert on run_plans, candidate_semantic_reviews,
                    candidate_verification_attempts to app_rw;
                revoke update, delete on run_plans, candidate_semantic_reviews,
                    candidate_verification_attempts from app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    # Refuse to discard evidence or states that the old schema cannot represent.
    op.execute(
        """
        do $$ begin
            if exists (select 1 from candidate_semantic_reviews) then
                raise exception 'cannot downgrade 0026: semantic review evidence exists';
            end if;
            if exists (select 1 from candidate_verification_attempts) then
                raise exception 'cannot downgrade 0026: strict verification evidence exists';
            end if;
            if exists (
                select 1 from verification_records where result in ('unavailable','error')
            ) then
                raise exception 'cannot downgrade 0026: new verification result values exist';
            end if;
            if exists (
                select 1 from agent_runs
                where state in ('reviewed','replan_required','ready_for_strict_verification',
                                'inconclusive','materialized')
            ) then
                raise exception 'cannot downgrade 0026: new agent state values exist';
            end if;
            if exists (
                select 1 from run_plans rp
                left join agent_runs ar
                  on ar.run_id = rp.run_id
                 and ar.plan_id = rp.id
                 and ar.plan = rp.plan
                where rp.revision <> 1
                   or rp.parent_plan_id is not null
                   or rp.replan_reason is not null
                   or ar.run_id is null
            ) then
                raise exception 'cannot downgrade 0026: non-legacy Plan revisions exist';
            end if;
            if exists (
                select 1 from run_candidates rc
                join agent_runs ar on ar.run_id = rc.run_id
                where rc.plan_id is distinct from ar.plan_id
            ) then
                raise exception 'cannot downgrade 0026: candidate uses a revised Plan';
            end if;
        end $$;
        """
    )

    op.drop_constraint("ck_result_enum", "verification_records", type_="check")
    op.create_check_constraint(
        "ck_result_enum", "verification_records", _in("result", _RESULTS_OLD)
    )
    op.drop_constraint("ck_agent_runs_state", "agent_runs", type_="check")
    op.create_check_constraint("ck_agent_runs_state", "agent_runs", _in("state", _AGENT_STATES_OLD))

    op.drop_index(
        "ix_verification_attempts_candidate_attempt",
        table_name="candidate_verification_attempts",
    )
    op.drop_table("candidate_verification_attempts")
    op.drop_index("ix_semantic_reviews_candidate_attempt", table_name="candidate_semantic_reviews")
    op.drop_table("candidate_semantic_reviews")

    op.drop_constraint("fk_run_candidates_plan_same_run", "run_candidates", type_="foreignkey")
    op.create_foreign_key(
        "fk_run_candidates_plan_same_run",
        "run_candidates",
        "agent_runs",
        ["run_id", "plan_id"],
        ["run_id", "plan_id"],
    )

    # Restore legacy rows that had a Plan document but no plan_id. Such rows
    # cannot have candidates because the legacy candidate FK requires plan_id.
    bind = op.get_bind()
    generated_ids = bind.execute(
        sa.text(
            "SELECT run_id, plan_id FROM agent_runs "
            "WHERE plan IS NOT NULL AND current_plan_id = plan_id"
        )
    ).mappings()
    for row in generated_ids:
        if row["plan_id"] == uuid.uuid5(row["run_id"], "majorana:legacy-plan"):
            bind.execute(
                sa.text("UPDATE agent_runs SET plan_id = NULL WHERE run_id = :run_id"),
                {"run_id": row["run_id"]},
            )

    op.drop_constraint("fk_agent_runs_current_plan_same_run", "agent_runs", type_="foreignkey")
    op.drop_column("agent_runs", "current_plan_id")
    op.drop_index("ix_run_plans_run_revision", table_name="run_plans")
    op.drop_table("run_plans")
