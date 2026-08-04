"""Named, versioned hardware assumption sets.

**The assumption set is the product, not a footnote.** Every number this package
emits is a costing under one of these, and two estimates computed under
different sets are not comparable — `AssumptionSet.comparable_with` is the
predicate that says so, and callers are expected to refuse to sort across it.

Adding a set is a sourcing job, not a modelling job: each field must come from a
published parameter set that states it. A fabricated assumption set is worse
than having none, because it makes an incomparable estimate look comparable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace


def require_count(value: object, name: str, *, minimum: int) -> int:
    """A discrete resource count must be a real integer, not a float or a bool.

    Type annotations do not run. Without this, `t_per_toffoli=1.5` yields
    fractional magic states and `factory_count=True` silently means one factory
    — both of which would flow all the way into a reported qubit count.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int, got {type(value).__name__}")
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def require_finite(value: float, name: str) -> float:
    """NaN and infinity pass every comparison below, so exclude them first.

    `cycle_time_s=inf` would make the factory rate zero and divide by zero
    later; `routing_factor=inf` would blow up `math.ceil`. NaN is worse: it
    compares false against everything and reaches the arithmetic intact.
    """
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise TypeError(f"{name} must be a real number, got {type(value).__name__}")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite, got {value}")
    return float(value)


@dataclass(frozen=True)
class AssumptionSet:
    """One hardware+protocol parameter set, named and citable.

    `name` and `version` together are the identity that an estimate carries.
    Bump `version` whenever any number below changes: an estimate stored under
    "gidney-2025 v1" must never silently start meaning something else.
    """

    name: str
    version: int
    citation: str

    # --- Layer 2, code distance -------------------------------------------
    physical_error_rate: float
    """Per-operation physical error rate `p`."""

    threshold: float
    """Surface-code threshold `p_th`. `p` must be below it or no distance helps."""

    logical_error_prefactor: float
    """`A` in `p_L(d) ~ A * (p/p_th)**((d+1)//2)`."""

    # --- Layer 3, footprint ------------------------------------------------
    routing_factor: float
    """Multiplier on data patches for lattice-surgery routing space."""

    factory_footprint_logical: float
    """Cost of one magic-state factory, in logical-patch equivalents."""

    # --- Layer 4, runtime --------------------------------------------------
    cycle_time_s: float
    """Wall-clock duration of one surface-code cycle."""

    reaction_time_s: float
    """Control-system feed-forward latency. Sets the floor no factory count beats."""

    factory_cycles_per_state: int
    """Surface-code cycles one factory takes to deliver one magic state."""

    # --- Decomposition convention -----------------------------------------
    t_per_toffoli: int
    """Magic states charged per Toffoli. 4 with measurement-and-fixup, 7 without."""

    rotation_synthesis_epsilon: float | None = None
    """Per-rotation approximation error a Clifford+T synthesis is held to.

    ``None`` means no precision has been stated, and a circuit containing an
    arbitrary-angle rotation then has **no** T-count — which is the honest
    answer, not zero. Left unset on every built-in set on purpose: the budget
    is a property of the algorithm's total error allowance divided among its
    rotations, not of the hardware, so it has to be stated per estimate.
    """

    rotation_t_coefficient: float = 3.0
    """Leading coefficient in ``T ~ c * log2(1/eps)`` for z-rotation synthesis.

    3.0 is the Ross-Selinger leading term (arXiv:1403.2975, optimal
    ancilla-free Clifford+T approximation of z-rotations); the true count is
    ``3*log2(1/eps) + O(log log 1/eps)``, so this is a floor that gets closer
    as eps shrinks. Exposed rather than hard-coded because it is the kind of
    constant that quietly moves an estimate by tens of percent.
    """

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("an assumption set must be named")
        require_count(self.version, "version", minimum=1)
        require_count(self.factory_cycles_per_state, "factory_cycles_per_state", minimum=1)
        require_count(self.t_per_toffoli, "t_per_toffoli", minimum=1)
        for name in (
            "physical_error_rate",
            "threshold",
            "logical_error_prefactor",
            "routing_factor",
            "factory_footprint_logical",
            "cycle_time_s",
            "reaction_time_s",
        ):
            require_finite(getattr(self, name), name)
        if not 0 < self.physical_error_rate < 1:
            raise ValueError("physical_error_rate must lie in (0, 1)")
        if not 0 < self.threshold < 1:
            raise ValueError("threshold must lie in (0, 1)")
        if self.physical_error_rate >= self.threshold:
            # Above threshold, adding distance makes the logical error rate
            # worse, not better. Refuse rather than return a distance that
            # looks like an answer.
            raise ValueError(
                f"physical_error_rate {self.physical_error_rate} is at or above the "
                f"threshold {self.threshold}; error correction does not converge and "
                "no code distance is sufficient"
            )
        if self.logical_error_prefactor <= 0:
            raise ValueError("logical_error_prefactor must be positive")
        if self.routing_factor < 1:
            raise ValueError("routing_factor cannot be below 1: patches need their own space")
        if self.factory_footprint_logical < 0:
            raise ValueError("factory_footprint_logical cannot be negative")
        if self.cycle_time_s <= 0 or self.reaction_time_s <= 0:
            raise ValueError("cycle and reaction times must be positive")
        if self.rotation_synthesis_epsilon is not None:
            require_finite(self.rotation_synthesis_epsilon, "rotation_synthesis_epsilon")
            if not 0 < self.rotation_synthesis_epsilon < 1:
                # eps >= 1 is not a loose budget, it is no approximation at all,
                # and log2(1/eps) <= 0 would hand back a zero or negative T-count
                # for a rotation that certainly costs something.
                raise ValueError("rotation_synthesis_epsilon must lie in (0, 1)")
        # NaN fails every comparison and inf passes `> 0`, so both would survive
        # the positivity check below and surface much later as a ValueError or
        # OverflowError out of `math.ceil` in `t_per_rotation`.
        require_finite(self.rotation_t_coefficient, "rotation_t_coefficient")
        if self.rotation_t_coefficient <= 0:
            raise ValueError("rotation_t_coefficient must be positive")

    @property
    def identity(self) -> str:
        """The string an estimate carries so it can never be read set-free.

        **The synthesis precision is part of the identity, not a footnote on
        it.** A circuit of a thousand arbitrary-angle rotations costs 60,000 T
        gates at eps=1e-6 and 100,000 at eps=1e-10, so two estimates that differ
        only in eps are different claims and must not be ranked against each
        other. Leaving eps out of the identity would let `comparable_with`
        return True for exactly that pair — a refusal that exists but never
        fires, which is worse than no refusal because it reads as a guarantee.

        `rotation_t_coefficient` is deliberately *not* here: it is a property of
        the synthesis algorithm the set commits to, so changing it is a change
        to the set and belongs in `version`. eps is different in kind — it comes
        from the algorithm's error budget, which is why it is stated per
        estimate rather than per set.
        """
        base = f"{self.name}@v{self.version}"
        if self.rotation_synthesis_epsilon is None:
            return base
        # `repr`, not `:g`. `:g` renders six significant figures, so 1.234561e-6
        # and 1.234562e-6 both become "1.23456e-06" — two different budgets with
        # one identity, and `comparable_with` then ranks them against each other.
        # That is the exact defect this identity exists to prevent, reintroduced
        # by the formatting. `repr` round-trips a float exactly.
        return f"{base}+eps={self.rotation_synthesis_epsilon!r}"

    def with_rotation_precision(self, epsilon: float) -> "AssumptionSet":
        """The same hardware, held to a stated per-rotation synthesis error.

        Returns a **new** set rather than mutating this one, and the difference
        shows up in `identity`, so an estimate computed with it can never be
        mistaken for one computed without.

        This is the supported way to answer "what does this circuit cost", since
        every built-in set states no precision on purpose and
        `t_per_rotation` refuses without one.
        """
        return replace(self, rotation_synthesis_epsilon=epsilon)

    @property
    def t_per_rotation(self) -> int:
        """T gates one arbitrary-angle rotation costs under this set.

        Raises when no precision is stated, because the alternative — picking a
        default — would turn "this circuit has no stated T-count" into a
        specific number that no one chose, on a page that shows it next to
        exactly-counted ones.
        """
        if self.rotation_synthesis_epsilon is None:
            raise ValueError(
                f"{self.identity} states no rotation_synthesis_epsilon, so an "
                "arbitrary-angle rotation has no T-count under it"
            )
        return math.ceil(
            self.rotation_t_coefficient * math.log2(1.0 / self.rotation_synthesis_epsilon)
        )

    @property
    def cycles_per_reaction(self) -> int:
        """Code cycles that elapse inside one control-system reaction interval.

        The unit bridge between Layer 4 (which counts serial *layers*) and
        Layer 2 (which counts patch-*rounds*, i.e. cycles). Ten under
        `gidney-2025`, and omitting it understates the spacetime volume tenfold.

        Snapped to the nearest integer before rounding up, because these are
        decimal times in binary floating point: `1e-5 / 1e-6` evaluates to
        10.000000000000002, and a bare `ceil` returns **11**, inflating every
        volume by 10% for no physical reason.
        """
        ratio = self.reaction_time_s / self.cycle_time_s
        nearest = round(ratio)
        if nearest >= 1 and math.isclose(ratio, nearest, rel_tol=1e-9):
            return nearest
        return max(1, math.ceil(ratio))

    @property
    def magic_states_per_second_per_factory(self) -> float:
        return 1.0 / (self.factory_cycles_per_state * self.cycle_time_s)

    def comparable_with(self, other: "AssumptionSet") -> bool:
        """Two estimates may only be ranked against each other when this holds.

        Deliberately identity-based rather than value-based. Two sets that
        happen to agree on every number today are still separate claims about
        hardware, and one of them can be revised tomorrow. Since `identity`
        carries the synthesis precision, this also refuses across two eps values
        — the case a name-and-version check would have waved through.
        """
        return self.identity == other.identity


