import asyncio
import math
import sys

import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator

from majorana_contracts import CircuitOptimizationRequest
from majorana_frameworks.optimizers import CircuitOptimizationError, optimize_circuit


def _request(compiler: str, operations: list[dict], *, level: int = 3):
    return CircuitOptimizationRequest.model_validate(
        {
            "compiler": compiler,
            "qubit_count": 2,
            "optimization_level": level,
            "operations": operations,
        }
    )


def _operator(operations) -> Operator:
    circuit = QuantumCircuit(2)
    for operation in operations:
        gate = operation.gate.value if hasattr(operation, "gate") else operation["gate"]
        qubits = operation.qubits if hasattr(operation, "qubits") else operation["qubits"]
        angle = (
            operation.angle_radians
            if hasattr(operation, "angle_radians")
            else operation.get("angle_radians")
        )
        method = getattr(circuit, gate.lower())
        if angle is None:
            method(*qubits)
        else:
            method(angle, *qubits)
    return Operator(circuit)


@pytest.mark.parametrize("compiler", ["qiskit", "cirq", "pytket", "pennylane"])
def test_general_compilers_reduce_a_numeric_studio_circuit(compiler):
    result = optimize_circuit(
        _request(
            compiler,
            [
                {"gate": "H", "qubits": [0]},
                {"gate": "H", "qubits": [0]},
                {"gate": "RX", "qubits": [1], "angle_radians": 0.2},
                {"gate": "RX", "qubits": [1], "angle_radians": 0.3},
                {"gate": "CX", "qubits": [0, 1]},
                {"gate": "CX", "qubits": [0, 1]},
            ],
        )
    )

    assert [(operation.gate.value, operation.qubits) for operation in result.operations] == [
        ("RX", [1])
    ]
    assert result.operations[0].angle_radians == pytest.approx(0.5)
    assert result.before.gate_count == 6
    assert result.after.gate_count == 1
    assert result.compiler_version
    assert result.equivalence == "unitary_up_to_global_phase"


def test_bqskit_runs_a_bounded_synthesis_pipeline_and_returns_studio_gates():
    operations = [
        {"gate": "H", "qubits": [0]},
        {"gate": "H", "qubits": [0]},
        {"gate": "RX", "qubits": [1], "angle_radians": 0.2},
        {"gate": "RX", "qubits": [1], "angle_radians": 0.3},
        {"gate": "CX", "qubits": [0, 1]},
        {"gate": "CX", "qubits": [0, 1]},
    ]

    result = optimize_circuit(_request("bqskit", operations, level=3))

    assert result.after.gate_count < result.before.gate_count
    assert _operator(operations).equiv(_operator(result.operations))
    assert {operation.gate.value for operation in result.operations} <= {
        "H",
        "X",
        "Y",
        "Z",
        "S",
        "T",
        "RX",
        "RY",
        "RZ",
        "CX",
        "CZ",
        "SWAP",
    }


@pytest.mark.asyncio
async def test_bqskit_can_run_from_the_worker_background_thread():
    result = await asyncio.to_thread(
        optimize_circuit,
        _request(
            "bqskit",
            [
                {"gate": "H", "qubits": [0]},
                {"gate": "H", "qubits": [0]},
            ],
            level=1,
        ),
    )

    assert result.compiler.value == "bqskit"
    assert result.compiler_version == "1.2.1"


def test_pyzx_runs_its_clifford_t_optimizer_and_lowers_back_to_studio_gates():
    result = optimize_circuit(
        _request(
            "pyzx",
            [
                {"gate": "H", "qubits": [0]},
                {"gate": "H", "qubits": [0]},
                {"gate": "T", "qubits": [1]},
                {"gate": "T", "qubits": [1]},
                {"gate": "CX", "qubits": [0, 1]},
                {"gate": "CX", "qubits": [0, 1]},
            ],
        )
    )

    assert len(result.operations) == 1
    assert result.operations[0].gate.value == "RZ"
    assert result.operations[0].qubits == [1]
    assert result.operations[0].angle_radians == pytest.approx(math.pi / 2)


