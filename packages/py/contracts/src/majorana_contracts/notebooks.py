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
from typing import Annotated, Any, Literal
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


class AnswerPrompt(_Model):
    """What a reader is shown of a question — everything the key holds EXCEPT the answer.

    Grading is server-side for exactly this reason. If the correct option travelled
    to the browser so the page could mark its own quiz, the quiz would be an honour
    system with a scoreboard: anyone can read the payload. So `for_learner()` drops
    `Cell.answer` entirely and leaves this in its place, and
    `NotebookSpec.leaks_answer_key()` is the assertion that it did.
    """

    kind: Literal["choice", "numeric", "text", "rubric"]
    #: `choice` only — the options in author order, with no marker on the right one.
    options: list[str] = Field(default_factory=list)
    #: `numeric` only — shown beside the input so the reader knows what to answer in.
    unit: str = ""


class ChoiceAnswer(_Model):
    """One right option among several. `correct` indexes `options`."""

    kind: Literal["choice"] = "choice"
    options: list[str] = Field(min_length=2, max_length=8)
    correct: int = Field(ge=0)
    explanation: str = ""

    @model_validator(mode="after")
    def _correct_in_range(self) -> ChoiceAnswer:
        if self.correct >= len(self.options):
            raise ValueError(f"correct index {self.correct} is outside {len(self.options)} options")
        return self


class NumericAnswer(_Model):
    """A number, compared with an ABSOLUTE tolerance.

    `tolerance` defaults to 0.0, which means exact equality — deliberate, so an
    author who omits it gets a grader that is strict rather than one that is
    silently generous. A physical answer almost always wants a tolerance set.
    """

    kind: Literal["numeric"] = "numeric"
    value: float
    tolerance: float = Field(default=0.0, ge=0.0)
    unit: str = ""
    explanation: str = ""


class TextAnswer(_Model):
    """Accepts any of `accept`, compared case-insensitively on collapsed whitespace.

    This is for answers with a small closed set of right spellings ("Hadamard",
    "the Hadamard gate"). Anything open-ended belongs in `RubricAnswer`, which is
    graded by the model — putting it here would silently mark a correct answer
    wrong for being phrased differently.
    """

    kind: Literal["text"] = "text"
    accept: list[str] = Field(min_length=1, max_length=16)
    explanation: str = ""


class RubricAnswer(_Model):
    """Open-ended: graded by the model against `rubric`, never deterministically.

    The rubric is what the grader is told to look for, so it must be specific
    enough that two readers agree on the verdict. Carried separately from the
    other three so that a grade's provenance is legible: anything graded here
    reports `graded_by="model"` and is reproducible only to the extent the model is.
    """

    kind: Literal["rubric"] = "rubric"
    rubric: str = Field(min_length=1)
    explanation: str = ""


