"""One code model: a circuit, a program, and the lowering between them.

`roles.py` says why this exists. The short version is a defect: source pulled
from the open repository is a CIRCUIT — it binds `FINAL_CIRCUIT` and nothing
else — so the basic execution contract failed it with `RESULT missing key`, whose
retry target is GENERATION. A run over a published circuit went to a language
model to be rewritten.

Two groups here:

1. **Classification** — pure, fast, and the thing every other decision keys off.
2. **Lowering through the REAL sandbox** — because the epilogue is generated code
   executed in another process, and the only honest test of generated code is
   running it. These are marked `sandbox` and skipped without the SDK installed.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os

import pytest
from majorana_contracts.enums import Framework
from majorana_frameworks.adapters import adapter_for
from majorana_frameworks.program import FrameworkProgram
from majorana_frameworks.roles import (
    CIRCUIT_NAME,
    RESULT_NAME,
    ProgramRole,
    classify_source,
    is_python_source,
    result_was_derived,
)

# --------------------------------------------------------------------------- #
# 1. Classification
# --------------------------------------------------------------------------- #

REPOSITORY_CIRCUIT = """from qiskit import QuantumCircuit

FINAL_CIRCUIT = QuantumCircuit(2, 2)
FINAL_CIRCUIT.h(0)
FINAL_CIRCUIT.cx(0, 1)
FINAL_CIRCUIT.measure([0, 1], [0, 1])
"""

AGENT_PROGRAM = """from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

FINAL_CIRCUIT = QuantumCircuit(2, 2)
FINAL_CIRCUIT.h(0)
FINAL_CIRCUIT.cx(0, 1)
FINAL_CIRCUIT.measure([0, 1], [0, 1])

