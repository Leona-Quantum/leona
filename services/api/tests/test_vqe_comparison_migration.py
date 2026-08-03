import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "db"
    / "migrations"
    / "versions"
    / "0050_vqe_controlled_comparisons.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("migration_0039", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_is_linear_append_only_and_downgrade_guarded(monkeypatch):
    module = _module()
    executed: list[str] = []
    monkeypatch.setattr(module.op, "create_table", lambda *a, **k: None)
    monkeypatch.setattr(module.op, "create_index", lambda *a, **k: None)
    monkeypatch.setattr(module.op, "execute", lambda sql: executed.append(str(sql)))

    assert module.down_revision == "0049"
    module.upgrade()
    assert any("before update or delete" in sql for sql in executed)
    assert any("revoke update, delete" in sql for sql in executed)
