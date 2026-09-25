"""`plan_workflow`: a problem, its sizes and the chosen blocks in; stages and cited costs out.

The Python counterpart of `planWorkflow` in `apps/web/lib/workflow-planner/index.ts`,
minus its first step: the TS planner reads the problem and its numbers out of a
sentence (`recognise.ts`), and this one is called by a model through the connector,
which sends them as structured input instead. Every parameter starts where an empty
sentence leaves it (its stated assumption, or unset), and the caller's values
override it exactly as a value typed on the page does (`applyReaderValues`),
including being refused as `invalid` when out of range.

`input_errors` is the stricter check `POST /v1/plans` applies before any of that: an
out-of-range value, an undeclared parameter, or an oversized choice map is a 422
with the reason, not a quietly invalid plan.
"""

from __future__ import annotations

import math
import re
from typing import Any

from . import _jsmath as js
from ._data import Node, ParamSpec, PlannerData, Problem, load
from .assemble import READER, Stage, assemble_workflow, compile_stage, flatten
from .costs import LOGICAL_KEYS, CostReport, cost_report

#: Reader edits keyed by stage path, at most this many — `STUDIO_PLAN_LINK_MAX_CHOICES`,
#: the cap the planner's own Studio link already holds a choice map to.
MAX_CHOICES = 32
#: A stage path is capability ids joined by `/`, at most `max_stage_depth + 1` deep; a
#: path longer than this names no stage.
MAX_PATH_CHARS = 400
MAX_METHOD_CHARS = 120
#: Graph ids are kebab-case; a path is those joined by `/`.
_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_PATH = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")

#: `physicalRequestPoints`' bounds: `POST /v1/estimates/logical` refuses anything larger.
MAX_LOGICAL_QUBITS = 1e8
MAX_GATE_COUNT = 1e20


class UnknownProblem(ValueError):
    """The problem id is not one the planner has."""


def problem_ids(data: PlannerData | None = None) -> list[str]:
    return list((data or load()).problems)


# ---------------------------------------------------------------------------
# Input


def within_spec(spec: ParamSpec, value: float) -> bool:
    """`withinSpec` in TS: finite, inside the range, and whole where it counts something."""
    if not math.isfinite(value) or value < spec.min or value > spec.max:
        return False
    return not spec.integer or float(value).is_integer()


def _spec_words(spec: ParamSpec) -> str:
    whole = "a whole number " if spec.integer else ""
    return f"{whole}from {js.number_string(spec.min)} to {js.number_string(spec.max)}"


def input_errors(
    problem: str,
    params: dict[str, float | None] | None = None,
    choices: dict[str, str] | None = None,
    *,
    data: PlannerData | None = None,
) -> list[str]:
    """Everything wrong with a request, in words a calling model can act on. Empty is fine.

    Stricter than the page on purpose: the page marks a bad typed value `invalid`
    and shows why, while a caller that sent one should be told, not handed a plan
    with a hole in it.
    """
    data = data or load()
    spec = data.problems.get(problem)
    if spec is None:
        return [f"unknown problem {problem!r}; the planner has {', '.join(data.problems)}"]
    errors: list[str] = []
    declared = {param.key: param for param in spec.params}
    for key, value in (params or {}).items():
        param = declared.get(key)
        if param is None:
            known = ", ".join(declared) or "none"
            errors.append(f"{problem} has no parameter {key!r}; its parameters are {known}")
            continue
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int | float):
            errors.append(f"{key} must be a number or null")
            continue
        if not within_spec(param, float(value)):
            errors.append(f"{key} must be {_spec_words(param)}; got {value!r}")
    choices = choices or {}
    if len(choices) > MAX_CHOICES:
        errors.append(f"at most {MAX_CHOICES} choices; got {len(choices)}")
    for path, method in choices.items():
        if len(path) > MAX_PATH_CHARS or not _PATH.match(path):
            errors.append(f"choice path {path[:80]!r} is not a stage path (ids joined by '/')")
        if not isinstance(method, str) or len(method) > MAX_METHOD_CHARS or not _ID.match(method):
            errors.append(f"choice for {path[:80]!r} is not a method id")
    return errors


