from majorana_openqasm import detect_version, fingerprint, normalize, resource_metrics

BELL_2 = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0], q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];
"""

LEGACY_STANDARD_GATE_2 = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
u(0.1, 0.2, 0.3) q[0];
"""


def test_qasm2_ingests_as_canonical_qasm3():
    canonical = normalize(BELL_2)
    assert canonical.startswith("OPENQASM 3.0;")
    assert detect_version(canonical) == "3.0"
    assert resource_metrics(canonical).qubits == 2


def test_qasm2_legacy_standard_gates_use_qiskit_compatibility_imports():
    canonical = normalize(LEGACY_STANDARD_GATE_2)
    assert canonical.startswith("OPENQASM 3.0;")
    assert "U(0.1, 0.2, 0.3) q[0];" in canonical


def test_fingerprint_ignores_qasm2_formatting():
    compact = BELL_2.replace("\n", "\n\n")
    assert fingerprint(BELL_2) == fingerprint(compact)


def test_metrics_use_sdk_circuit_semantics():
    metrics = resource_metrics(BELL_2)
    assert metrics.qubits == 2
    assert metrics.gate_count == 2
    assert metrics.two_qubit_gate_count == 1
    assert metrics.measurement_count == 2


def test_qasm3_dynamic_control_is_preserved():
    source = """OPENQASM 3.0;
include "stdgates.inc";
bit c;
qubit q;
h q;
c = measure q;
if (c == true) { x q; }
"""
    canonical = normalize(source)
    assert "if (" in canonical
    assert normalize(canonical) == canonical
