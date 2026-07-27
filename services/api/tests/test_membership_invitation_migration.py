"""Migration 0038 is additive, reversible, and backfills.

The backfill is the part worth a test. Without it, the deploy that ships the
invite notice announces every membership in the deployment to the person holding
it — including the personal workspace that signing in created for them, which
nobody invited them to. That failure is invisible in every unit test, ships
green, and is seen first by users.
"""

import importlib.util
from pathlib import Path


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0038_membership_invitation.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0038", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _record(monkeypatch, module):
    calls: dict[str, list] = {"added": [], "dropped": [], "executed": [], "indexed": []}
    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: calls["added"].append((table, column.name))
    )
    monkeypatch.setattr(
        module.op, "drop_column", lambda table, column: calls["dropped"].append((table, column))
    )
    monkeypatch.setattr(module.op, "execute", lambda sql, *a, **k: calls["executed"].append(sql))
    monkeypatch.setattr(
        module.op,
        "create_index",
        lambda name, table, cols, **k: calls["indexed"].append((name, table, tuple(cols))),
    )
    monkeypatch.setattr(module.op, "drop_index", lambda *a, **k: None)
    monkeypatch.setattr(module.op, "create_foreign_key", lambda *a, **k: None)
    monkeypatch.setattr(module.op, "drop_constraint", lambda *a, **k: None)
    return calls


def test_the_migration_is_linear_additive_and_reversible(monkeypatch):
    module = _module()
    calls = _record(monkeypatch, module)
    module.upgrade()
    module.downgrade()

    expected = {"invited_by_user_id", "acknowledged_at"}
    assert module.revision == "0038"
    assert module.down_revision == "0037"
    assert {name for table, name in calls["added"] if table == "memberships"} == expected
    assert {name for table, name in calls["dropped"] if table == "memberships"} == expected


def test_every_membership_that_already_exists_is_stamped_acknowledged(monkeypatch):
    """Mutation check: delete the UPDATE from `upgrade()` and this fails. The
    predicate has to be unconditional over the table — anything narrower leaves
    some existing membership to be announced as though it were new."""
    module = _module()
    calls = _record(monkeypatch, module)
    module.upgrade()

    backfills = [
        sql
        for sql in calls["executed"]
        if isinstance(sql, str)
        and "acknowledged_at" in sql
        and sql.strip().upper().startswith("UPDATE")
    ]
    assert len(backfills) == 1, calls["executed"]
    statement = " ".join(backfills[0].split())
    assert statement.startswith("UPDATE memberships SET acknowledged_at =")
    # Only the rows that need it, and no `workspace_id`/`role`/`kind` narrowing:
    # every membership that exists today predates the notice.
    assert statement.endswith("WHERE acknowledged_at IS NULL")


def test_the_notice_lookup_has_an_index(monkeypatch):
    """Read on every authenticated page load, for one user, and empty almost
    every time — so the index is partial and holds only outstanding rows."""
    module = _module()
    calls = _record(monkeypatch, module)
    module.upgrade()
    assert ("ix_memberships_unacknowledged", "memberships", ("user_id",)) in calls["indexed"]
