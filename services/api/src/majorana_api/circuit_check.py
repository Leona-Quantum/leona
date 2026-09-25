"""Judge one OpenQASM 3 circuit against one `CheckProperty`, for `POST /v1/checks/circuit`.

The judgement is the check-cell engine's, run in a killable child process with a hard
wall clock and a memory cap (`judge_checks`). The engine bounds the program from its
syntax tree before building anything, checks widths before simulating the circuit or its
expectation, and parses once. This module only picks the API's budget and memory
headroom, turns an unreadable program into the route's 400, and states the teeth when
none were tried.

**This process never parses the caller's OpenQASM.** Parsing, the syntax-tree bound, the
importer and the simulation all happen in the child `judge_checks` starts, so a slow path
in any of them is killed at `CIRCUIT_CHECK_KILL_AFTER_S` instead of holding the API.
`test_check_circuit_route.py` pins that by making every parser in THIS process raise.

**Widths are the engine's, inherited, not restated.** The route passes no `width_caps`,
so a circuit is judged up to the contract's own ceilings (`CHECK_STATE_MAX_QUBITS`,
`CHECK_DISTRIBUTION_MAX_QUBITS`, `CHECK_UNITARY_MAX_QUBITS`,
`MAX_CHECK_HAMILTONIAN_QUBITS`), which the engine sized to fit its child's memory
headroom. A route ceiling of its own could only drift from them.
"""

from __future__ import annotations

from leona_notebooks.checks import (
    CHECK_BUDGET_S,
    CheckCapture,
    CheckJob,
    judge_checks,
)
from majorana_contracts import CheckProperty, CheckTeeth, CheckVerdict
from majorana_contracts.notebooks import (
    CHECK_DISTRIBUTION_MAX_QUBITS,
    CHECK_STATE_MAX_QUBITS,
    CHECK_UNITARY_MAX_QUBITS,
    MAX_CHECK_HAMILTONIAN_QUBITS,
)

#: The child's soft deadline: verdicts first, then teeth until this passes.
CIRCUIT_CHECK_BUDGET_S = 10.0
#: The hard kill. Under the client's 60 s timeout with room for the queue and the
#: child's start-up.
CIRCUIT_CHECK_KILL_AFTER_S = 15.0
assert CIRCUIT_CHECK_BUDGET_S <= CHECK_BUDGET_S, "the route may not outspend a notebook run"

#: What the child may use beyond its own import footprint: `RLIMIT_AS` on Linux, and the
#: parent's RSS watch everywhere (the child is killed above footprint + headroom). The
#: arithmetic, with the production figures the coordinator measured in Cloud Monitoring
#: (hourly p99 over 3 days, relayed here, not measured by this lane): the instance is
#: 512 MiB and its p99 max use was 58.9%, about 302 MiB; a child is about 120 MiB after its
#: imports. 302 + 120 + 64 = 486 MiB fits once. Two children would be about 606 MiB,
#: which is why `routes/checks.py` admits one at a time.
CHILD_MEMORY_HEADROOM_BYTES = 64 * 2**20

#: The widest circuit judged, per kind: the contract's ceilings, which the engine applies
#: when no `width_caps` are passed. Listed for the route's docs and tests, never passed.
CEILINGS: dict[str, int] = {
    "state": CHECK_STATE_MAX_QUBITS,
    "distribution": CHECK_DISTRIBUTION_MAX_QUBITS,
    "energy": MAX_CHECK_HAMILTONIAN_QUBITS,
    "unitary": CHECK_UNITARY_MAX_QUBITS,
}


class QasmUnreadable(Exception):
    """The subject or reference does not parse, or the importer refuses it: the 400."""

    def __init__(self, message: str, *, reason: str = "qasm_unreadable") -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason


_TEETH_WHEN_ABSENT = {
    "fail": (
        "Broken copies are tried only on a check that passes. This one failed, so there "
        "was nothing to test."
    ),
    "inconclusive": "Not tested with broken copies: the check could not judge the circuit.",
    "pass": "Leona did not test this check with broken copies.",
}


def _with_explicit_teeth(verdict: CheckVerdict) -> CheckVerdict:
    if verdict.teeth is not None:
        return verdict
    reason = _TEETH_WHEN_ABSENT[verdict.status]
    return verdict.model_copy(update={"teeth": CheckTeeth(status="not_measured", reason=reason)})


async def judge_circuit(
    qasm: str,
    prop: CheckProperty,
    *,
    budget_s: float = CIRCUIT_CHECK_BUDGET_S,
    kill_after_s: float = CIRCUIT_CHECK_KILL_AFTER_S,
) -> CheckVerdict:
    """The verdict on `qasm` against `prop`, with `teeth` always set. Raises
    `QasmUnreadable` (the route's 400); everything else is a verdict."""
    if prop.kind not in CEILINGS:
        raise ValueError(f"{prop.kind!r} is not a circuit check")
    results = await judge_checks(
        [CheckJob(id="circuit", property=prop, capture=CheckCapture(kind="circuit", qasm=qasm))],
        budget_s=budget_s,
        kill_after_s=kill_after_s,
        memory_headroom_bytes=CHILD_MEMORY_HEADROOM_BYTES,
    )
    judged = results["circuit"]
    if judged.unreadable is not None:
        # Already a sentence naming which program failed, in the parser's own words.
        raise QasmUnreadable(judged.unreadable.message)
    return _with_explicit_teeth(judged.verdict)


__all__ = [
    "CHILD_MEMORY_HEADROOM_BYTES",
    "CIRCUIT_CHECK_BUDGET_S",
    "CIRCUIT_CHECK_KILL_AFTER_S",
    "CEILINGS",
    "QasmUnreadable",
    "judge_circuit",
]
