"""Review round 1, blocker 1: a tiny input must never make the single worker build or
simulate something large. Every test here keeps the machine safe by construction: a spy
replaces the simulators and REFUSES anything wider than the test allows, so a regression
shows as a failed assertion rather than as a 16 GiB allocation. Probes: `probe_load.py`,
`probe_nested.py`, `probe_diag.py` (review of PR 1011).

Resource rule (owner): nothing here simulates more than 10 qubits, and nested-gate inputs
stop at depth 12.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from qiskit import QuantumCircuit

from leona_notebooks import checks
from leona_notebooks.checks import CheckCapture, evaluate_check
from majorana_contracts.notebooks import CheckProperty


def _nested_qasm(depth: int) -> str:
    """Each gate calls the one below it twice: 2**depth applications in ~30*depth chars."""
    lines = ["OPENQASM 3.0;", 'include "stdgates.inc";', "gate g0 a { x a; }"]
    for d in range(1, depth + 1):
        lines.append(f"gate g{d} a {{ g{d - 1} a; g{d - 1} a; }}")
    lines += ["qubit[1] q;", f"g{depth} q[0];"]
    return "\n".join(lines) + "\n"


@pytest.fixture
def simulated(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, int]]:
    """Every simulation the judge asks for, by width. Refuses anything over 10 qubits."""
    calls: list[tuple[str, int]] = []
    real_sv, real_u = checks._statevector, checks._unitary

    def spy_sv(circuit):
        calls.append(("statevector", circuit.num_qubits))
        if circuit.num_qubits > 10:
            raise AssertionError(f"simulated a {circuit.num_qubits}-qubit statevector")
        return real_sv(circuit)

    def spy_u(circuit):
        calls.append(("unitary", circuit.num_qubits))
        if circuit.num_qubits > 10:
            raise AssertionError(f"built a {circuit.num_qubits}-qubit unitary")
        return real_u(circuit)

    monkeypatch.setattr(checks, "_statevector", spy_sv)
    monkeypatch.setattr(checks, "_unitary", spy_u)
    return calls


@pytest.fixture
def converted(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """How many gate definitions each program handed to Qiskit's importer had."""
    import qiskit.qasm3
    import qiskit_qasm3_import

    seen: list[int] = []
    real_convert, real_loads = qiskit_qasm3_import.convert, qiskit.qasm3.loads

    def spy_convert(program, *args, **kwargs):
        seen.append(sum(type(s).__name__ == "QuantumGateDefinition" for s in program.statements))
        return real_convert(program, *args, **kwargs)

    def spy_loads(text, *args, **kwargs):
        seen.append(text.count("gate "))
        return real_loads(text, *args, **kwargs)

    monkeypatch.setattr(qiskit_qasm3_import, "convert", spy_convert)
    monkeypatch.setattr(qiskit.qasm3, "loads", spy_loads)
    return seen


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    return qc


# --------------------------------------------------------------------------- (a) width first


@pytest.mark.parametrize(
    "fields",
    [
        {"kind": "state", "reference": "ghz(19)"},
        {"kind": "unitary", "reference": "qft(10)"},
        {
            "kind": "state",
            "reference_qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[19] q; h q[0];',
        },
        {
            "kind": "unitary",
            "reference_qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[10] q; h q[0];',
        },
        {"kind": "energy", "hamiltonian": {"Z" * 10: 1.0}, "target": "ground"},
    ],
)
def test_the_widths_are_compared_before_the_reference_is_built(
    fields: dict, simulated: list[tuple[str, int]]
) -> None:
    verdict = evaluate_check(
        CheckProperty(subject="qc", **fields), CheckCapture.from_circuit(_bell())
    )
    assert verdict.status == "fail", verdict
    assert "2 qubits" in verdict.detail
    assert all(width <= 2 for _, width in simulated), simulated


def test_the_contract_caps_a_reference_circuit_at_the_kinds_ceiling() -> None:
    wide = 'OPENQASM 3.0; include "stdgates.inc"; qubit[30] q; h q[0];'
    with pytest.raises(ValidationError, match="30 qubits"):
        CheckProperty(kind="state", subject="qc", reference_qasm=wide)
    eleven = 'OPENQASM 3.0; include "stdgates.inc"; qubit[11] q; h q[0];'
    with pytest.raises(ValidationError, match="11 qubits"):
        CheckProperty(kind="unitary", subject="qc", reference_qasm=eleven)
    physical = 'OPENQASM 3.0; include "stdgates.inc"; h $29;'
    with pytest.raises(ValidationError, match="30 qubits"):
        CheckProperty(kind="state", subject="qc", reference_qasm=physical)


