"""E1 — the magic-state cost of a circuit, and the cases where it does not exist.

Every count below is asserted against a circuit whose T-count is derivable by
hand from the source, not against whatever the implementation happens to
return. The refusal tests matter more than the counting ones: a wrong count is
visible, a silently-zero count is not.
"""

import math

import pytest
from majorana_openqasm import (
    InexactCostError,
    non_clifford_cost,
    portable_circuit_cost,
)
from majorana_openqasm.non_clifford import non_clifford_cost as cost_of_circuit
from qiskit import QuantumCircuit, QuantumRegister
from qiskit.circuit import Parameter


def _qasm(body: str, qubits: int = 3) -> str:
    return f'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[{qubits}] q;\n{body}'


def test_a_clifford_circuit_consumes_no_magic_states():
    cost = non_clifford_cost(_qasm("h q[0];\ncx q[0], q[1];\ns q[1];\n"))

    assert cost.t_count == 0
    assert cost.toffoli_count == 0
    assert cost.is_clifford_only
    assert cost.exact
    # The invariant LogicalCost enforces: no magic states means no chain to
    # have a depth. A non-zero value here would make LogicalCost raise.
    assert cost.non_clifford_depth == 0


def test_t_gates_are_counted_and_tdg_counts_the_same():
    cost = non_clifford_cost(_qasm("t q[0];\ntdg q[1];\nt q[2];\n"))

    assert cost.t_count == 3
    assert cost.exact


def test_a_toffoli_stays_one_toffoli_rather_than_its_definition():
    """ccx's Qiskit definition holds 7 T gates; expanding it here would both
    double-count against `toffoli_count` and hard-code the 7-T convention that
    `LogicalCost.magic_states(t_per_toffoli=...)` exists to keep configurable."""
    cost = non_clifford_cost(_qasm("ccx q[0], q[1], q[2];\n"))

    assert cost.toffoli_count == 1
    assert cost.t_count == 0
    assert cost.exact


def test_a_rotation_by_a_multiple_of_half_pi_is_clifford():
    cost = non_clifford_cost(_qasm(f"rz({math.pi / 2}) q[0];\nrz({math.pi}) q[1];\n"))

    assert cost.t_count == 0
    assert cost.synthesis_required == 0
    assert cost.exact


def test_a_rotation_by_an_odd_multiple_of_quarter_pi_is_exactly_one_t():
    cost = non_clifford_cost(_qasm(f"rz({math.pi / 4}) q[0];\nrz({3 * math.pi / 4}) q[1];\n"))

    assert cost.t_count == 2
    assert cost.exact


def test_an_arbitrary_angle_rotation_refuses_rather_than_scoring_zero():
    """The defect this module exists to prevent. rz(0.3) has no T-count until a
    synthesis precision is named, and the cost then scales with log2(1/eps)."""
    cost = non_clifford_cost(_qasm("rz(0.3) q[0];\n"))

    assert cost.synthesis_required == 1
    assert cost.t_count == 0
    assert not cost.exact
    assert "synthesis precision" in cost.why_not_exact()
    assert "rz" in cost.why_not_exact()

    with pytest.raises(InexactCostError):
        cost.logical_cost()


def test_an_unbound_parameter_is_no_angle_rather_than_a_small_one():
    circuit = QuantumCircuit(1)
    circuit.rz(Parameter("theta"), 0)

    cost = cost_of_circuit(circuit)

    assert cost.synthesis_required == 1
    assert not cost.exact


def test_an_unrecognised_operation_poisons_the_whole_cost_and_is_named():
    circuit = QuantumCircuit(2)
    circuit.h(0)
    circuit.unitary([[0, 1], [1, 0]], [1], label="mystery")

    cost = cost_of_circuit(circuit)

    assert not cost.exact
    assert cost.unsupported, "an unclassifiable operation must be reported"
    assert cost.why_not_exact()
    with pytest.raises(InexactCostError):
        cost.logical_cost()


def test_depth_is_the_serial_chain_not_the_total_count():
    """Three T gates on three separate qubits are simultaneous, not sequential.
    Reporting 3 here would inflate the reaction-limited runtime threefold."""
    parallel = non_clifford_cost(_qasm("t q[0];\nt q[1];\nt q[2];\n", qubits=3))
    serial = non_clifford_cost(_qasm("t q[0];\nt q[0];\nt q[0];\n", qubits=3))

    assert parallel.t_count == serial.t_count == 3
    assert parallel.non_clifford_depth == 1
    assert serial.non_clifford_depth == 3


