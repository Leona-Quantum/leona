"""Static safety checks for the additive job-lease migration."""

import importlib.util
from pathlib import Path


def _module():
    path = Path(__file__).parents[3] / "db" / "migrations" / "versions" / "0012_job_leases.py"
    spec = importlib.util.spec_from_file_location("migration_0012", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_job_lease_migration_is_linear_additive_and_reversible(monkeypatch):
    module = _module()
    added = []
    dropped = []
    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: added.append((table, column.name))
    )
    monkeypatch.setattr(
        module.op, "drop_column", lambda table, column: dropped.append((table, column))
    )
    monkeypatch.setattr(module.op, "execute", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "create_check_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "create_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_index", lambda *_args, **_kwargs: None)

    module.upgrade()
    module.downgrade()

    expected = {
        "lease_token",
        "lease_expires_at",
        "last_heartbeat_at",
        "max_attempts",
        "last_error_kind",
        "dead_lettered_at",
        "dead_letter_error",
        "dead_letter_attempts",
    }
    assert module.down_revision == "0011"
    assert {name for table, name in added if table == "jobs"} == expected
    assert {name for table, name in dropped if table == "jobs"} == expected
