import builtins
import re
import math

import pytest

from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm
from majorana_sandbox.spec import ExecutionSpec, compose_execution


def _observer_scope(namespace, observation):
    """The names `compose_execution` binds before generated code runs.

    Derived from the real preamble rather than typed out. A hand-written list
    drifts, and the drift is silent in the direction that matters: this double
    omitted `_majorana_builtins`, so an epilogue using it raised NameError HERE
    while working perfectly in the sandbox — a test failure on correct code, and
    the reverse (a name this double has and the real preamble does not) would be
    a passing test for an epilogue that cannot run at all.

    `test_the_observer_scope_matches_the_real_preamble` is the positive control:
    it fails if this extraction ever finds nothing.
    """
    scope = {
        "_majorana_namespace": namespace,
        "_majorana_observation": observation,
        "_majorana_builtins": builtins,
    }
    for local, builtin in _preamble_builtin_names():
        scope[local] = getattr(builtins, builtin)
    return scope


def _preamble_builtin_names() -> set[tuple[str, str]]:
    """(local, builtin) pairs the real preamble binds.

    Both halves, because they are not always the same word:
    `_majorana_exception = _majorana_builtins.Exception`. Capturing only the
    local name and reflecting it back at `builtins` looks for `exception`.
    """
    composed = compose_execution(
        ExecutionSpec(
            code="pass",
            trusted_observer="pass",
            protected_result_path="/tmp/unused.json",
        )
    )
    return set(re.findall(r"(_majorana_\w+) = _majorana_builtins\.(\w+)", composed))


def test_the_observer_scope_matches_the_real_preamble():
    """The positive control for `_observer_scope`'s extraction.

    A regex that matches nothing would silently return an EMPTY scope, and every
    epilogue test would then fail on the first builtin it touches — or, worse,
    an epilogue that happened to touch none would pass while proving nothing.
    """
    names = _preamble_builtin_names()
    assert len(names) >= 8, names
    assert {"len", "str", "type", "getattr"} <= {builtin for _local, builtin in names}
    assert ("_majorana_exception", "Exception") in names, (
        "the local name and the builtin are not always the same word"
    )
    scope = _observer_scope({}, {})
    assert scope["_majorana_len"] is builtins.len
    assert scope["_majorana_builtins"] is builtins


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


def test_contract_rejects_invalid_python_and_foreign_framework_imports():
    invalid = FrameworkProgram(Framework.QISKIT, "if :\n")
    foreign = FrameworkProgram(
        Framework.CIRQ,
        "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(1)\n",
    )

    assert invalid.contract_diagnostics(circuit_expected=True) == [
        "contract:generated source must be valid Python"
    ]
    assert foreign.contract_diagnostics(circuit_expected=True) == [
        "contract:cirq source imports foreign quantum framework `qiskit`"
    ]


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
    preset = FrameworkProgram(
        Framework.QISKIT,
        "pm = generate_preset_pass_manager(optimization_level=1)\n"
        "FINAL_CIRCUIT = pm.run(circuit)\n",
    )
    cirq = FrameworkProgram(Framework.CIRQ, "FINAL_CIRCUIT = circuit\n")

    assert qiskit.native_optimization().applied
    assert preset.native_optimization().applied
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


def test_qiskit_interchange_decomposes_diagonal_gate_when_direct_export_is_unavailable():
    qiskit = pytest.importorskip("qiskit")
    np = pytest.importorskip("numpy")
    from qiskit import qasm3
    from qiskit.circuit.library import DiagonalGate
    from qiskit.qasm3.exceptions import QASM3ExporterError

    circuit = qiskit.QuantumCircuit(8)
    phases = np.exp(-1j * np.random.default_rng(42).uniform(-1, 1, 2**8))
    circuit.h(range(8))
    circuit.append(DiagonalGate(phases), range(8))
    circuit.rx(1.0, range(8))
    circuit.measure_all()
    with pytest.raises(QASM3ExporterError):
        qasm3.dumps(circuit)

    program = FrameworkProgram(Framework.QISKIT, "FINAL_CIRCUIT = circuit\n")
    namespace = {"circuit": circuit}
    exec(program.source, namespace)
    observation = {}
    observer_scope = _observer_scope(namespace, observation)
    exec(
        program.trusted_setup(circuit_expected=True, collect_native_evidence=False),
        observer_scope,
    )
    exec(
        program.trusted_observer(circuit_expected=True, collect_native_evidence=False),
        observer_scope,
    )

    extraction = extract_interchange_qasm(observation)
    assert extraction.source == "sandbox_epilogue"
    exported = qasm3.loads(extraction.qasm)
    assert exported.num_qubits == 8
    assert set(exported.count_ops()) <= {"rx", "ry", "rz", "cx", "barrier", "measure"}
    assert exported.count_ops()["measure"] == 8


