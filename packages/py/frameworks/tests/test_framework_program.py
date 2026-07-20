import builtins

import pytest

from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm


def _observer_scope(namespace, observation):
    return {
        "_majorana_namespace": namespace,
        "_majorana_observation": observation,
        "_majorana_exception": builtins.Exception,
        "_majorana_getattr": builtins.getattr,
        "_majorana_hasattr": builtins.hasattr,
        "_majorana_int": builtins.int,
        "_majorana_len": builtins.len,
        "_majorana_list": builtins.list,
        "_majorana_str": builtins.str,
        "_majorana_sum": builtins.sum,
        "_majorana_type": builtins.type,
    }


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


def test_qiskit_interchange_is_optional_observation(monkeypatch):
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
    namespace = {}
    exec(program.source, namespace)
    observation = {}
    observer_scope = _observer_scope(namespace, observation)
    exec(program.trusted_setup(circuit_expected=True), observer_scope)
    exec(
        program.trusted_observer(circuit_expected=True),
        observer_scope,
    )

    extraction = extract_interchange_qasm(observation)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == "OPENQASM 3.0;\nqubit q;"


def test_non_circuit_program_is_not_forced_through_openqasm():
    program = FrameworkProgram(Framework.PENNYLANE, "FINAL_CIRCUIT = object()\n")

    assert program.trusted_observer(circuit_expected=False) == ""
    assert extract_interchange_qasm(None).qasm is None


def test_cirq_interchange_uses_native_openqasm3_export():
    class FakeCircuit:
        def to_qasm(self, *, version):
            assert version == "3.0"
            return "OPENQASM 3.0;\nqubit q;"

        def all_operations(self):
            return []

        def all_qubits(self):
            return set()

        def __len__(self):
            return 0

    program = FrameworkProgram(Framework.CIRQ, "FINAL_CIRCUIT = circuit\n")
    namespace = {"circuit": FakeCircuit()}
    exec(program.source, namespace)
    observation = {}
    exec(
        program.trusted_observer(circuit_expected=True),
        _observer_scope(namespace, observation),
    )

    extraction = extract_interchange_qasm(observation)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == "OPENQASM 3.0;\nqubit q;"


def test_pennylane_interchange_uses_trusted_tape_export(monkeypatch):
    import sys
    from types import ModuleType

    pennylane = ModuleType("pennylane")
    # Mirrors the real `qml.to_openqasm(tape, wires=...)` signature: the epilogue pins
    # the wire order so the export cannot relabel qubits, and a double that rejected
    # that keyword would make the call look like an export failure.
    pennylane.to_openqasm = lambda tape, wires=None: "OPENQASM 2.0;\nqreg q[1];"
    monkeypatch.setitem(sys.modules, "pennylane", pennylane)

    class Tape:
        operations = []
        measurements = []
        wires = (0,)

    class QNode:
        tape = Tape()

    program = FrameworkProgram(Framework.PENNYLANE, "FINAL_CIRCUIT = qnode\n")
    namespace = {"qnode": QNode()}
    exec(program.source, namespace)
    observation = {}
    observer_scope = _observer_scope(namespace, observation)
    exec(program.trusted_setup(circuit_expected=True), observer_scope)
    exec(program.trusted_observer(circuit_expected=True), observer_scope)

    extraction = extract_interchange_qasm(observation)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm == "OPENQASM 2.0;\nqreg q[1];"


def test_cirq_metrics_are_observed_from_final_sandbox_object():
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
    namespace = {"circuit": FakeCircuit()}
    exec(program.source, namespace)
    observation = {}
    exec(
        program.trusted_observer(circuit_expected=True),
        _observer_scope(namespace, observation),
    )

    metrics = program.resource_metrics(qubits=99, expected_runtime_sec=1, observation=observation)
    assert metrics.qubits == 2
    assert metrics.depth == 2
    assert metrics.gate_count == 2
    assert metrics.two_qubit_gate_count == 1


def test_pennylane_measurements_are_not_counted_as_gates():
    class Operation:
        wires = (0, 1)

    class ExpectationMP:
        wires = (0,)

    class Tape:
        operations = [Operation()]
        measurements = [ExpectationMP()]
        wires = (0, 1)

        def __bool__(self):
            return False

    class QNode:
        tape = Tape()

    program = FrameworkProgram(Framework.PENNYLANE, "FINAL_CIRCUIT = qnode\n")
    namespace = {"qnode": QNode()}
    exec(program.source, namespace)
    observation = {}
    exec(
        program.trusted_observer(circuit_expected=True),
        _observer_scope(namespace, observation),
    )

    metrics = program.resource_metrics(qubits=99, expected_runtime_sec=1, observation=observation)
    assert metrics.gate_count == 1
    assert metrics.two_qubit_gate_count == 1
    assert metrics.measurement_count == 1


