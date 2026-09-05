"""The generated-notebook grader audit: both arms, and both arms going red.

Every test here that asserts the audit CATCHES something has a sibling asserting it
ACCEPTS the honest case, because a checker that rejects everything passes the first kind
of test perfectly. The end-to-end tests run through the real local sandbox, so what is
being measured is the grade a reader would actually be given.
"""

from __future__ import annotations

import asyncio

import pytest
from majorana_contracts.notebooks import Cell, CellRole, NotebookSpec

from leona_notebooks.grader_audit import (
    audit_graders,
    demote_unsound_graders,
    verdicts_from_grades,
)
from leona_notebooks.local_runner import execute_in_local_sandbox


def _spec(check: str, *, source: str = "def double(x):\n    return 2 * x") -> NotebookSpec:
    return NotebookSpec(
        slug="audit",
        title="Audit",
        cells=[
            Cell(id="setup", kind="code", role=CellRole.SETUP, source="import math"),
            Cell(
                id="ex1",
                kind="code",
                role=CellRole.SOLUTION,
                source=source,
                stub="def double(x):\n    ...",
                check=check,
            ),
        ],
    )


async def _run(spec: NotebookSpec):
    # `execute_in_local_sandbox` drives its own event loop, so it runs on a thread —
    # the same shape the worker's port has, where the sandbox call is not this loop's.
    return await asyncio.to_thread(execute_in_local_sandbox, spec)


async def _audit(spec: NotebookSpec):
    return await audit_graders(spec, _run)


# --- the pure verdict table, exhaustively -----------------------------------------


@pytest.mark.parametrize(
    ("blank", "answer", "expected"),
    [
        ("failed", "passed", "sound"),
        ("passed", "passed", "cannot-fail"),
        # A grader that passes blank is worthless even if it also fails the answer:
        # the blank arm is checked first and unconditionally, because being marked
        # correct is the defect a reader never reports.
        ("passed", "failed", "cannot-fail"),
        ("failed", "failed", "cannot-pass"),
        ("failed", "ungradable", "cannot-pass"),
        ("unattempted", "passed", "inconclusive"),
        ("failed", "unattempted", "inconclusive"),
        ("unattempted", "unattempted", "inconclusive"),
    ],
)
def test_verdict_table(blank: str, answer: str, expected: str) -> None:
    spec = _spec("assert double(3) == 6")
    [verdict] = verdicts_from_grades(spec, {"ex1": blank}, {"ex1": answer})
    assert verdict.verdict == expected


def test_a_grader_that_never_ran_is_not_reported_sound() -> None:
    """The instrument's own blind spot, asserted rather than trusted.

    `unattempted` is not `passed`, so a naive "did the blank arm fail?" test reads a
    grader that never executed as sound. That would report a clean audit over graders
    nothing exercised — the same shape as the empty-directory bug in check_graders.py.
    """
    spec = _spec("assert double(3) == 6")
    [verdict] = verdicts_from_grades(spec, {}, {})
    assert verdict.verdict == "inconclusive"
    assert not verdict.unsound  # inconclusive is never acted on
    assert "never ran" in verdict.describe()


# --- end to end, through the real sandbox -----------------------------------------


async def test_an_honest_grader_is_sound_and_costs_two_runs() -> None:
    audit = await _audit(_spec("assert double(3) == 6"))
    assert [v.verdict for v in audit.verdicts] == ["sound"]
    assert audit.ok
    assert audit.runs == 2


async def test_a_grader_that_passes_on_the_blank_is_caught() -> None:
    # `...` makes double return None; `callable` is true of the stub too.
    audit = await _audit(_spec("assert callable(double)"))
    assert [v.verdict for v in audit.verdicts] == ["cannot-fail"]
    assert not audit.ok
    assert "marked correct before attempting it" in audit.unsound[0].describe()


async def test_a_grader_its_own_solution_cannot_pass_is_caught() -> None:
    audit = await _audit(_spec("assert double(3) == 99"))
    assert [v.verdict for v in audit.verdicts] == ["cannot-pass"]
    assert not audit.ok
    assert "cannot be completed" in audit.unsound[0].describe()


async def test_a_notebook_with_no_graded_cell_spends_nothing() -> None:
    spec = NotebookSpec(
        slug="plain",
        title="Plain",
        cells=[Cell(id="setup", kind="code", role=CellRole.SETUP, source="x = 1")],
    )
    audit = await _audit(spec)
    assert audit.runs == 0
    assert audit.verdicts == []
    assert audit.ok
    assert audit.summary() == "no graded code cells"


async def test_two_exercises_still_cost_two_runs() -> None:
    """The cost is per notebook, not per exercise — which is the price ai-ops#258 was
    quoted, and the reason both arms fill in every exercise at once."""
    spec = NotebookSpec(
        slug="two",
        title="Two",
        cells=[
            Cell(
                id="ex1",
                kind="code",
                role=CellRole.SOLUTION,
                source="def double(x):\n    return 2 * x",
                stub="def double(x):\n    ...",
                check="assert double(3) == 6",
            ),
            Cell(
                id="ex2",
                kind="code",
                role=CellRole.SOLUTION,
                source="def triple(x):\n    return 3 * x",
                stub="def triple(x):\n    ...",
                check="assert triple(3) == 9",
            ),
        ],
    )
    audit = await _audit(spec)
    assert audit.runs == 2
    assert [v.verdict for v in audit.verdicts] == ["sound", "sound"]


async def test_one_bad_grader_among_good_ones_is_the_only_one_demoted() -> None:
    spec = NotebookSpec(
        slug="mixed",
        title="Mixed",
        cells=[
            Cell(
                id="ex1",
                kind="code",
                role=CellRole.SOLUTION,
                source="def double(x):\n    return 2 * x",
                stub="def double(x):\n    ...",
                check="assert double(3) == 6",
            ),
            Cell(
                id="ex2",
                kind="code",
                role=CellRole.SOLUTION,
                source="def triple(x):\n    return 3 * x",
                stub="def triple(x):\n    ...",
                check="assert callable(triple)",
            ),
        ],
    )
    audit = await _audit(spec)
    assert [(v.cell_id, v.verdict) for v in audit.verdicts] == [
        ("ex1", "sound"),
        ("ex2", "cannot-fail"),
    ]
    demoted = demote_unsound_graders(spec, audit)
    by_id = {c.id: c for c in demoted.cells}
    assert by_id["ex1"].check is not None, "a sound grader must survive the demotion"
    assert by_id["ex2"].check is None
    # The exercise itself stays: the reader still writes the code and still has the
    # author's solution. Only the wrong verdict goes.
    assert by_id["ex2"].stub is not None
    assert by_id["ex2"].source == "def triple(x):\n    return 3 * x"


async def test_demotion_leaves_an_inconclusive_grader_alone() -> None:
    """Demoting on suspicion would delete good graders whenever a run stopped early."""
    spec = _spec("assert double(3) == 6")
    audit = await _audit(spec)
    inconclusive = type(audit)(
        verdicts=[
            type(audit.verdicts[0])(
                cell_id="ex1",
                on_blank="unattempted",
                on_answer="unattempted",
                verdict="inconclusive",
            )
        ],
        runs=2,
    )
    unchanged = demote_unsound_graders(spec, inconclusive)
    assert {c.id: c.check for c in unchanged.cells} == {c.id: c.check for c in spec.cells}
    assert inconclusive.ok, "an unproved grader is not a proved defect"
    assert "1 never ran" in inconclusive.summary()
