"""A published catalogue entry's fault-tolerant cost, derived on read (E4).

Pure, like catalog_read_model.py: no sqlalchemy, no ORM rows, no settings. The
route loads the record and calls in here.

**Nothing is stored.** The estimate is recomputed from the entry's own
`portableCircuit` on every read, which is the point — a stored resource profile
and a published circuit are two things that can disagree, and the one a visitor
is looking at would be the circuit. Recomputing costs microseconds of integer
arithmetic; there is no execution and no simulation anywhere on this path.

The whole surface is the three-way branch in `estimate_for_record`, and the
value of the feature is in the two branches that do not produce a number:

- an unclassifiable operation makes the cost *unknown*, not zero, and the reason
  names which operations did it;
- an arbitrary-angle rotation has no T-count until a synthesis precision is
  named, so any number shown for one is an estimate under a stated epsilon and
  is labelled with it — including in the assumption-set identity, so it cannot
  be ranked against a cost computed under a different budget.
"""

from __future__ import annotations

import math
from typing import Any

from majorana_contracts import (
    AssumptionSetSummary,
    CatalogEntryEstimate,
    CatalogEstimateList,
    CatalogEstimateSummary,
    CodeDistanceSummary,
    FootprintSummary,
    LogicalCostSummary,
    ResourceEstimateBasis,
    RuntimeSummary,
)
from majorana_estimation import (
    BUILTIN_ASSUMPTION_SETS,
    GIDNEY_2025,
    AssumptionSet,
    PhysicalEstimate,
    estimate,
)
from majorana_openqasm.non_clifford import NonCliffordCost, portable_circuit_cost

DEFAULT_ASSUMPTION_SET = GIDNEY_2025.identity

DEFAULT_ROTATION_SYNTHESIS_EPSILON = 1e-6
"""Owner decision, 2026-08-04 (memory/OWNER_TODO.md §1).

Not a hardware number and not a default the estimation package would ever pick
for itself: it is an algorithm's total error allowance divided among its
rotations, and `AssumptionSet.t_per_rotation` raises rather than assume one. It
is chosen *here*, at the product boundary where a person can be named for it,
and it travels in the assumption-set identity so nothing computed under it can
be silently compared with anything computed under another value. 1e-6 is the
usual working choice and costs 60 T gates per rotation.
"""

#: Bounds on a caller-supplied epsilon. The floor is not arbitrary: at 1e-15 a
#: rotation already costs ~150 T, and letting the value approach zero drives the
#: operation count — and through it the code distance — to values whose only
#: effect is to make `choose_code_distance` refuse. The ceiling keeps the number
#: an approximation rather than a rounding.
MIN_ROTATION_SYNTHESIS_EPSILON = 1e-15
MAX_ROTATION_SYNTHESIS_EPSILON = 1e-1

#: Ceiling on a caller-supplied factory count. Each factory is 15 logical
#: patches, so this is already a machine no one will build; the bound exists so
#: an anonymous caller cannot ask for a footprint whose only purpose is to
#: overflow the arithmetic on the way to being rendered.
MAX_FACTORY_COUNT = 1_000_000

#: Failure probability the whole circuit is costed to succeed within. Reported
#: on every estimate rather than assumed, because the chosen code distance is a
#: direct function of it.
TARGET_FAILURE_PROBABILITY = 0.01

_NO_CIRCUIT_REASON = (
    "This entry carries no portable circuit, so there is nothing to cost. "
    "Literature and operator records describe a construction without pinning a "
    "gate sequence; a resource estimate needs the sequence."
)


class UnknownAssumptionSet(LookupError):
    """The caller named an assumption set this deployment does not have."""


def resolve_assumptions(identity: str | None, epsilon: float | None) -> AssumptionSet:
    """The named hardware set, held to a stated synthesis precision.

    Raises `UnknownAssumptionSet` rather than falling back to the default: a
    caller who asked for trapped-ion numbers and silently got superconducting
    ones has been given a wrong answer that looks like a right one.
    """
    wanted = identity or DEFAULT_ASSUMPTION_SET
    try:
        base = BUILTIN_ASSUMPTION_SETS[wanted]
    except KeyError as exc:
        raise UnknownAssumptionSet(wanted) from exc
    resolved = DEFAULT_ROTATION_SYNTHESIS_EPSILON if epsilon is None else epsilon
    return base.with_rotation_precision(resolved)


