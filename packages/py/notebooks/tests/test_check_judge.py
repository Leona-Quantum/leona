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
    """An 18-qubit statevector is 4 MiB, and a judgement holds several. With 1 MiB of
    headroom over the child's own footprint, the allocation is refused (RLIMIT_AS) or the
    parent's watch kills the child, and either way the verdict says so. On macOS the
    kernel ignores RLIMIT_AS, so this runs in CI (Linux) only."""
    ghz = QuantumCircuit(18)
    ghz.h(0)
    for target in range(1, 18):
        ghz.cx(0, target)
    job = CheckJob(
        "big",
        CheckProperty(kind="state", subject="ghz", reference="ghz(18)"),
        CheckCapture.from_circuit(ghz),
    )
    judged = await judge_checks([job], budget_s=30, memory_headroom_bytes=1 * 2**20)
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


_GROWS = (
    "import sys, json, resource, time, os\n"
    "sys.stdin.read()\n"
    "try:\n"
    "    rss = int(open('/proc/self/statm').read().split()[1]) * os.sysconf('SC_PAGE_SIZE')\n"
    "except OSError:\n"
    "    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss\n"
    "print(json.dumps({'event': 'ready', 'rss_bytes': rss}), flush=True)\n"
    "block = bytearray(96 * 2**20)\n"
    "for i in range(0, len(block), 4096):\n"
    "    block[i] = 1\n"
    "time.sleep(30)\n"
)


async def test_the_parent_kills_a_child_that_outgrows_its_memory_on_any_platform() -> None:
    """The coordinator's backstop: RLIMIT_AS is ignored on macOS, so the parent also reads
    the child's resident size and kills it above footprint + headroom. The stand-in child
    touches 96 MiB against 16 MiB of headroom (light, and far from the container's limit)."""
    samples: list[dict] = []
    started = time.monotonic()
    judged = await judge_checks(
        _jobs(),
        budget_s=20,
        memory_headroom_bytes=16 * 2**20,
        _argv=[sys.executable, "-c", _GROWS],
        _on_event=lambda event: samples.append(event) if event.get("event") == "watch" else None,
    )
    assert time.monotonic() - started < 15, (
        f"killed by the clock, not the memory watch; last watch samples: {samples[-5:]}"
    )
    for result in judged.values():
        assert result.verdict.status == "inconclusive"
        assert "ran out of memory" in result.verdict.detail


async def test_the_same_child_within_its_headroom_is_left_alone() -> None:
    quick = _GROWS.replace("time.sleep(30)", "print(json.dumps({'event': 'done'}), flush=True)")
    judged = await judge_checks(
        _jobs(), budget_s=20, memory_headroom_bytes=512 * 2**20, _argv=[sys.executable, "-c", quick]
    )
    # the stand-in judged nothing, so every job is filled in, but NOT as out of memory
    for result in judged.values():
        assert "ran out of memory" not in result.verdict.detail


def test_the_headroom_defaults_to_64_mib_and_the_environment_can_change_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from leona_notebooks.checks import CHECK_MEMORY_HEADROOM_BYTES, check_judge_headroom_bytes

    monkeypatch.delenv("LEONA_CHECK_JUDGE_HEADROOM_MB", raising=False)
    assert CHECK_MEMORY_HEADROOM_BYTES == 64 * 2**20
    assert check_judge_headroom_bytes() == 64 * 2**20
    monkeypatch.setenv("LEONA_CHECK_JUDGE_HEADROOM_MB", "96")
    assert check_judge_headroom_bytes() == 96 * 2**20
    monkeypatch.setenv("LEONA_CHECK_JUDGE_HEADROOM_MB", "lots")
    assert check_judge_headroom_bytes() == 64 * 2**20


async def test_a_process_never_runs_two_judge_children_at_once() -> None:
    """The coordinator's guard: two concurrent calls against a slow stand-in child (1 s
    each) run one after the other, so the second finishes about a second after the first
    and the pair takes at least two seconds, not one."""
    import asyncio

    slow = [
        sys.executable,
        "-c",
        "import sys, time, json; sys.stdin.read(); time.sleep(1.0); "
        "print(json.dumps({'event': 'done'}), flush=True)",
    ]
    finished: list[float] = []

    async def one() -> None:
        await judge_checks(_jobs(), budget_s=10, _argv=slow)
        finished.append(time.monotonic())

    started = time.monotonic()
    await asyncio.gather(one(), one())
    assert time.monotonic() - started >= 1.9
    assert abs(finished[1] - finished[0]) >= 0.9


async def test_the_resident_size_reader_works_on_this_platform() -> None:
    """The watch is only as good as its reader: `/proc` on Linux, `ps` on macOS. Read this
    test process's own size, which is certainly over 10 MiB."""
    import os

    from leona_notebooks.checks import _resident_bytes

    resident = await _resident_bytes(os.getpid())
    assert resident is not None and resident > 10 * 2**20, resident


def test_the_child_reports_its_own_size_not_its_parents() -> None:
    """CI on Linux caught this: `ru_maxrss` carries across fork and exec, so a child of a
    790 MiB pytest worker reported 790 MiB as its own footprint and the watch allowed
    790 + 16. The child reads `/proc/self/statm` and `VmHWM` instead, where they exist."""
    import json
    import subprocess

    probe = (
        "import json; from leona_notebooks import check_judge as j; "
        "print(json.dumps([j._resident_now(), j._resident_peak()]))"
    )
    ballast = bytearray(200 * 2**20)  # make THIS process large before starting the child
    for i in range(0, len(ballast), 4096):
        ballast[i] = 1
    now, peak = json.loads(
        subprocess.run(
            [sys.executable, "-c", probe], capture_output=True, text=True, check=True
        ).stdout
    )
    del ballast
    assert now < 150 * 2**20 and peak < 150 * 2**20, (now, peak)
