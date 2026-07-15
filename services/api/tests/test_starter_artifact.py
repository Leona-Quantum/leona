from uuid import uuid4

from majorana_openqasm import load_circuit, normalize

from majorana_api.repos.system import (
    STARTER_BELL_CODE,
    STARTER_BELL_QASM,
    starter_bell_slug,
)
from majorana_api.routes.artifacts import _canonical_public_qasm


def test_starter_bell_payload_is_a_valid_lossless_reference():
    circuit = load_circuit(STARTER_BELL_QASM)

    assert circuit.num_qubits == 2
    assert [instruction.operation.name for instruction in circuit.data] == [
        "h",
        "cx",
        "measure",
        "measure",
    ]
    assert normalize(STARTER_BELL_QASM).startswith("OPENQASM 3.0;")
    assert "QuantumCircuit" in STARTER_BELL_CODE
    assert STARTER_BELL_QASM.startswith("OPENQASM 3.0;")


def test_starter_bell_slug_is_workspace_specific():
    workspace_a = uuid4()
    workspace_b = uuid4()

    assert starter_bell_slug(workspace_a) != starter_bell_slug(workspace_b)
    assert starter_bell_slug(workspace_a).endswith(workspace_a.hex)


def test_public_qasm_is_normalized_before_persistence():
    qasm2 = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nh q[0];\n'
    qasm, version, digest = _canonical_public_qasm(qasm2)

    assert qasm and qasm.startswith("OPENQASM 3.0;")
    assert version == "3.0"
    assert digest and len(digest) == 64