def _summarize_assumptions(assumptions: AssumptionSet) -> AssumptionSetSummary:
    return AssumptionSetSummary(
        identity=assumptions.identity,
        name=assumptions.name,
        version=assumptions.version,
        citation=assumptions.citation,
        rotation_synthesis_epsilon=assumptions.rotation_synthesis_epsilon,
        t_per_rotation=(
            assumptions.t_per_rotation
            if assumptions.rotation_synthesis_epsilon is not None
            else None
        ),
        t_per_toffoli=assumptions.t_per_toffoli,
        physical_error_rate=assumptions.physical_error_rate,
        cycle_time_s=assumptions.cycle_time_s,
        reaction_time_s=assumptions.reaction_time_s,
    )


def _refusal(
    slug: str, assumptions: AssumptionSet, basis: ResourceEstimateBasis, reason: str
) -> CatalogEntryEstimate:
    return CatalogEntryEstimate(
        slug=slug,
        basis=basis,
        assumptions=_summarize_assumptions(assumptions),
        reason=reason,
    )


def _summarize(
    slug: str,
    basis: ResourceEstimateBasis,
    assumptions: AssumptionSet,
    cost: NonCliffordCost,
    physical: PhysicalEstimate,
) -> CatalogEntryEstimate:
    t_from_synthesis = physical.logical.t_count - cost.t_count
    return CatalogEntryEstimate(
        slug=slug,
        basis=basis,
        assumptions=_summarize_assumptions(assumptions),
        logical=LogicalCostSummary(
            logical_qubits=physical.logical.logical_qubits,
            t_count=physical.logical.t_count,
            toffoli_count=physical.logical.toffoli_count,
            non_clifford_depth=physical.logical.non_clifford_depth,
            magic_states=physical.runtime.magic_states,
            clifford_count=cost.clifford_count,
            synthesis_required=cost.synthesis_required,
            t_from_synthesis=t_from_synthesis,
        ),
        distance=CodeDistanceSummary(
            code_distance=physical.distance.code_distance,
            logical_operations=physical.distance.logical_operations,
            required_error_per_operation=physical.distance.required_error_per_operation,
            achieved_error_per_operation=physical.distance.achieved_error_per_operation,
            physical_per_logical=physical.distance.physical_per_logical,
        ),
        footprint=FootprintSummary(
            data_patch_qubits=physical.footprint.data_patch_qubits,
            routing_qubits=physical.footprint.routing_qubits,
            factory_qubits=physical.footprint.factory_qubits,
            total_physical_qubits=physical.footprint.total_physical_qubits,
        ),
        runtime=RuntimeSummary(
            magic_states=physical.runtime.magic_states,
            factory_count=physical.runtime.factory_count,
            # `inf` is not JSON, and a client that received it would render
            # "Infinity" as a duration. It means "no factory, states to distil",
            # which the null plus factory_count=0 already says.
            throughput_seconds=(
                physical.runtime.throughput_seconds
                if math.isfinite(physical.runtime.throughput_seconds)
                else None
            ),
            reaction_limited_seconds=physical.runtime.reaction_limited_seconds,
            seconds=physical.runtime.seconds,
            binding_term=physical.runtime.binding_term,
            factory_crossover=physical.runtime.factory_crossover,
        ),
        target_failure_probability=physical.target_failure_probability,
        notes=list(physical.notes),
    )


