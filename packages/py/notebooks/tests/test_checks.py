"""Check cells: the expression evaluator, each kind's verdict and diagnosis, the
inconclusive cases, mutation-tested teeth, authorship, and the two round trips.

Every circuit here is built with Qiskit and captured the way the sandbox captures it
(`qiskit.qasm3.dumps`), so the worker-side parse is exercised on the same text it will
see in production.
"""

from __future__ import annotations

import builtins
import math
import time

import pytest
from qiskit import QuantumCircuit
from qiskit.circuit.library import QFTGate
from qiskit.quantum_info import SparsePauliOp, Statevector

from leona_notebooks import checks
from leona_notebooks.checks import (
    MAX_MUTANTS,
    CheckCapture,
    ExpressionError,
    apply_check_verdicts,
    check_comment,
    enforce_check_authorship,
    evaluate_check,
    evaluate_expression,
    mutants,
    restore_checks,
)
from leona_notebooks.execution import CellError, CellResult, ExecutionReport
from leona_notebooks.ipynb import from_ipynb, to_ipynb
from leona_notebooks.source import parse_source, render_source
from leona_notebooks.spec import Cell, NotebookSpec
from majorana_contracts.notebooks import CheckProperty


def _circuit(capture_of: QuantumCircuit) -> CheckCapture:
    return CheckCapture.from_circuit(capture_of)


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    return qc


def _ghz(n: int) -> QuantumCircuit:
    qc = QuantumCircuit(n)
    qc.h(0)
    for target in range(1, n):
        qc.cx(0, target)
    return qc


def _qft(n: int, *, inverse: bool = False) -> QuantumCircuit:
    qc = QuantumCircuit(n)
    gate = QFTGate(n)
    qc.append(gate.inverse() if inverse else gate, range(n))
    return qc


def _prop(**fields) -> CheckProperty:
    return CheckProperty.model_validate(fields)


# --------------------------------------------------------------------------- expressions


def test_expressions_evaluate_the_allowlisted_forms() -> None:
    assert evaluate_expression("1/sqrt(2)") == pytest.approx(1 / math.sqrt(2))
    assert evaluate_expression("exp(i*pi/4)/sqrt(2)") == pytest.approx(complex(0.5, 0.5), abs=1e-12)
    assert evaluate_expression("-j/2") == pytest.approx(-0.5j)
    assert evaluate_expression("cos(pi/8)**2") == pytest.approx(math.cos(math.pi / 8) ** 2)
    assert evaluate_expression("e") == pytest.approx(math.e)
    assert evaluate_expression(0.25) == 0.25


@pytest.mark.parametrize(
    "text",
    [
        "__import__('os').system('true')",
        "(1).__class__",
        "open('/etc/passwd')",
        "abs(-1)",
        "sqrt(x=2)",
        "sqrt(2, 3)",
        "[1][0]",
        "lambda: 1",
        "1 if 1 else 2",
        "1 < 2",
        "x",
        "True",
        "'a'",
        "sqrt(2)(3)",
    ],
)
def test_the_evaluator_refuses_everything_outside_the_allowlist(text: str) -> None:
    with pytest.raises(ExpressionError):
        evaluate_expression(text)


def test_the_evaluator_never_calls_eval(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args, **_kwargs):
        raise AssertionError("eval/exec must never be called")

    monkeypatch.setattr(builtins, "eval", forbidden)
    monkeypatch.setattr(builtins, "exec", forbidden)
    assert evaluate_expression("sqrt(2)/2") == pytest.approx(math.sqrt(2) / 2)


def test_a_huge_power_fails_fast_instead_of_building_a_huge_integer() -> None:
    started = time.perf_counter()
    with pytest.raises(ExpressionError):
        evaluate_expression("10**10**10")
    assert time.perf_counter() - started < 1.0


# --------------------------------------------------------------------------- state


def test_state_check_passes_on_the_right_circuit_and_says_what_it_was_checked_against() -> None:
    verdict = evaluate_check(
        _prop(kind="state", subject="bell", reference="bell"), _circuit(_bell())
    )
    assert verdict.status == "pass"
    assert verdict.basis == "circuit"
    assert "Bell state (|00⟩ + |11⟩)/√2" in verdict.checked_against
    assert verdict.measure.startswith("fidelity 1.0000000")
    assert verdict.qubits == 2 and verdict.subject_fingerprint and verdict.subject_qasm
    assert "verified" not in verdict.model_dump_json().lower()


def test_state_check_names_the_one_basis_state_with_the_wrong_phase() -> None:
    qc = _bell()
    qc.z(1)  # (|00> - |11>)/sqrt(2)
    verdict = evaluate_check(_prop(kind="state", subject="bell", reference="bell"), _circuit(qc))
    assert verdict.status == "fail"
    assert "|11⟩ has the wrong phase" in verdict.detail
    assert "relative phase of π" in verdict.detail


