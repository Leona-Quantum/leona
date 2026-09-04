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
    """The cells a build shows, with solution code replaced by its stub for `challenge`."""
    if build != "challenge":
        return list(spec.cells)
    out: list[Cell] = []
    for cell in spec.cells:
        if cell.role in SOLUTION_ONLY_ROLES:
            if cell.kind == "code":
                out.append(
                    cell.model_copy(
                        update={
                            "source": cell.stub if cell.stub is not None else DEFAULT_STUB,
                            "stub": None,
                            "role": CellRole.EXERCISE,
                        }
                    )
                )
            # solution/answer markdown is simply not shown
            continue
        out.append(cell)
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


def to_ipynb(
    spec: NotebookSpec,
    *,
    build: Build = "full",
    report: ExecutionReport | None = None,
    include_outputs: bool = True,
) -> dict[str, Any]:
    """Compile a spec to an nbformat v4.5 notebook dict.

    With a `report`, code cells carry the outputs that run produced (stream, display,
    execute_result, error) — the stored "executed" copy a viewer renders and a reader
    downloads. Without one, or with `include_outputs=False`, outputs are empty, which is
    the only form ever committed to a repository.
    """
    results = report.by_id() if (report is not None and include_outputs) else {}
    cells: list[dict[str, Any]] = []
    execution_count = 0
    for cell in cells_for_build(spec, build):
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