AnswerKey = Annotated[
    ChoiceAnswer | NumericAnswer | TextAnswer | RubricAnswer, Field(discriminator="kind")
]


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
    #: Hidden grader for a code cell the reader fills in. Runs in the sandbox
    #: immediately after the reader's own cell, in the SAME namespace, so it can
    #: assert on whatever that cell defined. Never sent to the browser and never
    #: written into an exported `.ipynb` — see `NotebookSpec.for_learner()`.
    #:
    #: A grader that cannot fail is not a grader, and both routes a check can arrive
    #: by are held to that. `scripts/check_graders.py` gates the ones committed to this
    #: repository; `leona_notebooks.grader_audit` gates the ones the model writes at
    #: request time, from two runs of the whole notebook — one with every exercise
    #: blank, where each check must FAIL, one with the author's own source in place,
    #: where each must PASS. A generated check that fails either arm has its `check`
    #: stripped before the notebook reaches a reader (owner ruling ai-ops#258), so a
    #: cell arriving from the pipeline with `check` set has been proved, not assumed.
    check: str | None = None
    #: Structured answer key for a `role=question` cell. `choice`, `numeric` and
    #: `text` grade deterministically; `rubric` is graded by the model.
    answer: AnswerKey | None = None
    #: The redacted half of `answer`, and the ONLY half a reader's browser receives.
    #: Set by `for_learner()`; an authored spec leaves it `None`.
    answer_prompt: AnswerPrompt | None = None
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

    @model_validator(mode="after")
    def _check_only_on_code(self) -> Cell:
        if self.check is not None and self.kind != "code":
            raise ValueError(f"cell {self.id}: only code cells carry a check")
        return self

    @model_validator(mode="after")
    def _check_needs_a_stub(self) -> Cell:
        """A grader with nothing to grade is an authoring mistake, not a strict build.

        The check runs against what the reader wrote in place of `stub`. Without a
        stub there is no reader-authored cell for it to grade, so it would only ever
        run against the model's own solution and pass every time — a green tick that
        measures nothing.
        """
        if self.check is not None and not (self.stub or "").strip():
            raise ValueError(f"cell {self.id}: a check needs a stub for the reader to fill in")
        return self

    @model_validator(mode="after")
    def _answer_only_on_question(self) -> Cell:
        if self.answer is not None and self.role != CellRole.QUESTION:
            raise ValueError(f"cell {self.id}: only role=question cells carry an answer key")
        return self

    @property
    def is_graded(self) -> bool:
        """Whether this cell can produce a grade at all — the two ways differ.

        A code cell is graded by running `check`; a question cell by comparing the
        reader's response to `answer`. A cell with neither is content, and counting
        it as an ungraded exercise is what makes a progress figure honest.
        """
        return self.check is not None or self.answer is not None

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

    def for_learner(self) -> NotebookSpec:
        """The build a reader receives: no graders, no answer keys, stubs in place.

        Three redactions, and each one is the difference between a graded notebook
        and a notebook that merely looks graded:

        * `check` is dropped — it holds the assertions, and often the answer with them.
        * `answer` is replaced by `answer_prompt`, which carries the options but not
          which one is right.
        * a `solution` cell's `source` is replaced by its `stub`, so the reader gets
          the placeholder to fill in rather than the finished code.

        Returns a copy; the authored spec is never mutated.
        """
        cells: list[Cell] = []
        for cell in self.cells:
            data = cell.model_dump()
            data["check"] = None
            if cell.answer is not None:
                data["answer"] = None
                data["answer_prompt"] = AnswerPrompt(
                    kind=cell.answer.kind,
                    options=list(getattr(cell.answer, "options", []) or []),
                    unit=getattr(cell.answer, "unit", "") or "",
                ).model_dump()
            if cell.role == CellRole.SOLUTION and cell.stub is not None:
                data["source"] = cell.stub
            cells.append(Cell.model_validate(data))
        return self.model_copy(update={"cells": cells})

    def leaks_answer_key(self) -> list[str]:
        """Cell ids in this spec that still carry something a reader must not see.

        Written to be called ON a learner build, as the assertion that `for_learner()`
        did its job — a redaction nothing checks is a redaction that silently stops
        happening the first time a field is added to `Cell`.
        """
        leaked: list[str] = []
        for cell in self.cells:
            if cell.check is not None or cell.answer is not None:
                leaked.append(cell.id)
            elif (
                cell.role == CellRole.SOLUTION
                and cell.stub is not None
                and cell.source != cell.stub
            ):
                leaked.append(cell.id)
        return leaked

    def graded_cells(self) -> list[Cell]:
        return [cell for cell in self.cells if cell.is_graded]


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


class CellGrade(_Model):
    """The verdict on ONE graded cell.

    `unattempted` is a first-class status rather than a failure: a reader who has
    not reached a cell has not got it wrong, and collapsing the two would make a
    progress bar drop as a notebook grows. `ungradable` is the honest outcome when
    the grader itself could not run — a sandbox timeout, a malformed key — and it
    is never counted as either a pass or a fail.
    """

    id: str
    status: Literal["passed", "failed", "unattempted", "ungradable"]
    graded_by: Literal["deterministic", "model"]
    #: Reader-facing, and written to be read after a wrong answer: what was expected,
    #: not merely that it was wrong.
    message: str = ""
    #: One step toward the answer, never the answer itself.
    hint: str = ""
    #: For a code cell: the assertion text that failed, so the reader sees the
    #: actual condition rather than a generic "incorrect".
    detail: str = ""


class GradeReport(_Model):
    """Grades for one attempt at one notebook version."""

    notebook_slug: str
    cells: list[CellGrade] = Field(default_factory=list)

    def by_id(self) -> dict[str, CellGrade]:
        return {grade.id: grade for grade in self.cells}

    @property
    def passed(self) -> int:
        return sum(1 for grade in self.cells if grade.status == "passed")

    @property
    def failed(self) -> int:
        return sum(1 for grade in self.cells if grade.status == "failed")

    @property
    def attempted(self) -> int:
        return sum(1 for grade in self.cells if grade.status in {"passed", "failed"})

    @property
    def gradable(self) -> int:
        """Cells that could be graded at all — the denominator a score must use.

        Deliberately excludes `ungradable`: scoring 8/10 when two graders crashed
        reports a worse result than the reader earned, and scoring 8/8 hides that
        two never ran. Callers show `attempted`/`gradable` and surface the rest.
        """
        return sum(1 for grade in self.cells if grade.status != "ungradable")


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
    #: Structure requirements the spec does not satisfy (`templates.check_structure`),
    #: recorded so a reader's own edit is *reported on* rather than refused. Nala's
    #: own builds run the same check as a prompt constraint; a user-authored version
    #: runs it here and keeps going. Carried in this model rather than on a column of
    #: its own because `notebook_versions.review` is already the JSONB the advisory
    #: layer is stored in — see `NotebookVersion.warnings`, which mirrors this out.
    warnings: list[str] = Field(default_factory=list)


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


