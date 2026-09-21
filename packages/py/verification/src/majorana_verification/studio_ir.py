"""Independent equivalence checking for Studio's closed compiler IR.

Proposal 3 (targeted synthesis): every candidate the compiler lane
(`majorana_frameworks.optimizer_kernel`) produces gets checked here, against
the ORIGINAL circuit, before Studio is told it is equivalent. The compiler's
own claim (e.g. pytket's `RemoveRedundancies`/`FullPeepholeOptimise`, or
Qiskit's transpiler) is a statement about what that SDK believes it
preserved — this module proves the same claim independently, the way
`exact_equivalence` already does for OpenQASM sources elsewhere in this
package. A TKET optimisation pass has, in this project's own research,
returned a circuit its caller believed was equivalent and was not; this is
the check that exists so that belief is never taken on trust again.

The circuit is built directly from Studio's closed, declarative operation
list — the same `CircuitOptimizationOperation` every compiler adapter in
`majorana_frameworks` already consumes and returns — never from source code,
so nothing here evaluates anything a user or a compiler wrote.
"""

from __future__ import annotations

from collections.abc import Callable

from majorana_contracts import (
    CircuitOptimizationGate,
    CircuitOptimizationOperation,
    SynthesisEquivalence,
)
from qiskit import QuantumCircuit, qasm3

from .statevector import UNITARY_MAX_QUBITS, MethodCeilingExceeded, exact_equivalence

#: `exact_equivalence`'s own default (`max_qubits=6`) is conservative for a
#: caller with no better number to give it. A targeted-synthesis candidate
#: has exactly one comparison to make, so this uses the real hard ceiling of
#: the dense path underneath it (`statevector.UNITARY_MAX_QUBITS`, measured
#: against this worker's own hardware — see that module).
SYNTHESIS_EQUIVALENCE_MAX_QUBITS = UNITARY_MAX_QUBITS

_METHOD = "exact_unitary_statevector"

_ONE_QUBIT: dict[CircuitOptimizationGate, Callable[[QuantumCircuit, int], None]] = {
    CircuitOptimizationGate.H: QuantumCircuit.h,
    CircuitOptimizationGate.X: QuantumCircuit.x,
    CircuitOptimizationGate.Y: QuantumCircuit.y,
    CircuitOptimizationGate.Z: QuantumCircuit.z,
    CircuitOptimizationGate.S: QuantumCircuit.s,
    CircuitOptimizationGate.T: QuantumCircuit.t,
}
_ONE_QUBIT_ROTATION: dict[CircuitOptimizationGate, Callable[[QuantumCircuit, float, int], None]] = {
    CircuitOptimizationGate.RX: QuantumCircuit.rx,
    CircuitOptimizationGate.RY: QuantumCircuit.ry,
    CircuitOptimizationGate.RZ: QuantumCircuit.rz,
}
_TWO_QUBIT: dict[CircuitOptimizationGate, Callable[[QuantumCircuit, int, int], None]] = {
    CircuitOptimizationGate.CX: QuantumCircuit.cx,
    CircuitOptimizationGate.CZ: QuantumCircuit.cz,
    CircuitOptimizationGate.SWAP: QuantumCircuit.swap,
}


def _unitary_prefix(
    operations: list[CircuitOptimizationOperation],
) -> list[CircuitOptimizationOperation]:
    """Operations up to (not including) the first terminal measurement.

    Mirrors `majorana_frameworks.optimizers._split_terminal_measurements`.
    Duplicated rather than imported: this package does not depend on
    `majorana_frameworks`, and the rule is three lines the closed
    `CircuitOptimizationRequest`/`SynthesisRequest` validators already
    enforce (a non-terminal measurement never reaches here validated).
    """

    first_measurement = next(
        (
            index
            for index, operation in enumerate(operations)
            if operation.gate is CircuitOptimizationGate.MEASURE
        ),
        len(operations),
    )
    return operations[:first_measurement]


