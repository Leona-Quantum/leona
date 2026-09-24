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


def test_lint_spec_reads_names_across_cells_and_skips_markdown() -> None:
    spec = NotebookSpec(
        slug="lint",
        title="lint",
        cells=[
            Cell(id="c1", kind="code", source="from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.measure_all()\n"),
            Cell(id="c2", kind="markdown", source="Statevector(qc) is not code here."),
            Cell(id="c3", kind="code", source="from qiskit.quantum_info import Statevector\nsv = Statevector(qc)\n"),
            Cell(id="c4", kind="code", source="print('fine')\n"),
        ],
    )
    findings = lint_spec(spec)
    assert set(findings) == {"c3"}
    assert findings["c3"][0].code == "measured-circuit-has-no-statevector"
