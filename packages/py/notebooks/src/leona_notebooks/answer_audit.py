"""Proving a generated question's answer key can tell right from wrong, before a reader meets it.

The companion to `grader_audit`, for the other half of a graded notebook. Owner ruling
ai-ops#258 says a grader is checked before a learner meets it; a `role=question` cell's
answer key decides a verdict the same way a hidden assertion does, and until now nothing
checked one at all.

## Why this one is static and the grader audit is not

A grader is arbitrary Python: the only way to learn whether it can fail is to run it.
An answer key is *data* — a correct index, a value and a tolerance, a list of accepted
spellings — so every way it can be worthless is decidable by reading it. That matters
for more than tidiness: it costs **zero sandbox runs**, so this audit is affordable on
every generated notebook, including ones with no code in them at all.

## What is being proved

The same two failure directions the grader audit names, in the shapes an answer key
takes them:

* **cannot-fail** — the key marks a reader correct without their knowing anything.
  A numeric tolerance wide enough that answering `0` passes. An accepted spelling
  printed in the question's own visible text, three lines above the input box.
* **cannot-pass** — nobody can ever be right. Every accepted spelling is blank, so the
  only response that matches is one `deterministic_grade` reports as `unattempted`.
* **ambiguous** — `choice` with two options that read the same after normalisation. This
  one is neither of the above and is why the verdict set is not just two: a reader who
  knows the answer perfectly well picks the duplicate at the other index and is told they
  are wrong. It harms exactly the readers who are paying attention.

A `rubric` key is graded by the model, so nothing here can judge it and it is reported
`inconclusive` rather than sound — the same rule the grader audit applies to a grader it
could not see run. Reporting it sound would be an instrument claiming a reading it never
took.

## Only a proven defect is acted on

`demote_unsound_answers` strips `answer` from a cell whose key was proved worthless, and
the question survives as prose the reader can still think about. It leaves `inconclusive`
alone. Same reasoning as `demote_unsound_graders`: demoting on suspicion deletes good
questions, and the cost of a false strip is the question's feedback while the cost of a
false pass is a reader told they are right when they are not.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from majorana_contracts.notebooks import Cell, NotebookSpec

# The grader's OWN normalisation, imported rather than re-implemented. An audit that
# folded whitespace or case differently from `deterministic_grade` would clear keys the
# grader then rejects, and neither side would look wrong on its own — the divergence is
# only visible from a reader being marked down for the spelling the audit approved.
from leona_notebooks.grading import normalize_response

__all__ = [
    "AnswerAudit",
    "AnswerVerdict",
    "audit_answers",
    "demote_unsound_answers",
]

AnswerVerdictKind = Literal["sound", "cannot-fail", "cannot-pass", "ambiguous", "inconclusive"]

#: Below this length an accepted spelling is not evidence of a leak. "2", "H" and "no"
#: occur in ordinary prose constantly, and tripping on them would strip good questions
#: far more often than it caught a real giveaway — the false-strip direction this module
#: exists to stay out of.
_LEAK_MIN_LENGTH = 4


@dataclass(frozen=True)
class AnswerVerdict:
    """What reading one cell's answer key showed."""

    cell_id: str
    kind: str
    verdict: AnswerVerdictKind
    #: Reader-free explanation of the defect, for the audit event. Empty when sound.
    reason: str = ""

    @property
    def unsound(self) -> bool:
        return self.verdict in {"cannot-fail", "cannot-pass", "ambiguous"}

    def describe(self) -> str:
        """One line for the run's event stream. Says what the reader would have got."""
        if self.verdict == "sound":
            return f"{self.cell_id}: the {self.kind} key can tell right from wrong"
        if self.verdict == "inconclusive":
            return f"{self.cell_id}: {self.reason}"
        return f"{self.cell_id} ({self.verdict}): {self.reason}"


@dataclass(frozen=True)
class AnswerAudit:
    verdicts: list[AnswerVerdict]

    @property
    def unsound(self) -> list[AnswerVerdict]:
        return [v for v in self.verdicts if v.unsound]

    @property
    def inconclusive(self) -> list[AnswerVerdict]:
        return [v for v in self.verdicts if v.verdict == "inconclusive"]

    @property
    def sound(self) -> list[AnswerVerdict]:
        return [v for v in self.verdicts if v.verdict == "sound"]

    @property
    def ok(self) -> bool:
        """No PROVEN defect. An inconclusive key is not a defect — same rule, and same
        reason, as `GraderAudit.ok`: folding it into the boolean would report a rubric
        question as broken for being open-ended."""
        return not self.unsound

    def summary(self) -> str:
        if not self.verdicts:
            return "no question cells"
        parts = [f"{len(self.sound)}/{len(self.verdicts)} answer keys sound"]
        if self.unsound:
            parts.append(f"{len(self.unsound)} unsound")
        if self.inconclusive:
            parts.append(f"{len(self.inconclusive)} graded by the model")
        return ", ".join(parts)