RESULT = {"counts": AerSimulator().run(FINAL_CIRCUIT, shots=1024).result().get_counts()}
"""


def test_the_repository_publishes_circuits_and_the_agent_emits_programs():
    assert classify_source(REPOSITORY_CIRCUIT) is ProgramRole.CIRCUIT
    assert classify_source(AGENT_PROGRAM) is ProgramRole.PROGRAM


def test_a_source_binding_both_is_a_program_not_a_circuit():
    """The ordering is load-bearing, not a tie-break.

    Every generated program binds BOTH names — it builds FINAL_CIRCUIT and then
    reports RESULT. If CIRCUIT won, every agent program would be classified as a
    circuit and the lowering epilogue would derive a result over the top of the
    one the program actually computed.
    """
    assert CIRCUIT_NAME in AGENT_PROGRAM and RESULT_NAME in AGENT_PROGRAM
    assert classify_source(AGENT_PROGRAM) is ProgramRole.PROGRAM


def test_source_binding_neither_name_is_unknown_and_is_not_guessed():
    assert classify_source("print('hello')") is ProgramRole.UNKNOWN
    assert classify_source("") is ProgramRole.UNKNOWN
    # Not CIRCUIT. Unparseable source binds nothing this module can see, and
    # `contract_diagnostics` already refuses it by name with a better message.
    assert classify_source("FINAL_CIRCUIT = (((") is ProgramRole.UNKNOWN


def test_unknown_has_two_meanings_and_a_lenient_caller_must_tell_them_apart():
    """A circuit that forgot to say what it built is repairable source. A record
    of an operator, written in English, is not source at all.

    `import-public` needs the difference: refusing every UNKNOWN would have taken
    276 of the 283 live catalog entries out of the Library, because those rows
    predate the binding fix. It refuses the prose and files the circuit.
    """
    forgot_the_binding = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.h(0)"
    a_record = (
        "OPERATOR: Fermionic annihilation operator\n"
        "REPRESENTATIVE FORM: a_p\n\n"
        "This is a mathematical operator record, not an executable circuit."
    )

    assert classify_source(forgot_the_binding) is ProgramRole.UNKNOWN
    assert classify_source(a_record) is ProgramRole.UNKNOWN
    assert is_python_source(forgot_the_binding) is True
    assert is_python_source(a_record) is False

    # Empty source parses, and binds nothing. UNKNOWN, but it IS Python — the
    # distinction is "does this parse", not "is this useful".
    assert is_python_source("") is True
    assert is_python_source("FINAL_CIRCUIT = (((") is False


def test_a_binding_the_naive_scan_would_miss_still_counts():
    """Four shapes that are all real Python and all bind the name."""
    assert classify_source("FINAL_CIRCUIT: object = build()") is ProgramRole.CIRCUIT
    assert classify_source("if True:\n    FINAL_CIRCUIT = build()") is ProgramRole.CIRCUIT
    assert classify_source("for i in range(1):\n    FINAL_CIRCUIT = build()") is ProgramRole.CIRCUIT
    assert classify_source("RESULT, extra = compute()") is ProgramRole.PROGRAM
    assert classify_source("while (RESULT := next(it)):\n    pass") is ProgramRole.PROGRAM


def test_every_form_python_binds_a_name_with_counts():
    """Assignment is not the only one, and assuming it was misclassified programs.

    A real program binding `RESULT` through any of these was classified CIRCUIT —
    which is NOT the harmless direction: it takes the contract's circuit branch,
    derives nothing (its own result is already there), and is then reported as
    "the circuit produced no result to report" about a result sitting in front of
    it. All five were confirmed broken before this was widened.
    """
    circuit = "FINAL_CIRCUIT = build()\n"
    for label, tail in [
        ("for", "for RESULT in [1]:\n    pass"),
        ("with", "with open('x') as RESULT:\n    pass"),
        ("except", "try:\n    pass\nexcept Exception as RESULT:\n    pass"),
        ("def", "def RESULT():\n    pass"),
        ("class", "class RESULT:\n    pass"),
        ("import as", "import json as RESULT"),
        ("from import as", "from json import loads as RESULT"),
        ("comprehension", "[x for RESULT in [1]]"),
        ("starred unpack", "*RESULT, last = [1, 2, 3]"),
        ("nested unpack", "(a, (RESULT, b)) = (1, (2, 3))"),
    ]:
        assert classify_source(circuit + tail) is ProgramRole.PROGRAM, label


def test_a_mention_that_is_not_a_binding_does_not_count():
    """Reading a name is not producing one. This is the false-PROGRAM direction.

    A circuit that merely *mentions* RESULT — in a comment, a string, or a read —
    must stay a CIRCUIT, because classifying it PROGRAM sends it back into the
    rewrite loop this whole module exists to stop.
    """
    assert classify_source("FINAL_CIRCUIT = build()  # no RESULT here") is ProgramRole.CIRCUIT
    assert classify_source('FINAL_CIRCUIT = build()\nprint("RESULT")') is ProgramRole.CIRCUIT
    assert classify_source("FINAL_CIRCUIT = build()\nx = RESULT") is ProgramRole.CIRCUIT


def test_the_name_matches_the_one_the_contract_check_enforces():
    """Two constants for one literal is how they drift apart.

    `adapters._binds_final_circuit` refuses a candidate that does not bind
    FINAL_CIRCUIT. If these ever disagree, a source would satisfy the contract and
    be classified UNKNOWN, or the reverse.
    """
    from majorana_frameworks import adapters

    assert adapters._binds_final_circuit(f"{CIRCUIT_NAME} = 1")
    assert not adapters._binds_final_circuit("SOMETHING_ELSE = 1")


def test_the_program_carries_its_own_role():
    assert FrameworkProgram(Framework.QISKIT, REPOSITORY_CIRCUIT).role is ProgramRole.CIRCUIT
    assert FrameworkProgram(Framework.QISKIT, AGENT_PROGRAM).role is ProgramRole.PROGRAM


def test_derivation_is_read_from_one_place():
    assert result_was_derived({"result_origin": "derived_from_circuit"}) is True
    assert result_was_derived({"result": {"counts": {}}}) is False
    assert result_was_derived({"result_origin": "something_else"}) is False
    assert result_was_derived(None) is False
    assert result_was_derived("derived_from_circuit") is False


# --------------------------------------------------------------------------- #
# 2. The epilogue, executed
# --------------------------------------------------------------------------- #


#: Set in CI, where the SDK extras ARE installed and a skip would be a lie.
#:
#: Without this the sandbox cases below skip whenever a framework is missing —
#: and the `py` job installs `--all-packages` WITHOUT `--all-extras`, so every one
#: of them skipped there. They are the tests that actually prove lowering works;
#: skipping is the difference between a gate and a green tick. Same class as the
#: scan that scans nothing and passes.
_REQUIRE_SDKS = os.environ.get("MAJORANA_REQUIRE_SDKS") == "1"


def _installed(module: str) -> bool:
    present = importlib.util.find_spec(module) is not None
    if not present and _REQUIRE_SDKS:
        raise AssertionError(
            f"{module} is not installed but MAJORANA_REQUIRE_SDKS=1 — this suite would "
            "have skipped silently and proved nothing"
        )
    return present


def _observe(framework: Framework, source: str, *, derive: bool) -> dict:
    """Run the source in the real sandbox and return the provider-read sidecar."""
    from majorana_sandbox.base import run as run_sandbox
    from majorana_sandbox.local import LocalSubprocessSandbox
    from majorana_sandbox.spec import ExecutionSpec

    program = FrameworkProgram(framework, source)
    spec = ExecutionSpec(
        code=program.normalized_source,
        trusted_setup=program.trusted_setup(circuit_expected=True),
        trusted_observer=program.trusted_observer(circuit_expected=True, derive_result=derive),
        protected_result_path="/tmp/majorana_roles_test_result.json",
        source_fingerprint=program.fingerprint,
    )
    result = asyncio.run(run_sandbox(LocalSubprocessSandbox(), spec))
    assert result.ok, f"sandbox failed: {result.stderr[-500:]}"
    return result.protected_result or {}


CIRQ_CIRCUIT = """import cirq

