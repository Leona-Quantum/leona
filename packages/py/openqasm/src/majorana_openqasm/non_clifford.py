"""Non-Clifford cost of a parsed circuit — the input a resource estimate needs.

``resource_metrics`` answers "how big is this circuit". A fault-tolerant
estimate needs a different question answered: how many **magic states** does it
consume, and how long is the serial chain that consumes them. Those two
numbers, plus the ancilla-inclusive width, are the whole of
``majorana_estimation.LogicalCost``.

The hard part is not counting ``t`` gates. It is **refusing to count** when the
circuit is not in a basis where the count exists. An ``rz(0.3)`` has no T-count
until a synthesis precision is named, and the cost then depends on it — order
``3·log2(1/ε)`` T gates for one rotation, so a circuit with a thousand of them
moves the estimate by orders of magnitude depending on a number nobody stated.
A function that silently scored such a rotation 0 would hand the estimator a
circuit that looks free and is not, and the estimator has no way to tell.

So the result carries its own admissibility: :attr:`NonCliffordCost.exact` is
true only when every operation was classified from a closed vocabulary, and
:meth:`NonCliffordCost.logical_cost` raises rather than degrading. This is the
roadmap's poison rule (§5.3) in the one place the poison enters — one operation
this module cannot name makes the whole circuit's cost unknown, and the caller
is told *which* operations did it, not merely that something did.

Counting happens over the **flattened** instruction stream: composite gates are
walked into their definitions, so a circuit built from library gates costs the
same as the same circuit written out. Known names are matched before recursing,
so a ``ccx`` is one Toffoli rather than the seven T gates its definition holds.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from qiskit import QuantumCircuit

# Recursion bound for walking composite gate definitions. Qiskit's library
# nests a handful of levels deep; this exists so a pathological or cyclic
# definition fails loudly instead of exhausting the stack.
_MAX_DEFINITION_DEPTH = 12

# Operations that occupy the circuit but consume no magic states and impose no
# non-Clifford ordering. `measure` and `reset` matter enormously to a real
# fault-tolerant schedule; they are excluded here because `LogicalCost` models
# the non-Clifford chain only, and charging them would double-count against the
# reaction-limited floor the estimator already applies per non-Clifford layer.
_IGNORED = frozenset({"barrier", "measure", "reset", "delay", "id", "i", "snapshot"})

_CLIFFORD = frozenset(
    {
        "x", "y", "z", "h", "s", "sdg", "sx", "sxdg",
        "cx", "cy", "cz", "swap", "iswap", "dcx", "ecr",
    }
)  # fmt: skip

_T_GATES = frozenset({"t", "tdg"})

# Counted as one distilled-state consumer rather than expanded, because the
# Toffoli-to-magic-state convention is the estimator's parameter to set
# (`LogicalCost.magic_states(t_per_toffoli=...)`), not this module's to assume.
_TOFFOLI = frozenset({"ccx", "ccz", "rccx"})

# Single-qubit rotations whose angle decides everything. Anything controlled is
# deliberately absent: `cp(pi)` is CZ but `cp(pi/2)` is controlled-S, and the
# general controlled rotation needs a real decomposition. Those land in
# `synthesis_required`, which is the honest answer.
_ROTATIONS = frozenset({"rz", "ry", "rx", "p", "u1", "phase"})


@dataclass(frozen=True)
class NonCliffordCost:
    """What a circuit costs in magic states, or why that cannot be stated."""

    logical_qubits: int
    """Ancilla-inclusive width: every qubit the circuit declares."""

    t_count: int = 0
    """Standalone T gates, including rotations that reduce to exactly one T."""

    toffoli_count: int = 0

    non_clifford_depth: int = 0
    """Longest serial chain of non-Clifford operations, over the flattened stream."""

    synthesis_required: int = 0
    """Arbitrary-angle rotations with no T-count until a precision is named."""

    unsupported: tuple[str, ...] = ()
    """Gate names this module could not classify, deduplicated and sorted."""

    clifford_count: int = 0
    """Reported so a caller can see the circuit was read, not skipped."""

    _rotation_names: tuple[str, ...] = field(default=(), repr=False)

    @property
    def exact(self) -> bool:
        """True only when every operation was named from the closed vocabulary.

        An inexact cost is not a smaller cost — it is an unknown one. Nothing
        here reports a lower bound, because a lower bound presented next to an
        exact number reads as the same kind of thing.
        """
        return not self.unsupported and self.synthesis_required == 0

    @property
    def is_clifford_only(self) -> bool:
        return self.t_count == 0 and self.toffoli_count == 0

    def why_not_exact(self) -> str:
        """The sentence a UI shows instead of a number. Empty when exact."""
        if self.exact:
            return ""
        reasons = []
        if self.synthesis_required:
            names = ", ".join(sorted(set(self._rotation_names)))
            reasons.append(
                f"{self.synthesis_required} arbitrary-angle rotation(s) ({names}) "
                "have no T-count until a synthesis precision is named"
            )
        if self.unsupported:
            reasons.append(
                f"{len(self.unsupported)} unrecognised operation(s): " + ", ".join(self.unsupported)
            )
        return "; ".join(reasons)

    def logical_cost(self, *, label: str = "", t_per_rotation: int | None = None):
        """Build a ``majorana_estimation.LogicalCost``, or refuse.

        ``t_per_rotation`` is the caller's stated synthesis convention — take it
        from ``AssumptionSet.t_per_rotation``, which raises unless a precision
        was named. Supplying it converts the arbitrary-angle rotations into a
        T-count *under that assumption*; omitting it leaves them uncountable and
        this refuses. An unrecognised operation is refused either way: no
        precision makes an unnamed gate cost something.

        ``majorana_estimation`` is imported lazily because it declares no
        dependencies on purpose, and this package must not be what gives it one.
        """
        if self.unsupported:
            raise InexactCostError(self.why_not_exact())
        t_count = self.t_count
        if self.synthesis_required:
            if t_per_rotation is None:
                raise InexactCostError(self.why_not_exact())
            if t_per_rotation < 1:
                raise ValueError("t_per_rotation must be at least 1")
            t_count += self.synthesis_required * t_per_rotation
        from majorana_estimation import LogicalCost

        return LogicalCost(
            logical_qubits=self.logical_qubits,
            toffoli_count=self.toffoli_count,
            t_count=t_count,
            non_clifford_depth=self.non_clifford_depth,
            label=label,
        )


class InexactCostError(ValueError):
    """Raised when a circuit's magic-state cost is not a number that exists."""


