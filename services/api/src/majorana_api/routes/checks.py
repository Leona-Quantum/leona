"""`POST /v1/checks/circuit`: check one OpenQASM 3 circuit against one property.

The agent connector's first headless tool (ai-ops 382 option 1, "move the connector up to
ship with it"; VISION §5.8). An outside AI editor sends a circuit and a `CheckProperty`
and gets back the verdict a notebook's check cell would get, with teeth: whether the check
could tell deliberately broken copies of the circuit from the original. The judging is
`circuit_check.judge_circuit`: the check-cell engine's `judge_checks`, in a child process
with a hard wall clock and a memory cap, at ceilings sized for this instance.

**Stateless.** No session is opened and nothing is written: no run row, no artifact, no
usage event. The circuit is parsed and simulated, never executed, and it is parsed only in
the child: this process never hands the caller's OpenQASM to a parser.

**Authenticated.** A browser session or a personal access token, through `CurrentScope`
like every other route; there is no anonymous door (05-security.md §1a names a new
anonymous route as a boundary change, and this is not one). A token needs the `run`
scope (`auth/token_access.py::RUN_WRITES`): a check spends compute on Leona's side the
way starting a run does, even though it stores nothing.

**One child at a time per API process, and no queue.** Measured in production by the
coordinator from Cloud Monitoring (hourly p99 over 3 days, relayed here, not measured by
this lane): the instance has 512 MiB (`API_MEMORY_MI`, infra/fleet.env), its p99 max use
was 58.9%, about 302 MiB, and it serves concurrent requests. A judge child is about
120 MiB after its imports, plus at most `CHILD_MEMORY_HEADROOM_BYTES` (64 MiB). One child:
302 + 120 + 64 = 486 MiB, which fits. Two: about 606 MiB, which does not, and an
out-of-memory kill takes every in-flight request on the instance with it. So one
process-wide `asyncio.Semaphore(1)` admits one judging at a time. A request that cannot
take it within `CIRCUIT_CHECK_SLOT_WAIT_S` (2 s) gets a 503 with `Retry-After`: "Leona is
checking another circuit; try again in a few seconds". A long queue is refused on
purpose, because a queue of waiting requests is load on an instance that is already at
its limit.

## Exposure, stated (worst case per call x calls)

Per call: one child start (about 1 s on an Apple M1 Pro, checks-builder's measurement),
then judging until the child's own deadline (`CIRCUIT_CHECK_BUDGET_S`, 10 s: verdict
first, then broken copies), killed outright at `CIRCUIT_CHECK_KILL_AFTER_S` (15 s)
whatever it is doing. That is at most about 16 s of one core, and the child's imports plus
64 MiB of memory (`RLIMIT_AS` on Linux, and the parent's RSS watch everywhere). The Cloud
Run vCPU was not measured. Inside that, the heaviest single judgements measured on the
M1 Pro at near-worst inputs (about 3,300 gates, 64,000 characters, one run each) were
7.7 s (12-qubit state check), 5.5 s (8-qubit unitary check) and 9.6 s (energy check on the
contract's widest Hamiltonian). Wider circuits, up to the contract's ceilings, run into
the 15 s kill rather than past it.

Calls: one child per instance at a time, whatever the traffic; everything past that is a
503 within about 2 s, not a queue. Per account, `check_limiter` admits 30 a minute per
instance (`DEFAULT_CHECK_LIMIT`); a token is also held to its own 600 a minute
(`DEFAULT_TOKEN_LIMIT`). Worst case, one account can keep one instance's judging slot busy
continuously (30 calls x up to 16 s is more than a minute of work), and everyone else's
checks on that instance get 503s while it does. That is the exposure this route accepts;
the run allowance (`_gate_notebook_run`) does not fit a request that creates no run, and
a queue on the worker is a design change, not a limit.
"""

from __future__ import annotations

import asyncio

import majorana_contracts as contracts
from fastapi import APIRouter, HTTPException, Request
from majorana_contracts import Scope

from ..auth.deps import CurrentScope
from ..circuit_check import QasmUnreadable, judge_circuit
from ..request_models import RequestModel

router = APIRouter()

#: Judge children at once in one API process. See the module docstring.
CIRCUIT_CHECK_CONCURRENCY = 1
#: How long a request waits for the judging slot before it is answered 503.
CIRCUIT_CHECK_SLOT_WAIT_S = 2.0
#: `Retry-After` on that 503, in seconds: long enough for most checks to finish.
CIRCUIT_CHECK_RETRY_AFTER_S = 5
BUSY_REFUSAL = "Leona is checking another circuit; try again in a few seconds"

_slot: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = None


def _judge_slot() -> asyncio.Semaphore:
    """The process-wide semaphore. One per event loop, which in production is one per
    process (uvicorn runs one); a test that starts a new loop gets a fresh one instead of
    a semaphore bound to a loop that has closed."""
    global _slot
    loop = asyncio.get_running_loop()
    if _slot is None or _slot[0] is not loop:
        _slot = (loop, asyncio.Semaphore(CIRCUIT_CHECK_CONCURRENCY))
    return _slot[1]


VALUE_CHECK_REFUSAL = "a value check needs a value, not a circuit; check it in a notebook"


class CircuitCheckRequest(RequestModel, contracts.CircuitCheckRequest):
    """The contract's body with the NUL guard every route body inherits."""


def _meter(request: Request, scope: Scope) -> None:
    """Count one check against the caller's own per-minute ceiling (`DEFAULT_CHECK_LIMIT`).

    Keyed by the account, whichever credential it used. Checked before the judging slot
    is taken, so a refused request costs no CPU.
    """
    decision = request.app.state.check_limiter.check(str(scope.user_id))
    if not decision.allowed:
        raise HTTPException(
            429,
            detail={
                "error": "You are asking for circuit checks too quickly. Wait a moment and "
                "try again.",
                "reason": "check_rate_limited",
            },
            headers={"Retry-After": str(decision.retry_after_s)},
        )


@router.post("/checks/circuit", response_model=contracts.CircuitCheckResponse)
async def check_circuit(
    body: CircuitCheckRequest, scope: CurrentScope, request: Request
) -> contracts.CircuitCheckResponse:
    """Judge `body.qasm` against `body.property`.

    400 for a `value` check (it judges a number, not a circuit) and for a circuit or
    reference circuit that does not parse, with the parser's own words. 503 when another
    check holds this process's one judging slot for longer than 2 s. Everything the
    check cannot judge here — too wide, too long, control flow, an expectation it cannot
    build — is a 200 with an `inconclusive` verdict saying why. Never a 500 for the
    caller's program: the engine turns its own failures into `inconclusive` too.
    """
    if body.property.kind == "value":
        raise HTTPException(
            400, detail={"error": VALUE_CHECK_REFUSAL, "reason": "value_check_needs_a_notebook"}
        )
    _meter(request, scope)
    slot = _judge_slot()
    try:
        await asyncio.wait_for(slot.acquire(), CIRCUIT_CHECK_SLOT_WAIT_S)
    except TimeoutError:
        raise HTTPException(
            503,
            detail={"error": BUSY_REFUSAL, "reason": "check_judge_busy"},
            headers={"Retry-After": str(CIRCUIT_CHECK_RETRY_AFTER_S)},
        ) from None
    try:
        verdict = await judge_circuit(body.qasm, body.property)
    except QasmUnreadable as unreadable:
        raise HTTPException(
            400, detail={"error": unreadable.message, "reason": unreadable.reason}
        ) from None
    finally:
        slot.release()
    return contracts.CircuitCheckResponse(verdict=verdict)