def test_qiskit_interchange_does_not_expand_a_wide_general_unitary(monkeypatch):
    qiskit = pytest.importorskip("qiskit")
    np = pytest.importorskip("numpy")
    from qiskit import qasm3
    from qiskit.circuit.library import UnitaryGate

    circuit = qiskit.QuantumCircuit(5)
    circuit.append(UnitaryGate(np.eye(2**5)), range(5))
    transpile_called = False

    def unavailable_export(_circuit):
        raise RuntimeError("direct export unavailable")

    def expensive_transpile(*_args, **_kwargs):
        nonlocal transpile_called
        transpile_called = True
        raise AssertionError("wide general unitary must not be decomposed")

    monkeypatch.setattr(qasm3, "dumps", unavailable_export)
    monkeypatch.setattr(qiskit, "transpile", expensive_transpile)

    program = FrameworkProgram(Framework.QISKIT, "FINAL_CIRCUIT = circuit\n")
    namespace = {"circuit": circuit}
    exec(program.source, namespace)
    observation = {}
    observer_scope = _observer_scope(namespace, observation)
    exec(
        program.trusted_setup(circuit_expected=True, collect_native_evidence=False),
        observer_scope,
    )
    exec(
        program.trusted_observer(circuit_expected=True, collect_native_evidence=False),
        observer_scope,
    )

    extraction = extract_interchange_qasm(observation)
    assert extraction.qasm is None
    assert extraction.epilogue_error == "RuntimeError"
    assert not transpile_called


def test_non_circuit_program_is_not_forced_through_openqasm():
    program = FrameworkProgram(Framework.PENNYLANE, "FINAL_CIRCUIT = object()\n")

    assert program.trusted_observer(circuit_expected=False) == ""
    assert extract_interchange_qasm(None).qasm is None


@pytest.mark.parametrize("framework", list(Framework))
def test_simple_execution_can_skip_unused_native_verification_evidence(framework):
    program = FrameworkProgram(framework, "FINAL_CIRCUIT = circuit\n")

    setup = program.trusted_setup(
        circuit_expected=True,
        collect_native_evidence=False,
    )
    observer = program.trusted_observer(
        circuit_expected=True,
        collect_native_evidence=False,
    )

    assert "_majorana_native_evidence" not in setup
    assert "_majorana_native_evidence" not in observer
    assert "resource_metrics" in observer


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


def test_braket_interchange_and_metrics_use_the_native_final_circuit():
    pytest.importorskip("braket")

    code = (
        "from braket.circuits import Circuit\n"
        "circuit = Circuit().h(2).cnot(2, 5).measure([2, 5])\n"
        "FINAL_CIRCUIT = circuit\n"
        "RESULT = {'counts': {'00': 1, '11': 1}}\n"
    )
    observation = _run_epilogue(Framework.BRAKET, code)
    extraction = extract_interchange_qasm(observation)

    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm is not None
    assert extraction.qasm.startswith("OPENQASM 3.0")
    assert "cnot q[2], q[5]" in extraction.qasm
    assert observation["resource_metrics"] == {
        "qubits": 2,
        "depth": 3,
        "gate_count": 2,
        "two_qubit_gate_count": 1,
        "measurement_count": 2,
    }


def test_braket_native_statevector_and_sampling_preserve_qubit_order():
    pytest.importorskip("braket")

    code = (
        "from braket.circuits import Circuit\n"
        "circuit = Circuit().x(2).h(5).measure([2, 5])\n"
        "FINAL_CIRCUIT = circuit\n"
        "RESULT = {'counts': {'10': 1, '11': 1}}\n"
    )
    observation = _run_epilogue(Framework.BRAKET, code)
    payload = observation["native_statevector"]

    assert payload["endianness"] == "q0_msb"
    assert payload["qubits"] == 2
    assert payload["measurement_map"] == {"0": 1, "1": 0}
    # Sorted Braket qubit 2 is the MSB, so X(q2) has support at |10>, |11>.
    assert _amplitude_support(payload) == [2, 3]
    sampled = observation["native_sampled"]
    assert sampled["bit_order"] == "big"
    assert sampled["seed"] is None
    assert sum(sampled["counts"].values()) == sampled["shots"]
    assert all(key.startswith("1") for key in sampled["counts"])


