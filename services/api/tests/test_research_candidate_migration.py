"""Migration contract for Phase 9 S8 private candidate evidence."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _module():
    path = (
        Path(__file__).resolve().parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0047_vqe_research_candidate_persistence.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0047_research_candidates", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Connection:
    def execute(self, statement):
        class _Result:
            @staticmethod
            def scalar_one():
                return 0

        return _Result()


def test_0047_is_linear_append_only_private_and_reversible(monkeypatch):
    module = _module()
    tables: list[str] = []
    statements: list[str] = []
    dropped: list[str] = []
    constraints: list[tuple] = []

    monkeypatch.setattr(
        module.op,
        "create_table",
        lambda name, *args, **kwargs: (tables.append(name), constraints.extend(args)),
    )
    monkeypatch.setattr(module.op, "create_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "execute", lambda statement: statements.append(str(statement)))
    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection())
    monkeypatch.setattr(module.op, "drop_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "drop_table", dropped.append)

    module.upgrade()
    module.downgrade()

    assert module.down_revision == "0046"
    assert tables == [
        "vqe_research_candidate_envelopes",
        "vqe_research_candidate_persist_requests",
    ]
    rendered = "\n".join(statements)
    assert "before update or delete" in rendered
    assert "revoke update, delete" in rendered
    checks = " ".join(
        str(item.sqltext) for item in constraints if isinstance(item, sa.CheckConstraint)
    )
    assert "schema_and_evidence_validated" in checks
    assert "human_review_state = 'unreviewed'" in checks
    assert "publication_eligible = false" in checks
    assert dropped == [
        "vqe_research_candidate_persist_requests",
        "vqe_research_candidate_envelopes",
    ]
