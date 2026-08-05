import pytest
from majorana_openqasm import (
    OpenQASMError,
    detect_version,
    fingerprint,
    normalize,
    resource_metrics,
)

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


def test_a_barrier_is_not_counted_as_a_two_qubit_gate():
    """A compiler directive carries no physical action, but a barrier over two
    qubits satisfies a raw `len(qubits) == 2` test — so on a 2-qubit circuit it
    read as an entangling gate, and the two-qubit count is the headline
    hardware-cost number.

    The sandbox observer in `majorana_frameworks` fixed this and this copy of the
    predicate did not, so the same Bell circuit reported one two-qubit gate there
    and two here. Found by the R1 cross-check comparing this function against the
    portable reading over the published corpus, which disagreed on all 15
    two-qubit entries in it and on none of the wider ones.
    """
    barriered = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0], q[1];
barrier q;
measure q[0] -> c[0];
measure q[1] -> c[1];
"""
    metrics = resource_metrics(barriered)

    assert metrics.two_qubit_gate_count == 1
    assert metrics.gate_count == 2
    assert metrics.measurement_count == 2
    # And the barrier changes nothing against the same circuit without one.
    plain = resource_metrics(BELL_2)
    assert (metrics.gate_count, metrics.two_qubit_gate_count) == (
        plain.gate_count,
        plain.two_qubit_gate_count,
    )


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


# Byte-for-byte the header cirq 1.7.0 emits (reproduced locally 2026-07-20), and
# the reason every Cirq run silently lost its exact and Born-distribution checks.
CIRQ_HEADER_QASM = """// Generated from Cirq v1.7.0

OPENQASM 2.0;
include "qelib1.inc";


// Qubits: [q(0), q(1)]
qreg q[2];


h q[0];
cx q[0],q[1];
"""


def test_a_comment_header_before_the_declaration_is_accepted():
    assert detect_version(CIRQ_HEADER_QASM) == "2.0"
    assert normalize(CIRQ_HEADER_QASM).startswith("OPENQASM 3.0;")


def test_a_block_comment_header_is_accepted():
    source = '/* emitted by a tool\n   over two lines */\nOPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nh q[0];\n'
    assert detect_version(source) == "3.0"


def test_a_program_with_no_declaration_at_all_is_still_rejected():
    """The rule is scoped to comments — it must not start accepting arbitrary text."""
    with pytest.raises(OpenQASMError):
        detect_version('include "qelib1.inc";\nqreg q[2];\nh q[0];\n')


def test_a_declaration_hidden_behind_real_code_is_rejected():
    with pytest.raises(OpenQASMError):
        detect_version("qreg q[2];\nOPENQASM 2.0;\n")
