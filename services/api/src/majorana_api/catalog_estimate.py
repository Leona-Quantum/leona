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
    CostOnSmallestMachine,
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

#: How `AssumptionSet.identity` appends its precision. Kept next to the parser
#: that splits it back off, so the two cannot drift into disagreeing about the
#: format of the string the public page prints.
_EPS_MARKER = "+eps="

#: Ceiling on a caller-supplied factory count. A factory is 11-15 logical
#: patches depending on the set, so this is already a machine no one will build;
#: the bound exists so an anonymous caller cannot ask for a footprint whose only
#: purpose is to overflow the arithmetic on the way to being rendered.
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


class ContradictoryPrecision(ValueError):
    """The identity carried one epsilon and the `epsilon` parameter another."""


def resolve_assumptions(identity: str | None, epsilon: float | None) -> AssumptionSet:
    """The named hardware set, held to a stated synthesis precision.

    Raises `UnknownAssumptionSet` rather than falling back to the default: a
    caller who asked for trapped-ion numbers and silently got superconducting
    ones has been given a wrong answer that looks like a right one.

    ## Both the registry key and the full identity are accepted

    The registry is keyed by `name@vN`, because a built-in set states no
    precision — that is chosen here, per estimate. But what an estimate *carries*
    and what the page *prints* is `AssumptionSet.identity`, which appends
    `+eps=...`. So the one string a reader has in front of them was the one
    string this function refused, and the page and the API disagreed about the
    name of the same thing. Pasting `gidney-2025@v2+eps=1e-06` back is the
    obvious thing to try and it 422'd.

    A precision named twice must agree. Taking either side silently would answer
    a question the caller did not ask: they wrote both because they meant both,
    and if the two differ the estimate would come back labelled with a budget the
    caller did not choose — on a page whose whole argument is that the label is
    the claim.
    """
    wanted = identity or DEFAULT_ASSUMPTION_SET
    key, marker, stated = wanted.partition(_EPS_MARKER)
    try:
        base = BUILTIN_ASSUMPTION_SETS[key]
    except KeyError as exc:
        raise UnknownAssumptionSet(wanted) from exc

    from_identity: float | None = None
    if marker:
        try:
            from_identity = float(stated)
        except ValueError as exc:
            # Not a precision, so not an identity this deployment ever emitted.
            raise UnknownAssumptionSet(wanted) from exc
        if epsilon is not None and epsilon != from_identity:
            raise ContradictoryPrecision(from_identity, epsilon)

    resolved = from_identity
    if resolved is None:
        resolved = DEFAULT_ROTATION_SYNTHESIS_EPSILON if epsilon is None else epsilon
    if not MIN_ROTATION_SYNTHESIS_EPSILON < resolved < MAX_ROTATION_SYNTHESIS_EPSILON:
        # The route bounds `epsilon`; nothing bounded one arriving inside an
        # identity string, and `with_rotation_precision` only refuses values
        # outside (0, 1). Bounding it here keeps the two doors the same size.
        raise ContradictoryPrecision(resolved, None)
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


def _footprint_summary(physical: PhysicalEstimate) -> FootprintSummary:
    return FootprintSummary(
        data_patch_qubits=physical.footprint.data_patch_qubits,
        routing_qubits=physical.footprint.routing_qubits,
        factory_qubits=physical.footprint.factory_qubits,
        total_physical_qubits=physical.footprint.total_physical_qubits,
    )


def _runtime_summary(physical: PhysicalEstimate) -> RuntimeSummary:
    return RuntimeSummary(
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
    )


def _summarize(
    slug: str,
    basis: ResourceEstimateBasis,
    assumptions: AssumptionSet,
    cost: NonCliffordCost,
    physical: PhysicalEstimate,
    smallest: PhysicalEstimate | None,
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
        footprint=_footprint_summary(physical),
        runtime=_runtime_summary(physical),
        smallest_machine=(
            None
            if smallest is None
            else CostOnSmallestMachine(
                footprint=_footprint_summary(smallest),
                runtime=_runtime_summary(smallest),
            )
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

    **A parameter a caller can move is not an answer a reader is given**, which
    is why the response also carries `smallest_machine`. The default figure is
    the fastest useful machine and therefore the largest one, and a visitor who
    reads it as "what this circuit costs" has been misled by a correct number.
    Costing the same circuit at one factory is a second pass over the same
    integer arithmetic and turns the headline into one end of a stated trade
    (owner decision, 2026-08-05, memory/OWNER_TODO.md §2).
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

    smallest = None
    if physical.runtime.factory_count > 1:
        # Not caught: the only factory-dependent failure in `estimate` is the
        # zero-factory refusal, and one is not zero. If this ever raises, the
        # model changed and the page should stop rather than publish a headline
        # whose surrounding copy says it is one end of a trade it cannot show.
        smallest = estimate(
            logical,
            assumptions,
            target_failure_probability=TARGET_FAILURE_PROBABILITY,
            factory_count=1,
        )

    return _summarize(slug, basis, assumptions, cost, physical, smallest)


def summarize_for_list(estimate_result: CatalogEntryEstimate) -> CatalogEstimateSummary:
    """Project a full estimate to the row a browse list renders.

    A projection rather than a cheaper second computation, so a list row and the
    detail page behind it can never disagree about the same circuit.
    """
    footprint = estimate_result.footprint
    logical = estimate_result.logical
    smallest = estimate_result.smallest_machine
    return CatalogEstimateSummary(
        slug=estimate_result.slug,
        basis=estimate_result.basis,
        total_physical_qubits=footprint.total_physical_qubits if footprint else None,
        smallest_machine_qubits=(smallest.footprint.total_physical_qubits if smallest else None),
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
