"""Leona Notebooks — AI-generated Jupyter lessons as a first-class Leona object.

Public surface (stable):

- `NotebookSpec`, `Cell`, `CellRole`, `NotebookKind` — the canonical model (`spec`).
- `parse_source` / `render_source` — the `.nb.py` percent-format authoring form (`source`).
- `to_ipynb` / `from_ipynb` — nbformat conversion, with outputs from a report (`ipynb`).
- `compose_notebook_program` / `report_from_sandbox_result` — execution inside the
  existing sandbox with per-cell capture (`sandbox_program`), optionally stopping at a
  cell (`run_until`).
- `spec_from_author_request` / `advisory_structure` — a version the reader wrote, from
  the editor, `.nb.py` text or an `.ipynb` (`authoring`).
- `ExecutionReport` — what a run produced, cell by cell (`execution`).
- `RevisionPlan` / `apply_revision` — chat-driven edits as explicit operations (`revision`).
- `CurriculumSpec` / `build_curriculum` — many notebooks as one course (`curriculum`).
- `leona_submit` — record a hardware request LOCALLY, in a reader's own Jupyter/VS
  Code/Colab, without submitting anything (`leona.py`; Bridge lane, ai-ops 362).
  `from leona_notebooks.leona import Leona` for the rest of the small Python API
  (`devices`/`estimate`/`ask`/`run`) — not re-exported here, since it (unlike
  `leona_submit`) needs a token and is meant to be reached for by name.

Every name below except `leona_submit` is loaded LAZILY (`__getattr__`, PEP 562)
rather than imported at the top of this file. Before the Bridge lane (ai-ops 362),
this file imported all of them eagerly, which meant `import leona_notebooks` —
and so `%load_ext leona_notebooks.jupyter` and `from leona_notebooks import
leona_submit`, both of which import this package's `__init__.py` first, same as
any submodule import does — pulled in `majorana_contracts` (via `execution.py`/
`spec.py`) and `majorana_sandbox` (via `sandbox_program.py`) whether or not the
caller wanted them. Those two packages are workspace-only (see
`pyproject.toml`'s `[tool.uv.sources]`) and cannot be installed by a reader's own
`pip install "leona-notebooks @ git+…"`, so eager loading broke exactly the
"stranger's Jupyter" story this package exists for. `leona_submit` is still a
real top-level import because it is genuinely light (see its own module's
docstring) and is the one name most callers reach for immediately.
"""

from leona_notebooks.leona import leona_submit

__all__ = [
    "Audience",
    "AuthoringInputError",
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
    "UnknownCellError",
    "advisory_structure",
    "apply_revision",
    "compose_notebook_program",
    "from_ipynb",
    "leona_submit",
    "parse_source",
    "render_source",
    "report_from_sandbox_result",
    "spec_from_author_request",
    "to_ipynb",
]

#: name -> submodule, for `__getattr__` below. Kept as a plain mapping (not
#: `importlib.import_module` sprinkled through a chain of `if`s) so adding a
#: future lazy export is one line, and so this list is the one place that has
#: to agree with `__all__` above — a name in one but not the other is a bug a
#: reader can spot by eye.
_LAZY_MODULES = {
    "AuthoringInputError": "leona_notebooks.authoring",
    "advisory_structure": "leona_notebooks.authoring",
    "spec_from_author_request": "leona_notebooks.authoring",
    "CellError": "leona_notebooks.execution",
    "CellOutput": "leona_notebooks.execution",
    "CellResult": "leona_notebooks.execution",
    "ExecutionReport": "leona_notebooks.execution",
    "from_ipynb": "leona_notebooks.ipynb",
    "to_ipynb": "leona_notebooks.ipynb",
    "RevisionOp": "leona_notebooks.revision",
    "RevisionPlan": "leona_notebooks.revision",
    "apply_revision": "leona_notebooks.revision",
    "NotebookGuardError": "leona_notebooks.sandbox_program",
    "NotebookProgram": "leona_notebooks.sandbox_program",
    "UnknownCellError": "leona_notebooks.sandbox_program",
    "compose_notebook_program": "leona_notebooks.sandbox_program",
    "report_from_sandbox_result": "leona_notebooks.sandbox_program",
    "SourceParseError": "leona_notebooks.source",
    "parse_source": "leona_notebooks.source",
    "render_source": "leona_notebooks.source",
    "Audience": "leona_notebooks.spec",
    "Cell": "leona_notebooks.spec",
    "CellRole": "leona_notebooks.spec",
    "Framework": "leona_notebooks.spec",
    "NotebookKind": "leona_notebooks.spec",
    "NotebookSpec": "leona_notebooks.spec",
    "Reference": "leona_notebooks.spec",
    "Seed": "leona_notebooks.spec",
    "Style": "leona_notebooks.spec",
}

assert set(_LAZY_MODULES) == set(__all__) - {"leona_submit"}, (
    "_LAZY_MODULES and __all__ drifted apart — add/remove the name in both"
)


def __getattr__(name: str):
    """PEP 562: `leona_notebooks.ExecutionReport` (etc.) still works exactly as
    before for a caller inside the monorepo, where `majorana-contracts`/
    `majorana-sandbox` are always installed — it now just imports the owning
    submodule on first access instead of at package-import time, which is what
    keeps `import leona_notebooks` itself cheap and dependency-light. Imports
    (not `globals()` assignment) are cached by `sys.modules` already, so this
    does not re-import on every access, but caching the attribute directly
    avoids even the dict lookup in `_LAZY_MODULES` on the second access."""
    module_name = _LAZY_MODULES.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib

    value = getattr(importlib.import_module(module_name), name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(__all__) | set(globals()))
