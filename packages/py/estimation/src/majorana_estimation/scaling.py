"""The estimate at a series of problem sizes, for a *stated* logical-cost formula.

**This module derives nothing about how a workload's cost grows with a
problem parameter.** That dependence is an algorithmic fact about one
circuit family, stated by its own paper or Atlas record — the same kind of
claim `AssumptionSet.source_citation` is for hardware. `ScalingLaw.source`
is mandatory for the same reason: a formula with no stated source is not a
scaling law, it is this package guessing an asymptotic and dressing it up as
one. Nothing here fits a curve, extrapolates a trend, or infers an exponent
from a handful of points — the caller supplies `n -> LogicalCost` exactly as
its source states it, and this module only re-costs that function at the
requested points under a named `AssumptionSet`.

No built-in scaling law ships in this package. Wiring a real one — from a
paper's stated formula, or an Atlas record's `resources` field, once one
states an explicit `n`-dependence — is the caller's job (the API layer, per
`packages/py/estimation/AGENTS.md`'s split: this package knows algorithms and
hardware, nothing about the catalogue).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from .assumptions import AssumptionSet
from .estimate import PhysicalEstimate, estimate
from .logical import LogicalCost


def _default_valid_n(n: int) -> bool:
    return n >= 1


@dataclass(frozen=True)
class ScalingLaw:
    """A named, sourced function from a problem parameter to a `LogicalCost`.

    `logical_cost` is supplied by the caller — see the module docstring for
    why this package never writes one itself. `valid_n` restricts the domain
    to what the source actually states (e.g. a formula given only for even
    `n`, or only above some minimum); the default accepts any positive `n`,
    which is deliberately the loosest possible domain and should be narrowed
    whenever the source states a narrower one.
    """

    parameter_name: str
    source: str
    logical_cost: Callable[[int], LogicalCost]
    valid_n: Callable[[int], bool] = field(default=_default_valid_n)

    def __post_init__(self) -> None:
        if not self.parameter_name.strip():
            raise ValueError("a ScalingLaw must name its problem parameter")
        if not self.source.strip():
            raise ValueError(
                f"a ScalingLaw for parameter {self.parameter_name!r} must cite where "
                "its n-dependence comes from; this package will not extrapolate one"
            )

    def cost_at(self, n: int) -> LogicalCost:
        if isinstance(n, bool) or not isinstance(n, int):
            raise TypeError(f"{self.parameter_name} must be an int, got {type(n).__name__}")
        if not self.valid_n(n):
            raise ValueError(
                f"{self.parameter_name}={n} is outside the domain the source "
                f"({self.source}) states this formula for"
            )
        return self.logical_cost(n)


@dataclass(frozen=True)
class ScalingPoint:
    """One `n` on the curve, and the estimate it costs to."""

    n: int
    estimate: PhysicalEstimate

    @property
    def total_physical_qubits(self) -> int:
        return self.estimate.total_physical_qubits

    @property
    def runtime_seconds(self) -> float | None:
        return self.estimate.runtime_seconds


@dataclass(frozen=True)
class ScalingCurve:
    """A `ScalingLaw` re-costed at a series of `n`, under one assumption set.

    Carries `assumption_set` at the top level, same as `PhysicalEstimate`
    does, so the curve can never be read set-free — every point in `points`
    also carries it on its own `estimate`, redundantly, because a caller may
    pass around one `ScalingPoint` without the enclosing curve.
    """

    law: ScalingLaw
    assumption_set: str
    points: tuple[ScalingPoint, ...]


def compute_scaling_curve(
    law: ScalingLaw,
    assumptions: AssumptionSet,
    ns: Iterable[int],
    *,
    target_failure_probability: float = 0.01,
    factory_count: int | None = None,
) -> ScalingCurve:
    """Cost `law` at every `n` in `ns`, sorted ascending by `n`.

    `factory_count=None` (the default) re-derives the factory-count crossover
    independently at each `n`, exactly as calling `estimate()` once would —
    the crossover moves with the logical cost, so holding it fixed across a
    curve would silently compare points under different implied hardware
    spend. Pass an explicit `factory_count` only when that comparison is the
    point.
    """
    values = tuple(ns)
    if not values:
        raise ValueError("compute_scaling_curve needs at least one value of n")
    if len(set(values)) != len(values):
        raise ValueError("compute_scaling_curve does not accept a repeated n")

    points = tuple(
        ScalingPoint(
            n=n,
            estimate=estimate(
                law.cost_at(n),
                assumptions,
                target_failure_probability=target_failure_probability,
                factory_count=factory_count,
            ),
        )
        for n in values
    )
    return ScalingCurve(
        law=law,
        assumption_set=assumptions.identity,
        points=tuple(sorted(points, key=lambda p: p.n)),
    )


__all__ = [
    "ScalingCurve",
    "ScalingLaw",
    "ScalingPoint",
    "compute_scaling_curve",
]
