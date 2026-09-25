"""The Python port answers every grid point exactly as the TypeScript planner does.

Owner ruling, ai-ops 382 (2026-09-25): "Port only the arithmetic to Python now. CI
runs both on a grid of inputs and fails if any number differs." This file is that
gate's Python half. `parity_grid.json` holds what `apps/web/lib/workflow-planner`
answered for each input, written by `scripts/write-planner-fixture.ts`; the TS half,
`apps/web/lib/workflow-planner-python-port.test.ts`, fails when that file (or the
port's data) is not what the TS code produces today.

## What is compared, and how exactly

Every field of every answer is compared exactly, strings and ids and lists included,
with one exception: a number that is not an integer below 2**53.

- **An integer below 2**53 must be equal.** Iteration counts, qubit counts, register
  sizes, `2**m - 1`: every one comes out of `floor`/`ceil`/`Math.round` or integer
  arithmetic, and a double holds these exactly, so the two languages either agree or
  one of them has a different formula.
- **Anything else must agree to a relative 1e-12.** V8 evaluates `Math.log2`,
  `Math.log`, `Math.asin`, `Math.sin` and `**` with its own ports of fdlibm; Python
  calls the platform's libm (macOS's on a laptop, glibc's in CI). Each is accurate to
  about one unit in the last place (ulp, 2**-52 relative, about 2.2e-16), not
  correctly rounded, so the same expression can differ in its last bit or two. The
  longest chain in the port is Babbush et al.'s ancilla count, five `**` and a `log2`
  feeding one another: a few ulp at most, under 1e-15 relative. 1e-12 is roughly 4,500
  ulp: about three orders of magnitude above what libm disagreement can produce, and
  six or more below a formula error. The smallest real change a formula here can
  suffer, one constant off in its last printed digit (Gidney–Ekerå's 0.0005 written
  0.0006), moves the Toffoli count by 1e-3 to 5e-3 relative on this grid (the
  mutation check in the PR that added this file; it failed here, as did +1 on a qubit
  count and a stage-depth cap one too small). Measured when this file was written
  (`MEASURED_MAX_RELATIVE_DIFFERENCE`): on macOS the largest relative difference over
  the grid's 557 inexact values was exactly 0, every one equal to the bit. Linux's
  glibc was not measured by hand; the CI run is that measurement, and
  `test_the_measured_disagreement_is_far_inside_the_tolerance` fails if it is ever
  within a factor of 100 of the tolerance.
- **Above 2**53 every double is an integer**, so integrality says nothing about how
  a value was computed (Chebyshev's sample count at ε = 1e-12 is about 1.3e24, and a
  one-ulp difference in π² moves it). Those are compared with the tolerance too.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import pytest

from leona_planner import plan_workflow
from leona_planner._data import load

GRID_PATH = Path(__file__).with_name("parity_grid.json")
GRID = json.loads(GRID_PATH.read_text("utf-8"))
REL_TOL = 1e-12
#: macOS 26, CPython 3.12, 2026-09-25: every inexact value equal to the bit. Quoted by
#: the module docstring; re-measured by the test at the bottom of this file.
MEASURED_MAX_RELATIVE_DIFFERENCE = 0.0
_EXACT_BELOW = 2.0**53

COSTS_TS = (
    Path(__file__).resolve().parents[4] / "apps" / "web" / "lib" / "workflow-planner" / "costs.ts"
)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _exact(ts: float) -> bool:
    return float(ts).is_integer() and abs(ts) < _EXACT_BELOW


def differences(ts: Any, py: Any, where: str = "", seen: list[float] | None = None) -> list[str]:
    """Every place `py` differs from `ts`, by the rules in the module docstring.

    `seen` collects the relative difference of every inexact comparison, for the
    measurement the docstring quotes.
    """
    if _is_number(ts) and _is_number(py):
        if _exact(ts):
            return (
                []
                if py == ts
                else [f"{where}: TS {ts!r}, Python {py!r} (an integer: must be equal)"]
            )
        relative = abs(py - ts) / abs(ts) if ts != 0 else abs(py)
        if seen is not None:
            seen.append(relative)
        return (
            []
            if relative <= REL_TOL
            else [f"{where}: TS {ts!r}, Python {py!r} (relative {relative:.2e})"]
        )
    if isinstance(ts, dict) and isinstance(py, dict):
        out: list[str] = []
        if set(ts) != set(py):
            out.append(f"{where}: keys differ, TS {sorted(ts)} vs Python {sorted(py)}")
        for key in sorted(set(ts) & set(py)):
            out += differences(ts[key], py[key], f"{where}.{key}", seen)
        return out
    if isinstance(ts, list) and isinstance(py, list):
        if len(ts) != len(py):
            return [f"{where}: TS has {len(ts)} entries, Python {len(py)}: {ts!r} vs {py!r}"[:600]]
        out = []
        for i, (a, b) in enumerate(zip(ts, py, strict=True)):
            out += differences(a, b, f"{where}[{i}]", seen)
        return out
    return [] if ts == py else [f"{where}: TS {ts!r}, Python {py!r}"[:600]]


# ---------------------------------------------------------------------------
# The port's answer, in the grid's shape (`answerAt`/`treeAt` in python-port.ts)


def _stage_rows(stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "path": stage["path"],
            "depth": stage["depth"],
            "capability": stage["capability"]["id"],
            "method": stage["method"]["id"] if stage["method"] else None,
            "choice": stage["choice"],
            "reason": stage["reason"],
            "repeat": stage["repeat"]["mark"]["en"] if stage["repeat"] else None,
            "stop": stage["stop"],
        }
        for stage in stages
    ]


def _line_rows(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keys = ("id", "value", "missing", "formula", "kind", "source")
    return [{key: line[key] for key in keys} for line in lines]


def port_answer(point: dict[str, Any]) -> dict[str, Any]:
    plan = plan_workflow(point["problem"], point["params"], point["choices"])
    return {
        "params": {p["key"]: {"value": p["value"], "origin": p["origin"]} for p in plan["params"]},
        "lines": _line_rows(plan["lines"]),
        "classical": _line_rows(plan["classical"]),
        "published": _line_rows(plan["published"]),
        "logical": plan["logical"],
        "notes": [note["id"] for note in plan["notes"]],
        "estimate_point": plan["estimate_point"],
    }


def port_tree(tree: dict[str, Any]) -> dict[str, Any]:
    plan = plan_workflow(tree["problem"], {}, tree["choices"])
    return {
        "stages": _stage_rows(plan["stages"]),
        "compile_stages": _stage_rows(plan["compile_stages"]),
    }


PROBLEMS = sorted({point["problem"] for point in GRID["points"]})


# ---------------------------------------------------------------------------


def test_the_grid_is_the_size_it_was_built_to_be():
    """A guard on the instrument. Every test below is "for each point, compare", which
    an empty or truncated grid satisfies vacuously."""
    assert GRID["format"] == 1
    assert len(GRID["points"]) >= 800, len(GRID["points"])
    assert len(GRID["trees"]) >= 300, len(GRID["trees"])
    assert PROBLEMS == sorted(load().problems), "the grid does not cover every problem"
    assert {tree for tree in (p["tree"] for p in GRID["points"])} == set(GRID["trees"])


@pytest.mark.parametrize("problem", PROBLEMS)
def test_every_cost_the_ts_planner_gives_the_port_gives_too(problem):
    failures: list[str] = []
    for point in (p for p in GRID["points"] if p["problem"] == problem):
        failures += differences(point["answer"], port_answer(point), point["id"])
    assert not failures, f"{len(failures)} differences, first ten:\n" + "\n".join(failures[:10])


@pytest.mark.parametrize("problem", PROBLEMS)
def test_every_pipeline_the_ts_planner_assembles_the_port_assembles_too(problem):
    failures: list[str] = []
    for key, tree in GRID["trees"].items():
        if tree["problem"] != problem:
            continue
        expected = {"stages": tree["stages"], "compile_stages": tree["compile_stages"]}
        failures += differences(expected, port_tree(tree), key)
    assert not failures, f"{len(failures)} differences, first ten:\n" + "\n".join(failures[:10])


def test_every_capability_offers_the_same_methods_in_the_same_order():
    """A stage's `alternatives` are every realiser of its capability in the graph's
    order, in both implementations, so they are compared once per capability here
    rather than at every stage of every tree."""
    data = load()
    port = {cap: [node.id for node in nodes] for cap, nodes in data.realisers.items()}
    assert port == GRID["realisers"]


def test_every_ts_cost_line_has_a_python_counterpart():
    """Every line id the TS planner prints on the grid is printed by the port somewhere
    on it too. The TS test holds the other end: every line costs.ts DECLARES is reached
    by the grid (and so is in the port's data)."""
    data = load()
    ts_ids = {
        line["id"]
        for point in GRID["points"]
        for field in ("lines", "classical", "published")
        for line in point["answer"][field]
    }
    assert ts_ids == set(data.lines), "the grid and the port's data disagree on the line ids"
    port_ids = {
        line["id"]
        for point in GRID["points"]
        for field in ("lines", "classical", "published")
        for line in port_answer(point)[field]
    }
    assert port_ids == ts_ids, f"no Python counterpart for {sorted(ts_ids - port_ids)}"


def test_the_line_ids_costs_ts_declares_are_the_ones_the_port_knows():
    """Read from the TS source text, independently of the grid and the data, where
    `apps/web` is in the checkout (an installed wheel ships no TS)."""
    if not COSTS_TS.exists():
        pytest.skip("apps/web is not in this checkout")
    declared = set(re.findall(r'id: "([a-z0-9-]+)",\s*label:', COSTS_TS.read_text("utf-8")))
    assert len(declared) >= 30, f"only {len(declared)} ids read; the pattern stopped matching"
    assert declared == set(load().lines)


def test_the_measured_disagreement_is_far_inside_the_tolerance():
    """The number the module docstring quotes, re-measured: if libm disagreement ever
    grows to within a factor of 100 of the tolerance (about 45 ulp), the tolerance is
    no longer clearly telling formula errors apart from rounding and needs another look."""
    seen: list[float] = []
    for point in GRID["points"]:
        differences(point["answer"], port_answer(point), point["id"], seen)
    worst = max(seen)
    assert len(seen) >= 500, f"only {len(seen)} inexact comparisons; the measurement means nothing"
    assert worst <= REL_TOL / 100, (
        f"largest relative difference {worst:.3e} over {len(seen)} values"
    )


# ---------------------------------------------------------------------------
# Controls on the comparator itself


def test_the_comparator_catches_a_one_off_integer_and_a_formula_sized_float_change():
    assert differences({"v": 804}, {"v": 805}) != []
    assert differences({"v": 804}, {"v": 804.0}) == []
    assert differences({"v": 2624225017.856}, {"v": 2624225017.856 * (1 + 1e-9)}) != []
    # One ulp, which is what libm disagreement looks like, passes.
    assert differences({"v": 2624225017.856}, {"v": math.nextafter(2624225017.856, math.inf)}) == []
    assert differences({"v": None}, {"v": 0}) != []
    assert differences({"notes": ["a"]}, {"notes": []}) != []