def _starting_values(problem: Problem) -> dict[str, dict[str, Any]]:
    """`readParams(problem, "")`: each parameter's stated assumption, else unset.

    `plannerPortData` checks, in TS, that an empty sentence reads nothing, so this is
    what the page starts from too.
    """
    out: dict[str, dict[str, Any]] = {}
    for spec in problem.params:
        if spec.assumed is not None:
            out[spec.key] = {
                "value": float(spec.assumed["value"]),
                "origin": "assumed",
                "assumed_reason": spec.assumed["reason"],
                "assumed_source": spec.assumed["source"],
            }
        else:
            out[spec.key] = {"value": None, "origin": "unset"}
    return out


def _apply_caller_values(
    problem: Problem, params: dict[str, dict[str, Any]], typed: dict[str, float | None] | None
) -> dict[str, dict[str, Any]]:
    """`applyReaderValues` in `index.ts`: a typed value replaces the starting one."""
    if not typed:
        return params
    out: dict[str, dict[str, Any]] = {}
    for spec in problem.params:
        current = params.get(spec.key) or {"value": None, "origin": "unset"}
        if spec.key not in typed:
            out[spec.key] = current
            continue
        value = typed[spec.key]
        if value is None:
            out[spec.key] = {"value": None, "origin": "unset"}
        elif isinstance(value, bool) or not isinstance(value, int | float):
            out[spec.key] = {"value": None, "origin": "invalid"}
        elif not within_spec(spec, float(value)):
            out[spec.key] = {"value": None, "origin": "invalid"}
        else:
            out[spec.key] = {"value": float(value), "origin": "reader"}
    return out


# ---------------------------------------------------------------------------
# Output


def number(value: float | None) -> int | float | None:
    """A value as JSON carries it: what `JSON.stringify` would print, typed for Python.

    NaN and ±Infinity become null (JSON has neither, and `JSON.stringify` prints
    null), and an integral value a double holds exactly becomes an `int`, so a
    count reads `6210`, not `6210.0`.
    """
    if value is None or not math.isfinite(value):
        return None
    if float(value).is_integer() and abs(value) < 2**53:
        return int(value)
    return value


