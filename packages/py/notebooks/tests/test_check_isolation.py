"""Review round 2 of PR 1011, follow-up: one check's trouble stays with that check.

1. A check that runs out of memory takes only itself down; the checks after it are
   judged in a fresh child with what is left of the budget.
2. Broken-copy testing that would not fit in the memory headroom is refused before it
   starts, and a verdict whose broken copies were cut by a limit is final (cached).
3. Waiting for this process's judge slot is capped at the dispatch budget.
4. A reader adding or editing a citation on Nala's check does not make it theirs.

Probes: `r2_collateral.py`, `r2_b1_child.py` (session scratchpad). Children run one at a
time; nothing here simulates more than 10 qubits.
"""

from __future__ import annotations

import sys
import time

from qiskit import QuantumCircuit

from leona_notebooks.checks import CheckCapture, CheckJob, enforce_check_authorship, judge_checks
from leona_notebooks.spec import Cell, NotebookSpec
from majorana_contracts.notebooks import CheckProperty


def _spec_with(*cells: Cell) -> NotebookSpec:
    return NotebookSpec(
        slug="s", title="T", cells=[Cell(id="c01", kind="code", source="x = 1\n"), *cells]
    )


def _check(cell_id: str, **fields) -> Cell:
    return Cell(id=cell_id, kind="code", role="check", property=CheckProperty(**fields))


# --------------------------------------------------------------------------- 4. citations


def test_a_reader_citing_nalas_check_does_not_make_it_theirs() -> None:
    parent = _spec_with(_check("k01", kind="value", subject="x", value=1, author="nala"))
    cited = _check(
        "k01",
        kind="value",
        subject="x",
        value=1,
        author="source",
        citation="Nielsen and Chuang, eq. 4.2",
        accepted=True,
    )
    stamped = enforce_check_authorship(_spec_with(cited), parent, "user").cell_by_id("k01")
    prop = stamped.property
    assert prop is not None
    assert (prop.author, prop.accepted) == ("nala", True)
    assert prop.citation == "Nielsen and Chuang, eq. 4.2"
    edited = _check(
        "k01", kind="value", subject="x", value=1, citation="a different paper", accepted=False
    )
    again = enforce_check_authorship(_spec_with(edited), _spec_with(stamped), "user")
    prop = again.cell_by_id("k01").property
    assert prop is not None and (prop.author, prop.accepted, prop.citation) == (
        "nala",
        False,
        "a different paper",
    )


def test_nala_changing_a_citation_still_counts_as_a_change() -> None:
    """The asymmetry, kept on purpose (coordinator, 2026-09-25): Nala rewriting the
    provenance of a check a reader accepted makes it Nala's unaccepted proposal again."""
    parent = _spec_with(
        _check("k01", kind="value", subject="x", value=1, author="user", accepted=True)
    )
    recited = _check("k01", kind="value", subject="x", value=1, citation="made up")
    prop = enforce_check_authorship(_spec_with(recited), parent, "nala").cell_by_id("k01").property
    assert prop is not None and (prop.author, prop.accepted) == ("nala", False)


def test_a_source_check_whose_citation_a_reader_deletes_becomes_theirs() -> None:
    """Citation is left out of the reader's change test, so without a guard the stamp
    would keep `source` on a check that no longer has a citation, which the contract
    forbids (and `model_copy` does not re-validate)."""
    parent = _spec_with(
        _check("k01", kind="value", subject="x", value=1, author="source", citation="PRL 1")
    )
    uncited = _check("k01", kind="value", subject="x", value=1, author="user", accepted=True)
    stamped = enforce_check_authorship(_spec_with(uncited), parent, "user")
    prop = stamped.cell_by_id("k01").property
    assert prop is not None and prop.author == "user" and prop.citation == ""
    NotebookSpec.model_validate(stamped.model_dump())  # still a valid spec


# --------------------------------------------------------------------------- 3. the queue


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    return qc


