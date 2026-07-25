"""Static safety checks for immutable VQE identity and execution evidence."""

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


def test_vqe_migration_enforces_immutability_and_fail_closed_downgrade(monkeypatch):
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
    assert "trg_vqe_component_specs_append_only" in rendered
    assert "trg_vqe_workflow_components_append_only" in rendered
    assert "trg_vqe_experiments_append_only" in rendered
    assert "EXISTS (SELECT 1 FROM vqe_component_specs)" in rendered
    assert "EXISTS (SELECT 1 FROM vqe_observations)" in rendered
    assert "DROP TRIGGER" in rendered
    assert "DROP FUNCTION" in rendered


def test_observations_do_not_reference_a_removed_framework_column():
    module = _module()
    table_calls: list[tuple[object, ...]] = []
    original = module.op.create_table

    def capture(*args, **kwargs):
        table_calls.append(args)

    module.op.create_table = capture
    module.op.create_index = lambda *args, **kwargs: None
    module.op.execute = lambda *args, **kwargs: None
    try:
        module.upgrade()
    finally:
        module.op.create_table = original

    observation = next(args for args in table_calls if args[0] == "vqe_observations")
    rendered = "\n".join(str(item) for item in observation)
    assert "vqe_observations_framework" not in rendered
    status_constraint = next(
        item
        for item in observation
        if getattr(item, "name", None) == "ck_vqe_observations_result_status_matches"
    )
    assert "result_contract_json->>'status' = status" in str(status_constraint.sqltext)
