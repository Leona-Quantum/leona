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


#: Where a reader installs from (Bridge lane, ai-ops 362). None of these packages is on
#: PyPI, so they come straight from this repository's git history. Installing
#: `leona-notebooks` ALONE does not work: its pyproject names `majorana-contracts`,
#: `majorana-sandbox` and `leona-client` as plain dependencies, PyPI has none of them,
#: and pip fails at dependency resolution before installing anything. Naming every one
#: as a direct git requirement in the SAME `pip install` lets pip satisfy each dependency
#: from its URL. All six are light (pydantic, httpx, nbformat, pyyaml, qiskit, and numpy
#: and scipy, which qiskit already pulls in).
#: `test_the_bootstrap_installs_every_workspace_dependency` derives the list from the
#: packages' own pyproject files, so a workspace dependency added later fails a test
#: instead of breaking every downloaded notebook's first cell.
NOTEBOOKS_REPOSITORY = "https://github.com/Leona-Quantum/leona"
NOTEBOOKS_INSTALL_REQUIREMENTS: tuple[str, ...] = tuple(
    f"{name} @ git+{NOTEBOOKS_REPOSITORY}#subdirectory=packages/py/{path}"
    for name, path in (
        ("leona-notebooks", "notebooks"),
        ("leona-client", "client"),
        ("majorana-contracts", "contracts"),
        ("majorana-sandbox", "sandbox"),
        # Check cells (ai-ops 382): `leona_notebooks.checks` judges with the
        # verification package, which reads OpenQASM through majorana-openqasm.
        ("majorana-verification", "verification"),
        ("majorana-openqasm", "openqasm"),
    )
)


def notebooks_install_line() -> str:
    """The one `%pip install` line the bootstrap cell and the docs both give."""
    return "%pip install -q " + " ".join(f'"{req}"' for req in NOTEBOOKS_INSTALL_REQUIREMENTS)


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
        notebooks_install_line(),
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
            source = cell.source
            if cell.block is not None:
                # A block cell leaves as prose saying what it is and who wrote it, with the
                # block itself in the cell's metadata, where `from_ipynb` reads it back.
                metadata["leona"]["block"] = cell.block.model_dump(mode="json")
                source = block_cell_export_source(cell.block)
            cells.append(
                {
                    "id": cell.id,
                    "cell_type": "markdown",
                    "metadata": metadata,
                    "source": source,
                }
            )
            continue
        if cell.property is not None:
            # A check cell leaves as a comment block stating the check in words, with the
            # property itself in the cell's metadata, where `from_ipynb` reads it back.
            # Running it in Jupyter does nothing, which is the truth: the check is judged
            # on Leona's worker, not in the reader's kernel.
            metadata["leona"]["property"] = cell.property.model_dump(mode="json", exclude_none=True)
            cells.append(
                {
                    "id": cell.id,
                    "cell_type": "code",
                    "metadata": metadata,
                    "source": check_cell_export_source(cell.property),
                    "execution_count": None,
                    "outputs": [],
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


def check_cell_export_source(prop: Any) -> str:
    """The source of an exported check cell: the check in words, as comments."""
    from leona_notebooks.checks import authorship_words, describe_expectation, describe_property

    subject = "value" if prop.kind == "value" else "circuit"
    lines = [
        f"# Leona check: {describe_property(prop)}",
        f"# Checked against: {describe_expectation(prop)}",
        f"# Tolerance: {prop.tolerance:g}. Written: {authorship_words(prop)}.",
        f"# Leona judges this on its own worker, using the {subject} that `{prop.subject}`",
        "# holds at this point. Running this cell here does nothing. The check itself is",
        "# in this cell's metadata (leona.property).",
    ]
    return "\n".join(lines) + "\n"


def block_cell_export_source(ref: Any) -> str:
    """The source of an exported block cell: the block in words, and who wrote it."""
    from leona_notebooks.blocks import block_export_source

    return block_export_source(ref)


def _block_ref(own: dict[str, Any]) -> dict[str, Any] | None:
    """The `leona.block` a block cell carried out, if it is still one a block can use. A
    `role=block` cell whose block is missing or no longer valid comes back as an ordinary
    markdown cell: its source is prose, so nothing a reader needs is lost."""
    from leona_notebooks.spec import Cell

    raw = own.get("block")
    if not isinstance(raw, dict):
        return None
    try:
        Cell.model_validate({"id": "probe", "kind": "markdown", "role": "block", "block": raw})
    except ValueError:
        return None
    return raw


def _check_property(own: dict[str, Any]) -> dict[str, Any] | None:
    """The `leona.property` a check cell carried out, if it is one a check can use. A
    `role=check` cell whose property is missing or no longer valid comes back as an
    ordinary code cell: its source is only comments, so nothing is lost by running it."""
    from leona_notebooks.spec import Cell

    raw = own.get("property")
    if not isinstance(raw, dict):
        return None
    try:
        Cell.model_validate({"id": "probe", "kind": "code", "role": "check", "property": raw})
    except ValueError:
        return None
    return raw


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
        entry: dict[str, Any] = {
            "id": cell_id,
            "kind": cell_type,
            "role": role_name,
            "source": _text(raw.get("source")),
            "tags": [tag for tag in tags if tag != role_name],
            "execute": bool(own.get("execute", True)),
        }
        if role_name == CellRole.CHECK.value:
            prop = _check_property(own) if cell_type == "code" else None
            if prop is None:
                entry["role"] = None
            else:
                entry["property"] = prop
        if role_name == CellRole.BLOCK.value:
            block = _block_ref(own) if cell_type == "markdown" else None
            if block is None:
                entry["role"] = None
            else:
                entry["block"] = block
        cells.append(entry)
    # A check's link to a block survives only if the file still has that block. A
    # hand-edited file can point one at a cell that is not a block, which the spec would
    # refuse as a whole; the link is the only part lost.
    blocks = {entry["id"] for entry in cells if "block" in entry}
    for entry in cells:
        prop = entry.get("property")
        if isinstance(prop, dict) and prop.get("block") is not None and prop["block"] not in blocks:
            entry["property"] = {**prop, "block": None}
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
    from leona_notebooks.source import _with_check_comments

    return _with_check_comments(NotebookSpec.model_validate(payload))


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