def _jobs() -> list[CheckJob]:
    return [
        CheckJob(
            "k1",
            CheckProperty(kind="state", subject="b", reference="bell"),
            CheckCapture.from_circuit(_bell()),
        ),
        CheckJob(
            "k2", CheckProperty(kind="value", subject="v", value=1.0), CheckCapture.from_value(1.0)
        ),
    ]


async def test_waiting_for_the_judge_slot_is_capped_at_the_budget() -> None:
    """Round 2 (S3): judgements queued behind the one child a process runs waited without
    limit, about (N - 1) x 20 s. A call now waits at most its own budget for the slot."""
    import asyncio

    slow = [sys.executable, "-c", "import sys, time; sys.stdin.read(); time.sleep(4)"]
    first = asyncio.create_task(judge_checks(_jobs(), budget_s=6, _argv=slow))
    await asyncio.sleep(0.3)  # the first call now holds the slot
    started = time.monotonic()
    second = await judge_checks(_jobs(), budget_s=1)
    waited = time.monotonic() - started
    await first
    assert waited < 2.5, waited
    for result in second.values():
        assert result.verdict.status == "inconclusive"
        assert "busy checking other circuits" in result.verdict.detail
        assert result.final is False


# --------------------------------------------------------------------------- 1. one kill, one check

#: A stand-in child: judges nothing, but reports every job as passing, EXCEPT that on its
#: first start it announces `k2`, touches memory and kills itself, as the memory watch
#: would. The marker file makes the retry behave.
_DIES_AT_K2 = r"""
import json, os, signal, sys
marker = sys.argv[1]
payload = json.loads(sys.stdin.read())
ids = [job["id"] for job in payload["jobs"]]
def emit(event):
    print(json.dumps(event), flush=True)
emit({"event": "ready", "rss_bytes": 10**8})
for job_id in ids:
    emit({"event": "start", "id": job_id, "phase": "verdict"})
    if job_id == "k2" and not os.path.exists(marker):
        open(marker, "w").close()
        os.kill(os.getpid(), signal.SIGKILL)
    emit({"event": "verdict", "id": job_id,
          "verdict": {"status": "pass", "basis": "value", "measure": "stand-in"}})
emit({"event": "done"})
"""


def _three_jobs() -> list[CheckJob]:
    return [
        *_jobs()[:1],
        CheckJob(
            "k2", CheckProperty(kind="value", subject="w", value=2.0), CheckCapture.from_value(2.0)
        ),
        CheckJob(
            "k3", CheckProperty(kind="value", subject="v", value=1.0), CheckCapture.from_value(1.0)
        ),
    ]


async def test_a_check_that_kills_its_child_takes_only_itself_down(tmp_path) -> None:
    marker = tmp_path / "died-once"
    argv = [sys.executable, "-c", _DIES_AT_K2, str(marker)]
    judged = await judge_checks(_three_jobs(), budget_s=20, _argv=argv)
    assert marker.exists(), "the stand-in never died, so this tested nothing"
    assert judged["k1"].verdict.status == "pass"
    assert judged["k2"].verdict.status == "inconclusive"
    assert "ran out of memory" in judged["k2"].verdict.detail
    assert judged["k2"].final is True, "a memory limit is the check's own, and cached"
    assert judged["k3"].verdict.status == "pass", "judged again in a fresh child"


async def test_a_real_memory_hog_spares_the_checks_after_it() -> None:
    """`r2_collateral.py`: a 1-qubit circuit whose 11 nested gate definitions expand to
    2,048 applications (inside the static bound) runs the real child out of 16 MiB of
    headroom. The Bell and value checks after it are still judged."""
    lines = ["OPENQASM 3.0;", 'include "stdgates.inc";', "gate g0 a { x a; }"]
    lines += [f"gate g{d} a {{ g{d - 1} a; g{d - 1} a; }}" for d in range(1, 12)]
    lines += ["qubit[1] q;", "g11 q[0];"]
    heavy = CheckJob(
        "heavy",
        CheckProperty(kind="state", subject="a", reference="uniform(1)"),
        CheckCapture(kind="circuit", qasm="\n".join(lines) + "\n"),
    )
    judged = await judge_checks([heavy, *_jobs()], budget_s=30, memory_headroom_bytes=16 * 2**20)
    assert judged["k1"].verdict.status == "pass", judged["k1"].verdict.detail
    assert judged["k2"].verdict.status == "pass", judged["k2"].verdict.detail
    # Measured on an M1 Pro: the heavy check needs more than 16 MiB, and it alone is
    # blamed. If a platform ever judges it inside 16 MiB, the kill was not exercised here
    # (the stand-in test above covers that path deterministically).
    if judged["heavy"].verdict.status == "inconclusive":
        assert "ran out of memory" in judged["heavy"].verdict.detail
        assert "The other checks were still judged" in judged["heavy"].verdict.detail
        assert judged["heavy"].final is True


