"""The `.ipynb` the reader gets, and the challenge/solution builds of one source."""

from __future__ import annotations

import json

import nbformat

from leona_notebooks import CellRole, from_ipynb, parse_source, to_ipynb
from leona_notebooks.execution import CellError, CellOutput, CellResult, ExecutionReport
from leona_notebooks.ipynb import cells_for_build

CHALLENGE = """\
# ---
# title: Bell challenge
# kind: challenge
# ---

# %% [markdown] role=objective
# ## Build a Bell state

# %% role=setup
from qiskit import QuantumCircuit
bell = None

# %% [markdown] role=exercise
# Task 1: build the Bell state `bell`.

# %% [markdown] role=hint
# Two gates.

# %% role=solution stub="bell = None  # build the circuit here\\n"
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)

# %% [markdown] role=answer
# H then CX.

# %% role=checkpoint
if bell is not None:
    assert bell.num_qubits == 2, "two qubits"

# %% [markdown] role=summary
# Done.
"""


def test_challenge_build_replaces_solutions_with_stubs_and_drops_answers() -> None:
    spec = parse_source(CHALLENGE)
    challenge = cells_for_build(spec, "challenge")
    roles = [cell.role for cell in challenge]
    assert CellRole.SOLUTION not in roles
    assert CellRole.ANSWER not in roles
    stub = next(cell for cell in challenge if cell.role is CellRole.EXERCISE and cell.is_code)
    assert stub.source == "bell = None  # build the circuit here\n"
    assert stub.id == "c05"  # keeps the solution cell's id
    # the solution build is the source, untouched
    assert cells_for_build(spec, "solution") == spec.cells


def test_to_ipynb_is_valid_nbformat_and_carries_roles_as_tags() -> None:
    spec = parse_source(CHALLENGE)
    notebook = to_ipynb(spec, build="challenge")
    nbformat.validate(nbformat.from_dict(notebook))
    assert notebook["metadata"]["leona"]["build"] == "challenge"
    assert notebook["metadata"]["leona"]["slug"] == "bell-challenge"
    first = notebook["cells"][0]
    assert first["cell_type"] == "markdown"
    assert first["metadata"]["tags"] == ["objective"]
    assert first["metadata"]["leona"]["id"] == "c01"
    assert all(cell["outputs"] == [] for cell in notebook["cells"] if cell["cell_type"] == "code")


def test_outputs_from_a_report_land_in_the_right_cells() -> None:
    spec = parse_source(CHALLENGE)
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=False,
        runner="sandbox",
        cells=[
            CellResult(
                id="c02",
                status="ok",
                stdout="hello\n",
                outputs=[CellOutput(mime="text/plain", data="42")],
            ),
            CellResult(
                id="c05", status="ok", outputs=[CellOutput(mime="image/png", data="iVBORw0KGgo=")]
            ),
            CellResult(
                id="c07",
                status="error",
                error=CellError(
                    ename="AssertionError", evalue="two qubits", traceback=["Traceback"]
                ),
            ),
        ],
    )
    notebook = to_ipynb(spec, build="solution", report=report)
    by_id = {cell["metadata"]["leona"]["id"]: cell for cell in notebook["cells"]}
    assert by_id["c02"]["outputs"][0] == {
        "output_type": "stream",
        "name": "stdout",
        "text": "hello\n",
    }
    assert by_id["c02"]["outputs"][1]["output_type"] == "execute_result"
    assert by_id["c02"]["execution_count"] == 1
    assert by_id["c05"]["outputs"][0]["data"]["image/png"] == "iVBORw0KGgo="
    assert by_id["c07"]["outputs"][0]["ename"] == "AssertionError"
    assert by_id["c07"]["execution_count"] == 3
    nbformat.validate(nbformat.from_dict(notebook))


def test_dropped_figure_is_named_not_silent() -> None:
    spec = parse_source(CHALLENGE)
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[
            CellResult(
                id="c05",
                status="ok",
                outputs=[
                    CellOutput(mime="image/png", data="", truncated=True, original_bytes=900_000)
                ],
            )
        ],
    )
    notebook = to_ipynb(spec, build="solution", report=report)
    cell = next(c for c in notebook["cells"] if c["metadata"]["leona"]["id"] == "c05")
    assert "figure dropped: 900000 bytes" in cell["outputs"][0]["text"]


def test_include_outputs_false_strips_everything() -> None:
    spec = parse_source(CHALLENGE)
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[CellResult(id="c02", status="ok", stdout="x")],
    )
    notebook = to_ipynb(spec, report=report, include_outputs=False)
    assert all(cell["outputs"] == [] for cell in notebook["cells"] if cell["cell_type"] == "code")


