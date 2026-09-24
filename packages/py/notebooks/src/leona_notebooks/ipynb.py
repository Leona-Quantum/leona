"""nbformat 4.5 in and out.

`to_ipynb` is the reader's copy: a plain notebook JupyterLab, VS Code and Colab open
unchanged, with Leona's structure kept in cell metadata (`metadata.leona`) and mirrored
into standard `tags` so a jupytext or nbgrader user sees the same roles.

Three builds of one spec:

- `full` — every cell (a lesson, a lab, a solution notebook).
- `challenge` — `role=solution` code becomes its stub, solution/answer markdown is dropped
  (used for `challenge` and `quiz` kinds).
- `solution` — same as full; named so a caller's intent is legible.
"""

from __future__ import annotations

import base64
from typing import Any, Literal

import nbformat

from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.spec import (
    DEFAULT_STUB,
    SOLUTION_ONLY_ROLES,
    Cell,
    CellRole,
    NotebookKind,
    NotebookSpec,
)

Build = Literal["full", "challenge", "solution"]

GENERATOR = "leona-notebooks"


def cells_for_build(spec: NotebookSpec, build: Build) -> list[Cell]:
    """The cells a build shows, with solution code replaced by its stub for `challenge`.

    The challenge build **is** `NotebookSpec.for_learner()`, not a second implementation
    of it. It used to be one, and the two drifted in the way two copies of a redaction
    always drift: this one knew `role=answer` cells had to go and the other did not, so a
    quiz downloaded as a file was redacted while the same quiz read in the browser was
    not. One caller-visible difference remains and is deliberate — a `solution` code cell
    with NO stub still becomes `DEFAULT_STUB` here, because a downloaded notebook needs a
    cell where the reader types, whereas the browser build can simply drop it.
    """
    if build != "challenge":
        return list(spec.cells)
    learner = {cell.id: cell for cell in spec.for_learner().cells}
    out: list[Cell] = []
    for cell in spec.cells:
        redacted = learner.get(cell.id)
        if redacted is not None:
            out.append(redacted)
        elif cell.role in SOLUTION_ONLY_ROLES and cell.kind == "code":
            # Dropped by `for_learner` for want of a stub; a file build needs the slot.
            out.append(
                cell.model_copy(
                    update={"source": DEFAULT_STUB, "stub": None, "role": CellRole.EXERCISE}
                )
            )
    return out


def _outputs_for(result: CellResult | None) -> list[dict[str, Any]]:
    if result is None:
        return []
    outputs: list[dict[str, Any]] = []
    if result.stdout:
        outputs.append({"output_type": "stream", "name": "stdout", "text": result.stdout})
    if result.stderr:
        outputs.append({"output_type": "stream", "name": "stderr", "text": result.stderr})
    for item in result.outputs:
        if item.mime == "image/png":
            if not item.data:
                outputs.append(
                    {
                        "output_type": "stream",
                        "name": "stderr",
                        "text": (
                            f"[figure dropped: {item.original_bytes or 0} bytes over the "
                            "evidence budget]\n"
                        ),
                    }
                )
                continue
            outputs.append(
                {
                    "output_type": "display_data",
                    "data": {"image/png": item.data, "text/plain": "<Figure>"},
                    "metadata": {},
                }
            )
        elif item.mime == "text/plain":
            outputs.append(
                {
                    "output_type": "execute_result",
                    "data": {"text/plain": item.data},
                    "metadata": {},
                    "execution_count": result.execution_count,
                }
            )
        else:
            outputs.append(
                {
                    "output_type": "display_data",
                    "data": {item.mime: item.data, "text/plain": ""},
                    "metadata": {},
                }
            )
    if result.error is not None:
        outputs.append(
            {
                "output_type": "error",
                "ename": result.error.ename,
                "evalue": result.error.evalue,
                "traceback": list(result.error.traceback),
            }
        )
    return outputs


def build_for_kind(kind: NotebookKind) -> Build:
    """Which build a notebook of this kind is *for a reader*.

    A challenge and a quiz exist to be attempted, so the reader's copy is the redacted
    one; everything else is meant to be read whole. This lived only inside the CLI while
    every path a real user could reach — the worker, the export route, the draft save —
    took the `build="full"` default, so the download button on a quiz handed over the
    answers. It is a function rather than a line in each caller so there is one answer.
    """
    return "challenge" if kind in {NotebookKind.CHALLENGE, NotebookKind.QUIZ} else "full"