def test_state_check_diagnoses_reversed_qubit_order() -> None:
    qc = QuantumCircuit(3)
    qc.x(0)  # Qiskit bitstring "001"
    verdict = evaluate_check(_prop(kind="state", subject="qc", amplitudes={"100": 1}), _circuit(qc))
    assert verdict.status == "fail"
    assert "qubit order reversed" in verdict.detail and "RIGHTMOST" in verdict.detail


def test_state_check_with_expressions_and_with_reference_qasm() -> None:
    qc = QuantumCircuit(1)
    qc.h(0)
    qc.t(0)
    amplitudes = {"0": "1/sqrt(2)", "1": "exp(i*pi/4)/sqrt(2)"}
    assert (
        evaluate_check(
            _prop(kind="state", subject="qc", amplitudes=amplitudes), _circuit(qc)
        ).status
        == "pass"
    )
    reference_qasm = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nh q[0];\nt q[0];\n'
    assert (
        evaluate_check(
            _prop(kind="state", subject="qc", reference_qasm=reference_qasm), _circuit(qc)
        ).status
        == "pass"
    )
    wrong = QuantumCircuit(1)
    wrong.h(0)
    wrong.tdg(0)
    verdict = evaluate_check(
        _prop(kind="state", subject="qc", amplitudes=amplitudes), _circuit(wrong)
    )
    assert verdict.status == "fail" and "|1⟩ has the wrong phase" in verdict.detail
    assert "−π/2" in verdict.detail  # e^{-iπ/4} against e^{iπ/4}


@pytest.mark.parametrize(
    "reference", ["bell:phi-", "bell:psi+", "bell:psi-", "w(3)", "uniform(3)", "ghz(5)"]
)
def test_every_state_reference_matches_its_textbook_state(reference: str) -> None:
    import numpy as np

    s = 1 / math.sqrt(2)
    expected = {
        "bell:phi-": {"00": s, "11": -s},
        "bell:psi+": {"01": s, "10": s},
        "bell:psi-": {"01": s, "10": -s},
        "w(3)": {"001": 1 / math.sqrt(3), "010": 1 / math.sqrt(3), "100": 1 / math.sqrt(3)},
        "uniform(3)": {format(k, "03b"): 1 / math.sqrt(8) for k in range(8)},
        "ghz(5)": {"00000": s, "11111": s},
    }[reference]
    width = len(next(iter(expected)))
    vector = np.zeros(2**width, dtype=complex)
    for key, value in expected.items():
        vector[int(key, 2)] = value
    # Prepared independently of the reference's own construction, unitarily (not with
    # `initialize`, which resets), and decomposed to standard gates so it exports.
    from qiskit.circuit.library import StatePreparation

    prepared = QuantumCircuit(width)
    prepared.append(StatePreparation(vector), range(width))
    prepared = prepared.decompose(reps=6)
    verdict = evaluate_check(
        _prop(kind="state", subject="qc", reference=reference), _circuit(prepared)
    )
    assert verdict.status == "pass", verdict.detail


# --------------------------------------------------------------------------- unitary


def test_unitary_check_passes_on_qiskits_qft() -> None:
    verdict = evaluate_check(
        _prop(kind="unitary", subject="qft", reference="qft(3)"), _circuit(_qft(3))
    )
    assert verdict.status == "pass"
    assert verdict.checked_against.startswith("Qiskit's QFT on 3 qubits, exact unitary")


def test_unitary_check_names_the_adjoint_when_it_is_given_the_inverse_qft() -> None:
    verdict = evaluate_check(
        _prop(kind="unitary", subject="qft", reference="qft(3)"), _circuit(_qft(3, inverse=True))
    )
    assert verdict.status == "fail"
    assert "inverse (the adjoint)" in verdict.detail


def test_unitary_check_names_a_qft_without_its_final_swaps() -> None:
    qc = QuantumCircuit(3)
    for target in reversed(range(3)):
        qc.h(target)
        for control in reversed(range(target)):
            qc.cp(math.pi / 2 ** (target - control), control, target)
    verdict = evaluate_check(_prop(kind="unitary", subject="qc", reference="qft(3)"), _circuit(qc))
    assert verdict.status == "fail"
    assert "reversal of the qubit order" in verdict.detail
    qc.swap(0, 2)
    assert (
        evaluate_check(_prop(kind="unitary", subject="qc", reference="qft(3)"), _circuit(qc)).status
        == "pass"
    )


