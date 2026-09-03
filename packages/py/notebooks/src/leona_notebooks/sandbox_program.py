"""Run a notebook's cells inside the existing sandbox, one dispatch, per-cell evidence.

The sandbox executes one string (`ExecutionSpec.code`) and wraps it with two provider-
owned snippets, `trusted_setup` and `trusted_observer`, that share the host function's
locals (`majorana_sandbox.spec.compose_execution`). That is enough to run a notebook
without a kernel:

- `trusted_setup` defines `__leona_run_cell__`, which `exec`s one cell's source in the
  shared namespace while capturing stdout/stderr, the value of a trailing expression,
  exceptions, and any matplotlib figures the cell left open.
- `code` is a sequence of `__leona_run_cell__(id, source, tags)` calls.
- `trusted_observer` copies the accumulated per-cell records into the protected
  observation, which the provider writes to the JSON sidecar.

The static guard runs on `code` — where the cell sources are string literals, invisible
to its line-based import check. So this module runs the guard on **every executable
cell's raw source first** and refuses to compose a program for a notebook that fails it.
Nothing about the sandbox's own boundary is touched or widened by this file.
"""

from __future__ import annotations

import ast
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from majorana_sandbox.guard import check_python_code
from majorana_sandbox.spec import MAX_OUTPUT_BYTES, ExecutionSpec

from leona_notebooks.execution import CellError, CellOutput, CellResult, ExecutionReport
from leona_notebooks.spec import Cell, NotebookSpec

#: Default share of the 1 MiB evidence sidecar that figures may occupy.
DEFAULT_IMAGE_BUDGET_BYTES = 600_000
#: Per-cell cap on captured stdout/stderr text.
DEFAULT_TEXT_CAP_BYTES = 24_000
#: Per-value cap on a displayed repr.
DEFAULT_REPR_CAP_BYTES = 8_000

_MAGIC_LINE = re.compile(r"^\s*[%!]")
_CELL_MAGIC = re.compile(r"^\s*%%")


class NotebookGuardError(ValueError):
    """One or more cells failed the static guard. `violations` maps cell id → reasons."""

    def __init__(self, violations: dict[str, list[str]]) -> None:
        self.violations = violations
        summary = "; ".join(
            f"{cell_id}: {', '.join(reasons)}" for cell_id, reasons in violations.items()
        )
        super().__init__(f"notebook blocked by the Python safety guard — {summary}")


class UnknownCellError(ValueError):
    """`run_until` names a cell this notebook does not have. Raised during
    composition — before an `ExecutionSpec` is built and therefore before any
    sandbox dispatch — so a bad id costs nothing and cannot half-run a notebook."""


@dataclass(frozen=True)
class NotebookProgram:
    code: str
    trusted_setup: str
    trusted_observer: str
    #: Ids of the cells the program will run, in order.
    cell_ids: tuple[str, ...]
    #: Cells the program will *not* run, with the reason (execute=false, a cell magic).
    skipped: dict[str, str]
    #: Code cells left out because they sit after `run_until`, with the reason. Distinct
    #: from `skipped`: a skipped cell is one the product never runs at all, while these
    #: are cells the reader deliberately stopped short of, and the report says `not_run`
    #: for them WITHOUT that counting as the run having fallen over.
    not_run: dict[str, str] = field(default_factory=dict)


# --------------------------------------------------------------------------- source prep


def strip_magics(source: str) -> tuple[str, bool]:
    """Remove IPython line magics and shell escapes (`%matplotlib inline`, `!pip ...`).

    Returns the executable source and whether the cell *starts* with a cell magic
    (`%%time`, `%%capture`), in which case the whole cell is skipped — its body is
    not plain Python by contract.
    """
    lines = source.splitlines()
    if lines and _CELL_MAGIC.match(lines[0]):
        return "", True
    kept = [line for line in lines if not _MAGIC_LINE.match(line)]
    text = "\n".join(kept)
    return (text + "\n") if text.strip() else "", False