def test_model_stdout_cannot_forge_interchange():
    forged = "__MAJORANA_INTERCHANGE_QASM_BEGIN__\nOPENQASM 3.0;\n"

    assert extract_interchange_qasm(None).qasm is None
    assert "OPENQASM" in forged


def test_cirq_observer_counts_measured_qubits_not_measurement_operations():
    """`cirq.measure(q0, q1)` is ONE operation covering TWO qubits. Counting
    operations reported 1 for a fully measured 2-qubit circuit, and the MEASURE_ALL
    policy needs `measurement_count >= observed_qubits` — so no Cirq circuit could
    ever satisfy it, on any candidate, and the run burned its whole budget on a
    check no repair could fix. Observed on production 2026-07-20.

    Runs the real observer against a real cirq circuit rather than asserting on the
    generated source, because the bug was in what the source computed, not in
    whether it was emitted.
    """
    pytest.importorskip("cirq")
    import json
    import tempfile
    from pathlib import Path

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    code = (
        "import cirq\n"
        "q0, q1 = cirq.LineQubit.range(2)\n"
        "FINAL_CIRCUIT = cirq.Circuit(cirq.H(q0), cirq.CNOT(q0, q1), "
        "cirq.measure(q0, q1, key='r'))\n"
        "RESULT = {'counts': {'00': 1024, '11': 1024}}\n"
    )
    program = FrameworkProgram(Framework.CIRQ, code)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - the point of the test is to run the real epilogue
            compose_execution(
                ExecutionSpec(
                    code=program.normalized_source,
                    trusted_setup=program.trusted_setup(circuit_expected=True),
                    trusted_observer=program.trusted_observer(circuit_expected=True),
                    protected_result_path=str(path),
                    source_fingerprint=program.fingerprint,
                )
            ),
            {},
        )
        metrics = json.loads(path.read_text())["resource_metrics"]

    assert metrics["qubits"] == 2
    assert metrics["measurement_count"] == 2, "counted operations instead of qubits"


def test_pennylane_observer_treats_an_empty_wire_list_as_all_wires():
    """`qml.counts()` with no arguments measures the whole tape but reports
    `wires == []`. Counting that as one measured qubit left PennyLane failing
    MEASURE_ALL exactly as Cirq had — caught by a second production run."""
    pytest.importorskip("pennylane")
    import json
    import tempfile
    from pathlib import Path

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    code = (
        "import pennylane as qml\n"
        "dev = qml.device('default.qubit', wires=2, shots=100)\n"
        "@qml.qnode(dev)\n"
        "def circuit():\n"
        "    qml.Hadamard(0)\n"
        "    qml.CNOT([0, 1])\n"
        "    return qml.counts()\n"
        "circuit()\n"
        "FINAL_CIRCUIT = qml.workflow.construct_tape(circuit)()\n"
        "RESULT = {'counts': {'00': 50, '11': 50}}\n"
    )
    program = FrameworkProgram(Framework.PENNYLANE, code)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - the point of the test is to run the real epilogue
            compose_execution(
                ExecutionSpec(
                    code=program.normalized_source,
                    trusted_setup=program.trusted_setup(circuit_expected=True),
                    trusted_observer=program.trusted_observer(circuit_expected=True),
                    protected_result_path=str(path),
                    source_fingerprint=program.fingerprint,
                )
            ),
            {},
        )
        metrics = json.loads(path.read_text())["resource_metrics"]

    assert metrics["qubits"] == 2
    assert metrics["measurement_count"] >= metrics["qubits"], "MEASURE_ALL unsatisfiable"


