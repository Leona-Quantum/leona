"""The model and its text form: what a spec refuses, and that text round-trips."""

from __future__ import annotations

import json

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


# --- the grader round-trip (ai-ops#258) --------------------------------------------

GRADED = (
    "# ---\n# title: T\n# kind: lesson\n# summary: s\n# objectives:\n#   - o\n"
    "# duration_minutes: 10\n# ---\n\n"
    '# %% id=ex1 role=solution stub="def double(x):\\n    ..." '
    "check=\"assert double(3) == 6, 'double(3) should be 6'\"\n"
    "def double(x):\n    return 2 * x\n"
)


def test_a_check_parses_out_of_the_source_format() -> None:
    """Before this, `check` was a rejected attribute — so a model could not write a
    graded exercise at all, and every generated notebook had zero graders while the
    contract, the engine and the CI gate all read as though it had them."""
    spec = parse_source(GRADED, slug="graded")
    cell = spec.cell_by_id("ex1")
    assert cell.check == "assert double(3) == 6, 'double(3) should be 6'"
    assert cell.stub == "def double(x):\n    ..."


def test_a_check_survives_the_round_trip() -> None:
    """`parse_source(render_source(s)) == s` is the property the repair and revise turns
    lean on: they send a cell back through this format. An attribute that parses but does
    not render deletes the grader on the first edit of a graded cell."""
    spec = parse_source(GRADED, slug="graded")
    again = parse_source(render_source(spec), slug="graded")
    assert again.cell_by_id("ex1").check == spec.cell_by_id("ex1").check
    assert again == spec


def test_the_ipynb_export_never_carries_a_check() -> None:
    """The stated invariant on `Cell.check`, asserted rather than trusted. It holds by
    construction today — `to_ipynb` copies a fixed set of metadata keys — and this is
    what turns "by construction" into something that fails if the construction changes."""
    from leona_notebooks.ipynb import to_ipynb

    spec = parse_source(GRADED, slug="graded")
    for build in ("full", "challenge", "solution"):
        blob = json.dumps(to_ipynb(spec, build=build))
        assert "double(3) should be 6" not in blob, f"the {build} build leaked the grader"
        assert "check" not in json.loads(blob)["cells"][0]["metadata"]["leona"]


# --------------------------------------------------------------------- answer keys
#
# `answer` reaches the format last, after `Cell.answer`, `deterministic_grade`,
# `AnswerPrompt` redaction and `leaks_answer_key` were all in place — so until these
# tests existed the model could not write a gradable question even though every part
# that grades one was built and tested. Same shape as the gap `check` closed one release
# earlier, which is why the round trip is asserted here and not left to the pipeline.


def _one_cell(marker: str, body: str = "# Which gate?") -> object:
    text = "# ---\n# slug: q\n# title: Q\n# ---\n\n" + marker + "\n" + body + "\n"
    return parse_source(text).cells[0]


def test_a_choice_answer_key_parses_off_the_cell_marker() -> None:
    cell = _one_cell(
        "# %% [markdown] role=question "
        'answer={"kind":"choice","options":["Hadamard","Pauli-X"],"correct":0}'
    )
    assert cell.answer is not None
    assert cell.answer.kind == "choice"
    assert cell.answer.correct == 0
    assert cell.answer.options == ["Hadamard", "Pauli-X"]


def test_an_answer_key_survives_braces_inside_its_own_strings() -> None:
    # The reason the value scanner replaced a regex. `\ket{0}` and `\frac{1}{2}` are what
    # a quantum notebook's explanations are made of, and the old `\{[^}]*\}` branch
    # stopped at the first `}` — inside the LaTeX — and reported a JSON error about a
    # string the author had terminated correctly.
    cell = _one_cell(
        "# %% [markdown] role=question "
        'answer={"kind":"text","accept":["Hadamard"],'
        '"explanation":"It maps $\\\\ket{0}$ to $\\\\frac{1}{\\\\sqrt2}(\\\\ket0+\\\\ket1)$."}'
    )
    assert cell.answer is not None
    assert "\\frac{1}{\\sqrt2}" in cell.answer.explanation
    assert cell.answer.accept == ["Hadamard"]


def test_an_answer_key_round_trips_through_render_source() -> None:
    # An attribute that parses but does not render is a silent deletion on the first
    # revise turn, because the repair and revise lanes send cells back through this
    # format. `check` carries the same note for the same reason.
    text = (
        "# ---\n# slug: q\n# title: Q\n# ---\n\n"
        "# %% [markdown] id=c01 role=question "
        'answer={"kind":"numeric","value":0.5,"tolerance":0.01,"unit":"probability",'
        '"explanation":"Half the time, by $|\\\\alpha|^2$."}\n'
        "# What is the chance of measuring 1?\n"
    )
    spec = parse_source(text)
    again = parse_source(render_source(spec, include_ids=True))
    assert [c.answer for c in again.cells] == [c.answer for c in spec.cells]
    assert again.cells[0].answer.unit == "probability"


def test_an_unbalanced_answer_key_is_refused_rather_than_truncated() -> None:
    # The failure direction that matters: a value scanner that returned the truncated
    # token would hand `{"kind":"choice","options":["a"` to json.loads, and the error
    # would name a problem the author does not have.
    with pytest.raises(SourceParseError, match="unbalanced"):
        _one_cell('# %% [markdown] role=question answer={"kind":"choice","options":["a"')


def test_a_cell_with_no_answer_renders_no_answer_attribute() -> None:
    text = "# ---\n# slug: q\n# title: Q\n# ---\n\n# %% role=run\nprint(1)\n"
    assert "answer=" not in render_source(parse_source(text))


def test_an_unmatched_brace_inside_a_string_does_not_end_the_value() -> None:
    # This is the case the scanner's string-shielding exists for, and the LaTeX test
    # above does NOT cover it: `\ket{0}` and `\frac{1}{2}` are BALANCED, so a scanner
    # that counted braces without knowing about strings would still land in the right
    # place. Only an unmatched brace inside a string separates the two, and it is legal
    # JSON, so the parser owes it a correct reading rather than a truncated one.
    cell = _one_cell(
        "# %% [markdown] role=question "
        'answer={"kind":"text","accept":["ket"],'
        '"explanation":"a lone } is fine inside a string"}'
    )
    assert cell.answer is not None
    assert cell.answer.explanation == "a lone } is fine inside a string"
    assert cell.answer.accept == ["ket"]