def setup_preamble(spec: NotebookSpec) -> dict[str, Any]:
    """A first markdown cell saying what to install before anything else will run.

    Only for a notebook that is LEAVING the product. Inside the sandbox the packages are
    already there; on a reader's own machine the first code cell is `from qiskit import
    ...` and the first thing they see is `ModuleNotFoundError`, with nothing anywhere in
    the file naming what to install or which version. The requirement was recorded — in
    `metadata.leona.framework` — but no Jupyter, JupyterLab or VS Code UI shows a private
    metadata namespace to anyone.

    Markdown rather than a `%pip install` cell on purpose: a pip cell that runs on open
    would fight the reader's own environment (conda, uv, a locked project venv), and a
    cell that fails is worse than a sentence that tells them what to do.
    """
    fw = spec.framework
    requirement = f"{fw.name}{fw.version}" if fw.version else fw.name
    lines = [
        f"### Before you run this: `{requirement}`",
        "",
        f"This notebook was written against **{fw.name} `{fw.version or 'any'}`**. In the "
        "environment you want to run it in:",
        "",
        "```",
        f'pip install "{requirement}"'
        + (" matplotlib pylatexenc" if spec.style.visualizations else ""),
        "```",
        "",
        "Then pick that environment as the notebook's kernel. A different major version of "
        "the framework will fail on the first import rather than partway through, which is "
        "the failure you want.",
    ]
    return {
        "id": "leona-setup-note",
        "cell_type": "markdown",
        "metadata": {
            "leona": {"id": "leona-setup-note", "role": "note", "execute": False},
            "tags": ["note", "leona-export-preamble"],
        },
        "source": "\n".join(lines),
    }


#: The one place this URL is written down (Bridge lane, ai-ops 362): a reader's own
#: `pip install` of `leona-notebooks` straight from this repository's git history,
#: since it is not published to PyPI (`packages/py/notebooks/pyproject.toml`'s own
#: `[tool.uv.sources]` — see also that file's dependency-on-`majorana-contracts`/
#: `majorana-sandbox` comments, which is why a plain install of this alone is not
#: enough for the FULL package, only for the `%nala`/`leona_submit` surface this
#: bootstrap cell actually exercises).
NOTEBOOKS_INSTALL_SPEC = (
    "leona-notebooks @ git+https://github.com/Leona-Quantum/leona"
    "#subdirectory=packages/py/notebooks"
)


def bootstrap_cell(notebook_id: str) -> dict[str, Any]:
    """The first CELL in a downloaded notebook (Bridge lane, ai-ops 362): installs
    `leona-notebooks` from this repository's git history, loads the `%nala` magic,
    links THIS notebook (so `ask`/`fix`/`status`/`versions`/`run`/`open` need no id
    typed again), and imports `leona_submit` so a hardware cell copied out of
    Leona's sandbox does not `NameError` here instead of degrading to its local
    message. A code cell, not markdown, unlike `setup_preamble` above — the whole
    point is that a reader can just run it, not read it and type the commands by
    hand.

    Harmless run twice: `%pip install -q` is a no-op once installed, `%load_ext` on
    an already-loaded extension only prints a notice (never raises), `%nala link`
    just re-sets the same link, and a second `from leona_notebooks import
    leona_submit` is an ordinary `sys.modules` cache hit. Contains no token —
    `LEONA_API_TOKEN` is read from the shell environment `%nala`/`leona_submit`
    already require (see `jupyter.py`'s module docstring); nothing here reads,
    prints or writes one.
    """
    lines = [
        "# Run this once to work on this notebook in your own Jupyter, VS Code or",
        "# Colab. Set LEONA_API_TOKEN in your shell environment first (mint one on",
        "# leonaqt.com: Account -> Access tokens) -- never paste a token into a cell.",
        f'%pip install -q "{NOTEBOOKS_INSTALL_SPEC}"',
        "%load_ext leona_notebooks.jupyter",
        f"%nala link {notebook_id}",
        "from leona_notebooks import leona_submit  # hardware cells call this; never submits locally",
    ]
    return {
        "id": "leona-bootstrap",
        "cell_type": "code",
        "metadata": {
            "leona": {"id": "leona-bootstrap", "role": "note", "execute": False},
            "tags": ["note", "leona-export-preamble", "leona-bootstrap"],
        },
        "source": "\n".join(lines),
        "execution_count": None,
        "outputs": [],
    }


