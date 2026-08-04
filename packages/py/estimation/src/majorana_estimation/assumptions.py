"""Named, versioned hardware assumption sets.

**The assumption set is the product, not a footnote.** Every number this package
emits is a costing under one of these, and two estimates computed under
different sets are not comparable — `AssumptionSet.comparable_with` is the
predicate that says so, and callers are expected to refuse to sort across it.

Adding a set is a sourcing job, not a modelling job: each field must come from a
published parameter set that states it. A fabricated assumption set is worse
than having none, because it makes an incomparable estimate look comparable.

**A set may be composed from more than one paper, and then it must say so per
value.** Requiring one paper to state all ten fields is a bar the trapped-ion
literature does not clear: the architecture papers that state a physical layer
either use a different code family or stop short of the magic-state factories
half this cost model is about. Composing is allowed; composing silently is not,
which is what `ValueProvenance` exists to prevent.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, fields, replace


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


def _and_list(names: tuple[str, ...]) -> str:
    """`a`, `a and b`, `a, b and c` — read aloud on a public page, not logged."""
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


@dataclass(frozen=True)
class ValueProvenance:
    """Why named values in a set are not simply "from the cited source".

    Two cases, and they are different claims a reader needs told apart:

    - the value comes from a **second paper** (a composed set), or
    - the value's own source states something else, and this model holds the
      number it holds for a reason worth printing.

    Both are legitimate. Neither is legitimate silently, which is the whole
    point: `working_allowances` can only say "no source states this", and using
    it for a value whose source states something *different* would print a false
    sentence — the exact failure `working_allowances` was added to end.

    The disclosure is pinned to field *names* rather than left as prose so
    `AssumptionSet.__post_init__` can refuse a name that is not a real field,
    and so a test can assert that every named field reaches the rendered string.
    """

    fields: tuple[str, ...]
    note: str

    def __post_init__(self) -> None:
        if not self.fields:
            raise ValueError("a ValueProvenance must name at least one field")
        if len(set(self.fields)) != len(self.fields):
            raise ValueError("a ValueProvenance must not repeat a field")
        if not self.note.strip():
            raise ValueError("a ValueProvenance must say where the value came from")

    @property
    def sentence(self) -> str:
        return f"{_and_list(self.fields)}: {self.note}."


@dataclass(frozen=True)
class FactoryTiming:
    """How long one factory takes to deliver one magic state, in code cycles.

    **A function of the code distance, because every source states it as one.**
    Held as a flat integer until 2026-08-05, which was not a simplification but
    an error: Litinski's 15-to-1 block takes 11 *time steps* and one time step
    is `d` code cycles, and Gidney's factory spends six lattice-surgery layers
    at two-thirds of a distance each. A distance-independent constant drops the
    `d` from both, which makes distillation throughput optimistic by roughly a
    factor of the code distance and — because the default factory count is the
    throughput/reaction crossover — the reported footprint with it.

    `constant_rounds + rounds_per_distance * d`. Two terms rather than one
    because Gidney's factory genuinely has both: 14.7 rounds of magic state
    cultivation that do not scale with `d`, plus 4d of lattice surgery that
    does.
    """

    constant_rounds: float = 0.0
    rounds_per_distance: float = 0.0

    def __post_init__(self) -> None:
        require_finite(self.constant_rounds, "constant_rounds")
        require_finite(self.rounds_per_distance, "rounds_per_distance")
        if self.constant_rounds < 0 or self.rounds_per_distance < 0:
            raise ValueError("factory timing terms cannot be negative")
        if self.constant_rounds == 0 and self.rounds_per_distance == 0:
            # Both zero is a factory that delivers states instantaneously, which
            # divides by zero one line into `magic_states_per_second_per_factory`
            # and would otherwise surface as a ZeroDivisionError from deep inside
            # the runtime layer rather than at the set that stated it.
            raise ValueError("a factory takes some time to deliver a magic state")

    def rounds(self, code_distance: int) -> float:
        """Surface-code rounds per magic state at this distance."""
        require_count(code_distance, "code_distance", minimum=1)
        return self.constant_rounds + self.rounds_per_distance * code_distance


@dataclass(frozen=True)
class PatchFootprint:
    """Physical qubits one logical patch costs, as `coefficient * (d + offset)^2`.

    **Per set rather than hard-coded, because the sources disagree and both are
    right about their own machine.** Gidney states 2(d+1)^2 per logical qubit;
    Litinski and Webber both state 2d^2 per tile. Until 2026-08-05 this package
    applied `d^2 + (d-1)^2` to every set, which is what an *unrotated* patch
    costs in data qubits alone — it counts no measure qubits, and lands about
    10% under the figure either source states (145 against 162 at d=9). No
    paper cited by either built-in set states it.

    The form is deliberately narrow. It expresses exactly what the two sourced
    conversions need and nothing else, so a third set cannot smuggle in an
    arbitrary polynomial without adding a field and having to say where it came
    from.
    """

    coefficient: float
    distance_offset: int = 0

    def __post_init__(self) -> None:
        require_finite(self.coefficient, "coefficient")
        if self.coefficient <= 0:
            raise ValueError("a patch costs a positive number of physical qubits")
        require_count(self.distance_offset, "distance_offset", minimum=0)

    def physical_qubits(self, code_distance: int) -> int:
        """Physical qubits for one logical patch at this distance."""
        require_count(code_distance, "code_distance", minimum=1)
        return math.ceil(self.coefficient * (code_distance + self.distance_offset) ** 2)


@dataclass(frozen=True)
class AssumptionSet:
    """One hardware+protocol parameter set, named and citable.

    `name` and `version` together are the identity that an estimate carries.
    Bump `version` whenever any number below changes: an estimate stored under
    "gidney-2025 v1" must never silently start meaning something else.
    """

    name: str
    version: int
    source_citation: str
    """What the source says. **Not what a reader sees** — read `citation`.

    Kept separate from the rendered string because a set is allowed to contain
    values its source does not state, and the disclosure of which ones must not
    be optional prose that a later edit can drop.
    """

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

    physical_qubits_per_patch: PatchFootprint
    """Physical qubits one logical patch costs at a given code distance."""

    # --- Layer 4, runtime --------------------------------------------------
    cycle_time_s: float
    """Wall-clock duration of one surface-code cycle."""

    reaction_time_s: float
    """Control-system feed-forward latency. Sets the floor no factory count beats."""

    factory_cycles_per_state: FactoryTiming
    """Surface-code cycles one factory takes to deliver one magic state.

    Distance-dependent — see `FactoryTiming`. The name is kept from when this
    was a flat integer so that a `working_allowances` or `value_provenance`
    entry naming it still reads as a sentence on the public page.
    """

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

    working_allowances: tuple[str, ...] = ()
    """Fields in this set that the source does **not** state.

    The module docstring says every field must come from a published set that
    states it. `gidney-2025` does not meet that bar and never did: three of its
    values are common working allowances rather than paper values. That was
    recorded only in a docstring — while the string rendered on the public page
    said the source "states its assumptions in one place". A visitor saw a
    citation implying nine sourced numbers where six were.

    Naming them here makes the disclosure structural rather than prose:
    `citation` cannot render without it, `__post_init__` refuses a name that is
    not a real field of this class, and a test pins that every name reaches the
    rendered string.

    Use this only for values **no** source states. A value whose source states
    something different belongs in `value_provenance`, because the sentence this
    field renders would otherwise be false.
    """

    value_provenance: tuple[ValueProvenance, ...] = ()
    """Values that came from somewhere other than `source_citation`.

    Carries composed sets — a physical layer from one paper and a factory layer
    from another — and any value this model holds differently from the source it
    otherwise follows. Every field named here is checked against the real fields
    of this class and must not also appear in `working_allowances`: a value
    cannot both come from a named paper and come from no paper.
    """

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("an assumption set must be named")
        require_count(self.version, "version", minimum=1)
        require_count(self.t_per_toffoli, "t_per_toffoli", minimum=1)
        # Both are dataclasses that validate themselves, but a caller passing a
        # bare number — the shape these fields had until 2026-08-05 — would
        # otherwise reach `rounds()` and fail with AttributeError several layers
        # away from the set that stated it.
        if not isinstance(self.factory_cycles_per_state, FactoryTiming):
            raise TypeError("factory_cycles_per_state must be a FactoryTiming")
        if not isinstance(self.physical_qubits_per_patch, PatchFootprint):
            raise TypeError("physical_qubits_per_patch must be a PatchFootprint")
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
        if not self.source_citation:
            raise ValueError("an assumption set must cite its source")
        # A misspelled allowance would disclose nothing while looking like a
        # disclosure — the exact failure this field exists to end. Names are
        # checked against the real fields, so `factory_footprint` (no `_logical`)
        # raises here instead of quietly dropping out of the rendered citation.
        known = {f.name for f in fields(self)}
        unknown = [name for name in self.working_allowances if name not in known]
        if unknown:
            raise ValueError(
                f"working_allowances names no such field(s): {', '.join(sorted(unknown))}"
            )
        if len(set(self.working_allowances)) != len(self.working_allowances):
            raise ValueError("working_allowances must not repeat a field")
        # Same check for the composed case, and for the same reason: a
        # misspelled field name renders a disclosure that discloses nothing.
        attributed: set[str] = set()
        for entry in self.value_provenance:
            unknown = [name for name in entry.fields if name not in known]
            if unknown:
                raise ValueError(
                    f"value_provenance names no such field(s): {', '.join(sorted(unknown))}"
                )
            clash = attributed.intersection(entry.fields)
            if clash:
                raise ValueError(
                    f"value_provenance attributes the same field twice: {', '.join(sorted(clash))}"
                )
            attributed.update(entry.fields)
        # A value cannot both come from a named paper and come from no paper.
        # Left unchecked the citation would say both, one sentence apart.
        contradiction = attributed.intersection(self.working_allowances)
        if contradiction:
            raise ValueError(
                "a field cannot be both a working allowance and attributed to a "
                f"source: {', '.join(sorted(contradiction))}"
            )

    @property
    def citation(self) -> str:
        """What a reader is shown — the source, plus what the source did not say.

        This is the string the public estimate panel renders
        (`apps/web/components/repository-estimate.tsx`), which is why the
        disclosure is composed here rather than left to whoever writes the
        `source_citation`. A caveat that lives only in a docstring is not a
        caveat: nobody reading the page can see it.

        The allowance sentence stays immediately after `source_citation` because
        it opens with "It", and the antecedent is the source. Attributions to
        other papers follow, where their own sentences name their own sources.
        """
        parts = [self.source_citation]
        if self.working_allowances:
            named = ", ".join(self.working_allowances)
            subject = "value" if len(self.working_allowances) == 1 else "values"
            parts.append(
                f"It does not state the {subject} "
                f"{named} used here; those are common working allowances rather than "
                "paper values, and are the first thing to attack if a number looks wrong."
            )
        parts.extend(entry.sentence for entry in self.value_provenance)
        return " ".join(parts)

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

    def magic_states_per_second_per_factory(self, code_distance: int) -> float:
        """States one factory delivers per second at this code distance.

        Takes the distance because factory time does. It was a property while
        `factory_cycles_per_state` was a flat integer, and the signature change
        is deliberate: a caller that still reads it set-free will fail loudly
        rather than silently keep a distance-free throughput.
        """
        return 1.0 / (self.factory_cycles_per_state.rounds(code_distance) * self.cycle_time_s)

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
    version=2,
    source_citation=(
        "Gidney, How to factor 2048 bit RSA integers with less than a million "
        "noisy qubits (arXiv:2505.15917), which states its hardware assumptions "
        "in one place: square nearest-neighbour grid, uniform 0.1% gate error, "
        "1 us surface-code cycle, 10 us reaction time. It also states, in its "
        "Physical Costs section, the three values this model used to invent: "
        "2(d+1)^2 physical qubits per logical patch, magic state factories "
        "covering a 3x4 area of patches, and 8T-to-CCZ distillation, so eight T "
        "states per Toffoli."
    ),
    value_provenance=(
        ValueProvenance(
            fields=("threshold", "logical_error_prefactor"),
            note=(
                "the logical-error form this model uses, p_L = 0.1(100p)^((d+1)/2) "
                "with a 1% threshold, is Fowler and Gidney, Low overhead quantum "
                "computation using lattice surgery (arXiv:1808.06709) — quoted as "
                "equation (10) of Litinski's A Game of Surface Codes and equation "
                "(2) of Webber et al. arXiv:2505.15917 does not use it: it picks a "
                "distance by reading a target error rate of 1e-15 per logical qubit "
                "round off simulated suppression curves (its figure 6), which is a "
                "shape this model has no field for"
            ),
        ),
        ValueProvenance(
            fields=("routing_factor",),
            note=(
                "the leading term of Litinski's data blocks in A Game of Surface "
                "Codes (Quantum 3, 128, arXiv:1808.02892) — 2n+4 tiles for the "
                "intermediate block, 2n+sqrt(8n)+1 for the fast one, both 2n to "
                "leading order. arXiv:2505.15917 lays out a fixed 7x18 compute "
                "region with three columns of workspace rather than a multiplier "
                "on the data block, which is not a shape this field can hold. The "
                "constant term is dropped, so this is optimistic by a few patches"
            ),
        ),
        ValueProvenance(
            fields=("factory_cycles_per_state",),
            note=(
                "the paper's own derivation — 14.7 rounds of magic state "
                "cultivation plus six lattice-surgery layers at 2d/3 rounds each, "
                "which is 14.7 + 4d rounds per CCZ state and reproduces its stated "
                "114.7 at its own d = 25 — divided by the eight T states a CCZ "
                "costs here. The paper then rounds 114.7 up to 150 for slack and "
                "carries 150 forward, so this model is about 24% faster at "
                "distillation than the figure the paper reports. The derivation is "
                "taken rather than the rounded figure because it is the one that "
                "states how the cost moves with the code distance, which is the "
                "whole reason this field is not a constant. One distortion follows "
                "from spreading it over eight states and is worth knowing: the "
                "paper's factory delivers a CCZ state, not a bare T state, and its "
                "two terms are not alike — the 14.7 is cultivating the eight input "
                "T states (independently confirmed here: the paper's 30000 physical "
                "qubit-rounds per cultivated T state over a 12-patch factory at d = "
                "25 is 1.85 rounds, which is 14.7/8), while the 4d is the 8T-to-CCZ "
                "distillation on top. This model has one magic-state currency, so a "
                "circuit whose states are plain T gates — every synthesised rotation "
                "in this catalogue — is charged a share of a distillation it never "
                "performs, and is pessimistic on factory time by roughly 3.4x at d = "
                "9. A circuit of Toffolis is charged exactly the paper's 114.7. "
                "Pessimistic is the safe direction for a machine size, and splitting "
                "the two terms needs a factory model this record does not have"
            ),
        ),
    ),
    physical_error_rate=1e-3,
    threshold=1e-2,
    logical_error_prefactor=0.1,
    routing_factor=2.0,
    factory_footprint_logical=12.0,
    cycle_time_s=1e-6,
    reaction_time_s=10e-6,
    # 14.7 + 4d rounds per CCZ state, over the 8 T states a CCZ costs below.
    factory_cycles_per_state=FactoryTiming(
        constant_rounds=14.7 / 8,
        rounds_per_distance=4.0 / 8,
    ),
    t_per_toffoli=8,
    physical_qubits_per_patch=PatchFootprint(coefficient=2.0, distance_offset=1),
)
"""Superconducting-style hardware. Every value now names a paper.

