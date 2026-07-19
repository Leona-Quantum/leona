"""Static safety checks for durable Dead Letter delivery reservations."""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0017_dead_letter_delivery_claims.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0017", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dead_letter_claim_migration_is_linear_additive_and_reversible(monkeypatch):
    module = _module()
    added = []
    dropped = []
    checks = []
    indexes = []
    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: added.append((table, column.name))
    )
    monkeypatch.setattr(
        module.op, "drop_column", lambda table, column: dropped.append((table, column))
    )
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda name, table, condition: checks.append((name, table, condition)),
    )
    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_index",
        lambda name, table, columns, **kwargs: indexes.append((name, table, tuple(columns))),
    )
    monkeypatch.setattr(module.op, "drop_index", lambda *_args, **_kwargs: None)

    module.upgrade()
    module.downgrade()

    expected = {
        "dead_letter_locked_by",
        "dead_letter_lease_token",
        "dead_letter_lease_expires_at",
    }
    assert module.down_revision == "0016"
    assert {name for table, name in added if table == "jobs"} == expected
    assert {name for table, name in dropped if table == "jobs"} == expected
    assert any(name == "ck_jobs_dead_letter_lease_shape" for name, _, _ in checks)
    assert any(name == "ix_jobs_pending_dead_letter_delivery" for name, _, _ in indexes)
