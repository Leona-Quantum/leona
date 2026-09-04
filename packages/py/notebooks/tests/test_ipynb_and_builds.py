"""The `.ipynb` the reader gets, and the challenge/solution builds of one source."""

from __future__ import annotations

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
