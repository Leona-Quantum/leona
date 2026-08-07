"""Safety contracts for the feature/dev Alembic-history reconciliation."""

from __future__ import annotations

import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "db"
    / "migrations"
    / "versions"
    / "0055_reconcile_merged_dev_history.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("migration_0055_reconciliation", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reconciliation_revision_is_linear_and_downgrade_preserves_0054_contract(monkeypatch):
    module = _module()
    assert module.revision == "0055"
    assert module.down_revision == "0054"

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
