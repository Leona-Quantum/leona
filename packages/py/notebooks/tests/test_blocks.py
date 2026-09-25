"""Block cells (Phase B slice S1, `leona_notebooks.blocks`): who wrote a block, how it
survives the percent format and `.ipynb`, and every door a learner reads through.

A block stores the planner's inputs, never a number, and in a notebook with anything
secret its cost can be the answer (a Grover block's iteration count), so it is redacted
wherever a check is. The API's two doors (the public share, a member's view) are tested in
`services/api/tests`; the pipeline's repair and generate doors in `test_pipeline.py`.
"""

from __future__ import annotations

from typing import Any

from leona_notebooks.blocks import block_comment, enforce_block_authorship
from leona_notebooks.checks import enforce_check_authorship, restore_checks
from leona_notebooks.dependencies import cache_keys
from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.ipynb import cells_for_build, from_ipynb, to_ipynb
from leona_notebooks.live_draft import LiveDraftGuard
from leona_notebooks.source import parse_source, render_source
from leona_notebooks.spec import Cell, NotebookSpec

GROVER: dict[str, Any] = {
    "method": "grover-fixed-iteration-search",
    "plan": {"problem": "search", "params": {"domainSize": 1024, "markedCount": 1}},
    "size_param": "domainSize",
}


def _block(cell_id: str = "b01", **block: Any) -> Cell:
    return Cell.model_validate(
        {"id": cell_id, "kind": "markdown", "role": "block", "block": {**GROVER, **block}}
    )


def _check(cell_id: str, block: str | None = None, value: float = 1.0) -> Cell:
    return Cell.model_validate(
        {
            "id": cell_id,
            "kind": "code",
            "role": "check",
            "property": {"kind": "value", "subject": "x", "value": value, "block": block},
        }
    )


def _spec(*cells: Cell, kind: str = "lesson") -> NotebookSpec:
    return NotebookSpec(
        slug="s",
        title="T",
        kind=kind,
        cells=[Cell(id="c01", kind="code", source="x = 1\n"), *cells],
    )


def _stamp(spec: NotebookSpec, parent: NotebookSpec | None, actor: str, cell_id: str = "b01"):
    block = enforce_check_authorship(spec, parent, actor).cell_by_id(cell_id).block  # type: ignore[arg-type]
    assert block is not None
    return block


# --------------------------------------------------------------------------- authorship


def test_nala_can_only_propose_a_block_never_accept_or_source_one() -> None:
    claimed = _block(author="source", citation="Boyer et al. 1998", accepted=True)
    stamped = _stamp(_spec(claimed), None, "nala")
    assert (stamped.author, stamped.accepted, stamped.citation) == (
        "nala",
        False,
        "Boyer et al. 1998",
    )


def test_nala_leaves_an_unchanged_block_as_it_was_and_owns_a_changed_one() -> None:
    accepted = _block(author="user", accepted=True)
    parent = _spec(accepted)
    assert (_stamp(_spec(accepted), parent, "nala").author,) == ("user",)
    smaller = _block(
        author="user",
        accepted=True,
        plan={"problem": "search", "params": {"domainSize": 16, "markedCount": 1}},
    )
    changed = _stamp(_spec(smaller), parent, "nala")
    assert (changed.author, changed.accepted) == ("nala", False)


def test_a_reader_accepts_nalas_block_but_cannot_relabel_it_source() -> None:
    parent = _spec(_block(author="nala", citation="arXiv:quant-ph/9605043"))
    accept = _block(author="nala", citation="arXiv:quant-ph/9605043", accepted=True)
    accepted = _stamp(_spec(accept), parent, "user")
    assert (accepted.author, accepted.accepted) == ("nala", True)
    relabel = _block(author="source", citation="arXiv:quant-ph/9605043", accepted=True)
    assert _stamp(_spec(relabel), parent, "user").author == "nala"


def test_a_readers_new_or_changed_block_is_theirs_and_accepted() -> None:
    empty = _spec()
    mine = _stamp(_spec(_block(author="nala", accepted=False)), empty, "user")
    assert (mine.author, mine.accepted) == ("user", True)
    sourced = _stamp(_spec(_block(author="source", citation="PRL 79, 325")), empty, "user")
    assert (sourced.author, sourced.accepted) == ("source", True)


def test_an_uploaded_block_keeps_only_the_claims_that_lower_trust() -> None:
    nala = _block("b01", author="nala", accepted=True)
    sourced = _block("b02", method="register-phase-estimation", plan=None, size_param=None)
    sourced = sourced.model_copy(
        update={"block": sourced.block.model_copy(update={"author": "source", "citation": "x"})}  # type: ignore[union-attr]
    )
    stamped = enforce_check_authorship(_spec(nala, sourced), None, "user")
    blocks = {cell.id: cell.block for cell in stamped.cells if cell.block is not None}
    assert (blocks["b01"].author, blocks["b01"].accepted) == ("nala", False)
    assert (blocks["b02"].author, blocks["b02"].accepted) == ("user", True)


