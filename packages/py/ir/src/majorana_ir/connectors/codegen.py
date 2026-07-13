"""Framework code generation from IR (Qiskit / PennyLane / Cirq Python source).
Pure string generation — no SDK import needed to *produce* the code. Ported from
quepo `qhte.repository.exports`. The Qiskit-object import path lives in
qiskit_bridge."""

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


def cirq_code(circuit: Circuit) -> str:
    """Render a static IR circuit as readable Cirq source.

    Cirq has no direct equivalent for the canonical ``u`` gate or non-Z
    measurement bases in this narrow connector, so those cases fail explicitly
    and the export classifier can retain a validated OpenQASM download instead
    of claiming a target-native conversion.
    """
    if any(
        op.gate == "u" or (op.gate == "measure" and op.measurement and op.measurement.basis != "Z")
        for op in circuit.operations
    ):
        raise ValueError("Cirq export does not yet support u gates or non-Z measurements")

    symbols = _symbols(circuit)
    lines = ["import cirq"]
    if symbols or any(op.gate == "cp" for op in circuit.operations):
        lines.append("import sympy")
    lines.append("")
    for symbol in symbols:
        lines.append(f"{symbol} = sympy.Symbol({symbol!r})")
    if symbols:
        lines.append("")
    lines.extend(
        [
            f"qubits = cirq.LineQubit.range({circuit.qubits})",
            "circuit = cirq.Circuit()",
        ]
    )

    def parameter(value: float | str) -> str:
        return _value(value)

    for op in circuit.operations:
        qubits = ", ".join(f"qubits[{qubit}]" for qubit in op.qubits)
        if op.gate == "barrier":
            lines.append(
                "# Barrier omitted; Cirq preserves source order without a barrier primitive."
            )
            continue
        if op.gate == "measure":
            lines.append(f"circuit.append(cirq.measure({qubits}, key={f'c{op.clbits[0]}'!r}))")
            continue
        if op.gate == "reset":
            expression = f"cirq.ResetChannel().on({qubits})"
        elif op.gate in {"x", "y", "z", "h", "s", "t"}:
            expression = f"cirq.{op.gate.upper()}({qubits})"
        elif op.gate in {"rx", "ry", "rz"}:
            expression = f"cirq.{op.gate}({parameter(op.params[0])})({qubits})"
        elif op.gate == "cx":
            expression = f"cirq.CNOT({qubits})"
        elif op.gate == "cz":
            expression = f"cirq.CZ({qubits})"
        elif op.gate == "swap":
            expression = f"cirq.SWAP({qubits})"
        elif op.gate == "cp":
            expression = (
                f"cirq.CZPowGate(exponent=({parameter(op.params[0])}) / sympy.pi).on({qubits})"
            )
        elif op.gate == "ccx":
            expression = f"cirq.TOFFOLI({qubits})"
        elif op.gate == "cswap":
            expression = f"cirq.FREDKIN({qubits})"
        else:
            raise ValueError(f"Cirq export does not support gate '{op.gate}'")
        lines.append(f"circuit.append({expression})")
    return "\n".join(lines) + "\n"
