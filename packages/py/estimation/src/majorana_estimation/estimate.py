"""The four-layer estimator, with every intermediate on the record.

Layer 1 (logical metrics) is `LogicalCost`. Layers 2-4 are here:

    Layer 2  code distance      d from p, p_th and the operation count
    Layer 3  physical footprint logical_qubits * patch(d) * routing + factories
    Layer 4  runtime            max(throughput term, reaction-limited term)

**Layers 3 and 4 both take the code distance from Layer 2 rather than holding
constants of their own.** `patch(d)` is `AssumptionSet.physical_qubits_per_patch`
and factory time is `AssumptionSet.factory_cycles_per_state`, both per set and
both sourced, because the papers state them per machine and as functions of `d`.
Hard-coding either here is how this package ended up applying one paper's patch
conversion to a set that states a different one.

**The intermediates are the argument; the final number is just their product.**
An estimator that returns only a physical-qubit count is a black box producing
a figure nobody can check, which is the failure this design exists to avoid —
so `PhysicalEstimate` carries every step, and no field is computed twice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .assumptions import AssumptionSet, require_count
from .logical import LogicalCost

MAX_CODE_DISTANCE = 101
"""Refuse rather than return an absurd distance. Well past any published design."""


@dataclass(frozen=True)
class DistanceChoice:
    """Layer 2's working, not just its answer."""

    code_distance: int
    logical_operations: int
    required_error_per_operation: float
    achieved_error_per_operation: float
    physical_per_logical: int


@dataclass(frozen=True)
class Footprint:
    """Layer 3, split so the data/factory trade is visible rather than lumped."""

    data_patch_qubits: int
    routing_qubits: int
    factory_qubits: int
    total_physical_qubits: int


@dataclass(frozen=True)
class Runtime:
    """Layer 4, with both terms kept apart.

    Reporting only `seconds` would hide which constraint is actually binding,
    and that is the whole decision: more factories move the throughput term and
    do nothing whatever to the reaction-limited one.
    """

    magic_states: int
    factory_count: int
    throughput_seconds: float
    reaction_limited_seconds: float

    seconds: float | None
    """Wall-clock, or `None` when this model cannot state one.

    `None` for a Clifford-only circuit, and that is not a technicality. Both
    terms here are driven by magic-state consumption: a circuit that consumes
    none has a throughput term of zero and a reaction-limited term of zero,
    which multiply out to a runtime of **0.0 seconds** for a circuit that
    plainly takes time to run. `LogicalCost` already says in as many words that
    a Clifford-only circuit's wall-clock "is not something this package can
    state" — returning 0.0 contradicted that, and 0.0 is the one wrong answer
    that reads as a measurement rather than as a gap. Stating a Clifford depth
    and its cycle cost is the real fix, and this model does not have it.
    """

    binding_term: str
    """`"throughput"`, `"reaction"`, or `"unstated"` when `seconds` is None."""

    factory_crossover: int | None
    """Fewest factories at which throughput stops binding.

    `None` when there is no reaction-limited floor to reach, i.e. when
    `non_clifford_depth` was not supplied. Buying more factories than this
    buys nothing, and that is the single most useful number here once a machine
    is large enough for the circuit to fit at all.
    """


@dataclass(frozen=True)
class PhysicalEstimate:
    assumption_set: str
    """`AssumptionSet.identity`. An estimate must never be readable set-free."""

    logical: LogicalCost
    distance: DistanceChoice
    footprint: Footprint
    runtime: Runtime
    target_failure_probability: float
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def total_physical_qubits(self) -> int:
        return self.footprint.total_physical_qubits

    @property
    def runtime_seconds(self) -> float | None:
        return self.runtime.seconds

    def comparable_with(self, other: "PhysicalEstimate") -> bool:
        """Two estimates may only be ranked when they share an assumption set."""
        return self.assumption_set == other.assumption_set