# `k*pi/n`, `pi/n`, `pi`, `-2*pi`, or a bare number. This exists because the
# published corpus writes its angles symbolically — `pi/8`, `3*pi/8`, `4*pi/8` —
# and a plain float() on those returns nothing. That failure is the dangerous
# kind: every rotation would fall to "needs synthesis", every catalogue circuit
# would report an unknown cost, and the output would look like a conservative
# refusal rather than a parser that never read the angle. `4*pi/8` is Clifford
# and `2*pi/8` is exactly one T; both are knowable and neither survives float().
_ANGLE_RE = re.compile(
    r"""^\s*
    (?P<sign>[-+])?\s*
    (?:(?P<coeff>\d+(?:\.\d+)?)\s*\*\s*)?
    (?P<pi>pi|π)
    (?:\s*/\s*(?P<divisor>\d+(?:\.\d+)?))?
    \s*$""",
    re.VERBOSE | re.IGNORECASE,
)


def _angle(param: object) -> float | None:
    """Return a bound angle in radians, or None when it is not an angle.

    An unbound ``Parameter`` is not a small angle — it is no angle, and the
    circuit has no T-count until it is bound.
    """
    try:
        return float(param)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        pass
    if not isinstance(param, str):
        return None
    match = _ANGLE_RE.match(param)
    if match is None:
        return None
    value = math.pi * float(match["coeff"] or 1)
    divisor = float(match["divisor"] or 1)
    if divisor == 0:
        return None
    value /= divisor
    return -value if match["sign"] == "-" else value


def _classify_rotation(angle: float | None) -> str:
    """One of ``clifford`` / ``t`` / ``synthesis``.

    A rotation by a multiple of pi/2 is Clifford; an odd multiple of pi/4 is
    exactly one T. Everything else needs synthesis. The tolerance is absolute
    and tight: angles here come from parsed source, where pi/4 arrives as the
    float nearest to it, not from an optimiser that drifted.
    """
    if angle is None:
        return "synthesis"
    quarters = angle / (math.pi / 4)
    nearest = round(quarters)
    if not math.isclose(quarters, nearest, abs_tol=1e-9):
        return "synthesis"
    return "clifford" if nearest % 2 == 0 else "t"


