"""IR round-trip, canonicalization, and fingerprint tests (ported from quepo)."""

import pytest

from majorana_ir import (
    Circuit,
    Operation,
    canonical_json,
    circuit_fingerprint,
    upgrade_to_v3,
    validate_circuit,
)
from majorana_ir.connectors import from_openqasm, to_openqasm

BELL = """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];
"""


def test_openqasm_roundtrip_is_stable():
    circuit = from_openqasm(BELL)
    again = from_openqasm(to_openqasm(circuit))
    assert canonical_json(circuit) == canonical_json(again)


def test_qiskit_u2_u3_aliases_parse_to_canonical_u():
    circuit = from_openqasm(
        """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
u2(0,pi) q[0];
u3(pi/2,0,pi) q[0];
"""
    )
    assert [operation.gate for operation in circuit.operations] == ["u", "u"]
    assert circuit.operations[0].params[0] == pytest.approx(1.5707963267948966)


def test_fingerprint_is_deterministic_and_collision_free():
    bell = from_openqasm(BELL)
    other = from_openqasm(
        """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
h q[0];
"""
    )
    assert circuit_fingerprint(bell) == circuit_fingerprint(from_openqasm(BELL))
    assert circuit_fingerprint(bell) != circuit_fingerprint(other)


def test_parameter_normalization_makes_equivalent_circuits_identical():
    a = upgrade_to_v3(
        Circuit(
            qubits=1, classical_bits=0, operations=[Operation(gate="rz", qubits=[0], params=[0.0])]
        )
    )
    b = upgrade_to_v3(
        Circuit(
            qubits=1, classical_bits=0, operations=[Operation(gate="rz", qubits=[0], params=[-0.0])]
        )
    )
    assert circuit_fingerprint(a) == circuit_fingerprint(b)


def test_validate_flags_post_measurement_gate():
    circuit = Circuit(
        qubits=1,
        classical_bits=1,
        operations=[
            Operation(gate="measure", qubits=[0], clbits=[0]),
            Operation(gate="x", qubits=[0]),
        ],
    )
    result = validate_circuit(circuit)
    assert not result.passed
    assert any("terminal-measurement" in err for err in result.errors)
