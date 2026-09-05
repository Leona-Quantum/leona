"""Proving a generated notebook's graders can actually fail, before a reader meets one.

`scripts/check_graders.py` holds committed fixtures to this standard. Nothing held a
GENERATED notebook to it, and every graded exercise a reader gets is written by the
model at request time — so the gate covered the specs nobody reads and skipped the ones
everybody does. Owner ruling ai-ops#258 (2026-09-05) closed that: *"Add the grader
check — protects learners."*

## What is being proved

A grader is a hidden assertion run in the reader's namespace. Two ways it is worthless,
and only one of them is ever reported by anybody:

* it **passes on the blank exercise** — the reader is marked correct before attempting
  it, and the notebook says it is complete on open. Nobody reports this, because being
  told you are right is not a complaint. Every grading defect found in this codebase so
  far has erred in exactly this direction.
* it **fails on the author's own solution** — the exercise cannot be completed, and
  every reader is told they are wrong for writing the intended answer. This one does get
  reported, by the reader, after they have wasted the time.

So each grader is judged from two runs of the whole notebook: one with every exercise
left blank, one with every exercise filled in from the author's own source.

## Two runs, not two per exercise

`spec_with_graders` inserts every grader in one derived spec and each grader is tagged
`raises-exception`, so one execution exercises all of them at once and a failing grader
does not stop the run. The cost is therefore **two sandbox executions per notebook**,
flat, whatever the exercise count — which is the price the ruling was given. A notebook
with no graded code cell costs nothing: `audit_graders` runs nothing at all.

## `unattempted` is not `failed`, and that distinction is the whole instrument

If the run stops early — a stub that raises, a sandbox timeout — the graders below the
stopping point never execute. `grades_from_report` reports those as `unattempted`, which
is NOT `passed`, so a naive "did it fail?" test would read them as sound and report a
clean audit over graders it never exercised. That is the same shape as the empty-directory
bug `check_graders.py` was itself written to fix, so it is spelled out here rather than
left to the reader: a grader that did not run is `INCONCLUSIVE`, never `SOUND`, and the
audit says how many it could not see.

Only a PROVEN defect is acted on. `demote_unsound_graders` strips `check` from a cell
whose grader was seen passing on the blank or failing on the answer, and leaves the
inconclusive ones alone — demoting on suspicion would quietly delete good graders every
time a notebook happened to stop early.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from majorana_contracts.notebooks import Cell, ExecutionReport, NotebookSpec

from leona_notebooks.grading import GradedAttempt, grades_from_report, spec_with_graders

__all__ = [
    "GraderAudit",
    "GraderVerdict",
    "Verdict",
    "audit_graders",
    "demote_unsound_graders",
    "verdicts_from_grades",
]

Verdict = Literal["sound", "cannot-fail", "cannot-pass", "inconclusive"]

#: A run of the notebook. The pipeline passes `ports.run_notebook`, so the audit goes
#: down the one execution route that is already sandboxed, budgeted and timed out.
RunNotebook = Callable[[NotebookSpec], Awaitable[ExecutionReport]]


@dataclass(frozen=True)
class GraderVerdict:
    """What the two runs showed about one cell's grader."""

    cell_id: str
    #: The grade the reader would have been given with the exercise left blank.
    on_blank: str
    #: ...and with the author's own solution in the cell.
    on_answer: str
    verdict: Verdict

    @property
    def unsound(self) -> bool:
        """Proven worthless. `inconclusive` is deliberately excluded — see the module
        docstring: not seeing a grader work is not the same as seeing it fail."""
        return self.verdict in ("cannot-fail", "cannot-pass")

    def describe(self) -> str:
        if self.verdict == "cannot-fail":
            return (
                f"{self.cell_id}: the check PASSES with the exercise blank — a reader is "
                f"marked correct before attempting it"
            )
        if self.verdict == "cannot-pass":
            return (
                f"{self.cell_id}: the check does not pass against the cell's own solution "
                f"(got {self.on_answer!r}) — the exercise cannot be completed"
            )
        if self.verdict == "inconclusive":
            return (
                f"{self.cell_id}: the grader never ran (blank={self.on_blank!r}, "
                f"answer={self.on_answer!r}) — the run stopped before it, so nothing about "
                f"it was proved either way"
            )
        return f"{self.cell_id}: sound (fails blank, passes the answer)"