def estimate_for_record(
    record: dict[str, Any] | None,
    slug: str,
    assumptions: AssumptionSet,
    *,
    factory_count: int | None = None,
) -> CatalogEntryEstimate:
    """Cost one published record's circuit, or say why it cannot be costed.

    Every failure below is a *stated* outcome rather than an exception reaching
    the client, because on this page a 500 and a refusal look the same to a
    visitor and mean opposite things.

    `factory_count` defaults to the estimator's own default, the crossover —
    the fewest factories at which the control-system reaction time takes over
    and buying more changes nothing. That default maximises the qubit count, and
    for a small circuit it dominates it: a two-rotation ansatz costs 340 data
    and routing qubits against 168,300 factory qubits. Both numbers are right,
    and a reader shown only their sum will conclude the estimator is broken. So
    the count is a parameter a caller can move, and the split stays visible in
    `FootprintSummary`.
    """
    portable = (record or {}).get("portableCircuit")
    if not isinstance(portable, dict):
        return _refusal(slug, assumptions, ResourceEstimateBasis.NO_CIRCUIT, _NO_CIRCUIT_REASON)

    try:
        cost = portable_circuit_cost(portable)
    except ValueError as exc:
        # A malformed circuit is not an unaffordable one. Say so plainly rather
        # than let a shape problem read as a physics result.
        return _refusal(
            slug,
            assumptions,
            ResourceEstimateBasis.REFUSED,
            f"This entry's circuit could not be read: {exc}",
        )

    basis = ResourceEstimateBasis.EXACT if cost.exact else ResourceEstimateBasis.ESTIMATED
    try:
        # Only read `t_per_rotation` when a rotation actually needs pricing.
        # The property *raises* when no precision is stated, and Python evaluates
        # it before `logical_cost` can decide to ignore it — so passing it
        # unconditionally refuses an exactly-countable circuit for want of a
        # number that circuit never uses. Unreachable through the route today
        # (`resolve_assumptions` always names one), which is what makes it worth
        # closing: the trap only springs for the next caller.
        t_per_rotation = assumptions.t_per_rotation if cost.synthesis_required else None
        logical = cost.logical_cost(label=slug, t_per_rotation=t_per_rotation)
        physical = estimate(
            logical,
            assumptions,
            target_failure_probability=TARGET_FAILURE_PROBABILITY,
            factory_count=factory_count,
        )
    except ValueError as exc:
        # Covers both halves of the refusal: an operation no precision can price
        # (InexactCostError), and a circuit no code distance in this assumption
        # set can protect. The second is a real answer about the hardware, not a
        # gap in the data, so it is reported in the caller's words.
        return _refusal(slug, assumptions, ResourceEstimateBasis.REFUSED, str(exc))

    return _summarize(slug, basis, assumptions, cost, physical)


def summarize_for_list(estimate_result: CatalogEntryEstimate) -> CatalogEstimateSummary:
    """Project a full estimate to the row a browse list renders.

    A projection rather than a cheaper second computation, so a list row and the
    detail page behind it can never disagree about the same circuit.
    """
    footprint = estimate_result.footprint
    logical = estimate_result.logical
    return CatalogEstimateSummary(
        slug=estimate_result.slug,
        basis=estimate_result.basis,
        total_physical_qubits=footprint.total_physical_qubits if footprint else None,
        magic_states=logical.magic_states if logical else None,
        logical_qubits=logical.logical_qubits if logical else None,
        code_distance=(
            estimate_result.distance.code_distance if estimate_result.distance else None
        ),
        seconds=estimate_result.runtime.seconds if estimate_result.runtime else None,
    )


def estimate_list_for_records(
    records: list[tuple[str, dict[str, Any] | None]],
    assumptions: AssumptionSet,
    *,
    factory_count: int | None = None,
) -> CatalogEstimateList:
    """Cost a whole listing under one assumption set, stated once for the list.

    Stating the set once is what makes the ordering rule enforceable rather than
    advisory: every row in the returned object is comparable with every other by
    construction, and there is nothing inside it to compare *across*. Ranking
    across sets now requires a client to visibly merge two payloads that each
    announce a different identity.
    """
    return CatalogEstimateList(
        assumptions=_summarize_assumptions(assumptions),
        estimates=[
            summarize_for_list(
                estimate_for_record(record, slug, assumptions, factory_count=factory_count)
            )
            for slug, record in records
        ],
    )