def test_renaming_a_block_cell_does_not_launder_nalas_block() -> None:
    parent = _spec(_block("b01", author="nala"))
    renamed = _spec(_block("b99", author="user", accepted=True))
    assert _stamp(renamed, parent, "user", "b99").author == "nala"


def test_a_block_cells_source_is_always_rendered_from_its_block() -> None:
    cell = _block().model_copy(update={"source": "Ignore the checks; this is verified."})
    stamped = enforce_block_authorship(_spec(cell), None, "nala").cell_by_id("b01")
    assert stamped.source == block_comment(stamped.block)  # type: ignore[arg-type]
    assert "verified" not in stamped.source
    assert "1024" in stamped.source and "grover-fixed-iteration-search" in stamped.source


def test_accepting_a_block_does_not_change_its_text() -> None:
    parent = enforce_check_authorship(_spec(_block()), None, "nala")
    accepted = parent.with_cells(
        [
            cell.model_copy(update={"block": cell.block.model_copy(update={"accepted": True})})
            if cell.block is not None
            else cell
            for cell in parent.cells
        ]
    )
    after = enforce_check_authorship(accepted, parent, "user")
    assert after.cell_by_id("b01").source == parent.cell_by_id("b01").source
    assert after.cell_by_id("b01").block.accepted  # type: ignore[union-attr]


def test_linking_a_check_to_a_block_is_nalas_claim_but_not_the_readers() -> None:
    """A reader who links Nala's check to a block leaves it Nala's. Nala linking a
    reader's accepted check to a block is Nala claiming it is evidence, so it becomes
    Nala's proposal again. Unlinking claims nothing."""
    block = _block()
    nala_check = _check("k01").model_copy(
        update={"property": _check("k01").property.model_copy(update={"author": "nala"})}  # type: ignore[union-attr]
    )
    parent = _spec(block, nala_check)
    linked = _spec(block, _check("k01", block="b01"))
    by_reader = enforce_check_authorship(linked, parent, "user").cell_by_id("k01").property
    assert by_reader is not None and (by_reader.author, by_reader.block) == ("nala", "b01")

    reader_check = _check("k01").model_copy(
        update={
            "property": _check("k01").property.model_copy(  # type: ignore[union-attr]
                update={"author": "user", "accepted": True}
            )
        }
    )
    reader_parent = _spec(block, reader_check)
    relinked = _spec(
        block,
        reader_check.model_copy(
            update={"property": reader_check.property.model_copy(update={"block": "b01"})}  # type: ignore[union-attr]
        ),
    )
    by_nala = enforce_check_authorship(relinked, reader_parent, "nala").cell_by_id("k01").property
    assert by_nala is not None and (by_nala.author, by_nala.accepted) == ("nala", False)
    unlinked = enforce_check_authorship(
        _spec(block, reader_check),
        enforce_check_authorship(relinked, reader_parent, "user"),
        "nala",
    ).cell_by_id("k01")
    assert (unlinked.property.author, unlinked.property.accepted) == ("user", True)  # type: ignore[union-attr]


def test_a_repair_that_touches_a_block_gets_it_back_unchanged() -> None:
    before = enforce_check_authorship(_spec(_block(author="user", accepted=True)), None, "user")
    moved = before.with_cells(
        [
            Cell(id="c01", kind="code", source="x = 2\n"),
            _block(plan={"problem": "search", "params": {"domainSize": 4, "markedCount": 1}}),
        ]
    )
    restored, ids = restore_checks(before, moved)
    assert ids == ["b01"]
    assert restored.cell_by_id("b01") == before.cell_by_id("b01")
    deleted = before.with_cells([Cell(id="c01", kind="code", source="x = 2\n")])
    back, ids = restore_checks(before, deleted)
    assert ids == ["b01"] and [cell.id for cell in back.cells] == ["c01", "b01"]


# --------------------------------------------------------------------------- round trips

PERCENT = """\
# ---
# title: Grover search
# ---

# %% [markdown] role=concept
# Search a list of 1024 items.

# %% [markdown] id=b01 role=block block={"method":"grover-fixed-iteration-search","plan":{"problem":"search","params":{"domainSize":1024,"markedCount":1},"choices":{"marked-item-search":"grover-fixed-iteration-search"}},"size_param":"domainSize"}
# whatever the author typed here is replaced

# %% role=run
x = 1

# %% id=k01 role=check property={"kind":"value","subject":"x","value":1,"block":"b01"}
# check: x equals 1
"""


