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
        / "0044_vqe_source_evidence_staging.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0044_vqe_source_staging", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0044_is_additive_append_only_and_fail_closed(monkeypatch):
    module = _module()
    assert module.down_revision == "0043"
    assert set(module._IMMUTABLE_TABLES) == {
        "github_metadata_assertions",
        "vqe_component_implementation_candidates",
    }

    monkeypatch.setattr(module.op, "get_bind", lambda: _Connection())
    monkeypatch.setattr(module.op, "execute", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module.op, "drop_table", lambda *_args, **_kwargs: None)
    module.downgrade()

    _Connection.evidence_count = 1
    with pytest.raises(RuntimeError, match="source staging evidence exists"):
        module.downgrade()
    _Connection.evidence_count = 0


def test_0038_contains_no_public_artifact_or_component_definition_table():
    module = _module()
    assert not any(
        token in table
        for table in module._IMMUTABLE_TABLES
        for token in ("artifact_versions", "vqe_component_specs", "claims")
    )
