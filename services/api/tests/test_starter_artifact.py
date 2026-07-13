from uuid import uuid4

from majorana_ir import Circuit, validate_circuit

from majorana_api.repos.system import (
    STARTER_BELL_CODE,
    STARTER_BELL_QASM,
    starter_bell_ir,
    starter_bell_slug,
)


def test_starter_bell_payload_is_a_valid_lossless_reference():
    circuit = Circuit.model_validate(starter_bell_ir())
    validation = validate_circuit(circuit)

    assert validation.passed
    assert circuit.qubits == 2
    assert [operation.gate for operation in circuit.operations] == ["h", "cx", "measure", "measure"]
    assert "QuantumCircuit" in STARTER_BELL_CODE
    assert STARTER_BELL_QASM.startswith("OPENQASM 3.0;")


def test_starter_bell_slug_is_workspace_specific():
    workspace_a = uuid4()
    workspace_b = uuid4()

    assert starter_bell_slug(workspace_a) != starter_bell_slug(workspace_b)
    assert starter_bell_slug(workspace_a).endswith(workspace_a.hex)
