"""Check cells through the real program: composition, the guard, a run in
`LocalSubprocessSandbox` (the product's path minus the microVM), the captures read back
across the trust boundary, and the verdicts written by trusted code afterwards."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest
from majorana_sandbox import run as sandbox_run
from majorana_sandbox.local import LocalSubprocessSandbox

from leona_notebooks.checks import (
    MAX_CAPTURE_QASM_CHARS,
    apply_check_verdicts,
    captures_from_observation,
    captures_from_sandbox_result,
)
from leona_notebooks.sandbox_program import (
    NotebookGuardError,
    build_execution_spec,
    compose_notebook_program,
    report_from_sandbox_result,
)
from leona_notebooks.source import parse_source

NOTEBOOK = """\
# ---
# title: Checked
# ---

# %% id=c01
from qiskit import QuantumCircuit
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)
bell.measure_all()
wrong = QuantumCircuit(2)
wrong.h(0)
wrong.cx(0, 1)
wrong.z(1)

# %% id=k01 role=check property={"kind":"state","subject":"bell","reference":"bell"}

# %% id=k02 role=check property={"kind":"state","subject":"wrong","reference":"bell"}

# %% id=k03 role=check property={"kind":"state","subject":"missing","reference":"bell"}

# %% id=k04 role=check property={"kind":"distribution","subject":"bell","probabilities":{"00":0.5,"11":0.5}}

# %% id=c02
import numpy as np
p = np.array([0.5, 0.5])
theta = float("nan")

# %% id=k05 role=check property={"kind":"value","subject":"p","value":[0.5,0.5]}

# %% id=k06 role=check property={"kind":"value","subject":"theta","value":1}

# %% id=k07 role=check property={"kind":"value","subject":"bell","value":1}

# %% id=c03
bell.x(0)
print("the circuit changed after the check")
"""


def _run(spec, **kwargs):
    program = compose_notebook_program(spec, **kwargs)
    with tempfile.TemporaryDirectory() as tmp:
        exec_spec = build_execution_spec(
            program, timeout_s=120, protected_result_path=str(Path(tmp) / "obs.json")
        )
        result = asyncio.run(sandbox_run(LocalSubprocessSandbox(), exec_spec))
    return program, result


def test_check_cells_capture_instead_of_running_and_are_judged_after_the_run() -> None:
    spec = parse_source(NOTEBOOK)
    program, result = _run(spec)
    assert "__leona_capture_check__('k01', 'bell', 'state')" in program.code
    assert "k01" in program.cell_ids and "__leona_run_cell__('k01'" not in program.code
    assert result.ok, result.stderr

    report = report_from_sandbox_result(result, spec, program)
    captures = captures_from_sandbox_result(result, spec)
    assert {cell_id: c.kind for cell_id, c in captures.items()} == {
        "k01": "circuit",
        "k02": "circuit",
        "k03": "problem",
        "k04": "circuit",
        "k05": "value",
        "k06": "problem",
        "k07": "problem",
    }
    judged = apply_check_verdicts(spec, report, captures)
    by_id = judged.by_id()
    status = {cell_id: by_id[cell_id].check.status for cell_id in captures}
    assert status == {
        "k01": "pass",  # captured at the check's position, before c03 changed the circuit
        "k02": "fail",
        "k03": "inconclusive",
        "k04": "pass",
        "k05": "pass",  # a numpy array, read through its own tolist
        "k06": "inconclusive",  # NaN
        "k07": "inconclusive",  # a circuit is not a number
    }
    assert "|11⟩ has the wrong phase" in by_id["k02"].check.detail
    assert "no variable named `missing`" in by_id["k03"].check.detail
    assert "not a finite number" in by_id["k06"].check.detail
    assert by_id["k05"].check.basis == "value" and by_id["k01"].check.basis == "circuit"
    # A failing check is a result, not a broken notebook.
    assert judged.ok is True and report.ok is True
    assert all(by_id[cell_id].status == "ok" for cell_id in captures)
    assert by_id["c03"].stdout == "the circuit changed after the check\n"


def test_the_guard_still_reads_every_check_cells_raw_source() -> None:
    spec = parse_source(NOTEBOOK)
    seen: list[str] = []

    def guard(source: str) -> list[str]:
        seen.append(source)
        return ["refused"] if source.startswith("# check:") else []

    with pytest.raises(NotebookGuardError) as info:
        compose_notebook_program(spec, guard=guard)
    assert {"k01", "k02", "k07"} <= set(info.value.violations)
    assert sum(1 for source in seen if source.startswith("# check:")) == 7


def test_a_check_after_a_raising_cell_is_not_run_and_inconclusive() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n"
        "# %% id=c01\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\n"
        "# %% id=c02\nraise ValueError('boom')\n"
        '# %% id=k01 role=check property={"kind":"state","subject":"qc","amplitudes":{"0":1}}\n'
        '# %% id=k02 role=check execute=false property={"kind":"state","subject":"qc","amplitudes":{"0":1}}\n'
    )
    program, result = _run(spec)
    assert program.skipped == {"k02": "execute=false"}
    report = report_from_sandbox_result(result, spec, program)
    judged = apply_check_verdicts(spec, report, captures_from_sandbox_result(result, spec))
    by_id = judged.by_id()
    assert by_id["k01"].status == "not_run"
    assert by_id["k01"].check.status == "inconclusive"
    assert "an earlier cell raised" in by_id["k01"].check.detail
    assert by_id["k02"].status == "skipped" and by_id["k02"].check.status == "inconclusive"


def test_captures_are_rechecked_at_the_trust_boundary() -> None:
    spec = parse_source(NOTEBOOK)
    oversized = "OPENQASM 3.0;\n" + "// padding\n" * (MAX_CAPTURE_QASM_CHARS // 10)
    observation = {
        "notebook": {
            "cells": [
                {"id": "k01", "capture": {"kind": "circuit", "qasm": oversized}},
                {"id": "k02", "capture": {"kind": "value", "value": [1, "two"]}},
                {"id": "k03", "capture": "not a dict"},
                {"id": "k05", "capture": {"kind": "value", "value": float("inf")}},
                {"id": "c01", "capture": {"kind": "value", "value": 1}},  # not a check cell
            ]
        }
    }
    captures = captures_from_observation(observation, spec)
    assert captures["k01"].problem == "too_large"
    assert captures["k02"].kind == "problem" and captures["k03"].kind == "problem"
    assert captures["k05"].kind == "problem"
    assert "c01" not in captures


def test_the_composed_program_still_passes_the_guard_itself() -> None:
    from majorana_sandbox.guard import check_python_code

    program = compose_notebook_program(parse_source(NOTEBOOK))
    assert check_python_code(program.code).ok, program.code
