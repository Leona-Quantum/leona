"""The Pareto frontier of physical qubits vs runtime, across assumption sets.

**What this sweeps, and why it is honest to combine sets on one frontier.**
`AssumptionSet.comparable_with` refuses to let two estimates under different
sets be silently ranked as if they were the same claim — that guard exists so
nobody sorts a catalogue by a number that mixes hardware. A frontier is a
different thing: it is a set of points that are each individually labelled
with the assumptions that produced them, shown together on purpose so a
reader can see the trade-off *across* hardware and error-correction choices —
this is Azure's resource estimator's signature move, and the proposal this
module implements names it explicitly. Every `FrontierPoint` carries its own
`assumption_set` identity; nothing here ever collapses two points into one
number.

**What gets swept, and what does not.** Only real, sourced knobs:

- the built-in `AssumptionSet`s themselves (`gidney-2025`, `composed-trapped-ion`
  by default) — this is the "physical error rate, cycle time" axis;
- `target_failure_probability`, which is a policy choice, not a hardware
  number, and which `choose_code_distance` turns into a code distance — this
  is the "code/distance choice" axis;
- `factory_count`, which is an operational choice already modelled by
  `estimate()` — this is the "factory choices" axis.

No hardware number is invented here: every point is `estimate()` called on a
real `AssumptionSet` already defined in `assumptions.py`.

**Why the factory sweep does not visit every integer.** Within one
`(assumption_set, target_failure_probability)` pair, `throughput_seconds`
strictly decreases and `factory_qubits` strictly increases as `factory_count`
rises from 1 to the crossover (`Runtime.factory_crossover`) — the whole curve
is Pareto-optimal by construction, and everything past the crossover is
dominated by the crossover point itself (same runtime, more qubits). So a
huge crossover (the trapped-ion set's docs example has 155,280) does not need
155,280 estimates: `_sample_factory_counts` takes a small, log-spaced sample
that always includes 1 and the crossover. The actual frontier guarantee does
not depend on this sampling being exhaustive — `pareto_frontier` re-derives
non-domination from the sampled points regardless of how they were chosen, so
a future change to the sampling strategy cannot silently reintroduce a
dominated point.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .assumptions import BUILTIN_ASSUMPTION_SETS, AssumptionSet
from .estimate import PhysicalEstimate, estimate
from .logical import LogicalCost


@dataclass(frozen=True)
class FrontierPoint:
    """One estimate, kept with the exact knobs that produced it.

    Duplicates `estimate.assumption_set`, `factory_count` and
    `target_failure_probability` as top-level fields rather than making a
    caller reach into `estimate` for them, because a table or chart renders
    from this record directly.
    """

    estimate: PhysicalEstimate
    factory_count: int
    target_failure_probability: float

    @property
    def assumption_set(self) -> str:
        return self.estimate.assumption_set

    @property
    def total_physical_qubits(self) -> int:
        return self.estimate.total_physical_qubits

    @property
    def runtime_seconds(self) -> float | None:
        return self.estimate.runtime_seconds


@dataclass(frozen=True)
class Frontier:
    """The result of a sweep: the non-dominated points, plus what was tried."""

    points: tuple[FrontierPoint, ...]
    """Pareto-optimal on (total_physical_qubits, runtime_seconds), both
    ascending-is-better. Sorted by qubits ascending. Contains no point that
    another point in this same tuple dominates — see `pareto_frontier`."""

    considered: int
    """How many candidate points the sweep evaluated before filtering, so a
    reader can see the frontier is a filtered subset and not the whole sweep."""

    excluded_unstated_runtime: tuple[FrontierPoint, ...] = ()
    """Points whose runtime this model cannot state (a Clifford-only circuit
    costed under a set that still reports a footprint). Dominance needs both
    axes, so these cannot be ranked into the frontier at all — they are kept
    here rather than silently dropped, because "unstated" is not the same
    claim as "excluded for being worse"."""


def _dominates(a: FrontierPoint, b: FrontierPoint) -> bool:
    """`a` dominates `b`: no worse on either axis, strictly better on one.

    Both axes are ascending-is-better (fewer qubits, less runtime). A tie on
    both axes means neither dominates the other — two assumption sets that
    happen to land on the same point are both kept, since dominance is about
    being *strictly* better, not merely not-worse.
    """
    assert a.runtime_seconds is not None and b.runtime_seconds is not None
    not_worse = (
        a.total_physical_qubits <= b.total_physical_qubits
        and a.runtime_seconds <= b.runtime_seconds
    )
    strictly_better = (
        a.total_physical_qubits < b.total_physical_qubits or a.runtime_seconds < b.runtime_seconds
    )
    return not_worse and strictly_better


def pareto_frontier(points: Sequence[FrontierPoint]) -> tuple[FrontierPoint, ...]:
    """The non-dominated subset of `points`, sorted by qubits ascending.

    O(n^2) on purpose: a sweep produces at most a few hundred points (see
    `_sample_factory_counts`), and an explicit pairwise check is the version
    that is obviously correct rather than the version that is fast. Every
    point passed in must have a stated `runtime_seconds` — filter those out
    (see `Frontier.excluded_unstated_runtime`) before calling this.
    """
    for p in points:
        if p.runtime_seconds is None:
            raise ValueError(
                "pareto_frontier cannot rank a point with unstated runtime "
                f"(assumption_set={p.assumption_set!r}); filter it out first"
            )
    frontier = [p for p in points if not any(_dominates(q, p) for q in points if q is not p)]
    return tuple(sorted(frontier, key=lambda p: (p.total_physical_qubits, p.runtime_seconds)))


def _sample_factory_counts(crossover: int, *, max_samples: int = 12) -> tuple[int, ...]:
    """A small, log-spaced sample of factory counts from 1 to `crossover`.

    Always includes both endpoints. Below `max_samples` this is just every
    integer, since there is nothing to save by sampling a short range.
    """
    if crossover <= 1:
        return (1,)
    if crossover <= max_samples:
        return tuple(range(1, crossover + 1))
    samples = {1, crossover}
    for i in range(max_samples):
        frac = i / (max_samples - 1)
        samples.add(round(crossover**frac))
    return tuple(sorted(s for s in samples if 1 <= s <= crossover))


def sweep_estimates(
    logical: LogicalCost,
    *,
    assumption_sets: Iterable[AssumptionSet] | None = None,
    target_failure_probabilities: Iterable[float] = (0.01,),
    factory_counts: Iterable[int] | None = None,
) -> tuple[FrontierPoint, ...]:
    """Every `(assumption_set, target_failure_probability, factory_count)`
    combination requested, as `FrontierPoint`s — the candidate set a frontier
    is filtered from, not the frontier itself.

    `factory_counts=None` (the default) samples per assumption set and per
    failure target, because the crossover — and so the sensible sweep range —
    depends on both (a smaller `target_failure_probability` forces a larger
    code distance, which changes factory throughput). Passing an explicit
    iterable applies the same fixed set of counts everywhere, including to a
    Clifford-only circuit's forced ``0``, which will raise inside
    `estimate()` exactly as calling it directly would.
    """
    if assumption_sets is None:
        assumption_sets = BUILTIN_ASSUMPTION_SETS.values()
    assumption_sets = tuple(assumption_sets)
    if not assumption_sets:
        raise ValueError("sweep_estimates needs at least one assumption set")
    target_failure_probabilities = tuple(target_failure_probabilities)
    if not target_failure_probabilities:
        raise ValueError("sweep_estimates needs at least one target_failure_probability")

    points: list[FrontierPoint] = []
    for assumptions in assumption_sets:
        for tfp in target_failure_probabilities:
            if logical.is_clifford_only:
                counts: tuple[int, ...] = (0,)
            elif factory_counts is not None:
                counts = tuple(factory_counts)
            else:
                probe = estimate(logical, assumptions, target_failure_probability=tfp)
                crossover = probe.runtime.factory_crossover or probe.runtime.factory_count
                counts = _sample_factory_counts(crossover)
            for count in counts:
                result = estimate(
                    logical,
                    assumptions,
                    target_failure_probability=tfp,
                    factory_count=count,
                )
                points.append(
                    FrontierPoint(
                        estimate=result,
                        factory_count=count,
                        target_failure_probability=tfp,
                    )
                )
    return tuple(points)


def compute_frontier(
    logical: LogicalCost,
    *,
    assumption_sets: Iterable[AssumptionSet] | None = None,
    target_failure_probabilities: Iterable[float] = (0.01,),
    factory_counts: Iterable[int] | None = None,
) -> Frontier:
    """Sweep, then keep only the non-dominated points.

    This is the entry point a caller (the API layer, a report) should use;
    `sweep_estimates` and `pareto_frontier` are exposed separately because the
    property that matters — no point in the result dominates another — is
    about `pareto_frontier` alone, and is tested that way.
    """
    candidates = sweep_estimates(
        logical,
        assumption_sets=assumption_sets,
        target_failure_probabilities=target_failure_probabilities,
        factory_counts=factory_counts,
    )
    stated = [p for p in candidates if p.runtime_seconds is not None]
    unstated = tuple(p for p in candidates if p.runtime_seconds is None)
    return Frontier(
        points=pareto_frontier(stated),
        considered=len(candidates),
        excluded_unstated_runtime=unstated,
    )


__all__ = [
    "Frontier",
    "FrontierPoint",
    "compute_frontier",
    "pareto_frontier",
    "sweep_estimates",
]
