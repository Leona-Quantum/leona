"""From a problem to a workflow: the walk down the layer graph, ported from `assemble.ts`.

`apps/web/lib/workflow-planner/assemble.ts` is the source of truth, and its module
comment is the rule this file follows: a workflow is one method chosen at every
capability on a walk down the graph's containment, the default at each position is
the reader's pick, else the parent's own `via`, else a planner preference, else the
first realiser, and the walk stops (visibly) at a capability already on the path and
below `max_stage_depth`. The parity grid assembles every choice the default pipeline
offers in both implementations and fails on any difference.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ._data import Node, PlannerData, Problem

#: `StageChoice` in TS.
READER, PUBLISHED, PREFERRED, FIRST, NONE = "reader", "published", "preferred", "first", "none"

#: The only choice at the root of the compile step the planner makes for a method
#: built to run without error correction, and for everything else (`compileStage`).
NISQ_COMPILE = "nisq-transpilation"
FAULT_TOLERANT_COMPILE = "fault-tolerant-compilation"


@dataclass(eq=False)
class Stage:
    path: str
    depth: int
    capability: Node
    method: Node | None
    choice: str
    reason: dict[str, str] | None
    alternatives: tuple[Node, ...]
    repeat: dict[str, Any] | None
    children: list[Stage] = field(default_factory=list)
    stop: str | None = None


def _choose(
    data: PlannerData,
    capability: str,
    path: str,
    choices: dict[str, str],
    parent: Node | None,
    preferred: tuple[str, ...],
    step_default: dict[str, Any] | None,
) -> tuple[Node | None, str, dict[str, str] | None]:
    realisers = data.realisers.get(capability, ())

    def by_id(wanted: str | None) -> Node | None:
        return next((node for node in realisers if node.id == wanted), None)

    reader = by_id(choices.get(path))
    if reader:
        return reader, READER, None
    published = by_id(parent.via.get(capability) if parent else None)
    if published:
        return published, PUBLISHED, None
    defaulted = by_id(step_default["method"] if step_default else None)
    if defaulted and step_default:
        return defaulted, PREFERRED, step_default["reason"]
    for wanted in preferred:
        node = by_id(wanted)
        if node:
            return node, PREFERRED, None
    first = realisers[0] if realisers else None
    return first, FIRST if first else NONE, None


def _build(
    data: PlannerData,
    capability_id: str,
    path: str,
    depth: int,
    on_path: frozenset[str],
    choices: dict[str, str],
    parent: Node | None,
    preferred: tuple[str, ...],
    step_defaults: dict[str, dict[str, Any]] | None,
) -> Stage | None:
    capability = data.nodes.get(capability_id)
    if capability is None or capability.kind != "capability":
        return None
    step_default = (step_defaults or {}).get(capability_id) if depth > 0 else None
    method, choice, reason = _choose(
        data, capability_id, path, choices, parent, preferred, step_default
    )
    stage = Stage(
        path=path,
        depth=depth,
        capability=capability,
        method=method,
        choice=choice,
        reason=reason,
        alternatives=data.realisers.get(capability_id, ()),
        repeat=parent.repeats.get(capability_id) if parent else None,
    )
    if method is None or not method.steps:
        return stage
    if depth >= data.max_stage_depth:
        stage.stop = "depth"
        return stage
    next_path = on_path | {capability_id}
    for step in method.steps:
        if step in next_path:
            # A capability already being expanded above this one: shown as a stage
            # that stops, so the loop is visible rather than elided.
            looped = data.nodes.get(step)
            if looped is not None and looped.kind == "capability":
                stage.children.append(
                    Stage(
                        path=f"{path}/{step}",
                        depth=depth + 1,
                        capability=looped,
                        method=None,
                        choice=NONE,
                        reason=None,
                        alternatives=data.realisers.get(step, ()),
                        repeat=method.repeats.get(step),
                        stop="cycle",
                    )
                )
            continue
        child = _build(
            data, step, f"{path}/{step}", depth + 1, next_path, choices, method, (), step_defaults
        )
        if child is not None:
            stage.children.append(child)
    return stage


def assemble_workflow(
    data: PlannerData, problem: Problem, choices: dict[str, str] | None = None
) -> Stage | None:
    return _build(
        data,
        problem.capability,
        problem.capability,
        0,
        frozenset(),
        dict(choices or {}),
        None,
        problem.preferred_methods,
        problem.step_defaults,
    )


def compile_stage(
    data: PlannerData, root: Stage | None, choices: dict[str, str] | None = None
) -> Stage | None:
    nisq_first = bool(root and root.method and root.method.id in data.runs_without_error_correction)
    preferred = (NISQ_COMPILE,) if nisq_first else (FAULT_TOLERANT_COMPILE,)
    return _build(
        data,
        data.compile_capability,
        data.compile_capability,
        0,
        frozenset(),
        dict(choices or {}),
        None,
        preferred,
        None,
    )


def flatten(root: Stage | None) -> list[Stage]:
    """Every stage, parents before children."""
    out: list[Stage] = []

    def walk(stage: Stage) -> None:
        out.append(stage)
        for child in stage.children:
            walk(child)

    if root is not None:
        walk(root)
    return out


def chosen_method_for(root: Stage | None, capability_id: str) -> str | None:
    """The method chosen at the first stage realising this capability, if any."""
    for stage in flatten(root):
        if stage.capability.id == capability_id:
            return stage.method.id if stage.method else None
    return None
