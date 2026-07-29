import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "db"
    / "migrations"
    / "versions"
    / "0040_vqe_runtime_failure_taxonomy.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("migration_0036", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_runtime_failure_taxonomy_migration_is_linear_and_reversible(monkeypatch):
    module = _module()
    operations = []
    monkeypatch.setattr(
        module.op,
        "drop_constraint",
        lambda *args, **kwargs: operations.append(("drop", args, kwargs)),
    )
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda *args, **kwargs: operations.append(("create", args, kwargs)),
    )
    monkeypatch.setattr(
        module.op,
        "execute",
        lambda statement: operations.append(("execute", str(statement), {})),
    )

    assert module.down_revision == "0039"
    module.upgrade()
    assert "output_limit_exceeded" in operations[-1][1][2]
    operations.clear()
    module.downgrade()
    assert "output-limit evidence exists" in operations[0][1]
    assert "output_limit_exceeded" not in operations[-1][1][2]
