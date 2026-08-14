"""Static safety checks for DB-enforced append-only run_events, audit_log and
usage_events (migration 0050).

Modelled on `test_license_append_only_migration.py`: this proves the migration
*renders* the right SQL by monkeypatching `op.execute` and inspecting what it
was called with. It cannot prove Postgres actually enforces any of it — that
is `test_append_only_triggers_live.py`, against a real server.
"""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0050_append_only_triggers.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0050", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_append_only_triggers_migration_is_linear_and_reversible(monkeypatch):
    module = _module()
    statements = []
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()
    module.downgrade()

    rendered = "\n".join(str(statement) for statement in statements)
    assert module.revision == "0050"
    assert module.down_revision == "0049"
    for table in ("run_events", "audit_log", "usage_events"):
        assert table in rendered
    assert rendered.count("BEFORE UPDATE OR DELETE") == 3
    assert "DROP TRIGGER" in rendered
    assert "DROP FUNCTION" in rendered


def test_append_only_triggers_upgrade_checks_the_bypass_before_raising(monkeypatch):
    """The trigger function must test the bypass GUC BEFORE it raises — a
    version that raised first and checked second would never let
    `delete_committed_tenants` (or anything else) through, no matter what it
    set. `scripts/check_append_only_bypass.py` then keeps that GUC out of
    everywhere but this migration and `services/api/tests/`."""
    module = _module()
    statements = []
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()

    rendered = "\n".join(str(statement) for statement in statements)
    assert module._BYPASS_GUC == "majorana.append_only_bypass"
    assert f"current_setting('{module._BYPASS_GUC}', true)" in rendered
    assert "RETURN COALESCE(NEW, OLD)" in rendered
    check_index = rendered.index("current_setting")
    raise_index = rendered.index("RAISE EXCEPTION")
    assert check_index < raise_index, "the bypass must be checked before the RAISE"


def test_append_only_triggers_upgrade_creates_one_function_and_three_triggers(monkeypatch):
    module = _module()
    statements = []
    monkeypatch.setattr(module.op, "execute", statements.append)

    module.upgrade()

    rendered = [str(statement) for statement in statements]
    assert sum("CREATE FUNCTION" in statement for statement in rendered) == 1
    assert sum("CREATE TRIGGER" in statement for statement in rendered) == 3
    # Each trigger names the table it guards, so a copy-paste that pointed two
    # triggers at the same table would still pass the counts above.
    for table in ("run_events", "audit_log", "usage_events"):
        assert any(f"ON {table}" in statement for statement in rendered), table
