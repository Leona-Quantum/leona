"""Static safety checks for reversible repository-schema migrations."""

import importlib.util
from pathlib import Path


def _module(revision: str, filename: str):
    path = Path(__file__).parents[3] / "db" / "migrations" / "versions" / filename
    spec = importlib.util.spec_from_file_location(f"migration_{revision}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Count:
    def __init__(self, value: int = 0):
        self._value = value

    def scalar_one(self):
        return self._value


class _Connection:
    def __init__(self, count: int = 0):
        self._count = count

    def execute(self, statement):
        return _Count(self._count)


def test_system_workspace_migration_is_linear_and_reversible(monkeypatch):
    module = _module("0013", "0013_system_workspace_kind.py")
    created = []
    dropped = []
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, condition: created.append((name, table, condition)),
    )
    monkeypatch.setattr(
        module.op,
        "drop_constraint",
        lambda name, table, type_: dropped.append((name, table, type_)),
    )
    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection())

    module.upgrade()
    module.downgrade()

    assert module.down_revision == "0012"
    assert any("system" in condition for _, _, condition in created)
    assert created[-1][2] == "kind in ('personal', 'team')"
    assert len(dropped) == 2


def _patch_ops(monkeypatch, module, *, staged_count: int):
    added = []
    checks = []
    indexes = []
    uniques = []
    dropped_constraints = []
    dropped_columns = []
    dropped_indexes = []
    monkeypatch.setattr(
        module.op,
        "add_column",
        lambda table, column: added.append((table, column.name)),
    )
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, condition: checks.append((name, table, condition)),
    )
    monkeypatch.setattr(
        module.op,
        "create_index",
        lambda name, table, columns, **kw: indexes.append((name, table, tuple(columns))),
    )
    monkeypatch.setattr(
        module.op,
        "create_unique_constraint",
        lambda name, table, columns: uniques.append((name, table, tuple(columns))),
    )
    monkeypatch.setattr(
        module.op,
        "drop_constraint",
        lambda name, table, type_: dropped_constraints.append((name, table, type_)),
    )
    monkeypatch.setattr(
        module.op,
        "drop_column",
        lambda table, column: dropped_columns.append((table, column)),
    )
    monkeypatch.setattr(
        module.op,
        "drop_index",
        lambda name, table_name=None: dropped_indexes.append((name, table_name)),
    )
    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection(staged_count))
    return {
        "added": added,
        "checks": checks,
        "indexes": indexes,
        "uniques": uniques,
        "dropped_constraints": dropped_constraints,
        "dropped_columns": dropped_columns,
        "dropped_indexes": dropped_indexes,
    }


def test_catalog_classification_migration_is_linear_and_reversible(monkeypatch):
    module = _module("0014", "0014_catalog_classification.py")
    recorded = _patch_ops(monkeypatch, module, staged_count=0)

    module.upgrade()
    module.downgrade()

    assert module.down_revision == "0013"
    added_columns = {name for _, name in recorded["added"]}
    assert added_columns == {
        "artifact_kind",
        "execution_state",
        "review_state",
        "publication_state",
        "metadata_schema_version",
        "authoritative_framework",
        "authoritative_framework_version",
        "source_language",
        "source_blob_sha256",
        "normalized_source_hash",
        "semantic_fingerprint",
        "semantic_fingerprint_algorithm",
        "toolchain_digest",
    }
    assert any(
        name == "uq_artifact_versions_normalized_source_hash" for name, _, _ in recorded["uniques"]
    )
    dropped_columns = {name for _, name in recorded["dropped_columns"]}
    assert dropped_columns == added_columns
    assert len(recorded["dropped_constraints"]) == len(recorded["checks"]) + len(
        recorded["uniques"]
    )
    assert len(recorded["dropped_indexes"]) == len(recorded["indexes"])


def test_catalog_classification_migration_downgrade_fails_closed_with_staged_data(monkeypatch):
    module = _module("0014", "0014_catalog_classification.py")
    _patch_ops(monkeypatch, module, staged_count=1)

    module.upgrade()
    try:
        module.downgrade()
    except RuntimeError as exc:
        assert "staged catalog artifacts exist" in str(exc)
    else:
        raise AssertionError("expected downgrade to fail closed while staged data exists")
