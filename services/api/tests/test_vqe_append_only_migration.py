"""Static safety checks for DB-enforced append-only VQE observations."""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0035_vqe_component_registry.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0035_append_only", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_vqe_observation_migration_enforces_append_only_and_is_reversible(monkeypatch):
    module = _module()
    statements: list[object] = []
    monkeypatch.setattr(module.op, "execute", statements.append)
    monkeypatch.setattr(module.op, "create_table", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "create_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "drop_table", lambda *args, **kwargs: None)

    module.upgrade()
    module.downgrade()

    rendered = "\n".join(str(statement) for statement in statements)
    assert module.down_revision == "0034"
    assert "BEFORE UPDATE OR DELETE ON vqe_observations" in rendered
    assert "revoke update, delete on vqe_observations from app_rw" in rendered.lower()
    assert "DROP TRIGGER" in rendered
    assert "DROP FUNCTION" in rendered
