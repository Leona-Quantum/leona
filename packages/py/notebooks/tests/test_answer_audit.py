"""Every arm of the answer-key audit, and both directions of every arm.

A one-sided test here would be worse than none. `audit_answers` returning "unsound" for
everything passes any test that only ever feeds it a defective key, and it would strip
every question in the product while looking perfectly green — the same shape as a grader
that cannot fail, one level up. So each defect below is paired with the nearest SOUND key
that must survive it.
"""

from __future__ import annotations

import math

import pytest
from majorana_contracts.notebooks import Cell, CellRole, NotebookSpec

from leona_notebooks.answer_audit import audit_answers, demote_unsound_answers


def _spec(*cells: Cell) -> NotebookSpec:
    return NotebookSpec(slug="q", title="Questions", cells=list(cells))


def _question(cell_id: str, answer: dict, source: str = "What is the answer?") -> Cell:
    return Cell(id=cell_id, kind="markdown", role=CellRole.QUESTION, source=source, answer=answer)


def _verdict(cell: Cell) -> str:
    audit = audit_answers(_spec(cell))
    assert len(audit.verdicts) == 1
    return audit.verdicts[0].verdict


# --------------------------------------------------------------------------- choice


def test_a_choice_with_two_options_that_read_the_same_is_ambiguous() -> None:
    cell = _question(
        "dup",
        {"kind": "choice", "options": ["Hadamard", " hadamard ", "Pauli-X"], "correct": 0},
    )
    assert _verdict(cell) == "ambiguous"


def test_a_choice_with_distinct_options_is_sound() -> None:
    cell = _question(
        "ok", {"kind": "choice", "options": ["Hadamard", "Pauli-X", "CNOT"], "correct": 0}
    )
    assert _verdict(cell) == "sound"


def test_a_choice_whose_correct_option_is_blank_cannot_be_passed() -> None:
    cell = _question("blank", {"kind": "choice", "options": ["Hadamard", "   "], "correct": 1})
    assert _verdict(cell) == "cannot-pass"


# -------------------------------------------------------------------------- numeric


def test_a_numeric_tolerance_that_accepts_zero_cannot_fail() -> None:
    # The reader who types 0 without reading the question is graded correct.
    cell = _question("wide", {"kind": "numeric", "value": 0.5, "tolerance": 0.5})
    assert _verdict(cell) == "cannot-fail"


def test_a_numeric_tolerance_just_inside_the_value_is_sound() -> None:
    # One ULP the other side of the same boundary. If this and the case above do not
    # split, the check is not measuring the boundary it claims to.
    cell = _question("tight", {"kind": "numeric", "value": 0.5, "tolerance": 0.49})
    assert _verdict(cell) == "sound"


def test_a_numeric_answer_of_zero_is_not_treated_as_the_lazy_answer() -> None:
    # `value == 0` is a legitimate answer (a probability that vanishes, a commutator
    # that is zero). Excluding it from the zero-band rule is the reason for the
    # `value != 0` guard, and this is the test that would fail if it were removed.
    cell = _question("zero", {"kind": "numeric", "value": 0.0, "tolerance": 1e-9})
    assert _verdict(cell) == "sound"


def test_an_infinite_band_cannot_fail() -> None:
    cell = _question("inf", {"kind": "numeric", "value": 1.0, "tolerance": math.inf})
    assert _verdict(cell) == "cannot-fail"


# ----------------------------------------------------------------------------- text


def test_a_text_key_whose_answer_is_printed_in_the_question_cannot_fail() -> None:
    cell = _question(
        "leak",
        {"kind": "text", "accept": ["Hadamard"]},
        source="The Hadamard gate creates superposition. What is that gate called?",
    )
    assert _verdict(cell) == "cannot-fail"


def test_a_text_key_whose_answer_is_not_in_the_question_is_sound() -> None:
    cell = _question(
        "ok",
        {"kind": "text", "accept": ["Hadamard", "the Hadamard gate"]},
        source="Which single-qubit gate takes the ground state to an equal superposition?",
    )
    assert _verdict(cell) == "sound"