def test_braket_exact_statevector_program_keeps_computed_result_and_trusted_evidence():
    pytest.importorskip("braket")

    code = (
        "import numpy as np\n"
        "from braket.circuits import Circuit\n"
        "from braket.devices import LocalSimulator\n"
        "theta = 0.83\n"
        "phi = -0.41\n"
        "circuit = Circuit().ry(0, theta).rz(0, phi).state_vector()\n"
        "vector = np.asarray(LocalSimulator().run(circuit, shots=0).result().values[0], "
        "dtype=complex)\n"
        "overlap = np.conj(vector[0]) * vector[1]\n"
        "FINAL_CIRCUIT = circuit\n"
        "RESULT = {\n"
        "    'bloch_x': float(2 * np.real(overlap)),\n"
        "    'bloch_y': float(2 * np.imag(overlap)),\n"
        "    'bloch_z': float(abs(vector[0])**2 - abs(vector[1])**2),\n"
        "    'probability_one': float(abs(vector[1])**2),\n"
        "}\n"
    )
    observation = _run_epilogue(Framework.BRAKET, code)

    assert observation["result"] == pytest.approx(
        {
            "bloch_x": math.sin(0.83) * math.cos(-0.41),
            "bloch_y": math.sin(0.83) * math.sin(-0.41),
            "bloch_z": math.cos(0.83),
            "probability_one": math.sin(0.83 / 2) ** 2,
        },
        abs=1e-12,
    )
    assert observation["native_statevector"]["qubits"] == 1
    assert observation["native_sampled_error"] == "circuit has no measurements to sample"
    assert observation["resource_metrics"]["gate_count"] == 2


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

    # Only per-shot readout processes count as measurements; an expectation
    # value is an estimator directive (see the expval test below and the
    # adapter comment naming live run 019f7f9e-6e4c).
    class CountsMP:
        wires = (0,)

    class ExpectationMP:
        wires = (0,)

    class Tape:
        operations = [Operation()]
        measurements = [CountsMP(), ExpectationMP()]
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
        "dev = qml.device('default.qubit', wires=2)\n"
        "@qml.set_shots(100)\n"
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
        "dev = qml.device('default.qubit', wires=3)\n"
        "@qml.set_shots(100)\n"
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


def test_qiskit_c_if_is_caught_before_execution_and_names_its_replacement():
    """`.c_if()` was removed in Qiskit 2.0 and is the only classical feed-forward API
    the model reliably knows, so every teleportation candidate wrote it and died on
    AttributeError — four identical failures, budget exhausted, on production runs
    019f7dad-385b and 019f7dbf-d673.

    The second of those ran AFTER the generate prompt was changed to name `if_test`,
    and used `.c_if()` anyway. That is why this is a deterministic diagnostic and not
    a prompt rule: it fires before the sandbox and hands the repair loop the exact
    replacement rather than a traceback the model has proved it cannot learn from.
    """
    source = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(3, 2)\n"
        "qc.h(0)\n"
        "qc.measure(0, 0)\n"
        "qc.x(2).c_if(qc.clbits[0], 1)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'counts': {}}\n"
    )
    diagnostics = FrameworkProgram(Framework.QISKIT, source).contract_diagnostics(
        circuit_expected=True
    )
    assert any("c_if" in d and "if_test" in d for d in diagnostics), diagnostics

    ok = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(3, 2)\n"
        "qc.measure(0, 0)\n"
        "with qc.if_test((qc.clbits[0], 1)):\n"
        "    qc.x(2)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'counts': {}}\n"
    )
    assert FrameworkProgram(Framework.QISKIT, ok).contract_diagnostics(circuit_expected=True) == []


