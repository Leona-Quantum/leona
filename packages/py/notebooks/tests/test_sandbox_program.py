"""The program that runs cells in the sandbox: composition, guard, and a real run
through `LocalSubprocessSandbox` (the product's path minus the microVM)."""

from __future__ import annotations

import asyncio
import base64
import tempfile
from pathlib import Path

import pytest
from majorana_sandbox import run as sandbox_run
from majorana_sandbox.local import LocalSubprocessSandbox

from leona_notebooks import (
    NotebookGuardError,
    compose_notebook_program,
    parse_source,
    report_from_sandbox_result,
)
from leona_notebooks.sandbox_program import (
    build_execution_spec,
    prepare_cell_source,
    rewrite_last_expression,
    strip_magics,
)


def _run(spec, **kwargs):
    program = compose_notebook_program(spec, **kwargs)
    with tempfile.TemporaryDirectory() as tmp:
        exec_spec = build_execution_spec(
            # The sandbox ceiling, not a duration: under a loaded CI runner a starved
            # subprocess must not read as a failed notebook.
            program,
            timeout_s=120,
            protected_result_path=str(Path(tmp) / "obs.json"),
        )
        result = asyncio.run(sandbox_run(LocalSubprocessSandbox(), exec_spec))
    return program, result, report_from_sandbox_result(result, spec, program)


# --------------------------------------------------------------------------- source prep


def test_rewrite_wraps_trailing_expression_only() -> None:
    assert rewrite_last_expression("x = 1\nx + 1\n") == "x = 1\n__leona_display__(x + 1)\n"
    assert rewrite_last_expression("x = 1\n") == "x = 1\n"
    assert rewrite_last_expression("x = 1\nx;\n") == "x = 1\nx;\n"
    assert rewrite_last_expression("'''doc'''\n") == "'''doc'''\n"
    multi = "counts = {\n  'a': 1,\n}\ncounts\n# trailing comment\n"
    assert (
        rewrite_last_expression(multi)
        == "counts = {\n  'a': 1,\n}\n__leona_display__(counts)\n# trailing comment\n"
    )
    assert rewrite_last_expression("def broken(:\n") == "def broken(:\n"


def test_magics_are_stripped_and_cell_magics_skip_the_cell() -> None:
    assert strip_magics("%matplotlib inline\nimport numpy\n!pip install x\n") == (
        "import numpy\n",
        False,
    )
    assert strip_magics("%%time\nx = 1\n") == ("", True)
    assert strip_magics("%matplotlib inline\n") == ("", False)


def test_prepare_skips_non_executing_cells_with_a_reason() -> None:
    spec = parse_source(
        '# ---\n# title: T\n# ---\n# %% execute=false\nimport os\n# %% tags=["skip-execution"]\nx=1\n# %%\n%%time\ny=2\n'
    )
    assert prepare_cell_source(spec.cells[0]) == ("", "execute=false")
    assert prepare_cell_source(spec.cells[1]) == ("", "tagged skip-execution")
    assert prepare_cell_source(spec.cells[2])[1] == "cell magic (%%) is not plain Python"


# --------------------------------------------------------------------------- guard


def test_guard_runs_on_every_cell_before_composition() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %%\nimport numpy\n# %%\nimport subprocess\nsubprocess.run(['ls'])\n# %%\nopen('/etc/passwd')\n"
    )
    with pytest.raises(NotebookGuardError) as info:
        compose_notebook_program(spec)
    assert set(info.value.violations) == {"c02", "c03"}
    assert any("subprocess" in v for v in info.value.violations["c02"])
    assert "denied_call:open" in info.value.violations["c03"]


def test_execute_false_cells_are_not_guarded_and_not_run() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% execute=false\nimport os\nprint(os.environ)\n# %%\nprint('hi')\n"
    )
    program = compose_notebook_program(spec)
    assert program.cell_ids == ("c02",)
    assert program.skipped == {"c01": "execute=false"}


def test_only_restricts_the_program_to_exactly_that_set_in_document_order() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% id=c01\nx = 1\n# %% id=c02\ny = 2\n# %% id=c03\nz = 3\n"
    )
    program = compose_notebook_program(spec, only={"c01", "c03"})
    assert program.cell_ids == ("c01", "c03")
    assert program.not_run == {"c02": "unchanged, reusing an earlier result"}
    assert program.skipped == {}


def test_only_does_not_override_a_structural_skip_reason() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% id=c01 execute=false\nimport os\n# %% id=c02\nx = 1\n"
    )
    # c01 would never run regardless of `only` — the skip reason stays the real one.
    program = compose_notebook_program(spec, only={"c01", "c02"})
    assert program.skipped == {"c01": "execute=false"}
    assert program.cell_ids == ("c02",)


def test_only_never_widens_what_run_until_would_have_included() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% id=c01\nx = 1\n# %% id=c02\ny = 2\n# %% id=c03\nz = 3\n"
    )
    # c03 is past the run_until cut, so it is `not_run` with the RUN_UNTIL reason
    # even though it is also named in `only`.
    program = compose_notebook_program(spec, run_until="c02", only={"c01", "c03"})
    assert program.cell_ids == ("c01",)
    assert program.not_run == {
        "c02": "unchanged, reusing an earlier result",
        "c03": "after the cell you ran to",
    }


