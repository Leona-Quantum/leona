"""Policy-enforcing broker between model-selected calls and trusted tools."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from majorana_agent.models import (
    AgentBudget,
    AgentState,
    SIMULATION_TOOL_BY_FRAMEWORK,
    ToolCall,
    ToolName,
    ToolResult,
)
from majorana_agent.store import AgentStore
from majorana_contracts.enums import Framework, VerifierDecision

ToolHandler = Callable[[UUID, ToolCall], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class AgentPolicy:
    framework: Framework
    budget: AgentBudget = AgentBudget()


_ALLOWED: dict[AgentState, frozenset[ToolName]] = {
    AgentState.NEW: frozenset({ToolName.REQUEST_PLAN}),
    AgentState.PLANNED: frozenset(SIMULATION_TOOL_BY_FRAMEWORK.values()),
    AgentState.EXECUTED: frozenset({ToolName.VERIFY_INTENT_ALIGNMENT}),
    AgentState.REPAIR_REQUIRED: frozenset(SIMULATION_TOOL_BY_FRAMEWORK.values()),
    AgentState.VERIFIED: frozenset({ToolName.CONVERT_TO_OPENQASM, ToolName.PUBLISH_ARTIFACT}),
    AgentState.QASM_ATTEMPTED: frozenset({ToolName.PUBLISH_ARTIFACT}),
    AgentState.PUBLISHED: frozenset(),
    AgentState.COMPLETED: frozenset(),
    AgentState.FAILED: frozenset(),
    AgentState.CANCELLED: frozenset(),
}


class ToolPolicyError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ToolBroker:
    def __init__(
        self,
        *,
        store: AgentStore,
        policy: AgentPolicy,
        handlers: dict[ToolName, ToolHandler],
    ) -> None:
        self._store = store
        self._policy = policy
        self._handlers = handlers

    async def dispatch(self, run_id: UUID, call: ToolCall) -> ToolResult:
        previous_call = await self._store.tool_call(run_id, call.tool_call_id)
        if previous_call is not None and previous_call != call:
            raise ToolPolicyError(
                "idempotency_conflict", "tool_call_id was reused with different arguments"
            )
        cached = await self._store.completed_tool_call(run_id, call.tool_call_id)
        if cached is not None:
            return cached

        state = await self._store.state(run_id)
        try:
            await self._store.begin_tool_call(run_id, call)
            await self._validate(run_id, state, call)
            payload = await self._handlers[call.name](run_id, call)
            next_state = await self._next_state(run_id, call.name, payload)
            result = ToolResult(
                tool_call_id=call.tool_call_id,
                name=call.name,
                ok=True,
                state=next_state,
                payload=payload,
            )
        except ToolPolicyError as exc:
            result = ToolResult(
                tool_call_id=call.tool_call_id,
                name=call.name,
                ok=False,
                state=state,
                error_code=exc.code,
                error_message=str(exc),
            )
        await self._store.finish_tool_call(run_id, result)
        if result.ok:
            await self._store.set_state(run_id, result.state)
        return result

    async def _validate(self, run_id: UUID, state: AgentState, call: ToolCall) -> None:
        if call.name not in _ALLOWED[state]:
            raise ToolPolicyError(
                "invalid_transition", f"{call.name.value} is not allowed from {state.value}"
            )
        if call.name not in self._handlers:
            raise ToolPolicyError("tool_unavailable", f"{call.name.value} is unavailable")
        if call.name in SIMULATION_TOOL_BY_FRAMEWORK.values():
            expected = SIMULATION_TOOL_BY_FRAMEWORK[self._policy.framework]
            if call.name is not expected:
                raise ToolPolicyError(
                    "framework_mismatch",
                    f"run requires {self._policy.framework.value}; use {expected.value}",
                )
        self._validate_arguments(call)

        results = await self._store.list_tool_results(run_id)
        if len(results) >= self._policy.budget.max_steps:
            raise ToolPolicyError("step_budget_exhausted", "agent step budget exhausted")
        candidates = await self._store.list_candidates(run_id)
        if (
            call.name in SIMULATION_TOOL_BY_FRAMEWORK.values()
            and len(candidates) >= self._policy.budget.max_candidates
        ):
            raise ToolPolicyError("candidate_budget_exhausted", "candidate budget exhausted")
        sandbox_runs = sum(
            int(r.payload.get("sandbox_runs", 1))
            for r in results
            if r.name in SIMULATION_TOOL_BY_FRAMEWORK.values() and r.ok
        )
        if (
            call.name in SIMULATION_TOOL_BY_FRAMEWORK.values()
            and sandbox_runs >= self._policy.budget.max_sandbox_runs
        ):
            raise ToolPolicyError("sandbox_budget_exhausted", "sandbox budget exhausted")
        verifications = sum(r.name is ToolName.VERIFY_INTENT_ALIGNMENT and r.ok for r in results)
        if (
            call.name is ToolName.VERIFY_INTENT_ALIGNMENT
            and verifications >= self._policy.budget.max_verifications
        ):
            raise ToolPolicyError("verification_budget_exhausted", "verification budget exhausted")
        conversions = sum(r.name is ToolName.CONVERT_TO_OPENQASM and r.ok for r in results)
        if (
            call.name is ToolName.CONVERT_TO_OPENQASM
            and conversions >= self._policy.budget.max_conversions
        ):
            raise ToolPolicyError("conversion_budget_exhausted", "conversion budget exhausted")

        if call.name in {
            ToolName.VERIFY_INTENT_ALIGNMENT,
            ToolName.CONVERT_TO_OPENQASM,
            ToolName.PUBLISH_ARTIFACT,
        }:
            candidate_id = self._candidate_id(call.arguments)
            candidate = await self._store.candidate(run_id, candidate_id)
            latest = await self._store.latest_candidate(run_id)
            if latest is None or candidate.candidate_id != latest.candidate_id:
                raise ToolPolicyError("stale_candidate", "only the latest candidate may be used")
            if candidate.framework is not self._policy.framework:
                raise ToolPolicyError("framework_mismatch", "candidate framework changed")
            if call.name is ToolName.PUBLISH_ARTIFACT:
                verification = await self._store.verification_for(run_id, candidate_id)
                if verification is None or verification.decision is not VerifierDecision.PASS:
                    raise ToolPolicyError(
                        "candidate_unverified", "publication requires verification PASS"
                    )
                if verification.source_fingerprint != candidate.source_fingerprint:
                    raise ToolPolicyError(
                        "fingerprint_mismatch", "verified source differs from candidate"
                    )

    @staticmethod
    def _candidate_id(arguments: dict[str, Any]) -> UUID:
        try:
            return UUID(str(arguments["candidate_id"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ToolPolicyError("invalid_arguments", "candidate_id must be a UUID") from exc

    @staticmethod
    def _validate_arguments(call: ToolCall) -> None:
        if call.name is ToolName.REQUEST_PLAN:
            if call.arguments:
                raise ToolPolicyError("invalid_arguments", "request_plan accepts no arguments")
            return
        if call.name in SIMULATION_TOOL_BY_FRAMEWORK.values():
            if set(call.arguments) != {"source"}:
                raise ToolPolicyError(
                    "invalid_arguments", "simulation accepts exactly one source argument"
                )
            source = call.arguments.get("source")
            if not isinstance(source, str) or not source.strip() or len(source) > 200_000:
                raise ToolPolicyError(
                    "invalid_arguments", "source must contain 1 to 200000 characters"
                )
            return
        if set(call.arguments) != {"candidate_id"}:
            raise ToolPolicyError(
                "invalid_arguments", f"{call.name.value} accepts exactly candidate_id"
            )

    async def _next_state(
        self, run_id: UUID, name: ToolName, payload: dict[str, Any]
    ) -> AgentState:
        if name is ToolName.REQUEST_PLAN:
            return AgentState.PLANNED
        if name in SIMULATION_TOOL_BY_FRAMEWORK.values():
            return (
                AgentState.EXECUTED
                if payload.get("execution_ok", True)
                else AgentState.REPAIR_REQUIRED
            )
        if name is ToolName.VERIFY_INTENT_ALIGNMENT:
            decision = VerifierDecision(payload.get("decision", VerifierDecision.INCONCLUSIVE))
            return (
                AgentState.VERIFIED
                if decision is VerifierDecision.PASS
                else AgentState.REPAIR_REQUIRED
            )
        if name is ToolName.CONVERT_TO_OPENQASM:
            return AgentState.QASM_ATTEMPTED
        if name is ToolName.PUBLISH_ARTIFACT:
            return AgentState.PUBLISHED
        raise ToolPolicyError("unknown_tool", name.value)
