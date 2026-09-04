"""Leona Notebooks — AI-generated Jupyter lessons as a first-class Leona object.

Public surface (stable):

- `NotebookSpec`, `Cell`, `CellRole`, `NotebookKind` — the canonical model (`spec`).
- `parse_source` / `render_source` — the `.nb.py` percent-format authoring form (`source`).
- `to_ipynb` / `from_ipynb` — nbformat conversion, with outputs from a report (`ipynb`).
- `compose_notebook_program` / `report_from_sandbox_result` — execution inside the
  existing sandbox with per-cell capture (`sandbox_program`).
- `ExecutionReport` — what a run produced, cell by cell (`execution`).
- `RevisionPlan` / `apply_revision` — chat-driven edits as explicit operations (`revision`).
- `CurriculumSpec` / `build_curriculum` — many notebooks as one course (`curriculum`).
"""

from leona_notebooks.execution import CellError, CellOutput, CellResult, ExecutionReport
from leona_notebooks.ipynb import from_ipynb, to_ipynb
from leona_notebooks.revision import RevisionOp, RevisionPlan, apply_revision
from leona_notebooks.sandbox_program import (
    NotebookGuardError,
    NotebookProgram,
    compose_notebook_program,
    report_from_sandbox_result,
)
from leona_notebooks.source import SourceParseError, parse_source, render_source
from leona_notebooks.spec import (
    Audience,
    Cell,
    CellRole,
    Framework,
    NotebookKind,
    NotebookSpec,
    Reference,
    Seed,
    Style,
)

__all__ = [
    "Audience",
    "Cell",
    "CellError",
    "CellOutput",
    "CellResult",
    "CellRole",
    "ExecutionReport",
    "Framework",
    "NotebookGuardError",
    "NotebookKind",
    "NotebookProgram",
    "NotebookSpec",
    "Reference",
    "RevisionOp",
    "RevisionPlan",
    "Seed",
    "SourceParseError",
    "Style",
    "apply_revision",
    "compose_notebook_program",
    "from_ipynb",
    "parse_source",
    "render_source",
    "report_from_sandbox_result",
    "to_ipynb",
]
