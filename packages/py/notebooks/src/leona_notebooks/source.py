"""The `.nb.py` authoring form: jupytext's percent format with a YAML header.

Why a text form at all, when the spec is JSON: a language model writing forty cells of
Python inside JSON string literals escapes every newline and quote, and one slip costs
the whole draft. The percent format is what jupytext already round-trips, so a reader can
open a draft in JupyterLab unchanged, and a diff of two revisions reads like a diff.

    # ---
    # title: Quantum coin
    # kind: lesson
    # objectives:
    #   - Build a one-qubit circuit and sample it
    # ---

    # %% [markdown] role=objective
    # ## What you will build
    # A circuit that behaves like a fair coin.

    # %% role=run
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(1)
    qc.h(0)
    qc.measure_all()

    # %% [markdown] role=solution
    # …

The cell marker is `# %%`, optionally followed by `[markdown]` (or `[md]`) and any number of
`key=value` pairs. Values are JSON when they start with `[`, `{` or `"`; otherwise a bare
word (`true`/`false`/an integer/a string). Markdown bodies are `# `-prefixed lines, as in
jupytext. Ids are optional; a cell without one gets the lowest free `cNN`.
"""

from __future__ import annotations

import json
import re
import typing
from typing import Any

import yaml

from leona_notebooks.spec import NotebookSpec

_CELL_MARK = re.compile(r"^# %%(?P<rest>.*)$")
_HEADER_FENCE = re.compile(r"^# ---\s*$")
#: Matches the KEY and the `=` only. The VALUE is scanned by `_scan_value`, because a
#: JSON value cannot be matched by a regex without nesting support, and the way it fails
#: without one is silent. The branch this replaced was `\{[^}]*\}`, which stopped at the
#: FIRST `}` — so an answer key whose explanation says `$\ket{0}$`, which in a quantum
#: notebook is the common case and not an edge case, parsed as a truncated object and
#: raised a JSON error naming a problem the author did not have.
_KV_KEY = re.compile(r"(?P<key>[A-Za-z_][A-Za-z0-9_-]*)=")

#: The nesting delimiters `_scan_value` balances, and what closes each.
_CLOSERS = {"[": "]", "{": "}"}
#: `check` is here because a grader the model cannot WRITE is a grader no reader ever
#: meets: `Cell.check` and the whole grading engine shipped before this format could
#: carry one, so every generated notebook had zero graded exercises while the contract,
#: the grader and its CI gate all read as if it had them. It round-trips like any other
#: attribute — `render_source` emits it — because the repair and revise turns send cells
#: back through this format, and an attribute that parses but does not render is a
#: silent deletion on the first edit of a graded cell.
#: `answer` is here for the same reason `check` is, one layer over: `Cell.answer`, the
#: deterministic grader for `choice`/`numeric`/`text`, its redaction into `AnswerPrompt`
#: and the `leaks_answer_key` assertion ALL shipped before this format could carry an
#: answer key — so the model could not write a gradable question even though everything
#: that grades one was in place and tested. Same silent shape as the grader gap: nothing
#: was red, there were simply no question cells in existence to be graded.
#: `property` is a `role=check` cell's structured `CheckProperty`, one JSON object on the
#: marker line; the cell's body is only the comment `check_comment` renders from it. It is
#: here, and rendered below, for the reason `check` is: an attribute that parses but does
#: not render is deleted by the first revise or repair turn that re-renders the cell.
#: `block` is a `role=block` markdown cell's `BlockRef`, on the marker line for the same
#: reason; its body is only the prose `block_comment` renders from it.
_CELL_HEADER_FIELDS = frozenset(
    {"id", "role", "tags", "execute", "stub", "check", "answer", "timeout_s", "property", "block"}
)


