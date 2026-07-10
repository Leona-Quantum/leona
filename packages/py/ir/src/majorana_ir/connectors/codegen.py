"""Framework code generation from IR (Qiskit / PennyLane Python source). Pure
string generation — no SDK import needed to *produce* the code. Ported from quepo
`qhte.repository.exports`. The Qiskit-object import path lives in qiskit_bridge."""

from __future__ import annotations

from majorana_ir.models import Circuit


def _value(value: float | str) -> str:
    return repr(value) if isinstance(value, float | int) else value


def _symbols(circuit: Circuit) -> list[str]:
    return sorted(
        {value for op in circuit.operations for value in op.params if isinstance(value, str)}
    )


def qiskit_code(circuit: Circuit) -> str:
    lines = ["from qiskit import QuantumCircuit", "from qiskit.circuit import Parameter", ""]
    for symbol in _symbols(circuit):
        lines.append(f"{symbol} = Parameter({symbol!r})")
    if _symbols(circuit):
        lines.append("")
    lines.append(f"circuit = QuantumCircuit({circuit.qubits}, {circuit.classical_bits})")
    methods = {"u": "u", "cp": "cp", "ccx": "ccx", "cswap": "cswap"}
    for op in circuit.operations:
        if op.gate == "measure":
            lines.append(f"circuit.measure({op.qubits[0]}, {op.clbits[0]})")
        elif op.gate == "barrier":
            lines.append(f"circuit.barrier({', '.join(map(str, op.qubits))})")
        elif op.gate == "reset":
            lines.append(f"circuit.reset({op.qubits[0]})")
        else:
            arguments = [*map(_value, op.params), *map(str, op.qubits)]
            lines.append(f"circuit.{methods.get(op.gate, op.gate)}({', '.join(arguments)})")
    return "\n".join(lines) + "\n"


def pennylane_code(circuit: Circuit) -> str:
    if any(op.gate == "reset" for op in circuit.operations):
        raise ValueError("PennyLane export does not yet support reset operations")
    symbols = _symbols(circuit)
    lines = [
        "import pennylane as qml",
        "",
        f'device = qml.device("default.qubit", wires={circuit.qubits})',
        "",
    ]
    signature = ", ".join(symbols)
    lines.extend(["@qml.qnode(device)", f"def circuit({signature}):"])
    names = {
        "x": "PauliX",
        "y": "PauliY",
        "z": "PauliZ",
        "h": "Hadamard",
        "s": "S",
        "t": "T",
        "rx": "RX",
        "ry": "RY",
        "rz": "RZ",
        "u": "U3",
        "cx": "CNOT",
        "cz": "CZ",
        "swap": "SWAP",
        "cp": "ControlledPhaseShift",
        "ccx": "Toffoli",
        "cswap": "CSWAP",
    }
    for op in circuit.operations:
        if op.gate == "measure":
            continue
        if op.gate == "barrier":
            lines.append("    # Barrier omitted; PennyLane schedules operations in source order.")
            continue
        name = names.get(op.gate)
        if name is None:
            raise ValueError(f"PennyLane export does not support gate '{op.gate}'")
        args = [*map(_value, op.params)]
        wires = str(op.qubits[0]) if len(op.qubits) == 1 else repr(op.qubits)
        args.append(f"wires={wires}")
        lines.append(f"    qml.{name}({', '.join(args)})")
    measured = [op.qubits[0] for op in circuit.operations if op.gate == "measure"]
    if measured:
        lines.append(f"    return qml.sample(wires={measured!r})")
    else:
        lines.append("    return qml.state()")
    return "\n".join(lines) + "\n"
