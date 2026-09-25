"""The child process that judges check cells: `python -m leona_notebooks.check_judge`.

Started by `leona_notebooks.checks.judge_checks`, once per dispatch, with every check of
that dispatch on stdin as one JSON object. It imports what judging needs, caps its own
address space (RLIMIT_AS, Linux) at its footprint plus the headroom it was given, and
writes one JSON line per event to stdout as each happens:

    {"event": "ready", "rss_bytes": ..., "memory_cap": "..."}
    {"event": "verdict", "id": ..., "verdict": {...}, "unreadable": {...} | null, "final": ...}
    {"event": "teeth", "id": ..., "teeth": {...}}
    {"event": "done"}

Line by line, so the parent keeps every verdict that arrived before it had to kill the
child. The parent validates each line against the contract; nothing here is trusted
beyond that.
"""

from __future__ import annotations

import json
import sys
import time


def _emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


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

    cap = _cap_memory(int(payload.get("memory_headroom_bytes") or 0))
    import resource

    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_bytes = rss if sys.platform == "darwin" else rss * 1024
    _emit({"event": "ready", "rss_bytes": rss_bytes, "memory_cap": cap})

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
    )
    for kind, job_id, item in events:
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
            _emit({"event": "teeth", "id": job_id, "teeth": item.model_dump(mode="json")})
    _emit({"event": "done"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
