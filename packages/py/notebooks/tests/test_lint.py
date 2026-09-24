"""The linter against the shared cases in `tests/data/lint-cases.json`.

The browser's copy of these rules (`apps/web/lib/notebook-lint.ts`) is tested against the
same file, so a case added here binds both implementations."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from leona_notebooks.lint import DEFINITE, lint_cell, lint_spec
from leona_notebooks.spec import Cell, NotebookSpec

CASES_PATH = Path(__file__).parent / "data" / "lint-cases.json"
CASES = json.loads(CASES_PATH.read_text())


def test_the_case_file_is_not_empty() -> None:
    # An empty case list would make every parametrised test below vanish and the suite
    # would still be green.
    assert len(CASES["cases"]) >= 25


def test_every_code_has_one_severity_and_matches_the_module() -> None:
    from leona_notebooks.lint import _SEVERITY

    assert CASES["codes"] == _SEVERITY


@pytest.mark.parametrize("case", CASES["cases"], ids=[c["name"] for c in CASES["cases"]])
def test_shared_case(case: dict) -> None:
    found = lint_cell(case["source"], case.get("preceding", []))
    got = sorted((d.code, d.line) for d in found)
    want = sorted((e["code"], e["line"]) for e in case["expect"])
    assert got == want, [d.render() for d in found]


def test_the_production_failure_names_the_chained_call() -> None:
    case = next(c for c in CASES["cases"] if c["name"] == "today's production failure")
    [finding] = lint_cell(case["source"])
    assert "QuantumCircuit(1).h(0)" in finding.message
    assert "InstructionSet" in finding.message


def test_severity_and_definite_split() -> None:
    # The pipeline repairs a DEFINITE finding before any sandbox run, so a heuristic must
    # never be in that set: a false alarm there would send a correct cell to the model.
    assert "gate-returns-instructions" not in DEFINITE
    assert {"removed-qiskit-api", "syntax-error"} <= DEFINITE


def test_data_meas_is_flagged_only_when_no_cell_ever_creates_a_meas_register() -> None:
    # Reproduces the production shape: a helper function defined in one cell (c04) reads
    # `.data.meas`, but it is CALLED from a later cell (c07) with a circuit measured by
    # plain `.measure(...)`, not `measure_all()`. Neither cell alone shows the mistake to a
    # per-cell, preceding-only check; only knowing that NO cell in the whole notebook ever
    # creates a "meas" register makes it provable at c04, which is where the actual
    # `.data.meas` text lives.
    spec = NotebookSpec(
        slug="databin",
        title="databin",
        cells=[
            Cell(
                id="c03",
                kind="code",
                source="from qiskit import QuantumCircuit\nfrom qiskit.primitives import StatevectorSampler\n",
            ),
            Cell(
                id="c04",
                kind="code",
                source=(
                    "def run_and_count(qc, shots=1000):\n"
                    "    sampler = StatevectorSampler(seed=42)\n"
                    "    job = sampler.run([qc], shots=shots)\n"
                    "    return job.result()[0].data.meas.get_counts()\n"
                ),
            ),
            Cell(
                id="c07",
                kind="code",
                source="qc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\ncounts = run_and_count(qc, shots=1000)\n",
            ),
        ],
    )
    findings = lint_spec(spec)
    assert set(findings) == {"c04"}
    assert findings["c04"][0].code == "data-meas-without-measure-all"
    assert findings["c04"][0].code in DEFINITE


def test_data_meas_is_not_flagged_when_measure_all_appears_anywhere_in_the_notebook() -> None:
    # The control for the test above: an UNRELATED circuit elsewhere in the same notebook
    # calls `measure_all()`, so a register named "meas" genuinely can exist somewhere in
    # this notebook's universe of behaviour, and the whole-notebook rule must stand down —
    # a false alarm here would send a correct cell to the repair model.
    spec = NotebookSpec(
        slug="databin-control",
        title="databin-control",
        cells=[
            Cell(id="c1", kind="code", source="from qiskit import QuantumCircuit\n"),
            Cell(id="c2", kind="code", source="qc2 = QuantumCircuit(2)\nqc2.measure_all()\n"),
            Cell(
                id="c3",
                kind="code",
                source=(
                    "def run_and_count(qc, shots=1000):\n"
                    "    job = sampler.run([qc], shots=shots)\n"
                    "    return job.result()[0].data.meas.get_counts()\n"
                ),
            ),
        ],
    )
    assert lint_spec(spec) == {}


def test_data_meas_stands_down_on_an_explicit_meas_named_register() -> None:
    spec = NotebookSpec(
        slug="databin-explicit",
        title="databin-explicit",
        cells=[
            Cell(
                id="c1",
                kind="code",
                source=(
                    "from qiskit import QuantumCircuit, ClassicalRegister\n"
                    'creg = ClassicalRegister(2, "meas")\n'
                    "qc = QuantumCircuit(2, creg)\n"
                ),
            ),
            Cell(
                id="c2",
                kind="code",
                source="counts = job.result()[0].data.meas.get_counts()\n",
            ),
        ],
    )
    assert lint_spec(spec) == {}


def test_lint_spec_reads_names_across_cells_and_skips_markdown() -> None:
    spec = NotebookSpec(
        slug="lint",
        title="lint",
        cells=[
            Cell(
                id="c1",
                kind="code",
                source="from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.measure_all()\n",
            ),
            Cell(id="c2", kind="markdown", source="Statevector(qc) is not code here."),
            Cell(
                id="c3",
                kind="code",
                source="from qiskit.quantum_info import Statevector\nsv = Statevector(qc)\n",
            ),
            Cell(id="c4", kind="code", source="print('fine')\n"),
        ],
    )
    findings = lint_spec(spec)
    assert set(findings) == {"c3"}
    assert findings["c3"][0].code == "measured-circuit-has-no-statevector"


def test_data_meas_stands_down_when_a_register_name_or_the_circuit_is_not_in_the_code() -> None:
    # A register named through a variable, or a circuit read from OpenQASM text, may be
    # called "meas" without the literal ever appearing: the rule must not call a working
    # read certain to fail (a definite finding spends a repair before anything runs).
    reader = Cell(id="c2", kind="code", source="counts = job.result()[0].data.meas.get_counts()\n")
    for setup in (
        'name = "me" + "as"\ncreg = ClassicalRegister(2, name)\n',
        "creg = ClassicalRegister(2, name=register_name)\n",
        "qc = qasm3.loads(program_text)\n",
        "from qiskit.qasm2 import loads\nqc = loads(program_text)\n",
        "qc = QuantumCircuit.from_qasm_str(program_text)\n",
    ):
        spec = NotebookSpec(
            slug="databin-indirect",
            title="databin-indirect",
            cells=[Cell(id="c1", kind="code", source=setup), reader],
        )
        assert lint_spec(spec) == {}, setup
    # Control: a literal name that is not "meas" still leaves the rule armed.
    spec = NotebookSpec(
        slug="databin-literal",
        title="databin-literal",
        cells=[Cell(id="c1", kind="code", source='creg = ClassicalRegister(2, "c")\n'), reader],
    )
    assert set(lint_spec(spec)) == {"c2"}