def test_unitary_check_diagnoses_a_whole_circuit_on_reversed_wires() -> None:
    qc = QuantumCircuit(3)
    qc.h(0)
    qc.cx(0, 1)
    qc.t(2)
    reference = QuantumCircuit(3)
    reference.h(2)
    reference.cx(2, 1)
    reference.t(0)
    from qiskit import qasm3

    verdict = evaluate_check(
        _prop(kind="unitary", subject="qc", reference_qasm=qasm3.dumps(reference)), _circuit(qc)
    )
    assert verdict.status == "fail"
    assert "whole circuit's qubit order reversed" in verdict.detail


# --------------------------------------------------------------------------- distribution


def test_distribution_check_pass_fail_and_reversed_bits() -> None:
    bell = _bell()
    bell.measure_all()
    prop = _prop(kind="distribution", subject="bell", probabilities={"00": "1/2", "11": 0.5})
    assert evaluate_check(prop, _circuit(bell)).status == "pass"

    coin = QuantumCircuit(2)
    coin.h(0)
    coin.measure_all()
    failed = evaluate_check(prop, _circuit(coin))
    assert failed.status == "fail" and "P(" in failed.detail

    one = QuantumCircuit(2)
    one.x(0)
    one.measure_all()  # counts key "01"
    reversed_verdict = evaluate_check(
        _prop(kind="distribution", subject="one", probabilities={"10": 1}), _circuit(one)
    )
    assert reversed_verdict.status == "fail"
    assert "qubit order reversed" in reversed_verdict.detail


def test_distribution_check_reads_a_partial_measurement_by_classical_bit() -> None:
    qc = QuantumCircuit(3, 1)
    qc.x(2)
    qc.measure(2, 0)
    verdict = evaluate_check(
        _prop(kind="distribution", subject="qc", probabilities={"1": 1}), _circuit(qc)
    )
    assert verdict.status == "pass", verdict.detail


# --------------------------------------------------------------------------- energy


def test_energy_uses_qiskit_pauli_order() -> None:
    """q0 is the RIGHTMOST character of a Pauli string, exactly as in SparsePauliOp."""
    hamiltonian = {"ZI": 1.0, "IZ": 0.5, "XX": 0.25}
    for build in (lambda qc: qc.x(0), lambda qc: qc.x(1), lambda qc: (qc.h(0), qc.cx(0, 1))):
        qc = QuantumCircuit(2)
        build(qc)
        exact = (
            Statevector.from_instruction(qc)
            .expectation_value(SparsePauliOp.from_list(list(hamiltonian.items())))
            .real
        )
        verdict = evaluate_check(
            _prop(
                kind="energy", subject="qc", hamiltonian=hamiltonian, target=exact, tolerance=1e-9
            ),
            _circuit(qc),
        )
        assert verdict.status == "pass", (verdict.measure, exact)


def test_energy_check_against_the_ground_state_and_an_excited_one() -> None:
    hamiltonian = {"ZI": 1.0, "IZ": 0.5}  # levels 1.5, 0.5, -0.5, -1.5 (ground |11>)
    ground = QuantumCircuit(2)
    ground.x([0, 1])
    prop = _prop(kind="energy", subject="qc", hamiltonian=hamiltonian, target="ground")
    passed = evaluate_check(prop, _circuit(ground))
    assert passed.status == "pass"
    assert "-1.500000" in passed.checked_against
    excited = QuantumCircuit(2)
    excited.x(0)  # energy +0.5
    failed = evaluate_check(prop, _circuit(excited))
    assert failed.status == "fail" and "EXCITED level" in failed.detail


# --------------------------------------------------------------------------- value


def test_value_checks() -> None:
    assert (
        evaluate_check(
            _prop(kind="value", subject="p", value=0.5), CheckCapture.from_value(0.5)
        ).status
        == "pass"
    )
    failed = evaluate_check(
        _prop(kind="value", subject="p", value=0.5), CheckCapture.from_value(0.25)
    )
    assert failed.status == "fail" and failed.basis == "value"
    reversed_list = evaluate_check(
        _prop(kind="value", subject="p", value=[1, 2, 3]), CheckCapture.from_value([3, 2, 1])
    )
    assert reversed_list.status == "fail" and "reverse order" in reversed_list.detail
    shape = evaluate_check(
        _prop(kind="value", subject="p", value=[1, 2]), CheckCapture.from_value(1.0)
    )
    assert shape.status == "fail" and "one number" in shape.detail
    assert shape.teeth is not None and shape.teeth.status == "not_measured"


# --------------------------------------------------------------------------- inconclusive