def test_only_still_guards_every_cell_it_composes() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% id=c01\nimport subprocess\n# %% id=c02\nx = 1\n"
    )
    with pytest.raises(NotebookGuardError) as info:
        compose_notebook_program(spec, only={"c01", "c02"})
    assert set(info.value.violations) == {"c01"}


def test_omitting_only_keeps_run_until_behaviour_identical() -> None:
    spec = parse_source("# ---\n# title: T\n# ---\n# %% id=c01\nx = 1\n# %% id=c02\ny = 2\n")
    with_default = compose_notebook_program(spec)
    explicit_none = compose_notebook_program(spec, only=None)
    assert with_default == explicit_none


def test_composed_code_never_contains_a_denied_call_of_its_own() -> None:
    from majorana_sandbox.guard import check_python_code

    spec = parse_source("# ---\n# title: T\n# ---\n# %%\nx = 1\nx\n")
    program = compose_notebook_program(spec)
    assert check_python_code(program.code).ok, program.code


# --------------------------------------------------------------------------- a real run


def test_a_notebook_runs_and_every_cell_is_accounted_for() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n"
        "# %% [markdown]\n# prose\n"
        "# %% id=setup\nimport math\nprint('setup done')\n"
        "# %% id=value\nmath.pi\n"
        "# %% id=quiet\nx = 2\n"
        "# %% id=err\nraise ValueError('boom')\n"
        "# %% id=after\nprint('never')\n"
    )
    program, result, report = _run(spec)
    assert result.ok, result.stderr
    assert report.runner == "sandbox"
    by_id = report.by_id()
    assert by_id["setup"].status == "ok" and by_id["setup"].stdout == "setup done\n"
    assert by_id["value"].outputs[0].mime == "text/plain" and by_id["value"].outputs[
        0
    ].data.startswith("3.14159")
    assert by_id["quiet"].outputs == []
    assert by_id["err"].status == "error" and by_id["err"].error is not None
    assert by_id["err"].error.ename == "ValueError" and by_id["err"].error.evalue == "boom"
    assert by_id["after"].status == "not_run"
    assert report.ok is False
    assert report.first_error().id == "err"
    assert report.environment["python"]
    assert [c.execution_count for c in report.cells] == [1, 2, 3, 4, None]


_QASM_ONE_QUBIT_MEASURED = "OPENQASM 3;\nqubit[1] q;\nbit[1] c;\nc[0] = measure q[0];\n"

#: Five `leona_submit` calls, each guarded so a refusal (the sandbox's own
#: `_ln_hw_state` cap, seeded from `reused_hardware_request_count`) is observed as
#: a caught exception rather than stopping the cell — lets a single cell attempt
#: all 5 and show exactly how many the notebook-wide cap actually let through.
_FIVE_GUARDED_SUBMITS = "\n".join(
    f"try:\n    leona_submit({_QASM_ONE_QUBIT_MEASURED!r})\nexcept ValueError as _e:\n    print('refused:', _e)"
    for _ in range(5)
)


def test_reused_hardware_requests_count_toward_the_notebook_wide_cap() -> None:
    """S2 regression, end to end through the real sandbox: `MAX_HARDWARE_REQUESTS_PER_NOTEBOOK`
    (8) is a notebook-wide ceiling, not a per-dispatch one — a replay dispatch that
    only sees ITS OWN fresh cells must still be told what cells REUSED from the
    parent already spent. 5 reused + 5 attempted fresh in one cell: only 3 of the
    5 fresh calls fit under the cap (5 + 3 = 8); the sandbox's own `leona_submit`
    refuses the other 2 (a `ValueError`, the same one an ordinary over-cap
    notebook already raises). Without `reused_hardware_request_count` reaching
    `_ln_hw_state`, all 5 would be accepted (5 + 5 = 10, over the cap) — the exact
    bug S2 closes."""
    spec = parse_source(f"# ---\n# title: T\n# ---\n# %% id=c1\n{_FIVE_GUARDED_SUBMITS}\n")
    program, result, report = _run(spec, reused_hardware_request_count=5)
    assert result.ok, result.stderr
    assert program.reused_hardware_request_count == 5
    c1 = report.by_id()["c1"]
    assert c1.status == "ok"
    assert len(c1.hardware_requests) == 3
    assert c1.stdout.count("refused:") == 2


def test_no_reused_hardware_carryover_by_default_matches_existing_behaviour() -> None:
    """A control for the S2 change: an ordinary (non-replay) dispatch — the
    default `reused_hardware_request_count=0` every non-author caller gets —
    still fits all 5 requests under the cap of 8, same as before this field
    existed."""
    spec = parse_source(f"# ---\n# title: T\n# ---\n# %% id=c1\n{_FIVE_GUARDED_SUBMITS}\n")
    _, result, report = _run(spec)
    assert result.ok, result.stderr
    c1 = report.by_id()["c1"]
    assert len(c1.hardware_requests) == 5
    assert "refused:" not in c1.stdout


