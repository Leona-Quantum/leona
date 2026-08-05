"""What a published entry's ``portableCircuit`` is, read in one place (R1).

Two things now derive from a catalogue entry's circuit — its fault-tolerant cost
(:mod:`majorana_openqasm.non_clifford`) and its structural size
(:func:`portable_circuit_metrics`) — and both are rendered on the same page for
the same entry. So both have to agree about what the circuit *is*.

Width is the case that forced this module. The corpus's declared ``qubitCount``
is not always the highest index its steps actually address, and the cost path
resolves that by taking the wider of the two. A profile that instead trusted the
declaration would print "16 qubits" beside a cost computed over 17 — two numbers
from the same record, disagreeing, one above the other. Writing the rule twice is
what would make that possible, so it is written here once and both callers take
it.

**Nothing here filters the step list.** In the Qiskit path a barrier or an ``id``
is skipped before counting; the portable model has no such operations — its
vocabulary is twelve gates, all of them real — so every step is a gate and the
count is the length. :func:`majorana_openqasm.portable.PORTABLE_GATES` states
that vocabulary, and a corpus test holds the corpus to it, because the moment an
entry carries a thirteenth name this assumption stops being free.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

#: The closed vocabulary the portable model emits, lower-cased. Mirrors
#: `PortableCircuitGate` in apps/web/lib/circuit-frameworks.ts. Nothing here
#: rejects a name outside it — a size metric is available for any step list,
#: which is precisely the difference between this module and the cost one — but
#: the "every step is a gate" reading of `gate_count` is only true while the
#: vocabulary holds, and a test asserts it against the published corpus.
PORTABLE_GATES = frozenset({"h", "x", "y", "z", "s", "t", "rx", "ry", "rz", "cx", "cz", "swap"})

#: A step's flattened form: (lower-cased gate name, qubit indices, params).
#: Matches what `non_clifford._count` and `non_clifford._walk` already pass
#: around, so the Qiskit path and the portable path feed one counting core.
PortableStep = tuple[str, tuple[int, ...], list[object]]


class MalformedPortableCircuit(ValueError):
    """The record's circuit cannot be read as a portable circuit at all.

    A shape problem, not a physics one. Kept distinct from
    ``InexactCostError`` — which means "this circuit's cost is not a number that
    exists" — because the two want opposite responses: a cost that cannot be
    stated is a finding worth rendering, and a record that cannot be parsed is a
    data defect. Both are ``ValueError``, which is what the route catches.
    """


@dataclass(frozen=True)
class PortableProgram:
    """A portable circuit after its shape has been read and checked once."""

    width: int
    """Qubits the circuit occupies: the wider of the declared count and the
    highest index actually addressed. A declared width narrower than the steps
    would understate the patch count on the cost path and the size on the
    profile path, so neither is allowed to trust it alone."""

    stream: list[PortableStep]
    """Every step, in order, unfiltered."""

    measures_all: bool
    """The portable model's terminal all-qubit measurement flag. It is all-or-
    nothing by construction — there is no per-qubit measurement in this model
    and no mid-circuit one — which is why a measurement count can be derived
    from a boolean at all."""


@dataclass(frozen=True)
class PortableCircuitMetrics:
    """How big a circuit is — the question a resource *estimate* does not answer.

    Deliberately parallel to what ``majorana_openqasm.resource_metrics`` returns
    for a parsed QASM program, field for field and *convention* for convention,
    because the two are the same five numbers about the same circuit reached by
    two routes. In particular ``depth`` counts the terminal measurement layer and
    the two counts do not count measurements, which is what Qiskit's
    ``QuantumCircuit.depth()`` and ``size()`` do. A test builds the Qiskit
    circuit from the same steps and asserts the two agree, so this claim is
    checked against the reference implementation rather than against itself.
    """

    qubits: int
    depth: int
    gate_count: int
    two_qubit_gate_count: int
    measurement_count: int


class Layering:
    """Per-qubit high-water mark — the ASAP layer each operation lands in.

    Depth is the longest *serial* run through the circuit, not the number of
    operations in it: two gates on disjoint qubits share a layer. Shared between
    the non-Clifford chain (which advances only on operations that consume magic
    states) and the full circuit depth (which advances on all of them), because
    they are the same machine under two filters, and a second copy of it would
    be a second thing to get wrong about the one number a visitor sorts by.
    """

    __slots__ = ("_reached", "depth")

    def __init__(self) -> None:
        self._reached: dict[int, int] = {}
        self.depth = 0

    def place(self, qubits: Sequence[int]) -> int:
        """Place an operation on `qubits` and return the layer it lands in.

        An operation on no qubits still occupies a layer. That is deliberate and
        matches the cost path: an operation nobody could name still orders the
        circuit, and leaving it out would make an unreadable circuit look
        shallower than a readable one.
        """
        at = max((self._reached.get(q, 0) for q in qubits), default=0) + 1
        for qubit in qubits:
            self._reached[qubit] = at
        self.depth = max(self.depth, at)
        return at


def read_portable_circuit(portable: Mapping[str, object]) -> PortableProgram:
    """Read ``{qubitCount, steps: [{gate, qubits, param}], measure}`` into a program.

    Raises :class:`MalformedPortableCircuit` rather than returning a partial
    reading. Every rejection here is a shape the corpus cannot legitimately hold,
    and the alternative to refusing is a number computed over a circuit nobody
    can point at.
    """
    steps = portable.get("steps") or ()
    if isinstance(steps, (str, bytes)) or not isinstance(steps, Sequence):
        raise MalformedPortableCircuit("portableCircuit.steps is not a sequence")

    stream: list[PortableStep] = []
    highest = -1
    for index, step in enumerate(steps):
        if not isinstance(step, Mapping):
            raise MalformedPortableCircuit("portableCircuit step is not an object")
        name = str(step.get("gate", "")).lower()
        raw = step.get("qubits") or ()
        if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence):
            raise MalformedPortableCircuit(
                f"portableCircuit step {index} ({name!r}) has no qubit list"
            )
        try:
            qubits = tuple(int(qubit) for qubit in raw)
        except (TypeError, ValueError) as exc:
            raise MalformedPortableCircuit(
                f"portableCircuit step {index} ({name!r}) indexes a non-integer qubit"
            ) from exc
        # A negative index is not a qubit. Left unchecked it does two separate
        # kinds of damage: it never raises the high-water mark, so the circuit
        # reads narrower than it is, and it opens a phantom entry in the depth
        # map that no real qubit shares a layer with.
        if any(qubit < 0 for qubit in qubits):
            raise MalformedPortableCircuit(
                f"portableCircuit step {index} ({name!r}) indexes a negative qubit"
            )
        highest = max(highest, *qubits) if qubits else highest
        param = step.get("param")
        stream.append((name, qubits, [param] if param is not None else []))

    declared_raw = portable.get("qubitCount")
    declared = (
        int(declared_raw)
        if isinstance(declared_raw, (int, float)) and math.isfinite(declared_raw)
        else 0
    )
    return PortableProgram(
        width=max(declared, highest + 1, 1),
        stream=stream,
        measures_all=bool(portable.get("measure")),
    )


def portable_circuit_metrics(portable: Mapping[str, object]) -> PortableCircuitMetrics:
    """Measure a published entry's ``portableCircuit`` (R1).

    Unlike a cost, this **never refuses on account of the circuit's contents**.
    A size is available for any step list, including one holding an operation
    this stack cannot name — the poison rule governs magic states, where an
    unnameable operation makes the answer not exist, and it does not govern
    "how many steps are there". Only an unreadable *shape* refuses, and that
    raises rather than returning zeros, because a circuit reported as having no
    gates and a circuit nobody could parse must not render the same.
    """
    program = read_portable_circuit(portable)

    layering = Layering()
    two_qubit_gate_count = 0
    for _name, qubits, _params in program.stream:
        layering.place(qubits)
        if len(qubits) == 2:
            two_qubit_gate_count += 1

    # All-or-nothing by construction, so the terminal measurement is one layer
    # over every qubit at once — which is exactly what it costs in Qiskit's
    # `depth()`, the convention this mirrors.
    measurement_count = program.width if program.measures_all else 0
    depth = layering.depth + (1 if program.measures_all else 0)

    return PortableCircuitMetrics(
        qubits=program.width,
        depth=depth,
        gate_count=len(program.stream),
        two_qubit_gate_count=two_qubit_gate_count,
        measurement_count=measurement_count,
    )
