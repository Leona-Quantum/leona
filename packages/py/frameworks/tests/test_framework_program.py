import json

from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm


def test_fingerprint_is_framework_aware_and_preserves_source_whitespace():
    first = FrameworkProgram(Framework.QISKIT, "x = 1  \r\n")
    second = FrameworkProgram(Framework.QISKIT, "x = 1\n")
    other = FrameworkProgram(Framework.CIRQ, "x = 1\n")

    assert first.fingerprint != second.fingerprint
    assert first.fingerprint != other.fingerprint


def test_contract_requires_final_circuit_for_every_selected_framework():
    program = FrameworkProgram(Framework.CIRQ, "import cirq\n")

    assert program.contract_diagnostics(circuit_expected=True) == [
        "contract:cirq circuit code must bind FINAL_CIRCUIT"
    ]
    assert program.contract_diagnostics(circuit_expected=False) == []


def test_comments_and_literals_do_not_satisfy_circuit_contract_or_metrics():
    program = FrameworkProgram(
        Framework.QISKIT,
        '# FINAL_CIRCUIT = circuit\ntext = "circuit.h(0); transpile(circuit)"\n',
    )

    assert program.contract_diagnostics(circuit_expected=True)
    assert not program.native_optimization().applied
    assert program.resource_metrics(qubits=1, expected_runtime_sec=1).gate_count == 0


def test_multiline_literal_contents_are_preserved_in_fingerprint():
    first = FrameworkProgram(Framework.QISKIT, 'note = """value  \n"""\n')
    second = FrameworkProgram(Framework.QISKIT, 'note = """value\n"""\n')

    assert first.normalized_source == first.source
    assert first.fingerprint != second.fingerprint


def test_native_optimization_is_classified_in_selected_source():
    qiskit = FrameworkProgram(Framework.QISKIT, "FINAL_CIRCUIT = transpile(circuit)\n")
    cirq = FrameworkProgram(Framework.CIRQ, "FINAL_CIRCUIT = circuit\n")

    assert qiskit.native_optimization().applied
    assert not cirq.native_optimization().applied


def test_resource_metrics_follow_selected_framework_syntax():
    cirq = FrameworkProgram(
        Framework.CIRQ,
        "FINAL_CIRCUIT = cirq.Circuit(cirq.H(q0), cirq.CNOT(q0, q1), cirq.measure(q0))\n",
    )

    metrics = cirq.resource_metrics(qubits=2, expected_runtime_sec=3)
    assert metrics.gate_count == 2
    assert metrics.two_qubit_gate_count == 1
    assert metrics.measurement_count == 1
    assert metrics.estimated_runtime_ms == 3000


def test_qiskit_interchange_is_optional_observation(tmp_path, monkeypatch):
    import sys
    from types import ModuleType

    qiskit = ModuleType("qiskit")
    qasm3 = ModuleType("qiskit.qasm3")
    qasm3.dumps = lambda circuit: "OPENQASM 3.0;\nqubit q;"
    monkeypatch.setitem(sys.modules, "qiskit", qiskit)
    monkeypatch.setitem(sys.modules, "qiskit.qasm3", qasm3)

    program = FrameworkProgram(
        Framework.QISKIT,
        'FINAL_CIRCUIT = object()\nprint("native result")\n',
    )
    result_path = tmp_path / "observation.json"
    epilogue = program.trusted_epilogue(str(result_path), circuit_expected=True)
    exec(program.source + epilogue, {})

    extraction = extract_interchange_qasm(json.loads(result_path.read_text()))
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == "OPENQASM 3.0;\nqubit q;"


def test_non_qiskit_program_is_not_forced_through_openqasm():
    program = FrameworkProgram(Framework.PENNYLANE, "FINAL_CIRCUIT = object()\n")

    assert program.trusted_epilogue("/tmp/unused", circuit_expected=False) == ""
    assert extract_interchange_qasm(None).qasm is None


def test_cirq_metrics_are_observed_from_final_sandbox_object(tmp_path):
    class Operation:
        def __init__(self, *qubits):
            self.qubits = qubits

    class FakeCircuit:
        def all_operations(self):
            return [Operation("q0"), Operation("q0", "q1")]

        def all_qubits(self):
            return {"q0", "q1"}

        def __len__(self):
            return 2

    program = FrameworkProgram(Framework.CIRQ, "FINAL_CIRCUIT = circuit\n")
    result_path = tmp_path / "cirq-observation.json"
    exec(
        program.source + program.trusted_epilogue(str(result_path), circuit_expected=True),
        {"circuit": FakeCircuit()},
    )
    observation = json.loads(result_path.read_text())

    metrics = program.resource_metrics(qubits=99, expected_runtime_sec=1, observation=observation)
    assert metrics.qubits == 2
    assert metrics.depth == 2
    assert metrics.gate_count == 2
    assert metrics.two_qubit_gate_count == 1


def test_model_stdout_cannot_forge_interchange():
    forged = "__MAJORANA_INTERCHANGE_QASM_BEGIN__\nOPENQASM 3.0;\n"

    assert extract_interchange_qasm(None).qasm is None
    assert "OPENQASM" in forged
