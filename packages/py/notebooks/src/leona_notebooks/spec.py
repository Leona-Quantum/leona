"""The canonical notebook model — defined in `majorana_contracts.notebooks` (the
cross-boundary source of truth) and re-exported here with the helpers this package adds.

Cells carry a *role* so the structure a lesson promises — predict, run, observe, explain,
modify — is a checkable property of the object, not a hope about the prose.
"""

from __future__ import annotations

from majorana_contracts.notebooks import (
    NOTEBOOK_SCHEMA_VERSION as SCHEMA_VERSION,
)
from majorana_contracts.notebooks import (
    Audience,
    Cell,
    CellRole,
    NotebookKind,
    NotebookSpec,
    Reference,
    Seed,
    Style,
)
from majorana_contracts.notebooks import (
    NotebookFramework as Framework,
)

__all__ = [
    "DEFAULT_STUB",
    "LEARNING_LOOP",
    "SCHEMA_VERSION",
    "SOLUTION_ONLY_ROLES",
    "Audience",
    "Cell",
    "CellRole",
    "Framework",
    "NotebookKind",
    "NotebookSpec",
    "Reference",
    "Seed",
    "Style",
    "assign_cell_ids",
]

#: Roles that only the solution build may show.
SOLUTION_ONLY_ROLES: frozenset[CellRole] = frozenset({CellRole.SOLUTION, CellRole.ANSWER})

#: The learning loop, in order. `templates` checks a lesson section against it.
LEARNING_LOOP: tuple[CellRole, ...] = (
    CellRole.PREDICT,
    CellRole.RUN,
    CellRole.OBSERVE,
    CellRole.EXPLAIN,
    CellRole.MODIFY,
)

DEFAULT_STUB = "# Your code here\n"


def assign_cell_ids(cells: list[Cell]) -> list[Cell]:
    """Give every id-less cell the lowest free `cNN` id without touching the ones set."""
    used = {cell.id for cell in cells if cell.id}
    out: list[Cell] = []
    counter = 1
    for cell in cells:
        if cell.id:
            out.append(cell)
            continue
        while f"c{counter:02d}" in used:
            counter += 1
        new_id = f"c{counter:02d}"
        used.add(new_id)
        out.append(cell.model_copy(update={"id": new_id}))
    return out
