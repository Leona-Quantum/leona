"""What a run of a notebook produced, cell by cell.

One report shape for every runner — the sandbox program, nbclient, the in-process
harness — so the viewer, the repair loop and the validator read the same object.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

OutputMime = Literal[
    "text/plain",
    "text/html",
    "text/latex",
    "text/markdown",
    "image/png",
    "image/svg+xml",
]


class CellOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mime: OutputMime
    #: Text for text mimes; base64 for `image/png`.
    data: str
    #: Set when a size budget cut this output; `data` then holds what survived (or is
    #: empty, for an image that was dropped whole).
    truncated: bool = False
    #: Bytes the full output would have been, when it was truncated or dropped.
    original_bytes: int | None = None


class CellError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ename: str
    evalue: str
    traceback: list[str] = Field(default_factory=list)


CellStatus = Literal["ok", "error", "skipped", "not_run"]


class CellResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: CellStatus
    stdout: str = ""
    stderr: str = ""
    outputs: list[CellOutput] = Field(default_factory=list)
    error: CellError | None = None
    duration_ms: int = Field(default=0, ge=0)
    execution_count: int | None = None
    #: Why a cell was skipped or not run (`execute=false`, a cell magic, an earlier
    #: error). Empty for `ok`.
    note: str = ""


class ExecutionReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notebook_slug: str
    ok: bool
    runner: Literal["sandbox", "nbclient", "inprocess"]
    cells: list[CellResult] = Field(default_factory=list)
    duration_ms: int = Field(default=0, ge=0)
    #: Interpreter and library versions the cells ran against, when the runner could
    #: read them (`python`, `qiskit`, `numpy`, `matplotlib`...).
    environment: dict[str, str] = Field(default_factory=dict)
    #: Bytes of output the size budget removed, summed over cells.
    dropped_bytes: int = Field(default=0, ge=0)
    #: Free text a runner wants the reader to see ("matplotlib is not installed here,
    #: figures were rendered as text").
    note: str = ""

    def by_id(self) -> dict[str, CellResult]:
        return {cell.id: cell for cell in self.cells}

    def first_error(self) -> CellResult | None:
        for cell in self.cells:
            if cell.status == "error":
                return cell
        return None

    def failing_cells(self) -> list[CellResult]:
        return [cell for cell in self.cells if cell.status == "error"]

    def executed_count(self) -> int:
        return sum(1 for cell in self.cells if cell.status in {"ok", "error"})
