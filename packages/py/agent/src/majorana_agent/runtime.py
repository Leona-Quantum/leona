"""Bounded, resumable tool-calling loop."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol
from uuid import UUID

from majorana_agent.broker import ToolBroker
from majorana_agent.models import AgentState, ToolCall, ToolResult
from majorana_agent.store import AgentStore


class AgentModel(Protocol):
    async def next_tool(
        self, *, run_id: UUID, state: AgentState, history: list[ToolResult]
    ) -> ToolCall: ...


class AgentObserver(Protocol):
    async def tool_started(self, run_id: UUID, state: AgentState, call: ToolCall) -> None: ...

    async def tool_finished(self, run_id: UUID, result: ToolResult) -> None: ...


class AgentRuntime:
    def __init__(
        self,
        *,
        store: AgentStore,
        broker: ToolBroker,
        model: AgentModel,
        observer: AgentObserver | None = None,
        cancel_requested: Callable[[], Awaitable[bool]] | None = None,
    ) -> None:
        self._store = store
        self._broker = broker
        self._model = model
        self._observer = observer
        self._cancel_requested = cancel_requested
        # Why the loop gave up, for the caller to surface. run() returns only an
        # AgentState, so without this a failed run reports "agent tool loop
        # failed" with no indication of which wall it hit — the budget it
        # exhausted is known here and was previously discarded.
        self.failure_reason: str | None = None

    async def run(self, run_id: UUID) -> AgentState:
        """Resume from durable history until publication or a policy/tool failure."""
        while True:
            state = await self._store.state(run_id)
            if state in {
                AgentState.PUBLISHED,
                AgentState.MATERIALIZED,
                AgentState.COMPLETED,
                AgentState.FAILED,
                AgentState.CANCELLED,
                AgentState.RESOURCE_EXHAUSTED,
            }:
                return state
            # INCONCLUSIVE is deliberately absent from the terminal set above.
            # broker._ALLOWED and model._TOOLS_BY_STATE both permit
            # convert_to_openqasm/materialize_artifact from AgentState.INCONCLUSIVE
            # (a strict_verify run that found no dedicated property verifier for
            # the algorithm, e.g. QFT, is still namekoQ-style materializable off a
            # READY semantic review) — but stopping here before ever asking the
            # model for another tool call made that permission dead code. The
            # loop returned immediately, handlers.py's final-state switch treats
            # anything but {CANCELLED, MATERIALIZED, PUBLISHED, RESOURCE_EXHAUSTED}
            # as failed, and — because nothing had actually failed —
            # _agent_failure_message fell back to quoting the (passing) semantic
            # review's summary as if it were the objection that killed the run
            # (observed live, run 019f8dd5: a clean READY QFT review reported
            # back as "semantic objection: The artifact aligns with the request
            # and plan..."). Falling through here lets the model actually call
            # materialize_artifact/convert_to_openqasm; if it does neither, the
            # existing step/strict-attempt budgets end the run with an honest
            # exhaustion reason instead.
            if self._cancel_requested is not None and await self._cancel_requested():
                await self._store.set_state(run_id, AgentState.CANCELLED)
                return AgentState.CANCELLED
            history = await self._store.list_tool_results(run_id)
            if history and history[-1].ok and history[-1].state is not state:
                # Recover the narrow crash window after a step result committed
                # but before the run-state update committed.
                await self._store.set_state(run_id, history[-1].state)
                continue
            call = await self._model.next_tool(run_id=run_id, state=state, history=history)
            # The model authors its own tool_call_id, and a stateless generator
            # at temperature 0 reuses one sooner or later: live run
            # 019f7f7c-5ac2 had publish_artifact rejected once for bad
            # arguments, retried it under the same id, and the replay guard
            # below executed a run whose candidate had already passed every
            # check. Suffixing the step index makes uniqueness structural —
            # every dispatch (rejected or not) grows the history, so no two
            # steps share an effective id — while crash-replay determinism is
            # preserved: a replayed next_tool sees the same history length and
            # derives the same effective id, so the broker's completed-call
            # cache still recognises it.
            call = call.model_copy(
                update={"tool_call_id": f"{call.tool_call_id[:80]}-s{len(history)}"}
            )
            prior = next((item for item in history if item.tool_call_id == call.tool_call_id), None)
            if prior is not None:
                # The crash-recovery case was handled above before asking the
                # model for another call. With step-suffixed ids this is
                # unreachable short of a store anomaly, and fail-closed is the
                # right response to a store anomaly.
                self.failure_reason = f"replayed tool call {call.name.value}"
                await self._store.set_state(run_id, AgentState.FAILED)
                return AgentState.FAILED
            if self._observer is not None:
                await self._observer.tool_started(run_id, state, call)
            result = await self._broker.dispatch(run_id, call)
            if self._observer is not None:
                await self._observer.tool_finished(run_id, result)
            if not result.ok:
                if result.error_code and result.error_code.endswith("_budget_exhausted"):
                    self.failure_reason = result.error_code
                    await self._store.set_state(run_id, AgentState.FAILED)
                    return AgentState.FAILED
                # A rejected model-selected call is durable feedback, not an
                # infrastructure failure. Let the model correct it within budget.
                continue
