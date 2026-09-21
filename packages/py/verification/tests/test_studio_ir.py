import pytest

from majorana_contracts import CircuitOptimizationOperation as Op
from majorana_verification import equivalent_operations
from majorana_verification.studio_ir import SYNTHESIS_EQUIVALENCE_MAX_QUBITS, _studio_circuit


def _op(gate: str, qubits: list[int], angle: float | None = None) -> Op:
    return Op(gate=gate, qubits=qubits, angle_radians=angle)


BELL = [_op("H", [0]), _op("CX", [0, 1])]


def test_identical_circuits_are_equivalent():
    report = equivalent_operations(2, BELL, list(BELL))

    assert report.checked
    assert report.equivalent
    assert report.method == "exact_unitary_statevector"
    assert report.width_limit == SYNTHESIS_EQUIVALENCE_MAX_QUBITS


def test_gate_reordering_that_preserves_the_unitary_is_equivalent():
    # H(0), CX(0,1), then a global-phase-only pair (Z then Z cancels) -- a
    # rewrite a real compiler could plausibly produce.
    candidate = [*BELL, _op("Z", [0]), _op("Z", [0])]

    report = equivalent_operations(2, BELL, candidate)

    assert report.checked
    assert report.equivalent


def test_a_dropped_gate_is_caught_not_equivalent():
    """The negative control this feature exists for: a compiler that drops a
    gate must never be reported as equivalent. Mirrors the TKET issue this
    project's own research found — an optimisation pass claiming equivalence
    it did not have."""

    candidate = [BELL[0]]  # CX(0,1) silently dropped

    report = equivalent_operations(2, BELL, candidate)

    assert report.checked
    assert report.equivalent is False
    assert "NOT equivalent" in report.detail


def test_a_wrong_rotation_angle_is_caught_not_equivalent():
    reference = [_op("RX", [0], 0.5)]
    candidate = [_op("RX", [0], 0.6)]

    report = equivalent_operations(1, reference, candidate)

    assert report.checked
    assert report.equivalent is False


def test_terminal_measurements_are_stripped_before_comparison():
    reference = [*BELL, _op("M", [0]), _op("M", [1])]
    candidate = [*BELL, _op("M", [0]), _op("M", [1])]

    report = equivalent_operations(2, reference, candidate)

    assert report.checked
    assert report.equivalent


def test_above_the_width_limit_reports_not_checked_rather_than_raising():
    wide = [_op("H", [i]) for i in range(SYNTHESIS_EQUIVALENCE_MAX_QUBITS + 1)]

    report = equivalent_operations(
        SYNTHESIS_EQUIVALENCE_MAX_QUBITS + 1,
        wide,
        list(wide),
        max_qubits=SYNTHESIS_EQUIVALENCE_MAX_QUBITS,
    )

    assert report.checked is False
    assert report.equivalent is None
    assert "not checked (too wide)" in report.detail
    assert str(SYNTHESIS_EQUIVALENCE_MAX_QUBITS) in report.detail


@pytest.mark.parametrize(
    "gate,angle",
    [
        ("H", None),
        ("X", None),
        ("Y", None),
        ("Z", None),
        ("S", None),
        ("T", None),
        ("RX", 0.3),
        ("RY", 0.3),
        ("RZ", 0.3),
    ],
)
def test_every_one_qubit_gate_builds_and_self_checks(gate, angle):
    circuit = [_op(gate, [0], angle)]
    report = equivalent_operations(1, circuit, list(circuit))
    assert report.checked and report.equivalent


@pytest.mark.parametrize("gate", ["CX", "CZ", "SWAP"])
def test_every_two_qubit_gate_builds_and_self_checks(gate):
    circuit = [_op(gate, [0, 1])]
    report = equivalent_operations(2, circuit, list(circuit))
    assert report.checked and report.equivalent


def test_studio_circuit_drops_operations_after_a_terminal_measurement_only():
    circuit = _studio_circuit(2, [*BELL, _op("M", [0])])
    assert circuit.num_qubits == 2
    assert circuit.size() == 2  # H, CX — the measurement is not a unitary op
