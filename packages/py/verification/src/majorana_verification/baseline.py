"""Brute-force enumeration of a small combinatorial instance — independent ground truth.

`exact_diag` closed the variational gap for tasks whose answer is an ENERGY, and
production run 019f7f81-4a61 immediately showed the category it cannot cover: the
planner pointed it at a MaxCut cut weight, whose range [5.5, 6.0] could never
contain the Ising ground energy -4.5, and four correct candidates burned the
budget reporting the right cut. The plan contract now refuses that category error
at plan time; this module is the affirmative half — the check that speaks a cut
metric's own units.

The planner writes the instance down as data before any code exists — a weighted
edge list for MaxCut, a coefficient list for QUBO — and the verifier enumerates
every assignment of at most `BRUTE_FORCE_MAX_VARIABLES` binary variables to find
the true optimum. The reference is *data we parse*, never code we run, the same
discipline `exact_diag` and `verify_exact` apply and for the same reason: a
reference that has to be executed to mean anything admits a second piece of
model-authored code as ground truth.

**What it proves, and what it does not.** It proves the reported objective value
is the true optimum of the instance the plan declared. It cannot prove the plan
declared the instance the user asked about — reference and implementation share
an author, so this is `plan_declared`-strength evidence, exactly like
`exact_diag`'s. Unlike an energy there is no shot-noise budget on the VALUE: a
specific cut's weight is computed exactly from its assignment, and the sampling
randomness lives entirely in WHICH assignment the run found. So the bar is
equality up to floating-point noise, and a run that found a genuinely suboptimal
cut fails honestly rather than passing inside a slack it never earned.
"""

from __future__ import annotations

import math
from typing import Any, Literal

import numpy as np

# 16 variables enumerates 65_536 assignments; the solver materializes one
# (2**n, n) uint8 bit table (1 MB at the ceiling) plus one float64 objective
# vector per instance. 20 variables would be 16x that and seconds of work per
# term — nothing the worker cannot survive, but nothing a "small instance the
# planner can write down honestly" needs either. Pinned here and mirrored by
# majorana_contracts.plan so a plan can never request a check the verifier is
# forced to fail — the shape that burned four run budgets before #90.
BRUTE_FORCE_MAX_VARIABLES = 16

# Objective values within this fraction of the instance's scale are the same
# value: the candidate re-sums the same declared weights, possibly in a
# different order, and float addition ordering perturbs the sum at ~1e-13
# relative. There is deliberately NO plan-declared loosening of this bound — a
# tolerance wide enough to admit a suboptimal cut would let a run that never
# solved the instance buy a physical grade, which is the one failure mode this
# codebase treats as worse than any alternative (see verify_exact_diag, which
# accepts a declared tolerance precisely because it may only TIGHTEN).
_RELATIVE_TOLERANCE = 1e-9

ProblemKind = Literal["maxcut", "qubo"]


class BaselineProblemError(ValueError):
    """The declared instance is not a problem this module can enumerate."""


def _validated(
    kind: str, num_variables: int, terms: list[tuple[int, int, float]]
) -> list[tuple[int, int, float]]:
    if kind not in ("maxcut", "qubo"):
        raise BaselineProblemError(
            f"'{kind}' is not a brute-force problem kind; use 'maxcut' or 'qubo'"
        )
    if not 1 <= num_variables <= BRUTE_FORCE_MAX_VARIABLES:
        raise BaselineProblemError(
            f"{num_variables} variables is outside the brute-force enumeration "
            f"ceiling of {BRUTE_FORCE_MAX_VARIABLES}"
        )
    if not terms:
        raise BaselineProblemError("no terms were supplied")
    for i, j, weight in terms:
        if not (0 <= i < num_variables and 0 <= j < num_variables):
            raise BaselineProblemError(
                f"term ({i}, {j}) names a variable outside 0..{num_variables - 1}"
            )
        if kind == "maxcut" and i == j:
            raise BaselineProblemError(
                f"term ({i}, {j}) is a self-loop, which no cut can sever; "
                "MaxCut edges must join two distinct variables"
            )
        if not math.isfinite(weight):
            raise BaselineProblemError(f"weight for term ({i}, {j}) is not a finite number")
    return terms


