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
