"""Grading a reader's attempt at a notebook.

Two kinds of question, graded two different ways, and the split is the point:

* a **code cell** the reader fills in is graded by RUNNING the author's hidden
  `check` against whatever the reader's cell defined. It either asserts or it does
  not, and the same attempt grades the same way every time.
* a **question cell** is graded against `Cell.answer`. `choice`, `numeric` and
  `text` are decided here, in Python, with no model in the path. Only `rubric` —
  the genuinely open-ended kind — is handed to the model, and a grade produced that
  way says so in `graded_by`, because it is reproducible only as far as the model is.

The deterministic path is not an optimisation. A grade a reader can argue with is a
grade that has to be defended, and "your code did not satisfy `assert len(counts) == 2`"
ends an argument that "the model thought your answer was incomplete" starts.

Nothing here runs code itself. `spec_with_graders` builds a derived spec whose graded
cells are followed by their check, the caller executes it through the ordinary sandbox
path, and `grades_from_report` reads the verdicts back out. That keeps grading on the
one execution route that is already guarded, budgeted and timed out.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from majorana_contracts.notebooks import (
    Cell,
    CellGrade,
    CellRole,
    ExecutionReport,
    GradeReport,
    NotebookSpec,
)

__all__ = [
    "GradedAttempt",
    "check_cell_id",
    "deterministic_grade",
    "grades_from_report",
    "grader_ids",
    "spec_with_graders",
]

#: Appended to a graded cell's id to name the cell that grades it. Kept short because
#: `Cell.id` is capped at 32 characters and the derived id has to satisfy the same
#: pattern — see `check_cell_id`, which truncates rather than emitting an invalid id.
CHECK_SUFFIX = "-ck"

_CELL_ID_MAX = 32
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class GradedAttempt:
    """One reader's attempt: their code per cell id, and their answers per cell id."""

    code: dict[str, str]
    answers: dict[str, str]


def check_cell_id(cell_id: str, taken: set[str] | None = None) -> str:
    """The id of the cell that grades `cell_id`, guaranteed valid and unique.

    `Cell.id` is capped at 32 characters, so a long id cannot simply carry a suffix.
    Truncating can collide, which would make one cell's grader overwrite another's —
    silently, since both are valid ids — so collisions are resolved against `taken`
    rather than assumed away.
    """
    base = cell_id[: _CELL_ID_MAX - len(CHECK_SUFFIX)] + CHECK_SUFFIX
    if taken is None or base not in taken:
        return base
    for n in range(1, 100):
        suffix = f"{CHECK_SUFFIX}{n}"
        candidate = cell_id[: _CELL_ID_MAX - len(suffix)] + suffix
        if candidate not in taken:
            return candidate
    raise ValueError(f"cannot derive a unique check id for {cell_id!r}")


def grader_ids(spec: NotebookSpec) -> dict[str, str]:
    """`{graded cell id: the id of the cell that grades it}` for one spec.

    Allocated in ONE place because it is allocated twice: once when the graders are
    inserted and once when the results are read back. Those two used to derive the id
    independently, and they disagreed — the writer passed a `taken` set that GREW as
    graders were added, the reader passed one that could only ever hold authored cell
    ids, so the reader's collision resolution never fired. Two checked cells whose ids
    share the first 29 characters (`implement-the-oracle-for-case-1` and `…-2`, which
    is exactly how a model numbers a pair of exercises) therefore got distinct grader
    ids on write and the SAME id on read: the second cell read the first one's result,
    and an unattempted or wrong exercise was reported as passed whenever the one above
    it passed.

    `check_cell_id` already documented that collisions "are resolved against `taken`
    rather than assumed away". The property was real; only one of its two call sites
    supplied a `taken` that could show a collision. Deriving the mapping once removes
    the possibility of the two sides disagreeing at all, rather than fixing the reader
    to match the writer and leaving a second copy of the rule to drift.
    """
    taken = {cell.id for cell in spec.cells}
    out: dict[str, str] = {}
    for cell in spec.cells:
        if cell.check is None:
            continue
        gid = check_cell_id(cell.id, taken)
        taken.add(gid)
        out[cell.id] = gid
    return out


def spec_with_graders(spec: NotebookSpec, attempt: GradedAttempt) -> NotebookSpec:
    """`spec` with the reader's code substituted in and each check inserted after it.

    The reader's own source replaces the cell's — their attempt is what gets graded,
    not the author's solution. A graded cell the reader has not written anything for
    keeps its `stub`, so its check runs against the untouched placeholder and fails,
    which is the correct reading of "not done" and the same thing
    `scripts/check_graders.py` asserts at authoring time.
    """
    ids = grader_ids(spec)
    cells: list[Cell] = []
    for cell in spec.cells:
        data = cell.model_dump()
        if cell.check is not None:
            # The STUB, not `source`, is the baseline for a graded cell. `spec` is the
            # authored spec, so `source` holds the author's own solution — falling back
            # to it would run the grader against the answer and pass every unattempted
            # exercise, reporting a notebook as fully complete before the reader starts.
            # `Cell` guarantees a checked cell has a stub (`_check_needs_a_stub`).
            data["source"] = attempt.code.get(cell.id, cell.stub or "")
        cells.append(Cell.model_validate(data))
        if cell.check is None:
            continue
        gid = ids[cell.id]
        cells.append(
            Cell(
                id=gid,
                kind="code",
                role=CellRole.CHECKPOINT,
                source=cell.check,
                # The grader is expected to raise on a wrong answer, and a raise here
                # is a FAILED GRADE rather than a broken notebook. Without this tag the
                # run's own `ok` would go false for a reader simply getting it wrong.
                tags=["raises-exception", "leona-grader"],
            )
        )
    return spec.model_copy(update={"cells": cells})