def objective_values(
    kind: ProblemKind, num_variables: int, terms: list[tuple[int, int, float]]
) -> np.ndarray:
    """Objective value of every one of the 2**num_variables assignments.

    Assignment index k encodes variable v as bit v of k (LSB = variable 0); the
    encoding is unobservable through this module's public results, which only
    ever aggregate over the whole set, but is stated because a convention nobody
    wrote down is a convention someone will read backwards (standing lesson 10).

    - `maxcut`: sum of `weight` over terms whose endpoints fall on opposite
      sides. Duplicate edges simply add their weights.
    - `qubo`: sum of `weight * x_i * x_j` — a diagonal term (i == j) is the
      linear coefficient of x_i, since x**2 == x for binary variables.
    """
    _validated(kind, num_variables, terms)
    assignments = 1 << num_variables
    bits = (np.arange(assignments, dtype=np.uint32)[:, None] >> np.arange(num_variables)) & 1
    values = np.zeros(assignments, dtype=np.float64)
    for i, j, weight in terms:
        if kind == "maxcut":
            values += weight * (bits[:, i] ^ bits[:, j])
        else:
            values += weight * (bits[:, i] & bits[:, j] if i != j else bits[:, i])
    return values


def optimal_objective(
    kind: ProblemKind, num_variables: int, terms: list[tuple[int, int, float]]
) -> float:
    """The true optimum: the maximum cut weight, or the minimum QUBO value."""
    values = objective_values(kind, num_variables, terms)
    return float(values.max() if kind == "maxcut" else values.min())


def objective_tolerance(terms: list[tuple[int, int, float]]) -> float:
    """Floating-point headroom only — see `_RELATIVE_TOLERANCE`.

    The honest limit that follows: two distinct achievable values closer
    together than this are indistinguishable. At 1e-9 of the total weight scale
    that requires adversarially chosen weights, not a real instance.
    """
    scale = sum(abs(weight) for _, _, weight in terms)
    return _RELATIVE_TOLERANCE * max(1.0, scale)


def objective_comparison(
    kind: ProblemKind,
    num_variables: int,
    terms: list[tuple[int, int, float]],
    reported_value: float,
) -> tuple[bool, dict[str, Any]]:
    """Compare a reported objective value against the enumerated optimum.

    Returns (passed, details). The details name which SIDE the disagreement is
    on, because the two sides are different bugs with different repairs and a
    bare absolute error says neither (standing lesson 12):

    - beyond the optimum (a cut heavier than the maximum, a QUBO value below the
      minimum) — impossible. No assignment achieves it, so the scoring code is
      wrong, not the optimizer.
    - short of the optimum — the run found a real but suboptimal assignment, or
      a value no assignment achieves at all; membership in the enumerated value
      set says which.
    """
    values = objective_values(kind, num_variables, terms)
    maximize = kind == "maxcut"
    optimum = float(values.max() if maximize else values.min())
    tolerance = objective_tolerance(terms)
    error = reported_value - optimum
    objective_word = "maximum cut weight" if maximize else "minimum QUBO value"
    details: dict[str, Any] = {
        "protocol": {
            "name": "brute_force_enumeration",
            "kind": kind,
            "num_variables": num_variables,
            "terms": len(terms),
            "assignments_enumerated": int(values.size),
            "objective": "maximize" if maximize else "minimize",
            "tolerance": tolerance,
            "tolerance_source": "floating_point_only",
        },
        "scores": {
            "optimal_value": optimum,
            "reported_value": reported_value,
            "absolute_error": abs(error),
        },
        "evidence_scope": (
            "the reported value is the true optimum of the instance the planner "
            "declared; reference and implementation share an author"
        ),
    }
    if abs(error) <= tolerance:
        return True, details
    impossible = error > 0 if maximize else error < 0
    if impossible:
        details["disagreement"] = (
            f"the reported value {reported_value:.6f} is BEYOND the true "
            f"{objective_word} {optimum:.6f}, which no assignment of the declared "
            "instance achieves. The scoring code is wrong, not the optimizer: "
            "check that each term is counted once with its declared weight, and "
            "that the reported value is recomputed from an assignment the run "
            "actually produced."
        )
        return False, details
    nearest = float(values[np.abs(values - reported_value).argmin()])
    details["scores"]["nearest_achievable_value"] = nearest
    if abs(nearest - reported_value) <= tolerance:
        details["disagreement"] = (
            f"the reported value {reported_value:.6f} is achievable but "
            f"SUBOPTIMAL: the true {objective_word} is {optimum:.6f}. The scoring "
            "code is measuring the declared instance correctly and the search did "
            "not find the optimum: report the best value over ALL sampled "
            "assignments, and if it still falls short, increase shots or the "
            "algorithm's depth/iterations."
        )
    else:
        details["disagreement"] = (
            f"the reported value {reported_value:.6f} is not the objective value "
            f"of ANY assignment of the declared instance (nearest achievable is "
            f"{nearest:.6f}, true {objective_word} {optimum:.6f}). The scoring "
            "code disagrees with the declared instance: check that every declared "
            "term is included, weights are applied, and no term is counted twice."
        )
    return False, details
