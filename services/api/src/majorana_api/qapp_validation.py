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

#: The four shapes a Qapp property may take, and the keywords each may carry. Scalars
#: and arrays of scalars are the original subset. The two object shapes were added on
#: 2026-09-16 after a generation in production spent all twelve paid attempts on the
#: same rejection: the model kept describing measurement counts as an object, because
#: that IS what a histogram is (`{"00": 512, "11": 488}`), and the subset refused it
#: every time. Refusing the most natural quantum output was the defect, not the model.
#:
#: - a **map**: `{"type": "object", "additionalProperties": {<scalar schema>}}`, at
#:   most 100 entries. Keys are strings the program chooses (bitstrings, labels).
#: - a **record array**: `{"type": "array", "items": {"type": "object", "properties":
#:   {name: <scalar schema>}}}`, at most 100 rows of at most 24 scalar fields. A table
#:   such as `[{"state": "00", "count": 512}]`.
#:
#: Nothing nests deeper: a map's values and a record's fields are scalars only, so the
#: size of any value is still bounded by the 16 KB input limit and the 100-entry caps,
#: and `validate_qapp_inputs` can check every leaf with the one scalar rule.
_SCALAR_KEYS = {
    "type",
    "title",
    "description",
    "default",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
}
_ARRAY_KEYS = _SCALAR_KEYS | {"minItems", "maxItems", "items"}
_MAP_KEYS = {"type", "title", "description", "additionalProperties", "maxProperties"}
_RECORD_KEYS = {"type", "title", "description", "properties", "required", "additionalProperties"}
#: Kept as the union for callers that only need "is this keyword ever allowed".
_PROPERTY_KEYS = _ARRAY_KEYS | _MAP_KEYS | _RECORD_KEYS
MAX_PROPERTIES = 24
MAX_ARRAY_ITEMS = 100
MAX_MAP_ENTRIES = 100
MAX_NAME_LENGTH = 80
#: One sentence naming every accepted shape, handed to the repair model verbatim so a
#: rejection teaches the fix rather than only the fault.
ACCEPTED_SHAPES = (
    "Accepted property shapes: a scalar (string, number, integer, boolean); an array of "
    "one scalar type (maxItems <= 100); a map of scalars written as type=object with "
    "additionalProperties naming a scalar type (for measurement counts such as "
    '{"00": 512, "11": 488}; maxProperties <= 100); or an array of flat records whose '
    "items are type=object with scalar-typed properties. Nothing nests deeper than that."
)

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


def _check_name(name: Any, what: str) -> str:
    if not isinstance(name, str) or not name or len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"Qapp {what} names must contain 1-{MAX_NAME_LENGTH} characters")
    return name


def _reject_unknown_keywords(name: str, definition: dict[str, Any], allowed: set[str]) -> None:
    unknown = set(definition) - allowed
    if unknown:
        raise ValueError(
            f"Qapp property {name} uses unsupported schema keywords: {', '.join(sorted(unknown))}"
        )


def _normalize_scalar(
    name: str, definition: Any, *, allowed: set[str] = _SCALAR_KEYS
) -> dict[str, Any]:
    if not isinstance(definition, dict):
        raise ValueError(f"Qapp property {name} must be a schema")
    _reject_unknown_keywords(name, definition, allowed)
    if definition.get("type") not in _SCALARS:
        raise ValueError(f"Qapp property {name} has an unsupported type")
    return definition


def _normalize_record(name: str, items: dict[str, Any]) -> dict[str, Any]:
    """The `items` of a record array: a flat object of scalar fields, nothing deeper."""
    _reject_unknown_keywords(f"{name} items", items, _RECORD_KEYS)
    properties = items.get("properties")
    if not isinstance(properties, dict) or not properties or len(properties) > MAX_PROPERTIES:
        raise ValueError(
            f"Qapp property {name} records must declare 1-{MAX_PROPERTIES} scalar properties"
        )
    required = items.get("required", [])
    if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
        raise ValueError(f"Qapp property {name} records' required must be a string list")
    if len(set(required)) != len(required) or not set(required).issubset(properties):
        raise ValueError(
            f"Qapp property {name} records' required names must be unique declared properties"
        )
    if items.get("additionalProperties") not in (None, False):
        raise ValueError(f"Qapp property {name} records may not allow additional properties")
    fields = {
        _check_name(field, "record property"): _normalize_scalar(f"{name}.{field}", definition)
        for field, definition in properties.items()
    }
    return {
        "type": "object",
        "properties": fields,
        "required": required,
        "additionalProperties": False,
    }