q0, q1 = cirq.LineQubit.range(2)
FINAL_CIRCUIT = cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1), cirq.measure(q0, q1, key="m")])
"""

PENNYLANE_CIRCUIT = """import pennylane as qml

dev = qml.device("default.qubit", wires=2)


@qml.qnode(dev)
def circuit():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    return qml.counts()


FINAL_CIRCUIT = circuit
"""

BRAKET_CIRCUIT = """from braket.circuits import Circuit

FINAL_CIRCUIT = Circuit().h(0).cnot(0, 1).measure([0, 1])
"""

SANDBOX_CASES = [
    pytest.param(Framework.QISKIT, REPOSITORY_CIRCUIT, "qiskit", id="qiskit"),
    pytest.param(Framework.CIRQ, CIRQ_CIRCUIT, "cirq", id="cirq"),
    pytest.param(Framework.PENNYLANE, PENNYLANE_CIRCUIT, "pennylane", id="pennylane"),
    pytest.param(Framework.BRAKET, BRAKET_CIRCUIT, "braket", id="braket"),
]


@pytest.mark.parametrize(("framework", "source", "module"), SANDBOX_CASES)
def test_a_measured_circuit_gains_a_result_in_every_framework(framework, source, module):
    """The feature, end to end, through the real sandbox.

    One block covers every registered framework because it reads only the observation
    dict, which each adapter's native evidence fills in the same shape. That is
    the claim, so it is tested per framework rather than once on Qiskit.
    """
    if not _installed(module):
        pytest.skip(f"{module} is not installed")

    plain = _observe(framework, source, derive=False)
    assert "result" not in plain, "a circuit reports nothing — that is the whole problem"

    derived = _observe(framework, source, derive=True)
    assert result_was_derived(derived)
    assert derived["result_evidence"] == "native_sampled"
    counts = derived["result"]["counts"]
    # A Bell circuit: only the correlated outcomes, and every shot accounted for.
    assert set(counts) == {"00", "11"}
    assert sum(counts.values()) == derived["result"]["shots"]


def test_an_unmeasured_circuit_falls_back_to_its_statevector():
    """Publishing a circuit with no measurements is legitimate and unsampleable."""
    if not _installed("qiskit"):
        pytest.skip("qiskit is not installed")
    source = """from qiskit import QuantumCircuit

