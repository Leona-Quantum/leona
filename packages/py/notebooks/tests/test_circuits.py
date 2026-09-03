"""`leona_notebooks.circuits`: a reader's own circuit as a notebook seed.

OpenQASM 3 is parsed (never executed); Python is guarded (the same static check
the sandbox runs on every cell) and, if it passes, described with `ast` alone."""

from __future__ import annotations

from qiskit import qasm3

from leona_notebooks.circuits import (
    CircuitSeedMaterial,
    classify_circuit_text,
    validate_circuit_seed,
)

BELL_QASM3 = """\
OPENQASM 3;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
cx q[0], q[1];
c = measure q;
"""

BELL_PYTHON = """\
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""

OS_IMPORT_PYTHON = """\
import os

os.system("echo hi")
"""


def test_classify_circuit_text() -> None:
    assert classify_circuit_text(BELL_QASM3) == "qasm3"
    assert classify_circuit_text(BELL_PYTHON) == "python"
    # A comment may precede the OPENQASM pragma; still classified as qasm3.
    assert classify_circuit_text("// generated\n" + BELL_QASM3) == "qasm3"


def test_qasm3_bell_seed_run_cell_parses_again() -> None:
    material = validate_circuit_seed(BELL_QASM3)
    assert isinstance(material, CircuitSeedMaterial)
    assert material.language == "qasm3"
    assert "2 qubit(s)" in material.description_text
    assert "h=1" in material.description_text and "cx=1" in material.description_text

    # The run cell is the literal cell text a notebook would ship; executing it
    # (as the notebook's `run` cell will) must parse the embedded QASM again.
    namespace: dict[str, object] = {"qasm3": qasm3}
    exec(compile(material.run_cell_source, "<run_cell>", "exec"), namespace)  # noqa: S102 - test-only, own generated cell
    assert namespace["qc"].num_qubits == 2
    assert namespace["QASM"].strip().startswith("OPENQASM 3")


def test_python_seed_with_os_import_is_refused_by_the_guard() -> None:
    result = validate_circuit_seed(OS_IMPORT_PYTHON)
    assert isinstance(result, list) and result
    assert any("os" in finding for finding in result)


def test_python_bell_circuit_passes_and_names_its_gates() -> None:
    material = validate_circuit_seed(BELL_PYTHON)
    assert isinstance(material, CircuitSeedMaterial)
    assert material.language == "python"
    assert material.run_cell_source == BELL_PYTHON
    assert "h=1" in material.description_text
    assert "cx=1" in material.description_text
    assert "qiskit" in material.description_text


def test_invalid_qasm3_is_refused_not_raised() -> None:
    result = validate_circuit_seed("OPENQASM 3;\nqubit[2] q;\nnonsense_gate q[0];\n")
    assert isinstance(result, list) and result