def test_clifford_gates_do_not_extend_the_non_clifford_chain():
    cost = non_clifford_cost(_qasm("t q[0];\nh q[0];\nh q[0];\nt q[0];\n"))

    assert cost.t_count == 2
    assert cost.non_clifford_depth == 2
    assert cost.clifford_count == 2


def test_a_two_qubit_non_clifford_joins_two_chains():
    cost = non_clifford_cost(_qasm("t q[0];\nt q[1];\nccx q[0], q[1], q[2];\n"))

    assert cost.t_count == 2
    assert cost.toffoli_count == 1
    # Both T gates are layer 1; the Toffoli waits on both, so it is layer 2.
    assert cost.non_clifford_depth == 2


def test_a_composite_gate_costs_the_same_as_the_circuit_it_expands_to():
    """A circuit built from a library gate must not look cheaper than the same
    circuit written out, or the cost depends on how the author phrased it."""
    inner = QuantumCircuit(2, name="block")
    inner.t(0)
    inner.cx(0, 1)
    inner.t(1)

    composed = QuantumCircuit(2)
    composed.append(inner.to_gate(), [0, 1])

    written_out = QuantumCircuit(2)
    written_out.t(0)
    written_out.cx(0, 1)
    written_out.t(1)

    assert cost_of_circuit(composed).t_count == cost_of_circuit(written_out).t_count == 2
    assert cost_of_circuit(composed).exact


def test_an_exact_cost_converts_to_a_logical_cost_the_estimator_accepts():
    cost = non_clifford_cost(_qasm("ccx q[0], q[1], q[2];\nt q[0];\n"))
    logical = cost.logical_cost(label="test")

    assert logical.logical_qubits == 3
    assert logical.toffoli_count == 1
    assert logical.t_count == 1
    assert logical.label == "test"
    # The convention stays the caller's to state, which is the point of
    # counting Toffolis separately from T gates.
    assert logical.magic_states(t_per_toffoli=4) == 5
    assert logical.magic_states(t_per_toffoli=7) == 8


def test_the_width_is_ancilla_inclusive():
    """LogicalCost.logical_qubits is documented as including ancillas; the
    register width alone would understate the patch count the estimator lays out."""
    circuit = QuantumCircuit(2)
    circuit.add_register(QuantumRegister(3, "anc"))
    circuit.t(0)

    assert cost_of_circuit(circuit).logical_qubits == 5


def test_measurements_and_barriers_do_not_consume_magic_states():
    cost = non_clifford_cost(
        'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\n'
        "t q[0];\nbarrier q;\nc[0] = measure q[0];\n"
    )

    assert cost.t_count == 1
    assert cost.non_clifford_depth == 1
    assert cost.exact


# --- The published corpus's own format (E1 -> E4) -----------------------------
#
# The 120 entries with a `portableCircuit` write angles symbolically. Every
# expression asserted below is one that actually appears in
# services/api/catalog_bootstrap/manifest.json.


@pytest.mark.parametrize(
    ("expression", "expected_t", "expected_synthesis"),
    [
        ("pi/4", 1, 0),  # odd multiple of pi/4 -> exactly one T
        ("2*pi/8", 1, 0),  # the same angle, written the way the corpus writes it
        ("6*pi/8", 1, 0),  # 3pi/4, still an odd quarter
        ("4*pi/8", 0, 0),  # pi/2 -> Clifford, costs nothing
        ("pi/8", 0, 1),  # half a quarter -> no T-count exists
        ("3*pi/8", 0, 1),
        ("-pi/4", 1, 0),
        ("pi", 0, 0),
    ],
)
def test_the_corpus_angle_expressions_are_read_not_discarded(
    expression, expected_t, expected_synthesis
):
    """A float() on 'pi/8' returns nothing. If that were the whole parser every
    corpus rotation would fall to 'needs synthesis' — which looks like a careful
    refusal and is actually a parser that never read the angle."""
    cost = portable_circuit_cost(
        {"qubitCount": 1, "steps": [{"gate": "RZ", "qubits": [0], "param": expression}]}
    )

    assert cost.t_count == expected_t
    assert cost.synthesis_required == expected_synthesis


