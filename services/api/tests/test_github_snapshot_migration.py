"""Static safety checks for Phase 7 immutable GitHub snapshot staging."""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0048_github_snapshot_staging.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0048_github_snapshot", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Scalar:
    def scalar_one(self):
        return 0


class _Connection:
    def execute(self, _statement):
        return _Scalar()


def test_github_snapshot_migration_is_additive_append_only_and_reversible(monkeypatch):
    module = _module()
    tables: list[str] = []
    statements: list[str] = []
    dropped: list[str] = []

    monkeypatch.setattr(
        module.op,
        "create_table",
        lambda name, *args, **kwargs: tables.append(name),
    )
    monkeypatch.setattr(module.op, "create_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "execute", lambda statement: statements.append(str(statement)))
    monkeypatch.setattr(module.op, "get_bind", _Connection)
    monkeypatch.setattr(module.op, "drop_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "drop_table", dropped.append)

    module.upgrade()
    module.downgrade()

    assert module.down_revision == "0047"
    assert tables == [
        "github_repository_snapshots",
        "github_repository_snapshot_files",
        "github_snapshot_import_requests",
    ]
    assert dropped == list(reversed(tables))
    rendered = "\n".join(statements).lower()
    for table in tables:
        assert f"before update or delete on {table}" in rendered
        assert f"revoke update, delete on {table} from app_rw" in rendered
        assert f"drop trigger if exists trg_{table}_append_only on {table}" in rendered


def test_github_snapshot_migration_downgrade_fails_closed_with_evidence(monkeypatch):
    module = _module()

    class _EvidenceScalar:
        def scalar_one(self):
            return 1

    class _EvidenceConnection:
        def execute(self, _statement):
            return _EvidenceScalar()

    monkeypatch.setattr(module.op, "get_bind", _EvidenceConnection)

    try:
        module.downgrade()
    except RuntimeError as exc:
        assert "snapshot staging evidence exists" in str(exc)
    else:
        raise AssertionError("expected downgrade to refuse deletion of source evidence")