def _logical_error_per_operation(distance: int, assumptions: AssumptionSet) -> float:
    """`p_L(d) ~ A * (p / p_th) ** ((d + 1) // 2)`, the standard suppression form."""
    ratio = assumptions.physical_error_rate / assumptions.threshold
    return assumptions.logical_error_prefactor * ratio ** ((distance + 1) // 2)


def _logical_operation_count(
    logical: LogicalCost, assumptions: AssumptionSet, *, magic_states: int
) -> int:
    """Spacetime volume charged against the per-operation logical error rate.

    Magic-state consumptions plus patch-rounds spent idling through the serial
    chain. Both terms matter: a shallow circuit with many states and a deep one
    with few fail for different reasons.

    **The idle term is in patch-rounds, so the serial layers must be converted
    to cycles.** Layer 4 charges one *reaction interval* per non-Clifford layer,
    and a reaction interval is `cycles_per_reaction` code cycles — ten under
    `gidney-2025`. Counting one round per layer was a unit error that
    understated the volume tenfold and, through `d`, the machine by ~15%.

    Known direction of error: this still ignores storage error accumulated
    outside the serial chain, so it remains **optimistic** — a real design may
    need a larger distance than this returns. Stated rather than buried,
    because an optimistic estimate that reads as conservative is the dangerous
    kind.
    """
    idle_rounds = (
        logical.logical_qubits * logical.non_clifford_depth * assumptions.cycles_per_reaction
    )
    return max(1, magic_states + idle_rounds)


def choose_code_distance(
    logical: LogicalCost,
    assumptions: AssumptionSet,
    *,
    target_failure_probability: float,
) -> DistanceChoice:
    """Layer 2. Smallest odd distance whose total logical error clears the target."""
    if not 0 < target_failure_probability < 1:
        raise ValueError("target_failure_probability must lie in (0, 1)")
    magic_states = logical.magic_states(t_per_toffoli=assumptions.t_per_toffoli)
    operations = _logical_operation_count(logical, assumptions, magic_states=magic_states)
    required = target_failure_probability / operations
    for distance in range(3, MAX_CODE_DISTANCE + 1, 2):
        achieved = _logical_error_per_operation(distance, assumptions)
        if achieved <= required:
            return DistanceChoice(
                code_distance=distance,
                logical_operations=operations,
                required_error_per_operation=required,
                achieved_error_per_operation=achieved,
                physical_per_logical=assumptions.physical_qubits_per_patch.physical_qubits(
                    distance
                ),
            )
    raise ValueError(
        f"no code distance up to {MAX_CODE_DISTANCE} reaches a per-operation logical "
        f"error of {required:.3g} for {operations} operations at physical error rate "
        f"{assumptions.physical_error_rate:.3g}"
    )


def _runtime(
    logical: LogicalCost,
    assumptions: AssumptionSet,
    *,
    factory_count: int,
    code_distance: int,
) -> Runtime:
    """Layer 4. Both terms, and the crossover between them.

    Takes the distance chosen by Layer 2 because factory time is a function of
    it under every source this package cites. Layer 2 does not depend on Layer
    4, so there is no circularity — but the ordering inside `estimate` is now
    load-bearing rather than incidental.
    """
    magic_states = logical.magic_states(t_per_toffoli=assumptions.t_per_toffoli)
    rate = assumptions.magic_states_per_second_per_factory(code_distance)
    if magic_states == 0:
        # A Clifford-only circuit places no demand on distillation at all, so
        # the throughput term is absent rather than infinite. Without this the
        # zero-factory case would report an unsatisfiable constraint.
        throughput = 0.0
    elif factory_count:
        throughput = magic_states / (factory_count * rate)
    else:
        throughput = math.inf
    reaction = logical.non_clifford_depth * assumptions.reaction_time_s

    crossover: int | None = None
    if reaction > 0 and magic_states > 0:
        crossover = max(1, math.ceil(magic_states / (rate * reaction)))

    seconds: float | None
    if magic_states == 0:
        # Neither term is about this circuit: both are magic-state terms, and
        # taking their max would report 0.0 seconds for a circuit that runs.
        seconds, binding = None, "unstated"
    elif throughput >= reaction:
        seconds, binding = throughput, "throughput"
    else:
        seconds, binding = reaction, "reaction"
    return Runtime(
        magic_states=magic_states,
        factory_count=factory_count,
        throughput_seconds=throughput,
        reaction_limited_seconds=reaction,
        seconds=seconds,
        binding_term=binding,
        factory_crossover=crossover,
    )


def estimate(
    logical: LogicalCost,
    assumptions: AssumptionSet,
    *,
    target_failure_probability: float = 0.01,
    factory_count: int | None = None,
) -> PhysicalEstimate:
    """Cost `logical` under `assumptions`, exposing every intermediate.

    `factory_count` defaults to the crossover — the fewest factories at which
    the reaction-limited floor takes over — because that is the only
    defensible default. Picking one silently is how a report ends up claiming a
    runtime that assumed hardware nobody costed.
    """
    notes: list[str] = []
    if logical.is_clifford_only:
        notes.append(
            "Clifford-only circuit: no magic states, so no distillation and no "
            "factories. Its footprint is stated; its runtime is not, because "
            "both runtime terms are magic-state terms and this model has no "
            "Clifford-depth metric to put in their place."
        )
    if logical.non_clifford_depth == 0 and not logical.is_clifford_only:
        notes.append(
            "non_clifford_depth was not supplied, so the reaction-limited floor "
            "is unknown and the runtime is throughput-bound by construction. "
            "The figure is a lower bound on wall-clock, not an estimate of it."
        )

    distance = choose_code_distance(
        logical, assumptions, target_failure_probability=target_failure_probability
    )

    resolved_factories = factory_count
    if resolved_factories is None:
        probe = _runtime(
            logical, assumptions, factory_count=1, code_distance=distance.code_distance
        )
        resolved_factories = probe.factory_crossover or (0 if logical.is_clifford_only else 1)
        if probe.factory_crossover is not None:
            notes.append(
                f"factory_count defaulted to the crossover ({probe.factory_crossover}); "
                "past it the control-system reaction time binds and more factories "
                "change nothing."
            )
    require_count(resolved_factories, "factory_count", minimum=0)
    if resolved_factories == 0 and not logical.is_clifford_only:
        raise ValueError("a circuit consuming magic states needs at least one factory")
    if logical.is_clifford_only and resolved_factories:
        # A caller may ask for factories a Clifford-only circuit cannot use.
        # Honouring that adds `factory_footprint_logical` patches apiece to a
        # footprint whose own `magic_states` is 0 — a report that contradicts
        # itself line by line, and one an anonymous caller can trigger through
        # a query parameter. The circuit's cost is what is being stated here,
        # not the machine somebody happens to own.
        notes.append(
            f"factory_count={resolved_factories} was requested but this circuit consumes no "
            "magic states, so it is costed with none: factories it cannot use are not part "
            "of what it needs."
        )
        resolved_factories = 0

    runtime = _runtime(
        logical,
        assumptions,
        factory_count=resolved_factories,
        code_distance=distance.code_distance,
    )

    data = logical.logical_qubits * distance.physical_per_logical
    with_routing = math.ceil(data * assumptions.routing_factor)
    factories = math.ceil(
        resolved_factories * assumptions.factory_footprint_logical * distance.physical_per_logical
    )
    footprint = Footprint(
        data_patch_qubits=data,
        routing_qubits=with_routing - data,
        factory_qubits=factories,
        total_physical_qubits=with_routing + factories,
    )
    return PhysicalEstimate(
        assumption_set=assumptions.identity,
        logical=logical,
        distance=distance,
        footprint=footprint,
        runtime=runtime,
        target_failure_probability=target_failure_probability,
        notes=tuple(notes),
    )