def test_an_unparseable_angle_expression_still_refuses():
    cost = portable_circuit_cost(
        {"qubitCount": 1, "steps": [{"gate": "RZ", "qubits": [0], "param": "theta/2"}]}
    )

    assert cost.synthesis_required == 1
    assert not cost.exact


def test_the_corpus_gate_vocabulary_is_fully_classified():
    """All nine gates the corpus uses, in one circuit. An unrecognised name here
    would poison every entry that contains it, so this pins the vocabulary."""
    steps = [
        {"gate": "H", "qubits": [0]},
        {"gate": "X", "qubits": [0]},
        {"gate": "S", "qubits": [0]},
        {"gate": "CX", "qubits": [0, 1]},
        {"gate": "CZ", "qubits": [0, 1]},
        {"gate": "SWAP", "qubits": [0, 1]},
        {"gate": "RZ", "qubits": [0], "param": "pi/4"},
        {"gate": "RY", "qubits": [1], "param": "pi/4"},
        {"gate": "RX", "qubits": [0], "param": "pi/4"},
    ]
    cost = portable_circuit_cost({"qubitCount": 2, "steps": steps})

    assert cost.unsupported == ()
    assert cost.exact
    assert cost.t_count == 3


def test_a_width_narrower_than_the_indices_used_does_not_understate_the_circuit():
    cost = portable_circuit_cost({"qubitCount": 1, "steps": [{"gate": "CX", "qubits": [0, 4]}]})

    assert cost.logical_qubits == 5


# --- Synthesis: the convention that makes an arbitrary rotation countable -----


def test_a_stated_synthesis_convention_converts_rotations_into_a_t_count():
    cost = portable_circuit_cost(
        {
            "qubitCount": 1,
            "steps": [
                {"gate": "RZ", "qubits": [0], "param": "pi/8"},
                {"gate": "RZ", "qubits": [0], "param": "pi/4"},
            ],
        }
    )
    assert cost.synthesis_required == 1 and cost.t_count == 1

    logical = cost.logical_cost(t_per_rotation=50)

    # The exactly-counted T survives alongside the synthesised ones rather than
    # being replaced by them.
    assert logical.t_count == 1 + 50


def test_no_synthesis_convention_still_refuses():
    cost = portable_circuit_cost(
        {"qubitCount": 1, "steps": [{"gate": "RZ", "qubits": [0], "param": "pi/8"}]}
    )

    with pytest.raises(InexactCostError):
        cost.logical_cost()


def test_a_synthesis_convention_cannot_rescue_an_unnamed_operation():
    """An unrecognised gate is a gap in the vocabulary, not an approximation
    budget. No epsilon makes it cost something knowable."""
    circuit = QuantumCircuit(1)
    circuit.unitary([[0, 1], [1, 0]], [0], label="mystery")

    with pytest.raises(InexactCostError):
        cost_of_circuit(circuit).logical_cost(t_per_rotation=50)


# --- Review findings from #248, each pinned by the case that exposed it -------


def test_a_circuit_of_arbitrary_rotations_is_not_reported_as_clifford_only():
    """`is_clifford_only` once read the two counts alone. A single rz(0.3) has
    both at zero while costing an unknown number of magic states, so a caller
    rendering "no magic states" from it called an unknown circuit free."""
    cost = portable_circuit_cost(
        {"qubitCount": 1, "steps": [{"gate": "RZ", "qubits": [0], "param": "0.3"}]}
    )

    assert cost.t_count == 0 and cost.toffoli_count == 0
    assert cost.synthesis_required == 1
    assert not cost.is_clifford_only
    assert not cost.exact


def test_a_genuinely_clifford_circuit_is_still_reported_as_one():
    cost = portable_circuit_cost(
        {"qubitCount": 2, "steps": [{"gate": "H", "qubits": [0]}, {"gate": "CX", "qubits": [0, 1]}]}
    )

    assert cost.is_clifford_only
    assert cost.exact


@pytest.mark.parametrize("param", ["nan", "inf", "-inf", float("nan"), float("inf")])
def test_a_non_finite_angle_is_no_angle_rather_than_a_crash(param):
    """float() accepts "nan"/"inf". Left through, they reach round() in the
    classifier and raise ValueError/OverflowError — not the InexactCostError a
    caller is prepared for."""
    cost = portable_circuit_cost(
        {"qubitCount": 1, "steps": [{"gate": "RZ", "qubits": [0], "param": param}]}
    )

    assert cost.synthesis_required == 1
    assert not cost.exact