def _studio_circuit(qubit_count: int, operations: list[CircuitOptimizationOperation]) -> QuantumCircuit:
    """Build the unitary Qiskit circuit for Studio's closed operation list.

    Measurements are dropped (via `_unitary_prefix`) rather than represented:
    the claim this module proves is unitary equivalence of the compiled
    prefix, exactly the scope `CircuitOptimizationResult.equivalence`
    documents, and a measured circuit has no unitary to compare.
    """

    circuit = QuantumCircuit(qubit_count)
    for operation in _unitary_prefix(operations):
        qubits = operation.qubits
        if operation.gate in _ONE_QUBIT:
            _ONE_QUBIT[operation.gate](circuit, qubits[0])
        elif operation.gate in _ONE_QUBIT_ROTATION:
            assert operation.angle_radians is not None
            _ONE_QUBIT_ROTATION[operation.gate](circuit, operation.angle_radians, qubits[0])
        elif operation.gate in _TWO_QUBIT:
            _TWO_QUBIT[operation.gate](circuit, qubits[0], qubits[1])
        else:  # pragma: no cover - CircuitOptimizationGate is closed and this is exhaustive
            raise ValueError(f"unrepresentable Studio gate {operation.gate.value}")
    return circuit


def _not_checked(width_limit: int, qubit_count: int) -> SynthesisEquivalence:
    return SynthesisEquivalence(
        checked=False,
        method=_METHOD,
        width_limit=width_limit,
        detail=(
            f"not checked (too wide): {qubit_count} qubits exceeds the "
            f"{width_limit}-qubit exact-equivalence limit"
        ),
    )


def equivalent_operations(
    qubit_count: int,
    reference: list[CircuitOptimizationOperation],
    candidate: list[CircuitOptimizationOperation],
    *,
    max_qubits: int = SYNTHESIS_EQUIVALENCE_MAX_QUBITS,
) -> SynthesisEquivalence:
    """Independently check a targeted-synthesis candidate against the original.

    `reference` and `candidate` are both Studio's closed operation lists —
    the ORIGINAL circuit and one compiler's output — on the SAME
    `qubit_count` (Studio's IR never changes qubit count across compilation
    or routing; a compiler output that widened the register is already
    refused upstream in `majorana_frameworks.optimizers.result_from_kernel`).
    Terminal measurements, if present in either list, are stripped before
    comparison — see `_studio_circuit`.

    Never raises for an oversized circuit: above `max_qubits` this returns
    `checked=False` with a `detail` naming the limit, exactly the "not
    checked (too wide)" case a caller must not read as equivalent.
    """

    if qubit_count > max_qubits:
        return _not_checked(max_qubits, qubit_count)
    reference_qasm = qasm3.dumps(_studio_circuit(qubit_count, reference))
    candidate_qasm = qasm3.dumps(_studio_circuit(qubit_count, candidate))
    try:
        report = exact_equivalence(reference_qasm, candidate_qasm, max_qubits=max_qubits)
    except MethodCeilingExceeded:
        # Defensive only: `_studio_circuit` always builds exactly `qubit_count`
        # qubits for both sides, so the guard above already covers this path.
        return _not_checked(max_qubits, qubit_count)
    if report.scores.get("qubit_count_mismatch"):
        # Cannot happen through this function's own construction (both circuits
        # are built with the identical `qubit_count`) — kept as a fail-closed
        # branch rather than an assertion, per this package's own rule that a
        # check which cannot run states so and never reports a silent PASS.
        return SynthesisEquivalence(
            checked=True,
            equivalent=False,
            method=_METHOD,
            width_limit=max_qubits,
            detail="NOT equivalent: reference and candidate report different qubit counts",
        )
    distance = report.scores.get("max_abs_distance")
    if report.passed:
        detail = f"equivalent up to global phase (max amplitude difference {distance:.2e})"
    else:
        detail = f"NOT equivalent: max amplitude difference {distance:.2e} exceeds tolerance"
    return SynthesisEquivalence(
        checked=True,
        equivalent=report.passed,
        method=_METHOD,
        width_limit=max_qubits,
        detail=detail,
    )
