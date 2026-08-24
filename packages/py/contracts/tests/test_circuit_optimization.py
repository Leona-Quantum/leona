import pytest
from pydantic import ValidationError

from majorana_contracts import CircuitOptimizationRequest


def test_circuit_optimization_request_accepts_only_the_closed_studio_gate_shape():
    request = CircuitOptimizationRequest.model_validate(
        {
            "compiler": "pytket",
            "qubit_count": 2,
            "optimization_level": 3,
            "operations": [
                {"gate": "H", "qubits": [0]},
                {"gate": "RX", "qubits": [1], "angle_radians": 0.25},
                {"gate": "CX", "qubits": [0, 1]},
                {"gate": "M", "qubits": [0]},
            ],
        }
    )

    assert request.compiler.value == "pytket"
    assert request.operations[1].angle_radians == 0.25


@pytest.mark.parametrize(
    "operation",
    [
        {"gate": "CUSTOM", "qubits": [0]},
        {"gate": "CX", "qubits": [0]},
        {"gate": "H", "qubits": [0], "angle_radians": 0.5},
        {"gate": "RZ", "qubits": [0]},
        {"gate": "SWAP", "qubits": [0, 0]},
    ],
)
def test_circuit_optimization_request_rejects_unrepresentable_operations(operation):
    with pytest.raises(ValidationError):
        CircuitOptimizationRequest.model_validate(
            {"compiler": "qiskit", "qubit_count": 2, "operations": [operation]}
        )


def test_circuit_optimization_request_rejects_nonterminal_measurement():
    with pytest.raises(ValidationError, match="measurement operations must be terminal"):
        CircuitOptimizationRequest.model_validate(
            {
                "compiler": "qiskit",
                "qubit_count": 1,
                "operations": [
                    {"gate": "M", "qubits": [0]},
                    {"gate": "X", "qubits": [0]},
                ],
            }
        )
