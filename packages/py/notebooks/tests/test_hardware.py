"""`leona_submit`: a notebook cell asking for a QPU run, recorded in the sandbox and
sent nowhere. Real runs through `LocalSubprocessSandbox` (the product's program minus
the microVM), plus the parse side that reads the requests back out of the sidecar."""

from __future__ import annotations

import json

import pytest
from majorana_contracts.notebooks import MAX_HARDWARE_REQUESTS_PER_NOTEBOOK
from qiskit import QuantumCircuit, qasm3

from leona_notebooks import NotebookGuardError, compose_notebook_program, parse_source
from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.hardware import (
    MAX_HARDWARE_QASM_TOTAL_CHARS,
    HardwareLedger,
    hardware_request,
    qasm_qubit_count,
    recorded_sentence,
)
from leona_notebooks.local_runner import execute_in_local_sandbox
from leona_notebooks.sandbox_program import report_from_observation

HEADER = "# ---\n# title: T\n# kind: hardware\n# ---\n"

BELL = (
    "from qiskit import QuantumCircuit\n"
    "bell = QuantumCircuit(2)\n"
    "bell.h(0)\n"
    "bell.cx(0, 1)\n"
    "bell.measure_all()\n"
)


def _notebook(*cells: tuple[str, str, bool]) -> str:
    """`(id, source, may_raise)` → notebook source."""
    parts = [HEADER]
    for cell_id, source, may_raise in cells:
        tags = ' tags=["raises-exception"]' if may_raise else ""
        parts.append(f"# %% id={cell_id}{tags}\n{source}\n")
    return "".join(parts)


# --------------------------------------------------------------------------- a real run


def test_a_cell_calling_leona_submit_records_one_request_that_round_trips() -> None:
    spec = parse_source(
        _notebook(
            ("build", BELL, False),
            ("submit", "leona_submit(bell)", False),
            ("plain", "x = 1\nx", False),
        )
    )
    report = execute_in_local_sandbox(spec)
    assert report.ok, report.note
    by_id = report.by_id()

    [request] = by_id["submit"].hardware_requests
    assert request.shots == 1024
    assert request.num_qubits == 2
    assert request.label is None
    # The worker reads the program with `qasm3.loads` (`majorana_qpu.ibm`), so that is the
    # round trip that matters: the same circuit, gate for gate.
    loaded = qasm3.loads(request.qasm)
    assert loaded.num_qubits == 2
    assert dict(loaded.count_ops()) == {"h": 1, "cx": 1, "measure": 2, "barrier": 1}
    expected = QuantumCircuit(2)
    expected.h(0)
    expected.cx(0, 1)
    expected.measure_all()
    assert request.qasm == qasm3.dumps(expected)

    # The call's value is one plain sentence, shown as the cell's output.
    assert [output.data for output in by_id["submit"].outputs] == [
        "Hardware request recorded: 2 qubits, 1024 shots. Choose a device under this cell to run it."
    ]
    # Cells that never called it carry none, and neither does the one that built the circuit.
    assert by_id["build"].hardware_requests == []
    assert by_id["plain"].hardware_requests == []


def test_shots_label_and_an_openqasm3_string_are_recorded_as_given() -> None:
    spec = parse_source(
        _notebook(
            ("build", BELL, False),
            (
                "two",
                "from qiskit import qasm3\n"
                "leona_submit(bell, shots=100, label='first')\n"
                "leona_submit(qasm3.dumps(bell), 1, label='as text');",
                False,
            ),
        )
    )
    report = execute_in_local_sandbox(spec)
    assert report.ok, report.note
    first, second = report.by_id()["two"].hardware_requests
    assert (first.shots, first.label, first.num_qubits) == (100, "first", 2)
    assert (second.shots, second.label, second.num_qubits) == (1, "as text", 2)
    assert first.qasm == second.qasm
    # `;` suppressed the display, as in Jupyter.
    assert report.by_id()["two"].outputs == []


def test_a_request_is_recorded_on_the_cell_that_RAN_the_call() -> None:
    """A helper defined in one cell and called in another records on the caller."""
    spec = parse_source(
        _notebook(
            ("define", BELL + "def run_it():\n    return leona_submit(bell, shots=64)\n", False),
            ("call", "run_it();", False),
        )
    )
    report = execute_in_local_sandbox(spec)
    by_id = report.by_id()
    assert by_id["define"].hardware_requests == []
    assert [r.shots for r in by_id["call"].hardware_requests] == [64]


# --------------------------------------------------------------------------- refusals

_LONG_BODY = "OPENQASM 3;\\nqubit[1] q;\\nbit[1] c;\\n"
_MEASURE = "c[0] = measure q[0];\\n"

