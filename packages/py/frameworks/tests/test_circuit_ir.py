from __future__ import annotations

import json

import pytest

from majorana_frameworks.circuit_ir import (
    CIRCUIT_IR_SCHEMA,
    CIRCUIT_IR_VERSION,
    MAX_CIRCUIT_IR_BYTES,
    MAX_CIRCUIT_IR_OPERATIONS,
    build_circuit_ir,
    extract_circuit_ir,
    validate_circuit_ir,
)


def _valid_ir() -> dict:
    return {
        "schema": CIRCUIT_IR_SCHEMA,
        "version": CIRCUIT_IR_VERSION,
        "framework": "qiskit",
        "qubit_count": 2,
        "clbit_count": 2,
        "operation_count": 4,
        "operations": [
            {
                "id": "op-0",
                "name": "h",
                "display_name": "H",
                "qubits": [0],
                "clbits": [],
                "parameters": [],
                "editable": True,
            },
            {
                "id": "op-1",
                "name": "cx",
                "display_name": "CX",
                "qubits": [0, 1],
                "clbits": [],
                "parameters": [],
                "editable": True,
            },
            {
                "id": "op-2",
                "name": "measure",
                "display_name": "Measure",
                "qubits": [0],
                "clbits": [0],
                "parameters": [],
                "editable": True,
            },
            {
                "id": "op-3",
                "name": "measure",
                "display_name": "Measure",
                "qubits": [1],
                "clbits": [1],
                "parameters": [],
                "editable": True,
            },
        ],
        "truncated": False,
        "global_phase": None,
    }


def test_qiskit_ir_preserves_diagonal_as_one_read_only_operation():
    qiskit = pytest.importorskip("qiskit")
    np = pytest.importorskip("numpy")
    from qiskit.circuit.library import DiagonalGate

    circuit = qiskit.QuantumCircuit(8)
    circuit.h(range(8))
    circuit.append(DiagonalGate(np.exp(1j * np.linspace(0, 1, 2**8))), range(8))
    circuit.rx(0.25, range(8))
    circuit.measure_all()

    circuit_ir = build_circuit_ir("qiskit", circuit)

    assert circuit_ir["schema"] == CIRCUIT_IR_SCHEMA
    assert circuit_ir["qubit_count"] == 8
    assert circuit_ir["operation_count"] == len(
        [instruction for instruction in circuit.data if not instruction.operation._directive]
    )
    diagonals = [
        operation for operation in circuit_ir["operations"] if operation["name"] == "diagonal"
    ]
    assert diagonals == [
        {
            "id": "op-8",
            "name": "diagonal",
            "display_name": "diagonal",
            "qubits": list(range(8)),
            "clbits": [],
            "parameters": ["256 values"],
            "editable": False,
        }
    ]
    assert not circuit_ir["truncated"]


def test_qiskit_ir_marks_only_losslessly_rebuildable_operations_editable():
    qiskit = pytest.importorskip("qiskit")

    circuit = qiskit.QuantumCircuit(2, 2)
    circuit.h(0)
    circuit.cx(0, 1)
    circuit.rz(0.5, 1)
    circuit.measure(0, 1)  # Permuted classical destination cannot round-trip.

    operations = build_circuit_ir("qiskit", circuit)["operations"]

    assert [operation["editable"] for operation in operations] == [True, True, True, False]
    assert operations[-1]["clbits"] == [1]


def test_qiskit_ir_rejects_named_impostors_and_nonterminal_measurement_edits():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.circuit import Gate

    circuit = qiskit.QuantumCircuit(2, 2)
    circuit.append(Gate("x", 1, []), [0])
    circuit.measure(0, 0)
    circuit.x(1)
    circuit.measure(1, 1)

    operations = build_circuit_ir("qiskit", circuit)["operations"]

    assert [operation["name"] for operation in operations] == ["x", "measure", "x", "measure"]
    assert [operation["editable"] for operation in operations] == [False, False, True, False]


def test_qiskit_ir_accepts_only_a_complete_terminal_measurement_for_editing():
    qiskit = pytest.importorskip("qiskit")

    circuit = qiskit.QuantumCircuit(2, 2)
    circuit.h(0)
    circuit.cx(0, 1)
    circuit.measure(range(2), range(2))

    operations = build_circuit_ir("qiskit", circuit)["operations"]

    assert all(operation["editable"] for operation in operations)


def test_qiskit_ir_truncates_honestly_at_the_display_budget():
    qiskit = pytest.importorskip("qiskit")

    circuit = qiskit.QuantumCircuit(1)
    for _ in range(MAX_CIRCUIT_IR_OPERATIONS + 1):
        circuit.x(0)

    circuit_ir = build_circuit_ir("qiskit", circuit)

    assert 0 < len(circuit_ir["operations"]) <= MAX_CIRCUIT_IR_OPERATIONS
    assert circuit_ir["operation_count"] == MAX_CIRCUIT_IR_OPERATIONS + 1
    assert circuit_ir["truncated"] is True
    assert len(json.dumps(circuit_ir, allow_nan=False).encode("utf-8")) <= MAX_CIRCUIT_IR_BYTES


def test_qiskit_ir_truncates_before_it_can_evict_other_execution_evidence():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.circuit import Gate, Parameter

    parameters = [Parameter(f"{'p' * 150}{index}") for index in range(8)]
    verbose_gate = Gate("custom", 1, parameters)
    circuit = qiskit.QuantumCircuit(1)
    for _ in range(400):
        circuit.append(verbose_gate, [0])

    circuit_ir = build_circuit_ir("qiskit", circuit)

    assert len(json.dumps(circuit_ir, allow_nan=False).encode("utf-8")) <= MAX_CIRCUIT_IR_BYTES
    assert len(circuit_ir["operations"]) < circuit_ir["operation_count"]
    assert circuit_ir["truncated"] is True