def _string_list_fields(model: type) -> frozenset[str]:
    """Every field `model` types as `list[str]`, read off the model rather than named by
    hand — so a header field added to `NotebookSpec` later (today it is `objectives` and
    `prerequisites`) is covered here without anyone remembering to update this file too."""
    names: set[str] = set()
    for name, info in model.model_fields.items():
        if typing.get_origin(info.annotation) is list and typing.get_args(info.annotation) == (
            str,
        ):
            names.add(name)
    return frozenset(names)


#: Header fields a `.nb.py` document carries as a YAML list of plain strings. Computed
#: once, from the model, not hard-coded — see `_string_list_fields`.
_STRING_LIST_HEADER_FIELDS = _string_list_fields(NotebookSpec)


def _yaml_scalar_text(value: Any) -> str:
    """The plain-scalar spelling YAML would have read `value` back from, for rebuilding
    a list item's original text (`_rejoin_one_pair_mapping`). Not a general YAML dumper —
    just the handful of scalar shapes `yaml.safe_load` can hand back from a mapping key
    or value (str, int, float, bool, None)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _rejoin_one_pair_mapping(item: Any) -> Any:
    """Undo the one YAML mistake this exists for: a header list item written as plain
    text containing `: ` —

        objectives:
          - Understand the basic concepts: superposition, entanglement, and measurement.

    — which `yaml.safe_load` reads not as a string but as a ONE-PAIR MAPPING, because
    `key: value` is exactly what YAML block-mapping syntax is. The production failure of
    2026-09-24 01:07Z died here: `NotebookSpec.objectives` wants `list[str]`, pydantic
    saw `{'Understand the basic concepts': 'superposition, entanglement, and measurement.'}`
    at index 0, and the whole draft was thrown away for a header line a reader would
    read as perfectly good English.

    `item` is left alone unless it is EXACTLY a dict of one scalar key to one scalar
    value — the shape a single unquoted `text: text` line produces. A dict with more
    than one pair, or whose key or value is itself a list or mapping, is not this
    mistake (the author nested something on purpose, or wrote two list items as one),
    and is left for pydantic to refuse with its own message naming the real shape.
    """
    if not (isinstance(item, dict) and len(item) == 1):
        return item
    ((key, value),) = item.items()
    if isinstance(key, (dict, list)) or isinstance(value, (dict, list)):
        return item
    key_text = _yaml_scalar_text(key)
    if value is None:
        # `- Foo:` with nothing after the colon loads as `{"Foo": None}`; the colon is
        # part of the author's text (it usually introduces a list on the next line that
        # got flattened into one item), so it is kept rather than dropped.
        return f"{key_text}:"
    return f"{key_text}: {_yaml_scalar_text(value)}"


def _repair_misparsed_string_lists(header: dict[str, Any]) -> dict[str, Any]:
    """Apply `_rejoin_one_pair_mapping` to every item of every header field `NotebookSpec`
    types as `list[str]`. Anything the rejoin does not recognise (a genuinely nested
    mapping, a list-of-lists) is passed through unchanged, so `NotebookSpec.model_validate`
    still refuses it — this function only ever turns a false validation error into no
    error; it never hides a real one."""
    for field in _STRING_LIST_HEADER_FIELDS:
        value = header.get(field)
        if isinstance(value, list):
            header[field] = [_rejoin_one_pair_mapping(item) for item in value]
    return header


class SourceParseError(ValueError):
    """The text is not a well-formed notebook source. The message names the line."""


def _scan_value(text: str, start: int, line_no: int) -> tuple[str, int]:
    """Return the raw value token beginning at `text[start]`, and the index after it.

    Three shapes, and the reason they cannot share a regex is that two of them nest:

    * a JSON string — quoting and backslash escapes respected;
    * a JSON array or object — scanned to its BALANCED closer, with delimiters inside
      string literals ignored, so an explanation containing `$\\ket{0}$` reads as part
      of one value rather than ending it at the brace in the LaTeX;
    * anything else — a bare token, ending at the next space.

    An unterminated string or an unbalanced bracket raises rather than returning a
    truncated token: a value that silently loses its tail parses as valid JSON often
    enough to reach a reader, and `{"kind": "choice", "options": ["a"` does not.
    """
    opener = text[start]
    if opener == '"':
        pos = start + 1
        while pos < len(text):
            if text[pos] == "\\":
                pos += 2
                continue
            if text[pos] == '"':
                return text[start : pos + 1], pos + 1
            pos += 1
        raise SourceParseError(f"line {line_no}: unterminated string value")
    if opener in _CLOSERS:
        depth = 0
        in_string = False
        pos = start
        while pos < len(text):
            char = text[pos]
            if in_string:
                if char == "\\":
                    pos += 2
                    continue
                if char == '"':
                    in_string = False
            elif char == '"':
                in_string = True
            elif char in _CLOSERS:
                depth += 1
            elif char in set(_CLOSERS.values()):
                depth -= 1
                if depth == 0:
                    return text[start : pos + 1], pos + 1
            pos += 1
        raise SourceParseError(f"line {line_no}: unbalanced {opener!r} in attribute value")
    end = text.find(" ", start)
    end = len(text) if end == -1 else end
    return text[start:end], end


def _parse_value(raw: str) -> Any:
    if raw[:1] in '"[{':
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SourceParseError(f"bad JSON value {raw!r}: {exc.msg}") from exc
    lowered = raw.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    return raw


def _parse_cell_marker(rest: str, line_no: int) -> tuple[str, dict[str, Any]]:
    """`rest` is everything after `# %%`. Returns (kind, attributes)."""
    kind = "code"
    attrs: dict[str, Any] = {}
    remaining = rest.strip()
    # jupytext allows an optional free-text title before the [markdown] bracket; the
    # bracket may also come first. Either way, remove the bracket, then parse pairs.
    bracket = re.search(r"\[(markdown|md|raw)\]", remaining)
    if bracket:
        kind = "markdown" if bracket.group(1) in {"markdown", "md"} else "raw"
        remaining = (remaining[: bracket.start()] + remaining[bracket.end() :]).strip()
    pos = 0
    title_parts: list[str] = []
    while pos < len(remaining):
        if remaining[pos].isspace():
            pos += 1
            continue
        match = _KV_KEY.match(remaining, pos)
        if match and match.end() < len(remaining) and not remaining[match.end()].isspace():
            raw, pos = _scan_value(remaining, match.end(), line_no)
            attrs[match.group("key")] = _parse_value(raw)
            continue
        # Not a key=value pair: a title word (ignored, jupytext-compatible).
        end = remaining.find(" ", pos)
        end = len(remaining) if end == -1 else end
        title_parts.append(remaining[pos:end])
        pos = end
    if kind == "raw":
        raise SourceParseError(f"line {line_no}: raw cells are not supported")
    unknown = set(attrs) - _CELL_HEADER_FIELDS
    if unknown:
        raise SourceParseError(
            f"line {line_no}: unknown cell attribute(s) {sorted(unknown)}; "
            f"allowed: {sorted(_CELL_HEADER_FIELDS)}"
        )
    return kind, attrs


def _strip_markdown_prefix(lines: list[str]) -> str:
    out: list[str] = []
    for line in lines:
        if line.startswith("# "):
            out.append(line[2:])
        elif line == "#":
            out.append("")
        elif line.startswith("#"):
            out.append(line[1:])
        else:
            # A bare line inside a markdown cell is tolerated (a model forgot the
            # prefix); jupytext would treat it the same way on import.
            out.append(line)
    return "\n".join(out).strip("\n") + ("\n" if out else "")


def _trim_blank_edges(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return lines[start:end]


def parse_source(text: str, *, slug: str | None = None) -> NotebookSpec:
    """Parse a `.nb.py` document into a `NotebookSpec`.

    `slug` overrides the header's slug (the curriculum builder derives it from the path).
    Raises `SourceParseError` for structural problems and pydantic's `ValidationError`
    for a header that does not describe a notebook.
    """
    lines = text.splitlines()
    header: dict[str, Any] = {}
    index = 0
    # Skip leading blank lines.
    while index < len(lines) and not lines[index].strip():
        index += 1
    if index < len(lines) and _HEADER_FENCE.match(lines[index]):
        index += 1
        header_lines: list[str] = []
        while index < len(lines) and not _HEADER_FENCE.match(lines[index]):
            raw = lines[index]
            if _CELL_MARK.match(raw):
                raise SourceParseError("unterminated header: missing closing '# ---'")
            if raw.startswith("# "):
                header_lines.append(raw[2:])
            elif raw == "#":
                header_lines.append("")
            elif raw.startswith("#"):
                header_lines.append(raw[1:])
            else:
                raise SourceParseError(f"line {index + 1}: header lines must start with '#'")
            index += 1
        if index >= len(lines):
            raise SourceParseError("unterminated header: missing closing '# ---'")
        index += 1
        try:
            loaded = yaml.safe_load("\n".join(header_lines)) or {}
        except yaml.YAMLError as exc:
            raise SourceParseError(f"header is not valid YAML: {exc}") from exc
        if not isinstance(loaded, dict):
            raise SourceParseError("header must be a YAML mapping")
        header = _repair_misparsed_string_lists(loaded)

    raw_cells: list[dict[str, Any]] = []
    current_kind: str | None = None
    current_attrs: dict[str, Any] = {}
    current_lines: list[str] = []
    prelude: list[str] = []

    def flush() -> None:
        if current_kind is None:
            return
        body_lines = _trim_blank_edges(current_lines)
        if current_kind == "markdown":
            source = _strip_markdown_prefix(body_lines)
        else:
            source = "\n".join(body_lines) + ("\n" if body_lines else "")
        attrs = dict(current_attrs)
        tags = attrs.pop("tags", None) or []
        if isinstance(tags, str):
            tags = [tags]
        raw_cells.append(
            {
                "id": str(attrs.pop("id", "") or ""),
                "kind": current_kind,
                "role": attrs.pop("role", None),
                "source": source,
                "tags": [str(tag) for tag in tags],
                "execute": bool(attrs.pop("execute", True)),
                "stub": attrs.pop("stub", None),
                "check": attrs.pop("check", None),
                "answer": attrs.pop("answer", None),
                "timeout_s": attrs.pop("timeout_s", None),
                "property": attrs.pop("property", None),
                "block": attrs.pop("block", None),
            }
        )

    while index < len(lines):
        line = lines[index]
        marker = _CELL_MARK.match(line)
        if marker:
            flush()
            current_kind, current_attrs = _parse_cell_marker(marker.group("rest"), index + 1)
            current_lines = []
        elif current_kind is None:
            if line.strip():
                prelude.append(line)
        else:
            current_lines.append(line)
        index += 1
    flush()

    if prelude:
        raise SourceParseError(
            f"content before the first cell marker (line with {prelude[0][:40]!r}); "
            "every cell must start with '# %%'"
        )

    # Cell ids: keep explicit ones, assign the rest positionally (`cNN`, lowest free).
    used = {raw["id"] for raw in raw_cells if raw["id"]}
    counter = 1
    for raw in raw_cells:
        if raw["id"]:
            continue
        while f"c{counter:02d}" in used:
            counter += 1
        raw["id"] = f"c{counter:02d}"
        used.add(raw["id"])

    payload = dict(header)
    if slug is not None:
        payload["slug"] = slug
    payload.setdefault("slug", _slug_from_title(str(payload.get("title", ""))))
    payload["cells"] = raw_cells
    return _with_check_comments(NotebookSpec.model_validate(payload))


def _with_check_comments(spec: NotebookSpec) -> NotebookSpec:
    """Every check cell's body re-rendered from its property, and every block cell's from
    its block. Neither body is executed or read, so whatever the author wrote under the
    marker is replaced by what the cell actually says — and `render_source` then
    `parse_source` is an exact round trip."""
    if not any(cell.property is not None or cell.block is not None for cell in spec.cells):
        return spec
    from leona_notebooks.blocks import block_comment
    from leona_notebooks.checks import check_comment

    cells = []
    for cell in spec.cells:
        if cell.property is not None:
            cell = cell.model_copy(update={"source": check_comment(cell.property)})
        elif cell.block is not None:
            cell = cell.model_copy(update={"source": block_comment(cell.block)})
        cells.append(cell)
    return spec.with_cells(cells)


def _slug_from_title(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:80] or "untitled"


def _render_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_./:-]+", value):
        return value
    return json.dumps(value, ensure_ascii=False)


def render_source(spec: NotebookSpec, *, include_ids: bool = True) -> str:
    """Render a spec back to `.nb.py`. `parse_source(render_source(s)) == s`.

    An `objectives`/`prerequisites` item that contains `": "` — the shape
    `_repair_misparsed_string_lists` exists to read back in — needs no special-casing
    here: `yaml.safe_dump` already refuses to emit it as a plain (unquoted) scalar,
    because unquoted it would parse back as a mapping, which is exactly the bug. Verified
    with a probe (`test_an_objective_containing_a_colon_round_trips`) rather than assumed
    from reading the PyYAML source — a dumper that got this wrong would silently
    reintroduce the same failure on the very next revise turn, one call further downstream
    of where a reader would ever look for it.
    """
    header = spec.model_dump(mode="json", exclude={"cells"})
    header.pop("schema_version", None)
    # Drop defaults that add noise; parse_source restores them.
    for key in ("summary", "brief"):
        if not header.get(key):
            header.pop(key, None)
    for key in ("objectives", "prerequisites", "references", "seeds", "extra"):
        if not header.get(key):
            header.pop(key, None)
    if header.get("duration_minutes") is None:
        header.pop("duration_minutes", None)
    yaml_text = yaml.safe_dump(header, sort_keys=False, allow_unicode=True, width=88)
    out: list[str] = ["# ---"]
    out.extend(("# " + line) if line else "#" for line in yaml_text.rstrip("\n").split("\n"))
    out.append("# ---")
    for cell in spec.cells:
        out.append("")
        marker = "# %%"
        if cell.kind == "markdown":
            marker += " [markdown]"
        attrs: list[str] = []
        if include_ids:
            attrs.append(f"id={cell.id}")
        if cell.role is not None:
            attrs.append(f"role={cell.role.value}")
        if cell.tags:
            attrs.append(f"tags={json.dumps(cell.tags, ensure_ascii=False)}")
        if not cell.execute:
            attrs.append("execute=false")
        if cell.stub is not None:
            attrs.append(f"stub={json.dumps(cell.stub, ensure_ascii=False)}")
        if cell.check is not None:
            attrs.append(f"check={json.dumps(cell.check, ensure_ascii=False)}")
        if cell.answer is not None:
            # `exclude_defaults` would drop `kind`, which is the discriminator the
            # union is resolved by, so the round trip would fail to re-parse. Dumped
            # whole, on one line, because the marker is one line by construction.
            attrs.append(
                "answer="
                + json.dumps(
                    cell.answer.model_dump(mode="json"),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
        if cell.timeout_s is not None:
            attrs.append(f"timeout_s={cell.timeout_s}")
        if cell.property is not None:
            # Defaults left out (they re-fill on parse), `kind` always kept, one line.
            attrs.append(
                "property="
                + json.dumps(
                    cell.property.model_dump(mode="json", exclude_defaults=True),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
        if cell.block is not None:
            # Defaults left out (they re-fill on parse), `method` always kept, one line.
            attrs.append(
                "block="
                + json.dumps(
                    cell.block.model_dump(mode="json", exclude_defaults=True),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
        if attrs:
            marker += " " + " ".join(attrs)
        out.append(marker)
        body = cell.source.rstrip("\n")
        if cell.kind == "markdown":
            out.extend(("# " + line) if line else "#" for line in body.split("\n"))
        else:
            out.append(body)
    return "\n".join(out).rstrip("\n") + "\n"
