from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_contracts import Role, Scope
from majorana_contracts.export import DEFAULT_OUT, EXPORTED, build_document, render


def test_scope_is_frozen():
    scope = Scope(user_id=uuid4(), workspace_id=uuid4(), role=Role.MEMBER)
    with pytest.raises(ValidationError):
        scope.role = Role.OWNER


def test_scope_requires_all_fields():
    with pytest.raises(ValidationError):
        Scope(user_id=uuid4(), workspace_id=uuid4())  # type: ignore[call-arg]


def test_export_contains_all_top_level_schemas():
    schemas = build_document()["components"]["schemas"]
    for model in EXPORTED:
        assert model.__name__ in schemas, f"{model.__name__} missing from openapi export"
    # Union members are hoisted as their own schemas too
    assert "RunQueued" in schemas
    assert "Plan" in schemas


def test_export_is_deterministic():
    assert render() == render()


def test_committed_openapi_json_is_current():
    assert DEFAULT_OUT.exists(), "openapi.json missing — run the export"
    assert DEFAULT_OUT.read_text() == render(), (
        "openapi.json is stale — run: uv run python -m majorana_contracts.export"
    )
