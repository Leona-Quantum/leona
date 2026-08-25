"""Bounded JSON-Schema subset used at both Qapp generation and execution."""

from __future__ import annotations

import json
import math
import re
from typing import Any

#: Ceiling on the magnitude of a numeric input when its schema declares no
#: `minimum`/`maximum`. Generous — a 27-qubit lane has no legitimate parameter
#: anywhere near it — and its job is only to stop an undeclared bound meaning
#: *no* bound. A schema that needs a wider range says so explicitly.
MAX_NUMERIC_MAGNITUDE = 1_000_000_000

_SCALARS = {"string", "number", "integer", "boolean"}
_PROPERTY_KEYS = {
    "type",
    "title",
    "description",
    "default",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "items",
}

_FORBIDDEN_UI_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"<\s*(?:a|base|embed|form|frame|iframe|link|object)\b", re.IGNORECASE),
        "navigation and embedded browsing elements",
    ),
    (
        re.compile(r"\b(?:action|formaction|href|src)\s*=", re.IGNORECASE),
        "URL-bearing attributes",
    ),
    (
        re.compile(r"(?:@import\b|\burl\s*\()", re.IGNORECASE),
        "CSS resource URLs",
    ),
    (
        re.compile(
            r"(?:\b(?:fetch|sendBeacon|postMessage|importScripts)\s*\(|"
            r"\b(?:new\s+)?(?:XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker)\s*\(|"
            # WebRTC, which no CSP directive reaches. `connect-src` does not
            # govern RTCPeerConnection in any browser, and Permissions-Policy
            # denying camera and microphone does not stop a data channel or the
            # STUN request that carries bytes to a server of the author's
            # choosing. So for this one family the pattern list is not
            # defence-in-depth behind a boundary — it is the only mention
            # anywhere.
            r"\b(?:new\s+)?RTC(?:PeerConnection|DataChannel|SessionDescription|IceCandidate)\b|"
            r"\b(?:webkitRTCPeerConnection|mozRTCPeerConnection)\b|"
            r"\bnavigator\s*\.\s*mediaDevices\b)",
            re.IGNORECASE,
        ),
        "direct browser communication APIs",
    ),
    (
        re.compile(
            r"\b(?:localStorage|sessionStorage|indexedDB|cookieStore|caches)\b",
            re.IGNORECASE,
        ),
        "browser storage APIs",
    ),
    (
        re.compile(
            r"(?:\bwindow\s*\.\s*open\b|"
            r"\b(?:window|document|globalThis)\s*\.\s*(?:location|navigation|history)\b|"
            r"\blocation\s*\.\s*(?:assign|replace|reload|href|pathname|search|hash|"
            r"origin|host|hostname|port|protocol)\b|\blocation\s*(?:\[|=)|"
            r"\bnavigation\s*\.\s*(?:navigate|reload|back|forward|traverseTo)\b|"
            r"\bhistory\s*\.\s*(?:pushState|replaceState|go|back|forward)\b|"
            r"\b(?:parent|top)\s*(?:\.|\[)|\bdocument\s*\.\s*(?:open|write|writeln)\b)",
            re.IGNORECASE,
        ),
        "navigation or parent-document APIs",
    ),
    (
        re.compile(r"http-equiv\s*=\s*['\"]?\s*refresh\b", re.IGNORECASE),
        "refresh navigation",
    ),
    # Everything above matches markup or an API by NAME, which is exactly what a
    # document that builds the same call out of pieces does not contain. These
    # three close the assembly routes that were measured to get past the rules
    # above — see this module's docstring for the measurement and for why the
    # list stops where it does.
    (
        re.compile(r"\b(?:eval|atob|unescape)\s*\(|\bnew\s+Function\s*\(", re.IGNORECASE),
        "dynamic code and encoded-string evaluation",
    ),
    (
        re.compile(
            r"\bcreateElement\s*\(\s*['\"`]\s*"
            r"(?:a|base|embed|form|frame|iframe|link|meta|object|script)\s*['\"`]",
            re.IGNORECASE,
        ),
        "scripted construction of navigation and embedding elements",
    ),
    (
        re.compile(r"\bhttpEquiv\b", re.IGNORECASE),
        "refresh navigation",
    ),
)


def validate_qapp_ui_document(document: str) -> None:
    """Reject direct network, storage, embedding, and navigation capabilities.

    The iframe sandbox and injected CSP remain the browser security boundary.
    This guard makes the model contract executable too, so straightforward
    prompt-injected output is rejected before it is stored or shown to anyone.

    **It is a filter on straightforward output and nothing more, and the sharp
    edge is worth stating rather than leaving to be rediscovered.** These are
    regular expressions over JavaScript source: they match an API by the name it
    is spelled with, and a document that assembles the same call out of pieces
    contains no such name. Fifteen navigation payloads were run against this list
    while it was being written; before the last three patterns above were added,
    nine of them passed, and after, three still do — `window["loc"+"ation"]`,
    a destructured `assign`, and `globalThis["location"]`. No addition
    to this list closes that class, because string concatenation is not a
    pattern. Adding rules speculatively is not free either: a rejection here
    sends the generation back for a `ui` repair (`handlers.py`), which is another
    paid model call, so a rule that fires on idiomatic output costs money on
    every honest Qapp to inconvenience a hostile one for an afternoon.

    So the division of labour is deliberate, and each layer should be relied on
    for only its own half:

    - **Egress** — fetch, forms, subresources, nested frames, storage — is
      closed by `QAPP_FRAME_CSP` and the `sandbox` attribute, which are
      properties of the browser and not defeatable by how the document is
      written. That is the boundary.
    - **Self-navigation** is the one channel no policy can close, and nothing
      closes it. A runtime tripwire in the host was built for it and withdrawn
      before merge — the host cannot attribute a frame `load` event to a
      document, so "has not announced itself yet" and "never will" are the same
      observation, and every rule that caught the hostile case also tore down a
      legitimate Qapp. ADR-0031 records the full argument. The three payloads
      below are therefore the accepted residual risk, not a gap something else
      covers.
    - **This function** rejects the obvious attempt early, so it never reaches
      storage or a reader, and so the model contract has teeth. It is the only
      thing standing in front of that channel, which is the reason to keep it
      honest about what it does not catch.
    """
    if not isinstance(document, str) or not document.strip():
        raise ValueError("Qapp UI document must not be empty")
    if "<script" not in document.casefold():
        raise ValueError("Qapp UI document must contain its inline application script")
    for pattern, capability in _FORBIDDEN_UI_PATTERNS:
        if pattern.search(document):
            raise ValueError(f"Qapp UI document uses forbidden {capability}")


