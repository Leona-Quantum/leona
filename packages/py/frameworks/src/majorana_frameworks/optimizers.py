"""Bounded adapters for Studio's trusted third-party compiler lane.

The input is the closed, declarative circuit model from ``majorana-contracts``;
no user source code is evaluated here. Compiler output must be lowered back to
the same Studio gate set or the adapter fails explicitly. These are compilation
results, not verification evidence: the SDKs preserve unitary meaning according
to their own contracts, generally up to global phase.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
from collections.abc import Callable, Iterable
from typing import Any

from majorana_contracts import (
    CircuitCompiler,
    CircuitOptimizationGate,
    CircuitOptimizationOperation,
    CircuitOptimizationRequest,
    CircuitOptimizationResult,
    ResourceMetrics,
)

_TWO_QUBIT_GATES = {
    CircuitOptimizationGate.CX,
    CircuitOptimizationGate.CZ,
    CircuitOptimizationGate.SWAP,
}
_ROTATION_GATES = {
    CircuitOptimizationGate.RX,
    CircuitOptimizationGate.RY,
    CircuitOptimizationGate.RZ,
}
_QISKIT_BASIS = ["h", "x", "y", "z", "s", "t", "rx", "ry", "rz", "cx", "cz", "swap"]
_MAX_RESULT_OPERATIONS = 4096


class CircuitOptimizationError(ValueError):
    """Expected refusal from a compiler adapter, safe to show to the caller."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def optimize_circuit(request: CircuitOptimizationRequest) -> CircuitOptimizationResult:
    """Run one selected compiler and return a Studio-round-trippable result."""

    unitary, measurements = _split_terminal_measurements(request.operations)
    compiler = _COMPILERS[request.compiler]
    try:
        optimized, version = compiler(request.qubit_count, unitary, request.optimization_level)
    except CircuitOptimizationError:
        raise
    except Exception as exc:
        raise CircuitOptimizationError(
            "compiler_failed",
            f"{request.compiler.value} could not compile this circuit ({type(exc).__name__}).",
        ) from exc

    operations = [*optimized, *measurements]
    if len(operations) > _MAX_RESULT_OPERATIONS:
        raise CircuitOptimizationError(
            "compiler_output_too_large",
            f"Compiler output exceeds {_MAX_RESULT_OPERATIONS} Studio operations.",
        )
    warnings = [
        "Compiler equivalence is unitary up to global phase; this result was not independently verified."
    ]
    if measurements:
        warnings.append("Terminal measurements were preserved outside the unitary compiler pass.")
    before = _metrics(request.qubit_count, request.operations)
    after = _metrics(request.qubit_count, operations)
    if not _strictly_improves(before, after):
        warnings.append(
            "The selected compiler did not reduce gate count, logical depth, or two-qubit gates."
        )
    return CircuitOptimizationResult(
        compiler=request.compiler,
        compiler_version=version,
        optimization_level=request.optimization_level,
        operations=operations,
        before=before,
        after=after,
        input_fingerprint=_fingerprint(request.operations),
        output_fingerprint=_fingerprint(operations),
        warnings=warnings,
    )


def _qiskit_compile(
    qubit_count: int,
    operations: list[CircuitOptimizationOperation],
    level: int,
) -> tuple[list[CircuitOptimizationOperation], str]:
    from qiskit import QuantumCircuit
    from qiskit.transpiler import generate_preset_pass_manager

    circuit = QuantumCircuit(qubit_count)
    _apply_operations(circuit, operations, _QISKIT_APPLIERS)
    manager = generate_preset_pass_manager(
        optimization_level=level,
        basis_gates=_QISKIT_BASIS,
        seed_transpiler=42,
    )
    optimized = manager.run(circuit)
    return _operations_from_qiskit(optimized, restore_output_permutation=True), _version("qiskit")


