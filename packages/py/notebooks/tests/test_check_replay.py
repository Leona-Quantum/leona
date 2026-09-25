"""Check cells and dependency-graph replay (PR 1012) in one tree. The planner treats a
check cell as a barrier READER and hashes its property, minus `author` and `accepted`,
into the cell's cache key. So pressing Accept re-runs nothing, and changing what a
check judges re-runs that check and the cells it reads, never the cells after it."""

from __future__ import annotations

from leona_notebooks.checks import enforce_check_authorship
from leona_notebooks.dependencies import cache_keys, plan_run
from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.source import parse_source

NOTEBOOK = """\
# ---
# title: Replay and checks
# ---
# %% id=c01
from qiskit import QuantumCircuit
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)
# %% id=k01 role=check property={"kind":"state","subject":"bell","reference":"bell"}
# %% id=c02
print("after the check")
"""


def _proposed():
    return enforce_check_authorship(parse_source(NOTEBOOK), None, "nala")


def _report(spec) -> ExecutionReport:
    keys = cache_keys(spec)
    return ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[
            CellResult(id=cell.id, status="ok", cache_key=keys[cell.id])
            for cell in spec.code_cells()
        ],
    )


def _accepted(spec):
    cells = [
        cell.model_copy(update={"property": cell.property.model_copy(update={"accepted": True})})
        if cell.property is not None
        else cell
        for cell in spec.cells
    ]
    return enforce_check_authorship(spec.with_cells(cells), spec, "user")


def test_accepting_a_check_changes_no_cache_key_and_re_runs_nothing() -> None:
    parent = _proposed()
    accepted = _accepted(parent)
    assert accepted.cell_by_id("k01").property.accepted is True
    assert accepted.cell_by_id("k01").property.author == "nala"
    assert accepted.cell_by_id("k01").source == parent.cell_by_id("k01").source
    assert cache_keys(accepted) == cache_keys(parent)
    plan = plan_run(accepted, parent, _report(parent))
    assert plan.execute == frozenset()
    assert set(plan.reused) == {"c01", "k01", "c02"}


def test_changing_what_a_check_judges_re_runs_the_check_and_what_it_reads() -> None:
    """The check re-captures its subject, so the cell that defines `bell` runs again with
    it (DESIGN §3: the dependencies of everything re-run). Nothing after the check does."""
    parent = _proposed()
    cell = parent.cell_by_id("k01")
    tighter = cell.model_copy(
        update={"property": cell.property.model_copy(update={"tolerance": 1e-9})}
    )
    edited = enforce_check_authorship(
        parent.with_cells([tighter if c.id == "k01" else c for c in parent.cells]), parent, "user"
    )
    before, after = cache_keys(parent), cache_keys(edited)
    assert after["k01"] != before["k01"]
    assert after["c01"] == before["c01"] and after["c02"] == before["c02"]
    plan = plan_run(edited, parent, _report(parent))
    assert plan.execute == frozenset({"c01", "k01"})
    assert set(plan.reused) == {"c02"}
