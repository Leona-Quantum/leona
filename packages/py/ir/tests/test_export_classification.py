"""Export classification tests — the honesty promise. Cases map directly to the
benchmark suite adjudications (evals/benchmark-suite-v0.md): JC-2 (no pre-committed
labels, evidence-consistent) and JC-5 (unsupported blames the IR layer, not the
format, and acknowledges the format could express it)."""

from majorana_contracts.enums import ExportStatus
from majorana_ir import Circuit, Operation
from majorana_ir.connectors import from_openqasm
from majorana_ir.export import classify_export

BELL = """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
h q[0];
cx q[0],q[1];
"""


def test_openqasm2_native_export_is_lossless():
    result = classify_export(from_openqasm(BELL), "openqasm2")
    assert result.status is ExportStatus.LOSSLESS
    assert result.code and result.qasm_available


def test_qiskit_export_is_lossless_with_code():
    result = classify_export(from_openqasm(BELL), "qiskit")
    assert result.status is ExportStatus.LOSSLESS
    assert "QuantumCircuit" in result.code


def test_pennylane_with_measurement_is_lossy_with_reason():
    circuit = from_openqasm(
        """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
measure q[0] -> c[0];
"""
    )
    result = classify_export(circuit, "pennylane")
    assert result.status is ExportStatus.LOSSY_WITH_REASON
    assert result.reason  # names what was approximated
    assert "sample" in result.reason


def test_pennylane_with_reset_is_download_only_not_unsupported():
    # reset is expressible in IR but not in PennyLane; a QASM2 download still exists.
    circuit = Circuit(
        qubits=1,
        classical_bits=0,
        operations=[Operation(gate="reset", qubits=[0])],
    )
    result = classify_export(circuit, "pennylane")
    assert result.status is ExportStatus.DOWNLOAD_ONLY
    assert result.qasm_available


def test_openqasm3_and_cudaq_are_download_only_never_overclaimed():
    # JC-2: with no native generator we must NOT claim lossless.
    for target in ("openqasm3", "cudaq"):
        result = classify_export(from_openqasm(BELL), target)
        assert result.status is ExportStatus.DOWNLOAD_ONLY
        assert result.status is not ExportStatus.LOSSLESS
        assert result.qasm_available


def test_mid_circuit_measurement_is_unsupported_blaming_the_ir_layer():
    # JC-5: bench-28. Post-measurement gate = mid-circuit measurement/feed-forward,
    # which the terminal-measurement IR limit rejects. The reason must cite the IR
    # limitation and acknowledge the format could otherwise express it.
    circuit = Circuit(
        qubits=1,
        classical_bits=1,
        operations=[
            Operation(gate="measure", qubits=[0], clbits=[0]),
            Operation(gate="x", qubits=[0]),
        ],
    )
    result = classify_export(circuit, "openqasm2")
    assert result.status is ExportStatus.UNSUPPORTED
    assert "IR limitation" in result.reason
    assert "openqasm2" in result.reason  # acknowledges the format
    assert not result.qasm_available
