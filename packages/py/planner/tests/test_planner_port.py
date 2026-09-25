"""What the port adds around the ported arithmetic: input checks, JSON shape, provenance.

The arithmetic and assembly themselves are `test_planner_parity.py`'s. These are the parts
with no TS counterpart to compare against, so each is asserted directly.
"""

from __future__ import annotations

import json

import pytest

from leona_planner import (
    MAX_CHOICES,
    UnknownProblem,
    input_errors,
    number,
    plan_workflow,
    problem_ids,
)


def test_every_problem_plans_with_nothing_typed_and_the_answer_is_plain_json():
    for problem in problem_ids():
        plan = plan_workflow(problem)
        # allow_nan=False is what the API's JSON response does: a NaN or Infinity
        # reaching the answer would be a 500 there, not a number.
        json.dumps(plan, allow_nan=False)
        assert plan["stages"], problem
        assert plan["compile_stages"], problem


def test_a_count_is_an_int_and_a_missing_value_is_null_never_nan():
    assert number(6190.0) == 6190 and isinstance(number(6190.0), int)
    assert number(2624225017.856) == 2624225017.856
    assert number(float("nan")) is None
    assert number(float("inf")) is None
    assert isinstance(number(2.0**60), float)


def test_an_unknown_problem_is_refused_by_name():
    with pytest.raises(UnknownProblem, match="the planner has search"):
        plan_workflow("teleportation")
    assert input_errors("teleportation") == [
        "unknown problem 'teleportation'; the planner has " + ", ".join(problem_ids())
    ]


@pytest.mark.parametrize(
    ("params", "words"),
    [
        ({"bits": 7}, "bits must be a whole number from 8 to 16384; got 7"),
        ({"bits": 16385}, "bits must be a whole number from 8 to 16384"),
        ({"bits": 2048.5}, "bits must be a whole number"),
        ({"bits": float("inf")}, "bits must be a whole number"),
        ({"bits": "2048"}, "bits must be a number or null"),
        ({"bits": True}, "bits must be a number or null"),
        ({"kappa": 10}, "factoring has no parameter 'kappa'; its parameters are bits"),
    ],
)
def test_the_api_refuses_what_the_page_would_mark_invalid(params, words):
    errors = input_errors("factoring", params)
    assert len(errors) == 1 and words in errors[0], errors


def test_a_null_clears_an_assumption_and_is_not_an_error():
    assert input_errors("factoring", {"bits": None}) == []
    plan = plan_workflow("factoring", {"bits": None})
    [bits] = plan["params"]
    assert (bits["value"], bits["origin"]) == (None, "unset")
    assert plan["lines"][0]["value"] is None
    assert plan["lines"][0]["missing"] == ["bits"]


def test_the_choice_map_is_bounded_and_shaped_like_stage_paths():
    too_many = {
        f"hidden-period-finding/step-{i}": "cyclic-period-finding" for i in range(MAX_CHOICES + 1)
    }
    assert any("at most 32 choices" in e for e in input_errors("factoring", {}, too_many))
    assert input_errors("factoring", {}, {"../etc": "x"}) != []
    assert input_errors("factoring", {}, {"hidden-period-finding": "Not An Id"}) != []
    assert input_errors("factoring", {}, {"hidden-period-finding": "cyclic-period-finding"}) == []


def test_a_choice_the_planner_did_not_follow_is_said_rather_than_dropped():
    plan = plan_workflow(
        "ground-state",
        {"lambda": 500, "orbitals": 100},
        {
            "ground-state-energy": "no-such-method",
            "ground-state-energy/no-such-step": "qubitization-simulation",
        },
    )
    ignored = {entry["path"]: entry["reason"] for entry in plan["ignored_choices"]}
    assert "not a method that realises ground-state-energy" in ignored["ground-state-energy"]
    assert ignored["ground-state-energy/no-such-step"] == "no stage in this pipeline has that path"
    # And the default still applied at the root.
    assert plan["stages"][0]["method"]["id"] == "phase-estimation-ground-state"


def test_a_followed_choice_is_marked_as_the_callers():
    plan = plan_workflow(
        "ground-state",
        {"lambda": 500, "orbitals": 100},
        {"ground-state-energy": "variational-ground-state"},
    )
    assert plan["ignored_choices"] == []
    assert (plan["stages"][0]["method"]["id"], plan["stages"][0]["choice"]) == (
        "variational-ground-state",
        "reader",
    )
    assert [line["id"] for line in plan["lines"]] == ["wecker-measurements", "vqe-qubits"]


def test_every_cited_line_carries_its_paper_and_where_in_it():
    plan = plan_workflow("factoring", {"bits": 2048})
    cited = {line["source"] for line in plan["lines"] + plan["published"] if line["source"]}
    assert cited <= set(plan["sources"])
    ge = plan["sources"]["ge2021-logical"]
    assert ge["paper_id"] == "arxiv:1905.09749"
    assert ge["locator"]["en"] == "abstract"
    assert "3n + 0.002n lg n" in ge["quote"]
    assert ge["url"].startswith("https://")


def test_an_assumed_value_says_why_and_cites_its_source():
    plan = plan_workflow("search", {"domainSize": 2**20})
    marked = next(p for p in plan["params"] if p["key"] == "markedCount")
    assert (marked["value"], marked["origin"]) == (1, "assumed")
    assert marked["assumed_source"] == "grover-unique"
    assert "grover-unique" in plan["sources"]


def test_a_scaling_line_is_never_sent_to_the_estimator():
    """`qubitization-leading` is a magnitude with no constant (`types.ts`: never a count),
    so a plan whose only figure it is has no estimate point."""
    plan = plan_workflow("hamiltonian-simulation", {"lambda": 100, "time": 100})
    [line] = plan["lines"]
    assert line["kind"] == "scaling" and line["value"] == 10000
    assert plan["logical"]["queries"] is None
    assert plan["estimate_point"] is None


def test_boyer_et_al_s_own_number_comes_back():
    """Arithmetic against the SOURCE, as `workflow-planner.test.ts` does: Boyer et al.
    print 804 iterations for N = 2^20 and one marked item."""
    plan = plan_workflow("search", {"domainSize": 2**20, "markedCount": 1})
    assert plan["lines"][0]["id"] == "grover-iterations"
    assert plan["lines"][0]["value"] == 804
