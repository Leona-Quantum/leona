"""Notebook contracts — the lesson a reader asked Nala for, as a versioned resource.

Three layers, all here because all three cross the API boundary and the TS client
renders them:

1. The notebook itself: `NotebookSpec` and its `Cell`s (with a pedagogical *role*).
2. What a run of it produced: `ExecutionReport` and its per-cell `CellResult`s.
3. The resources and requests of `/v1/notebooks`: `Notebook`, `NotebookVersion`,
   `NotebookTurn`, and the create/turn/import bodies.

`leona_notebooks` (packages/py/notebooks) owns every operation on these — parsing the
`.nb.py` authoring form, compiling `.ipynb`, composing the sandbox program, applying a
revision — and re-exports the types from here so there is one definition.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .enums import Visibility

NOTEBOOK_SCHEMA_VERSION = 1

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
_CELL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- the notebook


class NotebookKind(StrEnum):
    """What shape a notebook takes. Each kind is a checkable structure contract."""

    LESSON = "lesson"
    LAB = "lab"
    CHALLENGE = "challenge"
    SOLUTION = "solution"
    WALKTHROUGH = "walkthrough"
    DEMO = "demo"
    QUIZ = "quiz"
    HARDWARE = "hardware"
    BENCHMARK = "benchmark"
    PROJECT = "project"
    SCRATCH = "scratch"


class CellRole(StrEnum):
    SETUP = "setup"
    OBJECTIVE = "objective"
    CONCEPT = "concept"
    PREDICT = "predict"
    RUN = "run"
    OBSERVE = "observe"
    EXPLAIN = "explain"
    MODIFY = "modify"
    CHECKPOINT = "checkpoint"
    FIGURE = "figure"
    EXERCISE = "exercise"
    HINT = "hint"
    SOLUTION = "solution"
    QUESTION = "question"
    ANSWER = "answer"
    SUMMARY = "summary"
    REFERENCES = "references"
    NOTE = "note"


class Audience(_Model):
    level: Literal["newcomer", "engineer", "student", "researcher"] = "engineer"
    assumes: list[str] = Field(default_factory=list)
    not_assumed: list[str] = Field(default_factory=list)


class Style(_Model):
    analogies: bool = True
    analogy_domains: list[str] = Field(default_factory=list)
    tone: Literal["plain", "friendly", "formal"] = "plain"
    math_level: Literal["none", "minimal", "full"] = "minimal"
    visualizations: bool = True
    code_comments: Literal["light", "heavy"] = "light"
    language: Literal["en", "ja"] = "en"


class NotebookFramework(_Model):
    name: Literal["qiskit", "pennylane", "cirq", "braket", "cudaq"] = "qiskit"
    version: str = ">=2.5,<2.6"
    execution: Literal["local-statevector", "aer", "ibm-runtime"] = "local-statevector"


class Reference(_Model):
    title: str
    authors: str = ""
    year: int | None = None
    url: str = ""
    note: str = ""


class Seed(_Model):
    """Where content came from — provenance a reader can follow.

    `content` is only meaningful for `kind="circuit"`: the reader's own pasted
    Qiskit Python or OpenQASM 3 text, validated and described by
    `leona_notebooks.circuits` before it reaches a prompt. `kind="notebook"`
    (`ref=<notebook id>`) is another notebook in the same workspace, resolved to
    its current version by the worker's `_seed_material_for` — the
    quiz-from-notebook flow."""

    kind: Literal[
        "atlas-record", "paper", "artifact", "upload", "brief", "curriculum", "circuit", "notebook"
    ]
    ref: str = ""
    note: str = ""
    content: str = Field(default="", max_length=20_000)


class Cell(_Model):
    id: str
    kind: Literal["markdown", "code"]
    role: CellRole | None = None
    source: str = ""
    tags: list[str] = Field(default_factory=list)
    #: `False` marks a cell the product never runs on the reader's behalf — a hardware
    #: submission, anything that needs a credential or the network.
    execute: bool = True
    #: For `role=solution` code cells: the learner-facing placeholder in the challenge build.
    stub: str | None = None
    #: Advisory per-cell budget for a kernel-based validator; the sandbox has one budget.
    timeout_s: int | None = Field(default=None, ge=1, le=600)

    @field_validator("id")
    @classmethod
    def _id_shape(cls, value: str) -> str:
        if not _CELL_ID_RE.match(value):
            raise ValueError(f"cell id {value!r} must match {_CELL_ID_RE.pattern}")
        return value

    @model_validator(mode="after")
    def _stub_only_on_code(self) -> Cell:
        if self.stub is not None and self.kind != "code":
            raise ValueError(f"cell {self.id}: only code cells carry a stub")
        return self

    @property
    def is_code(self) -> bool:
        return self.kind == "code"

    @property
    def runs_in_sandbox(self) -> bool:
        return self.kind == "code" and self.execute and "skip-execution" not in self.tags

    @property
    def may_raise(self) -> bool:
        return "raises-exception" in self.tags


class NotebookSpec(_Model):
    schema_version: Literal[1] = NOTEBOOK_SCHEMA_VERSION
    slug: str
    title: str
    kind: NotebookKind = NotebookKind.LESSON
    summary: str = ""
    audience: Audience = Field(default_factory=Audience)
    style: Style = Field(default_factory=Style)
    framework: NotebookFramework = Field(default_factory=NotebookFramework)
    objectives: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    cells: list[Cell] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    seeds: list[Seed] = Field(default_factory=list)
    #: The reader's original ask, kept verbatim as provenance.
    brief: str = ""
    #: Free-form placement data (curriculum unit, order). Never interpreted here.
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("slug")
    @classmethod
    def _slug_shape(cls, value: str) -> str:
        if not _SLUG_RE.match(value):
            raise ValueError(f"slug {value!r} must match {_SLUG_RE.pattern}")
        return value

    @field_validator("title")
    @classmethod
    def _title_nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("title must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def _unique_cell_ids(self) -> NotebookSpec:
        seen: set[str] = set()
        for cell in self.cells:
            if cell.id in seen:
                raise ValueError(f"duplicate cell id {cell.id!r}")
            seen.add(cell.id)
        return self

    def cell_by_id(self, cell_id: str) -> Cell:
        for cell in self.cells:
            if cell.id == cell_id:
                return cell
        raise KeyError(cell_id)

    def index_of(self, cell_id: str) -> int:
        for index, cell in enumerate(self.cells):
            if cell.id == cell_id:
                return index
        raise KeyError(cell_id)

    def code_cells(self) -> list[Cell]:
        return [cell for cell in self.cells if cell.is_code]

    def executable_cells(self) -> list[Cell]:
        return [cell for cell in self.cells if cell.runs_in_sandbox]

    def with_cells(self, cells: list[Cell]) -> NotebookSpec:
        return self.model_copy(update={"cells": list(cells)})

    def roles_present(self) -> set[CellRole]:
        return {cell.role for cell in self.cells if cell.role is not None}

    def next_cell_id(self, prefix: str = "c") -> str:
        used = {cell.id for cell in self.cells}
        index = len(self.cells) + 1
        while True:
            candidate = f"{prefix}{index:02d}"
            if candidate not in used:
                return candidate
            index += 1


# --------------------------------------------------------------------------- what a run produced

OutputMime = Literal[
    "text/plain",
    "text/html",
    "text/latex",
    "text/markdown",
    "image/png",
    "image/svg+xml",
]


class CellOutput(_Model):
    mime: OutputMime
    #: Text for text mimes; base64 for `image/png`.
    data: str
    truncated: bool = False
    original_bytes: int | None = None


class CellError(_Model):
    ename: str
    evalue: str
    traceback: list[str] = Field(default_factory=list)


CellStatus = Literal["ok", "error", "skipped", "not_run"]


class CellResult(_Model):
    id: str
    status: CellStatus
    stdout: str = ""
    stderr: str = ""
    outputs: list[CellOutput] = Field(default_factory=list)
    error: CellError | None = None
    duration_ms: int = Field(default=0, ge=0)
    execution_count: int | None = None
    note: str = ""


class ExecutionReport(_Model):
    notebook_slug: str
    ok: bool
    runner: Literal["sandbox", "nbclient", "inprocess"]
    cells: list[CellResult] = Field(default_factory=list)
    duration_ms: int = Field(default=0, ge=0)
    environment: dict[str, str] = Field(default_factory=dict)
    dropped_bytes: int = Field(default=0, ge=0)
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


class ReviewFinding(_Model):
    cell_id: str | None = None
    severity: Literal["blocker", "should-fix", "nit"]
    category: Literal["accuracy", "pedagogy", "code", "structure", "safety", "style"]
    finding: str
    suggestion: str = ""


class NotebookReview(_Model):
    """Advisory, like the execute pipeline's alignment review: never blocks a save."""

    verdict: Literal["ready", "needs-attention"]
    findings: list[ReviewFinding] = Field(default_factory=list)
    what_this_notebook_does_not_establish: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- resources


class NotebookVersionStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


class NotebookVersionAuthor(StrEnum):
    USER = "user"
    NALA = "nala"


class NotebookTurnRole(StrEnum):
    USER = "user"
    NALA = "nala"


class _ResourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Notebook(_ResourceBase):
    """Owner-facing notebook resource. Content lives in versions."""

    id: UUID
    workspace_id: UUID
    owner_user_id: UUID
    slug: str
    title: str
    kind: NotebookKind
    summary: str = ""
    visibility: Visibility = Visibility.PRIVATE
    language: Literal["en", "ja"] = "en"
    framework: NotebookFramework = Field(default_factory=NotebookFramework)
    #: The version readers see; `None` until the first generation finishes.
    current_version_id: UUID | None = None
    current_version_seq: int | None = None
    #: Status of the newest version, so a list can show "generating" without a join.
    latest_status: NotebookVersionStatus
    latest_run_id: UUID | None = None
    version_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class NotebookVersionSummary(_ResourceBase):
    id: UUID
    notebook_id: UUID
    seq: int = Field(ge=1)
    status: NotebookVersionStatus
    created_by: NotebookVersionAuthor
    message: str = ""
    ok: bool | None = None
    cell_count: int = Field(default=0, ge=0)
    run_id: UUID | None = None
    created_at: datetime


