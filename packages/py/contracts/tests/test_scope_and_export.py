from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_contracts import Role, Scope
from majorana_contracts import models
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


def test_every_public_resource_model_reaches_the_export():
    """A model this package exports must end up in openapi.json. Nothing does this.

    `EXPORTED` is a hand-maintained list, and the test above iterates IT — so a
    model left off the list is not missing from anything the test looks at, and
    passes. That is how `ProjectShare` and `SharedProject` were added to
    `models.py`, imported, re-exported in `__all__`, and reached neither
    openapi.json nor `packages/ts/contracts-gen/src/schema.d.ts`: the whole
    contracts chain stayed green while the TS layer had no idea they existed.

    The assertion is deliberately about the BUILT DOCUMENT rather than about
    `EXPORTED`. A model referenced by an exported one is hoisted as a `$def`
    automatically and needs no entry; what must never happen is a public name
    that appears in neither place.
    """
    import majorana_contracts

    schemas = build_document()["components"]["schemas"]
    missing = sorted(
        name
        for name in majorana_contracts.__all__
        if isinstance(value := getattr(majorana_contracts, name), type)
        and issubclass(value, models._ResourceBase)
        and value.__name__ not in schemas
    )
    assert not missing, (
        f"exported but absent from openapi.json: {missing}. Add each to "
        "majorana_contracts.export.EXPORTED, then re-run the export and "
        "`pnpm --filter @majorana/contracts-gen gen`."
    )


def test_export_is_deterministic():
    assert render() == render()


def test_committed_openapi_json_is_current():
    assert DEFAULT_OUT.exists(), "openapi.json missing — run the export"
    assert DEFAULT_OUT.read_text() == render(), (
        "openapi.json is stale — run: uv run python -m majorana_contracts.export"
    )


def test_a_grade_attempt_is_bounded_on_both_axes():
    """Both bounds on the model, so every caller inherits them and no route has to
    remember. Tested here rather than through the API because the route's own
    unknown-cell check answers 422 for made-up ids first — a control answered by a
    different rule proves nothing about the one under test."""
    import pytest
    from majorana_contracts import GradeAttemptRequest

    assert GradeAttemptRequest(code={"a": "x" * 32_000}).code["a"]
    with pytest.raises(ValueError, match="over 32000 characters"):
        GradeAttemptRequest(code={"a": "x" * 32_001})
    with pytest.raises(ValueError):
        GradeAttemptRequest(code={f"c{i:03d}": "x" for i in range(65)})
    with pytest.raises(ValueError):
        GradeAttemptRequest(answers={f"c{i:03d}": "x" for i in range(65)})
    # And the honest case is accepted, so the bounds are not simply refusing everything.
    assert len(GradeAttemptRequest(code={f"c{i:03d}": "x" for i in range(64)}).code) == 64