def test_qiskit_get_statevector_without_save_is_caught_before_execution():
    """AerSimulator.run(...).result().get_statevector(...) raises QiskitError unless
    the circuit calls .save_statevector() first — production run 019f9759-4fd1
    burned all 4 generation attempts on this exact KeyError/QiskitError for a VQE
    energy calculation before this deterministic check existed."""

    source = (
        "from qiskit import QuantumCircuit\n"
        "from qiskit_aer import AerSimulator\n"
        "qc = QuantumCircuit(2)\n"
        "qc.h(0)\n"
        "sim = AerSimulator(method='statevector')\n"
        "result = sim.run(qc, shots=None).result()\n"
        "sv = result.get_statevector(qc)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'energy': 0.0}\n"
    )
    diagnostics = FrameworkProgram(Framework.QISKIT, source).contract_diagnostics(
        circuit_expected=True
    )
    assert any("get_statevector" in d and "save_statevector" in d for d in diagnostics), diagnostics

    saved = (
        "from qiskit import QuantumCircuit\n"
        "from qiskit_aer import AerSimulator\n"
        "qc = QuantumCircuit(2)\n"
        "qc.h(0)\n"
        "qc.save_statevector()\n"
        "sim = AerSimulator(method='statevector')\n"
        "result = sim.run(qc, shots=None).result()\n"
        "sv = result.get_statevector(qc)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'energy': 0.0}\n"
    )
    assert (
        FrameworkProgram(Framework.QISKIT, saved).contract_diagnostics(circuit_expected=True) == []
    )

    via_statevector_class = (
        "from qiskit import QuantumCircuit\n"
        "from qiskit.quantum_info import Statevector\n"
        "qc = QuantumCircuit(2)\n"
        "qc.h(0)\n"
        "sv = Statevector(qc)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'energy': 0.0}\n"
    )
    assert (
        FrameworkProgram(Framework.QISKIT, via_statevector_class).contract_diagnostics(
            circuit_expected=True
        )
        == []
    )


# --- Framework-native verification evidence ----------------------------------------
#
# plans/archive/framework-native-verification.md (archived as shipped; the implementation
# is packages/py/verification/src/majorana_verification/native.py): the observer computes
# the statevector and a trusted sampled-counts re-execution with the framework's OWN
# simulator, so no OpenQASM conversion sits in the trust path. Every statevector
# fixture here breaks the qubit-permutation symmetry (the standing rule from PR 100):
# X on the lowest qubit plus H on the highest, so a wire-relabelling or endianness
# defect changes the state and cannot hide.


def _run_epilogue(framework: Framework, code: str) -> dict:
    import json
    import tempfile
    from pathlib import Path

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    program = FrameworkProgram(framework, code)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - the point of these tests is to run the real epilogue
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
        return json.loads(path.read_text())


def _amplitude_support(payload: dict) -> list[int]:
    amplitudes = payload["amplitudes"]
    support = []
    for index in range(len(amplitudes) // 2):
        if abs(amplitudes[2 * index]) > 1e-9 or abs(amplitudes[2 * index + 1]) > 1e-9:
            support.append(index)
    return support


def test_qiskit_native_statevector_breaks_permutation_symmetry():
    pytest.importorskip("qiskit")
    code = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(3, 2)\n"
        "qc.x(0)\n"
        "qc.h(2)\n"
        "qc.measure(0, 0)\n"
        "qc.measure(2, 1)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'counts': {'01': 1}}\n"
    )
    observation = _run_epilogue(Framework.QISKIT, code)
    payload = observation["native_statevector"]
    assert payload["endianness"] == "q0_lsb"
    assert payload["qubits"] == 3
    assert payload["clbits"] == 2
    assert payload["measurement_map"] == {"0": 0, "1": 2}
    # |001> and |101>: q0 flipped (LSB), q2 in superposition (bit 2). A relabelled
    # or reversed export would move the support and fail here.
    assert _amplitude_support(payload) == [1, 5]


