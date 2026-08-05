"""R1 — how big a published circuit is, and what makes that answer trustworthy.

The counting itself is arithmetic and could be asserted against itself all day
without proving anything. So the load-bearing test here is
`test_the_portable_reading_agrees_with_qiskit_on_every_corpus_circuit`, which
builds the same circuit in Qiskit and compares against `resource_metrics` — the
implementation this one mirrors, on circuits that are actually published. The
rest pin the two conventions that test would let slide if both sides were wrong
together (the width rule, the measurement layer) and the refusals, which no
agreement test can reach because a malformed record has no Qiskit counterpart.
"""

import json
import pathlib

import pytest
from majorana_openqasm import (
    PORTABLE_GATES,
    MalformedPortableCircuit,
    portable_circuit_cost,
    portable_circuit_metrics,
    read_portable_circuit,
)
from majorana_openqasm.program import _resource_metrics
from qiskit import QuantumCircuit

_MANIFEST = (
    pathlib.Path(__file__).resolve().parents[4] / "services/api/catalog_bootstrap/manifest.json"
)

#: Portable gate name -> the Qiskit method that builds it. Test-only, and
#: deliberately explicit rather than `getattr(circuit, name)`: the point of the
#: cross-check is that an independent implementation was consulted, and deriving
#: the reference from the same string the code under test uses would weaken it.
_QISKIT_GATES = {
    "h": "h", "x": "x", "y": "y", "z": "z", "s": "s", "t": "t",
    "rx": "rx", "ry": "ry", "rz": "rz", "cx": "cx", "cz": "cz", "swap": "swap",
}  # fmt: skip
_PARAMETERISED = {"rx", "ry", "rz"}


def _step(gate: str, *qubits: int, param: str | None = None) -> dict:
    step: dict = {"gate": gate, "qubits": list(qubits)}
    if param is not None:
        step["param"] = param
    return step


def _circuit(*steps: dict, qubits: int = 2, measure: bool = False) -> dict:
    return {"qubitCount": qubits, "steps": list(steps), "measure": measure}


def _to_qiskit(portable: dict) -> QuantumCircuit | None:
    """Build the Qiskit circuit the portable record describes, or None.

    None when a step falls outside the portable vocabulary — there is no
    reference to compare against then, and the corpus test reports it rather
    than skipping quietly.
    """
    program = read_portable_circuit(portable)
    circuit = QuantumCircuit(program.width)
    for name, qubits, params in program.stream:
        method = _QISKIT_GATES.get(name)
        if method is None:
            return None
        if name in _PARAMETERISED:
            # The angle does not affect any of the five metrics; a placeholder
            # keeps the reference buildable for symbolic corpus angles like
            # `pi/8`, which Qiskit's float constructor will not take.
            getattr(circuit, method)(0.5, *qubits)
        else:
            getattr(circuit, method)(*qubits)
    if program.measures_all:
        circuit.measure_all()
    return circuit


def _corpus_circuits() -> list[tuple[str, dict]]:
    if not _MANIFEST.exists():
        pytest.skip(f"pinned catalog manifest not present at {_MANIFEST}")
    manifest = json.loads(_MANIFEST.read_text())
    out = []
    for item in manifest.get("items", []):
        if item.get("source_blob_encoding") != "canonical-json-utf8":
            continue
        record = json.loads(item["source_blob"])
        if not isinstance(record, dict):
            continue
        portable = record.get("portableCircuit")
        if isinstance(portable, dict):
            out.append((str(record.get("slug", "?")), portable))
    return out


# --- The cross-check ----------------------------------------------------------


