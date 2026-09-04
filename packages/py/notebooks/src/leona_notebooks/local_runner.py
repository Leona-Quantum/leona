"""Run a notebook outside the product: through a real Jupyter kernel (`nbclient`, the
reader's experience — the validator) or through the sandbox program in a local
subprocess (`LocalSubprocessSandbox`, the product's execution path without Vercel).

Both return the same `ExecutionReport`, so a notebook that passes here has passed the
same shape of check the worker applies.
"""

from __future__ import annotations

import asyncio
import base64
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from leona_notebooks.execution import CellError, CellOutput, CellResult, ExecutionReport
from leona_notebooks.ipynb import Build, to_ipynb
from leona_notebooks.sandbox_program import (
    build_execution_spec,
    compose_notebook_program,
    report_from_sandbox_result,
)
from leona_notebooks.spec import NotebookSpec


def _versions() -> dict[str, str]:
    import sys

    env = {"python": sys.version.split()[0]}
    for name in ("qiskit", "numpy", "matplotlib"):
        try:
            module = __import__(name)
            env[name] = str(getattr(module, "__version__", "?"))
        except Exception:  # noqa: BLE001 - a missing library is an absence, not an error
            pass
    return env


def _outputs_from_nb(
    outputs: list[dict[str, Any]],
) -> tuple[str, str, list[CellOutput], CellError | None]:
    stdout, stderr = [], []
    items: list[CellOutput] = []
    error: CellError | None = None
    for output in outputs:
        kind = output.get("output_type")
        if kind == "stream":
            (stdout if output.get("name") == "stdout" else stderr).append(
                "".join(output.get("text", ""))
            )
        elif kind in {"display_data", "execute_result"}:
            data = output.get("data", {}) or {}
            if "image/png" in data:
                png = data["image/png"]
                png = "".join(png) if isinstance(png, list) else str(png)
                items.append(CellOutput(mime="image/png", data=png.replace("\n", "")))
            elif "text/html" in data:
                items.append(CellOutput(mime="text/html", data="".join(data["text/html"])))
            elif "text/latex" in data:
                items.append(CellOutput(mime="text/latex", data="".join(data["text/latex"])))
            elif "text/plain" in data:
                items.append(CellOutput(mime="text/plain", data="".join(data["text/plain"])))
        elif kind == "error":
            error = CellError(
                ename=str(output.get("ename", "Error")),
                evalue=str(output.get("evalue", "")),
                traceback=[str(line) for line in output.get("traceback", [])],
            )
    return "".join(stdout), "".join(stderr), items, error


def execute_with_nbclient(
    spec: NotebookSpec,
    *,
    build: Build = "full",
    timeout_s: int = 120,
    kernel_name: str = "python3",
    cwd: str | Path | None = None,
    allow_errors: bool = True,
) -> tuple[dict[str, Any], ExecutionReport]:
    """Execute through a Jupyter kernel. Returns the executed notebook dict (with
    outputs) and the report. Requires the `execute` extra (`nbclient`, `ipykernel`).

    `allow_errors=True` runs every cell so the report names each failing cell, matching
    what the sandbox program records; the report is still `ok=False` on any error in a
    cell not tagged `raises-exception`.
    """
    import nbformat
    from nbclient import execute as run_through_kernel

    notebook = nbformat.from_dict(to_ipynb(spec, build=build, include_outputs=False))
    started = time.perf_counter()
    run_through_kernel(
        notebook,
        cwd=str(cwd or os.getcwd()),
        timeout=timeout_s,
        kernel_name=kernel_name,
        allow_errors=allow_errors,
    )
    executed = nbformat.to_dict(notebook) if hasattr(nbformat, "to_dict") else dict(notebook)
    duration_ms = int((time.perf_counter() - started) * 1000)

    by_id = {cell.id: cell for cell in spec.cells}
    results: list[CellResult] = []
    for raw in executed["cells"]:
        if raw.get("cell_type") != "code":
            continue
        cell_id = (raw.get("metadata", {}).get("leona", {}) or {}).get("id") or raw.get("id")
        spec_cell = by_id.get(cell_id)
        stdout, stderr, items, error = _outputs_from_nb(raw.get("outputs", []) or [])
        if (
            spec_cell is not None
            and not spec_cell.runs_in_sandbox
            and raw.get("execution_count") is None
        ):
            results.append(CellResult(id=cell_id, status="skipped", note="execute=false"))
            continue
        results.append(
            CellResult(
                id=cell_id,
                status="error" if error else "ok",
                stdout=stdout,
                stderr=stderr,
                outputs=items,
                error=error,
                execution_count=raw.get("execution_count"),
            )
        )
    ok = all(r.status != "error" or (by_id.get(r.id) and by_id[r.id].may_raise) for r in results)
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=bool(ok),
        runner="nbclient",
        cells=results,
        duration_ms=duration_ms,
        environment=_versions(),
    )
    return executed, report


def execute_in_local_sandbox(
    spec: NotebookSpec,
    *,
    timeout_s: int = 120,
    memory_mb: int = 2048,
    image_budget_bytes: int | None = None,
) -> ExecutionReport:
    """Execute the composed sandbox program in a local subprocess through
    `majorana_sandbox.local.LocalSubprocessSandbox` — the product's path minus the
    Firecracker boundary (which a local run cannot provide). The static guard runs
    exactly as in production."""
    from majorana_sandbox import run as sandbox_run
    from majorana_sandbox.local import LocalSubprocessSandbox

    kwargs: dict[str, Any] = {}
    if image_budget_bytes is not None:
        kwargs["image_budget_bytes"] = image_budget_bytes
    program = compose_notebook_program(spec, **kwargs)
    with tempfile.TemporaryDirectory(prefix="leona-notebook-") as tmp:
        sidecar = str(Path(tmp) / "observation.json")
        exec_spec = build_execution_spec(
            program, timeout_s=timeout_s, memory_mb=memory_mb, protected_result_path=sidecar
        )
        result = asyncio.run(sandbox_run(LocalSubprocessSandbox(), exec_spec))
    return report_from_sandbox_result(result, spec, program)


def write_pngs(report: ExecutionReport, out_dir: str | Path) -> list[Path]:
    """Dump every captured figure to `<out_dir>/<cell>-<n>.png` — a way to look at what
    the sandbox saw without a viewer."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for cell in report.cells:
        for index, item in enumerate(cell.outputs):
            if item.mime == "image/png" and item.data:
                path = out / f"{cell.id}-{index}.png"
                path.write_bytes(base64.b64decode(item.data))
                written.append(path)
    return written