@pytest.mark.filterwarnings("ignore::scipy.sparse.SparseEfficiencyWarning")
def test_qiskit_pauli_evolution_crosses_native_observer_and_qasm_export():
    pytest.importorskip("qiskit")
    import numpy as np
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import PauliEvolutionGate
    from qiskit.quantum_info import SparsePauliOp, Statevector

    code = (
        "from qiskit import QuantumCircuit\n"
        "from qiskit.circuit.library import PauliEvolutionGate\n"
        "from qiskit.quantum_info import SparsePauliOp, Statevector\n"
        "qc = QuantumCircuit(3)\n"
        "qc.x(0)\n"
        "for label, coefficient, time in "
        "[('IXX', 0.61, 0.08), ('YYI', -0.37, 0.16), ('IXX', 0.61, 0.08)]:\n"
        "    qc.append(PauliEvolutionGate("
        "SparsePauliOp.from_list([(label, coefficient)]), time=time), range(3))\n"
        "state = Statevector.from_instruction(qc)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'z1': float(state.expectation_value(SparsePauliOp('IZI')).real)}\n"
    )
    observation = _run_epilogue(Framework.QISKIT, code)
    payload = observation["native_statevector"]
    observed_pairs = np.asarray(payload["amplitudes"], dtype=float).reshape(-1, 2)
    observed = observed_pairs[:, 0] + 1j * observed_pairs[:, 1]

    circuit = QuantumCircuit(3)
    circuit.x(0)
    for label, coefficient, time in (
        ("IXX", 0.61, 0.08),
        ("YYI", -0.37, 0.16),
        ("IXX", 0.61, 0.08),
    ):
        circuit.append(
            PauliEvolutionGate(SparsePauliOp.from_list([(label, coefficient)]), time=time),
            range(3),
        )
    expected = np.asarray(Statevector.from_instruction(circuit).data)

    assert payload["qubits"] == 3
    assert np.max(np.abs(observed - expected)) <= 1e-14
    assert observation["native_sampled_error"] == "circuit has no measurements to sample"
    interchange = extract_interchange_qasm(observation)
    assert interchange.source == "sandbox_epilogue"
    assert interchange.epilogue_error is None
    assert interchange.qasm is not None
    assert interchange.qasm.startswith("OPENQASM 3")


def test_qiskit_kraus_channel_preserves_result_and_reports_interchange_incapacity():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    code = (
        "import math\n"
        "import numpy as np\n"
        "from qiskit import QuantumCircuit\n"
        "from qiskit.quantum_info import Kraus\n"
        "from qiskit_aer import AerSimulator\n"
        "gamma = 0.31\n"
        "k0 = np.array([[1, 0], [0, math.sqrt(1-gamma)]], dtype=complex)\n"
        "k1 = np.array([[0, math.sqrt(gamma)], [0, 0]], dtype=complex)\n"
        "qc = QuantumCircuit(1)\n"
        "qc.ry(1.1, 0)\n"
        "qc.append(Kraus([k0, k1]).to_instruction(), [0])\n"
        "executed = qc.copy()\n"
        "executed.save_density_matrix()\n"
        "rho = np.asarray(AerSimulator(method='density_matrix').run(executed)"
        ".result().data(0)['density_matrix'])\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'excited_population': float(rho[1, 1].real)}\n"
    )
    observation = _run_epilogue(Framework.QISKIT, code)
    interchange = extract_interchange_qasm(observation)

    assert observation["result"]["excited_population"] == pytest.approx(
        (1.0 - 0.31) * math.sin(1.1 / 2.0) ** 2
    )
    assert observation["resource_metrics"]["qubits"] == 1
    assert "native_statevector" not in observation
    assert observation["native_statevector_error"]
    assert interchange.source == "missing"
    assert interchange.qasm is None
    assert interchange.epilogue_error


def test_qiskit_native_statevector_declares_incapacity_on_feed_forward():
    pytest.importorskip("qiskit")
    code = (
        "from qiskit import QuantumCircuit, ClassicalRegister, QuantumRegister\n"
        "q = QuantumRegister(3)\n"
        "m = ClassicalRegister(2, 'm')\n"
        "out = ClassicalRegister(1, 'out')\n"
        "qc = QuantumCircuit(q, m, out)\n"
        "qc.h(1)\n"
        "qc.cx(1, 2)\n"
        "qc.cx(0, 1)\n"
        "qc.h(0)\n"
        "qc.measure(0, 0)\n"
        "qc.measure(1, 1)\n"
        "with qc.if_test((m, 1)):\n"
        "    qc.x(2)\n"
        "with qc.if_test((m, 3)):\n"
        "    qc.z(2)\n"
        "qc.measure(2, 2)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'counts': {'000': 1}}\n"
    )
    observation = _run_epilogue(Framework.QISKIT, code)
    assert "native_statevector" not in observation
    assert "not unitary up to final measurements" in observation["native_statevector_error"]
    interchange = extract_interchange_qasm(observation)
    assert interchange.source == "sandbox_epilogue"
    assert interchange.epilogue_error is None
    assert interchange.qasm is not None
    assert "if (" in interchange.qasm
    # The register structure the verifier marginalizes on
    # (plans/archive/sampled-counts-width-mismatch.md, archived as shipped in PR #113).
    # Only present when Aer is installed — it is in the sandbox
    # image, not in the dev/CI venv, which is why the ordering claim underneath it
    # gets its own aer-free pin below.
    if "native_sampled" in observation:
        sampled = observation["native_sampled"]
        assert sampled["registers"] == [{"name": "out", "width": 1}, {"name": "m", "width": 2}]
        assert all(key.index(" ") == 1 for key in sampled["counts"])
        # This fixture measures into clbits 0, 1 and 2, so every register is
        # written; the verifier's unwritten-register diagnostic stays silent.
        assert sampled["measured_clbits"] == [0, 1, 2]
    else:
        assert observation["native_sampled_error"] == "qiskit_aer unavailable"