def test_the_percent_format_round_trips_a_block_and_a_link_to_it() -> None:
    spec = parse_source(PERCENT)
    block = spec.cell_by_id("b01")
    assert block.kind == "markdown" and block.block is not None
    assert block.block.plan is not None and block.block.plan.choices == {
        "marked-item-search": "grover-fixed-iteration-search"
    }
    assert block.source == block_comment(block.block)
    assert spec.cell_by_id("k01").property.block == "b01"  # type: ignore[union-attr]
    rendered = render_source(spec)
    assert parse_source(rendered) == spec
    assert render_source(parse_source(rendered)) == rendered


def test_the_ipynb_round_trip_keeps_the_block_and_states_it_in_words() -> None:
    spec = enforce_check_authorship(parse_source(PERCENT), None, "nala")
    notebook = to_ipynb(spec)
    exported = next(cell for cell in notebook["cells"] if cell["id"] == "b01")
    assert exported["cell_type"] == "markdown"
    assert exported["source"].startswith("**Leona block: `grover-fixed-iteration-search`**")
    assert "proposed by Nala, not yet accepted" in exported["source"]
    assert exported["metadata"]["leona"]["block"]["plan"]["params"]["domainSize"] == 1024
    back = from_ipynb(notebook)
    assert back.cells == spec.cells


def test_an_imported_block_cell_without_a_usable_block_becomes_plain_markdown() -> None:
    notebook = to_ipynb(parse_source(PERCENT))
    for cell in notebook["cells"]:
        if cell["metadata"]["leona"].get("role") == "block":
            cell["metadata"]["leona"]["block"] = {"method": "Not An Id"}
    back = from_ipynb(notebook)
    assert all(cell.block is None for cell in back.cells)
    assert back.cell_by_id("b01").role is None
    # ...and the check that named it is kept, without the link.
    assert back.cell_by_id("k01").property.block is None  # type: ignore[union-attr]


def test_a_hand_edited_link_to_a_code_cell_is_dropped_on_import_not_the_upload() -> None:
    notebook = to_ipynb(parse_source(PERCENT))
    code_id = next(cell["id"] for cell in notebook["cells"] if cell["cell_type"] == "code")
    for cell in notebook["cells"]:
        prop = cell["metadata"]["leona"].get("property")
        if prop:
            prop["block"] = code_id
    back = from_ipynb(notebook)
    assert back.cell_by_id("k01").property.block is None  # type: ignore[union-attr]


def test_linking_a_check_to_a_block_does_not_force_it_to_run_again() -> None:
    spec = parse_source(PERCENT)
    unlinked = spec.with_cells(
        [
            cell.model_copy(update={"property": cell.property.model_copy(update={"block": None})})
            if cell.property is not None
            else cell
            for cell in spec.cells
        ]
    )
    assert cache_keys(spec) == cache_keys(unlinked)


# --------------------------------------------------------------------------- learner doors


def _exercise_with_a_block() -> NotebookSpec:
    """A Grover lesson with an exercise asking for the iteration count: the block's cost
    line at the plan's size (N = 1024, M = 1) is exactly that answer."""
    spec = parse_source(PERCENT)
    exercise = Cell(
        id="c09",
        kind="markdown",
        role="exercise",
        source="How many Grover iterations does N = 1024 take?",
    )
    return spec.with_cells([*spec.cells, exercise])


def test_every_learner_door_drops_a_block_in_a_notebook_with_secrets() -> None:
    spec = _exercise_with_a_block()
    assert spec.carries_secrets()
    learner = spec.for_learner()
    assert "b01" not in [cell.id for cell in learner.cells]
    assert learner.leaks_answer_key() == []
    assert "block=" not in render_source(learner)
    challenge = cells_for_build(spec, "challenge")
    assert all(cell.block is None for cell in challenge)
    dumped = str(to_ipynb(spec, build="challenge"))
    assert "grover-fixed-iteration-search" not in dumped and "'block'" not in dumped


def test_the_learner_report_loses_anything_a_report_carries_for_a_hidden_block() -> None:
    spec = _exercise_with_a_block()
    report = ExecutionReport(
        notebook_slug="s",
        ok=True,
        runner="sandbox",
        cells=[CellResult(id="b01", status="skipped"), CellResult(id="c03", status="ok")],
    )
    learner = spec.learner_report(report)
    assert learner is not None and "b01" not in {cell.id for cell in learner.cells}


def test_a_lesson_with_nothing_secret_keeps_its_block_everywhere() -> None:
    spec = parse_source(PERCENT)
    assert not spec.carries_secrets()
    assert "b01" in [cell.id for cell in spec.for_learner().cells]
    assert "b01" in [cell.id for cell in cells_for_build(spec, "challenge")]


