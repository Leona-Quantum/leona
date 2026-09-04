"""The model and its text form: what a spec refuses, and that text round-trips."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from leona_notebooks import CellRole, NotebookKind, NotebookSpec, parse_source, render_source
from leona_notebooks.source import SourceParseError

from leona_notebook_fixtures import LESSON  # noqa: E402


def test_parse_assigns_positional_ids_and_roles() -> None:
    spec = parse_source(LESSON)
    assert spec.slug == "quantum-coin"
    assert spec.kind is NotebookKind.LESSON
    assert [cell.id for cell in spec.cells] == [f"c{i:02d}" for i in range(1, 11)]
    assert spec.cells[0].role is CellRole.OBJECTIVE
    assert spec.cells[0].kind == "markdown"
    assert spec.cells[0].source.startswith("## What you will build\n")
    assert spec.cells[4].kind == "code"
    assert spec.cells[4].source.endswith("counts\n")
    assert spec.duration_minutes == 20


def test_round_trip_is_identity() -> None:
    spec = parse_source(LESSON)
    text = render_source(spec)
    again = parse_source(text)
    assert again == spec
    # and rendering the re-parsed spec is stable
    assert render_source(again) == text


def test_cell_attributes_parse_json_and_bare_values() -> None:
    text = (
        "# ---\n# title: T\n# ---\n"
        '# %% id=intro [markdown] role=objective tags=["a","b"]\n# Hi\n'
        '# %% role=solution stub="answer = None\\n" execute=false timeout_s=30\nanswer = 42\n'
        "# %% role=summary [markdown]\n# Bye\n"
    )
    spec = parse_source(text)
    assert spec.cells[0].id == "intro"
    assert spec.cells[0].tags == ["a", "b"]
    assert spec.cells[1].stub == "answer = None\n"
    assert spec.cells[1].execute is False
    assert spec.cells[1].timeout_s == 30
    assert spec.cells[1].id == "c01"  # the lowest free id, not the position
    assert spec.cells[2].kind == "markdown"


def test_content_before_first_marker_is_refused() -> None:
    with pytest.raises(SourceParseError, match="before the first cell marker"):
        parse_source("# ---\n# title: T\n# ---\nprint('loose')\n# %%\nx = 1\n")


def test_unknown_attribute_is_refused_with_the_line() -> None:
    with pytest.raises(SourceParseError, match="line 4"):
        parse_source("# ---\n# title: T\n# ---\n# %% colour=red\nx = 1\n")


def test_unterminated_header_is_refused() -> None:
    with pytest.raises(SourceParseError, match="unterminated header"):
        parse_source("# ---\n# title: T\n# %%\nx = 1\n")


def test_duplicate_ids_and_bad_slugs_are_refused() -> None:
    with pytest.raises(ValidationError, match="duplicate cell id"):
        parse_source("# ---\n# title: T\n# ---\n# %% id=a\nx=1\n# %% id=a\ny=2\n")
    with pytest.raises(ValidationError, match="slug"):
        NotebookSpec(slug="Not A Slug", title="T")


def test_stub_on_markdown_is_refused() -> None:
    with pytest.raises(ValidationError, match="only code cells carry a stub"):
        parse_source('# ---\n# title: T\n# ---\n# %% [markdown] stub="x"\n# hi\n')


def test_next_cell_id_never_collides() -> None:
    spec = parse_source("# ---\n# title: T\n# ---\n# %% id=c02\nx=1\n# %% id=c01\ny=2\n")
    assert spec.next_cell_id() == "c03"


def test_markdown_lines_without_prefix_are_tolerated() -> None:
    spec = parse_source("# ---\n# title: T\n# ---\n# %% [markdown]\n# ok\nforgot the prefix\n")
    assert spec.cells[0].source == "ok\nforgot the prefix\n"