def test_qiskit_counts_keys_print_the_last_declared_register_leftmost():
    """The ordering the observer's `registers` export encodes, pinned against
    Qiskit's own key formatter. If this ever flips, the verifier would marginalize
    off the wrong end of the key — a silent wrong-answer, so it gets a test that
    runs without Aer."""
    pytest.importorskip("qiskit")
    from qiskit.result.postprocess import format_counts

    header = {"creg_sizes": [["m", 2], ["out", 1]], "memory_slots": 3}
    # 0x5 = 101: clbits 0 and 2 set, i.e. m = "01" and out = "1".
    assert format_counts({"0x5": 10}, header) == {"1 01": 10}


def test_cirq_native_statevector_and_sampled_counts():
    pytest.importorskip("cirq")
    code = (
        "import cirq\n"
        "q = [cirq.LineQubit(i) for i in range(3)]\n"
        "c = cirq.Circuit([cirq.X(q[0]), cirq.H(q[2]),\n"
        "                  cirq.measure(q[0], key='a'), cirq.measure(q[2], key='b')])\n"
        "FINAL_CIRCUIT = c\n"
        "RESULT = {'counts': {'10': 1, '11': 1}}\n"
    )
    observation = _run_epilogue(Framework.CIRQ, code)
    payload = observation["native_statevector"]
    assert payload["endianness"] == "q0_msb"
    # all_qubits holds only the touched qubits: q0 and q2, canonical order sorted.
    assert payload["qubits"] == 2
    # q0 (canonical 0) is the MSB: X(q0) puts support at indices 2 and 3.
    assert _amplitude_support(payload) == [2, 3]
    sampled = observation["native_sampled"]
    assert sampled["bit_order"] == "big"
    assert sum(sampled["counts"].values()) == sampled["shots"]
    # q0 measured as key 'a' is the leftmost sampled bit and is always 1.
    assert all(key.startswith("1") for key in sampled["counts"])


def test_cirq_native_statevector_uses_complex128_for_exact_evidence():
    cirq = pytest.importorskip("cirq")
    import numpy as np

    code = (
        "import cirq\n"
        "q0, q1 = cirq.LineQubit.range(2)\n"
        "FINAL_CIRCUIT = cirq.Circuit(\n"
        "    cirq.ry(0.924297)(q0),\n"
        "    cirq.CNOT(q0, q1),\n"
        "    cirq.rz(-0.091798)(q1),\n"
        ")\n"
        "RESULT = {'ok': True}\n"
    )
    observation = _run_epilogue(Framework.CIRQ, code)
    payload = observation["native_statevector"]
    observed = np.asarray(payload["amplitudes"], dtype=float).reshape(-1, 2)
    observed = observed[:, 0] + 1j * observed[:, 1]

    q0, q1 = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(
        cirq.ry(0.924297)(q0),
        cirq.CNOT(q0, q1),
        cirq.rz(-0.091798)(q1),
    )
    expected128 = cirq.final_state_vector(
        circuit,
        qubit_order=[q0, q1],
        dtype=np.complex128,
    )
    default64 = cirq.final_state_vector(circuit, qubit_order=[q0, q1])

    assert np.max(np.abs(observed - expected128)) <= 1e-15
    assert np.max(np.abs(default64 - expected128)) > 1e-9