def test_the_portable_reading_agrees_with_qiskit_on_every_corpus_circuit():
    """The five numbers, over every published circuit, against the reference.

    `resource_metrics` is what this stack already says these words mean for a
    parsed program. If the portable path disagreed with it, one of the two would
    be printing the wrong thing on a page that shows both a circuit and its size
    — and there would be no way to tell which from inside either one.
    """
    circuits = _corpus_circuits()
    assert circuits, "no published entry carried a portable circuit"

    disagreements = []
    for slug, portable in circuits:
        reference = _to_qiskit(portable)
        assert reference is not None, f"{slug}: step outside the portable vocabulary"
        expected = _resource_metrics(reference)
        actual = portable_circuit_metrics(portable)
        if (
            actual.qubits,
            actual.depth,
            actual.gate_count,
            actual.two_qubit_gate_count,
            actual.measurement_count,
        ) != (
            expected.qubits,
            expected.depth,
            expected.gate_count,
            expected.two_qubit_gate_count,
            expected.measurement_count,
        ):
            disagreements.append(f"{slug}: portable={actual} qiskit={expected}")

    assert not disagreements, "portable and Qiskit readings differ:\n" + "\n".join(disagreements)


def test_the_published_corpus_stays_inside_the_closed_gate_vocabulary():
    """`gate_count` reads the step list's length, which is only "how many gates"
    while every step is a gate. `PORTABLE_GATES` states that; this holds the
    corpus to it, so a thirteenth name arrives as a failure rather than as a
    silently miscounted entry."""
    outside = {
        f"{slug}: {name}"
        for slug, portable in _corpus_circuits()
        for name, _qubits, _params in read_portable_circuit(portable).stream
        if name not in PORTABLE_GATES
    }

    assert not outside, "steps outside the portable vocabulary:\n" + "\n".join(sorted(outside))


# --- The two conventions the cross-check could get wrong on both sides --------


def test_depth_is_the_longest_serial_run_not_the_gate_count():
    """Four gates on two disjoint pairs is depth two, not four."""
    metrics = portable_circuit_metrics(
        _circuit(
            _step("h", 0),
            _step("h", 2),
            _step("cx", 0, 1),
            _step("cx", 2, 3),
            qubits=4,
        )  # fmt: skip
    )

    assert metrics.gate_count == 4
    assert metrics.depth == 2
    assert metrics.two_qubit_gate_count == 2


def test_the_terminal_measurement_is_one_layer_over_every_qubit():
    """`measure` is all-or-nothing in this model, so it costs one layer and
    counts once per qubit — the same thing `measure_all` costs in Qiskit."""
    unmeasured = portable_circuit_metrics(_circuit(_step("h", 0), qubits=3))
    measured = portable_circuit_metrics(_circuit(_step("h", 0), qubits=3, measure=True))

    assert unmeasured.measurement_count == 0
    assert measured.measurement_count == 3
    assert measured.depth == unmeasured.depth + 1
    # A measurement is not a gate on either side of the comparison.
    assert measured.gate_count == unmeasured.gate_count == 1


def test_a_measurement_only_circuit_still_has_a_layer():
    metrics = portable_circuit_metrics(_circuit(qubits=2, measure=True))

    assert metrics.gate_count == 0
    assert metrics.depth == 1
    assert metrics.measurement_count == 2


# --- The width rule, which both readings must take together -------------------


def test_a_declared_width_narrower_than_the_steps_loses_to_the_steps():
    """The record says two qubits and the circuit addresses five. Trusting the
    declaration would publish a five-qubit circuit as a two-qubit one."""
    narrow = _circuit(_step("cx", 0, 4), qubits=2)

    assert portable_circuit_metrics(narrow).qubits == 5


def test_the_profile_and_the_cost_never_disagree_about_width():
    """The reason the reading was extracted. These two numbers are rendered on
    the same page for the same entry, so a difference here is one a visitor sees.
    """
    for portable in (
        _circuit(_step("cx", 0, 4), qubits=2),
        _circuit(_step("h", 0), qubits=9),
        _circuit(_step("t", 0), _step("cz", 1, 2), qubits=0),
        *(portable for _slug, portable in _corpus_circuits()),
    ):
        assert (
            portable_circuit_metrics(portable).qubits
            == portable_circuit_cost(portable).logical_qubits
        )


def test_an_empty_circuit_is_one_qubit_wide_not_zero():
    """Matches the cost path's floor. A zero-width circuit is not a thing the
    estimator can cost, and reporting one would put a 0 in a size column."""
    metrics = portable_circuit_metrics(_circuit(qubits=0))

    assert metrics.qubits == 1
    assert metrics.depth == 0
    assert metrics.gate_count == 0


