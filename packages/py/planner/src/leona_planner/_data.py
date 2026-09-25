"""The planner's words and structure, read from `planner_data.json`.

Nothing in this file is authored here. `scripts/write-planner-fixture.ts` writes the
JSON from the TypeScript planner (`apps/web/lib/workflow-planner/python-port.ts`),
and `apps/web/lib/workflow-planner-python-port.test.ts` fails when the committed copy
is not what that code produces today. This module only loads it once and indexes it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Any

#: The data file's shape this loader understands (`PLANNER_PORT_FORMAT` in TS).
FORMAT = 1

Bilingual = dict[str, str]


@dataclass(frozen=True, eq=False)
class Node:
    """A capability or method of the layer graph, as the planner walks it."""

    id: str
    kind: str
    label: Bilingual
    short_label: Bilingual | None
    realizes: str | None
    steps: tuple[str, ...]
    via: dict[str, str]
    repeats: dict[str, dict[str, Bilingual]]
    cost: Bilingual | None


@dataclass(frozen=True, eq=False)
class ParamSpec:
    key: str
    label: Bilingual
    hint: Bilingual
    unit: Bilingual | None
    min: float
    max: float
    integer: bool
    assumed: dict[str, Any] | None


@dataclass(frozen=True, eq=False)
class Problem:
    id: str
    label: Bilingual
    capability: str
    preferred_methods: tuple[str, ...]
    step_defaults: dict[str, dict[str, Any]]
    params: tuple[ParamSpec, ...]
    example: Bilingual


@dataclass(frozen=True, eq=False)
class PlannerData:
    max_stage_depth: int
    compile_capability: str
    runs_without_error_correction: frozenset[str]
    problems: dict[str, Problem]
    nodes: dict[str, Node]
    #: Capability id -> the methods realising it, in the graph's authored order.
    realisers: dict[str, tuple[Node, ...]]
    lines: dict[str, dict[str, Any]]
    notes: dict[str, Bilingual]
    sources: dict[str, dict[str, Any]]
    gidney_2025_table_5: dict[str, tuple[float, float]]


def _node(raw: dict[str, Any]) -> Node:
    return Node(
        id=raw["id"],
        kind=raw["kind"],
        label=raw["label"],
        short_label=raw["short_label"],
        realizes=raw["realizes"],
        steps=tuple(raw["steps"]),
        via=dict(raw["via"]),
        repeats=dict(raw["repeats"]),
        cost=raw["cost"],
    )


def _problem(raw: dict[str, Any]) -> Problem:
    return Problem(
        id=raw["id"],
        label=raw["label"],
        capability=raw["capability"],
        preferred_methods=tuple(raw["preferred_methods"]),
        step_defaults=dict(raw["step_defaults"]),
        params=tuple(
            ParamSpec(
                key=spec["key"],
                label=spec["label"],
                hint=spec["hint"],
                unit=spec["unit"],
                min=float(spec["min"]),
                max=float(spec["max"]),
                integer=bool(spec["integer"]),
                assumed=spec["assumed"],
            )
            for spec in raw["params"]
        ),
        example=raw["example"],
    )


def parse(raw: dict[str, Any]) -> PlannerData:
    if raw.get("format") != FORMAT:
        raise ValueError(
            f"planner_data.json is format {raw.get('format')!r}; this loader reads {FORMAT}. "
            "Regenerate it with scripts/write-planner-fixture.ts and update the port."
        )
    nodes = {entry["id"]: _node(entry) for entry in raw["graph"]}
    realisers: dict[str, list[Node]] = {}
    for node in nodes.values():  # dicts keep insertion order: the graph's order
        if node.kind == "method" and node.realizes:
            realisers.setdefault(node.realizes, []).append(node)
    return PlannerData(
        max_stage_depth=int(raw["max_stage_depth"]),
        compile_capability=raw["compile_capability"],
        runs_without_error_correction=frozenset(raw["runs_without_error_correction"]),
        problems={entry["id"]: _problem(entry) for entry in raw["problems"]},
        nodes=nodes,
        realisers={capability: tuple(methods) for capability, methods in realisers.items()},
        lines=dict(raw["lines"]),
        notes=dict(raw["notes"]),
        sources=dict(raw["sources"]),
        gidney_2025_table_5={
            bits: (float(row[0]), float(row[1])) for bits, row in raw["gidney_2025_table_5"].items()
        },
    )


@cache
def load() -> PlannerData:
    text = resources.files("leona_planner").joinpath("planner_data.json").read_text("utf-8")
    return parse(json.loads(text))