def deterministic_grade(cell: Cell, response: str) -> CellGrade | None:
    """Grade a `role=question` cell without a model, or `None` if only a model can.

    Returns `None` for `kind="rubric"` — the caller routes those to the model. A blank
    response is `unattempted` rather than `failed` for every kind: not answering is not
    the same as answering wrongly, and a progress figure that conflates them falls as a
    notebook grows.
    """
    key = cell.answer
    if key is None:
        return None
    if not response.strip():
        return CellGrade(id=cell.id, status="unattempted", graded_by="deterministic")
    explanation = getattr(key, "explanation", "") or ""

    if key.kind == "choice":
        try:
            picked = int(response.strip())
        except ValueError:
            return CellGrade(
                id=cell.id,
                status="failed",
                graded_by="deterministic",
                message="That answer was not one of the options.",
                detail=f"expected an option number 0–{len(key.options) - 1}, got {response!r}",
            )
        if not 0 <= picked < len(key.options):
            return CellGrade(
                id=cell.id,
                status="failed",
                graded_by="deterministic",
                message="That answer was not one of the options.",
                detail=f"option {picked} is outside 0–{len(key.options) - 1}",
            )
        ok = picked == key.correct
        return CellGrade(
            id=cell.id,
            status="passed" if ok else "failed",
            graded_by="deterministic",
            message=explanation if ok else "Not this one.",
            detail="" if ok else f"you chose {key.options[picked]!r}",
        )

    if key.kind == "numeric":
        cleaned = response.strip()
        if key.unit and cleaned.endswith(key.unit):
            cleaned = cleaned[: -len(key.unit)].strip()
        try:
            got = float(cleaned)
        except ValueError:
            return CellGrade(
                id=cell.id,
                status="failed",
                graded_by="deterministic",
                message="That is not a number.",
                detail=f"could not read {response!r} as a number",
            )
        ok = abs(got - key.value) <= key.tolerance
        return CellGrade(
            id=cell.id,
            status="passed" if ok else "failed",
            graded_by="deterministic",
            message=explanation if ok else "Not within the accepted range.",
            detail=""
            if ok
            else f"expected {key.value:g} ± {key.tolerance:g}{(' ' + key.unit) if key.unit else ''}",
        )

    if key.kind == "text":
        got = _normalize(response)
        ok = any(got == _normalize(candidate) for candidate in key.accept)
        return CellGrade(
            id=cell.id,
            status="passed" if ok else "failed",
            graded_by="deterministic",
            message=explanation if ok else "Not what this question is after.",
        )

    return None  # rubric: the model grades it


def _normalize(text: str) -> str:
    return _WHITESPACE.sub(" ", text.strip()).casefold()


def grades_from_report(
    spec: NotebookSpec, report: ExecutionReport, attempt: GradedAttempt
) -> GradeReport:
    """Read grades back out of a run of `spec_with_graders(spec, attempt)`.

    `spec` is the AUTHORED spec — the one that still holds the checks and answer keys.
    """
    results = report.by_id()
    ids = grader_ids(spec)
    grades: list[CellGrade] = []

    for cell in spec.cells:
        if cell.check is not None:
            result = results.get(ids[cell.id])
            if result is None or result.status in {"not_run", "skipped"}:
                # The grader never ran — the reader stopped short, or the cell was
                # skipped. Neither is a wrong answer, and calling it one would mark a
                # reader down for a notebook they have not reached the end of.
                grades.append(
                    CellGrade(
                        id=cell.id,
                        status="unattempted",
                        graded_by="deterministic",
                        message="Not graded yet — this cell has not been run.",
                    )
                )
                continue
            if result.status == "ok":
                grades.append(CellGrade(id=cell.id, status="passed", graded_by="deterministic"))
                continue
            error = result.error
            grades.append(
                CellGrade(
                    id=cell.id,
                    status="failed",
                    graded_by="deterministic",
                    message="Not right yet.",
                    detail=f"{error.ename}: {error.evalue}" if error else "the check did not pass",
                )
            )
            continue

        if cell.answer is not None:
            grade = deterministic_grade(cell, attempt.answers.get(cell.id, ""))
            if grade is not None:
                grades.append(grade)
            else:
                # `rubric`, or an answer kind this build cannot decide. Reported as
                # ungradable rather than silently dropped, so a caller that has no
                # model wired up shows a gap instead of a shorter denominator.
                grades.append(
                    CellGrade(
                        id=cell.id,
                        status="ungradable",
                        graded_by="model",
                        message="This answer needs Nala to grade it.",
                    )
                )

    return GradeReport(notebook_slug=spec.slug, cells=grades)