def test_inconclusive_is_the_checks_own_incapacity_never_a_fail() -> None:
    bell = _prop(kind="state", subject="bell", reference="bell")
    cases: list[tuple[CheckProperty, CheckCapture, str]] = []
    cases.append(
        (bell, CheckCapture(kind="problem", problem="missing"), "no variable named `bell`")
    )
    cases.append(
        (
            bell,
            CheckCapture(kind="problem", problem="not_a_circuit", detail="a dict"),
            "not a Qiskit",
        )
    )
    mid = QuantumCircuit(2, 2)
    mid.h(0)
    mid.measure(0, 0)
    mid.cx(0, 1)
    cases.append((bell, _circuit(mid), "measures or resets a qubit before its end"))
    cases.append(
        (
            bell,
            CheckCapture(kind="circuit", qasm="OPENQASM 3.0;\nthis is not qasm"),
            "does not parse",
        )
    )
    wide = QuantumCircuit(9)
    wide.h(0)
    cases.append(
        (
            _prop(kind="unitary", subject="qc", reference="qft(3)"),
            _circuit(wide),
            "judges at most 8",
        )
    )
    cases.append(
        (
            _prop(kind="state", subject="qc", amplitudes={"00": 1, "11": 1}),
            _circuit(_bell()),
            "not a unit vector",
        )
    )
    cases.append(
        (
            _prop(kind="distribution", subject="qc", probabilities={"00": 0.5, "11": 0.25}),
            _circuit(_bell()),
            "add up to 0.75",
        )
    )
    for prop, capture, needle in cases:
        verdict = evaluate_check(prop, capture)
        assert verdict.status == "inconclusive", (needle, verdict)
        assert needle in verdict.detail, verdict.detail
        assert verdict.teeth is None


def test_a_width_mismatch_is_a_fail_not_an_inconclusive() -> None:
    verdict = evaluate_check(_prop(kind="state", subject="qc", reference="bell"), _circuit(_ghz(3)))
    assert verdict.status == "fail" and "3 qubits" in verdict.detail


# --------------------------------------------------------------------------- teeth


def test_a_strong_check_catches_every_behaviour_changing_mutant_of_ghz() -> None:
    verdict = evaluate_check(
        _prop(kind="state", subject="ghz", reference="ghz(5)"), _circuit(_ghz(5))
    )
    assert verdict.status == "pass"
    teeth = verdict.teeth
    assert teeth is not None and teeth.status == "measured"
    assert teeth.mutants > 0 and teeth.caught == teeth.mutants and teeth.survivors == []
    # GHZ is symmetric under reversing the qubit order: that copy is excluded, not counted.
    assert teeth.equivalent >= 1


def test_a_weak_check_lets_a_broken_copy_survive_and_names_it() -> None:
    """A distribution check with a loose tolerance passes a copy with the rotation
    dropped (its distribution moves by 0.022 in total variation) and says so."""
    qc = QuantumCircuit(1, 1)
    qc.ry(0.3, 0)
    qc.measure(0, 0)
    probabilities = {"0": "cos(0.15)**2", "1": "sin(0.15)**2"}
    loose = evaluate_check(
        _prop(kind="distribution", subject="qc", probabilities=probabilities, tolerance=0.1),
        _circuit(qc),
    )
    assert loose.status == "pass"
    assert loose.teeth is not None and loose.teeth.status == "measured"
    assert loose.teeth.caught == 0 and loose.teeth.mutants == 1
    assert loose.teeth.survivors == ["dropping the ry on q0, gate 1"]
    # negating the angle leaves every measured probability as it was: equivalent here
    assert loose.teeth.equivalent == 1
    strict = evaluate_check(
        _prop(kind="distribution", subject="qc", probabilities=probabilities), _circuit(qc)
    )
    assert strict.teeth is not None and strict.teeth.caught == strict.teeth.mutants == 1


def test_a_distribution_check_counts_phase_only_copies_as_equivalent() -> None:
    """Review of PR 1011 (S3): a copy that changes only phases no measurement sees
    cannot be caught by ANY distribution check, so it is excluded, not a survivor."""
    qc = _bell()
    qc.s(0)
    qc.t(1)
    qc.measure_all()
    verdict = evaluate_check(
        _prop(kind="distribution", subject="qc", probabilities={"00": 0.5, "11": 0.5}), _circuit(qc)
    )
    assert verdict.status == "pass"
    teeth = verdict.teeth
    assert teeth is not None and teeth.status == "measured"
    assert teeth.survivors == [] and teeth.caught == teeth.mutants
    assert teeth.equivalent >= 4  # drop s, drop t, s -> sdg, t -> tdg
    # the same circuit under a state check has teeth for those phase copies
    strong = evaluate_check(
        _prop(
            kind="state",
            subject="qc",
            amplitudes={"00": "1/sqrt(2)", "11": "exp(i*3*pi/4)/sqrt(2)"},
        ),
        _circuit(qc),
    )
    assert strong.status == "pass", strong.detail
    assert strong.teeth is not None and strong.teeth.caught == strong.teeth.mutants