def test_worker_side_ledger_independently_enforces_the_seeded_cap() -> None:
    """The WORKER-side re-validation (`_HardwareReadLedger`, via
    `report_from_observation`) must apply the SAME notebook-wide cap on its own —
    "nothing recorded there is taken on faith" — not merely inherit correctness
    from the sandbox's own (in-process, therefore tamperable) counter. Built
    directly from a crafted observation carrying MORE raw hardware-request dicts
    than the seeded cap allows, bypassing `leona_submit` entirely, so this is
    independent of whether the sandbox's own gate worked."""
    from leona_notebooks.execution import HardwareRequest
    from leona_notebooks.sandbox_program import compose_notebook_program, report_from_observation

    spec = parse_source("# ---\n# title: T\n# ---\n# %% id=c1\nx = 1\n")
    program = compose_notebook_program(spec, reused_hardware_request_count=6)
    raw_request = HardwareRequest(qasm=_QASM_ONE_QUBIT_MEASURED, shots=1, num_qubits=1).model_dump(
        mode="json"
    )
    observation = {
        "notebook": {
            "cells": [
                {
                    "id": "c1",
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "outputs": [],
                    "error": None,
                    "duration_ms": 1,
                    "execution_count": 1,
                    "note": "",
                    # 4 raw requests reported, seeded at 6 already spent: only 2
                    # fit (6 + 2 = 8), regardless of what the sandbox itself did
                    # or did not enforce.
                    "hardware_requests": [raw_request] * 4,
                }
            ],
            "environment": {},
            "image_bytes": 0,
            "dropped_bytes": 0,
            "stopped": False,
        }
    }
    report = report_from_observation(observation, spec, program)
    c1 = report.by_id()["c1"]
    assert len(c1.hardware_requests) == 2
    assert "2 hardware request(s)" in c1.note and "left out" in c1.note


def test_raises_exception_tag_continues_past_the_error() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n"
        '# %% id=err tags=["raises-exception"]\n1/0\n'
        "# %% id=after\nprint('still here')\n"
    )
    _, _, report = _run(spec)
    by_id = report.by_id()
    assert by_id["err"].status == "error" and by_id["err"].error.ename == "ZeroDivisionError"
    assert by_id["after"].status == "ok" and by_id["after"].stdout == "still here\n"
    assert report.ok is True


def test_display_and_stdout_are_captured_per_cell_and_stderr_separately() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n"
        "# %% id=a\nimport warnings\nprint('to out')\nwarnings.warn('to err')\ndisplay({'k': 1})\n"
        "# %% id=b\nprint('b')\n"
    )
    _, _, report = _run(spec)
    a, b = report.by_id()["a"], report.by_id()["b"]
    assert a.stdout == "to out\n" and "to err" in a.stderr
    assert a.outputs[0].data == "{'k': 1}"
    assert b.stdout == "b\n" and b.outputs == []


def test_long_stdout_is_truncated_and_counted() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% id=a\nfor i in range(5000):\n    print('line', i)\n"
    )
    _, _, report = _run(spec)
    cell = report.by_id()["a"]
    assert cell.stdout.endswith("…[output truncated]\n")
    assert report.dropped_bytes > 0


def test_a_hard_crash_is_reported_not_faked() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n# %% id=a\nraise SystemExit(3)\n# %% id=b\nprint('x')\n"
    )
    _, result, report = _run(spec)
    # SystemExit is a BaseException: the runner records it and stops, and the process
    # then exits normally because the exception was caught.
    assert report.by_id()["a"].status == "error"
    assert report.by_id()["a"].error.ename == "SystemExit"
    assert report.by_id()["b"].status == "not_run"


matplotlib = pytest.importorskip("matplotlib")


def test_matplotlib_figures_come_back_as_png_and_are_budgeted() -> None:
    spec = parse_source(
        "# ---\n# title: T\n# ---\n"
        "# %% id=fig\nimport matplotlib.pyplot as plt\nplt.plot([0, 1], [0, 1])\nprint('plotted')\n"
        "# %% id=returned\nimport matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([1, 2])\nfig\n"
        "# %% id=none\nprint('no figure')\n"
    )
    _, _, report = _run(spec)
    by_id = report.by_id()
    png = by_id["fig"].outputs[0]
    assert png.mime == "image/png" and base64.b64decode(png.data)[:8] == b"\x89PNG\r\n\x1a\n"
    assert by_id["fig"].stdout == "plotted\n"
    # a returned figure is shown once, not once by display and once by harvest
    assert [o.mime for o in by_id["returned"].outputs] == ["image/png"]
    assert by_id["none"].outputs == []
    assert report.environment.get("figures") == "png"

    # a tiny budget drops the image and says so
    _, _, small = _run(spec, image_budget_bytes=100)
    dropped = small.by_id()["fig"].outputs[0]
    assert dropped.mime == "image/png" and dropped.data == "" and dropped.truncated
    assert dropped.original_bytes and dropped.original_bytes > 100
    assert small.dropped_bytes >= dropped.original_bytes
