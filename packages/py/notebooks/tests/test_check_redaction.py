"""Review round 1, blocker 2: in a notebook with anything secret (a solution, an answer, a
hidden grader, an exercise), a check's expectation IS the answer, and its verdict repeats
the solution's circuit. So it is a fifth way a secret can be represented, beside the four
`leaks_answer_key` already names, and every door a learner reads through must drop it
(owner ruling ai-ops 260). `probe_misc.py`, last section, is the reproduction.

The API's two doors (the public share, the workspace member's view) are tested in
`services/api/tests`; this file covers everything in the notebook package.
"""

from __future__ import annotations

from qiskit import QuantumCircuit

from leona_notebooks.checks import CheckCapture, apply_check_verdicts
from leona_notebooks.execution import ExecutionReport
from leona_notebooks.ipynb import cells_for_build, to_ipynb
from leona_notebooks.live_draft import LiveDraftGuard
from leona_notebooks.source import render_source
from leona_notebooks.spec import NotebookSpec

CHALLENGE = {
    "slug": "t",
    "title": "GHZ",
    "kind": "challenge",
    "cells": [
        {"id": "c01", "kind": "markdown", "role": "exercise", "source": "Build `qc`, a GHZ state."},
        {
            "id": "c02",
            "kind": "code",
            "role": "solution",
            "stub": "qc = None  # your circuit\n",
            "source": "from qiskit import QuantumCircuit\nqc = QuantumCircuit(3)\nqc.h(0)\nqc.cx(0, 1)\nqc.cx(1, 2)\n",
        },
        {
            "id": "k01",
            "kind": "code",
            "role": "check",
            "property": {"kind": "state", "subject": "qc", "reference": "ghz(3)"},
        },
        {
            "id": "k02",
            "kind": "code",
            "role": "check",
            "property": {"kind": "value", "subject": "answer", "value": 0.4375},
        },
    ],
}


def _challenge() -> NotebookSpec:
    return NotebookSpec.model_validate(CHALLENGE)


def _lesson() -> NotebookSpec:
    data = {**CHALLENGE, "kind": "lesson", "cells": [dict(CHALLENGE["cells"][0], role="concept")]}
    data["cells"] += [
        {"id": "c02", "kind": "code", "role": "run", "source": CHALLENGE["cells"][1]["source"]},
        CHALLENGE["cells"][2],
    ]
    return NotebookSpec.model_validate(data)


def test_the_learner_build_of_a_notebook_with_secrets_has_no_check_cells() -> None:
    learner = _challenge().for_learner()
    assert [cell.id for cell in learner.cells] == ["c01", "c02"]
    assert all(cell.property is None for cell in learner.cells)
    assert learner.leaks_answer_key() == []


def test_leaks_answer_key_names_a_check_that_survived_into_a_learner_build() -> None:
    spec = _challenge()
    assert set(spec.leaks_answer_key()) >= {"k01", "k02"}
    broken = spec.for_learner()
    broken = broken.with_cells([*broken.cells, spec.cell_by_id("k02")])
    assert "k02" in broken.leaks_answer_key()


def test_a_lesson_with_no_secrets_keeps_its_checks_for_every_reader() -> None:
    lesson = _lesson()
    learner = lesson.for_learner()
    assert "k01" in [cell.id for cell in learner.cells]
    assert learner.leaks_answer_key() == []


def test_the_learner_source_and_the_challenge_file_carry_no_expectation() -> None:
    learner = _challenge().for_learner()
    text = render_source(learner)
    assert "property=" not in text and "0.4375" not in text and "ghz(3)" not in text
    build = cells_for_build(_challenge(), "challenge")
    assert all(cell.property is None for cell in build)
    notebook = to_ipynb(_challenge(), build="challenge")
    dumped = str(notebook)
    assert "0.4375" not in dumped and "ghz(3)" not in dumped and "leona.property" not in dumped


def test_the_learner_report_drops_the_verdicts_of_hidden_checks() -> None:
    spec = _challenge()
    solution = QuantumCircuit(3)
    solution.h(0)
    solution.cx(0, 1)
    solution.cx(1, 2)
    report = ExecutionReport.model_validate(
        {
            "notebook_slug": "t",
            "runner": "sandbox",
            "ok": True,
            "cells": [{"id": c.id, "status": "ok"} for c in spec.cells if c.is_code],
        }
    )
    report = apply_check_verdicts(
        spec,
        report,
        {"k01": CheckCapture.from_circuit(solution), "k02": CheckCapture.from_value(0.4375)},
    )
    assert report.by_id()["k01"].check is not None  # the author's view keeps them
    learner = spec.learner_report(report)
    assert learner is not None
    assert {cell.id for cell in learner.cells} == {"c02"}
    assert "cx" not in learner.model_dump_json()


def test_a_lessons_learner_report_keeps_its_verdicts() -> None:
    lesson = _lesson()
    ghz = QuantumCircuit(3)
    ghz.h(0)
    ghz.cx(0, 1)
    ghz.cx(1, 2)
    report = ExecutionReport.model_validate(
        {
            "notebook_slug": "t",
            "runner": "sandbox",
            "ok": True,
            "cells": [{"id": c.id, "status": "ok"} for c in lesson.cells if c.is_code],
        }
    )
    report = apply_check_verdicts(lesson, report, {"k01": CheckCapture.from_circuit(ghz)})
    assert lesson.learner_report(report) == report
    assert lesson.learner_report(None) is None


def test_the_live_draft_stream_withholds_every_check_cell() -> None:
    """A check can arrive in the stream before the solution it gives away, so the guard
    cannot know yet whether it is secret. It withholds them all; the parsed event that
    follows the draft releases the ones `for_learner` keeps."""
    guard = LiveDraftGuard()
    text = (
        "# %% role=run\nqc = 1\n"
        '# %% role=check property={"kind":"value","subject":"qc","value":0.4375}\n'
        "# check: qc equals 0.4375\n"
        "# %% role=run\nprint(qc)\n"
    )
    released = guard.feed(text) + guard.flush()
    assert "0.4375" not in released
    assert "print(qc)" in released
