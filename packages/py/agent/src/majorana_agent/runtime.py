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

    async def run(self, run_id: UUID) -> AgentState:
        """Resume from durable history until publication or a policy/tool failure."""
        while True:
            state = await self._store.state(run_id)
            if state in {
                AgentState.PUBLISHED,
                AgentState.COMPLETED,
                AgentState.FAILED,
                AgentState.CANCELLED,
            }:
                return state
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
            prior = next((item for item in history if item.tool_call_id == call.tool_call_id), None)
            if prior is not None:
                # The crash-recovery case was handled above before asking the
                # model for another call. Any completed ID proposed here is a
                # replay, even if its result belongs to an older state.
                await self._store.set_state(run_id, AgentState.FAILED)
                return AgentState.FAILED
            if self._observer is not None:
                await self._observer.tool_started(run_id, state, call)
            result = await self._broker.dispatch(run_id, call)
            if self._observer is not None:
                await self._observer.tool_finished(run_id, result)
            if not result.ok:
                if result.error_code and result.error_code.endswith("_budget_exhausted"):
                    await self._store.set_state(run_id, AgentState.FAILED)
                    return AgentState.FAILED
                # A rejected model-selected call is durable feedback, not an
                # infrastructure failure. Let the model correct it within budget.
                continue
