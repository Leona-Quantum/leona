"""Judge one OpenQASM 3 circuit against one `CheckProperty`, for `POST /v1/checks/circuit`.

The judgement is the check-cell engine's, run in a killable child process with a hard
wall clock and a memory cap (`judge_checks`). The engine bounds the program from its
syntax tree before building anything, checks widths before simulating the circuit or its
expectation, and parses once. This module only picks the API's ceilings and budget,
turns an unreadable program into the route's 400, and states the teeth when none were
tried.

**This process never parses the caller's OpenQASM.** Parsing, the syntax-tree bound, the
importer and the simulation all happen in the child `judge_checks` starts, so a slow path
in any of them is killed at `CIRCUIT_CHECK_KILL_AFTER_S` instead of holding the API.
`test_check_circuit_route.py` pins that by making every parser in THIS process raise.

Why the API's ceilings are lower than the engine's defaults: one 24-qubit statevector
is 2**24 x 16 bytes = 256 MiB, and the API instance is 512 MiB in all
(`API_MEMORY_MI`, infra/fleet.env), with the app itself about 145 MiB and the child
about 120 MiB after its imports. So the route judges only what the engine can also
mutation-test: 12 qubits for state and distribution checks, 10 for energy (the
contract's Hamiltonian limit), 8 for unitary checks.
"""

from __future__ import annotations

from leona_notebooks.checks import (
    CHECK_BUDGET_S,
    MUTATION_MAX_QUBITS_STATE,
    MUTATION_MAX_QUBITS_UNITARY,
    CheckCapture,
    CheckJob,
    judge_checks,
)
from majorana_contracts import CheckProperty, CheckTeeth, CheckVerdict

#: The child's soft deadline: verdicts first, then teeth until this passes.
CIRCUIT_CHECK_BUDGET_S = 10.0
#: The hard kill. Under the client's 60 s timeout with room for the queue and the
#: child's start-up.
CIRCUIT_CHECK_KILL_AFTER_S = 15.0
assert CIRCUIT_CHECK_BUDGET_S <= CHECK_BUDGET_S, "the route may not outspend a notebook run"

#: What the child may add to its address space after its imports (Linux RLIMIT_AS).
#: 512 MiB instance - ~145 MiB app - ~120 MiB child imports leaves ~245 MiB; 150 MiB
#: keeps a margin for the app's own request traffic.
CHILD_MEMORY_HEADROOM_BYTES = 150 * 2**20

#: Widest circuit judged here, per kind. Can only lower the engine's defaults.
MAX_QUBITS: dict[str, int] = {
    "state": MUTATION_MAX_QUBITS_STATE,
    "distribution": MUTATION_MAX_QUBITS_STATE,
    "energy": 10,
    "unitary": MUTATION_MAX_QUBITS_UNITARY,
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
    if prop.kind not in MAX_QUBITS:
        raise ValueError(f"{prop.kind!r} is not a circuit check")
    results = await judge_checks(
        [CheckJob(id="circuit", property=prop, capture=CheckCapture(kind="circuit", qasm=qasm))],
        budget_s=budget_s,
        kill_after_s=kill_after_s,
        memory_headroom_bytes=CHILD_MEMORY_HEADROOM_BYTES,
        width_caps=MAX_QUBITS,
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
    "MAX_QUBITS",
    "QasmUnreadable",
    "judge_circuit",
]
