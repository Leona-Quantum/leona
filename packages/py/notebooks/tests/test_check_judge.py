"""Review round 1, blocker 1(c): every check of a dispatch is judged in ONE child process
that the parent can kill, with a hard wall clock and a memory cap, so nothing a check
does can hang or kill the single worker (`probe_budget.py`, `probe_loop.py`).

Each test starts at most one child at a time. The child imports Qiskit (about 120 MiB,
about 1 s here); the failure-path tests use a stand-in child that imports nothing.
"""

from __future__ import annotations

import sys
import time

import pytest
from qiskit import QuantumCircuit

from leona_notebooks.checks import CheckCapture, CheckJob, judge_checks
from majorana_contracts.notebooks import CheckProperty


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    return qc


def _jobs() -> list[CheckJob]:
    flipped = _bell()
    flipped.z(1)
    return [
        CheckJob(
            "k1",
            CheckProperty(kind="state", subject="bell", reference="bell"),
            CheckCapture.from_circuit(_bell()),
        ),
        CheckJob(
            "k2",
            CheckProperty(kind="state", subject="bell", reference="bell"),
            CheckCapture.from_circuit(flipped),
        ),
        CheckJob(
            "k3", CheckProperty(kind="value", subject="p", value=0.5), CheckCapture.from_value(0.5)
        ),
    ]


async def test_the_real_child_judges_every_check_with_teeth() -> None:
    started = time.monotonic()
    judged = await judge_checks(_jobs(), budget_s=30)
    assert time.monotonic() - started < 30
    assert judged["k1"].verdict.status == "pass"
    assert (
        judged["k1"].verdict.teeth is not None and judged["k1"].verdict.teeth.status == "measured"
    )
    assert judged["k2"].verdict.status == "fail" and "wrong phase" in judged["k2"].verdict.detail
    assert judged["k3"].verdict.status == "pass" and judged["k3"].verdict.basis == "value"


async def test_a_child_that_runs_past_the_budget_is_killed_and_nothing_hangs() -> None:
    sleeper = [sys.executable, "-c", "import time, sys; sys.stdin.read(); time.sleep(60)"]
    started = time.monotonic()
    judged = await judge_checks(_jobs(), budget_s=1.5, _argv=sleeper)
    assert time.monotonic() - started < 10
    for result in judged.values():
        assert result.verdict.status == "inconclusive"
        assert "took too long to check" in result.verdict.detail


async def test_verdicts_that_arrived_before_the_kill_are_kept() -> None:
    import json

    line = json.dumps(
        {
            "event": "verdict",
            "id": "k1",
            "verdict": {"status": "pass", "basis": "circuit", "measure": "fidelity 1"},
        }
    )
    partial = [
        sys.executable,
        "-c",
        f"import sys, time; sys.stdin.read(); print({line!r}, flush=True); time.sleep(60)",
    ]
    judged = await judge_checks(_jobs(), budget_s=1.5, _argv=partial)
    assert judged["k1"].verdict.status == "pass"
    assert judged["k1"].verdict.teeth is not None
    assert judged["k1"].verdict.teeth.status == "not_measured"
    assert "took too long" in judged["k1"].verdict.teeth.reason
    assert judged["k2"].verdict.status == "inconclusive"


async def test_a_child_that_dies_says_so_instead_of_inventing_a_verdict() -> None:
    dies = [
        sys.executable,
        "-c",
        "import os, signal, sys; sys.stdin.read(); os.kill(os.getpid(), signal.SIGKILL)",
    ]
    judged = await judge_checks(_jobs(), budget_s=10, _argv=dies)
    for result in judged.values():
        assert result.verdict.status == "inconclusive"
        assert "ran out of memory" in result.verdict.detail


async def test_the_child_gets_no_secrets_from_the_parents_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    monkeypatch.setenv("DATABASE_URL", "postgres://secret")
    probe = [
        sys.executable,
        "-c",
        "import os, sys, json; sys.stdin.read(); "
        "print(json.dumps({'event': 'env', 'keys': sorted(os.environ)}), flush=True)",
    ]
    seen: list[list[str]] = []
    await judge_checks(
        _jobs(), budget_s=5, _argv=probe, _on_event=lambda e: seen.append(e.get("keys", []))
    )
    assert seen and "DATABASE_URL" not in seen[0]
    assert "OPENBLAS_NUM_THREADS" in seen[0]
    del json


@pytest.mark.skipif(
    not sys.platform.startswith("linux"), reason="RLIMIT_AS is enforced on Linux only"
)
async def test_a_check_that_needs_more_memory_than_the_cap_is_inconclusive() -> None:
    """A 22-qubit statevector is 64 MiB. With 16 MiB of headroom over the child's own
    footprint, numpy's allocation is refused and the verdict says so. On macOS the kernel
    ignores RLIMIT_AS, so this runs in CI (Linux) only."""
    ghz = QuantumCircuit(22)
    ghz.h(0)
    for target in range(1, 22):
        ghz.cx(0, target)
    job = CheckJob(
        "big",
        CheckProperty(kind="state", subject="ghz", reference="ghz(22)"),
        CheckCapture.from_circuit(ghz),
    )
    judged = await judge_checks([job], budget_s=30, memory_headroom_bytes=16 * 2**20)
    assert judged["big"].verdict.status == "inconclusive"
    assert "ran out of memory" in judged["big"].verdict.detail


async def test_unreadable_qasm_is_reported_apart_from_inconclusive() -> None:
    """The connector route answers 400 with the parser's words for a program that does not
    parse, so the judge says which side did not parse and why."""
    bad_subject = CheckJob(
        "s",
        CheckProperty(kind="state", subject="qc", reference="bell"),
        CheckCapture(kind="circuit", qasm="OPENQASM 3.0;\nqubit[2] q;\nh q[0]\n"),
    )
    bad_reference = CheckJob(
        "r",
        CheckProperty(kind="state", subject="qc", reference_qasm="OPENQASM 3.0; qubit[2] q; h q[0"),
        CheckCapture.from_circuit(_bell()),
    )
    judged = await judge_checks([bad_subject, bad_reference], budget_s=30)
    assert judged["s"].verdict.status == "inconclusive"
    assert judged["s"].unreadable is not None and judged["s"].unreadable.side == "subject"
    assert "L4" in judged["s"].unreadable.message or "unexpected" in judged["s"].unreadable.message
    assert judged["r"].unreadable is not None and judged["r"].unreadable.side == "reference"


async def test_a_child_that_crashes_says_so_and_blames_nothing_else() -> None:
    crashes = [sys.executable, "-c", "import sys; sys.stdin.read(); raise SystemExit(3)"]
    judged = await judge_checks(_jobs(), budget_s=10, _argv=crashes)
    for result in judged.values():
        assert result.verdict.status == "inconclusive"
        assert "stopped unexpectedly" in result.verdict.detail
        assert "memory" not in result.verdict.detail
        assert result.final is False