#: Imported rather than redeclared. `test_every_public_resource_model_reaches_the_export`
#: finds unexported models by testing `issubclass(value, models._ResourceBase)` — so a
#: module with its own identically-configured base is INVISIBLE to it, and this module's
#: entire family of request/response models was. Two of them slipped past the guard the
#: day it was checked. One base, one guard that can see everything under it.
from .models import _ResourceBase  # noqa: E402


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
    #: Advisory structure notes for THIS version, mirrored out of `review.warnings` so
    #: a client that renders the notes never has to know they are stored inside the
    #: review blob. Never a reason a version was refused: a user-authored version with
    #: warnings is `ready`, and the warnings render beside it.
    warnings: list[str] = Field(default_factory=list)


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


class GradeAttemptRequest(_ResourceBase):
    """One reader's attempt at the graded cells of a notebook version.

    Only the reader's own work travels: `code` is what they wrote in each exercise
    cell, `answers` what they typed for each question. The assertions and the answer
    key stay on the server and are joined to this on arrival, which is the whole
    reason grading is a request rather than something the browser can do — a grader
    the client holds is a grader the client can read.

    Bounded on both axes because it is an unauthenticated-shaped payload from the
    reader's keyboard: 64 cells, 32 KB per cell. A notebook with more graded cells
    than that is not a lesson.
    """

    code: dict[str, str] = Field(default_factory=dict, max_length=64)
    answers: dict[str, str] = Field(default_factory=dict, max_length=64)

    @model_validator(mode="after")
    def _bounded(self) -> GradeAttemptRequest:
        for name, mapping in (("code", self.code), ("answers", self.answers)):
            for cell_id, value in mapping.items():
                if len(value) > 32_000:
                    raise ValueError(f"{name}[{cell_id}] is over 32000 characters")
        return self


class GradeAttemptResponse(_ResourceBase):
    """The grading run. Verdicts arrive on the run's event stream as
    `notebook.grades`, the same channel every other notebook result uses — grading
    executes the reader's code in the sandbox, so it takes as long as a run takes and
    cannot be answered inline."""

    run_id: UUID
    #: How many cells this attempt will be graded on, so a client can render the
    #: right number of pending rows instead of guessing from its own copy of the spec.
    graded_cells: int


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


class AuthorNotebookVersionRequest(_ResourceBase):
    """A version the reader wrote themselves.

    Three equivalent ways in, because the same notebook is edited from three places
    and all three must land as one kind of row: `spec` from the in-browser editor,
    `source` from a text editor (the `.nb.py` percent form), `ipynb` from Jupyter
    (`%nala push`). Exactly one of the three — two inputs is a 400, not a silent
    precedence rule, because a client sending both has a bug the server cannot
    resolve in the reader's favour.

    A user-authored version is executed by the same sandbox path Nala's builds use,
    so the version history stays the single truth about what this notebook is.
    """

    spec: NotebookSpec | None = None
    #: The `.nb.py` percent-format authoring text (`leona_notebooks.source`).
    source: str | None = Field(default=None, max_length=400_000)
    ipynb: dict[str, Any] | None = None
    #: The line this edit gets in the version history.
    message: str = Field(default="", max_length=500)
    #: `False` saves the version as `ready` with no report and no run — a draft the
    #: reader has not asked to execute yet.
    execute: bool = True
    #: A cell id: execute cells up to and including it ("Run to here"), reporting the
    #: rest as `not_run`. `None` runs the whole notebook.
    run_until: str | None = None

    # The exactly-one rule and the `run_until` shape are deliberately NOT enforced by
    # validators here, though both are properties of the request: `services/api` maps a
    # pydantic failure to a bare `422 validation failed` with no message (`app.py`'s
    # RequestValidationError handler), and every way this request can be wrong — two
    # inputs, source that will not parse, a `run_until` naming no cell — is one the
    # reader has to be told about in words before they can fix it. The route enforces
    # all three and answers 400 problem+json carrying the real message;
    # `leona_notebooks.authoring.spec_from_author_request` is the single implementation
    # the route and the worker both call.


class AuthorNotebookVersionResponse(_ResourceBase):
    version: NotebookVersionSummary
    #: `None` when `execute=false` — the version is saved `ready` with no report and
    #: there is no run to follow.
    run_id: UUID | None = None


class UpdateNotebookRequest(_ResourceBase):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=2_000)