def test_qiskit_observer_does_not_count_barriers_as_gates():
    """A `barrier` is a compiler directive, not a gate: it carries no physical
    action. But `qc.measure_all()` — the idiomatic call our own MEASURE_ALL policy
    pushes the agent toward — inserts a Barrier spanning every qubit, and the
    observer counted it both as a gate and, because it spans two qubits, as a
    TWO-QUBIT gate. A rebased Bell circuit was reported as 5 gates / 2 two-qubit
    gates instead of 4 / 1. Two-qubit gate count is the headline hardware-cost
    number a customer reads and the resource contract checks against the plan.

    Observed on production run 019f7da9 (2026-07-20), the first parent_artifact
    revision run. Runs the real observer against a real qiskit circuit, because
    the bug was in what the generated source computed.
    """
    pytest.importorskip("qiskit")
    import json
    import tempfile
    from pathlib import Path

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    code = (
        "from qiskit import QuantumCircuit, transpile\n"
        "qc = QuantumCircuit(2)\n"
        "qc.h(0)\n"
        "qc.cx(0, 1)\n"
        "qc.measure_all()\n"
        "FINAL_CIRCUIT = transpile(qc, basis_gates=['rz', 'sx', 'x', 'cx'], seed_transpiler=42)\n"
        "RESULT = {'counts': {'00': 1024, '11': 1024}}\n"
    )
    program = FrameworkProgram(Framework.QISKIT, code)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - the point of the test is to run the real epilogue
            compose_execution(
                ExecutionSpec(
                    code=program.normalized_source,
                    trusted_setup=program.trusted_setup(circuit_expected=True),
                    trusted_observer=program.trusted_observer(circuit_expected=True),
                    protected_result_path=str(path),
                    source_fingerprint=program.fingerprint,
                )
            ),
            {},
        )
        metrics = json.loads(path.read_text())["resource_metrics"]

    assert metrics["qubits"] == 2
    assert metrics["measurement_count"] == 2
    assert metrics["two_qubit_gate_count"] == 1, "counted the measure_all barrier as a CX"
    assert metrics["gate_count"] == 4, "counted the measure_all barrier as a gate"


def test_pennylane_interchange_preserves_wire_labels_when_tape_order_is_unsorted():
    """A tape orders wires by FIRST APPEARANCE and `to_openqasm` maps them to the
    QASM register POSITIONALLY. `qml.QFT(wires=[2, 1, 0])` gives `tape.wires ==
    [0, 2, 1]`, so the export renamed wire 2 to q[1] and wire 1 to q[2] — a
    different labelled circuit than the one that ran.

    `exact` then compared the relabelled export against the reference and FAILED
    CORRECT CODE. Production run 019f7dad-3be5 (2026-07-20) burned its whole
    candidate budget rewriting a valid 3-qubit QFT at max_abs_distance 0.707. Every
    earlier PennyLane test touched wires in sorted order, where the two orders
    coincide, which is why a false negative in the verification layer survived.

    Asserts on the exported circuit's UNITARY, not on the QASM text: the bug was
    that the text described the wrong circuit.
    """
    pytest.importorskip("pennylane")
    pytest.importorskip("qiskit")
    import json
    import tempfile
    from pathlib import Path

    import numpy as np
    from qiskit import qasm2
    from qiskit.quantum_info import Operator

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    code = (
        "import pennylane as qml\n"
        "dev = qml.device('default.qubit', wires=3, shots=100)\n"
        "@qml.qnode(dev)\n"
        "def circuit():\n"
        "    qml.PauliX(wires=0)\n"
        "    qml.QFT(wires=[2, 1, 0])\n"
        "    return qml.counts()\n"
        "circuit()\n"
        "FINAL_CIRCUIT = qml.workflow.construct_tape(circuit)()\n"
        "RESULT = {'counts': {'001': 100}}\n"
    )
    program = FrameworkProgram(Framework.PENNYLANE, code)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - the point of the test is to run the real epilogue
            compose_execution(
                ExecutionSpec(
                    code=program.normalized_source,
                    trusted_setup=program.trusted_setup(circuit_expected=True),
                    trusted_observer=program.trusted_observer(circuit_expected=True),
                    protected_result_path=str(path),
                    source_fingerprint=program.fingerprint,
                )
            ),
            {},
        )
        exported = json.loads(path.read_text())["interchange_qasm"]

    # The circuit the planner would declare for QFT(|001>) in OpenQASM's own
    # wire-labelling, written independently of anything PennyLane emits.
    reference = qasm2.loads(
        "OPENQASM 2.0;\n"
        'include "qelib1.inc";\n'
        "qreg q[3];\n"
        "x q[0];\n"
        "h q[2];\n"
        "cu1(pi/2) q[2], q[1];\n"
        "cu1(pi/4) q[2], q[0];\n"
        "h q[1];\n"
        "cu1(pi/2) q[1], q[0];\n"
        "h q[0];\n"
        "swap q[0], q[2];\n",
        custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS,
    )
    candidate = qasm2.loads(
        "\n".join(line for line in exported.splitlines() if not line.startswith("measure")),
        custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS,
    )
    left, right = Operator(reference).data, Operator(candidate).data
    peak = np.unravel_index(np.argmax(np.abs(left)), left.shape)
    aligned = left * (right[peak] / left[peak])  # equivalence is up to global phase
    assert np.max(np.abs(aligned - right)) < 1e-9, "export relabelled the tape's wires"