def test_cirq_feed_forward_samples_but_declares_statevector_incapacity():
    pytest.importorskip("cirq")
    code = (
        "import cirq\n"
        "q = [cirq.LineQubit(i) for i in range(2)]\n"
        "c = cirq.Circuit([cirq.H(q[0]), cirq.measure(q[0], key='m'),\n"
        "                  cirq.X(q[1]).with_classical_controls('m'),\n"
        "                  cirq.measure(q[1], key='out')])\n"
        "FINAL_CIRCUIT = c\n"
        "RESULT = {'counts': {'00': 1, '11': 1}}\n"
    )
    observation = _run_epilogue(Framework.CIRQ, code)
    assert "native_statevector" not in observation
    assert "not unitary" in observation["native_statevector_error"]
    sampled = observation["native_sampled"]
    # The feed-forward correlation must hold in every trusted sample.
    assert set(sampled["counts"]) == {"00", "11"}


def test_pennylane_native_statevector_and_sampled_counts():
    pytest.importorskip("pennylane")
    code = (
        "import pennylane as qml\n"
        "dev = qml.device('default.qubit', wires=3)\n"
        "@qml.set_shots(128)\n"
        "@qml.qnode(dev)\n"
        "def circuit():\n"
        "    qml.PauliX(wires=0)\n"
        "    qml.Hadamard(wires=2)\n"
        "    return qml.counts(wires=[0, 2])\n"
        "counts = circuit()\n"
        "FINAL_CIRCUIT = qml.workflow.construct_tape(circuit)()\n"
        "RESULT = {'counts': {str(k): int(v) for k, v in counts.items()}}\n"
    )
    observation = _run_epilogue(Framework.PENNYLANE, code)
    payload = observation["native_statevector"]
    assert payload["endianness"] == "q0_msb"
    assert payload["qubits"] == 2  # the tape touches wires 0 and 2 only
    # wire 0 (canonical 0) is the MSB: X puts support at indices 2 and 3.
    assert _amplitude_support(payload) == [2, 3]
    sampled = observation["native_sampled"]
    assert sampled["bit_order"] == "big"
    assert all(key.startswith("1") for key in sampled["counts"])
    assert all(type(value) is int for value in sampled["counts"].values())


def test_native_statevector_limit_pins_the_verifier_ceiling():
    """The observer's export limit must stay within what the verifier accepts,
    or valid evidence would be rejected as malformed."""
    import re

    from majorana_frameworks import adapters
    from majorana_verification import NATIVE_STATEVECTOR_MAX_QUBITS

    match = re.search(r"_MAJORANA_NATIVE_SV_QUBITS = (\d+)", adapters._NATIVE_LIMITS)
    assert match is not None
    assert int(match.group(1)) <= NATIVE_STATEVECTOR_MAX_QUBITS


def test_pennylane_expectation_is_not_a_measurement():
    """`qml.expval(H)` is how every idiomatic PennyLane VQE ends, and it is an
    estimator directive, not a per-shot readout of qubits. Counting it made
    `measurement_policy: none` unsatisfiable for PennyLane variational code:
    live run 019f7f9e-6e4c failed four candidates on "FINAL_CIRCUIT carries 2
    measurement(s)" where both were one expectation value, while the identical
    qiskit-shaped VQE passed the same day. Runs the real observer."""
    pytest.importorskip("pennylane")
    import json
    import tempfile
    from pathlib import Path

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    code = (
        "import pennylane as qml\n"
        "dev = qml.device('default.qubit', wires=2)\n"
        "H = 0.5 * qml.PauliZ(0) + 1.2 * qml.PauliZ(1) + 0.8 * qml.PauliX(0) @ qml.PauliX(1)\n"
        "@qml.set_shots(100)\n"
        "@qml.qnode(dev)\n"
        "def circuit():\n"
        "    qml.RY(0.3, wires=0)\n"
        "    qml.CNOT([0, 1])\n"
        "    return qml.expval(H)\n"
        "circuit()\n"
        "FINAL_CIRCUIT = qml.workflow.construct_tape(circuit)()\n"
        "RESULT = {'ground_state_energy': -1.87}\n"
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
    assert metrics["measurement_count"] == 0, (
        "an expectation value was counted as a per-shot measurement; "
        "measurement_policy `none` is unsatisfiable for PennyLane VQEs again"
    )