def _pennylane_compile(
    qubit_count: int,
    operations: list[CircuitOptimizationOperation],
    level: int,
) -> tuple[list[CircuitOptimizationOperation], str]:
    del qubit_count  # Wire labels are carried by each operation.
    import pennylane as qml

    qml_operations = [_pennylane_operation(operation, qml) for operation in operations]
    tape = qml.tape.QuantumScript(qml_operations)
    batches, _postprocess = qml.compile(
        tape,
        basis_set=[
            "Hadamard",
            "PauliX",
            "PauliY",
            "PauliZ",
            "S",
            "T",
            "RX",
            "RY",
            "RZ",
            "CNOT",
            "CZ",
            "SWAP",
        ],
        num_passes=level,
    )
    if len(batches) != 1:
        raise CircuitOptimizationError(
            "compiler_output_unsupported", "PennyLane returned more than one circuit."
        )
    return _operations_from_pennylane(batches[0].operations), _version("pennylane")


def _pytket_compile(
    qubit_count: int,
    operations: list[CircuitOptimizationOperation],
    level: int,
) -> tuple[list[CircuitOptimizationOperation], str]:
    from pytket import Circuit, OpType
    from pytket.passes import AutoRebase, FullPeepholeOptimise, RemoveRedundancies

    circuit = Circuit(qubit_count)
    _apply_operations(circuit, operations, _PYTKET_APPLIERS)
    RemoveRedundancies().apply(circuit)
    if level >= 2:
        # Never allow an implicit output-wire permutation: Studio has no place
        # to represent one, so accepting it would silently change qubit meaning.
        FullPeepholeOptimise(allow_swaps=False).apply(circuit)
    if level >= 3:
        FullPeepholeOptimise(allow_swaps=False).apply(circuit)
    AutoRebase(
        {
            OpType.H,
            OpType.X,
            OpType.Y,
            OpType.Z,
            OpType.S,
            OpType.T,
            OpType.Rx,
            OpType.Ry,
            OpType.Rz,
            OpType.CX,
            OpType.CZ,
            OpType.SWAP,
        }
    ).apply(circuit)
    return _operations_from_pytket(circuit), _version("pytket")


def _pyzx_compile(
    qubit_count: int,
    operations: list[CircuitOptimizationOperation],
    level: int,
) -> tuple[list[CircuitOptimizationOperation], str]:
    del level  # PyZX exposes one full Clifford+T pipeline at this boundary.
    import pyzx
    from qiskit import qasm2
    from qiskit.transpiler import generate_preset_pass_manager

    if qubit_count > 16 or len(operations) > 512:
        raise CircuitOptimizationError(
            "pyzx_budget_exceeded", "PyZX is limited to 16 qubits and 512 unitary operations."
        )
    for operation in operations:
        if operation.gate in _ROTATION_GATES:
            assert operation.angle_radians is not None
            quarter_turns = operation.angle_radians / (math.pi / 4)
            if not math.isclose(quarter_turns, round(quarter_turns), abs_tol=1e-10):
                raise CircuitOptimizationError(
                    "pyzx_requires_clifford_t",
                    "PyZX accepts only Clifford+T rotations (integer multiples of pi/4).",
                )

    source = _openqasm2(qubit_count, operations)
    source_circuit = pyzx.Circuit.from_qasm(source)
    optimized = pyzx.optimize.full_optimize(source_circuit, quiet=True)
    # PyZX deliberately exposes an exact ZX-diagram equality check. Refuse the
    # result when its own optimizer cannot prove the rewrite it just produced;
    # in particular this catches phase movement across some SWAP patterns. A
    # rejected optimization is safer than returning a smaller, wrong circuit.
    if not source_circuit.verify_equality(optimized):
        raise CircuitOptimizationError(
            "compiler_equivalence_check_failed",
            "PyZX could not confirm that its optimized circuit preserves the input.",
        )
    # PyZX emits standard OpenQASM 2. Qiskit's level-0 pass is only a strict
    # rebase into Studio's closed gate set; the optimization itself happened in
    # PyZX and no second optimization pass is applied here.
    imported = qasm2.loads(optimized.to_qasm())
    normalized = generate_preset_pass_manager(
        optimization_level=0,
        basis_gates=_QISKIT_BASIS,
        seed_transpiler=42,
    ).run(imported)
    return _operations_from_qiskit(normalized), _version("pyzx")


