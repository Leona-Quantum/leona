"""Catch invalid table declarations before the live Postgres migration job."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def test_agent_migration_declares_each_column_once(monkeypatch):
    path = Path(__file__).parents[3] / "db" / "migrations" / "versions" / "0010_agent_runtime.py"
    spec = importlib.util.spec_from_file_location("migration_0010", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    tables = {}

    def create_table(name, *items):
        table = sa.Table(name, sa.MetaData(), *items)
        tables[name] = table
        return table

    monkeypatch.setattr(module.op, "create_table", create_table)
    monkeypatch.setattr(module.op, "create_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "execute", lambda *_args, **_kwargs: None)
    module.upgrade()

    assert list(tables["agent_steps"].columns).count(tables["agent_steps"].c.tool_call_id) == 1
    assert "tool_call_id" in tables["run_candidates"].c