def _normalize_map(name: str, definition: dict[str, Any]) -> dict[str, Any]:
    """`{"type": "object", "additionalProperties": {<scalar>}}` — a histogram's shape."""
    _reject_unknown_keywords(name, definition, _MAP_KEYS)
    values = definition.get("additionalProperties")
    if not isinstance(values, dict) or values.get("type") not in _SCALARS:
        raise ValueError(
            f"Qapp property {name} must be a map of scalar values: an object schema whose "
            "additionalProperties names one scalar type"
        )
    _normalize_scalar(f"{name} values", values)
    if int(definition.get("maxProperties", MAX_MAP_ENTRIES)) > MAX_MAP_ENTRIES:
        raise ValueError(f"Qapp property {name} exceeds the {MAX_MAP_ENTRIES}-entry limit")
    return definition


def _normalize_property(name: str, definition: Any) -> dict[str, Any]:
    if not isinstance(definition, dict):
        raise ValueError(f"Qapp property {name} must be a schema")
    kind = definition.get("type")
    if kind in _SCALARS:
        return _normalize_scalar(name, definition)
    if kind == "object":
        return _normalize_map(name, definition)
    if kind == "array":
        _reject_unknown_keywords(name, definition, _ARRAY_KEYS)
        items = definition.get("items")
        if not isinstance(items, dict):
            raise ValueError(
                f"Qapp property {name} must be an array of scalar values or of flat records"
            )
        if items.get("type") == "object":
            normalized: dict[str, Any] = {**definition, "items": _normalize_record(name, items)}
        elif items.get("type") in _SCALARS:
            _normalize_scalar(f"{name} items", items)
            normalized = definition
        else:
            raise ValueError(
                f"Qapp property {name} must be an array of scalar values or of flat records"
            )
        if int(definition.get("maxItems", MAX_ARRAY_ITEMS)) > MAX_ARRAY_ITEMS:
            raise ValueError(f"Qapp property {name} exceeds the {MAX_ARRAY_ITEMS}-item limit")
        return normalized
    raise ValueError(f"Qapp property {name} has an unsupported type")


