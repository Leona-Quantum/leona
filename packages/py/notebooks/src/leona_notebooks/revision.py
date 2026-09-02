"""Chat-driven edits as explicit operations.

The model never rewrites the whole notebook to change one cell: it returns a
`RevisionPlan` of operations on cell ids, and `apply_revision` applies them. That keeps
untouched cells byte-identical (so a version diff shows the edit and only the edit),
keeps cell ids stable (so outputs and comments can follow a cell across versions), and
makes a bad plan fail loudly at the operation that is wrong.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from leona_notebooks.spec import Audience, Cell, NotebookSpec, Style

HeaderField = Literal[
    "title", "summary", "objectives", "prerequisites", "duration_minutes", "style", "audience"
]


class RevisionOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["replace", "insert_after", "insert_before", "delete", "move", "set_field"]
    cell_id: str | None = None
    #: Percent-format text of the new cell(s) for replace / insert_*.
    cells_source: str | None = None
    #: For `move`: the id the cell lands after (`null` = to the top).
    after_id: str | None = None
    field: HeaderField | None = None
    value: Any = None

    @model_validator(mode="after")
    def _shape(self) -> RevisionOp:
        needs_cell = {"replace", "insert_after", "insert_before", "delete", "move"}
        if self.op in needs_cell and not self.cell_id:
            raise ValueError(f"{self.op} needs cell_id")
        if (
            self.op in {"replace", "insert_after", "insert_before"}
            and not (self.cells_source or "").strip()
        ):
            raise ValueError(f"{self.op} needs cells_source")
        if self.op == "set_field" and self.field is None:
            raise ValueError("set_field needs field")
        return self


class RevisionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str = Field(description="What Nala says back to the reader.")
    summary: str = Field(default="", description="One line for the version history.")
    ops: list[RevisionOp] = Field(default_factory=list)


class RevisionError(ValueError):
    """An operation named a cell that does not exist or a field it may not set."""


_EXPLICIT_ID = re.compile(r"^# %%.*?\bid=(?P<id>\"[^\"]*\"|[^\s]+)", re.M)


def _parse_cells(text: str, spec: NotebookSpec) -> list[Cell]:
    """Parse percent-format cells (no header needed). A cell that names an EXISTING id
    explicitly (`# %% id=c07`) keeps it — that is how a repair replaces the right cell;
    every other cell gets a fresh id that collides with nothing in `spec`."""
    from leona_notebooks.source import parse_source

    body = text if text.lstrip().startswith("# %%") else "# %%\n" + text
    explicit = {match.group("id").strip('"') for match in _EXPLICIT_ID.finditer(body)}
    fragment = parse_source(f"# ---\n# title: fragment\n# ---\n{body}")
    used = {cell.id for cell in spec.cells}
    out: list[Cell] = []
    counter = len(spec.cells) + 1
    for cell in fragment.cells:
        if cell.id in explicit and cell.id in used:
            out.append(cell)
            continue
        while f"c{counter:02d}" in used:
            counter += 1
        new_id = f"c{counter:02d}"
        used.add(new_id)
        out.append(cell.model_copy(update={"id": new_id}))
    return out


def apply_revision(spec: NotebookSpec, plan: RevisionPlan) -> NotebookSpec:
    """Apply every operation in order. Raises `RevisionError` on the first bad one and
    leaves `spec` untouched (specs are immutable; a new one is returned)."""
    cells = list(spec.cells)
    header: dict[str, Any] = {}

    def index_of(cell_id: str) -> int:
        for i, cell in enumerate(cells):
            if cell.id == cell_id:
                return i
        raise RevisionError(f"no cell {cell_id!r}")

    working = spec
    for op in plan.ops:
        if op.op == "delete":
            del cells[index_of(op.cell_id or "")]
        elif op.op == "replace":
            i = index_of(op.cell_id or "")
            new_cells = _parse_cells(op.cells_source or "", working.with_cells(cells))
            # The first new cell inherits the replaced id so outputs/comments follow it.
            if new_cells and not any(c.id == op.cell_id for c in new_cells):
                new_cells[0] = new_cells[0].model_copy(update={"id": op.cell_id})
            cells[i : i + 1] = new_cells
        elif op.op in {"insert_after", "insert_before"}:
            i = index_of(op.cell_id or "")
            new_cells = _parse_cells(op.cells_source or "", working.with_cells(cells))
            at = i + 1 if op.op == "insert_after" else i
            cells[at:at] = new_cells
        elif op.op == "move":
            i = index_of(op.cell_id or "")
            cell = cells.pop(i)
            if op.after_id is None:
                cells.insert(0, cell)
            else:
                cells.insert(index_of(op.after_id) + 1, cell)
        elif op.op == "set_field":
            field = op.field or ""
            value = op.value
            if field == "style":
                value = Style.model_validate(value).model_dump()
            elif field == "audience":
                value = Audience.model_validate(value).model_dump()
            header[field] = value
        working = working.with_cells(cells)

    payload = working.model_dump()
    payload.update(header)
    payload["cells"] = [cell.model_dump() for cell in cells]
    try:
        return NotebookSpec.model_validate(payload)
    except ValueError as exc:  # pydantic ValidationError is a ValueError
        raise RevisionError(str(exc)) from exc