def test_equivalent_mutants_are_excluded_not_counted_against_the_check() -> None:
    qc = QuantumCircuit(2)
    qc.z(1)  # Z on |0> does nothing: dropping it is an equivalent mutant
    qc.h(0)
    qc.cx(0, 1)
    verdict = evaluate_check(_prop(kind="state", subject="qc", reference="bell"), _circuit(qc))
    teeth = verdict.teeth
    assert teeth is not None and teeth.status == "measured"
    assert teeth.equivalent >= 2  # the dropped z, and the reversed (symmetric) circuit
    assert not any("dropping the z" in survivor for survivor in teeth.survivors)
    assert teeth.caught == teeth.mutants


def test_mutants_are_deterministic_bounded_and_cover_every_operator() -> None:
    qc = QuantumCircuit(4)
    for layer in range(6):
        for q in range(4):
            qc.rz(0.1 * (layer + q + 1), q)
            qc.s(q)
        for q in range(3):
            qc.cx(q, q + 1)
    first = mutants(qc, "state")
    second = mutants(qc, "state")
    assert [m.description for m in first] == [m.description for m in second]
    assert len(first) == MAX_MUTANTS
    assert {m.operator for m in first} == {
        "reverse_qubits",
        "drop_gate",
        "swap_control_target",
        "negate_angle",
        "adjoint_swap",
    }


def test_symmetric_two_qubit_gates_are_not_swapped() -> None:
    qc = QuantumCircuit(2)
    qc.h([0, 1])
    qc.cz(0, 1)
    qc.cp(0.3, 0, 1)
    qc.cx(0, 1)
    swaps = [m for m in mutants(qc) if m.operator == "swap_control_target"]
    assert [m.description for m in swaps] == [
        "swapping control and target of the cx on q0, q1, gate 5"
    ]


def test_mutation_limits_say_not_measured_with_the_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    # The caps are lowered for the test, so nothing here simulates more than 4 qubits
    # (owner's resource rule); the comparison is the same one the real caps go through.
    monkeypatch.setattr(checks, "MUTATION_MAX_QUBITS_STATE", 3)
    monkeypatch.setattr(checks, "MUTATION_MAX_QUBITS_UNITARY", 2)
    verdict = evaluate_check(
        _prop(kind="state", subject="ghz", reference="ghz(4)"), _circuit(_ghz(4))
    )
    assert verdict.status == "pass"
    assert verdict.teeth is not None and verdict.teeth.status == "not_measured"
    assert "Too large to test with broken copies" in verdict.teeth.reason
    assert "up to 3" in verdict.teeth.reason

    unitary = evaluate_check(
        _prop(kind="unitary", subject="qft", reference="qft(3)"), _circuit(_qft(3))
    )
    assert unitary.status == "pass"
    assert unitary.teeth is not None and unitary.teeth.status == "not_measured"
    assert "up to 2" in unitary.teeth.reason

    expired = evaluate_check(
        _prop(kind="state", subject="ghz", reference="ghz(3)"),
        _circuit(_ghz(3)),
        deadline=time.monotonic() - 1,
    )
    assert expired.status == "pass"
    assert expired.teeth is not None and expired.teeth.status == "not_measured"
    assert "time for checks in this run ran out" in expired.teeth.reason


def test_teeth_are_cached_by_check_and_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    cache: dict = {}
    prop = _prop(kind="state", subject="ghz", reference="ghz(3)")
    first = evaluate_check(prop, _circuit(_ghz(3)), teeth_cache=cache)
    assert len(cache) == 1

    def boom(_circuit):
        raise AssertionError("a cached subject must not be mutated again")

    monkeypatch.setattr(checks, "_all_candidates", boom)
    again = evaluate_check(prop, _circuit(_ghz(3)), teeth_cache=cache)
    assert again.teeth == first.teeth


def test_mutation_timings_stay_inside_the_budget() -> None:
    """The two cases DESIGN §2 asks to be measured: a 10-qubit state check and an 8-qubit
    unitary check, 32 mutants each. Printed so the numbers can be quoted (`-s`), and
    asserted against a quarter of the per-run budget so a regression is loud."""
    state = _ghz(10)
    for q in range(10):
        state.rz(0.1 * (q + 1), q)
    import numpy as np

    expected = np.asarray(Statevector.from_instruction(state).data)
    amplitudes = {format(k, "010b"): complex(v) for k, v in enumerate(expected) if abs(v) > 1e-12}
    amplitude_text = {
        key: f"({value.real!r})+({value.imag!r})*i" for key, value in amplitudes.items()
    }
    started = time.perf_counter()
    verdict = evaluate_check(
        _prop(kind="state", subject="qc", amplitudes=amplitude_text), _circuit(state)
    )
    state_seconds = time.perf_counter() - started
    assert verdict.status == "pass" and verdict.teeth is not None
    assert (
        verdict.teeth.status == "measured"
        and verdict.teeth.mutants + verdict.teeth.equivalent == MAX_MUTANTS
    )

    started = time.perf_counter()
    unitary = evaluate_check(
        _prop(kind="unitary", subject="qft", reference="qft(8)"), _circuit(_qft(8))
    )
    unitary_seconds = time.perf_counter() - started
    assert unitary.status == "pass" and unitary.teeth is not None
    assert unitary.teeth.status == "measured"
    print(
        f"\nmutation timing: state GHZ-10+rz {state_seconds:.3f}s "
        f"({verdict.teeth.mutants} mutants, {verdict.teeth.equivalent} equivalent); "
        f"unitary QFT(8) {unitary_seconds:.3f}s "
        f"({unitary.teeth.mutants} mutants, {unitary.teeth.equivalent} equivalent)"
    )
    assert state_seconds < checks.CHECK_BUDGET_S / 4
    assert unitary_seconds < checks.CHECK_BUDGET_S / 4


