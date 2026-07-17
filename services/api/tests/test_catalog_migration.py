"""Static safety checks for the reversible system-workspace migration."""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0013_system_workspace_kind.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0013", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Count:
    def scalar_one(self):
        return 0


class _Connection:
    def execute(self, statement):
        return _Count()


def test_system_workspace_migration_is_linear_and_reversible(monkeypatch):
    module = _module()
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