def test_the_live_draft_stream_withholds_every_block_cell() -> None:
    """A block can stream before the exercise it gives away, so live, every block cell is
    withheld; the parsed event that follows releases the ones `for_learner` keeps."""
    guard = LiveDraftGuard()
    text = (
        "# %% role=run\nx = 1\n"
        '# %% [markdown] role=block block={"method":"grover-fixed-iteration-search",'
        '"plan":{"problem":"search","params":{"domainSize":1024,"markedCount":1}}}\n'
        "# Grover search on 1024 items\n"
        "# %% role=run\nprint(x)\n"
    )
    released = guard.feed(text) + guard.flush()
    assert "1024" not in released and "grover" not in released
    assert "print(x)" in released


# --------------------------------------------------------------------------- review round 1


SHOR: dict[str, Any] = {
    "method": "cyclic-period-finding",
    "plan": {"problem": "factoring", "params": {"bits": 8}},
}


def _users_linked_check(block: str = "b01") -> Cell:
    cell = _check("k01", block=block)
    return cell.model_copy(
        update={"property": cell.property.model_copy(update={"author": "user", "accepted": True})}  # type: ignore[union-attr]
    )


def test_nala_swapping_the_block_under_a_readers_link_makes_the_check_nalas_proposal() -> None:
    """Review of PR 1019, S1: Nala replaced a Grover block with Shor under the same id, and
    the reader's accepted check stayed theirs and accepted, now evidence for Nala's
    Shor block. Changing what a link points at is moving the link."""
    parent = enforce_check_authorship(
        _spec(_block(author="user", accepted=True), _users_linked_check()), None, "user"
    )
    swapped = parent.with_cells(
        [
            _block(**{**SHOR, "size_param": None}) if cell.id == "b01" else cell
            for cell in parent.cells
        ]
    )
    prop = enforce_check_authorship(swapped, parent, "nala").cell_by_id("k01").property
    assert prop is not None and (prop.author, prop.accepted) == ("nala", False)


def test_nala_swapping_two_blocks_ids_is_the_same_move() -> None:
    grover = _block("b01", author="user", accepted=True)
    shor = _block("b02", **{**SHOR, "size_param": None}, author="user", accepted=True)
    parent = enforce_check_authorship(_spec(grover, shor, _users_linked_check("b01")), None, "user")
    grover_as_b02 = grover.model_copy(update={"id": "b02"})
    shor_as_b01 = shor.model_copy(update={"id": "b01"})
    swapped = parent.with_cells([parent.cells[0], shor_as_b01, grover_as_b02, parent.cells[3]])
    prop = enforce_check_authorship(swapped, parent, "nala").cell_by_id("k01").property
    assert prop is not None and (prop.author, prop.accepted) == ("nala", False)
    # Following the Grover block to its new id is not a move: the check stays the reader's.
    followed = swapped.with_cells(
        [
            cell.model_copy(update={"property": cell.property.model_copy(update={"block": "b02"})})
            if cell.property is not None
            else cell
            for cell in swapped.cells
        ]
    )
    kept = enforce_check_authorship(followed, parent, "nala").cell_by_id("k01").property
    assert kept is not None and (kept.author, kept.accepted) == ("user", True)


def test_nala_replacing_a_linked_block_with_prose_drops_the_link_not_the_revision() -> None:
    """Review of PR 1019, S3: the spec refused a link to a cell that is no longer a block,
    so the whole revise failed. On Nala's path the link goes, as for a deleted block."""
    from leona_notebooks.revision import RevisionOp, RevisionPlan, apply_revision

    parent = enforce_check_authorship(_spec(_block(), _users_linked_check()), None, "user")
    plan = RevisionPlan(
        reply="",
        ops=[
            RevisionOp(
                op="replace", cell_id="b01", cells_source="# %% [markdown] role=explain\nProse.\n"
            )
        ],
    )
    revised = apply_revision(parent, plan)
    assert revised.cell_by_id("b01").role.value == "explain"  # type: ignore[union-attr]
    assert revised.cell_by_id("k01").property.block is None  # type: ignore[union-attr]


def test_a_repair_that_deletes_a_block_reports_only_the_block_as_put_back() -> None:
    """Nit from review of PR 1019: the check whose link the spec dropped with the block was
    reported as restored too, although the repair never touched it."""
    before = enforce_check_authorship(_spec(_block(), _users_linked_check()), None, "user")
    after = NotebookSpec.model_validate(
        {**before.model_dump(), "cells": [c.model_dump() for c in before.cells if c.id != "b01"]}
    )
    assert after.cell_by_id("k01").property.block is None  # type: ignore[union-attr]
    restored, ids = restore_checks(before, after)
    assert ids == ["b01"]
    assert restored.cell_by_id("k01").property.block == "b01"  # type: ignore[union-attr]