def test_a_short_accepted_answer_appearing_in_the_prose_does_not_trip_the_leak_check() -> None:
    # The source below really does contain "no" — inside "notation". Checked, because
    # the first version of this test used prose that happened not to contain it at all,
    # so it passed with the length floor set to 1 and proved nothing about the floor.
    # An assertion that cannot distinguish the two settings is not a test of either.
    source = "Does the notation above reveal the phase?"
    assert "no" in source.casefold()
    cell = _question("short", {"kind": "text", "accept": ["no"]}, source=source)
    assert _verdict(cell) == "sound"


def test_a_text_key_with_only_blank_spellings_cannot_be_passed() -> None:
    cell = _question("empty", {"kind": "text", "accept": ["   ", ""]})
    assert _verdict(cell) == "cannot-pass"


# --------------------------------------------------------------------------- rubric


def test_a_rubric_key_is_inconclusive_rather_than_sound() -> None:
    cell = _question("open", {"kind": "rubric", "rubric": "Mentions interference."})
    assert _verdict(cell) == "inconclusive"


def test_an_inconclusive_key_is_not_stripped() -> None:
    cell = _question("open", {"kind": "rubric", "rubric": "Mentions interference."})
    spec = _spec(cell)
    kept = demote_unsound_answers(spec, audit_answers(spec))
    assert kept.cells[0].answer is not None


# ------------------------------------------------------------------------ demotion


def test_demotion_strips_only_the_proven_key_and_keeps_the_question() -> None:
    bad = _question("bad", {"kind": "numeric", "value": 2.0, "tolerance": 5.0})
    good = _question("good", {"kind": "numeric", "value": 2.0, "tolerance": 0.1})
    spec = _spec(bad, good)
    demoted = demote_unsound_answers(spec, audit_answers(spec))
    assert demoted.cells[0].answer is None
    assert demoted.cells[1].answer is not None
    # The question itself survives — it is still prose the reader meets.
    assert demoted.cells[0].source == bad.source
    assert demoted.cells[0].role is CellRole.QUESTION


def test_demotion_returns_the_same_spec_when_nothing_is_unsound() -> None:
    spec = _spec(_question("good", {"kind": "numeric", "value": 2.0, "tolerance": 0.1}))
    assert demote_unsound_answers(spec, audit_answers(spec)) is spec


def test_a_notebook_with_no_questions_audits_to_nothing() -> None:
    spec = _spec(Cell(id="c1", kind="code", role=CellRole.RUN, source="print(1)"))
    assert audit_answers(spec).verdicts == []


def test_the_audit_reads_every_question_not_just_the_first() -> None:
    # A loop that returned on its first verdict would pass every test above.
    spec = _spec(
        _question("a", {"kind": "numeric", "value": 1.0, "tolerance": 0.01}),
        _question("b", {"kind": "numeric", "value": 1.0, "tolerance": 2.0}),
        _question("c", {"kind": "rubric", "rubric": "anything"}),
    )
    audit = audit_answers(spec)
    assert [v.verdict for v in audit.verdicts] == ["sound", "cannot-fail", "inconclusive"]


@pytest.mark.parametrize("verdict_kind", ["cannot-fail", "cannot-pass", "ambiguous"])
def test_every_unsound_verdict_carries_a_reason(verdict_kind: str) -> None:
    # A stripped question with no recorded reason is indistinguishable from one the
    # model never wrote a key for, which is what makes such a bug survive a review.
    cells = {
        "cannot-fail": _question("f", {"kind": "numeric", "value": 1.0, "tolerance": 2.0}),
        "cannot-pass": _question("p", {"kind": "text", "accept": [" "]}),
        "ambiguous": _question("a", {"kind": "choice", "options": ["x", "X"], "correct": 0}),
    }
    audit = audit_answers(_spec(cells[verdict_kind]))
    assert audit.verdicts[0].verdict == verdict_kind
    assert audit.verdicts[0].reason
