"""Policy-enforcing broker between model-selected calls and trusted tools."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid5

from majorana_agent.models import (
    AgentBudget,
    AgentState,
    SIMULATION_TOOL_BY_FRAMEWORK,
    ToolCall,
    ToolName,
    ToolResult,
)
from majorana_agent.store import AgentStore
from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)

ToolHandler = Callable[[UUID, ToolCall], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class AgentPolicy:
    framework: Framework
    budget: AgentBudget = AgentBudget()


_ALLOWED: dict[AgentState, frozenset[ToolName]] = {
    AgentState.NEW: frozenset({ToolName.REQUEST_PLAN}),
    AgentState.PLANNED: frozenset(SIMULATION_TOOL_BY_FRAMEWORK.values()),
    AgentState.EXECUTED: frozenset({ToolName.REVIEW_CANDIDATE}),
    AgentState.REVIEWED: frozenset({ToolName.REVIEW_CANDIDATE, ToolName.STRICT_VERIFY}),
    AgentState.READY_FOR_STRICT_VERIFICATION: frozenset({ToolName.STRICT_VERIFY}),
    AgentState.REPAIR_REQUIRED: frozenset(SIMULATION_TOOL_BY_FRAMEWORK.values()),
    AgentState.REPLAN_REQUIRED: frozenset({ToolName.REPLAN}),
    AgentState.RESOURCE_EXHAUSTED: frozenset(),
    AgentState.VERIFIED: frozenset({ToolName.CONVERT_TO_OPENQASM, ToolName.MATERIALIZE_ARTIFACT}),
    AgentState.INCONCLUSIVE: frozenset(),
    AgentState.QASM_ATTEMPTED: frozenset({ToolName.MATERIALIZE_ARTIFACT}),
    AgentState.PUBLISHED: frozenset(),
    AgentState.MATERIALIZED: frozenset(),
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
        # Step budget first: every dispatch attempt must count against it, even one
        # that fails a later check (e.g. invalid_arguments), or a model stuck
        # resubmitting a malformed call can loop until the run's wall-clock
        # timeout instead of being bounded by max_steps (observed: 119 rejected
        # simulate_qiskit attempts before run_timeout, budget never enforced).
        results = await self._store.list_tool_results(run_id)
        if len(results) >= self._policy.budget.max_steps:
            raise ToolPolicyError("step_budget_exhausted", "agent step budget exhausted")
        if "__model_selection_error__" in call.arguments:
            raise ToolPolicyError(
                "invalid_tool_selection", str(call.arguments["__model_selection_error__"])
            )
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

        if call.name in {ToolName.REQUEST_PLAN, ToolName.REPLAN}:
            plan_attempts = sum(
                result.name in {ToolName.REQUEST_PLAN, ToolName.REPLAN} for result in results
            )
            if plan_attempts >= self._policy.budget.max_plan_attempts:
                raise ToolPolicyError(
                    "plan_attempt_budget_exhausted", "Plan attempt budget exhausted"
                )

        if call.name is ToolName.REPLAN:
            await self._validate_replan_authority(run_id, results)
            current = await self._store.current_plan_revision(run_id)
            if current is None:
                raise ToolPolicyError("plan_missing", "replan requires a current Plan revision")
            replay_id = uuid5(run_id, f"majorana:replan:{call.tool_call_id}")
            try:
                replay = await self._store.plan_revision(run_id, replay_id)
            except KeyError:
                replay = None
            if current.revision >= self._policy.budget.max_plan_revisions and (
                replay is None or replay.plan_id != current.plan_id
            ):
                raise ToolPolicyError(
                    "plan_revision_budget_exhausted", "Plan revision budget exhausted"
                )

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
        reviews = sum(r.name is ToolName.REVIEW_CANDIDATE and r.ok for r in results)
        if (
            call.name is ToolName.REVIEW_CANDIDATE
            and reviews >= self._policy.budget.max_semantic_review_attempts
        ):
            raise ToolPolicyError(
                "semantic_review_budget_exhausted", "semantic-review budget exhausted"
            )
        strict_attempts = sum(r.name is ToolName.STRICT_VERIFY and r.ok for r in results)
        if (
            call.name is ToolName.STRICT_VERIFY
            and strict_attempts >= self._policy.budget.max_strict_attempts
        ):
            raise ToolPolicyError(
                "strict_attempt_budget_exhausted", "strict-attempt budget exhausted"
            )
        conversions = sum(r.name is ToolName.CONVERT_TO_OPENQASM and r.ok for r in results)
        if (
            call.name is ToolName.CONVERT_TO_OPENQASM
            and conversions >= self._policy.budget.max_conversions
        ):
            raise ToolPolicyError("conversion_budget_exhausted", "conversion budget exhausted")

        if call.name in {
            ToolName.VERIFY_INTENT_ALIGNMENT,
            ToolName.REVIEW_CANDIDATE,
            ToolName.STRICT_VERIFY,
            ToolName.CONVERT_TO_OPENQASM,
            ToolName.PUBLISH_ARTIFACT,
            ToolName.MATERIALIZE_ARTIFACT,
        }:
            candidate_id = self._candidate_id(call.arguments)
            candidate = await self._store.candidate(run_id, candidate_id)
            latest = await self._store.latest_candidate(run_id)
            if latest is None or candidate.candidate_id != latest.candidate_id:
                raise ToolPolicyError("stale_candidate", "only the latest candidate may be used")
            if candidate.framework is not self._policy.framework:
                raise ToolPolicyError("framework_mismatch", "candidate framework changed")
            if call.name in {ToolName.PUBLISH_ARTIFACT, ToolName.MATERIALIZE_ARTIFACT}:
                strict = await self._store.latest_strict_verification(run_id, candidate_id)
                if strict is None or strict.decision is not VerifierDecision.PASS:
                    raise ToolPolicyError(
                        "candidate_unverified", "publication requires verification PASS"
                    )
                if strict.source_fingerprint != candidate.source_fingerprint:
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
        if call.name in {ToolName.REQUEST_PLAN, ToolName.REPLAN}:
            if call.arguments:
                raise ToolPolicyError(
                    "invalid_arguments", f"{call.name.value} accepts no arguments"
                )
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
            # Live run 019f7f7c-5ac2: the model called publish_artifact with {}
            # and the old message ("accepts exactly candidate_id") named the
            # parameter but not where its value lives, so the retry had nothing
            # to act on. The failing message is the repair loop's whole input
            # (standing lesson 11).
            raise ToolPolicyError(
                "invalid_arguments",
                f"{call.name.value} accepts exactly one argument, candidate_id — "
                "pass the candidate_id value from the simulation or verification "
                "payload in your history",
            )

    async def _next_state(
        self, run_id: UUID, name: ToolName, payload: dict[str, Any]
    ) -> AgentState:
        if name is ToolName.REQUEST_PLAN:
            return AgentState.PLANNED
        if name is ToolName.REPLAN:
            return AgentState.PLANNED
        if name in SIMULATION_TOOL_BY_FRAMEWORK.values():
            if payload.get("resource_exhausted"):
                return AgentState.RESOURCE_EXHAUSTED
            return (
                AgentState.EXECUTED
                if payload.get("execution_ok", True)
                else AgentState.REPAIR_REQUIRED
            )
        if name is ToolName.REVIEW_CANDIDATE:
            decision = SemanticReviewDecision(payload["decision"])
            if decision is SemanticReviewDecision.REPLAN:
                return AgentState.REPLAN_REQUIRED
            if decision is SemanticReviewDecision.CODE_REPAIR:
                return AgentState.REPAIR_REQUIRED
            if decision is SemanticReviewDecision.READY:
                return AgentState.READY_FOR_STRICT_VERIFICATION
            return AgentState.REVIEWED
        if name is ToolName.STRICT_VERIFY:
            decision = VerifierDecision(payload["decision"])
            if decision is VerifierDecision.PASS:
                return AgentState.VERIFIED
            if decision is VerifierDecision.INCONCLUSIVE:
                if payload.get("retry_target") == RetryTarget.VERIFICATION.value:
                    prior = await self._store.list_tool_results(run_id)
                    completed = sum(
                        item.name is ToolName.STRICT_VERIFY and item.ok for item in prior
                    )
                    if completed + 1 < self._policy.budget.max_strict_attempts:
                        return AgentState.REVIEWED
                return AgentState.INCONCLUSIVE
            retry_target = RetryTarget(payload.get("retry_target", RetryTarget.NONE))
            if retry_target is RetryTarget.PLANNING:
                return AgentState.REPLAN_REQUIRED
            if retry_target is RetryTarget.CODE_GENERATION:
                return AgentState.REPAIR_REQUIRED
            return AgentState.REVIEWED
        if name is ToolName.VERIFY_INTENT_ALIGNMENT:
            decision = VerifierDecision(payload.get("decision", VerifierDecision.INCONCLUSIVE))
            if (
                payload.get("failure_class") == VerificationFailureClass.PLAN_DEFECT.value
                and payload.get("retry_target") == RetryTarget.PLANNING.value
            ):
                return AgentState.REPLAN_REQUIRED
            return (
                AgentState.VERIFIED
                if decision is VerifierDecision.PASS
                else AgentState.REPAIR_REQUIRED
            )
        if name is ToolName.CONVERT_TO_OPENQASM:
            return AgentState.QASM_ATTEMPTED
        if name is ToolName.PUBLISH_ARTIFACT:
            return AgentState.PUBLISHED
        if name is ToolName.MATERIALIZE_ARTIFACT:
            return AgentState.MATERIALIZED
        raise ToolPolicyError("unknown_tool", name.value)

    async def _validate_replan_authority(self, run_id: UUID, results: list[ToolResult]) -> None:
        feedback = next(
            (
                result
                for result in reversed(results)
                if result.ok
                and result.name
                in {
                    ToolName.REVIEW_CANDIDATE,
                    ToolName.STRICT_VERIFY,
                    ToolName.VERIFY_INTENT_ALIGNMENT,
                }
            ),
            None,
        )
        if feedback is None or not (
            feedback.payload.get("failure_class") == VerificationFailureClass.PLAN_DEFECT.value
            and feedback.payload.get("retry_target") == RetryTarget.PLANNING.value
        ):
            raise ToolPolicyError(
                "replan_not_authorized", "replan requires typed plan_defect feedback"
            )
        candidate_id = self._candidate_id(feedback.payload)
        latest = await self._store.latest_candidate(run_id)
        if latest is None or latest.candidate_id != candidate_id:
            raise ToolPolicyError(
                "stale_plan_feedback", "replan feedback must belong to the latest candidate"
            )