def normalize_qapp_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Accept a small UI-friendly schema subset and return its canonical form."""
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ValueError("Qapp schema must be an object schema")
    properties = schema.get("properties", {})
    if not isinstance(properties, dict) or len(properties) > 24:
        raise ValueError("Qapp schema may define at most 24 properties")
    required = schema.get("required", [])
    if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
        raise ValueError("Qapp schema required must be a string list")
    if len(set(required)) != len(required) or not set(required).issubset(properties):
        raise ValueError("Qapp schema required names must be unique declared properties")

    normalized_properties: dict[str, Any] = {}
    for name, definition in properties.items():
        if not isinstance(name, str) or not name or len(name) > 80:
            raise ValueError("Qapp property names must contain 1-80 characters")
        if not isinstance(definition, dict):
            raise ValueError(f"Qapp property {name} must be a schema")
        unknown = set(definition) - _PROPERTY_KEYS
        if unknown:
            raise ValueError(
                f"Qapp property {name} uses unsupported schema keywords: "
                f"{', '.join(sorted(unknown))}"
            )
        kind = definition.get("type")
        if kind not in _SCALARS | {"array"}:
            raise ValueError(f"Qapp property {name} has an unsupported type")
        if kind == "array":
            items = definition.get("items")
            if not isinstance(items, dict) or items.get("type") not in _SCALARS:
                raise ValueError(f"Qapp property {name} must be an array of scalar values")
            if int(definition.get("maxItems", 100)) > 100:
                raise ValueError(f"Qapp property {name} exceeds the 100-item limit")
        normalized_properties[name] = definition
    return {
        "type": "object",
        "properties": normalized_properties,
        "required": required,
        "additionalProperties": False,
    }


def _valid_scalar(value: Any, kind: str) -> bool:
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(float(value))
        )
    return isinstance(value, str)


def validate_qapp_inputs(schema: dict[str, Any], inputs: dict[str, Any]) -> None:
    schema = normalize_qapp_schema(schema)
    if len(json.dumps(inputs, ensure_ascii=False, allow_nan=False).encode()) > 16_384:
        raise ValueError("Qapp inputs exceed 16 KB")
    properties = schema["properties"]
    unknown = set(inputs) - set(properties)
    if unknown:
        raise ValueError("Qapp inputs contain undeclared properties")
    missing = set(schema["required"]) - set(inputs)
    if missing:
        raise ValueError("Qapp inputs are missing required properties")
    for name, value in inputs.items():
        definition = properties[name]
        kind = definition["type"]
        values = value if kind == "array" and isinstance(value, list) else [value]
        scalar_kind = definition.get("items", {}).get("type") if kind == "array" else kind
        if kind == "array":
            if not isinstance(value, list):
                raise ValueError(f"Qapp input {name} must be an array")
            if len(value) < int(definition.get("minItems", 0)) or len(value) > int(
                definition.get("maxItems", 100)
            ):
                raise ValueError(f"Qapp input {name} has an invalid item count")
        if any(not _valid_scalar(item, scalar_kind) for item in values):
            raise ValueError(f"Qapp input {name} has the wrong type")
        # Every keyword below is a claim about a SCALAR, so it is applied to
        # `values` — the items for an array, the value itself otherwise — and
        # never to the array object. Comparing a list against `enum` made an
        # array property that declares one reject every valid input with a 422,
        # and gating the bounds on `kind` left array items with no bound check at
        # all. `normalize_qapp_schema` admits these keywords on array properties,
        # so both were reachable from ordinary generated output.
        for item in values:
            if "enum" in definition and item not in definition["enum"]:
                raise ValueError(f"Qapp input {name} is not an allowed value")
            if scalar_kind in {"number", "integer"}:
                # A DEFAULT bound when the schema declares none, exactly as
                # `maxLength` defaults to 4000 and `maxItems` to 100 above. Those
                # two had a default and numerics did not, which meant a generated
                # schema that simply omitted `maximum` — nothing requires one —
                # accepted any integer a visitor cared to send, including one used
                # by the program as a problem size. The qubit preflight cannot
                # catch that: it checks the version's frozen generation-time
                # estimate, never the value that arrives at execution.
                if item < definition.get("minimum", -MAX_NUMERIC_MAGNITUDE):
                    raise ValueError(f"Qapp input {name} is below its minimum")
                if item > definition.get("maximum", MAX_NUMERIC_MAGNITUDE):
                    raise ValueError(f"Qapp input {name} is above its maximum")
            if scalar_kind == "string":
                if len(item) < int(definition.get("minLength", 0)) or len(item) > int(
                    definition.get("maxLength", 4000)
                ):
                    raise ValueError(f"Qapp input {name} has an invalid length")