# --------------------------------------------------------------------------- a whole report


def _check_cell(cell_id: str, **fields) -> Cell:
    return Cell(id=cell_id, kind="code", role="check", property=_prop(**fields))


def test_apply_check_verdicts_never_changes_ok_or_a_cells_status() -> None:
    spec = NotebookSpec(
        slug="s",
        title="T",
        cells=[
            Cell(id="c01", kind="code", source="x = 1\n"),
            _check_cell("k01", kind="value", subject="x", value=2),
            _check_cell("k02", kind="value", subject="y", value=1),
            _check_cell("k03", kind="value", subject="z", value=1),
            _check_cell("k04", kind="value", subject="w", value=1),
        ],
    )
    report = ExecutionReport(
        notebook_slug="s",
        ok=True,
        runner="sandbox",
        cells=[
            CellResult(id="c01", status="ok"),
            CellResult(id="k01", status="ok"),
            CellResult(id="k02", status="not_run", note="after the cell you ran to"),
            CellResult(
                id="k03", status="error", error=CellError(ename="RuntimeError", evalue="boom")
            ),
            CellResult(id="k04", status="ok"),
        ],
    )
    judged = apply_check_verdicts(spec, report, {"k01": CheckCapture.from_value(1.0)})
    by_id = judged.by_id()
    assert judged.ok is True
    assert [c.status for c in judged.cells] == [c.status for c in report.cells]
    assert by_id["c01"].check is None
    assert by_id["k01"].check is not None and by_id["k01"].check.status == "fail"
    assert by_id["k02"].check is not None and "did not run" in by_id["k02"].check.detail
    assert by_id["k03"].check is not None and "RuntimeError: boom" in by_id["k03"].check.detail
    assert by_id["k04"].check is not None and "recorded nothing" in by_id["k04"].check.detail
    assert {by_id[k].check.status for k in ("k02", "k03", "k04")} == {"inconclusive"}


def test_one_budget_buys_every_verdict_before_any_teeth() -> None:
    spec = NotebookSpec(
        slug="s",
        title="T",
        cells=[
            _check_cell("k01", kind="state", subject="a", reference="ghz(3)"),
            _check_cell("k02", kind="state", subject="b", reference="ghz(3)"),
        ],
    )
    report = ExecutionReport(
        notebook_slug="s",
        ok=True,
        runner="sandbox",
        cells=[CellResult(id="k01", status="ok"), CellResult(id="k02", status="ok")],
    )
    ticks = iter([0.0, 0.0, 0.0] + [100.0] * 100)  # the budget is gone after both verdicts
    judged = apply_check_verdicts(
        spec,
        report,
        {"k01": _circuit(_ghz(3)), "k02": _circuit(_ghz(3))},
        budget_s=1.0,
        clock=lambda: next(ticks),
    )
    for cell in judged.cells:
        assert cell.check is not None and cell.check.status == "pass"
        assert cell.check.teeth is not None and cell.check.teeth.status == "not_measured"


# --------------------------------------------------------------------------- authorship


def _spec_with(*cells: Cell) -> NotebookSpec:
    return NotebookSpec(
        slug="s", title="T", cells=[Cell(id="c01", kind="code", source="x = 1\n"), *cells]
    )


def test_nala_can_only_propose_never_promote() -> None:
    claimed = _check_cell(
        "k01",
        kind="value",
        subject="x",
        value=1,
        author="source",
        citation="Nielsen & Chuang",
        accepted=True,
    )
    stamped = enforce_check_authorship(_spec_with(claimed), None, "nala").cell_by_id("k01").property
    assert stamped is not None
    assert (stamped.author, stamped.accepted, stamped.citation) == (
        "nala",
        False,
        "Nielsen & Chuang",
    )


