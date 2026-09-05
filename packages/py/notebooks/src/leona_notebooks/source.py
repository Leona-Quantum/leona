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
from typing import Any

import yaml

from leona_notebooks.spec import NotebookSpec

_CELL_MARK = re.compile(r"^# %%(?P<rest>.*)$")
_HEADER_FENCE = re.compile(r"^# ---\s*$")
_KV_TOKEN = re.compile(
    r"""
    (?P<key>[A-Za-z_][A-Za-z0-9_-]*)
    =
    (?P<value>
        "(?:[^"\\]|\\.)*"          # "quoted"
      | \[[^\]]*\]                 # [json list]
      | \{[^}]*\}                  # {json object}
      | [^\s]+                     # bare
    )
    """,
    re.VERBOSE,
)
#: `check` is here because a grader the model cannot WRITE is a grader no reader ever
#: meets: `Cell.check` and the whole grading engine shipped before this format could
#: carry one, so every generated notebook had zero graded exercises while the contract,
#: the grader and its CI gate all read as if it had them. It round-trips like any other
#: attribute — `render_source` emits it — because the repair and revise turns send cells
#: back through this format, and an attribute that parses but does not render is a
#: silent deletion on the first edit of a graded cell.
_CELL_HEADER_FIELDS = frozenset(
    {"id", "role", "tags", "execute", "stub", "check", "timeout_s"}
)


class SourceParseError(ValueError):
    """The text is not a well-formed notebook source. The message names the line."""


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
        match = _KV_TOKEN.match(remaining, pos)
        if match:
            key = match.group("key")
            attrs[key] = _parse_value(match.group("value"))
            pos = match.end()
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
        header = loaded

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
                "timeout_s": attrs.pop("timeout_s", None),
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
    return NotebookSpec.model_validate(payload)


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
    """Render a spec back to `.nb.py`. `parse_source(render_source(s)) == s`."""
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
        if cell.timeout_s is not None:
            attrs.append(f"timeout_s={cell.timeout_s}")
        if attrs:
            marker += " " + " ".join(attrs)
        out.append(marker)
        body = cell.source.rstrip("\n")
        if cell.kind == "markdown":
            out.extend(("# " + line) if line else "#" for line in body.split("\n"))
        else:
            out.append(body)
    return "\n".join(out).rstrip("\n") + "\n"
