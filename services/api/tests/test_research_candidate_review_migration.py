"""Migration contract for append-only Phase 9 S9 review evidence."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _module():
    path = (
        Path(__file__).resolve().parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0053_vqe_research_candidate_reviews.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0053_research_reviews", path)
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


def test_0053_is_linear_append_only_and_does_not_claim_independence(monkeypatch):
    module = _module()
    tables: list[str] = []
    statements: list[str] = []
    constraints: list[object] = []
    dropped: list[str] = []

    monkeypatch.setattr(
        module.op,
        "create_table",
        lambda name, *args, **kwargs: (tables.append(name), constraints.extend(args)),
    )
    monkeypatch.setattr(module.op, "create_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(module.op, "execute", lambda statement: statements.append(str(statement)))
    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection())
    monkeypatch.setattr(module.op, "drop_table", dropped.append)

    module.upgrade()
    module.downgrade()

    assert module.revision == "vqe_0053"
    assert module.down_revision == "vqe_0052"
    assert tables == [
        "vqe_research_candidate_reviews",
        "vqe_research_candidate_review_requests",
    ]
    rendered = "\n".join(statements)
    assert "before update or delete" in rendered
    assert "revoke update, delete" in rendered
    checks = " ".join(
        str(item.sqltext) for item in constraints if isinstance(item, sa.CheckConstraint)
    )
    assert "workspace_human_review" in checks
    assert "independence_state = 'not_asserted'" in checks
    assert dropped == [
        "vqe_research_candidate_review_requests",
        "vqe_research_candidate_reviews",
    ]
