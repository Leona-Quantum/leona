"""Grading: the deterministic path, the redaction boundary, and the two-arm grader gate."""

from __future__ import annotations

import pytest
from majorana_contracts.notebooks import (
    Cell,
    CellRole,
    ChoiceAnswer,
    NotebookSpec,
    NumericAnswer,
    RubricAnswer,
    TextAnswer,
)
from leona_notebooks.grading import (
    CHECK_SUFFIX,
    GradedAttempt,
    check_cell_id,
    deterministic_grade,
    grades_from_report,
    spec_with_graders,
)
from leona_notebooks.local_runner import execute_in_local_sandbox


def _exercise_spec() -> NotebookSpec:
    return NotebookSpec(
        slug="grading",
        title="Grading",
        cells=[
            Cell(id="setup", kind="code", role=CellRole.SETUP, source="import math"),
            Cell(
                id="ex1",
                kind="code",
                role=CellRole.SOLUTION,
                source="def double(x):\n    return 2 * x",
                stub="def double(x):\n    ...",
                check="assert double(3) == 6, 'double(3) should be 6'",
            ),
        ],
    )


def _grade_code(spec: NotebookSpec, code: dict[str, str]):
    attempt = GradedAttempt(code=code, answers={})
    report = execute_in_local_sandbox(spec_with_graders(spec, attempt))
    return grades_from_report(spec, report, attempt).by_id()


# --------------------------------------------------------------------------- code cells


def test_a_correct_attempt_passes_and_a_wrong_one_reports_the_assertion():
    spec = _exercise_spec()
    assert _grade_code(spec, {"ex1": "def double(x):\n    return x * 2"})["ex1"].status == "passed"
    wrong = _grade_code(spec, {"ex1": "def double(x):\n    return x + 2"})["ex1"]
    assert wrong.status == "failed"
    assert "double(3) should be 6" in wrong.detail


def test_an_unattempted_exercise_is_graded_against_the_stub_not_the_solution():
    """The bug this test exists for: falling back to `source` grades the author's own
    answer, so every untouched exercise passes and a notebook is complete on open."""
    spec = _exercise_spec()
    assert _grade_code(spec, {})["ex1"].status == "failed"


def test_the_reader_source_replaces_the_authored_solution():
    spec = _exercise_spec()
    derived = spec_with_graders(spec, GradedAttempt(code={"ex1": "MINE"}, answers={}))
    assert derived.cell_by_id("ex1").source == "MINE"
    # the authored spec is never mutated
    assert "2 * x" in spec.cell_by_id("ex1").source


def test_a_check_cell_is_inserted_after_its_exercise_and_tagged_to_raise():
    spec = _exercise_spec()
    derived = spec_with_graders(spec, GradedAttempt(code={}, answers={}))
    ids = [c.id for c in derived.cells]
    gid = check_cell_id("ex1")
    assert ids.index(gid) == ids.index("ex1") + 1
    grader = derived.cell_by_id(gid)
    assert "raises-exception" in grader.tags, "a wrong answer must not make the RUN fail"


def test_check_cell_ids_stay_valid_and_unique_for_long_ids():
    long_id = "a" * 32
    gid = check_cell_id(long_id)
    assert len(gid) <= 32 and gid.endswith(CHECK_SUFFIX)
    Cell(id=gid, kind="code", source="")  # would raise if the shape were invalid
    assert check_cell_id(long_id, {gid}) != gid


# --------------------------------------------------------------------------- questions


@pytest.mark.parametrize(
    ("response", "status"),
    [("0", "passed"), ("1", "failed"), ("", "unattempted"), ("nope", "failed"), ("9", "failed")],
)
def test_choice_questions_grade_without_a_model(response: str, status: str):
    cell = Cell(
        id="q",
        kind="markdown",
        role=CellRole.QUESTION,
        source="Which?",
        answer=ChoiceAnswer(options=["H", "X"], correct=0),
    )
    grade = deterministic_grade(cell, response)
    assert grade is not None and grade.status == status
    assert grade.graded_by == "deterministic"


