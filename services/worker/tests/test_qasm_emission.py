"""Optional Qiskit interchange instrumentation tests."""

from __future__ import annotations

import sys
from types import ModuleType

import pytest
from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm
from majorana_sandbox.guard import check_python_code

from majorana_worker.stage_handlers import (
    _parse_result_dict,
    _repair_legacy_qiskit_qasm,
)


def _install_fake_qiskit(monkeypatch, dumps) -> None:
    qiskit = ModuleType("qiskit")
    qasm3 = ModuleType("qiskit.qasm3")
    qasm3.dumps = dumps
    monkeypatch.setitem(sys.modules, "qiskit", qiskit)
    monkeypatch.setitem(sys.modules, "qiskit.qasm3", qasm3)


def test_owned_qiskit_epilogue_emits_marked_final_circuit_without_model_qasm(monkeypatch, capsys):
    expected_qasm = "OPENQASM 3.0;\nqubit q;\nh q;"
    _install_fake_qiskit(monkeypatch, lambda circuit: expected_qasm)
    code = """import json
FINAL_CIRCUIT = object()
print(json.dumps({"counts": {"0": 1}}))
"""

    composed = FrameworkProgram(Framework.QISKIT, code).instrument_for_interchange(
        circuit_expected=True
    )
    assert check_python_code(composed).ok
    exec(composed, {})

    stdout = capsys.readouterr().out
    assert _parse_result_dict(stdout) == {"counts": {"0": 1}}
    extraction = extract_interchange_qasm(stdout)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == expected_qasm


def test_owned_epilogue_records_serialization_error_without_trusting_model_stdout(
    monkeypatch, capsys
):
    def fail_dumps(circuit):
        raise RuntimeError("do not persist raw sandbox errors")

    _install_fake_qiskit(monkeypatch, fail_dumps)
    code = """import json
FINAL_CIRCUIT = object()
print("OPENQASM 2.0;\\nqreg q[1];\\nx q[0];")
print(json.dumps({"counts": {"1": 1}}))
"""

    program = FrameworkProgram(Framework.QISKIT, code)
    exec(program.instrument_for_interchange(circuit_expected=True), {})

    extraction = extract_interchange_qasm(capsys.readouterr().out)
    assert extraction.source == "missing"
    assert extraction.qasm is None
    assert extraction.epilogue_error == "RuntimeError"


def test_owned_epilogue_serializes_a_real_qiskit_circuit_when_available(capsys):
    qiskit = pytest.importorskip("qiskit")
    quantum_circuit = qiskit.QuantumCircuit
    code = """import json
FINAL_CIRCUIT = QuantumCircuit(1)
FINAL_CIRCUIT.h(0)
print(json.dumps({"counts": {"0": 1}}))
"""

    program = FrameworkProgram(Framework.QISKIT, code)
    exec(
        program.instrument_for_interchange(circuit_expected=True),
        {"QuantumCircuit": quantum_circuit},
    )

    extraction = extract_interchange_qasm(capsys.readouterr().out)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm and extraction.qasm.startswith("OPENQASM 3.0;")


def test_legacy_qiskit_qasm_method_is_repaired_for_qiskit_2x():
    code = """from qiskit import QuantumCircuit
FINAL_CIRCUIT = QuantumCircuit(2)
circuit_qasm = FINAL_CIRCUIT.qasm()
"""

    repaired = _repair_legacy_qiskit_qasm(code)

    assert "from qiskit.qasm2 import dumps as _majorana_qasm2_dumps" in repaired
    assert "_majorana_qasm2_dumps(FINAL_CIRCUIT)" in repaired
    assert ".qasm()" not in repaired
