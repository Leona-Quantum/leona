"""The child process that judges check cells: `python -m leona_notebooks.check_judge`.

Started by `leona_notebooks.checks.judge_checks`, once per dispatch, with every check of
that dispatch on stdin as one JSON object. It imports what judging needs, caps its own
address space (RLIMIT_AS, Linux) at its footprint plus the headroom it was given, and
writes one JSON line per event to stdout as each happens:

    {"event": "ready", "rss_bytes": ..., "memory_cap": "..."}
    {"event": "start", "id": ..., "phase": "verdict" | "teeth"}
    {"event": "verdict", "id": ..., "verdict": {...}, "unreadable": {...} | null, "final": ...}
    {"event": "teeth", "id": ..., "teeth": {...}, "final": ...}
    {"event": "done"}

Line by line, so the parent keeps every verdict that arrived before it had to kill the
child, and knows from the last "start" which check was running if it did. The parent validates each line against the contract; nothing here is trusted
beyond that.
"""

from __future__ import annotations

import json
import sys
import time


def _emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _resident_now() -> int:
    """This process's resident size NOW. On Linux from `/proc/self/statm`, never from
    `ru_maxrss`: Linux carries `ru_maxrss` across fork and exec from the parent, so a judge
    started by a 292 MiB worker (or a 790 MiB pytest worker, as CI showed) would report
    the PARENT's size as its own footprint, and the parent's watch would allow that much on
    top. macOS starts `ru_maxrss` afresh, and has no `/proc`."""
    import os
    import resource

    try:
        with open("/proc/self/statm", "rb") as handle:
            return int(handle.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError):
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return rss if sys.platform == "darwin" else rss * 1024


def _resident_peak() -> int:
    """This process's peak resident size: `VmHWM` on Linux (it starts afresh at exec,
    unlike `ru_maxrss`), `ru_maxrss` on macOS."""
    import resource

    try:
        with open("/proc/self/status", "rb") as handle:
            for line in handle:
                if line.startswith(b"VmHWM:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss if sys.platform == "darwin" else rss * 1024


def _address_space_bytes() -> int | None:
    """This process's virtual size (VmSize), the quantity RLIMIT_AS limits. Linux only."""
    try:
        with open("/proc/self/status", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("VmSize:"):
                    return int(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def _cap_memory(headroom: int) -> str:
    """Cap the address space at what the imports took plus `headroom`, and say what
    happened. Done AFTER the imports, so the cap never depends on how much address space
    Qiskit, numpy and scipy reserve on a given machine: the work a check does gets
    `headroom`, whatever the footprint was."""
    import resource

    if headroom <= 0:
        return "not set"
    footprint = _address_space_bytes()
    if footprint is None:
        return "not set: this platform does not report its address space"
    limit = footprint + headroom
    try:
        _, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard != resource.RLIM_INFINITY:
            limit = min(limit, hard)
        resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
    except (ValueError, OSError) as exc:
        return f"not set: {exc}"
    return f"{limit} bytes ({footprint} after imports + {headroom})"


def _warm_up(checks, CheckProperty) -> None:
    """Judge one tiny check of every kind, with its broken copies, before the footprint is
    measured. Qiskit, numpy and scipy load a lot lazily on first use (QFT synthesis, the
    `Operator` machinery, LAPACK for `eigvalsh`, the marginal-distribution code): measured
    on an M1 Pro, a 9-qubit unitary check whose own matrices are 4 MiB each grew the process
    by more than 64 MiB, almost all of it code and module state, which would have counted
    against the check's headroom. After this, the footprint includes all of it and the
    headroom measures the check's own work."""
    from qiskit import QuantumCircuit

    bell = QuantumCircuit(2)
    bell.h(0)
    bell.cx(0, 1)
    measured = bell.copy()
    measured.measure_all()
    qft = QuantumCircuit(2)
    qft.h(1)
    qft.cp(3.141592653589793 / 2, 0, 1)
    qft.h(0)
    qft.swap(0, 1)
    warm = [
        (CheckProperty(kind="state", subject="w", reference="bell"), bell),
        (CheckProperty(kind="unitary", subject="w", reference="qft(2)"), qft),
        (CheckProperty(kind="unitary", subject="w", reference="iqft(2)"), qft),  # a fail
        (
            CheckProperty(kind="distribution", subject="w", probabilities={"00": 0.5, "11": 0.5}),
            measured,
        ),
        (
            CheckProperty(
                kind="energy", subject="w", hamiltonian={"ZZ": -1.0, "XX": -1.0}, target="ground"
            ),
            bell,
        ),
        (CheckProperty(kind="state", subject="w", amplitudes={"01": 1}), bell),  # a fail
    ]
    for prop, circuit in warm:
        try:
            checks.evaluate_check(prop, checks.CheckCapture.from_circuit(circuit))
        except Exception:  # noqa: BLE001 - warming up must never stop the real work
            pass


def main() -> int:
    started = time.monotonic()
    payload = json.loads(sys.stdin.read())
    # Everything judging imports, BEFORE the cap, so the cap measures the work alone.
    import numpy  # noqa: F401
    import openqasm3  # noqa: F401
    import qiskit.qasm3  # noqa: F401
    import qiskit_qasm3_import  # noqa: F401
    from majorana_contracts.notebooks import CheckProperty
    from majorana_verification import statevector  # noqa: F401
    from qiskit.quantum_info import Operator, SparsePauliOp, Statevector  # noqa: F401

    from leona_notebooks import checks

    _warm_up(checks, CheckProperty)
    cap = _cap_memory(int(payload.get("memory_headroom_bytes") or 0))
    # The larger of now and the peak so far: the warm-up's transient peak is the footprint
    # the parent's watch should allow for, not a moment's lower reading after it.
    _emit(
        {"event": "ready", "rss_bytes": max(_resident_now(), _resident_peak()), "memory_cap": cap}
    )

    jobs = []
    for raw in payload.get("jobs", []):
        capture = dict(raw["capture"])
        if isinstance(capture.get("value"), list):
            capture["value"] = tuple(capture["value"])
        jobs.append(
            checks.CheckJob(
                id=raw["id"],
                property=CheckProperty.model_validate(raw["property"]),
                capture=checks.CheckCapture(**capture),
            )
        )
    # Stop starting new work a little before the parent's hard kill, so what is finished
    # gets written out rather than cut off mid-line.
    deadline = started + max(float(payload.get("budget_s") or 0) - 0.5, 0.5)
    events = checks.judge_jobs(
        jobs,
        deadline=deadline,
        teeth=bool(payload.get("teeth", True)),
        width_caps=payload.get("width_caps") or None,
        on_start=lambda job_id, phase: _emit({"event": "start", "id": job_id, "phase": phase}),
        memory_headroom_bytes=int(payload.get("memory_headroom_bytes") or 0) or None,
    )
    for event in events:
        kind, job_id, item = event[0], event[1], event[2]
        if kind == "verdict":
            _emit(
                {
                    "event": "verdict",
                    "id": job_id,
                    "verdict": item.verdict.model_dump(mode="json"),
                    "unreadable": (
                        {"side": item.unreadable.side, "message": item.unreadable.message}
                        if item.unreadable is not None
                        else None
                    ),
                    "final": item.final,
                }
            )
        else:
            _emit(
                {
                    "event": "teeth",
                    "id": job_id,
                    "teeth": item.model_dump(mode="json"),
                    "final": bool(event[3]),
                }
            )
    _emit({"event": "done", "peak_rss_bytes": _resident_peak()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
