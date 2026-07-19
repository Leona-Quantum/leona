"""Static safety checks for DB-enforced append-only license history."""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0018_license_assertions_append_only.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0018", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_license_append_only_migration_is_linear_and_reversible(monkeypatch):
    module = _module()
    statements = []
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    module.downgrade()

    rendered = "\n".join(str(statement) for statement in statements)
    assert module.down_revision == "0017"
    assert "BEFORE UPDATE OR DELETE" in rendered
    assert "license_assertions" in rendered
    assert "DROP TRIGGER" in rendered
    assert "DROP FUNCTION" in rendered
