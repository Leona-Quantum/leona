"""`POST /v1/checks/circuit`: check one OpenQASM 3 circuit against one property.

The agent connector's first headless tool (ai-ops 382 option 1, "move the connector up to
ship with it"; VISION §5.8). An outside AI editor sends a circuit and a `CheckProperty`
and gets back the verdict a notebook's check cell would get, with teeth: whether the check
could tell deliberately broken copies of the circuit from the original. The judging is
`circuit_check.judge_circuit`, which bounds the input and then calls the check-cell
engine unchanged.

**Stateless.** No session is opened and nothing is written: no run row, no artifact, no
usage event. The circuit is parsed and simulated, never executed.

**Authenticated.** A browser session or a personal access token, through `CurrentScope`
like every other route; there is no anonymous door (05-security.md §1a names a new
anonymous route as a boundary change, and this is not one). A token needs the `run`
scope (`auth/token_access.py::RUN_WRITES`): a check spends compute on Leona's side the
way starting a run does, even though it stores nothing.

**Off the event loop, one at a time per process.** The judgement is CPU-bound Python, so
it runs in a worker thread, and `_JUDGE_SLOTS` lets one run at a time per API process.
The API instance has one vCPU (`API_CPU=1`, infra/fleet.env): a second concurrent check
would not finish sooner, it would only hold a second circuit in memory and take more of
the GIL from the event loop that serves every other route. A request waits for the slot
rather than being refused; the wait is not counted against its budget.

## Exposure, stated (worst case per call x calls)

Per call, measured on an Apple M1 Pro, one process, one run each (the Cloud Run vCPU was
NOT measured and may be slower), at near-worst inputs inside `circuit_check`'s ceilings:
two parses of a 64,000-character program (~0.5 s each) + one simulation of the circuit
(up to 7.7 s for a 12-qubit state check, 5.5 s for an 8-qubit unitary check, 9.6 s for an
energy check on the contract's widest Hamiltonian) + mutation testing up to the deadline
(`CIRCUIT_CHECK_BUDGET_S` = 10 s from the start of the call) + at most one broken copy
started just before the deadline (up to one more simulation). Estimated ceiling: about
30 s of one core per call on that machine, ESTIMATED from those parts, not measured as one
call. Peak traced memory per call at those ceilings was 30 MiB (state) and 22 MiB
(unitary), 64 MiB for the energy case.

Calls: at most one judging at a time per API process (`_JUDGE_SLOTS`), so CPU is bounded
at one core per instance whatever the traffic. Per account, `check_limiter` admits 30 a
minute per instance (`DEFAULT_CHECK_LIMIT`); a token is also held to its own 600 a minute
(`DEFAULT_TOKEN_LIMIT`). Worst case, one account can therefore keep one instance's
judging slot busy continuously (30 calls x ~30 s is more than a minute of work), and
everyone else's checks on that instance wait behind it. That is the exposure this route
accepts; the run allowance (`_gate_notebook_run`) does not fit a request that creates no
run, and a queue on the worker is a design change, not a limit.
"""

from __future__ import annotations

import functools

import anyio
import majorana_contracts as contracts
from fastapi import APIRouter, HTTPException, Request
from majorana_contracts import Scope

from ..auth.deps import CurrentScope
from ..circuit_check import CIRCUIT_CHECK_BUDGET_S, QasmUnreadable, judge_circuit
from ..request_models import RequestModel

router = APIRouter()

#: Checks judged at once in one API process. See the module docstring.
CIRCUIT_CHECK_CONCURRENCY = 1
_JUDGE_SLOTS = anyio.CapacityLimiter(CIRCUIT_CHECK_CONCURRENCY)

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
    reference circuit that does not parse, with the parser's own words. Everything the
    check cannot judge here — too wide, too long, control flow, an expectation it cannot
    build — is a 200 with an `inconclusive` verdict saying why. Never a 500 for the
    caller's program: the engine turns its own failures into `inconclusive` too.
    """
    if body.property.kind == "value":
        raise HTTPException(
            400, detail={"error": VALUE_CHECK_REFUSAL, "reason": "value_check_needs_a_notebook"}
        )
    _meter(request, scope)
    try:
        verdict = await anyio.to_thread.run_sync(
            functools.partial(
                judge_circuit, body.qasm, body.property, budget_s=CIRCUIT_CHECK_BUDGET_S
            ),
            limiter=_JUDGE_SLOTS,
        )
    except QasmUnreadable as unreadable:
        raise HTTPException(
            400, detail={"error": unreadable.message, "reason": unreadable.reason}
        ) from None
    return contracts.CircuitCheckResponse(verdict=verdict)