def test_terminal_measurements_are_preserved_outside_the_compiler():
    result = optimize_circuit(
        _request(
            "qiskit",
            [
                {"gate": "X", "qubits": [0]},
                {"gate": "X", "qubits": [0]},
                {"gate": "M", "qubits": [0]},
                {"gate": "M", "qubits": [1]},
            ],
        )
    )

    assert [operation.gate.value for operation in result.operations] == ["M", "M"]
    assert result.after.measurement_count == 2
    assert any("preserved" in warning for warning in result.warnings)


def test_pyzx_refuses_rotations_outside_exact_clifford_t_angles():
    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(_request("pyzx", [{"gate": "RZ", "qubits": [0], "angle_radians": 0.123}]))

    assert raised.value.code == "pyzx_requires_clifford_t"


@pytest.mark.parametrize("compiler", ["qiskit", "cirq", "pytket", "pennylane", "pyzx", "bqskit"])
def test_compiler_adapters_preserve_a_representative_unitary_up_to_global_phase(compiler):
    operations = [
        {"gate": "H", "qubits": [0]},
        {"gate": "T", "qubits": [0]},
        {"gate": "CX", "qubits": [0, 1]},
        {"gate": "RZ", "qubits": [1], "angle_radians": math.pi / 4},
        {"gate": "RX", "qubits": [0], "angle_radians": math.pi / 2},
        {"gate": "CZ", "qubits": [0, 1]},
    ]

    result = optimize_circuit(_request(compiler, operations))

    assert _operator(operations).equiv(_operator(result.operations))


def test_qiskit_materializes_an_elided_output_wire_permutation():
    operations = [
        {"gate": "H", "qubits": [0]},
        {"gate": "SWAP", "qubits": [0, 1]},
        {"gate": "RX", "qubits": [0], "angle_radians": 0.2},
    ]

    result = optimize_circuit(_request("qiskit", operations))

    assert _operator(operations).equiv(_operator(result.operations))
    assert result.operations[-1].gate.value == "SWAP"


def test_pyzx_refuses_a_rewrite_its_exact_equality_check_rejects():
    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(
            _request(
                "pyzx",
                [
                    {"gate": "SWAP", "qubits": [0, 1]},
                    {"gate": "RX", "qubits": [0], "angle_radians": math.pi / 2},
                ],
            )
        )

    assert raised.value.code == "compiler_equivalence_check_failed"


def test_bqskit_refuses_circuits_beyond_its_synthesis_budget():
    request = CircuitOptimizationRequest.model_validate(
        {
            "compiler": "bqskit",
            "qubit_count": 9,
            "optimization_level": 1,
            "operations": [{"gate": "H", "qubits": [0]}],
        }
    )

    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(request)

    assert raised.value.code == "bqskit_budget_exceeded"


def test_pyzx_says_so_plainly_when_the_extra_is_not_installed(monkeypatch):
    """PyZX is the one compiler a deployed image may legitimately not have.

    It lives in `majorana-frameworks`'s `zx` extra rather than `optimizers`,
    because it declares `ipywidgets` and so drags ipython, pexpect and
    ptyprocess into the single image `services/api/Dockerfile` builds and
    `deploy.yml` runs both the api and the worker from. Measured: `uv sync
    --all-packages --frozen --no-dev` installs 151 packages with pyzx in
    `optimizers` and 129 with it out, and 21 of the 22 removed are that stack.

    So the adapter has to survive its own absence with a sentence a caller can
    act on. Without the guard the failure is a bare `ModuleNotFoundError`
    escaping `optimize_circuit`, which is a 500 rather than a refusal — and the
    difference only ever shows up in production, because every test environment
    installs the extra through the root dev group.
    """
    monkeypatch.setitem(sys.modules, "pyzx", None)

    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(_request("pyzx", [{"gate": "H", "qubits": [0]}]))

    assert raised.value.code == "compiler_unavailable"