def _judge_choice(cell: Cell, key) -> AnswerVerdict:  # noqa: ANN001 - discriminated union member
    seen: dict[str, int] = {}
    for index, option in enumerate(key.options):
        normalized = normalize_response(option)
        if normalized in seen:
            return AnswerVerdict(
                cell_id=cell.id,
                kind="choice",
                verdict="ambiguous",
                reason=(
                    f"options {seen[normalized]} and {index} read the same "
                    f"({option!r}), so one right answer is graded wrong"
                ),
            )
        seen[normalized] = index
    if not normalize_response(key.options[key.correct]):
        return AnswerVerdict(
            cell_id=cell.id,
            kind="choice",
            verdict="cannot-pass",
            reason=f"the correct option ({key.correct}) is blank",
        )
    return AnswerVerdict(cell_id=cell.id, kind="choice", verdict="sound")


def _judge_numeric(cell: Cell, key) -> AnswerVerdict:  # noqa: ANN001
    if not math.isfinite(key.value) or not math.isfinite(key.tolerance):
        return AnswerVerdict(
            cell_id=cell.id,
            kind="numeric",
            verdict="cannot-fail",
            reason=f"value {key.value} ± {key.tolerance} is not a finite band",
        )
    # `0` is what a reader types when they have not worked it out, and it is the one
    # answer available without reading the question. A band that contains it accepts
    # ignorance, so the key cannot fail in the direction that matters.
    if key.value != 0.0 and key.tolerance >= abs(key.value):
        return AnswerVerdict(
            cell_id=cell.id,
            kind="numeric",
            verdict="cannot-fail",
            reason=(
                f"tolerance {key.tolerance:g} is at least |{key.value:g}|, "
                "so answering 0 is graded correct"
            ),
        )
    return AnswerVerdict(cell_id=cell.id, kind="numeric", verdict="sound")


def _judge_text(cell: Cell, key) -> AnswerVerdict:  # noqa: ANN001
    accepted = [normalize_response(candidate) for candidate in key.accept]
    if not any(accepted):
        return AnswerVerdict(
            cell_id=cell.id,
            kind="text",
            verdict="cannot-pass",
            reason=(
                "every accepted spelling is blank, and a blank response is graded "
                "unattempted, so nothing a reader can type is correct"
            ),
        )
    # The accept list is the one part of a `text` key the reader never receives — it is
    # dropped by `for_learner`, which is why `text` can be graded at all. If the question
    # prints an accepted spelling in its own visible source, that redaction bought
    # nothing: the answer is above the input box.
    visible = normalize_response(cell.source)
    for candidate, normalized in zip(key.accept, accepted, strict=True):
        if len(normalized) >= _LEAK_MIN_LENGTH and normalized in visible:
            return AnswerVerdict(
                cell_id=cell.id,
                kind="text",
                verdict="cannot-fail",
                reason=(
                    f"the accepted answer {candidate!r} is printed in the question's "
                    "own text, where the reader can read it"
                ),
            )
    return AnswerVerdict(cell_id=cell.id, kind="text", verdict="sound")


def audit_answers(spec: NotebookSpec) -> AnswerAudit:
    """Judge every answer key in `spec`. Runs nothing; reads only the spec."""
    verdicts: list[AnswerVerdict] = []
    for cell in spec.cells:
        key = cell.answer
        if key is None:
            continue
        if key.kind == "choice":
            verdicts.append(_judge_choice(cell, key))
        elif key.kind == "numeric":
            verdicts.append(_judge_numeric(cell, key))
        elif key.kind == "text":
            verdicts.append(_judge_text(cell, key))
        else:
            # `rubric`. The model decides it, so nothing readable here settles whether it
            # can fail. Not sound — see the module docstring on instruments that report a
            # reading they did not take.
            verdicts.append(
                AnswerVerdict(
                    cell_id=cell.id,
                    kind=key.kind,
                    verdict="inconclusive",
                    reason="graded by the model; no static reading decides it",
                )
            )
    return AnswerAudit(verdicts=verdicts)


def demote_unsound_answers(spec: NotebookSpec, audit: AnswerAudit) -> NotebookSpec:
    """Strip `answer` from every cell whose key was PROVEN worthless.

    The question stays and the reader still meets it; what goes is the automatic
    verdict. Inconclusive keys are left in place.
    """
    unsound = {v.cell_id for v in audit.unsound}
    if not unsound:
        return spec
    cells = [
        cell.model_copy(update={"answer": None}) if cell.id in unsound else cell
        for cell in spec.cells
    ]
    return spec.model_copy(update={"cells": cells})