def _walk(
    circuit: QuantumCircuit,
    mapping: tuple[int, ...],
    depth: int,
    out: list[tuple[str, tuple[int, ...], list[object]]],
) -> None:
    """Flatten `circuit` into (name, parent-qubit-indices, params) triples."""
    if depth > _MAX_DEFINITION_DEPTH:
        raise InexactCostError(
            f"gate definitions nested deeper than {_MAX_DEFINITION_DEPTH} levels"
        )
    for instruction in circuit.data:
        operation = instruction.operation
        name = operation.name
        if name in _IGNORED:
            continue
        qubits = tuple(mapping[circuit.find_bit(q).index] for q in instruction.qubits)
        if name in _CLIFFORD or name in _T_GATES or name in _TOFFOLI or name in _ROTATIONS:
            out.append((name, qubits, list(operation.params)))
            continue
        # Only now is recursion right: a known name is counted as itself, so a
        # Toffoli stays one Toffoli instead of becoming its definition's T gates.
        definition = getattr(operation, "definition", None)
        if definition is not None and len(definition.qubits) == len(qubits):
            _walk(definition, qubits, depth + 1, out)
            continue
        out.append((name, qubits, list(operation.params)))


def non_clifford_cost(circuit: QuantumCircuit) -> NonCliffordCost:
    """Extract the magic-state cost of a parsed circuit (E1)."""
    flattened: list[tuple[str, tuple[int, ...], list[object]]] = []
    _walk(circuit, tuple(range(circuit.num_qubits)), 0, flattened)
    return _count(flattened, circuit.num_qubits)


def portable_circuit_cost(portable: Mapping[str, object]) -> NonCliffordCost:
    """Cost a published catalogue entry's ``portableCircuit`` (E1 → E4).

    The corpus stores circuits as ``{qubitCount, steps: [{gate, qubits, param}]}``
    rather than OpenQASM, so this is the front door for the 120 entries that
    carry one. It feeds the same counting core as the Qiskit path — the
    classification of what is Clifford and what needs synthesis is written once,
    because two copies of that predicate would drift and only one of them would
    be the one a published estimate was computed with.
    """
    steps = portable.get("steps") or ()
    if not isinstance(steps, Sequence):
        raise InexactCostError("portableCircuit.steps is not a sequence")
    width = portable.get("qubitCount")
    stream: list[tuple[str, tuple[int, ...], list[object]]] = []
    highest = -1
    for step in steps:
        if not isinstance(step, Mapping):
            raise InexactCostError("portableCircuit step is not an object")
        name = str(step.get("gate", "")).lower()
        qubits = tuple(int(q) for q in (step.get("qubits") or ()))
        highest = max(highest, *qubits) if qubits else highest
        param = step.get("param")
        stream.append((name, qubits, [param] if param is not None else []))
    # A declared width that is narrower than the qubits actually indexed would
    # understate the patch count, so the wider of the two wins.
    declared = int(width) if isinstance(width, (int, float)) else 0
    return _count(stream, max(declared, highest + 1, 1))


def _count(
    flattened: list[tuple[str, tuple[int, ...], list[object]]],
    logical_qubits: int,
) -> NonCliffordCost:
    t_count = 0
    toffoli_count = 0
    clifford_count = 0
    synthesis_required = 0
    rotation_names: list[str] = []
    unsupported: set[str] = set()
    # Per-qubit high-water mark of the non-Clifford chain, so the depth is the
    # longest serial run rather than the total count.
    reached: dict[int, int] = {}
    non_clifford_depth = 0

    for name, qubits, params in flattened:
        kind: str
        if name in _T_GATES:
            kind, t_count = "non_clifford", t_count + 1
        elif name in _TOFFOLI:
            kind, toffoli_count = "non_clifford", toffoli_count + 1
        elif name in _CLIFFORD:
            kind, clifford_count = "clifford", clifford_count + 1
        elif name in _ROTATIONS:
            verdict = _classify_rotation(_angle(params[0]) if params else None)
            if verdict == "clifford":
                kind, clifford_count = "clifford", clifford_count + 1
            elif verdict == "t":
                kind, t_count = "non_clifford", t_count + 1
            else:
                kind = "non_clifford"
                synthesis_required += 1
                rotation_names.append(name)
        else:
            unsupported.add(name)
            # An operation nobody could name still orders the circuit, so it
            # extends the chain. Leaving it out would make an unknown circuit
            # look shallower than a known one.
            kind = "non_clifford"

        if kind == "non_clifford":
            at = max((reached.get(q, 0) for q in qubits), default=0) + 1
            for q in qubits:
                reached[q] = at
            non_clifford_depth = max(non_clifford_depth, at)

    return NonCliffordCost(
        logical_qubits=logical_qubits,
        t_count=t_count,
        toffoli_count=toffoli_count,
        non_clifford_depth=non_clifford_depth,
        synthesis_required=synthesis_required,
        unsupported=tuple(sorted(unsupported)),
        clifford_count=clifford_count,
        _rotation_names=tuple(rotation_names),
    )