@dataclass(frozen=True)
class GraderAudit:
    verdicts: list[GraderVerdict]
    #: Sandbox executions actually spent. 0 when the notebook has no graded code cell.
    runs: int

    @property
    def unsound(self) -> list[GraderVerdict]:
        return [v for v in self.verdicts if v.unsound]

    @property
    def inconclusive(self) -> list[GraderVerdict]:
        return [v for v in self.verdicts if v.verdict == "inconclusive"]

    @property
    def ok(self) -> bool:
        """No PROVEN defect. An inconclusive grader is not a defect, and is reported
        separately rather than folded into a boolean that cannot carry it."""
        return not self.unsound

    def summary(self) -> str:
        if not self.verdicts:
            return "no graded code cells"
        sound = sum(1 for v in self.verdicts if v.verdict == "sound")
        parts = [f"{sound}/{len(self.verdicts)} graders sound"]
        if self.unsound:
            parts.append(f"{len(self.unsound)} unsound")
        if self.inconclusive:
            parts.append(f"{len(self.inconclusive)} never ran")
        return ", ".join(parts)


def _graded_cells(spec: NotebookSpec) -> list[Cell]:
    return [cell for cell in spec.cells if cell.check is not None]


def verdicts_from_grades(
    spec: NotebookSpec, blank: dict[str, str], answered: dict[str, str]
) -> list[GraderVerdict]:
    """Judge each grader from its two grade statuses. Pure — the runs happen elsewhere,
    which is what lets the table of cases be tested without a sandbox."""
    out: list[GraderVerdict] = []
    for cell in _graded_cells(spec):
        on_blank = blank.get(cell.id, "unattempted")
        on_answer = answered.get(cell.id, "unattempted")
        verdict: Verdict
        if on_blank == "passed":
            # Checked FIRST and unconditionally: a grader that passes on the blank is
            # worthless whatever the other arm did, and this is the direction that
            # silently harms a learner rather than annoying them.
            verdict = "cannot-fail"
        elif on_blank == "unattempted" or on_answer == "unattempted":
            verdict = "inconclusive"
        elif on_answer != "passed":
            verdict = "cannot-pass"
        else:
            verdict = "sound"
        out.append(
            GraderVerdict(cell_id=cell.id, on_blank=on_blank, on_answer=on_answer, verdict=verdict)
        )
    return out


async def audit_graders(spec: NotebookSpec, run: RunNotebook) -> GraderAudit:
    """Run the notebook blank and answered, and judge every grader from the two.

    Exactly two executions when the notebook has a graded code cell, and none when it
    does not.
    """
    graded = _graded_cells(spec)
    if not graded:
        return GraderAudit(verdicts=[], runs=0)

    # Blank: `spec_with_graders` substitutes each graded cell's own stub when the
    # attempt supplies no code, which is precisely the state a reader opens in.
    blank_attempt = GradedAttempt(code={}, answers={})
    blank_report = await run(spec_with_graders(spec, blank_attempt))
    blank = {g.id: g.status for g in grades_from_report(spec, blank_report, blank_attempt).cells}

    answer_attempt = GradedAttempt(code={c.id: c.source for c in graded}, answers={})
    answer_report = await run(spec_with_graders(spec, answer_attempt))
    answered = {
        g.id: g.status for g in grades_from_report(spec, answer_report, answer_attempt).cells
    }

    return GraderAudit(verdicts=verdicts_from_grades(spec, blank, answered), runs=2)


def demote_unsound_graders(spec: NotebookSpec, audit: GraderAudit) -> NotebookSpec:
    """Strip `check` from every cell whose grader was PROVEN worthless.

    The exercise stays — the reader still writes the code, and still has the author's
    solution to compare against. What goes is the automatic verdict, because a wrong
    verdict is worse than none: "you got it right" when they did not is the failure this
    whole path exists to prevent, and it is unfalsifiable from the reader's side.

    Inconclusive graders are left in place. See the module docstring.
    """
    unsound = {v.cell_id for v in audit.unsound}
    if not unsound:
        return spec
    cells = [
        cell.model_copy(update={"check": None}) if cell.id in unsound else cell
        for cell in spec.cells
    ]
    return spec.model_copy(update={"cells": cells})
