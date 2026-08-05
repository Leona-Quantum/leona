"""Catch invalid table declarations before the live Postgres migration job."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa

from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationResultKind,
    VerifierDecision,
)


_MIGRATIONS = Path(__file__).parents[3] / "db" / "migrations" / "versions"


def _load_migration(name: str):
    path = _MIGRATIONS / name
    spec = importlib.util.spec_from_file_location(f"migration_{name[:4]}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_agent_migration_declares_each_column_once(monkeypatch):
    module = _load_migration("0010_agent_runtime.py")

    tables = {}

    def create_table(name, *items):
        table = sa.Table(name, sa.MetaData(), *items)
        tables[name] = table
        return table

    monkeypatch.setattr(module.op, "create_table", create_table)
    monkeypatch.setattr(module.op, "create_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "execute", lambda *_args, **_kwargs: None)
    module.upgrade()

    assert list(tables["agent_steps"].columns).count(tables["agent_steps"].c.tool_call_id) == 1
    assert "tool_call_id" in tables["run_candidates"].c
    constraint_names = {
        constraint.name for table in tables.values() for constraint in table.constraints
    }
    assert {
        "fk_run_candidates_parent_same_run",
        "fk_run_candidates_plan_same_run",
        "fk_candidate_executions_candidate_fingerprint",
        "fk_candidate_verifications_execution_chain",
        "fk_candidate_conversions_candidate_fingerprint",
    } <= constraint_names


class _EmptyResult:
    def mappings(self):
        return []


class _EmptyBind:
    def execute(self, *_args, **_kwargs):
        return _EmptyResult()


def test_verification_v2_migration_declares_evidence_constraints(monkeypatch):
    module = _load_migration("0026_verification_v2_evidence.py")
    tables = {}

    def create_table(name, *items):
        table = sa.Table(name, sa.MetaData(), *items)
        tables[name] = table
        return table

    monkeypatch.setattr(module.op, "create_table", create_table)
    monkeypatch.setattr(module.op, "create_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "add_column", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "create_foreign_key", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "create_check_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "execute", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "get_bind", lambda: _EmptyBind())

    module.upgrade()

    assert set(tables) == {
        "run_plans",
        "candidate_semantic_reviews",
        "candidate_verification_attempts",
    }
    constraint_names = {
        constraint.name for table in tables.values() for constraint in table.constraints
    }
    assert {
        "uq_run_plans_run_revision",
        "fk_run_plans_parent_same_run",
        "uq_semantic_reviews_attempt",
        "fk_semantic_reviews_execution_binding",
        "uq_verification_attempts_attempt",
        "fk_verification_attempts_execution_binding",
        "fk_verification_attempts_review_binding",
        "ck_verification_attempts_inconclusive_no_defect",
    } <= constraint_names


def test_verification_v2_result_allowlist_matches_contract() -> None:
    module = _load_migration("0026_verification_v2_evidence.py")
    assert set(module._RESULTS_NEW) == {kind.value for kind in VerificationResultKind}
    assert set(module._SEMANTIC_DECISIONS) == {
        decision.value for decision in SemanticReviewDecision
    }
    assert set(module._FINAL_DECISIONS) == {decision.value for decision in VerifierDecision}
    assert set(module._FAILURE_CLASSES) == {
        failure_class.value for failure_class in VerificationFailureClass
    }
    assert set(module._RETRY_TARGETS) == {target.value for target in RetryTarget}


def test_verification_v2_downgrade_fails_closed(monkeypatch):
    module = _load_migration("0026_verification_v2_evidence.py")
    statements = []

    monkeypatch.setattr(module.op, "execute", statements.append)
    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "create_check_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_table", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "create_foreign_key", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_column", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "get_bind", lambda: _EmptyBind())

    module.downgrade()

    guard = statements[0]
    assert "semantic review evidence exists" in guard
    assert "strict verification evidence exists" in guard
    assert "new verification result values exist" in guard
    assert "new agent state values exist" in guard
    assert "non-legacy Plan revisions exist" in guard
    assert "candidate uses a revised Plan" in guard


def test_entangled_property_method_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0027_entangled_state_property_methods.py")
    created = []
    statements = []

    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, expression: created.append((name, table, expression)),
    )
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    assert "bell_state_property" in created[-1][2]
    assert "ghz_state_property" in created[-1][2]
    assert set(module._METHODS_NEW) - set(module._METHODS_OLD) == {
        "bell_state_property",
        "ghz_state_property",
    }

    module.downgrade()
    assert "cannot downgrade 0027" in statements[-1]
    assert "DELETE FROM verification_records" not in statements[-1]


def test_replan_tool_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0028_replan_tool.py")
    created = []
    statements = []

    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, expression: created.append((name, table, expression)),
    )
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    assert set(module._NAMES_NEW) - set(module._NAMES_OLD) == {"replan"}
    assert "replan" in created[-1][2]

    module.downgrade()
    assert "cannot downgrade 0028" in statements[-1]
    assert "DELETE FROM agent_steps" not in statements[-1]


def test_audited_state_machine_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0029_audited_candidate_state_machine.py")
    created = []
    statements = []

    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, expression: created.append((name, table, expression)),
    )
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    assert set(module._TOOL_NAMES_NEW) - set(module._TOOL_NAMES_OLD) == {
        "review_candidate",
        "strict_verify",
        "materialize_artifact",
    }
    assert set(module._CANDIDATE_STATUSES_NEW) - set(module._CANDIDATE_STATUSES_OLD) == {
        "reviewed",
        "inconclusive",
    }

    module.downgrade()
    assert "cannot downgrade 0029" in statements[-1]
    assert "DELETE FROM" not in statements[-1]


def test_amazon_braket_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0048_amazon_braket_framework.py")
    created = []
    statements = []

    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, expression: created.append((name, table, expression)),
    )
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    assert set(module._FRAMEWORKS_NEW) == {framework.value for framework in Framework}
    assert set(module._FRAMEWORKS_NEW) - set(module._FRAMEWORKS_OLD) == {"braket"}
    assert set(module._TOOL_NAMES_NEW) - set(module._TOOL_NAMES_OLD) == {"simulate_braket"}
    assert "braket" in created[0][2]
    assert "simulate_braket" in created[1][2]

    module.downgrade()
    assert "cannot downgrade 0048" in statements[-1]
    assert "DELETE FROM" not in statements[-1]


def test_verification_audit_event_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0030_verification_audit_events.py")
    created = []
    statements = []

    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, expression: created.append((name, table, expression)),
    )
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    assert set(module._EVENT_TYPES_NEW) - set(module._EVENT_TYPES_OLD) == {
        "verification.semantic_review",
        "verification.strict_attempt",
    }
    assert all(event_type in created[-1][2] for event_type in module._EVENT_TYPES_NEW)

    module.downgrade()
    assert "cannot downgrade 0030" in statements[-1]
    assert "DELETE FROM" not in statements[-1]


def test_private_materialization_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0031_private_materialization.py")
    created = []
    statements = []
    added = []
    dropped = []

    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: added.append((table, column))
    )
    monkeypatch.setattr(module.op, "drop_column", lambda *args: dropped.append(args))
    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, expression: created.append((name, table, expression)),
    )
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    assert added[0][0] == "agent_runs"
    assert added[0][1].name == "materialization"
    assert set(module._CANDIDATE_STATUSES_NEW) - set(module._CANDIDATE_STATUSES_OLD) == {
        "materialized"
    }
    assert "materialized" in created[-1][2]

    module.downgrade()
    assert "cannot downgrade 0031" in statements[-1]
    assert "DELETE FROM" not in statements[-1]
    assert dropped == [("agent_runs", "materialization")]


def test_conversion_execution_binding_migration_backfills_and_fails_closed(monkeypatch):
    module = _load_migration("0032_bind_conversion_execution.py")
    statements = []
    added = []
    altered = []
    foreign_keys = []
    dropped = []

    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: added.append((table, column))
    )
    monkeypatch.setattr(module.op, "execute", statements.append)
    monkeypatch.setattr(
        module.op, "alter_column", lambda table, column, **kw: altered.append((table, column, kw))
    )
    monkeypatch.setattr(
        module.op, "create_foreign_key", lambda *args, **kwargs: foreign_keys.append((args, kwargs))
    )
    monkeypatch.setattr(
        module.op, "drop_constraint", lambda *args, **kwargs: dropped.append((args, kwargs))
    )
    monkeypatch.setattr(module.op, "drop_column", lambda *args: dropped.append((args, {})))

    module.upgrade()
    assert added[0][0] == "candidate_conversions"
    assert added[0][1].name == "execution_id"
    assert "UPDATE candidate_conversions" in statements[0]
    assert altered == [("candidate_conversions", "execution_id", {"nullable": False})]
    assert foreign_keys[0][0][0] == module._FK

    module.downgrade()
    assert "cannot downgrade 0032" in statements[-1]
    assert "DELETE FROM" not in statements[-1]
    assert dropped[-1][0] == ("candidate_conversions", "execution_id")


def test_run_verification_summary_migration_is_additive_and_fails_closed(monkeypatch):
    module = _load_migration("0033_run_verification_summary.py")
    added = []
    statements = []
    dropped = []
    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: added.append((table, column))
    )
    monkeypatch.setattr(module.op, "execute", statements.append)
    monkeypatch.setattr(module.op, "drop_column", lambda *args: dropped.append(args))

    module.upgrade()
    assert added[0][0] == "runs"
    assert added[0][1].name == "verification_summary"

    module.downgrade()
    assert "cannot downgrade 0033" in statements[-1]
    assert "DELETE FROM" not in statements[-1]
    assert dropped == [("runs", "verification_summary")]