def _apply_operations(
    circuit: Any, operations: Iterable[CircuitOptimizationOperation], appliers: dict
):
    for operation in operations:
        appliers[operation.gate](circuit, operation)


def _one(method: str) -> Callable[[Any, CircuitOptimizationOperation], None]:
    return lambda circuit, operation: getattr(circuit, method)(operation.qubits[0])


def _rotation(method: str, *, half_turns: bool = False):
    def apply(circuit: Any, operation: CircuitOptimizationOperation) -> None:
        assert operation.angle_radians is not None
        angle = operation.angle_radians / math.pi if half_turns else operation.angle_radians
        getattr(circuit, method)(angle, operation.qubits[0])

    return apply


def _two(method: str):
    return lambda circuit, operation: getattr(circuit, method)(*operation.qubits)


_QISKIT_APPLIERS = {
    CircuitOptimizationGate.H: _one("h"),
    CircuitOptimizationGate.X: _one("x"),
    CircuitOptimizationGate.Y: _one("y"),
    CircuitOptimizationGate.Z: _one("z"),
    CircuitOptimizationGate.S: _one("s"),
    CircuitOptimizationGate.T: _one("t"),
    CircuitOptimizationGate.RX: _rotation("rx"),
    CircuitOptimizationGate.RY: _rotation("ry"),
    CircuitOptimizationGate.RZ: _rotation("rz"),
    CircuitOptimizationGate.CX: _two("cx"),
    CircuitOptimizationGate.CZ: _two("cz"),
    CircuitOptimizationGate.SWAP: _two("swap"),
}

_PYTKET_APPLIERS = {
    CircuitOptimizationGate.H: _one("H"),
    CircuitOptimizationGate.X: _one("X"),
    CircuitOptimizationGate.Y: _one("Y"),
    CircuitOptimizationGate.Z: _one("Z"),
    CircuitOptimizationGate.S: _one("S"),
    CircuitOptimizationGate.T: _one("T"),
    CircuitOptimizationGate.RX: _rotation("Rx", half_turns=True),
    CircuitOptimizationGate.RY: _rotation("Ry", half_turns=True),
    CircuitOptimizationGate.RZ: _rotation("Rz", half_turns=True),
    CircuitOptimizationGate.CX: _two("CX"),
    CircuitOptimizationGate.CZ: _two("CZ"),
    CircuitOptimizationGate.SWAP: _two("SWAP"),
}


def _pennylane_operation(operation: CircuitOptimizationOperation, qml: Any) -> Any:
    wires: int | list[int] = operation.qubits[0] if len(operation.qubits) == 1 else operation.qubits
    constructors = {
        CircuitOptimizationGate.H: qml.Hadamard,
        CircuitOptimizationGate.X: qml.PauliX,
        CircuitOptimizationGate.Y: qml.PauliY,
        CircuitOptimizationGate.Z: qml.PauliZ,
        CircuitOptimizationGate.S: qml.S,
        CircuitOptimizationGate.T: qml.T,
        CircuitOptimizationGate.CX: qml.CNOT,
        CircuitOptimizationGate.CZ: qml.CZ,
        CircuitOptimizationGate.SWAP: qml.SWAP,
    }
    if operation.gate in _ROTATION_GATES:
        assert operation.angle_radians is not None
        return getattr(qml, operation.gate.value)(operation.angle_radians, wires=wires)
    return constructors[operation.gate](wires=wires)


_QISKIT_TO_GATE = {
    gate.value.lower(): gate for gate in CircuitOptimizationGate if gate.value != "M"
}