class NotebookVersion(NotebookVersionSummary):
    """One immutable revision: the spec, its source, the executed `.ipynb`, the run
    report and the advisory review. `ipynb` is present once a run has finished."""

    spec: NotebookSpec | None = None
    source: str = ""
    ipynb: dict[str, Any] | None = None
    report: ExecutionReport | None = None
    review: NotebookReview | None = None
    error: str = ""


class NotebookTurn(_ResourceBase):
    id: UUID
    notebook_id: UUID
    seq: int = Field(ge=1)
    role: NotebookTurnRole
    content: str
    #: The version this turn produced (Nala) or asked for (user), when there is one.
    version_seq: int | None = None
    run_id: UUID | None = None
    created_at: datetime


class NotebookList(_ResourceBase):
    items: list[Notebook]
    next_cursor: UUID | None = None


class NotebookVersionList(_ResourceBase):
    items: list[NotebookVersionSummary]


class NotebookTurnList(_ResourceBase):
    items: list[NotebookTurn]


class NotebookTemplateKind(_ResourceBase):
    id: NotebookKind
    description: str
    structure: list[str]


class NotebookStarter(_ResourceBase):
    id: str
    kind: NotebookKind
    title: str
    brief: str


class NotebookTemplates(_ResourceBase):
    kinds: list[NotebookTemplateKind]
    starters: list[NotebookStarter]
    #: Starter briefs for a whole COURSE (`majorana_contracts.courses`) rather than
    #: one notebook — the composer offers both from this single endpoint. Defaults
    #: to empty so a client built against contracts 2.18.0, which has never heard of
    #: courses, keeps parsing this response unchanged. A course starter's `kind` is
    #: the notebook kind its modules mostly are, a hint for the card, not a promise:
    #: the planner picks each module's kind for itself.
    course_starters: list[NotebookStarter] = Field(default_factory=list)


# --------------------------------------------------------------------------- requests


class CreateNotebookRequest(_ResourceBase):
    brief: str = Field(min_length=1, max_length=8_000)
    kind: NotebookKind | None = None
    title: str | None = Field(default=None, max_length=200)
    audience: Audience | None = None
    style: Style | None = None
    framework: NotebookFramework | None = None
    seeds: list[Seed] = Field(default_factory=list, max_length=8)
    response_locale: Literal["en", "ja"] = "en"


class CreateNotebookResponse(_ResourceBase):
    notebook: Notebook
    version: NotebookVersionSummary
    run_id: UUID


class CreateNotebookTurnRequest(_ResourceBase):
    message: str = Field(min_length=1, max_length=8_000)


class CreateNotebookTurnResponse(_ResourceBase):
    turn: NotebookTurn
    version: NotebookVersionSummary
    run_id: UUID


class ImportNotebookRequest(_ResourceBase):
    """An existing `.ipynb` becomes a notebook the reader can then edit with Nala."""

    ipynb: dict[str, Any]
    title: str | None = Field(default=None, max_length=200)
    execute: bool = True


class ImportNotebookResponse(_ResourceBase):
    """Import creates a NEW notebook whose first version is the upload; `run_id` is set
    only when `execute` asked for a re-run (queued as version 2)."""

    notebook: Notebook
    version: NotebookVersionSummary
    run_id: UUID | None = None


class RerunNotebookResponse(_ResourceBase):
    version: NotebookVersionSummary
    run_id: UUID


class UpdateNotebookRequest(_ResourceBase):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=2_000)