def to_ipynb(
    spec: NotebookSpec,
    *,
    build: Build = "full",
    report: ExecutionReport | None = None,
    include_outputs: bool = True,
    preamble: bool = False,
    notebook_id: str | None = None,
) -> dict[str, Any]:
    """Compile a spec to an nbformat v4.5 notebook dict.

    With a `report`, code cells carry the outputs that run produced (stream, display,
    execute_result, error) — the stored "executed" copy a viewer renders and a reader
    downloads. Without one, or with `include_outputs=False`, outputs are empty, which is
    the only form ever committed to a repository.

    `preamble=True` prepends `setup_preamble()`, and `notebook_id` (given) prepends
    `bootstrap_cell()` before THAT — so a downloaded notebook opens with the runnable
    bootstrap first and the framework-version note second. Both are for a file being
    downloaded, never for one stored or re-imported: neither is a cell of the spec, and
    either would come back as one through `from_ipynb` if it were ever saved back.
    `notebook_id` is separate from `preamble` (not folded into one flag) because the
    bootstrap needs an id to link and `setup_preamble` does not — a caller with no
    notebook id yet (there is none, mid-generation) can still ask for the framework note
    alone.
    """
    results = report.by_id() if (report is not None and include_outputs) else {}
    # A redacted cell must not carry the outputs of the cell it replaced. The stub keeps
    # the authored cell's `id`, and outputs are looked up BY id, so without this a
    # challenge build renders `# Your code here` with the finished solution's printed
    # answer sitting directly beneath it — the whole exercise, given away by a field
    # nobody thought of as content. Keyed on the source actually differing rather than on
    # the role, so any future redaction is covered the moment it changes a cell.
    #
    # And once one cell has been replaced, every cell AFTER it loses its output too, not
    # only the replaced one. Owner ruling ai-ops 260, option 1: only the notebook's own
    # author sees the answer — and a later cell's own source can be untouched and still
    # disclose it, because the run that produced its output executed in the same kernel
    # as the hidden solution: a checkpoint that asserts on the solution's variable, or a
    # print one cell down that echoes it, carries the answer-key run's result even though
    # its own text never changed. There is no way to tell, from a cell's own source, which
    # later cells read a name the solution defined — so every cell from the first
    # replacement onward is treated as contaminated. A cell BEFORE the first replacement
    # is unaffected: nothing a later solution computes can reach backward into a value
    # already printed. Found by Greptile on PR 959: the original guard cleared only the
    # replaced cell's own id.
    #
    # A cell the build DROPS counts as a replacement too. `for_learner` removes some cells
    # outright (a quiz's `answer`, a hidden grader) rather than stubbing them, and those ran
    # in the answer-key kernel just the same, so the cells after one are exactly as
    # suspect as the cells after a stub. `cells_for_build` keeps the spec's order, so a
    # gap in the authored ids before a cell means something above it was taken out.
    authored = {cell.id: cell.source for cell in spec.cells}
    authored_order = [cell.id for cell in spec.cells]
    cells: list[dict[str, Any]] = []
    execution_count = 0
    redacted_from_here = False
    next_authored = 0
    for cell in cells_for_build(spec, build):
        if cell.id in authored:
            position = authored_order.index(cell.id, next_authored)
            if position > next_authored:
                redacted_from_here = True
            next_authored = position + 1
        if cell.source != authored.get(cell.id, cell.source):
            redacted_from_here = True
        if redacted_from_here:
            results.pop(cell.id, None)
        metadata: dict[str, Any] = {
            "leona": {
                "id": cell.id,
                "role": cell.role.value if cell.role else None,
                "execute": cell.execute,
            },
            "tags": sorted({*(cell.tags), *([cell.role.value] if cell.role else [])}),
        }
        if cell.kind == "markdown":
            cells.append(
                {
                    "id": cell.id,
                    "cell_type": "markdown",
                    "metadata": metadata,
                    "source": cell.source,
                }
            )
            continue
        result = results.get(cell.id)
        count: int | None = None
        if result is not None and result.status in {"ok", "error"}:
            execution_count += 1
            count = execution_count
            result = result.model_copy(update={"execution_count": count})
        cells.append(
            {
                "id": cell.id,
                "cell_type": "code",
                "metadata": metadata,
                "source": cell.source,
                "execution_count": count,
                "outputs": _outputs_for(result),
            }
        )
    if preamble:
        cells.insert(0, setup_preamble(spec))
    if notebook_id is not None:
        # Inserted AFTER the (possible) markdown note above, at index 0, so it ends
        # up BEFORE it — the runnable bootstrap is the very first cell, the
        # framework-version note the second.
        cells.insert(0, bootstrap_cell(notebook_id))
    language = "python"
    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": language, "name": "python3"},
            "language_info": {"name": language},
            "leona": {
                "generator": GENERATOR,
                "schema_version": spec.schema_version,
                "slug": spec.slug,
                "kind": spec.kind.value,
                "build": build,
                "framework": spec.framework.model_dump(),
                "title": spec.title,
                "objectives": list(spec.objectives),
                "language": spec.style.language,
            },
        },
        "cells": cells,
    }
    nbformat.validate(nbformat.from_dict(notebook))
    return notebook