def test_import_round_trip_keeps_ids_roles_and_kind() -> None:
    spec = parse_source(CHALLENGE)
    back = from_ipynb(to_ipynb(spec))
    assert [c.id for c in back.cells] == [c.id for c in spec.cells]
    assert [c.role for c in back.cells] == [c.role for c in spec.cells]
    assert back.kind == spec.kind
    assert back.title == spec.title


def test_import_of_a_foreign_notebook_reads_tags_and_first_heading() -> None:
    foreign = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Someone's notebook\n", "text"]},
            {
                "cell_type": "code",
                "metadata": {"tags": ["checkpoint"]},
                "source": "assert True",
                "outputs": [],
                "execution_count": None,
            },
            {"cell_type": "raw", "metadata": {}, "source": "ignored"},
        ],
    }
    spec = from_ipynb(foreign)
    assert spec.title == "Someone's notebook"
    assert spec.kind.value == "scratch"
    assert [c.id for c in spec.cells] == ["c01", "c02"]
    assert spec.cells[1].role is CellRole.CHECKPOINT
    assert spec.seeds[0].kind == "upload"


# --------------------------------------------------------------- the two ways a redaction leaked
#
# Both of these were live on 2026-09-05 and both are provable in one run, which is why
# they are here rather than in a note. They are separate failures of the same habit:
# a redaction was written by listing the FIELDS that hold a secret, and a secret has
# more places to live than that list.


def _quiz_with_a_prose_answer() -> object:
    """A quiz whose answer is markdown prose — no `answer` key, no `check`, no stub.

    This is the shape `for_learner()` could not see. Its redaction nulled `check`,
    swapped `answer` for `answer_prompt` and replaced a solution's source with its stub;
    a cell whose secret is simply its own text matched none of those and passed through
    untouched, with `leaks_answer_key()` reporting nothing wrong.
    """
    from majorana_contracts.notebooks import Cell, NotebookSpec

    return NotebookSpec(
        slug="prose-answer",
        title="Prose answer",
        kind="quiz",
        cells=[
            Cell(id="obj", kind="markdown", role=CellRole.OBJECTIVE, source="## Quiz"),
            Cell(
                id="q1",
                kind="markdown",
                role=CellRole.QUESTION,
                source="Which gate creates superposition?",
            ),
            Cell(
                id="a1",
                kind="markdown",
                role=CellRole.ANSWER,
                source="**The Hadamard gate.** It maps $|0\\rangle$ to $(|0\\rangle+|1\\rangle)/\\sqrt2$.",
            ),
            Cell(id="sum", kind="markdown", role=CellRole.SUMMARY, source="Done."),
        ],
    )


def test_the_learner_build_removes_an_answer_cell_whose_secret_is_its_own_prose() -> None:
    spec = _quiz_with_a_prose_answer()
    learner = spec.for_learner()
    assert [cell.id for cell in learner.cells] == ["obj", "q1", "sum"]
    assert "Hadamard" not in "\n".join(cell.source for cell in learner.cells)


def test_leaks_answer_key_reports_the_prose_answer_cell() -> None:
    """The guard's own negative control.

    Asserted on the UNREDACTED spec, so it fails if the arm is deleted — which is the
    thing that was missing. The old guard returned `[]` here, and a guard that cannot
    go red on the defect it exists for is indistinguishable from one that is working.
    """
    spec = _quiz_with_a_prose_answer()
    assert spec.leaks_answer_key() == ["a1"]
    assert spec.for_learner().leaks_answer_key() == []


def test_an_answer_that_is_a_CODE_cell_with_a_stub_is_redacted_too() -> None:
    """`NotebookKind.QUIZ` permits "a role=answer cell, markdown or code".

    The removal guard keeps any cell of these roles that carries a stub — correct, a stub
    is a typing slot the reader needs — and the replacement branch below it then handled
    only `role=solution`. So this one shape was kept AND left unredacted: the authored
    answer reached both the workspace and the downloaded challenge. Greptile, PR 836.

    Two conditions written for one set, four lines below a docstring about the cost of two
    implementations of one redaction.
    """
    from majorana_contracts.notebooks import Cell, NotebookSpec

    spec = NotebookSpec(
        slug="code-answer",
        title="Code answer",
        kind="quiz",
        cells=[
            Cell(id="obj", kind="markdown", role=CellRole.OBJECTIVE, source="## Quiz"),
            Cell(
                id="a1",
                kind="code",
                role=CellRole.ANSWER,
                source="answer = 42  # the value they were asked for",
                stub="answer = None\n",
            ),
            Cell(id="sum", kind="markdown", role=CellRole.SUMMARY, source="Done."),
        ],
    )
    learner = spec.for_learner()
    assert [cell.source for cell in learner.cells if cell.id == "a1"] == ["answer = None\n"]
    assert learner.leaks_answer_key() == []
    # The control: the guard says so about the unredacted spec, or it is asserting nothing.
    assert spec.leaks_answer_key() == ["a1"]
    # And the file build agrees, since it is defined in terms of the same function.
    assert [c.source for c in cells_for_build(spec, "challenge") if c.id == "a1"] == [
        "answer = None\n"
    ]


