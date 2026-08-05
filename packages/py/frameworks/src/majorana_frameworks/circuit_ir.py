"""Bounded, display-oriented circuit interchange for Majorana Studio.

The selected-framework source remains authoritative.  This module observes the
framework object produced by that source and emits a small JSON-safe circuit
description for Studio.  It is deliberately not an execution format: opaque
framework instructions keep their name and wires for an honest read-only
diagram, while only the narrow builder gate set is marked editable.

OpenQASM remains the standards-based export format.  Circuit IR exists because
valid framework instructions such as Qiskit's ``DiagonalGate`` are useful to
draw even when an OpenQASM exporter cannot serialize them without expansion.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping

CIRCUIT_IR_SCHEMA = "majorana.circuit-ir"
CIRCUIT_IR_VERSION = 1
MAX_CIRCUIT_IR_QUBITS = 4096
MAX_CIRCUIT_IR_OPERATIONS = 4096
MAX_CIRCUIT_IR_WIRE_REFERENCES = 16_384
MAX_CIRCUIT_IR_PARAMETERS = 8
MAX_CIRCUIT_IR_TEXT = 160
MAX_CIRCUIT_IR_BYTES = 262_144

_SAFE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,79}$")
_EDITABLE_NO_PARAMETER = {
    "h": 1,
    "x": 1,
    "y": 1,
    "z": 1,
    "s": 1,
    "t": 1,
    "cx": 2,
    "cz": 2,
    "swap": 2,
}
_EDITABLE_ROTATIONS = {"rx", "ry", "rz"}


@dataclass(frozen=True)
class CircuitIRExtraction:
    """A validated display sidecar recovered from sandbox observation."""

    circuit_ir: dict[str, Any] | None
    source: Literal["sandbox_epilogue", "missing"]
    epilogue_error: str | None = None


def _safe_text(value: Any, *, fallback: str) -> str:
    try:
        text = str(value)
    except Exception:
        text = fallback
    text = " ".join(text.split())
    return (text or fallback)[:MAX_CIRCUIT_IR_TEXT]


def _safe_name(value: Any) -> str:
    text = _safe_text(value, fallback="operation").lower()
    normalized = re.sub(r"[^a-z0-9_.:-]+", "_", text).strip("_.:-")
    if not normalized or not normalized[0].isalpha():
        normalized = f"op_{normalized}" if normalized else "operation"
    return normalized[:80]


def _numeric_parameter(value: Any) -> tuple[str, bool] | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value), True
    if isinstance(value, float):
        return (repr(value), True) if math.isfinite(value) else None
    try:
        converted = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return (repr(converted), True) if math.isfinite(converted) else None


def _parameter_label(value: Any) -> tuple[str, bool]:
    numeric = _numeric_parameter(value)
    if numeric is not None:
        return numeric
    shape = getattr(value, "shape", None)
    if shape is not None:
        try:
            dimensions = [int(item) for item in shape]
            count = math.prod(dimensions) if dimensions else 1
            return f"{count} values", False
        except (TypeError, ValueError, OverflowError):
            pass
    if isinstance(value, (list, tuple)):
        return f"{len(value)} values", False
    return _safe_text(value, fallback=type(value).__name__), False


def _editable_operation(
    name: str,
    qubits: list[int],
    clbits: list[int],
    parameters_exact: list[bool],
) -> bool:
    if name == "measure":
        return len(qubits) == 1 and len(clbits) == 1 and qubits[0] == clbits[0]
    if name in _EDITABLE_ROTATIONS:
        return len(qubits) == 1 and not clbits and parameters_exact == [True]
    arity = _EDITABLE_NO_PARAMETER.get(name)
    return arity is not None and len(qubits) == arity and not clbits and not parameters_exact


class _IRBuilder:
    def __init__(self, *, framework: str, qubit_count: int, clbit_count: int) -> None:
        if qubit_count < 0 or qubit_count > MAX_CIRCUIT_IR_QUBITS:
            raise ValueError("circuit qubit count is outside the display boundary")
        if clbit_count < 0 or clbit_count > MAX_CIRCUIT_IR_QUBITS:
            raise ValueError("circuit classical-bit count is outside the display boundary")
        self.framework = framework
        self.qubit_count = qubit_count
        self.clbit_count = clbit_count
        self.operations: list[dict[str, Any]] = []
        self.wire_references = 0
        self.truncated = False

    def append(
        self,
        *,
        name: Any,
        display_name: Any,
        qubits: list[int],
        clbits: list[int] | None = None,
        parameters: list[Any] | None = None,
        editable: bool | None = None,
    ) -> bool:
        clbits = clbits or []
        parameters = parameters or []
        next_references = self.wire_references + len(qubits) + len(clbits)
        if (
            len(self.operations) >= MAX_CIRCUIT_IR_OPERATIONS
            or next_references > MAX_CIRCUIT_IR_WIRE_REFERENCES
        ):
            self.truncated = True
            return False
        # Library instructions such as DiagonalGate expose one complex value per
        # basis state. Those values are useful to execution, not to a 34px gate
        # label, and copying hundreds of them into every artifact would spend the
        # protected-result budget on a read-only preview. Keep only the cardinality.
        labels_and_exact = (
            [(f"{len(parameters)} values", False)]
            if len(parameters) > MAX_CIRCUIT_IR_PARAMETERS
            else [_parameter_label(value) for value in parameters]
        )
        normalized_name = _safe_name(name)
        parameter_labels = [label for label, _exact in labels_and_exact]
        parameter_exact = [exact for _label, exact in labels_and_exact]
        structurally_editable = _editable_operation(
            normalized_name, qubits, clbits, parameter_exact
        )
        self.operations.append(
            {
                "id": f"op-{len(self.operations)}",
                "name": normalized_name,
                "display_name": _safe_text(display_name, fallback=normalized_name),
                "qubits": qubits,
                "clbits": clbits,
                "parameters": parameter_labels,
                "editable": structurally_editable
                if editable is None
                else structurally_editable and editable,
            }
        )
        self.wire_references = next_references
        return True

    def finish(self, *, operation_count: int, global_phase: Any = None) -> dict[str, Any]:
        phase = None
        if global_phase is not None:
            numeric = _numeric_parameter(global_phase)
            if numeric is None or float(numeric[0]) != 0.0:
                phase = _parameter_label(global_phase)[0]

        def payload_for(display_count: int) -> dict[str, Any]:
            operations = self.operations[:display_count]
            return {
                "schema": CIRCUIT_IR_SCHEMA,
                "version": CIRCUIT_IR_VERSION,
                "framework": self.framework,
                "qubit_count": self.qubit_count,
                "clbit_count": self.clbit_count,
                "operation_count": operation_count,
                "operations": operations,
                "truncated": self.truncated or operation_count > len(operations),
                "global_phase": phase,
            }

        payload = payload_for(len(self.operations))
        if _json_bytes(payload) > MAX_CIRCUIT_IR_BYTES:
            # Circuit IR shares the protected-result envelope with execution and
            # verification evidence. Bound it independently so an optional
            # diagram cannot evict that more important evidence. A binary search
            # avoids repeatedly serializing every prefix of a large circuit.
            lower = 0
            upper = len(self.operations)
            while lower < upper:
                middle = (lower + upper + 1) // 2
                if _json_bytes(payload_for(middle)) <= MAX_CIRCUIT_IR_BYTES:
                    lower = middle
                else:
                    upper = middle - 1
            payload = payload_for(lower)
        validated = validate_circuit_ir(payload)
        if validated is None:  # pragma: no cover - producer/validator drift guard
            raise ValueError("generated circuit IR failed its own schema")
        return validated


def _qiskit_circuit_ir(circuit: Any) -> dict[str, Any]:
    from qiskit import QuantumCircuit
    from qiskit.circuit import Measure
    from qiskit.circuit.library import (
        CXGate,
        CZGate,
        HGate,
        RXGate,
        RYGate,
        RZGate,
        SGate,
        SwapGate,
        TGate,
        XGate,
        YGate,
        ZGate,
    )

    if not isinstance(circuit, QuantumCircuit):
        raise TypeError("FINAL_CIRCUIT is not a Qiskit QuantumCircuit")
    # Compiler directives such as the barrier inserted by ``measure_all`` do
    # not change the circuit's operation. Omitting them keeps an otherwise-flat
    # Bell circuit round-trippable instead of making every measured Qiskit
    # circuit read-only for a scheduling hint the builder cannot express.
    data = [
        instruction
        for instruction in circuit.data
        if not getattr(instruction.operation, "_directive", False)
    ]
    editable_types = (
        HGate,
        XGate,
        YGate,
        ZGate,
        SGate,
        TGate,
        RXGate,
        RYGate,
        RZGate,
        CXGate,
        CZGate,
        SwapGate,
        Measure,
    )
    measurements = [instruction for instruction in data if instruction.operation.name == "measure"]
    measurement_pairs = [
        (
            int(circuit.find_bit(instruction.qubits[0]).index),
            int(circuit.find_bit(instruction.clbits[0]).index),
        )
        for instruction in measurements
        if len(instruction.qubits) == 1 and len(instruction.clbits) == 1
    ]
    full_terminal_measurement = (
        len(measurements) == circuit.num_qubits
        and len(measurement_pairs) == circuit.num_qubits
        and circuit.num_clbits == circuit.num_qubits
        and data[-len(measurements) :] == measurements
        and sorted(measurement_pairs) == [(index, index) for index in range(circuit.num_qubits)]
    )
    builder = _IRBuilder(
        framework="qiskit",
        qubit_count=int(circuit.num_qubits),
        clbit_count=int(circuit.num_clbits),
    )
    for instruction in data:
        operation = instruction.operation
        qubits = [int(circuit.find_bit(bit).index) for bit in instruction.qubits]
        clbits = [int(circuit.find_bit(bit).index) for bit in instruction.clbits]
        label = getattr(operation, "label", None) or getattr(operation, "name", None)
        if not builder.append(
            name=getattr(operation, "name", type(operation).__name__),
            display_name=label or type(operation).__name__,
            qubits=qubits,
            clbits=clbits,
            parameters=list(getattr(operation, "params", [])),
            editable=(
                isinstance(operation, editable_types)
                and getattr(operation, "condition", None) is None
                and (operation.name != "measure" or full_terminal_measurement)
            ),
        ):
            break
    return builder.finish(operation_count=len(data), global_phase=circuit.global_phase)


def _cirq_gate_name(operation: Any) -> tuple[str, str]:
    import cirq

    if cirq.is_measurement(operation):
        gate = getattr(operation, "gate", None)
        return "measure", _safe_text(gate, fallback="Measure")
    gate = getattr(operation, "gate", None)
    text = _safe_text(gate if gate is not None else operation, fallback="Operation")
    aliases = {
        "h": "h",
        "x": "x",
        "y": "y",
        "z": "z",
        "s": "s",
        "t": "t",
        "cnot": "cx",
        "cx": "cx",
        "cz": "cz",
        "swap": "swap",
    }
    return aliases.get(text.lower(), _safe_name(type(gate).__name__ if gate else text)), text


def _cirq_circuit_ir(circuit: Any) -> dict[str, Any]:
    import cirq

    if not isinstance(circuit, cirq.AbstractCircuit):
        raise TypeError("FINAL_CIRCUIT is not a Cirq circuit")
    qubit_order = list(cirq.QubitOrder.DEFAULT.order_for(circuit.all_qubits()))
    positions = {qubit: index for index, qubit in enumerate(qubit_order)}
    operations = list(circuit.all_operations())
    measurement_width = sum(
        len(operation.qubits) for operation in operations if cirq.is_measurement(operation)
    )
    builder = _IRBuilder(
        framework="cirq",
        qubit_count=len(qubit_order),
        clbit_count=measurement_width,
    )
    next_clbit = 0
    for operation in operations:
        name, label = _cirq_gate_name(operation)
        qubits = [positions[qubit] for qubit in operation.qubits]
        clbits: list[int] = []
        if name == "measure":
            clbits = list(range(next_clbit, next_clbit + len(qubits)))
            next_clbit += len(qubits)
        gate = getattr(operation, "gate", None)
        parameters: list[Any] = []
        exponent = getattr(gate, "exponent", None)
        rotation = isinstance(gate, (cirq.Rx, cirq.Ry, cirq.Rz))
        if rotation:
            try:
                parameters = [float(exponent) * math.pi]
            except (TypeError, ValueError, OverflowError):
                parameters = [f"pi*({exponent})"]
        elif exponent is not None and name not in _EDITABLE_NO_PARAMETER:
            parameters = [exponent]
        exact_standard = rotation or any(
            gate == standard
            for standard in (
                cirq.H,
                cirq.X,
                cirq.Y,
                cirq.Z,
                cirq.S,
                cirq.T,
                cirq.CNOT,
                cirq.CZ,
                cirq.SWAP,
            )
        )
        if not builder.append(
            name=name,
            display_name=label,
            qubits=qubits,
            clbits=clbits,
            parameters=parameters,
            # Measurement keys, invert masks, and terminal-result shape are not
            # expressible in the current builder. Preserve them as read-only.
            editable=exact_standard and name != "measure",
        ):
            break
    return builder.finish(operation_count=len(operations))


def _pennylane_tape(circuit: Any) -> Any:
    tape = getattr(circuit, "tape", None) or getattr(circuit, "_tape", None)
    if tape is not None:
        return tape
    if hasattr(circuit, "operations") and hasattr(circuit, "measurements"):
        return circuit
    from pennylane.workflow import construct_tape

    return construct_tape(circuit)()


def _pennylane_circuit_ir(circuit: Any) -> dict[str, Any]:
    import pennylane as qml

    tape = _pennylane_tape(circuit)
    wire_order = list(getattr(tape, "wires", []))
    try:
        wire_order = sorted(wire_order)
    except TypeError:
        pass
    positions = {wire: index for index, wire in enumerate(wire_order)}
    operations = list(getattr(tape, "operations", []))
    measurements = list(getattr(tape, "measurements", []))
    aliases = {
        "Hadamard": "h",
        "PauliX": "x",
        "PauliY": "y",
        "PauliZ": "z",
        "S": "s",
        "T": "t",
        "RX": "rx",
        "RY": "ry",
        "RZ": "rz",
        "CNOT": "cx",
        "CZ": "cz",
        "SWAP": "swap",
    }
    builder = _IRBuilder(
        framework="pennylane",
        qubit_count=len(wire_order),
        # PennyLane measurement processes return values rather than writing an
        # explicit classical register. Their semantics are retained as opaque
        # terminal operations below instead of inventing clbits.
        clbit_count=0,
    )
    editable_types = (
        qml.Hadamard,
        qml.PauliX,
        qml.PauliY,
        qml.PauliZ,
        qml.S,
        qml.T,
        qml.RX,
        qml.RY,
        qml.RZ,
        qml.CNOT,
        qml.CZ,
        qml.SWAP,
    )
    for operation in operations:
        display_name = getattr(operation, "name", type(operation).__name__)
        if not builder.append(
            name=aliases.get(str(display_name), _safe_name(display_name)),
            display_name=display_name,
            qubits=[positions[wire] for wire in list(getattr(operation, "wires", []))],
            parameters=list(getattr(operation, "parameters", [])),
            editable=isinstance(operation, editable_types),
        ):
            break
    for measurement in measurements:
        kind = type(measurement).__name__
        observable = getattr(measurement, "obs", None)
        wires = list(getattr(measurement, "wires", []))
        if not wires and observable is not None:
            wires = list(getattr(observable, "wires", []))
        wires = wires or wire_order
        display_name = kind.removesuffix("MP") or "Measurement"
        if not builder.append(
            name=display_name,
            display_name=display_name,
            qubits=[positions[wire] for wire in wires],
            parameters=[observable] if observable is not None else [],
            editable=False,
        ):
            break
    return builder.finish(operation_count=len(operations) + len(measurements))


def _braket_circuit_ir(circuit: Any) -> dict[str, Any]:
    """Observe a Braket Circuit as bounded read-only Studio data.

    Braket source remains canonical. The current Studio builder cannot emit
    Braket Python, so even gates it knows how to draw are deliberately marked
    read-only rather than pretending an edit can be applied back to source.
    """
    from braket.circuits import Circuit, CompilerDirective, Measure

    if not isinstance(circuit, Circuit):
        raise TypeError("FINAL_CIRCUIT is not an Amazon Braket Circuit")
    qubit_order = sorted(list(circuit.qubits))
    positions = {qubit: index for index, qubit in enumerate(qubit_order)}
    instructions = [
        instruction
        for instruction in circuit.instructions
        if not isinstance(instruction.operator, CompilerDirective)
    ]
    measurement_count = sum(
        len(instruction.target)
        for instruction in instructions
        if isinstance(instruction.operator, Measure)
    )
    aliases = {
        "i": "i",
        "h": "h",
        "x": "x",
        "y": "y",
        "z": "z",
        "s": "s",
        "t": "t",
        "rx": "rx",
        "ry": "ry",
        "rz": "rz",
        "cnot": "cx",
        "cz": "cz",
        "swap": "swap",
        "measure": "measure",
    }
    builder = _IRBuilder(
        framework="braket",
        qubit_count=len(qubit_order),
        clbit_count=measurement_count,
    )
    next_clbit = 0
    for instruction in instructions:
        operator = instruction.operator
        display_name = getattr(operator, "name", type(operator).__name__)
        raw_name = str(display_name)
        name = aliases.get(raw_name.casefold(), _safe_name(raw_name))
        ordered_qubits = [*list(instruction.control), *list(instruction.target)]
        # A standard Braket controlled gate (for example CNot) stores both wires
        # in target; explicit control modifiers store controls separately.
        qubits = list(dict.fromkeys(positions[qubit] for qubit in ordered_qubits))
        clbits: list[int] = []
        if isinstance(operator, Measure):
            clbits = list(range(next_clbit, next_clbit + len(instruction.target)))
            next_clbit += len(instruction.target)
        if not builder.append(
            name=name,
            display_name=display_name,
            qubits=qubits,
            clbits=clbits,
            parameters=list(getattr(operator, "parameters", [])),
            editable=False,
        ):
            break
    return builder.finish(operation_count=len(instructions))


def build_circuit_ir(framework: str, circuit: Any) -> dict[str, Any]:
    """Observe a supported framework object without rewriting or executing it."""
    if framework == "qiskit":
        return _qiskit_circuit_ir(circuit)
    if framework == "cirq":
        return _cirq_circuit_ir(circuit)
    if framework == "pennylane":
        return _pennylane_circuit_ir(circuit)
    if framework == "braket":
        return _braket_circuit_ir(circuit)
    raise ValueError(f"unsupported circuit IR framework: {framework}")


def _bounded_int(value: Any, *, minimum: int, maximum: int) -> int | None:
    if type(value) is not int or value < minimum or value > maximum:
        return None
    return value


def _validated_text(value: Any, *, pattern: re.Pattern[str] | None = None) -> str | None:
    if not isinstance(value, str) or not value or len(value) > MAX_CIRCUIT_IR_TEXT:
        return None
    if any(ord(character) < 32 for character in value):
        return None
    if pattern is not None and not pattern.fullmatch(value):
        return None
    return value


def _json_bytes(value: Any) -> int:
    return len(json.dumps(value, allow_nan=False).encode("utf-8"))


def validate_circuit_ir(value: Any) -> dict[str, Any] | None:
    """Validate untrusted JSON and return only the canonical schema fields."""
    if not isinstance(value, Mapping):
        return None
    if value.get("schema") != CIRCUIT_IR_SCHEMA or value.get("version") != CIRCUIT_IR_VERSION:
        return None
    framework = value.get("framework")
    if framework not in {"qiskit", "cirq", "pennylane", "braket"}:
        return None
    qubit_count = _bounded_int(value.get("qubit_count"), minimum=0, maximum=MAX_CIRCUIT_IR_QUBITS)
    clbit_count = _bounded_int(value.get("clbit_count"), minimum=0, maximum=MAX_CIRCUIT_IR_QUBITS)
    operation_count = _bounded_int(value.get("operation_count"), minimum=0, maximum=10_000_000)
    truncated = value.get("truncated")
    operations = value.get("operations")
    global_phase = value.get("global_phase")
    if (
        qubit_count is None
        or clbit_count is None
        or operation_count is None
        or type(truncated) is not bool
        or not isinstance(operations, list)
        or len(operations) > MAX_CIRCUIT_IR_OPERATIONS
        or (global_phase is not None and _validated_text(global_phase) is None)
    ):
        return None
    canonical_operations: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    wire_references = 0
    for raw in operations:
        if not isinstance(raw, Mapping):
            return None
        operation_id = _validated_text(raw.get("id"), pattern=_SAFE_NAME)
        name = _validated_text(raw.get("name"), pattern=_SAFE_NAME)
        display_name = _validated_text(raw.get("display_name"))
        qubits = raw.get("qubits")
        clbits = raw.get("clbits")
        parameters = raw.get("parameters")
        editable = raw.get("editable")
        if (
            operation_id is None
            or operation_id in seen_ids
            or name is None
            or display_name is None
            or not isinstance(qubits, list)
            or not isinstance(clbits, list)
            or not isinstance(parameters, list)
            or len(parameters) > MAX_CIRCUIT_IR_PARAMETERS
            or type(editable) is not bool
        ):
            return None
        if (
            any(_bounded_int(item, minimum=0, maximum=qubit_count - 1) is None for item in qubits)
            or any(
                _bounded_int(item, minimum=0, maximum=clbit_count - 1) is None for item in clbits
            )
            or len(set(qubits)) != len(qubits)
            or len(set(clbits)) != len(clbits)
        ):
            return None
        parameter_labels = [_validated_text(item) for item in parameters]
        if any(item is None for item in parameter_labels):
            return None
        wire_references += len(qubits) + len(clbits)
        if wire_references > MAX_CIRCUIT_IR_WIRE_REFERENCES:
            return None
        seen_ids.add(operation_id)
        canonical_operations.append(
            {
                "id": operation_id,
                "name": name,
                "display_name": display_name,
                "qubits": list(qubits),
                "clbits": list(clbits),
                "parameters": parameter_labels,
                "editable": editable,
            }
        )
    if operation_count < len(canonical_operations):
        return None
    if not truncated and operation_count != len(canonical_operations):
        return None
    canonical = {
        "schema": CIRCUIT_IR_SCHEMA,
        "version": CIRCUIT_IR_VERSION,
        "framework": framework,
        "qubit_count": qubit_count,
        "clbit_count": clbit_count,
        "operation_count": operation_count,
        "operations": canonical_operations,
        "truncated": truncated,
        "global_phase": global_phase,
    }
    return canonical if _json_bytes(canonical) <= MAX_CIRCUIT_IR_BYTES else None


def extract_circuit_ir(protected_result: Mapping[str, Any] | None) -> CircuitIRExtraction:
    """Recover circuit IR only from the provider-owned structured result."""
    if protected_result is None:
        return CircuitIRExtraction(None, "missing")
    error = protected_result.get("circuit_ir_error")
    epilogue_error = error if isinstance(error, str) else None
    circuit_ir = validate_circuit_ir(protected_result.get("circuit_ir"))
    if circuit_ir is not None:
        return CircuitIRExtraction(circuit_ir, "sandbox_epilogue", epilogue_error)
    return CircuitIRExtraction(None, "missing", epilogue_error)