def rewrite_last_expression(source: str) -> str:
    """Wrap a trailing expression statement in `__leona_display__(...)`, as Jupyter
    displays it, unless it ends with `;` (Jupyter's suppression convention). Text
    surgery, not `ast.unparse`, so comments and line numbers survive."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source  # the cell will raise at exec time, with the real message
    if not tree.body:
        return source
    last = tree.body[-1]
    if not isinstance(last, ast.Expr):
        return source
    if isinstance(last.value, ast.Constant) and isinstance(last.value.value, str):
        return source  # a bare docstring-like literal: Jupyter shows it, but noise here
    lines = source.split("\n")
    # Check for the suppressing semicolon after the expression's last character.
    tail = "\n".join(lines[last.end_lineno - 1 :])[last.end_col_offset :] if last.end_lineno else ""
    if tail.strip().startswith(";"):
        return source
    start_line, start_col = last.lineno - 1, last.col_offset
    end_line, end_col = (last.end_lineno or last.lineno) - 1, last.end_col_offset or 0
    lines[end_line] = lines[end_line][:end_col] + ")" + lines[end_line][end_col:]
    lines[start_line] = (
        lines[start_line][:start_col] + "__leona_display__(" + lines[start_line][start_col:]
    )
    return "\n".join(lines)


def prepare_cell_source(cell: Cell) -> tuple[str, str | None]:
    """The source the program runs for a cell, or a reason it is skipped."""
    if not cell.runs_in_sandbox:
        reason = "execute=false" if not cell.execute else "tagged skip-execution"
        return "", reason
    stripped, is_cell_magic = strip_magics(cell.source)
    if is_cell_magic:
        return "", "cell magic (%%) is not plain Python"
    if not stripped.strip():
        return "", None  # empty cell: runs trivially
    return rewrite_last_expression(stripped), None


# --------------------------------------------------------------------------- the program


_SETUP_TEMPLATE = r"""
import sys as _ln_sys
import io as _ln_io
import time as _ln_time
import traceback as _ln_tb
import base64 as _ln_b64
import builtins as _ln_builtins
_ln_state = {"cells": [], "stopped": False, "image_bytes": 0, "dropped_bytes": 0, "count": 0}
_ln_cfg = {"image_budget": __IMAGE_BUDGET__, "text_cap": __TEXT_CAP__, "repr_cap": __REPR_CAP__, "dpi": 80}
_ln_env = {"python": _ln_sys.version.split()[0]}
for _ln_name in ("qiskit", "numpy", "matplotlib", "pennylane", "cirq", "scipy"):
    try:
        _ln_mod = _ln_builtins.__import__(_ln_name)
        _ln_env[_ln_name] = _ln_str(_ln_getattr(_ln_mod, "__version__", "?"))
    except _ln_exception:
        pass
try:
    import matplotlib as _ln_mpl
    _ln_mpl.use("Agg")
    import matplotlib.pyplot as _ln_plt
    from matplotlib.figure import Figure as _ln_Figure
except _ln_exception:
    _ln_mpl = None
    _ln_plt = None
    _ln_Figure = None
_ln_env["figures"] = "png" if _ln_plt is not None else "unavailable"

def _ln_cap_text(text, cap):
    data = text.encode("utf-8", "replace")
    if _ln_len(data) <= cap:
        return text, False
    _ln_state["dropped_bytes"] += _ln_len(data) - cap
    return data[:cap].decode("utf-8", "ignore") + "\n…[output truncated]\n", True

def _ln_png(fig):
    buf = _ln_io.BytesIO()
    fig.savefig(buf, format="png", dpi=_ln_cfg["dpi"], bbox_inches="tight")
    return buf.getvalue()

def _ln_add_image(cell, png_bytes):
    size = _ln_len(png_bytes)
    if _ln_state["image_bytes"] + size > _ln_cfg["image_budget"]:
        _ln_state["dropped_bytes"] += size
        cell["outputs"].append({"mime": "image/png", "data": "", "truncated": True, "original_bytes": size})
        return
    _ln_state["image_bytes"] += size
    cell["outputs"].append({"mime": "image/png", "data": _ln_b64.b64encode(png_bytes).decode("ascii")})

def _ln_add_text(cell, mime, text):
    text, truncated = _ln_cap_text(_ln_str(text), _ln_cfg["repr_cap"])
    cell["outputs"].append({"mime": mime, "data": text, "truncated": truncated})