def _operations_from_qiskit(
    circuit: Any, *, restore_output_permutation: bool = False
) -> list[CircuitOptimizationOperation]:
    result: list[CircuitOptimizationOperation] = []
    for instruction in circuit.data:
        name = instruction.operation.name
        if name == "barrier" or name == "id":
            continue
        gate = _QISKIT_TO_GATE.get(name)
        if gate is None:
            raise CircuitOptimizationError(
                "compiler_output_unsupported", f"Compiler emitted unsupported Qiskit gate {name}."
            )
        qubits = [circuit.find_bit(qubit).index for qubit in instruction.qubits]
        angle = float(instruction.operation.params[0]) if gate in _ROTATION_GATES else None
        result.append(CircuitOptimizationOperation(gate=gate, qubits=qubits, angle_radians=angle))
    if restore_output_permutation:
        result.extend(_qiskit_output_permutation_correction(circuit))
    return result


def _qiskit_output_permutation_correction(circuit: Any) -> list[CircuitOptimizationOperation]:
    """Materialize Qiskit's virtual output permutation as Studio SWAPs.

    Preset pass managers at levels 2 and 3 may elide SWAP gates and represent
    their effect only in ``TranspileLayout.final_layout``. That is valid for a
    backend-aware caller that reads the layout, but Studio stores only logical
    gate operations. Appending this permutation restores logical qubit ``i`` to
    output wire ``i`` and prevents a silent change in circuit meaning.
    """

    layout = getattr(circuit, "layout", None)
    if layout is None:
        return []
    logical_to_output = list(layout.final_index_layout(filter_ancillas=True))
    if sorted(logical_to_output) != list(range(len(logical_to_output))):
        raise CircuitOptimizationError(
            "compiler_output_unsupported", "Qiskit returned a non-permutation output layout."
        )
    logical_at_output = [0] * len(logical_to_output)
    for logical, output in enumerate(logical_to_output):
        logical_at_output[output] = logical
    corrections: list[CircuitOptimizationOperation] = []
    for output in range(len(logical_at_output)):
        if logical_at_output[output] == output:
            continue
        partner = logical_at_output.index(output)
        corrections.append(
            CircuitOptimizationOperation(
                gate=CircuitOptimizationGate.SWAP,
                qubits=[output, partner],
            )
        )
        logical_at_output[output], logical_at_output[partner] = (
            logical_at_output[partner],
            logical_at_output[output],
        )
    return corrections


_PENNYLANE_TO_GATE = {
    "Hadamard": CircuitOptimizationGate.H,
    "PauliX": CircuitOptimizationGate.X,
    "PauliY": CircuitOptimizationGate.Y,
    "PauliZ": CircuitOptimizationGate.Z,
    "S": CircuitOptimizationGate.S,
    "T": CircuitOptimizationGate.T,
    "RX": CircuitOptimizationGate.RX,
    "RY": CircuitOptimizationGate.RY,
    "RZ": CircuitOptimizationGate.RZ,
    "CNOT": CircuitOptimizationGate.CX,
    "CZ": CircuitOptimizationGate.CZ,
    "SWAP": CircuitOptimizationGate.SWAP,
}


def _operations_from_pennylane(operations: Iterable[Any]) -> list[CircuitOptimizationOperation]:
    result: list[CircuitOptimizationOperation] = []
    for operation in operations:
        gate = _PENNYLANE_TO_GATE.get(operation.name)
        if gate is None:
            raise CircuitOptimizationError(
                "compiler_output_unsupported",
                f"Compiler emitted unsupported PennyLane gate {operation.name}.",
            )
        angle = float(operation.parameters[0]) if gate in _ROTATION_GATES else None
        result.append(
            CircuitOptimizationOperation(
                gate=gate,
                qubits=[int(wire) for wire in operation.wires],
                angle_radians=angle,
            )
        )
    return result


_PYTKET_TO_GATE = {
    "H": CircuitOptimizationGate.H,
    "X": CircuitOptimizationGate.X,
    "Y": CircuitOptimizationGate.Y,
    "Z": CircuitOptimizationGate.Z,
    "S": CircuitOptimizationGate.S,
    "T": CircuitOptimizationGate.T,
    "Rx": CircuitOptimizationGate.RX,
    "Ry": CircuitOptimizationGate.RY,
    "Rz": CircuitOptimizationGate.RZ,
    "CX": CircuitOptimizationGate.CX,
    "CZ": CircuitOptimizationGate.CZ,
    "SWAP": CircuitOptimizationGate.SWAP,
}


