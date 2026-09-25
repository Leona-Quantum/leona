"""`BlockRef`, `BlockPlan`, `CheckProperty.block` and the block-cell rules on `Cell` and
`NotebookSpec` (Phase B slice S1): a block stores the planner's inputs and never a number,
its plan is held to the problem it names, and a check's link to a block names a block."""

from __future__ import annotations

import typing

import pytest
from pydantic import ValidationError

from majorana_contracts.notebooks import (
    PLANNER_PROBLEM_PARAMS,
    BlockPlan,
    BlockRef,
    Cell,
    CheckProperty,
    NotebookSpec,
    PlannerProblemId,
)

GROVER = {
    "method": "grover-fixed-iteration-search",
    "plan": {"problem": "search", "params": {"domainSize": 1024, "markedCount": 1}},
    "size_param": "domainSize",
}


def _block_cell(cell_id: str = "b01", **block: object) -> dict:
    return {"id": cell_id, "kind": "markdown", "role": "block", "block": block or GROVER}


def _check_cell(cell_id: str, block: str | None) -> dict:
    return {
        "id": cell_id,
        "kind": "code",
        "role": "check",
        "property": {"kind": "value", "subject": "x", "value": 1.0, "block": block},
    }


def test_the_problem_literal_and_the_parameter_table_name_the_same_problems() -> None:
    assert set(PLANNER_PROBLEM_PARAMS) == set(typing.get_args(PlannerProblemId))


def test_a_block_with_a_plan_and_one_without_both_validate() -> None:
    with_plan = BlockRef.model_validate(GROVER)
    assert with_plan.plan is not None and with_plan.plan.params["domainSize"] == 1024
    assert (with_plan.author, with_plan.accepted) == ("nala", False)
    prose_only = BlockRef.model_validate({"method": "koopman-linearization"})
    assert prose_only.plan is None and prose_only.size_param is None


@pytest.mark.parametrize(
    ("data", "words"),
    [
        ({"method": "Grover Search"}, "not an Atlas method id"),
        ({"method": "x", "size_param": "domainSize"}, "needs a plan"),
        (
            {"method": "x", "plan": {"problem": "search"}, "size_param": "bits"},
            "not a parameter of the search problem",
        ),
        ({"method": "x", "author": "source"}, "needs a citation"),
    ],
)
def test_a_block_refuses_what_it_cannot_mean(data: dict, words: str) -> None:
    with pytest.raises(ValidationError, match=words):
        BlockRef.model_validate(data)


@pytest.mark.parametrize(
    ("plan", "words"),
    [
        ({"problem": "sorting"}, "problem"),
        ({"problem": "search", "params": {"bits": 8}}, "has no parameter 'bits'"),
        ({"problem": "search", "params": {"domainSize": float("inf")}}, "not a finite number"),
        ({"problem": "search", "choices": {"Not A Path": "m"}}, "not a stage path"),
        (
            {"problem": "search", "choices": {"marked-item-search": "Bad Id"}},
            "not a method id",
        ),
        (
            {"problem": "search", "choices": {f"cap-{i}": "m" for i in range(33)}},
            "at most 32 choices",
        ),
    ],
)
def test_a_plan_is_held_to_the_problem_it_names(plan: dict, words: str) -> None:
    with pytest.raises(ValidationError, match=words):
        BlockPlan.model_validate(plan)


def test_a_plan_value_may_be_cleared_with_null() -> None:
    plan = BlockPlan.model_validate({"problem": "search", "params": {"markedCount": None}})
    assert plan.params == {"markedCount": None}


def test_a_block_cell_is_markdown_and_only_a_block_cell_carries_a_block() -> None:
    Cell.model_validate(_block_cell())
    with pytest.raises(ValidationError, match="needs a block"):
        Cell.model_validate({"id": "b01", "kind": "markdown", "role": "block"})
    with pytest.raises(ValidationError, match="must be a markdown cell"):
        Cell.model_validate({**_block_cell(), "kind": "code"})
    with pytest.raises(ValidationError, match="only role=block cells carry a block"):
        Cell.model_validate({**_block_cell(), "role": "concept"})


def test_a_checks_link_is_outside_what_the_check_judges() -> None:
    linked = CheckProperty.model_validate(
        {"kind": "value", "subject": "x", "value": 1.0, "block": "b01"}
    )
    unlinked = linked.model_copy(update={"block": None})
    assert linked.expectation_key() == unlinked.expectation_key()
    with pytest.raises(ValidationError, match="must be a cell id"):
        CheckProperty.model_validate(
            {"kind": "value", "subject": "x", "value": 1.0, "block": "B 1"}
        )


def test_a_link_to_a_cell_that_is_not_a_block_is_refused() -> None:
    with pytest.raises(ValidationError, match="not a role=block cell"):
        NotebookSpec.model_validate(
            {
                "slug": "s",
                "title": "t",
                "cells": [
                    {"id": "c01", "kind": "code", "source": "x = 1\n"},
                    _check_cell("k01", "c01"),
                ],
            }
        )


def test_a_link_to_a_deleted_block_is_dropped_and_the_check_kept() -> None:
    spec = NotebookSpec.model_validate(
        {
            "slug": "s",
            "title": "t",
            "cells": [_block_cell(), _check_cell("k01", "b01"), _check_cell("k02", "gone")],
        }
    )
    links = {cell.id: cell.property.block for cell in spec.cells if cell.property is not None}
    assert links == {"k01": "b01", "k02": None}


def _lesson_with_a_block() -> dict:
    return {
        "slug": "s",
        "title": "Grover",
        "kind": "lesson",
        "cells": [
            {"id": "c01", "kind": "markdown", "role": "concept", "source": "Search."},
            _block_cell(),
            {"id": "c02", "kind": "code", "role": "run", "source": "x = 1\n"},
            _check_cell("k01", "b01"),
        ],
    }


def test_a_lesson_with_nothing_secret_keeps_its_blocks_for_every_reader() -> None:
    spec = NotebookSpec.model_validate(_lesson_with_a_block())
    learner = spec.for_learner()
    assert [cell.id for cell in learner.cells] == ["c01", "b01", "c02", "k01"]
    assert learner.leaks_answer_key() == []


def test_a_notebook_with_an_exercise_drops_its_blocks_for_a_learner() -> None:
    """A Grover block's cost at the plan's size is the iteration count an exercise on
    the same search asks for. In a notebook with anything secret, every door drops it."""
    data = _lesson_with_a_block()
    data["cells"].append(
        {"id": "c03", "kind": "markdown", "role": "exercise", "source": "How many iterations?"}
    )
    spec = NotebookSpec.model_validate(data)
    assert spec.carries_secrets()
    assert "b01" in spec.leaks_answer_key()
    learner = spec.for_learner()
    assert all(cell.block is None for cell in learner.cells)
    assert "b01" not in [cell.id for cell in learner.cells]
    assert learner.leaks_answer_key() == []
    # A learner build a block was smuggled back into is named as leaking.
    smuggled = learner.with_cells([*learner.cells, spec.cell_by_id("b01")])
    assert "b01" in smuggled.leaks_answer_key()
