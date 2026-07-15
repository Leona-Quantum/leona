"""Optional Qiskit interchange instrumentation tests."""

from __future__ import annotations

import sys
import json
from types import ModuleType

import pytest
from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm
from majorana_sandbox.guard import check_python_code
from majorana_sandbox.spec import ExecutionSpec, compose_execution

from majorana_worker.stage_handlers import (
    _parse_result_dict,
    _repair_legacy_qiskit_qasm,
)


def _install_fake_qiskit(monkeypatch, dumps) -> None:
    qiskit = ModuleType("qiskit")
    qasm3 = ModuleType("qiskit.qasm3")
    qasm3.dumps = dumps
    qiskit.__path__ = []
    qiskit.qasm3 = qasm3
    monkeypatch.setitem(sys.modules, "qiskit", qiskit)
    monkeypatch.setitem(sys.modules, "qiskit.qasm3", qasm3)


def test_owned_qiskit_epilogue_returns_protected_final_circuit(monkeypatch, capsys, tmp_path):
    expected_qasm = "OPENQASM 3.0;\nqubit q;\nh q;"
    _install_fake_qiskit(monkeypatch, lambda circuit: expected_qasm)
    code = """import json
import qiskit.qasm3
qiskit.qasm3.dumps = lambda circuit: "FORGED"
class Instruction:
    qubits = (0, 1)
class Circuit:
    num_qubits = 2
    data = [Instruction()]
    def count_ops(self): return {"custom_entangler": 1, "measure": 2}
    def depth(self): return 3
FINAL_CIRCUIT = Circuit()
print(json.dumps({"counts": {"0": 1}}))
"""

    program = FrameworkProgram(Framework.QISKIT, code)
    result_path = tmp_path / "observation.json"
    assert check_python_code(program.source).ok
    exec(
        compose_execution(
            ExecutionSpec(
                code=program.source,
                trusted_setup=program.trusted_setup(circuit_expected=True),
                trusted_observer=program.trusted_observer(circuit_expected=True),
                protected_result_path=str(result_path),
            )
        ),
        {},
    )

    stdout = capsys.readouterr().out
    assert _parse_result_dict(stdout) == {"counts": {"0": 1}}
    protected_result = json.loads(result_path.read_text())
    extraction = extract_interchange_qasm(protected_result)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == expected_qasm
    assert protected_result["resource_metrics"]["two_qubit_gate_count"] == 1


def test_owned_epilogue_records_serialization_error_without_trusting_model_stdout(
    monkeypatch, capsys, tmp_path
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
    result_path = tmp_path / "observation.json"
    exec(
        compose_execution(
            ExecutionSpec(
                code=program.source,
                trusted_setup=program.trusted_setup(circuit_expected=True),
                trusted_observer=program.trusted_observer(circuit_expected=True),
                protected_result_path=str(result_path),
            )
        ),
        {},
    )

    extraction = extract_interchange_qasm(json.loads(result_path.read_text()))
    assert extraction.source == "missing"
    assert extraction.qasm is None
    assert extraction.epilogue_error == "RuntimeError"


def test_owned_epilogue_serializes_a_real_qiskit_circuit_when_available(capsys, tmp_path):
    qiskit = pytest.importorskip("qiskit")
    quantum_circuit = qiskit.QuantumCircuit
    code = """import json
from qiskit import QuantumCircuit
FINAL_CIRCUIT = QuantumCircuit(1)
FINAL_CIRCUIT.h(0)
print(json.dumps({"counts": {"0": 1}}))
"""

    program = FrameworkProgram(Framework.QISKIT, code)
    result_path = tmp_path / "observation.json"
    assert quantum_circuit is not None
    exec(
        compose_execution(
            ExecutionSpec(
                code=program.source,
                trusted_setup=program.trusted_setup(circuit_expected=True),
                trusted_observer=program.trusted_observer(circuit_expected=True),
                protected_result_path=str(result_path),
            )
        ),
        {},
    )

    extraction = extract_interchange_qasm(json.loads(result_path.read_text()))
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