def normalize_qapp_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Accept a small UI-friendly schema subset and return its canonical form.

    The subset is the four shapes described beside `_SCALAR_KEYS` above. Every
    rejection names the property and, where a shape was almost right, what the
    accepted shape is — the message is handed to the repair model, and a message
    that only says what is wrong was measured to produce the same wrong answer
    twelve times in a row.
    """
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ValueError("Qapp schema must be an object schema")
    properties = schema.get("properties", {})
    if not isinstance(properties, dict) or len(properties) > MAX_PROPERTIES:
        raise ValueError(f"Qapp schema may define at most {MAX_PROPERTIES} properties")
    required = schema.get("required", [])
    if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
        raise ValueError("Qapp schema required must be a string list")
    if len(set(required)) != len(required) or not set(required).issubset(properties):
        raise ValueError("Qapp schema required names must be unique declared properties")

    normalized_properties = {
        _check_name(name, "property"): _normalize_property(name, definition)
        for name, definition in properties.items()
    }
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


def _validate_scalar(name: str, item: Any, definition: dict[str, Any]) -> None:
    """Every keyword here is a claim about ONE scalar, applied to one scalar."""
    kind = definition["type"]
    if not _valid_scalar(item, kind):
        raise ValueError(f"Qapp input {name} has the wrong type")
    if "enum" in definition and item not in definition["enum"]:
        raise ValueError(f"Qapp input {name} is not an allowed value")
    if kind in {"number", "integer"}:
        # A DEFAULT bound when the schema declares none, exactly as `maxLength`
        # defaults to 4000 and `maxItems` to 100. Those two had a default and
        # numerics did not, which meant a generated schema that simply omitted
        # `maximum` — nothing requires one — accepted any integer a visitor cared
        # to send, including one used by the program as a problem size. The qubit
        # preflight cannot catch that: it checks the version's frozen
        # generation-time estimate, never the value that arrives at execution.
        if item < definition.get("minimum", -MAX_NUMERIC_MAGNITUDE):
            raise ValueError(f"Qapp input {name} is below its minimum")
        if item > definition.get("maximum", MAX_NUMERIC_MAGNITUDE):
            raise ValueError(f"Qapp input {name} is above its maximum")
    if kind == "string":
        if len(item) < int(definition.get("minLength", 0)) or len(item) > int(
            definition.get("maxLength", 4000)
        ):
            raise ValueError(f"Qapp input {name} has an invalid length")


_ITEM_KEYWORDS = ("enum", "minimum", "maximum", "minLength", "maxLength")


def _validate_record(name: str, row: Any, record: dict[str, Any]) -> None:
    if not isinstance(row, dict):
        raise ValueError(f"Qapp input {name} rows must be objects")
    fields = record["properties"]
    if set(row) - set(fields):
        raise ValueError(f"Qapp input {name} rows contain undeclared properties")
    if set(record["required"]) - set(row):
        raise ValueError(f"Qapp input {name} rows are missing required properties")
    for field, item in row.items():
        _validate_scalar(f"{name}.{field}", item, fields[field])


def _validate_value(name: str, value: Any, definition: dict[str, Any]) -> None:
    kind = definition["type"]
    if kind == "array":
        if not isinstance(value, list):
            raise ValueError(f"Qapp input {name} must be an array")
        if len(value) < int(definition.get("minItems", 0)) or len(value) > int(
            definition.get("maxItems", MAX_ARRAY_ITEMS)
        ):
            raise ValueError(f"Qapp input {name} has an invalid item count")
        items = definition["items"]
        if items["type"] == "object":
            for row in value:
                _validate_record(name, row, items)
            return
        # `normalize_qapp_schema` admits the scalar keywords on the ARRAY property as
        # well as on its `items`, and generated schemas write them in either place.
        # The array-level ones win where both are present; comparing a list against
        # `enum` made an array property that declares one reject every valid input.
        merged = {**items, **{key: definition[key] for key in _ITEM_KEYWORDS if key in definition}}
        for item in value:
            _validate_scalar(name, item, merged)
        return
    if kind == "object":
        if not isinstance(value, dict):
            raise ValueError(f"Qapp input {name} must be an object")
        if len(value) > int(definition.get("maxProperties", MAX_MAP_ENTRIES)):
            raise ValueError(f"Qapp input {name} has too many entries")
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > MAX_NAME_LENGTH:
                raise ValueError(f"Qapp input {name} has an invalid key")
            _validate_scalar(f"{name}[{key}]", item, definition["additionalProperties"])
        return
    _validate_scalar(name, value, definition)


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
        _validate_value(name, value, properties[name])


# --------------------------------------------------------------------- is it usable at all

#: Copy a model leaves behind when it stops writing and starts filling space. Matched as
#: whole phrases, case-folded. Deliberately NOT the bare word "placeholder": `placeholder=`
#: is a legitimate HTML attribute and every honest Qapp with a text input has one.
_PLACEHOLDER_PHRASES = (
    "lorem ipsum",
    "your text here",
    "coming soon",
    "todo:",
    "insert description",
    "add content here",
    "placeholder text",
)

#: Either spelling of a rejection handler: a Promise settled with `.catch(...)`, or an
#: await inside `try {` / `catch (`.
#:
#: **Known gap, and why it is left open.** The two-argument `promise.then(ok, err)` form
#: also handles a rejection and matches neither pattern, so an app written that way is
#: reported as having no failure path. That is a false positive — and it costs exactly one
#: targeted `ui` repair, after which the Qapp is created regardless, because
#: `QappUsabilityWarning` is never fatal. Detecting the two-argument form means telling it
#: from the one-argument form inside a regex, which is the kind of rule that misfires on
#: honest output in ways nobody predicts. A bounded, visible cost beats an unbounded,
#: invisible one.
_ERROR_HANDLING_PATTERNS = (
    re.compile(r"\.catch\s*\(", re.IGNORECASE),
    re.compile(r"\bcatch\s*[({]", re.IGNORECASE),
)

_QAPP_RUN_CALL = re.compile(r"window\s*\.\s*qapp\s*\.\s*run\s*\(", re.IGNORECASE)


class QappUsabilityWarning(ValueError):
    """A Qapp that works but is broken for a visitor. **Never fatal.**

    A `ValueError` subclass so it travels the generation loop's existing rejection path
    and earns a targeted `ui` repair like any other deterministic rejection — but the
    handler lets it through when the attempt budget runs out, where a plain `ValueError`
    fails the whole generation.

    That asymmetry is the point, and it follows the owner's own ruling on the analogous
    question (ai-ops 180, the range smoke): *"Smoke at both ends but only warn the
    creator, publish either way."* These rules are about whether an app is usable, not
    whether it is safe, and they have never been measured against real generated output —
    no live generation has run since the provider was exhausted. A gate whose false
    positives cannot be measured must not be able to destroy a Qapp somebody waited for.
    """


def check_qapp_usability(document: str, input_schema: dict[str, Any]) -> None:
    """Reject a Qapp that is BROKEN for a visitor, not one that is merely unpolished.

    `validate_qapp_ui_document` above is a security filter and says so. Nothing checked
    whether the generated app *works*, even though the generation prompt makes five
    promises about exactly that — "a useful responsive interface, accessible labels,
    keyboard support, clear busy/error/result states, and no placeholder copy". A promise
    in a prompt is a hope; a visitor meets whatever came back.

    **Why only these three.** A rejection here sends the generation back for a `ui` repair,
    which is another paid model call (`handlers.py`), so a rule that fires on idiomatic
    output costs money on every honest Qapp — the same argument the security guard's
    docstring makes about adding patterns speculatively, and it binds harder here because
    these rules are about taste rather than safety. So each of the three is a defect a
    visitor would call a bug, not a preference:

    1. **A declared input with no control.** If `input_schema` declares `shots` and the
       document never names it, there is no way to set it: the app ships a knob its own
       interface cannot reach, and every run uses whatever default the program assumes.
    2. **No error path.** `window.qapp.run` returns a Promise. Without a rejection handler
       a failed run leaves the interface on "running" forever — the visitor cannot tell a
       slow circuit from a dead one, and the only recovery is a reload.
    3. **Placeholder copy.** "Lorem ipsum" shipped to a visitor is the model having filled
       space rather than written the app.

    **Every rule here is deliberately weak in one direction, and it is always the same
    direction.** Both checks below are substring or document-wide regex tests, so a
    property named only in a CSS comment satisfies the first and a `catch` around
    unrelated work satisfies the second. Greptile raised both on PR 837 and both readings
    are correct: a broken app can pass.

    That bias is chosen, not overlooked. Telling those cases apart means knowing which
    identifier a `catch` guards and whether a name reaches `window.qapp.run` — a JavaScript
    parse, on a document that is 6,000 characters of generated markup. The failure modes
    are not symmetric: a missed defect ships an app whose creator can see the problem and
    ask for a change, while a false positive spends a paid repair on every honest Qapp
    forever, which is the argument `validate_qapp_ui_document` above makes about adding
    patterns speculatively. So these rules catch the blatant case and let the clever one
    through on purpose.

    Accessibility and keyboard support are deliberately NOT here. Both are real promises
    and neither is checkable without parsing the document and making judgement calls this
    function has no business making — and the `ui_document` budget is 6,000 characters, so
    a rule demanding more markup fights the size limit the same generation is held to. The
    honest position is that those two are unverified, which is why this docstring says so
    rather than a comment implying they are covered.

    Raises `ValueError` with a message written to be handed straight to the repair model.
    """
    folded = document.casefold()

    for phrase in _PLACEHOLDER_PHRASES:
        if phrase in folded:
            raise QappUsabilityWarning(
                f"Qapp UI document contains placeholder copy ({phrase!r}). Write the real "
                "interface text for this app; a visitor sees this document unchanged."
            )

    properties = input_schema.get("properties") if isinstance(input_schema, dict) else None
    if isinstance(properties, dict):
        # The name must appear SOMEWHERE — as the key passed to `window.qapp.run`, as an
        # element id, or as a data attribute the collector reads. A document that never
        # spells it cannot be sending it.
        unreachable = sorted(name for name in properties if name not in document)
        if unreachable:
            listed = ", ".join(unreachable)
            raise QappUsabilityWarning(
                f"Qapp UI document declares input(s) it never lets anyone set: {listed}. "
                "Add a labelled control for each declared input, or remove it from "
                "input_schema if the app does not use it."
            )

    if _QAPP_RUN_CALL.search(document) and not any(
        pattern.search(document) for pattern in _ERROR_HANDLING_PATTERNS
    ):
        raise QappUsabilityWarning(
            "Qapp UI document calls window.qapp.run without handling a failed run. Add a "
            "catch that clears the busy state and shows the visitor an error message; "
            "without one a failed run leaves the interface running forever."
        )
