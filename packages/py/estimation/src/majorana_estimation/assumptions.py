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

from dataclasses import dataclass


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

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("an assumption set must be named")
        if self.version < 1:
            raise ValueError("assumption set version starts at 1")
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
        if self.factory_cycles_per_state < 1:
            raise ValueError("a factory takes at least one cycle per state")
        if self.t_per_toffoli < 1:
            raise ValueError("a Toffoli costs at least one magic state")

    @property
    def identity(self) -> str:
        """The string an estimate carries so it can never be read set-free."""
        return f"{self.name}@v{self.version}"

    @property
    def magic_states_per_second_per_factory(self) -> float:
        return 1.0 / (self.factory_cycles_per_state * self.cycle_time_s)

    def comparable_with(self, other: "AssumptionSet") -> bool:
        """Two estimates may only be ranked against each other when this holds.

        Deliberately identity-based rather than value-based. Two sets that
        happen to agree on every number today are still separate claims about
        hardware, and one of them can be revised tomorrow.
        """
        return self.name == other.name and self.version == other.version


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