**No `working_allowances` — that is the change in v2.** v1 carried three values
no source stated and a fourth that contradicted its source; checking the paper
line by line rather than the docstring found that it states all four, plus the
patch conversion this package had been applying to every set. What is left is
three attributions: two values that come from the paper Gidney's own
bibliography cites for the suppression law, one from the layout paper, and one
departure — the factory's derivation rather than its slack-padded figure — each
disclosed in `citation` rather than in a comment nobody reading the page sees.
"""

COMPOSED_TRAPPED_ION = AssumptionSet(
    name="composed-trapped-ion",
    version=2,
    source_citation=(
        "Composed from two papers, because no published trapped-ion parameter set "
        "states all of these values in one place. Physical layer: Webber, Elfving, "
        "Weidt and Hensinger, The impact of hardware specifications on reaching "
        "quantum advantage in the fault tolerant regime (arXiv:2108.12371, AVS "
        "Quantum Science 4, 013801), which costs a shuttling-based trapped-ion "
        "architecture under the surface code and states a 1% threshold, a 1e-3 base "
        "physical error rate, p_L = 0.1(100p)^((d+1)/2), a 235 us code cycle, a "
        "reaction time of (code cycle)/4 + 10 us — 68.75 us at that cycle — a "
        "Toffoli decomposed into 4 T gates, and 2d^2 physical qubits per tile."
    ),
    value_provenance=(
        ValueProvenance(
            fields=("routing_factor",),
            note=(
                "the leading term of the data blocks in the layout paper the "
                "physical-layer paper builds on, Litinski, A Game of Surface Codes "
                "(Quantum 3, 128, arXiv:1808.02892) — 2n+4 tiles for the "
                "intermediate block and 2n+sqrt(8n)+1 for the fast block Webber et "
                "al. actually use. This model has no slot for either constant term, "
                "so it charges the 2n and is optimistic by a few patches"
            ),
        ),
        ValueProvenance(
            fields=("factory_footprint_logical", "factory_cycles_per_state"),
            note=(
                "Litinski's 116-to-12 distillation block, which is the one he "
                "selects at this set's own physical error rate of 1e-3: 44 tiles "
                "distilling 12 states in 99 time steps at 89% success, which he "
                "states as one state every 9.27 time steps, and one time step is d "
                "code cycles. The 15-to-1 block's 11 tiles were used here until "
                "2026-08-05, and that block is the one he shows is *not* good "
                "enough at 1e-3 — its output error of 35p^3 misses the 1e-10 a "
                "billion-gate circuit needs. Webber et al. instead use the "
                "separately-calibrated factories of Litinski's Magic state "
                "distillation: not as costly as you think (Quantum 3, 205), where "
                "the distillation blocks carry a lower code distance than the data "
                "blocks; this model has one distance for the whole machine and so "
                "cannot represent that, which makes these factories more expensive "
                "than the ones the paper costs"
            ),
        ),
    ),
    physical_error_rate=1e-3,
    threshold=1e-2,
    logical_error_prefactor=0.1,
    routing_factor=2.0,
    factory_footprint_logical=44.0,
    cycle_time_s=235e-6,
    reaction_time_s=68.75e-6,
    factory_cycles_per_state=FactoryTiming(rounds_per_distance=9.27),
    t_per_toffoli=4,
    physical_qubits_per_patch=PatchFootprint(coefficient=2.0),
)
"""Trapped ions with shuttling: better fidelity is not the axis that decides this.

The second set exists so the machinery that refuses to rank across sets has a
real pair to refuse, and it earns its place by disagreeing with `gidney-2025`
somewhere that matters. It shares p, p_th and A, so the *code distance* is
nearly the same circuit for circuit; everything that differs is in the time
layer and in distillation. A 235 us cycle against 1 us makes each factory
roughly 235x slower, and the factory count this model defaults to — the
crossover past which the reaction floor binds — rises accordingly. That is the
cited paper's own headline finding reproduced by our arithmetic rather than
quoted from its abstract: slower hardware can still reach a target runtime, but
only by being far more scalable.

**In v2 it is also the more honest of the two about distillation**, since its
factory is the block Litinski selects at 1e-3 rather than the cheaper one he
rules out there — so the gap between the two sets is now partly a real
difference in what the sources cost, not only in clock speed.

**It is composed, and the name says so** rather than borrowing one author's
name for a set they did not write.
"""

BUILTIN_ASSUMPTION_SETS: dict[str, AssumptionSet] = {
    GIDNEY_2025.identity: GIDNEY_2025,
    COMPOSED_TRAPPED_ION.identity: COMPOSED_TRAPPED_ION,
}
