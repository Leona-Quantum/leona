"""Every arm of the answer-key audit, and both directions of every arm.

A one-sided test here would be worse than none. `audit_answers` returning "unsound" for
everything passes any test that only ever feeds it a defective key, and it would strip
every question in the product while looking perfectly green — the same shape as a grader
that cannot fail, one level up. So each defect below is paired with the nearest SOUND key
that must survive it.
"""

from __future__ import annotations

import math
from collections import Counter

import pytest
from majorana_contracts.notebooks import Cell, CellRole, NotebookSpec

from leona_notebooks.answer_audit import (
    GUESSABLE_MAX_SHARE,
    GUESSABLE_MIN_QUESTIONS,
    audit_answers,
    demote_unsound_answers,
    guessability,
)


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


def test_an_accepted_answer_inside_a_longer_word_is_not_a_leak() -> None:
    # "gate" occurs in "gateway" and a reader cannot read the answer out of it. A plain
    # substring test strips this perfectly good key. Greptile, PR 833 — and it is the
    # same false-strip direction the length floor above exists for, which is why the
    # floor alone was not enough.
    source = "Does the gateway protocol change which operation is applied?"
    assert "gate" in source.casefold()
    cell = _question("word", {"kind": "text", "accept": ["gate"]}, source=source)
    assert _verdict(cell) == "sound"


def test_an_accepted_answer_standing_as_its_own_word_is_still_a_leak() -> None:
    # The control for the test above. Without it, matching nothing at all would pass.
    cell = _question(
        "leaky",
        {"kind": "text", "accept": ["gate"]},
        source="The gate above is the one being asked about. What is it?",
    )
    assert _verdict(cell) == "cannot-fail"


def test_a_leak_is_caught_next_to_punctuation_not_only_next_to_spaces() -> None:
    # Word boundaries, not space-delimited splitting: "Hadamard." and "(Hadamard)" are
    # both the answer printed in the question.
    for source in [
        "The answer is Hadamard. Which gate was that?",
        "Consider (Hadamard) — which gate is being described?",
    ]:
        cell = _question("p", {"kind": "text", "accept": ["Hadamard"]}, source=source)
        assert _verdict(cell) == "cannot-fail", source


def test_a_multi_word_accepted_answer_is_matched_as_a_whole_phrase() -> None:
    cell = _question(
        "phrase",
        {"kind": "text", "accept": ["the Hadamard gate"]},
        source="We used the Hadamard gate above. Name it.",
    )
    assert _verdict(cell) == "cannot-fail"


def test_an_answer_that_is_not_a_word_is_still_caught_when_printed() -> None:
    # This is what separates the lookaround form from `\b`, and without it the helper's
    # docstring reason for choosing one is an untested claim: `\b` needs a word character
    # on the inside of the boundary, so `\b\\ket{0}\b` does not match `\ket{0}` sitting
    # between spaces, and the leak goes unreported. Dirac notation is an ordinary answer
    # in this product, so the difference is not academic.
    #
    # `\ket{0}` and not `|0>`: the latter is three characters and never reaches the
    # matcher at all, because `_LEAK_MIN_LENGTH` stops it first. That is a real gap — a
    # short answer made of punctuation is not leak-checked — and it is left open
    # deliberately, because the alternative (exempting punctuation from the floor) would
    # strip a key accepting "+" from any question containing "1 + 1". The heuristic's
    # stated bias is toward under-stripping; this is one of the places it pays for that.
    #
    # Both directions, because a matcher that always fires would pass the first alone.
    leaked = _question(
        "ket",
        {"kind": "text", "accept": ["\\ket{0}"]},
        source="After the reset the register holds \\ket{0} — write that state.",
    )
    assert _verdict(leaked) == "cannot-fail"
    clean = _question(
        "ket-ok",
        {"kind": "text", "accept": ["\\ket{0}"]},
        source="What state does the register hold after a reset?",
    )
    assert _verdict(clean) == "sound"


def test_a_punctuation_answer_printed_against_a_word_is_still_a_leak() -> None:
    # `\ket{0}s` — the answer on the page with a plural `s` run onto it. An unconditional
    # `(?!\w)` asks whether a word character follows `}`, which is not a boundary
    # question, and answering it calls this key sound while the answer sits in the
    # question. Greptile, PR 833, immediately after the `gateway` fix introduced it.
    cell = _question(
        "plural",
        {"kind": "text", "accept": ["\\ket{0}"]},
        source="The register holds two \\ket{0}s. Write that state.",
    )
    assert _verdict(cell) == "cannot-fail"


def test_the_boundary_guard_applies_per_side_not_to_the_whole_needle() -> None:
    # An answer that is a word at one end and punctuation at the other. The left side
    # must be guarded (so `xket{0}` is not a match) and the right must not (so a `}`
    # followed by a letter still is). A single rule for both sides gets one of these
    # wrong whichever way it is set, which is exactly how the two Greptile findings
    # arrived one after the other.
    mixed = {"kind": "text", "accept": ["ket{0}"]}
    assert _verdict(_question("a", mixed, source="It holds ket{0}s now. Which state?")) == (
        "cannot-fail"
    )
    assert _verdict(_question("b", mixed, source="It holds bracket{0} now. Which state?")) == (
        "sound"
    )


