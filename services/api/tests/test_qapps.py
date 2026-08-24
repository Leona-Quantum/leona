import datetime as dt
from types import SimpleNamespace

import pytest
from majorana_contracts import PublicQapp

from majorana_api.auth import qapp_deps
from majorana_api.qapp_validation import (
    normalize_qapp_schema,
    validate_qapp_inputs,
    validate_qapp_ui_document,
)
from majorana_api.routes.runs import CreateRunRequest


SCHEMA = {
    "type": "object",
    "properties": {
        "qubits": {"type": "integer", "minimum": 2, "maximum": 8},
        "label": {"type": "string", "maxLength": 40},
    },
    "required": ["qubits"],
    "additionalProperties": False,
}


def test_qapp_is_an_explicit_run_mode():
    request = CreateRunRequest(task_prompt="build an app", mode="qapp")
    assert request.mode.value == "qapp"


def test_qapp_input_schema_is_bounded_and_enforced():
    assert normalize_qapp_schema(SCHEMA)["additionalProperties"] is False
    validate_qapp_inputs(SCHEMA, {"qubits": 4, "label": "GHZ"})
    with pytest.raises(ValueError, match="minimum"):
        validate_qapp_inputs(SCHEMA, {"qubits": 1})
    with pytest.raises(ValueError, match="undeclared"):
        validate_qapp_inputs(SCHEMA, {"qubits": 4, "surprise": True})


def test_qapp_schema_rejects_nested_objects_and_unbounded_arrays():
    with pytest.raises(ValueError, match="unsupported type"):
        normalize_qapp_schema({"type": "object", "properties": {"nested": {"type": "object"}}})
    with pytest.raises(ValueError, match="100-item"):
        normalize_qapp_schema(
            {
                "type": "object",
                "properties": {
                    "values": {
                        "type": "array",
                        "items": {"type": "number"},
                        "maxItems": 101,
                    }
                },
            }
        )


def test_qapp_ui_guard_accepts_an_inline_capability_only_app():
    validate_qapp_ui_document(
        "<!doctype html><html><body><button type='button'>Run</button>"
        "<script>button.onclick=async()=>{const result=await window.qapp.run({shots:100})}</script>"
        "</body></html>"
    )


@pytest.mark.parametrize(
    "document",
    [
        "<script>fetch('/secret')</script>",
        "<a href='https://example.test'>leave</a><script>void 0</script>",
        "<script>window.location='https://example.test'</script>",
        "<script>localStorage.setItem('x','y')</script>",
        "<style>body{background:url(https://example.test/x)}</style><script>void 0</script>",
    ],
)
def test_qapp_ui_guard_rejects_direct_browser_capabilities(document):
    with pytest.raises(ValueError, match="forbidden"):
        validate_qapp_ui_document(document)


def test_public_qapp_contract_cannot_expose_quantum_source_or_tenant_ids():
    assert "quantum_source" not in PublicQapp.model_fields
    assert "workspace_id" not in PublicQapp.model_fields
    resource = PublicQapp(
        slug="bell-demo-12345678",
        title="Bell explorer",
        description="Explore Bell correlations",
        framework="qiskit",
        qubits_estimate=2,
        ui_document="<html></html>",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        version=1,
        fingerprint="a" * 64,
        published_at=dt.datetime.now(dt.timezone.utc),
    )
    assert "quantum_source" not in resource.model_dump()


async def test_public_qapp_scope_arms_the_anonymous_rls_context(monkeypatch):
    captured = {}

    async def set_context(session, scope, *, enforce):
        captured.update(session=session, scope=scope, enforce=enforce)

    monkeypatch.setattr(qapp_deps, "set_rls_context", set_context)
    session = object()
    scope = await qapp_deps.get_public_qapp_scope(
        session,
        SimpleNamespace(rls_enforced=True),
    )

    assert scope.workspace_id.int == 0 and scope.user_id.int == 0
    assert captured == {"session": session, "scope": scope, "enforce": True}