def test_the_two_redactions_agree_cell_for_cell() -> None:
    """The browser build and the file build are one implementation, and stay one.

    They were two, and drifted: `cells_for_build(..., "challenge")` knew about
    `role=answer` and `for_learner()` did not, so the same quiz was redacted or not
    depending on whether it was read in the workspace or downloaded. Compared here on
    the ids and sources both produce, so a divergence in either direction fails.

    **This is a drift check, not a correctness check, and it cannot be the only test.**
    Now that one function is derived from the other, an error in the shared half makes
    both wrong *and still equal* — verified: deleting the answer-cell arm from
    `for_learner()` leaves this test green while the two tests above go red. It earns its
    place by catching the reintroduction of a second implementation; the redaction being
    RIGHT is what those two assert.
    """
    spec = _quiz_with_a_prose_answer()
    from_file = [(c.id, c.source) for c in cells_for_build(spec, "challenge")]
    from_browser = [(c.id, c.source) for c in spec.for_learner().cells]
    assert from_file == from_browser


def test_a_stub_does_not_carry_the_solutions_output() -> None:
    """`# Your code here`, and the finished answer printed underneath it.

    Outputs are looked up by cell id and the stub inherits the solution's id, so the
    challenge build handed the reader the result of the code it had just hidden. The
    exercise below prints `42`; a reader who downloads it must not see `42`.
    """
    from majorana_contracts.notebooks import Cell, NotebookSpec

    spec = NotebookSpec(
        slug="outputs",
        title="Outputs",
        kind="challenge",
        cells=[
            Cell(id="obj", kind="markdown", role=CellRole.OBJECTIVE, source="## Go"),
            Cell(id="pre", kind="code", role=CellRole.SETUP, source='print("setup")'),
            Cell(id="ex", kind="markdown", role=CellRole.EXERCISE, source="Compute 6*7."),
            Cell(
                id="s1",
                kind="code",
                role=CellRole.SOLUTION,
                source="print(6 * 7)",
                stub="# your code here\n",
            ),
            Cell(id="ctx", kind="code", role=CellRole.RUN, source='print("context")'),
            Cell(id="sum", kind="markdown", role=CellRole.SUMMARY, source="Done."),
        ],
    )
    report = ExecutionReport(
        notebook_slug="outputs",
        ok=True,
        runner="sandbox",
        cells=[
            CellResult(id="pre", status="ok", stdout="setup\n"),
            CellResult(id="s1", status="ok", stdout="42\n"),
            CellResult(id="ctx", status="ok", stdout="context\n"),
        ],
    )
    challenge = to_ipynb(spec, build="challenge", report=report)
    by_id = {cell["id"]: cell for cell in challenge["cells"]}
    # A cell BEFORE the first replacement is unaffected — nothing the (still hidden)
    # solution computes can reach backward into a value this cell already printed.
    # The control: otherwise this test would pass on a build that simply dropped every
    # output, which teaches the reader nothing.
    assert by_id["pre"]["outputs"], "a cell before the redaction must keep its output"
    assert by_id["s1"]["outputs"] == []
    # `ctx`'s own SOURCE never changed, but it ran in the same kernel, right after the
    # real solution, so its stdout is not provably free of the answer either — treated
    # as contaminated along with every other cell from the first replacement onward
    # (Greptile, PR 959: the original guard cleared only the replaced cell's own id).
    assert by_id["ctx"]["outputs"] == [], "a cell AFTER the redaction must not leak it either"
    assert "42" not in json.dumps(challenge)
    # ...and the solution build, which is for the author, still shows everything.
    solution = to_ipynb(spec, build="solution", report=report)
    by_id = {cell["id"]: cell for cell in solution["cells"]}
    assert by_id["pre"]["outputs"] and by_id["s1"]["outputs"] and by_id["ctx"]["outputs"]
    assert "42" in json.dumps(solution)