# --------------------------------------------------------------------------- 2. mutation and memory


def _passing(n: int, gates: int) -> QuantumCircuit:
    """A circuit that prepares the uniform state and then undoes every rotation it adds."""
    import random

    rng = random.Random(0)
    qc = QuantumCircuit(n)
    qc.h(range(n))
    while qc.size() + 2 <= gates:
        qubit = rng.randrange(n)
        angle = rng.uniform(0.1, 3)
        qc.rz(angle, qubit)
        qc.rz(-angle, qubit)
    return qc


def test_broken_copies_that_would_not_fit_in_memory_are_refused_before_they_start() -> None:
    """Round 2 (S2): a passing 10-qubit state check with 3,900 gates was inside every
    static cap and still ran its child out of 64 MiB during the broken copies. The guard
    now estimates that phase from its measured cost per gate and refuses it first. The
    headroom is lowered here so a 600-gate circuit shows the same thing cheaply."""
    from leona_notebooks import checks

    prop = CheckProperty(kind="state", subject="q", reference="uniform(10)")
    verdict = checks.evaluate_check(
        prop, CheckCapture.from_circuit(_passing(10, 600)), memory_headroom_bytes=8 * 2**20
    )
    assert verdict.status == "pass"
    assert verdict.teeth is not None and verdict.teeth.status == "not_measured"
    assert "too large to test with broken copies" in verdict.teeth.reason.lower()
    assert "memory" in verdict.teeth.reason
    roomy = checks.evaluate_check(
        prop, CheckCapture.from_circuit(_passing(10, 600)), memory_headroom_bytes=64 * 2**20
    )
    assert roomy.teeth is not None and roomy.teeth.status == "measured"


def test_teeth_refused_by_a_limit_are_final_and_teeth_cut_by_the_clock_are_not() -> None:
    import time as clock_module

    from leona_notebooks import checks

    job = CheckJob(
        "k",
        CheckProperty(kind="state", subject="q", reference="uniform(10)"),
        CheckCapture.from_circuit(_passing(10, 600)),
    )
    events = list(
        checks.judge_jobs(
            [job], deadline=clock_module.monotonic() + 60, memory_headroom_bytes=8 * 2**20
        )
    )
    [teeth_event] = [event for event in events if event[0] == "teeth"]
    assert teeth_event[2].status == "not_measured" and teeth_event[3] is True
    ticks = iter([0.0] * 3 + [10**9] * 50)
    cut = list(checks.judge_jobs([job], deadline=1.0, clock=lambda: next(ticks)))
    [cut_teeth] = [event for event in cut if event[0] == "teeth"]
    assert cut_teeth[2].status == "not_measured" and cut_teeth[3] is False


async def test_the_reviewers_3900_gate_check_keeps_its_verdict_and_is_cached() -> None:
    """`r2_b1_child.py flat 10 3900 pass`: with the default 64 MiB the broken copies are
    refused up front, so the child is never killed and the result is final."""
    job = CheckJob(
        "k",
        CheckProperty(kind="state", subject="q", reference="uniform(10)"),
        CheckCapture.from_circuit(_passing(10, 3900)),
    )
    judged = await judge_checks([job], budget_s=60)
    result = judged["k"]
    assert result.verdict.status == "pass", result.verdict.detail
    assert result.verdict.teeth is not None and result.verdict.teeth.status == "not_measured"
    assert "memory" in result.verdict.teeth.reason
    assert result.final is True