def test_a_unitary_check_stops_at_ten_qubits() -> None:
    with pytest.raises(ValidationError, match="not a library reference"):
        CheckProperty(kind="unitary", subject="qc", reference="qft(11)")
    CheckProperty(kind="unitary", subject="qc", reference="qft(10)")


def test_a_subject_on_physical_qubits_is_measured_by_its_real_width(
    simulated: list[tuple[str, int]],
) -> None:
    capture = CheckCapture(kind="circuit", qasm='OPENQASM 3.0;\ninclude "stdgates.inc";\nh $29;\n')
    verdict = evaluate_check(CheckProperty(kind="state", subject="qc", reference="bell"), capture)
    assert verdict.status == "inconclusive"
    assert "30 qubits" in verdict.detail
    assert simulated == []


# --------------------------------------------------------------------------- (b) nesting


@pytest.mark.parametrize("where", ["reference", "subject"])
def test_nested_gate_definitions_are_refused_before_qiskit_expands_them(
    where: str, converted: list[int], simulated: list[tuple[str, int]]
) -> None:
    text = _nested_qasm(12)  # 398 characters, 4,096 gate applications
    if where == "reference":
        prop = CheckProperty(kind="state", subject="qc", reference_qasm=text)
        capture = CheckCapture.from_circuit(QuantumCircuit(1))
    else:
        prop = CheckProperty(kind="state", subject="qc", reference="uniform(1)")
        capture = CheckCapture(kind="circuit", qasm=text)
    converted.clear()
    verdict = evaluate_check(prop, capture)
    assert verdict.status == "inconclusive"
    assert "too complex to check" in verdict.detail
    assert "4,000" in verdict.detail
    assert all(definitions == 0 for definitions in converted), (
        "the nested program reached Qiskit's importer"
    )
    assert simulated == []


def test_a_shallow_nested_definition_is_still_judged() -> None:
    text = _nested_qasm(3)  # 8 x gates on one qubit: the identity
    verdict = evaluate_check(
        CheckProperty(kind="state", subject="qc", amplitudes={"0": 1}),
        CheckCapture(kind="circuit", qasm=text),
    )
    assert verdict.status == "pass", verdict.detail


# --------------------------------------------------------------------------- (c) cost guard


def test_a_unitary_too_costly_to_build_is_refused_before_building_it(
    simulated: list[tuple[str, int]],
) -> None:
    qc = QuantumCircuit(10)
    for layer in range(100):
        for q in range(10):
            qc.rz(0.01 * (layer + q + 1), q)
    verdict = evaluate_check(
        CheckProperty(kind="unitary", subject="qc", reference="qft(10)"),
        CheckCapture.from_circuit(qc),
    )
    assert verdict.status == "inconclusive"
    assert "too large to check" in verdict.detail
    assert simulated == []