def _ln_display(value=None, *rest, **_kw):
    cell = _ln_state["cells"][-1] if _ln_state["cells"] else None
    if cell is None or value is None:
        return None
    try:
        if _ln_Figure is not None and _ln_isinstance(value, _ln_Figure):
            _ln_state["shown"].add(_ln_builtins.id(value))
            _ln_add_image(cell, _ln_png(value))
            return None
        png_repr = _ln_getattr(value, "_repr_png_", None)
        if png_repr is not None:
            data = png_repr()
            if data:
                if _ln_isinstance(data, _ln_str):
                    data = _ln_b64.b64decode(data)
                _ln_add_image(cell, data)
                return None
        html_repr = _ln_getattr(value, "_repr_html_", None)
        if html_repr is not None:
            html = html_repr()
            if html:
                _ln_add_text(cell, "text/html", html)
                return None
        latex_repr = _ln_getattr(value, "_repr_latex_", None)
        if latex_repr is not None:
            latex = latex_repr()
            if latex:
                _ln_add_text(cell, "text/latex", latex)
                return None
        _ln_add_text(cell, "text/plain", _ln_builtins.repr(value))
    except _ln_exception as exc:
        _ln_add_text(cell, "text/plain", "<display failed: " + _ln_type(exc).__name__ + ">")
    return None

def _ln_harvest_figures(cell):
    if _ln_plt is None:
        return
    try:
        for num in _ln_list(_ln_plt.get_fignums()):
            fig = _ln_plt.figure(num)
            if _ln_builtins.id(fig) not in _ln_state["shown"]:
                _ln_add_image(cell, _ln_png(fig))
        _ln_plt.close("all")
    except _ln_exception as exc:
        _ln_add_text(cell, "text/plain", "<figure capture failed: " + _ln_type(exc).__name__ + ">")

def _ln_run_cell(cell_id, source, tags=()):
    cell = {"id": cell_id, "status": "ok", "stdout": "", "stderr": "", "outputs": [], "error": None, "duration_ms": 0, "execution_count": None, "note": ""}
    _ln_state["cells"].append(cell)
    _ln_state["shown"] = _ln_builtins.set()
    if _ln_state["stopped"]:
        cell["status"] = "not_run"
        cell["note"] = "an earlier cell raised"
        return
    _ln_state["count"] += 1
    cell["execution_count"] = _ln_state["count"]
    out, err = _ln_io.StringIO(), _ln_io.StringIO()
    real_out, real_err = _ln_sys.stdout, _ln_sys.stderr
    _ln_sys.stdout, _ln_sys.stderr = out, err
    started = _ln_time.perf_counter()
    try:
        _ln_builtins.exec(_ln_builtins.compile(source, "<cell " + cell_id + ">", "exec"), _majorana_namespace)
    except _ln_builtins.BaseException as exc:
        cell["status"] = "error"
        lines = _ln_tb.format_exception(_ln_type(exc), exc, exc.__traceback__)
        cell["error"] = {"ename": _ln_type(exc).__name__, "evalue": _ln_str(exc)[:2000], "traceback": [_ln_str(line)[:2000] for line in lines[-12:]]}
        if "raises-exception" not in tags:
            _ln_state["stopped"] = True
    finally:
        _ln_sys.stdout, _ln_sys.stderr = real_out, real_err
        cell["duration_ms"] = _ln_int((_ln_time.perf_counter() - started) * 1000)
        cell["stdout"], _ = _ln_cap_text(out.getvalue(), _ln_cfg["text_cap"])
        cell["stderr"], _ = _ln_cap_text(err.getvalue(), _ln_cfg["text_cap"])
        _ln_harvest_figures(cell)

