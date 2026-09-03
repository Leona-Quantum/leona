"""A version the reader wrote: the three inputs, the advisory structure check, and
`run_until` — including the two things that must NOT happen (a structure failure
refusing the save, and a bad `run_until` reaching the sandbox)."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest
from majorana_sandbox import run as sandbox_run
from majorana_sandbox.local import LocalSubprocessSandbox

from leona_notebooks import (
    AuthoringInputError,
    UnknownCellError,
    advisory_structure,
    compose_notebook_program,
    parse_source,
    report_from_sandbox_result,
    spec_from_author_request,
    to_ipynb,
)
from leona_notebooks.authoring import fill_cell_ids, next_cell_id
from leona_notebooks.sandbox_program import RUN_UNTIL_NOTE, build_execution_spec

FOUR_CELLS = (
    "# ---\n# title: Four\n# ---\n"
    "# %% id=c01\nprint('one')\n"
    "# %% id=c02\nprint('two')\n"
    "# %% id=c03\nprint('three')\n"
    "# %% id=c04\nprint('four')\n"
)


# ---------------------------------------------------------------------- the three inputs


def test_spec_input_is_taken_as_written() -> None:
    spec = parse_source(FOUR_CELLS)
    built = spec_from_author_request(spec=spec.model_dump(mode="json"))
    assert [c.id for c in built.cells] == ["c01", "c02", "c03", "c04"]
    assert built.title == "Four"


def test_source_input_is_parsed_and_the_slug_is_the_notebooks_own() -> None:
    built = spec_from_author_request(source=FOUR_CELLS, slug="pinned-slug")
    assert built.slug == "pinned-slug"
    assert [c.source.strip() for c in built.cells] == [
        "print('one')",
        "print('two')",
        "print('three')",
        "print('four')",
    ]


def test_ipynb_input_round_trips_back_to_the_same_cells() -> None:
    spec = parse_source(FOUR_CELLS)
    built = spec_from_author_request(ipynb=to_ipynb(spec), slug="from-jupyter")
    assert built.slug == "from-jupyter"
    assert [c.source.strip() for c in built.cells] == [
        "print('one')",
        "print('two')",
        "print('three')",
        "print('four')",
    ]


def test_two_inputs_are_refused_rather_than_ranked() -> None:
    spec = parse_source(FOUR_CELLS)
    with pytest.raises(AuthoringInputError) as info:
        spec_from_author_request(spec=spec.model_dump(mode="json"), source=FOUR_CELLS)
    assert "spec, source" in str(info.value)


def test_no_input_is_refused() -> None:
    with pytest.raises(AuthoringInputError) as info:
        spec_from_author_request()
    assert "got none" in str(info.value)


def test_a_source_parse_failure_carries_the_parsers_own_message() -> None:
    with pytest.raises(AuthoringInputError) as info:
        spec_from_author_request(source="# %% role=nonsense\nx = 1\n")
    # The parser names what it choked on; a generic sentence would be useless in an
    # editor, so the message has to survive the wrapping.
    assert "could not read this notebook source" in str(info.value)
    assert str(info.value) != "could not read this notebook source: "


def test_a_malformed_spec_is_refused_with_the_validation_message() -> None:
    with pytest.raises(AuthoringInputError) as info:
        spec_from_author_request(spec={"schema_version": 1, "slug": "s", "title": ""})
    assert "not a valid spec" in str(info.value)


# ------------------------------------------------------------------------------- ids


def test_missing_cell_ids_are_filled_with_the_lowest_free_id() -> None:
    filled = fill_cell_ids([{"id": "c01"}, {}, {"id": "c03"}, {"id": ""}])
    assert [cell["id"] for cell in filled] == ["c01", "c02", "c03", "c04"]
    assert next_cell_id({"c01", "c02", "c04"}) == "c03"


def test_a_spec_with_id_less_cells_still_validates() -> None:
    built = spec_from_author_request(
        spec={
            "schema_version": 1,
            "slug": "s",
            "title": "T",
            "cells": [
                {"id": "c01", "kind": "code", "source": "x = 1"},
                {"kind": "markdown", "source": "prose"},
            ],
        }
    )
    assert [c.id for c in built.cells] == ["c01", "c02"]


# ------------------------------------------------------------------- advisory structure


def test_structure_failures_come_back_as_warnings_not_as_a_refusal() -> None:
    # A notebook mid-restructure fails most lesson rules. It must still be a spec.
    built = spec_from_author_request(source=FOUR_CELLS)
    warnings = advisory_structure(built)
    assert warnings, "a four-code-cell lesson should fail some structure rules"
    assert all(isinstance(w, str) for w in warnings)
    # The point of the test: producing warnings did not stop the spec existing.
    assert len(built.cells) == 4


# ------------------------------------------------------------------------- run_until


def test_run_until_composes_only_the_cells_up_to_and_including_it() -> None:
    spec = parse_source(FOUR_CELLS)
    program = compose_notebook_program(spec, run_until="c02")
    assert program.cell_ids == ("c01", "c02")
    assert program.not_run == {"c03": RUN_UNTIL_NOTE, "c04": RUN_UNTIL_NOTE}
    assert "three" not in program.code and "four" not in program.code


def test_run_until_none_composes_everything() -> None:
    program = compose_notebook_program(parse_source(FOUR_CELLS))
    assert program.cell_ids == ("c01", "c02", "c03", "c04")
    assert program.not_run == {}


def test_cells_after_the_cut_are_not_guard_checked() -> None:
    """The documented choice: the guard runs on exactly what is composed. A later cell
    that would be refused does not block running the earlier ones."""
    spec = parse_source(
        "# ---\n# title: T\n# ---\n"
        "# %% id=c01\nx = 1\n"
        "# %% id=c02\nimport subprocess\nsubprocess.run(['ls'])\n"
    )
    program = compose_notebook_program(spec, run_until="c01")
    assert program.cell_ids == ("c01",)
    # ...and without the cut, the same notebook is refused.
    from leona_notebooks import NotebookGuardError

    with pytest.raises(NotebookGuardError):
        compose_notebook_program(spec)


def test_an_unknown_run_until_raises_before_any_execution_spec_exists() -> None:
    spec = parse_source(FOUR_CELLS)
    with pytest.raises(UnknownCellError) as info:
        compose_notebook_program(spec, run_until="c99")
    assert "c99" in str(info.value)


def test_run_until_runs_two_cells_and_reports_the_other_two_as_not_run() -> None:
    spec = parse_source(FOUR_CELLS)
    program = compose_notebook_program(spec, run_until="c02")
    with tempfile.TemporaryDirectory() as tmp:
        exec_spec = build_execution_spec(
            program, timeout_s=120, protected_result_path=str(Path(tmp) / "obs.json")
        )
        result = asyncio.run(sandbox_run(LocalSubprocessSandbox(), exec_spec))
    report = report_from_sandbox_result(result, spec, program)
    by_id = report.by_id()
    assert by_id["c01"].status == "ok" and by_id["c01"].stdout == "one\n"
    assert by_id["c02"].status == "ok" and by_id["c02"].stdout == "two\n"
    assert by_id["c03"].status == "not_run" and by_id["c03"].note == RUN_UNTIL_NOTE
    assert by_id["c04"].status == "not_run"
    # Stopping where the reader asked is not a failed run.
    assert report.ok is True