def test_the_unitary_diagnosis_does_no_dense_matrix_products(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`probe_diag.py`: the failing-unitary diagnosis built 2**n x 2**n permutation matrices
    and multiplied them, 8**n work per candidate. Row and column indexing does the same."""
    import numpy as np

    import sys

    made: list[int] = []
    real_eye = np.eye

    def spy_eye(n, *args, **kwargs):
        # Qiskit's own `Operator` starts from np.eye; only the judge's calls count here.
        if sys._getframe(1).f_code.co_filename.endswith("checks.py"):
            made.append(n)
        return real_eye(n, *args, **kwargs)

    monkeypatch.setattr(np, "eye", spy_eye)
    qc = QuantumCircuit(6)
    qc.h(range(6))
    verdict = evaluate_check(
        CheckProperty(kind="unitary", subject="qc", reference="qft(6)"),
        CheckCapture.from_circuit(qc),
    )
    assert verdict.status == "fail"
    assert made == []


# --------------------------------------------------------------------------- the nits


def test_a_reset_on_a_fresh_qubit_is_not_a_reason_to_give_up() -> None:
    qc = QuantumCircuit(2)
    qc.reset(0)
    qc.reset(1)
    qc.h(0)
    qc.cx(0, 1)
    verdict = evaluate_check(
        CheckProperty(kind="state", subject="qc", reference="bell"), CheckCapture.from_circuit(qc)
    )
    assert verdict.status == "pass", verdict.detail
    late = QuantumCircuit(2)
    late.h(0)
    late.reset(0)
    verdict = evaluate_check(
        CheckProperty(kind="state", subject="qc", reference="bell"), CheckCapture.from_circuit(late)
    )
    assert verdict.status == "inconclusive"


def test_malformed_capture_records_cost_only_themselves() -> None:
    from leona_notebooks.checks import captures_from_observation
    from leona_notebooks.spec import NotebookSpec

    spec = NotebookSpec.model_validate(
        {
            "slug": "t",
            "title": "t",
            "cells": [
                {
                    "id": "k1",
                    "kind": "code",
                    "role": "check",
                    "property": {"kind": "value", "subject": "x", "value": 1},
                },
            ],
        }
    )
    observation = {
        "notebook": {
            "cells": [
                {"id": ["unhashable"], "capture": {"kind": "value", "value": 1}},
                {"id": {"also": "unhashable"}, "capture": {"kind": "value", "value": 1}},
                "not a record",
                {"id": "k1", "capture": {"kind": "value", "value": 1}},
            ]
        }
    }
    captures = captures_from_observation(observation, spec)
    assert captures["k1"].kind == "value" and captures["k1"].value == 1.0


def test_a_broken_copy_the_simulator_refuses_is_counted(monkeypatch: pytest.MonkeyPatch) -> None:
    real = checks._statevector
    calls = {"n": 0}

    def flaky(circuit):
        calls["n"] += 1
        if calls["n"] > 2 and calls["n"] % 2 == 0:  # the subject and the reference run
            raise ValueError("refused")
        return real(circuit)

    monkeypatch.setattr(checks, "_statevector", flaky)
    qc = QuantumCircuit(3)
    qc.h(0)
    qc.cx(0, 1)
    qc.cx(1, 2)
    verdict = evaluate_check(
        CheckProperty(kind="state", subject="qc", reference="ghz(3)"), CheckCapture.from_circuit(qc)
    )
    teeth = verdict.teeth
    assert teeth is not None and teeth.could_not_run > 0
    assert "could not be run" in teeth.reason


def test_statements_carry_no_possessive_on_a_variable_name() -> None:
    from leona_notebooks.checks import describe_property

    distribution = CheckProperty(kind="distribution", subject="counts", probabilities={"0": 1})
    assert describe_property(distribution).startswith("the measured distribution of counts")
    energy = CheckProperty(kind="energy", subject="ansatz", hamiltonian={"Z": 1.0}, target="ground")
    assert "'s" not in describe_property(energy).split(" matches ")[0]


def test_no_reader_facing_string_in_the_engine_has_a_dash_pair() -> None:
    """The owner's rule: reader-facing text gets a humanizer pass, and em and en dashes
    are the first thing it removes. Every string constant in checks.py that is not a
    docstring is reader-facing (verdicts, teeth reasons, statements)."""
    import ast
    from pathlib import Path

    tree = ast.parse(Path(checks.__file__).read_text())
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef)
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
    }
    offending = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
        and ("—" in node.value or "–" in node.value)
    ]
    assert offending == []


def test_each_kind_stops_where_one_check_fits_in_about_150_mib() -> None:
    """Coordinator, 512 MiB containers: state 19, distribution 15, unitary and energy 10.
    The widths come from the measured and fitted costs in checks.py."""
    from majorana_contracts.notebooks import (
        CHECK_DISTRIBUTION_MAX_QUBITS,
        CHECK_STATE_MAX_QUBITS,
        CHECK_UNITARY_MAX_QUBITS,
    )

    assert (CHECK_STATE_MAX_QUBITS, CHECK_DISTRIBUTION_MAX_QUBITS, CHECK_UNITARY_MAX_QUBITS) == (
        19,
        15,
        10,
    )
    with pytest.raises(ValidationError, match="not a library reference"):
        CheckProperty(kind="state", subject="qc", reference="ghz(20)")
    with pytest.raises(ValidationError, match="at most 15"):
        CheckProperty(kind="distribution", subject="qc", probabilities={"0" * 16: 1})
    wide = QuantumCircuit(16)
    wide.measure_all()
    verdict = evaluate_check(
        CheckProperty(kind="distribution", subject="qc", probabilities={"0" * 15: 1}),
        CheckCapture.from_circuit(wide),
    )
    assert verdict.status == "inconclusive" and "at most 15" in verdict.detail
    assert verdict.qubits == 16, "a too-wide verdict says how wide"