def test_nala_leaves_an_unchanged_check_exactly_as_it_was_and_owns_a_changed_one() -> None:
    accepted = _check_cell("k01", kind="value", subject="x", value=1, author="user", accepted=True)
    parent = _spec_with(accepted)
    same = enforce_check_authorship(_spec_with(accepted), parent, "nala").cell_by_id("k01").property
    assert same is not None and (same.author, same.accepted) == ("user", True)
    edited = _check_cell("k01", kind="value", subject="x", value=2, author="user", accepted=True)
    changed = (
        enforce_check_authorship(_spec_with(edited), parent, "nala").cell_by_id("k01").property
    )
    assert changed is not None and (changed.author, changed.accepted) == ("nala", False)


def test_a_reader_accepts_a_nala_check_but_cannot_relabel_it_source() -> None:
    nala = _check_cell("k01", kind="value", subject="x", value=1, author="nala", accepted=False)
    parent = _spec_with(nala)
    accept = _check_cell("k01", kind="value", subject="x", value=1, author="nala", accepted=True)
    accepted = (
        enforce_check_authorship(_spec_with(accept), parent, "user").cell_by_id("k01").property
    )
    assert accepted is not None and (accepted.author, accepted.accepted) == ("nala", True)
    # (A `source` label with no citation is refused by the contract itself.)
    parent_cited = _spec_with(
        _check_cell("k01", kind="value", subject="x", value=1, author="nala", citation="arXiv:1234")
    )
    relabelled = _check_cell(
        "k01",
        kind="value",
        subject="x",
        value=1,
        author="source",
        citation="arXiv:1234",
        accepted=True,
    )
    kept = (
        enforce_check_authorship(_spec_with(relabelled), parent_cited, "user")
        .cell_by_id("k01")
        .property
    )
    assert kept is not None and kept.author == "nala"


def test_a_readers_new_or_changed_check_is_theirs_and_accepted() -> None:
    """With a parent version (the author route): a check the reader adds is theirs, or
    `source` when they mark it so with a citation."""
    empty_parent = _spec_with()
    new = _check_cell("k01", kind="value", subject="x", value=1, author="user", accepted=False)
    mine = (
        enforce_check_authorship(_spec_with(new), empty_parent, "user").cell_by_id("k01").property
    )
    assert mine is not None and (mine.author, mine.accepted) == ("user", True)
    sourced = _check_cell(
        "k02", kind="value", subject="x", value=1, author="source", citation="PRL 103, 150502"
    )
    cited = (
        enforce_check_authorship(_spec_with(sourced), empty_parent, "user")
        .cell_by_id("k02")
        .property
    )
    assert cited is not None and (cited.author, cited.accepted) == ("source", True)
    new = _check_cell("k01", kind="value", subject="x", value=1, author="nala", accepted=False)
    parent = _spec_with(new)
    changed = _check_cell("k01", kind="value", subject="x", value=3, author="nala", accepted=False)
    now = enforce_check_authorship(_spec_with(changed), parent, "user").cell_by_id("k01").property
    assert now is not None and (now.author, now.accepted) == ("user", True)


def test_a_check_cells_source_is_always_rendered_from_its_property() -> None:
    cell = _check_cell(
        "k01", kind="state", subject="bell", reference="bell", statement="bell is a Bell pair"
    )
    cell = cell.model_copy(update={"source": "import os\nos.system('x')\n"})
    stamped = enforce_check_authorship(_spec_with(cell), None, "nala").cell_by_id("k01")
    assert stamped.source == "# check: bell is a Bell pair\n"


def test_restore_checks_undoes_an_edit_a_deletion_and_a_role_change() -> None:
    k1 = _check_cell("k01", kind="value", subject="x", value=1, tolerance=1e-9)
    k2 = _check_cell("k02", kind="value", subject="x", value=1)
    before = enforce_check_authorship(
        NotebookSpec(
            slug="s",
            title="T",
            cells=[
                Cell(id="c01", kind="code", source="x = 1\n"),
                k1,
                Cell(id="c02", kind="code", source="y = 2\n"),
                k2,
            ],
        ),
        None,
        "nala",
    )
    weakened = before.cell_by_id("k01").model_copy(
        update={"property": before.cell_by_id("k01").property.model_copy(update={"tolerance": 1e6})}
    )
    after = before.with_cells(
        [before.cells[0], weakened, Cell(id="c02", kind="code", source="y = 3\n")]  # k02 deleted
    )
    restored, which = restore_checks(before, after)
    assert sorted(which) == ["k01", "k02"]
    assert [c.id for c in restored.cells] == ["c01", "k01", "c02", "k02"]
    assert restored.cell_by_id("k01") == before.cell_by_id("k01")
    assert restored.cell_by_id("k02") == before.cell_by_id("k02")
    assert restored.cell_by_id("c02").source == "y = 3\n"  # the real fix is kept


# --------------------------------------------------------------------------- round trips