def _operations_from_pytket(circuit: Any) -> list[CircuitOptimizationOperation]:
    result: list[CircuitOptimizationOperation] = []
    for command in circuit.get_commands():
        name = command.op.type.name
        gate = _PYTKET_TO_GATE.get(name)
        if gate is None:
            raise CircuitOptimizationError(
                "compiler_output_unsupported", f"Compiler emitted unsupported pytket gate {name}."
            )
        angle = float(command.op.params[0]) * math.pi if gate in _ROTATION_GATES else None
        result.append(
            CircuitOptimizationOperation(
                gate=gate,
                qubits=[int(qubit.index[0]) for qubit in command.qubits],
                angle_radians=angle,
            )
        )
    return result


def _openqasm2(qubit_count: int, operations: Iterable[CircuitOptimizationOperation]) -> str:
    lines = ["OPENQASM 2.0;", 'include "qelib1.inc";', f"qreg q[{qubit_count}];"]
    for operation in operations:
        name = operation.gate.value.lower()
        operands = ",".join(f"q[{qubit}]" for qubit in operation.qubits)
        if operation.gate in _ROTATION_GATES:
            assert operation.angle_radians is not None
            lines.append(f"{name}({operation.angle_radians:.17g}) {operands};")
        else:
            lines.append(f"{name} {operands};")
    return "\n".join(lines) + "\n"


def _split_terminal_measurements(
    operations: list[CircuitOptimizationOperation],
) -> tuple[list[CircuitOptimizationOperation], list[CircuitOptimizationOperation]]:
    first = next(
        (
            index
            for index, operation in enumerate(operations)
            if operation.gate is CircuitOptimizationGate.MEASURE
        ),
        len(operations),
    )
    return list(operations[:first]), list(operations[first:])


def _metrics(qubit_count: int, operations: list[CircuitOptimizationOperation]) -> ResourceMetrics:
    reached: dict[int, int] = {}
    depth = 0
    gate_count = 0
    measurements = 0
    two_qubit = 0
    for operation in operations:
        layer = max((reached.get(qubit, 0) for qubit in operation.qubits), default=0) + 1
        for qubit in operation.qubits:
            reached[qubit] = layer
        depth = max(depth, layer)
        if operation.gate is CircuitOptimizationGate.MEASURE:
            measurements += 1
        else:
            gate_count += 1
            if operation.gate in _TWO_QUBIT_GATES:
                two_qubit += 1
    return ResourceMetrics(
        qubits=qubit_count,
        depth=depth,
        gate_count=gate_count,
        two_qubit_gate_count=two_qubit,
        measurement_count=measurements,
    )


def _strictly_improves(before: ResourceMetrics, after: ResourceMetrics) -> bool:
    return any(
        next_value is not None and previous is not None and next_value < previous
        for previous, next_value in (
            (before.gate_count, after.gate_count),
            (before.depth, after.depth),
            (before.two_qubit_gate_count, after.two_qubit_gate_count),
        )
    )


def _fingerprint(operations: list[CircuitOptimizationOperation]) -> str:
    payload = [operation.model_dump(mode="json") for operation in operations]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _version(distribution: str) -> str:
    return importlib.metadata.version(distribution)


_COMPILERS: dict[
    CircuitCompiler,
    Callable[
        [int, list[CircuitOptimizationOperation], int],
        tuple[list[CircuitOptimizationOperation], str],
    ],
] = {
    CircuitCompiler.QISKIT: _qiskit_compile,
    CircuitCompiler.PYTKET: _pytket_compile,
    CircuitCompiler.PENNYLANE: _pennylane_compile,
    CircuitCompiler.PYZX: _pyzx_compile,
}
