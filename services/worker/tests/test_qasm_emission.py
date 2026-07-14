"""Lane-B Qiskit epilogue contract tests (no database or real Qiskit required)."""

from __future__ import annotations

import sys
from types import ModuleType

import pytest
from majorana_llm import extract_qasm_with_provenance
from majorana_sandbox.guard import check_python_code

from majorana_ir import Circuit, Operation
from majorana_worker.stage_handlers import (
    _parse_result_dict,
    _qiskit_qasm_epilogue,
    _repair_legacy_qiskit_qasm,
    _rewrite_qiskit_final_circuit,
)


def _install_fake_qiskit(monkeypatch, dumps) -> None:
    qiskit = ModuleType("qiskit")
    qasm2 = ModuleType("qiskit.qasm2")
    qasm2.dumps = dumps
    monkeypatch.setitem(sys.modules, "qiskit", qiskit)
    monkeypatch.setitem(sys.modules, "qiskit.qasm2", qasm2)


def test_owned_qiskit_epilogue_emits_marked_final_circuit_without_model_qasm(monkeypatch, capsys):
    expected_qasm = "OPENQASM 2.0;\nqreg q[1];\nh q[0];"
    _install_fake_qiskit(monkeypatch, lambda circuit: expected_qasm)
    code = """import json
FINAL_CIRCUIT = object()
print(json.dumps({"counts": {"0": 1}}))
"""

    composed = _qiskit_qasm_epilogue(code)
    assert check_python_code(composed).ok
    exec(composed, {})

    stdout = capsys.readouterr().out
    assert _parse_result_dict(stdout) == {"counts": {"0": 1}}
    extraction = extract_qasm_with_provenance(stdout)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == expected_qasm


def test_owned_epilogue_records_serialization_error_and_keeps_model_fallback(monkeypatch, capsys):
    def fail_dumps(circuit):
        raise RuntimeError("do not persist raw sandbox errors")

    _install_fake_qiskit(monkeypatch, fail_dumps)
    code = """import json
FINAL_CIRCUIT = object()
print("OPENQASM 2.0;\\nqreg q[1];\\nx q[0];")
print(json.dumps({"counts": {"1": 1}}))
"""

    exec(_qiskit_qasm_epilogue(code), {})

    extraction = extract_qasm_with_provenance(capsys.readouterr().out)
    assert extraction.source == "model_stdout"
    assert extraction.epilogue_error == "RuntimeError"


def test_owned_epilogue_serializes_a_real_qiskit_circuit_when_available(capsys):
    qiskit = pytest.importorskip("qiskit")
    quantum_circuit = qiskit.QuantumCircuit
    code = """import json
FINAL_CIRCUIT = QuantumCircuit(1)
FINAL_CIRCUIT.h(0)
print(json.dumps({"counts": {"0": 1}}))
"""

    exec(_qiskit_qasm_epilogue(code), {"QuantumCircuit": quantum_circuit})

    extraction = extract_qasm_with_provenance(capsys.readouterr().out)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm and "u(pi/2,0,pi) q[0];" in extraction.qasm


def test_compiler_rewrite_updates_the_qiskit_variable_used_by_final_run():
    code = """from qiskit import QuantumCircuit
compiled_circuit = QuantumCircuit(1)
FINAL_CIRCUIT = compiled_circuit
result = AerSimulator().run(compiled_circuit).result()
"""
    circuit = Circuit(
        qubits=1,
        classical_bits=0,
        operations=[Operation(gate="x", qubits=[0])],
    )

    rewritten = _rewrite_qiskit_final_circuit(code, circuit)

    assert rewritten is not None
    assert "compiled_circuit = QuantumCircuit.from_qasm_str" in rewritten
    assert "FINAL_CIRCUIT = compiled_circuit" in rewritten


def test_legacy_qiskit_qasm_method_is_repaired_for_qiskit_2x():
    code = """from qiskit import QuantumCircuit
FINAL_CIRCUIT = QuantumCircuit(2)
circuit_qasm = FINAL_CIRCUIT.qasm()
"""

    repaired = _repair_legacy_qiskit_qasm(code)

    assert "from qiskit.qasm2 import dumps as _majorana_qasm2_dumps" in repaired
    assert "_majorana_qasm2_dumps(FINAL_CIRCUIT)" in repaired
    assert ".qasm()" not in repaired
