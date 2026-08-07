"""Safety contracts for the feature/dev Alembic-history reconciliation."""

from __future__ import annotations

import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "db"
    / "migrations"
    / "versions"
    / "0056_vqe_reconcile_merged_dev_history.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("migration_vqe_reconciliation", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reconciliation_revision_is_linear_and_downgrade_preserves_merged_contract(monkeypatch):
    module = _module()
    assert module.revision == "vqe_reconcile_0056"
    assert module.down_revision == "vqe_merge_0055"

    operations: list[object] = []
    monkeypatch.setattr(module.op, "drop_column", operations.append)
    monkeypatch.setattr(module.op, "drop_index", operations.append)
    module.downgrade()
    assert operations == []


def test_reconciliation_rejects_an_incompatible_existing_index():
    module = _module()

    class _Mappings:
        def one_or_none(self):
            return {
                "indisunique": False,
                "indexdef": "CREATE INDEX ux_artifacts_workspace_upstream_identity ON artifacts (id)",
                "predicate": None,
            }

    class _Result:
        def mappings(self):
            return _Mappings()

    class _Bind:
        def execute(self, *_args, **_kwargs):
            return _Result()

    try:
        module._ensure_index(
            _Bind(),
            index_name="ux_artifacts_workspace_upstream_identity",
            table_name="artifacts",
            columns=["workspace_id", "upstream_identity"],
            unique=True,
            required_definition_fragments=("(workspace_id, upstream_identity)",),
        )
    except RuntimeError as exc:
        assert "uniqueness does not match" in str(exc)
    else:
        raise AssertionError("expected an incompatible index to fail closed")


def test_reconciliation_expands_only_the_known_old_check_constraint(monkeypatch):
    module = _module()

    class _Mappings:
        def one_or_none(self):
            return {"definition": "CHECK (framework = ANY (ARRAY['qiskit', 'cirq', 'pennylane']))"}

    class _Result:
        def mappings(self):
            return _Mappings()

    class _Bind:
        def execute(self, *_args, **_kwargs):
            return _Result()

    dropped: list[tuple[object, ...]] = []
    created: list[tuple[object, ...]] = []
    monkeypatch.setattr(
        module.op, "drop_constraint", lambda *args, **kwargs: dropped.append((*args, kwargs))
    )
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda *args, **kwargs: created.append((*args, kwargs)),
    )

    module._ensure_expanded_check_constraint(
        _Bind(),
        table_name="run_candidates",
        constraint_name="ck_run_candidates_framework",
        column_name="framework",
        old_values=module._FRAMEWORKS_OLD,
        required_values=module._FRAMEWORKS_NEW,
    )

    assert len(dropped) == 1
    assert len(created) == 1
    assert "braket" in created[0][2]


def test_reconciliation_rejects_an_unknown_check_constraint_definition():
    module = _module()

    class _Mappings:
        def one_or_none(self):
            return {"definition": "CHECK (framework IN ('qiskit', 'unknown-provider'))"}

    class _Result:
        def mappings(self):
            return _Mappings()

    class _Bind:
        def execute(self, *_args, **_kwargs):
            return _Result()

    try:
        module._ensure_expanded_check_constraint(
            _Bind(),
            table_name="run_candidates",
            constraint_name="ck_run_candidates_framework",
            column_name="framework",
            old_values=module._FRAMEWORKS_OLD,
            required_values=module._FRAMEWORKS_NEW,
        )
    except RuntimeError as exc:
        assert "existing definition is incompatible" in str(exc)
    else:
        raise AssertionError("expected an unknown constraint shape to fail closed")


def test_reconciliation_rejects_a_superset_of_the_required_constraint_values():
    module = _module()
    values = (*module._FRAMEWORKS_NEW, "unknown-provider")
    quoted = ", ".join(f"'{value}'" for value in values)

    class _Mappings:
        def one_or_none(self):
            return {"definition": f"CHECK (framework IN ({quoted}))"}

    class _Result:
        def mappings(self):
            return _Mappings()

    class _Bind:
        def execute(self, *_args, **_kwargs):
            return _Result()

    try:
        module._ensure_expanded_check_constraint(
            _Bind(),
            table_name="run_candidates",
            constraint_name="ck_run_candidates_framework",
            column_name="framework",
            old_values=module._FRAMEWORKS_OLD,
            required_values=module._FRAMEWORKS_NEW,
        )
    except RuntimeError as exc:
        assert "existing definition is incompatible" in str(exc)
    else:
        raise AssertionError("expected an unknown constraint-value superset to fail closed")