CHECKED = """\
# ---
# title: Bell pair
# kind: lesson
# ---

# %% [markdown] role=objective
# Make a Bell pair.

# %% role=run
from qiskit import QuantumCircuit
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)

# %% role=check property={"kind": "state", "subject": "bell", "reference": "bell", "statement": "bell prepares (|00> + |11>)/sqrt(2)", "citation": "Nielsen & Chuang §1.3.6"}
# check: anything the author typed here is replaced

# %% role=check property={"kind":"energy","subject":"bell","hamiltonian":{"ZZ":-1.0,"XX":-1.0},"target":"ground","tolerance":1e-9}
"""


def test_nb_py_round_trip_render_parse_equals() -> None:
    spec = parse_source(CHECKED)
    check = spec.cells[2]
    assert check.role is not None and check.role.value == "check"
    assert check.source == "# check: bell prepares (|00> + |11>)/sqrt(2)\n"
    assert spec.cells[3].source == check_comment(spec.cells[3].property)
    rendered = render_source(spec)
    assert parse_source(rendered) == spec
    assert render_source(parse_source(rendered)) == rendered


def test_ipynb_round_trip_keeps_the_property_and_states_the_check_in_words() -> None:
    spec = enforce_check_authorship(parse_source(CHECKED), None, "nala")
    notebook = to_ipynb(spec)
    exported = next(c for c in notebook["cells"] if c["id"] == spec.cells[2].id)
    assert exported["cell_type"] == "code"
    assert exported["source"].startswith("# Leona check: bell prepares")
    assert (
        "proposed by Nala" in exported["source"]
        and "Running this cell here does nothing" in exported["source"]
    )
    assert exported["metadata"]["leona"]["property"]["reference"] == "bell"
    back = from_ipynb(notebook)
    assert back.cells == spec.cells


def test_an_imported_check_cell_without_a_usable_property_becomes_plain_code() -> None:
    spec = parse_source(CHECKED)
    notebook = to_ipynb(spec)
    for cell in notebook["cells"]:
        if cell["metadata"]["leona"].get("role") == "check":
            cell["metadata"]["leona"]["property"] = {"kind": "state", "subject": "bell"}  # invalid
    back = from_ipynb(notebook)
    assert all(cell.role is None or cell.role.value != "check" for cell in back.cells)


def test_an_upload_honours_only_the_claims_that_lower_trust() -> None:
    """Review of PR 1011 (S2): an imported file (no parent) keeps a check it says is
    Nala's as Nala's and unaccepted, and never takes `source` or `accepted` from it."""
    nala_accepted = _check_cell(
        "k01", kind="value", subject="x", value=1, author="nala", accepted=True
    )
    sourced = _check_cell(
        "k02", kind="value", subject="x", value=2, author="source", citation="arXiv:1234"
    )
    plain = _check_cell("k03", kind="value", subject="x", value=3, author="user", accepted=False)
    stamped = enforce_check_authorship(_spec_with(nala_accepted, sourced, plain), None, "user")
    props = {cell.id: cell.property for cell in stamped.cells if cell.property is not None}
    assert (props["k01"].author, props["k01"].accepted) == ("nala", False)
    assert (props["k02"].author, props["k02"].accepted) == ("user", True)
    assert props["k02"].citation == "arXiv:1234"
    assert (props["k03"].author, props["k03"].accepted) == ("user", True)


def test_renaming_a_cell_does_not_launder_nalas_check() -> None:
    """Review of PR 1011 (S2): the same property under another id is the same check."""
    nala = _check_cell("k01", kind="value", subject="x", value=1, author="nala", accepted=False)
    parent = _spec_with(nala)
    renamed = _check_cell("k99", kind="value", subject="x", value=1, author="user", accepted=True)
    by_reader = (
        enforce_check_authorship(_spec_with(renamed), parent, "user").cell_by_id("k99").property
    )
    assert by_reader is not None and by_reader.author == "nala"
    by_nala = (
        enforce_check_authorship(_spec_with(renamed), parent, "nala").cell_by_id("k99").property
    )
    assert by_nala is not None and (by_nala.author, by_nala.accepted) == ("nala", False)


def test_the_energy_matrix_is_the_verification_packages_matrix() -> None:
    """The judge builds H with `SparsePauliOp` (fast); it must be exactly the matrix the
    verification package's `hamiltonian_matrix` builds from the same strings."""
    import numpy as np
    from majorana_verification.hamiltonian import hamiltonian_matrix
    from qiskit.quantum_info import SparsePauliOp

    terms = {"ZIX": 0.7, "IYY": -0.3, "XZI": 0.25, "ZZZ": 1.1}
    fast = SparsePauliOp.from_list(list(terms.items())).to_matrix()
    slow = hamiltonian_matrix([(coefficient, term) for term, coefficient in terms.items()])
    assert np.allclose(fast, slow)
