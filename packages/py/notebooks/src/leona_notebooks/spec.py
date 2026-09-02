"""The canonical notebook model.

A `NotebookSpec` is what the product stores, what the generator emits (after parsing its
percent-format draft), and what the compiler turns into an `.ipynb`. Cells carry a *role*
so the structure a lesson promises — predict, run, observe, explain, modify — is a checkable
property of the object, not a hope about the prose.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = 1

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
_CELL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class NotebookKind(StrEnum):
    """What shape a notebook takes. Drives the structure the generator is held to
    (`templates.structure_for`) and the builds the compiler produces."""

    LESSON = "lesson"  # guided predict → run → observe → explain → modify
    LAB = "lab"  # hands-on with checkpoints, a study-group session's main notebook
    CHALLENGE = "challenge"  # answer-free tasks with stubs; the solution build is derived
    SOLUTION = "solution"  # a challenge with its solutions in place
    WALKTHROUGH = "walkthrough"  # an Atlas record or a paper, walked line by line
    DEMO = "demo"  # one algorithm, demonstrated
    QUIZ = "quiz"  # practice questions with self-check cells
    HARDWARE = "hardware"  # a credential-safe path to a real QPU
    BENCHMARK = "benchmark"  # two methods or backends, compared on one problem
    PROJECT = "project"  # a capstone template
    SCRATCH = "scratch"  # a freeform notebook (imported, or a researcher's own)


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


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


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


class Framework(_Model):
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
    """Where content came from — provenance a reader can follow."""

    kind: Literal["atlas-record", "paper", "artifact", "upload", "brief", "curriculum"]
    ref: str = ""
    note: str = ""


class Cell(_Model):
    id: str
    kind: Literal["markdown", "code"]
    role: CellRole | None = None
    source: str = ""
    tags: list[str] = Field(default_factory=list)
    #: `False` marks a cell the product never runs on the reader's behalf — a hardware
    #: submission, anything that needs a credential or the network. It still ships in
    #: the `.ipynb`; the reader runs it where those things exist.
    execute: bool = True
    #: For `role=solution` code cells: the learner-facing placeholder used by the
    #: challenge build. Must leave every name the checkpoints read defined.
    stub: str | None = None
    #: Advisory per-cell budget for the nbclient validator; the sandbox has one budget.
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
        """The nbclient/Jupyter convention: a cell tagged `raises-exception` is expected
        to fail and execution continues past it."""
        return "raises-exception" in self.tags


class NotebookSpec(_Model):
    schema_version: Literal[1] = SCHEMA_VERSION
    slug: str
    title: str
    kind: NotebookKind = NotebookKind.LESSON
    summary: str = ""
    audience: Audience = Field(default_factory=Audience)
    style: Style = Field(default_factory=Style)
    framework: Framework = Field(default_factory=Framework)
    objectives: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    cells: list[Cell] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    seeds: list[Seed] = Field(default_factory=list)
    #: The reader's original ask, kept verbatim as provenance.
    brief: str = ""
    #: Free-form placement data (curriculum unit, order, deliverable name). Never
    #: interpreted by this package beyond the curriculum builder.
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

    # -- navigation helpers -------------------------------------------------

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
        """The lowest `c<NN>` id not in use. Ids are stable once assigned; a revision
        that inserts a cell gets a fresh one rather than renumbering its neighbours."""
        used = {cell.id for cell in self.cells}
        index = len(self.cells) + 1
        while True:
            candidate = f"{prefix}{index:02d}"
            if candidate not in used:
                return candidate
            index += 1


def assign_cell_ids(cells: list[Cell]) -> list[Cell]:
    """Give every id-less cell a positional `cNN` id without touching the ones set."""
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