def _node_ref(node: Node, *, with_cost: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {"id": node.id, "label": node.label}
    if with_cost:
        out["stated_cost"] = node.cost
    return out


def _stage_json(stage: Stage) -> dict[str, Any]:
    return {
        "path": stage.path,
        "depth": stage.depth,
        "capability": _node_ref(stage.capability),
        "method": _node_ref(stage.method, with_cost=True) if stage.method else None,
        "choice": stage.choice,
        "reason": stage.reason,
        "alternatives": [_node_ref(node) for node in stage.alternatives],
        "repeat": stage.repeat,
        "stop": stage.stop,
    }


def _line_json(line: dict[str, Any]) -> dict[str, Any]:
    return {**line, "value": number(line["value"])}


def _estimate_point(
    problem: Problem, params: dict[str, dict[str, Any]], report: CostReport
) -> dict[str, Any] | None:
    """The one point `physicalRequestPoints` (`scaling.ts`) would send for these values.

    It needs a logical qubit count and at least one magic-state count; a missing
    count is left out rather than sent as zero, because zero Toffolis is a claim the
    algorithm needs none. A `scaling` line is a magnitude, never a count, so it is
    never sent. Past the estimate route's own bounds the point is left out rather
    than sent to be refused.
    """
    first = next((spec for spec in problem.params if params[spec.key]["value"] is not None), None)
    if first is None:
        return None

    def count(key: str) -> float | None:
        line = report.logical.get(key)
        if line is None or line["kind"] == "scaling":
            return None
        v = line["value"]
        return v if v is not None and math.isfinite(v) else None

    qubits, toffolis, t_gates = count("logical_qubits"), count("toffolis"), count("t_gates")
    if qubits is None or (toffolis is None and t_gates is None):
        return None
    depth = count("serial_depth")
    if qubits > MAX_LOGICAL_QUBITS or any(
        v is not None and v > MAX_GATE_COUNT for v in (toffolis, t_gates, depth)
    ):
        return None
    return {
        "label": f"{problem.id} (Leona planner)",
        "parameter_value": number(params[first.key]["value"]),
        "logical_qubits": number(js.ceil(qubits)),
        "toffoli_count": number(js.js_round(toffolis if toffolis is not None else 0.0)),
        "t_count": number(js.js_round(t_gates if t_gates is not None else 0.0)),
        "non_clifford_depth": number(js.js_round(depth if depth is not None else 0.0)),
    }


def _ignored_choices(choices: dict[str, str], stages: list[Stage]) -> list[dict[str, str]]:
    """Choices the planner did not follow, and why: the page ignores them silently, and a
    calling model should hear that its choice was not taken."""
    by_path = {stage.path: stage for stage in stages}
    out: list[dict[str, str]] = []
    for path, method in choices.items():
        stage = by_path.get(path)
        if stage is None:
            reason = "no stage in this pipeline has that path"
        elif stage.choice != READER or stage.method is None or stage.method.id != method:
            reason = (
                f"{method!r} is not a method that realises {stage.capability.id}; "
                "the stage lists its alternatives"
            )
        else:
            continue
        out.append({"path": path, "method": method, "reason": reason})
    return out


def _sources(data: PlannerData, keys: list[str | None]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in keys:
        if key and key not in out:
            source = data.sources[key]
            paper = source["paper"]
            out[key] = {
                "paper_id": source["paper_id"],
                "title": paper["title"],
                "authors": paper["authors"],
                "year": paper["year"],
                "url": paper["url"],
                "locator": source["locator"],
                "quote": source["quote"],
            }
    return out


def plan_workflow(
    problem: str,
    params: dict[str, float | None] | None = None,
    choices: dict[str, str] | None = None,
    *,
    data: PlannerData | None = None,
) -> dict[str, Any]:
    """The planner's answer for `problem` at `params` with `choices`, as JSON.

    `params` maps a parameter key to the value the caller typed, or None to clear a
    stated assumption. `choices` maps a stage path (as the answer's stages carry it)
    to the method to use there. Raises `UnknownProblem` for a problem the planner does
    not have; everything else is answered, the way the page answers it.
    """
    data = data or load()
    spec = data.problems.get(problem)
    if spec is None:
        raise UnknownProblem(
            f"unknown problem {problem!r}; the planner has {', '.join(data.problems)}"
        )
    choices = dict(choices or {})
    values = _apply_caller_values(spec, _starting_values(spec), params)
    root = assemble_workflow(data, spec, choices)
    compile_root = compile_stage(data, root, choices)
    report = cost_report(data, spec.id, values, root)
    stages, compile_stages = flatten(root), flatten(compile_root)
    all_lines = [*report.lines, *report.classical, *report.published]
    return {
        "problem": {"id": spec.id, "label": spec.label, "capability": spec.capability},
        "params": [
            {
                "key": param.key,
                "label": param.label,
                "unit": param.unit,
                "value": number(values[param.key]["value"]),
                "origin": values[param.key]["origin"],
                "assumed_reason": values[param.key].get("assumed_reason"),
                "assumed_source": values[param.key].get("assumed_source"),
                "min": number(param.min),
                "max": number(param.max),
                "integer": param.integer,
            }
            for param in spec.params
        ],
        "stages": [_stage_json(stage) for stage in stages],
        "compile_stages": [_stage_json(stage) for stage in compile_stages],
        "lines": [_line_json(line) for line in report.lines],
        "classical": [_line_json(line) for line in report.classical],
        "published": [_line_json(line) for line in report.published],
        "logical": {key: (report.logical[key] or {}).get("id") for key in LOGICAL_KEYS},
        "notes": [{"id": note, "text": data.notes[note]} for note in report.notes],
        "estimate_point": _estimate_point(spec, values, report),
        "sources": _sources(
            data,
            [line["source"] for line in all_lines]
            + [values[p.key].get("assumed_source") for p in spec.params],
        ),
        "ignored_choices": _ignored_choices(choices, stages + compile_stages),
    }


__all__ = [
    "MAX_CHOICES",
    "MAX_METHOD_CHARS",
    "MAX_PATH_CHARS",
    "UnknownProblem",
    "input_errors",
    "number",
    "plan_workflow",
    "problem_ids",
    "within_spec",
]