#: One row per check `leona_submit` makes. Each is a cell source; every row runs in ONE
#: notebook (each cell tagged raises-exception, so the run continues past a refusal) and
#: again through the local builder, and the two must agree on the exception type and the
#: exact sentence. Add a row here whenever a check is added to either implementation.
REFUSALS: tuple[tuple[str, str], ...] = (
    ("wrong_type", "leona_submit([1, 2, 3])"),
    ("shots_bool", "leona_submit(bell, shots=True)"),
    ("shots_float", "leona_submit(bell, shots=10.0)"),
    ("shots_zero", "leona_submit(bell, shots=0)"),
    ("shots_over", "leona_submit(bell, shots=1_000_001)"),
    ("label_type", "leona_submit(bell, label=7)"),
    ("label_long", "leona_submit(bell, label='x' * 121)"),
    (
        "qasm2",
        "leona_submit('OPENQASM 2.0;\\ninclude \"qelib1.inc\";\\nqreg q[1];\\ncreg c[1];\\nmeasure q[0] -> c[0];\\n')",
    ),
    ("not_qasm", "leona_submit('h q[0];')"),
    (
        "qasm_other_version",
        "leona_submit('OPENQASM 4;\\nqubit[1] q;\\nbit[1] c;\\nc[0] = measure q[0];\\n')",
    ),
    ("no_qubits_text", "leona_submit('OPENQASM 3;\\nbit[1] c;\\n')"),
    ("no_measure_text", "leona_submit('OPENQASM 3;\\nqubit[1] q;\\nh q[0];\\n')"),
    (
        "unbound",
        "from qiskit.circuit import Parameter\n"
        "p = QuantumCircuit(1)\np.rx(Parameter('theta'), 0)\np.measure_all()\nleona_submit(p)",
    ),
    ("no_measure", "m = QuantumCircuit(1)\nm.h(0)\nleona_submit(m)"),
    ("empty", "leona_submit(QuantumCircuit())"),
    ("too_long", f"leona_submit('{_LONG_BODY}' + 'x q[0];\\n' * 26_000 + '{_MEASURE}')"),
    # Fits one request (72,000 characters) but not the notebook's total budget.
    ("over_total", f"leona_submit('{_LONG_BODY}' + 'x q[0];\\n' * 9_000 + '{_MEASURE}')"),
    # Eight successful requests, then the ninth is refused: the per-notebook ceiling.
    ("over_count", "for _ in range(9):\n    leona_submit(bell, shots=1)"),
)


def _local_outcomes() -> dict[str, tuple[str, str] | None]:
    """Run the REFUSALS cells in one namespace, in order, against the local builder."""
    ledger = HardwareLedger()

    def leona_submit(circuit, shots=1024, *, label=None):  # noqa: ANN001, ANN202
        return recorded_sentence(ledger.add(hardware_request(circuit, shots, label=label)))

    namespace: dict[str, object] = {"leona_submit": leona_submit}
    exec(BELL, namespace)  # noqa: S102 - test fixture source, the same the sandbox runs
    outcomes: dict[str, tuple[str, str] | None] = {}
    for cell_id, source in REFUSALS:
        try:
            exec(source, namespace)  # noqa: S102
        except Exception as exc:  # noqa: BLE001
            outcomes[cell_id] = (type(exc).__name__, str(exc))
        else:
            outcomes[cell_id] = None
    return outcomes


@pytest.fixture(scope="module")
def refusal_report() -> ExecutionReport:
    spec = parse_source(
        _notebook(("build", BELL, False), *((cid, src, True) for cid, src in REFUSALS))
    )
    return execute_in_local_sandbox(spec)


def test_every_cap_and_check_raises_a_clear_error_in_the_cell(refusal_report) -> None:
    by_id = refusal_report.by_id()
    for cell_id, _ in REFUSALS:
        cell = by_id[cell_id]
        assert cell.status == "error", (cell_id, cell)
        assert cell.error is not None and cell.error.evalue, cell_id
    # Nothing was truncated or half-recorded on the way to refusing.
    for cell_id, _ in REFUSALS:
        if cell_id != "over_count":
            assert by_id[cell_id].hardware_requests == [], cell_id
    assert len(by_id["over_count"].hardware_requests) == MAX_HARDWARE_REQUESTS_PER_NOTEBOOK
    errors = {
        cell_id: (by_id[cell_id].error.ename, by_id[cell_id].error.evalue)
        for cell_id, _ in REFUSALS
    }
    assert errors["shots_over"] == (
        "ValueError",
        "shots must be between 1 and 1,000,000; got 1000001.",
    )
    assert errors["shots_bool"] == ("TypeError", "shots must be a whole number, not bool.")
    assert errors["too_long"][1].startswith("This circuit is 208,0")
    assert errors["over_total"][1].startswith(
        "This notebook's hardware requests would come to 72,0"
    )
    assert errors["over_count"] == (
        "ValueError",
        "This notebook has already asked for 8 hardware runs, the most one notebook can ask for.",
    )
    assert "OpenQASM 2" in errors["qasm2"][1]
    assert "theta" in errors["unbound"][1]