GIDNEY_2025 = AssumptionSet(
    name="gidney-2025",
    version=1,
    citation=(
        "Gidney, How to factor 2048 bit RSA integers with less than a million "
        "noisy qubits (arXiv:2505.15917), which states its assumptions in one "
        "place: square nearest-neighbour grid, uniform 0.1% gate error, 1 us "
        "surface-code cycle, 10 us reaction time."
    ),
    physical_error_rate=1e-3,
    threshold=1e-2,
    logical_error_prefactor=0.1,
    routing_factor=2.0,
    factory_footprint_logical=15.0,
    cycle_time_s=1e-6,
    reaction_time_s=10e-6,
    factory_cycles_per_state=11,
    t_per_toffoli=4,
)
"""The only fully sourced set here.

`routing_factor`, `factory_footprint_logical` and `t_per_toffoli` are the three
values the paper does not state as such; they are the common working allowances
and are the first things to attack if a number looks wrong. See
`plans/leona-resource-estimation.md` §7.
"""

# A second, independently-sourced set (e.g. trapped-ion) belongs here and is
# deliberately absent. Do not invent one: an unsourced set makes an
# incomparable estimate look comparable, which is worse than having only one.
BUILTIN_ASSUMPTION_SETS: dict[str, AssumptionSet] = {GIDNEY_2025.identity: GIDNEY_2025}