# --- Refusals: a shape that cannot be read must not read as an empty circuit --


def test_a_circuit_this_module_cannot_read_refuses_rather_than_measuring_zero():
    for broken, why in (
        ({"steps": "h q[0]"}, "steps is a string"),
        ({"steps": [["h", 0]]}, "step is not an object"),
        ({"steps": [{"gate": "h", "qubits": "0"}]}, "qubits is a string"),
        ({"steps": [{"gate": "h", "qubits": [None]}]}, "qubit is not an integer"),
        ({"steps": [{"gate": "h", "qubits": [-1]}]}, "qubit index is negative"),
    ):
        with pytest.raises(MalformedPortableCircuit):
            portable_circuit_metrics(broken)


def test_a_falsy_value_where_a_list_belongs_is_not_an_empty_list():
    """`portable.get("steps") or ()` read `steps: 0` as an empty circuit — a
    malformed record arriving as a legitimate zero-gate measurement rather than
    as a refusal, which is the exact failure this module claims to prevent.
    A *missing* key stays a real shape."""
    for broken in ({"qubitCount": 2, "steps": 0}, {"qubitCount": 2, "steps": False}):
        with pytest.raises(MalformedPortableCircuit):
            portable_circuit_metrics(broken)
    for broken in (
        {"qubitCount": 2, "steps": [{"gate": "h", "qubits": 0}]},
        {"qubitCount": 2, "steps": [{"gate": "h", "qubits": False}]},
    ):
        with pytest.raises(MalformedPortableCircuit):
            portable_circuit_metrics(broken)

    # Absent, rather than present-and-falsy, is still a circuit with no steps.
    assert portable_circuit_metrics({"qubitCount": 2}).gate_count == 0
    assert portable_circuit_metrics({"qubitCount": 2, "steps": None}).gate_count == 0


def test_a_fractional_index_is_refused_rather_than_truncated():
    """`int()` truncates: index 1.9 became 1 and `qubitCount` 2.9 became 2, both
    silently and both successfully. A fractional qubit index is not a near-miss
    to round toward — it is evidence the producer is not the one this module was
    written against — and the truncated reading is the dangerous one because it
    returns a number."""
    with pytest.raises(MalformedPortableCircuit):
        portable_circuit_metrics({"qubitCount": 2, "steps": [{"gate": "h", "qubits": [1.9]}]})
    with pytest.raises(MalformedPortableCircuit):
        portable_circuit_metrics({"qubitCount": 2.9, "steps": []})
    with pytest.raises(MalformedPortableCircuit):
        portable_circuit_metrics({"qubitCount": True, "steps": []})

    # A float that IS whole is a JSON integer with a decimal point on it.
    assert portable_circuit_metrics({"qubitCount": 4.0, "steps": []}).qubits == 4
    assert (
        portable_circuit_metrics(
            {"qubitCount": 2, "steps": [{"gate": "cx", "qubits": [0, 1.0]}]}
        ).two_qubit_gate_count
        == 1
    )


def test_a_negative_index_is_refused_by_the_cost_path_too():
    """It reached the cost path before the shared reader existed, where it did
    two quiet kinds of damage at once: it never raised the high-water mark, so
    the circuit costed narrower than it is, and it opened an entry in the depth
    map no real qubit shares a layer with."""
    with pytest.raises(ValueError):
        portable_circuit_cost({"qubitCount": 2, "steps": [{"gate": "t", "qubits": [-1]}]})


def test_a_gate_nobody_can_name_is_still_measured():
    """The difference from the cost path, and the reason this module does not
    import the poison rule. An unnameable operation makes a *magic-state cost*
    not exist; it does not make "how many steps are there" not exist."""
    mystery = _circuit(_step("h", 0), _step("mystery", 0, 1), qubits=2)

    metrics = portable_circuit_metrics(mystery)

    assert metrics.gate_count == 2
    assert metrics.two_qubit_gate_count == 1
    assert metrics.depth == 2
    # ...while the cost of the same circuit is refused.
    assert not portable_circuit_cost(mystery).exact