def test_the_sandbox_and_the_local_builder_refuse_identically(refusal_report) -> None:
    """The two implementations cannot share source (see hardware.py), so this is what
    holds them together: the same cells, the same refusal, word for word."""
    by_id = refusal_report.by_id()
    sandbox = {
        cell_id: (by_id[cell_id].error.ename, by_id[cell_id].error.evalue)
        if by_id[cell_id].error
        else None
        for cell_id, _ in REFUSALS
    }
    assert sandbox == _local_outcomes()


def test_the_guard_still_refuses_a_forbidden_import_beside_a_leona_submit_call() -> None:
    spec = parse_source(_notebook(("sneaky", BELL + "import socket\nleona_submit(bell)", False)))
    with pytest.raises(NotebookGuardError) as info:
        compose_notebook_program(spec)
    assert set(info.value.violations) == {"sneaky"}
    assert any("socket" in v for v in info.value.violations["sneaky"])


def test_the_composed_setup_has_every_placeholder_filled() -> None:
    program = compose_notebook_program(parse_source(_notebook(("a", "x = 1", False))))
    assert "__HW_" not in program.trusted_setup
    assert '_majorana_namespace["leona_submit"] = _ln_submit' in program.trusted_setup


# --------------------------------------------------------------------------- the parse side


def _program_for(cell_ids: list[str]):
    spec = parse_source(_notebook(*((cid, "x = 1", False) for cid in cell_ids)))
    return spec, compose_notebook_program(spec)


def _observed(cells: list[dict]) -> dict:
    return {"notebook": {"cells": cells, "environment": {}, "stopped": False}}


def _raw_cell(cell_id: str, requests) -> dict:  # noqa: ANN001
    return {"id": cell_id, "status": "ok", "outputs": [], "hardware_requests": requests}


GOOD = {
    "qasm": "OPENQASM 3.0;\nqubit[1] q;\nbit[1] c;\nc[0] = measure q[0];\n",
    "shots": 10,
    "num_qubits": 1,
    "label": None,
}


def test_the_parse_side_rechecks_every_request_and_says_what_it_dropped() -> None:
    """The dicts were filled while untrusted code shared the process, so a forged or
    over-budget request must not survive into the report as if `_ln_submit` had made it."""
    spec, program = _program_for(["a", "b", "c"])
    forged = [
        GOOD,
        {**GOOD, "shots": 0},  # out of range
        {**GOOD, "qasm": "x" * 200_001},  # over the route's ceiling
        {**GOOD, "extra": 1},  # not a field the contract has
        "not a dict",
    ]
    report = report_from_observation(
        _observed([_raw_cell("a", forged), _raw_cell("b", [GOOD] * 9), _raw_cell("c", "junk")]),
        spec,
        program,
    )
    by_id = report.by_id()
    assert len(by_id["a"].hardware_requests) == 1
    assert "4 hardware request(s)" in by_id["a"].note
    # One already recorded on `a`, so `b` may add seven before the notebook's eight.
    assert len(by_id["b"].hardware_requests) == MAX_HARDWARE_REQUESTS_PER_NOTEBOOK - 1
    assert "2 hardware request(s)" in by_id["b"].note
    assert by_id["c"].hardware_requests == [] and "1 hardware request(s)" in by_id["c"].note


def test_the_parse_side_applies_the_notebook_total_budget() -> None:
    spec, program = _program_for(["a"])
    big = {**GOOD, "qasm": "O" * (MAX_HARDWARE_QASM_TOTAL_CHARS - 10)}
    report = report_from_observation(_observed([_raw_cell("a", [big, GOOD])]), spec, program)
    assert len(report.by_id()["a"].hardware_requests) == 1
    assert "1 hardware request(s)" in report.by_id()["a"].note


def test_a_report_stored_before_the_field_existed_still_parses() -> None:
    old = {"id": "c01", "status": "ok", "stdout": "", "stderr": "", "outputs": [], "error": None}
    assert CellResult.model_validate(old).hardware_requests == []
    stored = {"notebook_slug": "t", "ok": True, "runner": "sandbox", "cells": [old]}
    assert ExecutionReport.model_validate_json(json.dumps(stored)).cells[0].hardware_requests == []
    # And an observation from a sandbox program that predates `_ln_submit`.
    spec, program = _program_for(["a"])
    report = report_from_observation(
        _observed([{"id": "a", "status": "ok", "outputs": []}]), spec, program
    )
    assert report.by_id()["a"].hardware_requests == [] and report.by_id()["a"].note == ""


# --------------------------------------------------------------------------- local builder


def test_qasm_qubit_count_reads_every_declaration_form() -> None:
    assert qasm_qubit_count("qubit[3] a;\nqubit b;\nqreg c[2];\n") == 6
    assert qasm_qubit_count("h $0;\ncx $0, $3;\n") == 2
    assert qasm_qubit_count("bit[2] c;\n") == 0


def test_recorded_sentence_is_singular_where_it_should_be() -> None:
    one = hardware_request("OPENQASM 3;\nqubit[1] q;\nbit[1] c;\nc[0] = measure q[0];\n", 1)
    assert recorded_sentence(one) == (
        "Hardware request recorded: 1 qubit, 1 shot. Choose a device under this cell to run it."
    )