# ------------------------------------------------------- guessability, a SET property
#
# Invisible to every test above. Each key in the certification mock exam was individually
# sound — four distinct options, a real correct answer — and 21 of its 25 answers were
# option B, so answering B throughout scored 84% against a pass mark near 70%. A per-cell
# audit cannot see that by construction, which is the whole reason this measure exists.


def _quiz(positions: list[int]) -> NotebookSpec:
    return _spec(
        *[
            _question(
                f"q{i}",
                {"kind": "choice", "options": ["w", "x", "y", "z"], "correct": c},
                source=f"Question {i}?",
            )
            for i, c in enumerate(positions)
        ]
    )


def test_a_quiz_answerable_by_one_repeated_option_is_measured_as_such() -> None:
    index, hits, share = guessability(_quiz([1] * 12 + [0, 2, 3, 0]))
    assert (index, hits) == (1, 12)
    assert share == 0.75


def test_an_evenly_spread_quiz_measures_at_the_chance_floor() -> None:
    index, hits, share = guessability(_quiz([0, 1, 2, 3] * 4))
    assert hits == 4
    assert share == 0.25
    assert share <= GUESSABLE_MAX_SHARE


def test_too_few_questions_to_say_anything_returns_None() -> None:
    # `None`, not a share of 1.0. Four questions that happen to share a position are
    # ordinary luck, and reporting them as a defect would strip the measure of any
    # authority by the third false alarm.
    assert guessability(_quiz([1, 1, 1, 1])) is None
    assert guessability(_quiz([1] * (GUESSABLE_MIN_QUESTIONS - 1))) is None
    assert guessability(_quiz([1] * GUESSABLE_MIN_QUESTIONS)) is not None


def test_only_choice_questions_count_toward_guessability() -> None:
    # A numeric or rubric answer has no position to guess, so mixing them in would
    # dilute the share and let a guessable set of choices hide inside a long notebook.
    mixed = _spec(
        *[
            _question(f"c{i}", {"kind": "choice", "options": ["w", "x", "y", "z"], "correct": 1})
            for i in range(GUESSABLE_MIN_QUESTIONS)
        ],
        *[
            _question(f"n{i}", {"kind": "numeric", "value": float(i + 1), "tolerance": 0.1})
            for i in range(20)
        ],
    )
    index, hits, share = guessability(mixed)
    assert (index, hits, share) == (1, GUESSABLE_MIN_QUESTIONS, 1.0)


def test_guessability_thresholds_are_the_measured_ones() -> None:
    """The two constants are simulation results, so the simulation is the test.

    Without this, `GUESSABLE_MIN_QUESTIONS` and `GUESSABLE_MAX_SHARE` are two numbers a
    later edit can move to whatever makes a failing build pass, and the docstring claiming
    they were measured stays there looking authoritative. Rerunning the simulation costs
    milliseconds and it is the only thing that keeps the claim true.
    """
    import random

    def false_positive_rate(n: int, threshold: float, trials: int = 20_000) -> float:
        rng = random.Random(20260905)
        over = 0
        for _ in range(trials):
            counts = Counter(rng.randrange(4) for _ in range(n))
            if max(counts.values()) / n > threshold:
                over += 1
        return over / trials

    # The claim in the constants' comments: at the minimum size, a well-shuffled quiz
    # trips the threshold rarely, and the rate falls as the quiz grows.
    at_minimum = false_positive_rate(GUESSABLE_MIN_QUESTIONS, GUESSABLE_MAX_SHARE)
    assert at_minimum < 0.08, at_minimum
    assert false_positive_rate(32, GUESSABLE_MAX_SHARE) < at_minimum

    # And the reason the threshold is not 0.40, which reads like the obvious choice: at
    # small sizes it fires on well-shuffled quizzes more often than not.
    assert false_positive_rate(8, 0.40) > 0.30

    # THE OTHER DIRECTION, and without it this test is one-sided: a low false-positive
    # rate is also what a threshold of 0.99 has, and that threshold catches nothing.
    # Loosening the constant to 0.90 passed every assertion above — the rate at n=12 is
    # 5e-05 rather than 0, so even the strict comparison held. What a threshold must also
    # be is tight enough to catch the defects actually observed, so those are the test:
    # the two certification quizzes as they stood, at 19 of 32 and 21 of 25.
    for hits, total in [(19, 32), (21, 25)]:
        spread = [1] * hits + [(i % 3) for i in range(total - hits)]
        assert len(spread) == total
        measured = guessability(_quiz(spread))
        assert measured is not None
        assert measured[2] > GUESSABLE_MAX_SHARE, (
            f"{hits}/{total} = {measured[2]:.0%} does not trip a threshold of "
            f"{GUESSABLE_MAX_SHARE:.0%} — the shipped defect would pass"
        )