_majorana_namespace["__leona_run_cell__"] = _ln_run_cell
_majorana_namespace["__leona_display__"] = _ln_display
_majorana_namespace["display"] = _ln_display
_majorana_namespace["get_ipython"] = lambda: None
"""

_OBSERVER = r"""
_majorana_observation["notebook"] = {
    "cells": _ln_state["cells"],
    "environment": _ln_env,
    "image_bytes": _ln_state["image_bytes"],
    "dropped_bytes": _ln_state["dropped_bytes"],
    "stopped": _ln_state["stopped"],
}
"""


def _default_guard(source: str) -> list[str]:
    result = check_python_code(source)
    return [] if result.ok else list(result.violations)


#: The reason recorded against every code cell after `run_until`.
RUN_UNTIL_NOTE = "after the cell you ran to"


def compose_notebook_program(
    spec: NotebookSpec,
    *,
    guard: Callable[[str], list[str]] | None = None,
    run_until: str | None = None,
    image_budget_bytes: int = DEFAULT_IMAGE_BUDGET_BYTES,
    text_cap_bytes: int = DEFAULT_TEXT_CAP_BYTES,
    repr_cap_bytes: int = DEFAULT_REPR_CAP_BYTES,
) -> NotebookProgram:
    """Build the sandbox program for a notebook. Raises `NotebookGuardError` if any
    executable cell fails the static guard (`majorana_sandbox.guard` by default).

    `run_until` is a cell id: cells at or before it are composed, everything after is
    left out and reported `not_run`. **Cells after the cut are not guard-checked**, and
    that is the deliberate choice rather than an oversight — the guard exists to stop
    code reaching the sandbox, so it has to run on exactly what is composed into the
    program and nothing else. Guarding the tail as well would refuse a reader's
    "run the first two cells" because cell nine, which is not going to run, imports
    `subprocess`. Those cells are guarded on the next composition that includes them,
    which is the one where their content can actually execute. An unknown `run_until`
    raises `UnknownCellError` here, before any `ExecutionSpec` exists.
    """
    if image_budget_bytes >= MAX_OUTPUT_BYTES:
        raise ValueError("image budget must leave room in the evidence sidecar")
    cut = len(spec.cells) - 1
    if run_until is not None:
        try:
            cut = spec.index_of(run_until)
        except KeyError:
            raise UnknownCellError(f"run_until: this notebook has no cell {run_until!r}") from None
    check = guard or _default_guard
    violations: dict[str, list[str]] = {}
    prepared: list[tuple[Cell, str]] = []
    skipped: dict[str, str] = {}
    not_run: dict[str, str] = {}
    for index, cell in enumerate(spec.cells):
        if not cell.is_code:
            continue
        if index > cut:
            not_run[cell.id] = RUN_UNTIL_NOTE
            continue
        source, reason = prepare_cell_source(cell)
        if reason is not None:
            skipped[cell.id] = reason
            continue
        found = check(cell.source)
        if found:
            violations[cell.id] = found
        prepared.append((cell, source))
    if violations:
        raise NotebookGuardError(violations)
    calls = [
        f"__leona_run_cell__({cell.id!r}, {source!r}, {tuple(cell.tags)!r})"
        for cell, source in prepared
    ]
    code = "\n".join(calls) + "\n" if calls else "pass\n"
    setup = (
        _SETUP_TEMPLATE.replace("__IMAGE_BUDGET__", str(int(image_budget_bytes)))
        .replace("__TEXT_CAP__", str(int(text_cap_bytes)))
        .replace("__REPR_CAP__", str(int(repr_cap_bytes)))
    )
    # The host function binds `_majorana_*` builtin aliases before `trusted_setup`
    # runs; the setup uses its own `_ln_*` names so a later change to that list
    # cannot silently break it. Bind them here from `builtins`.
    prelude = (
        "_ln_str = _majorana_builtins.str\n"
        "_ln_getattr = _majorana_builtins.getattr\n"
        "_ln_exception = _majorana_builtins.Exception\n"
        "_ln_isinstance = _majorana_builtins.isinstance\n"
        "_ln_len = _majorana_builtins.len\n"
        "_ln_list = _majorana_builtins.list\n"
        "_ln_int = _majorana_builtins.int\n"
        "_ln_type = _majorana_builtins.type\n"
    )
    return NotebookProgram(
        code=code,
        trusted_setup=prelude + setup,
        trusted_observer=_OBSERVER,
        cell_ids=tuple(cell.id for cell, _ in prepared),
        skipped=skipped,
        not_run=not_run,
    )


def build_execution_spec(
    program: NotebookProgram,
    *,
    timeout_s: int = 120,
    memory_mb: int = 2048,
    qubits_estimate: int | None = None,
    protected_result_path: str | None = None,
) -> ExecutionSpec:
    """An `ExecutionSpec` for `majorana_sandbox.run`. The sidecar path defaults to a
    fresh `/tmp/leona-notebook-<uuid>.json` (the provider reads and removes it)."""
    return ExecutionSpec(
        code=program.code,
        timeout_s=timeout_s,
        memory_mb=memory_mb,
        qubits_estimate=qubits_estimate,
        trusted_setup=program.trusted_setup,
        trusted_observer=program.trusted_observer,
        protected_result_path=protected_result_path or f"/tmp/leona-notebook-{uuid4().hex}.json",
    )


# --------------------------------------------------------------------------- the report


def report_from_observation(
    observation: dict[str, Any] | None,
    spec: NotebookSpec,
    program: NotebookProgram,
    *,
    duration_ms: int = 0,
    process_ok: bool = True,
    stderr: str = "",
) -> ExecutionReport:
    """Turn the protected observation's `notebook` block into an `ExecutionReport`,
    filling in the cells the program never reached."""
    block = (observation or {}).get("notebook") if isinstance(observation, dict) else None
    recorded: dict[str, dict[str, Any]] = {}
    environment: dict[str, str] = {}
    dropped = 0
    note = ""
    if isinstance(block, dict):
        for raw in block.get("cells", []) or []:
            if isinstance(raw, dict) and isinstance(raw.get("id"), str):
                recorded[raw["id"]] = raw
        environment = {str(k): str(v) for k, v in (block.get("environment") or {}).items()}
        dropped = int(block.get("dropped_bytes") or 0)
        if environment.get("figures") == "unavailable":
            note = "matplotlib is not installed in the sandbox image; figures were not captured."
    elif observation is None or (isinstance(observation, dict) and "evidence_error" in observation):
        note = (
            "the sandbox returned no notebook evidence"
            + (
                f" ({observation['evidence_error']})"
                if isinstance(observation, dict) and observation.get("evidence_error")
                else ""
            )
            + (f": {stderr.strip()[-500:]}" if stderr.strip() else "")
        )

    results: list[CellResult] = []
    reached_end = True
    for cell in spec.cells:
        if not cell.is_code:
            continue
        if cell.id in program.skipped:
            results.append(CellResult(id=cell.id, status="skipped", note=program.skipped[cell.id]))
            continue
        if cell.id in program.not_run:
            # Deliberately short of this cell (`run_until`). `reached_end` is left
            # alone: the run did everything it was asked to, so `ok` still means
            # "what ran, ran cleanly" rather than being pulled false by the tail.
            results.append(CellResult(id=cell.id, status="not_run", note=program.not_run[cell.id]))
            continue
        raw = recorded.get(cell.id)
        if raw is None:
            reached_end = False
            results.append(
                CellResult(
                    id=cell.id,
                    status="not_run",
                    note="the sandbox stopped before this cell" if block else "no evidence",
                )
            )
            continue
        error = raw.get("error")
        results.append(
            CellResult(
                id=cell.id,
                status=raw.get("status")
                if raw.get("status") in {"ok", "error", "not_run", "skipped"}
                else "error",
                stdout=str(raw.get("stdout") or ""),
                stderr=str(raw.get("stderr") or ""),
                outputs=[
                    CellOutput(
                        mime=item.get("mime", "text/plain"),
                        data=str(item.get("data") or ""),
                        truncated=bool(item.get("truncated", False)),
                        original_bytes=item.get("original_bytes"),
                    )
                    for item in (raw.get("outputs") or [])
                    if isinstance(item, dict)
                ],
                error=(
                    CellError(
                        ename=str(error.get("ename") or "Error"),
                        evalue=str(error.get("evalue") or ""),
                        traceback=[str(line) for line in (error.get("traceback") or [])],
                    )
                    if isinstance(error, dict)
                    else None
                ),
                duration_ms=max(0, int(raw.get("duration_ms") or 0)),
                execution_count=raw.get("execution_count"),
                note=str(raw.get("note") or ""),
            )
        )
    ok = (
        process_ok
        and reached_end
        and all(r.status != "error" or spec.cell_by_id(r.id).may_raise for r in results)
        and bool(block)
    )
    if not process_ok and not note:
        note = "the sandbox process did not exit cleanly" + (
            f": {stderr.strip()[-500:]}" if stderr.strip() else ""
        )
    return ExecutionReport(
        notebook_slug=spec.slug,
        ok=ok,
        runner="sandbox",
        cells=results,
        duration_ms=max(0, duration_ms),
        environment=environment,
        dropped_bytes=dropped,
        note=note,
    )


def report_from_sandbox_result(
    result: Any, spec: NotebookSpec, program: NotebookProgram
) -> ExecutionReport:
    """`result` is a `majorana_sandbox.SandboxResult` (duck-typed so tests can pass a
    stand-in): `ok`, `duration_ms`, `stderr`, `protected_result`."""
    return report_from_observation(
        getattr(result, "protected_result", None),
        spec,
        program,
        duration_ms=int(getattr(result, "duration_ms", 0) or 0),
        process_ok=bool(getattr(result, "ok", False)),
        stderr=str(getattr(result, "stderr", "") or ""),
    )


def program_as_json(program: NotebookProgram) -> str:
    """For logs and fixtures."""
    return json.dumps(
        {"cell_ids": program.cell_ids, "skipped": program.skipped, "code": program.code},
        ensure_ascii=False,
    )