def _text(value: Any) -> str:
    if isinstance(value, list):
        return "".join(str(part) for part in value)
    return str(value or "")


def from_ipynb(notebook: dict[str, Any], *, slug: str | None = None) -> NotebookSpec:
    """Import a notebook someone else wrote. Leona metadata is honoured when present;
    otherwise roles are read from standard `tags` and the kind is `scratch`."""
    meta = notebook.get("metadata", {}) or {}
    leona_meta = meta.get("leona", {}) or {}
    cells: list[dict[str, Any]] = []
    used: set[str] = set()
    for index, raw in enumerate(notebook.get("cells", []) or [], start=1):
        cell_type = raw.get("cell_type")
        if cell_type not in {"markdown", "code"}:
            continue  # raw cells have no place in a lesson
        cell_meta = raw.get("metadata", {}) or {}
        own = cell_meta.get("leona", {}) or {}
        tags = [str(tag) for tag in (cell_meta.get("tags") or [])]
        role_name = own.get("role") or next(
            (tag for tag in tags if tag in {role.value for role in CellRole}), None
        )
        cell_id = str(own.get("id") or raw.get("id") or "").strip()
        if (
            not cell_id
            or cell_id in used
            or not cell_id.replace("-", "").replace("_", "").isalnum()
        ):
            cell_id = f"c{index:02d}"
            while cell_id in used:
                index += 1
                cell_id = f"c{index:02d}"
        used.add(cell_id)
        cells.append(
            {
                "id": cell_id,
                "kind": cell_type,
                "role": role_name,
                "source": _text(raw.get("source")),
                "tags": [tag for tag in tags if tag != role_name],
                "execute": bool(own.get("execute", True)),
            }
        )
    title = str(leona_meta.get("title") or _first_heading(cells) or "Imported notebook")
    payload: dict[str, Any] = {
        "slug": slug or leona_meta.get("slug") or _slugify(title),
        "title": title,
        "kind": leona_meta.get("kind") or NotebookKind.SCRATCH.value,
        "objectives": list(leona_meta.get("objectives") or []),
        "cells": cells,
        "seeds": [{"kind": "upload", "note": "imported from .ipynb"}],
    }
    if leona_meta.get("framework"):
        payload["framework"] = leona_meta["framework"]
    if leona_meta.get("language") in {"en", "ja"}:
        payload["style"] = {"language": leona_meta["language"]}
    return NotebookSpec.model_validate(payload)


def _first_heading(cells: list[dict[str, Any]]) -> str | None:
    for cell in cells:
        if cell["kind"] != "markdown":
            continue
        for line in cell["source"].splitlines():
            if line.startswith("#"):
                return line.lstrip("#").strip()
    return None


def _slugify(title: str) -> str:
    import re

    return (re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "imported")[:80]


def png_bytes(output_data: str) -> bytes:
    """Decode an `image/png` output's base64 payload."""
    return base64.b64decode(output_data)