FINAL_CIRCUIT = QuantumCircuit(2)
FINAL_CIRCUIT.h(0)
FINAL_CIRCUIT.cx(0, 1)
"""
    derived = _observe(Framework.QISKIT, source, derive=True)
    assert result_was_derived(derived)
    assert derived["result_evidence"] == "native_statevector"
    assert derived["result"]["qubits"] == 2
    # Four complex amplitudes, flattened to re/im pairs.
    assert len(derived["result"]["statevector"]) == 8


def test_lowering_never_overwrites_a_result_the_program_computed():
    """The property that makes it safe to enable unconditionally.

    A program that bound RESULT reported a finding. Replacing it with the
    sampler's own answer would delete that finding and substitute a tautology —
    and would do it invisibly, because the substitute looks like a plausible
    result. The seed is fixed so the two runs are comparable at all.
    """
    if not _installed("qiskit"):
        pytest.skip("qiskit is not installed")
    seeded = AGENT_PROGRAM.replace("shots=1024", "shots=1024, seed_simulator=99")
    plain = _observe(Framework.QISKIT, seeded, derive=False)
    derived = _observe(Framework.QISKIT, seeded, derive=True)

    assert result_was_derived(derived) is False
    assert derived["result"] == plain["result"]
    assert "result_evidence" not in derived


def test_a_circuit_with_no_trusted_evidence_says_so_instead_of_inventing_one():
    """Past the statevector ceiling and unmeasured: nothing to derive, and it is named.

    The failure that matters is the silent one — a derivation that quietly
    produces nothing looks identical to a source that was never lowered.
    """
    if not _installed("qiskit"):
        pytest.skip("qiskit is not installed")
    source = """from qiskit import QuantumCircuit

FINAL_CIRCUIT = QuantumCircuit(16)
for q in range(16):
    FINAL_CIRCUIT.h(q)
"""
    derived = _observe(Framework.QISKIT, source, derive=True)
    assert "result" not in derived
    assert result_was_derived(derived) is False
    # BOTH reasons. This circuit is unsampleable (no measurements) and too wide
    # for the statevector, and a reader told only one of those would fix half a
    # problem and hit the other.
    reason = derived["result_derivation_error"]
    assert "no measurements to sample" in reason
    assert "statevector limit" in reason


def test_the_epilogue_is_not_emitted_without_an_observer_to_append_to():
    """`circuit_expected=False` means no evidence is collected at all.

    A lone derivation block would then reference an observation nothing filled.
    """
    for framework in Framework:
        program = FrameworkProgram(framework, "x = 1")
        assert program.trusted_observer(circuit_expected=False, derive_result=True) == ""


def test_every_adapter_binds_the_tape_helper_its_observer_references():
    """The dead branch must not be a NameError waiting for a framework change.

    The base observer's tape branch is emitted for every framework and reached
    only by PennyLane. If a future edit made Cirq fall into it, an unbound
    `_majorana_construct_tape` would surface as `resource_metrics_error` on a
    framework that has nothing to do with tapes.
    """
    for framework in Framework:
        adapter = adapter_for(framework)
        observer = adapter.trusted_observer("FINAL_CIRCUIT = 1", circuit_expected=True)
        setup = adapter.trusted_setup(circuit_expected=True)
        if "_majorana_construct_tape" in observer:
            assert "_majorana_construct_tape" in setup, framework.value


def test_the_epilogue_uses_only_pre_bound_builtins():
    """The shadowing defence, enforced rather than remembered.

    The epilogue runs AFTER untrusted code, inside a function, so a bare builtin
    resolves through normal scoping — and `import builtins` is not on the guard's
    denied list, so generated code can replace one. Every other epilogue in
    `adapters.py` snapshots the builtins it uses; this one drifted to a bare
    `isinstance` and nothing noticed, because it works perfectly until somebody
    attacks it.

    Checked by name against what `compose_execution` actually binds, so adding a
    new builtin to the epilogue without binding it fails here rather than in
    production.
    """
    import ast
    import re

    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    from majorana_frameworks.roles import DERIVE_RESULT_FROM_CIRCUIT

    composed = compose_execution(
        ExecutionSpec(code="pass", trusted_observer="pass", protected_result_path="/tmp/x.json")
    )
    bound = set(re.findall(r"(_majorana_\w+) = _majorana_builtins\.\w+", composed))
    bound.add("_majorana_builtins")

    tree = ast.parse(DERIVE_RESULT_FROM_CIRCUIT)
    assigned = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
    }
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    unbound = {name for name in called if name not in bound and name not in assigned}
    assert not unbound, f"epilogue calls unbound builtin(s): {sorted(unbound)}"

    # Positive control: the extraction found real bindings, so an empty `bound`
    # cannot make this pass vacuously.
    assert "_majorana_isinstance" in bound
    assert len(bound) >= 8
