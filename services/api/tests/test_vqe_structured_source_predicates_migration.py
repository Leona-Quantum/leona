import importlib.util
from pathlib import Path

import pytest


class _Scalar:
    def __init__(self, value: int):
        self.value = value

    def scalar_one(self) -> int:
        return self.value


class _Connection:
    evidence_count = 0

    def execute(self, _statement):
        return _Scalar(self.evidence_count)


def _module():
    path = (
        Path(__file__).parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0051_vqe_structured_source_predicates.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0051_vqe_source_predicates", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0051_widens_only_private_assertion_predicate_and_is_reversible(monkeypatch):
    module = _module()
    constraints: list[str] = []
    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection())
    monkeypatch.setattr(module.op, "drop_constraint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        module.op,
        "create_check_constraint",
        lambda _name, _table, condition: constraints.append(condition),
    )

    module.upgrade()
    module.downgrade()

    assert module.revision == "vqe_0051"
    assert module.down_revision == "vqe_0050"
    assert "container_declaration_present" in constraints[0]
    assert "container_declaration_present" not in constraints[1]
    assert all("github_metadata_assertions" not in condition for condition in constraints)


def test_0051_downgrade_refuses_to_orphan_container_evidence(monkeypatch):
    module = _module()
    _Connection.evidence_count = 1
    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection())

    with pytest.raises(RuntimeError, match="container source evidence exists"):
        module.downgrade()
    _Connection.evidence_count = 0