@pytest.mark.parametrize(
    ("response", "status"),
    [
        ("1.0", "passed"),
        ("1.05", "passed"),
        ("1.2", "failed"),
        ("1.0 rad", "passed"),
        ("x", "failed"),
    ],
)
def test_numeric_questions_use_an_absolute_tolerance(response: str, status: str):
    cell = Cell(
        id="q",
        kind="markdown",
        role=CellRole.QUESTION,
        source="How much?",
        answer=NumericAnswer(value=1.0, tolerance=0.1, unit="rad"),
    )
    grade = deterministic_grade(cell, response)
    assert grade is not None and grade.status == status


def test_a_numeric_answer_defaults_to_exact_so_an_author_is_not_silently_generous():
    cell = Cell(
        id="q",
        kind="markdown",
        role=CellRole.QUESTION,
        source="?",
        answer=NumericAnswer(value=2.0),
    )
    assert deterministic_grade(cell, "2.0").status == "passed"
    assert deterministic_grade(cell, "2.0001").status == "failed"


def test_text_answers_ignore_case_and_collapsed_whitespace():
    cell = Cell(
        id="q",
        kind="markdown",
        role=CellRole.QUESTION,
        source="?",
        answer=TextAnswer(accept=["Hadamard gate"]),
    )
    assert deterministic_grade(cell, "  hadamard   GATE ").status == "passed"
    assert deterministic_grade(cell, "phase gate").status == "failed"


def test_a_rubric_answer_is_not_decided_here():
    cell = Cell(
        id="q",
        kind="markdown",
        role=CellRole.QUESTION,
        source="Explain.",
        answer=RubricAnswer(rubric="mentions interference"),
    )
    assert deterministic_grade(cell, "anything") is None


def test_a_rubric_cell_is_reported_ungradable_rather_than_dropped():
    spec = NotebookSpec(
        slug="r",
        title="R",
        cells=[
            Cell(
                id="q",
                kind="markdown",
                role=CellRole.QUESTION,
                source="Explain.",
                answer=RubricAnswer(rubric="mentions interference"),
            )
        ],
    )
    attempt = GradedAttempt(code={}, answers={"q": "because of interference"})
    report = execute_in_local_sandbox(spec_with_graders(spec, attempt))
    grade = grades_from_report(spec, report, attempt).by_id()["q"]
    assert grade.status == "ungradable" and grade.graded_by == "model"


# --------------------------------------------------------------------------- the contract


def test_a_check_requires_a_stub():
    with pytest.raises(ValueError, match="needs a stub"):
        Cell(id="x", kind="code", source="a = 1", check="assert a == 1")


def test_an_answer_key_only_lives_on_a_question_cell():
    with pytest.raises(ValueError, match="role=question"):
        Cell(
            id="x",
            kind="markdown",
            role=CellRole.CONCEPT,
            source="",
            answer=ChoiceAnswer(options=["a", "b"], correct=0),
        )


def test_a_choice_key_cannot_point_outside_its_options():
    with pytest.raises(ValueError, match="outside"):
        ChoiceAnswer(options=["a", "b"], correct=2)


def test_the_learner_build_carries_no_answer_and_no_grader():
    spec = NotebookSpec(
        slug="s",
        title="S",
        cells=[
            Cell(
                id="q",
                kind="markdown",
                role=CellRole.QUESTION,
                source="Which?",
                answer=ChoiceAnswer(options=["H", "X"], correct=1, explanation="because"),
            ),
            Cell(
                id="ex",
                kind="code",
                role=CellRole.SOLUTION,
                source="x = 1",
                stub="x = ...",
                check="assert x == 1",
            ),
        ],
    )
    learner = spec.for_learner()
    assert learner.leaks_answer_key() == []
    q = learner.cell_by_id("q")
    assert q.answer is None
    assert q.answer_prompt is not None and q.answer_prompt.options == ["H", "X"]
    assert learner.cell_by_id("ex").check is None
    assert learner.cell_by_id("ex").source == "x = ..."
    # serialised, nothing in the payload names the right answer
    assert "because" not in learner.model_dump_json()
    assert spec.cell_by_id("q").answer is not None, "the authored spec must not be mutated"


def test_the_leak_detector_goes_red_on_an_unredacted_spec():
    """Mutation arm: a detector that only ever returns [] proves nothing."""
    spec = NotebookSpec(
        slug="s",
        title="S",
        cells=[
            Cell(
                id="q",
                kind="markdown",
                role=CellRole.QUESTION,
                source="?",
                answer=ChoiceAnswer(options=["a", "b"], correct=0),
            )
        ],
    )
    assert spec.leaks_answer_key() == ["q"]