def test_cirq_ir_is_available_without_openqasm():
    cirq = pytest.importorskip("cirq")

    qubits = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(cirq.H(qubits[0]), cirq.CNOT(*qubits), cirq.measure(*qubits))
    circuit_ir = build_circuit_ir("cirq", circuit)

    assert circuit_ir["framework"] == "cirq"
    assert circuit_ir["qubit_count"] == 2
    assert [operation["name"] for operation in circuit_ir["operations"]] == [
        "h",
        "cx",
        "measure",
    ]
    assert circuit_ir["operations"][-1]["qubits"] == [0, 1]
    assert circuit_ir["operations"][-1]["editable"] is False


def test_cirq_rotation_uses_radians_and_measurement_metadata_stays_read_only():
    cirq = pytest.importorskip("cirq")

    qubit = cirq.LineQubit(0)
    circuit = cirq.Circuit(cirq.rx(0.5)(qubit), cirq.measure(qubit, key="answer"))
    operations = build_circuit_ir("cirq", circuit)["operations"]

    assert operations[0]["name"] == "rx"
    assert float(operations[0]["parameters"][0]) == pytest.approx(0.5)
    assert operations[0]["editable"] is True
    assert operations[1]["name"] == "measure"
    assert "answer" in operations[1]["display_name"]
    assert operations[1]["editable"] is False


def test_pennylane_ir_preserves_high_level_templates_for_read_only_display():
    qml = pytest.importorskip("pennylane")

    @qml.qnode(qml.device("default.qubit", wires=3))
    def circuit():
        qml.Hadamard(wires=0)
        qml.QFT(wires=[0, 1, 2])
        return qml.probs(wires=[0, 1, 2])

    circuit_ir = build_circuit_ir("pennylane", circuit)

    assert circuit_ir["framework"] == "pennylane"
    assert circuit_ir["qubit_count"] == 3
    assert circuit_ir["operations"][0]["name"] == "h"
    qft = next(operation for operation in circuit_ir["operations"] if operation["name"] == "qft")
    assert qft["qubits"] == [0, 1, 2]
    assert qft["editable"] is False
    terminal = circuit_ir["operations"][-1]
    assert terminal["name"] == "probability"
    assert terminal["qubits"] == [0, 1, 2]
    assert terminal["editable"] is False


def test_pennylane_ir_keeps_expectation_observables_visible_and_read_only():
    qml = pytest.importorskip("pennylane")

    @qml.qnode(qml.device("default.qubit", wires=2))
    def circuit():
        qml.Hadamard(wires=0)
        return qml.expval(qml.PauliZ(wires=1))

    terminal = build_circuit_ir("pennylane", circuit)["operations"][-1]

    assert terminal["name"] == "expectation"
    assert terminal["qubits"] == [1]
    assert "Z" in terminal["parameters"][0]
    assert terminal["editable"] is False


def test_braket_ir_preserves_sparse_qubits_parameters_and_measurement_order():
    pytest.importorskip("braket")
    from braket.circuits import Circuit

    circuit = Circuit().h(2).cnot(2, 5).rz(5, 0.25).measure([5, 2])
    circuit_ir = build_circuit_ir("braket", circuit)

    assert circuit_ir["framework"] == "braket"
    assert circuit_ir["qubit_count"] == 2
    assert circuit_ir["clbit_count"] == 2
    assert [operation["name"] for operation in circuit_ir["operations"]] == [
        "h",
        "cx",
        "rz",
        "measure",
        "measure",
    ]
    assert circuit_ir["operations"][1]["qubits"] == [0, 1]
    assert float(circuit_ir["operations"][2]["parameters"][0]) == pytest.approx(0.25)
    assert circuit_ir["operations"][3]["qubits"] == [1]
    assert circuit_ir["operations"][3]["clbits"] == [0]
    assert circuit_ir["operations"][4]["qubits"] == [0]
    assert circuit_ir["operations"][4]["clbits"] == [1]
    assert all(not operation["editable"] for operation in circuit_ir["operations"])


def test_validation_rejects_partial_malformed_or_oversized_payloads():
    valid = _valid_ir()
    assert validate_circuit_ir(valid) == valid
    assert validate_circuit_ir({**valid, "schema": "invented"}) is None
    assert validate_circuit_ir({**valid, "operation_count": 3}) is None
    assert (
        validate_circuit_ir(
            {
                **valid,
                "operations": [
                    *valid["operations"][:-1],
                    {**valid["operations"][-1], "qubits": [2]},
                ],
            }
        )
        is None
    )
    assert (
        validate_circuit_ir(
            {
                **valid,
                "operations": [
                    *valid["operations"][:-1],
                    {**valid["operations"][-1], "display_name": "bad\nlabel"},
                ],
            }
        )
        is None
    )


def test_extraction_accepts_only_valid_provider_owned_ir():
    valid = _valid_ir()
    extracted = extract_circuit_ir({"circuit_ir": valid})
    assert extracted.source == "sandbox_epilogue"
    assert extracted.circuit_ir == valid

    malformed = extract_circuit_ir(
        {"circuit_ir": {"schema": CIRCUIT_IR_SCHEMA}, "circuit_ir_error": "ValueError"}
    )
    assert malformed.source == "missing"
    assert malformed.circuit_ir is None
    assert malformed.epilogue_error == "ValueError"
