"""Deterministic nameko-style circuit pipeline.

The model supplies typed content through ports; it never selects a tool or the next
stage. Expected failures are returned as data, and every finite-budget path returns a
terminal outcome.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Generic, Protocol, TypeVar
from uuid import UUID

from majorana_agent.models import (
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionFailureKind,
    MaterializedArtifact,
    PlanRevision,
    SemanticReviewEvidence,
)
from majorana_contracts.enums import SemanticReviewDecision

log = logging.getLogger("majorana.agent.simple_pipeline")


class SimplePipelineStage(StrEnum):
    PLANNING = "planning"
    GENERATING = "generating"
    EXECUTING = "executing"
    CHECKING = "checking"
    REVIEWING = "reviewing"
    EXPORTING = "exporting"
    SAVING = "saving"
    COMPLETED = "completed"


class SimplePipelineStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SimpleFailureKind(StrEnum):
    PROVIDER = "provider"
    MODEL_OUTPUT = "model_output"
    PLAN = "plan"
    GENERATION = "generation"
    CODE = "code"
    RESOURCE = "resource"
    REVIEW = "review"
    EXPORT = "export"
    PERSISTENCE = "persistence"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    INTEGRITY = "integrity"
    INTERNAL = "internal"


class SimpleRetryTarget(StrEnum):
    PLANNING = "planning"
    GENERATION = "generation"
    EXECUTION = "execution"
    REVIEW = "review"
    SAVE = "save"
    NONE = "none"


class SimpleNextAction(StrEnum):
    """The only transitions the bounded repair controller may choose."""

    ACCEPT = "accept"
    REPAIR_CODE = "repair_code"
    REPLAN = "replan"
    EXPLAIN_FAILURE = "explain_failure"


@dataclass(frozen=True)
class SimplePipelineFailure:
    kind: SimpleFailureKind
    stage: SimplePipelineStage
    code: str
    message: str
    retryable: bool = False
    retry_target: SimpleRetryTarget = SimpleRetryTarget.NONE
    details: dict[str, Any] = field(default_factory=dict)


T = TypeVar("T")


@dataclass(frozen=True)
class SimplePortResult(Generic[T]):
    """Exactly one typed port value or expected failure."""

    value: T | None = None
    failure: SimplePipelineFailure | None = None

    def __post_init__(self) -> None:
        if (self.value is None) == (self.failure is None):
            raise ValueError("port result requires exactly one of value or failure")

    @classmethod
    def success(cls, value: T) -> SimplePortResult[T]:
        return cls(value=value)

    @classmethod
    def failed(cls, failure: SimplePipelineFailure) -> SimplePortResult[T]:
        return cls(failure=failure)


@dataclass(frozen=True)
class BasicContractResult:
    passed: bool
    code: str = "contract_ok"
    message: str = "basic execution contract passed"
    retry_target: SimpleRetryTarget = SimpleRetryTarget.NONE
    diagnostics: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.passed and self.retry_target is not SimpleRetryTarget.NONE:
            raise ValueError("passing contract check cannot request a retry")
        if not self.passed and self.retry_target not in {
            SimpleRetryTarget.PLANNING,
            SimpleRetryTarget.GENERATION,
        }:
            raise ValueError("failed contract check must route to planning or generation")


@dataclass(frozen=True)
class SimpleRepairFeedback:
    stage: SimplePipelineStage
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SimplePipelineBudget:
    # Parity with namekoQ's research mode, converted from its units to ours.
    # namekoQ bounds one agent LOOP by model turns (BUILD_MAX_STEPS = 28; standard
    # mode is 12); we bound candidate REVISIONS. Its research happy path spends 6
    # turns (plan, simulate, debate, verify, convert, answer) and each repair cycle
    # costs 3 (simulate, debate, verify), so 28 turns buys about 8 candidates —
    # 12 turns buys about 4. Standard mode is the closer feature match, but the
    # accuracy comparison that prompted this was against research, so 8 it is.
    #
    # The real ceiling above these numbers is time, not budget: one candidate costs
    # two provider calls plus a sandbox run against the API's 600 s `timeout_s` cap.
    # SimpleCircuitPipeline therefore reserves only the measured finalization tail
    # and gives each candidate stage a soft deadline, preserving a delivered result
    # before the worker's asyncio.timeout can cancel the run and deliver nothing.
    max_plan_attempts: int = 3
    max_generation_attempts: int = 8
    max_consecutive_code_repairs: int = 2
    max_execution_attempts_per_candidate: int = 2
    # Malformed-review retries only. A review that parsed always names a next step,
    # so it is consumed on the first attempt; re-asking would resend identical
    # evidence at temperature 0 for the identical answer.
    max_review_attempts_per_candidate: int = 2
    max_save_attempts: int = 2

    def __post_init__(self) -> None:
        for name, value in vars(self).items():
            if value < 1:
                raise ValueError(f"{name} must be at least 1")


@dataclass(frozen=True)
class SimplePipelineCounters:
    plan_attempts: int = 0
    generation_attempts: int = 0
    execution_attempts: int = 0
    review_attempts: int = 0
    save_attempts: int = 0


@dataclass(frozen=True)
class SimplePipelineOutcome:
    status: SimplePipelineStatus
    stage: SimplePipelineStage
    counters: SimplePipelineCounters
    plan: PlanRevision | None = None
    candidate: CandidateRevision | None = None
    execution: ExecutionEvidence | None = None
    review: SemanticReviewEvidence | None = None
    conversion: ConversionEvidence | None = None
    artifact: MaterializedArtifact | None = None
    failure: SimplePipelineFailure | None = None
    warnings: tuple[SimplePipelineFailure, ...] = ()

    def __post_init__(self) -> None:
        if self.status is SimplePipelineStatus.SUCCEEDED:
            if self.failure is not None or self.artifact is None:
                raise ValueError("successful pipeline outcome requires an artifact and no failure")
        elif self.failure is None:
            raise ValueError("non-success pipeline outcome requires a typed failure")


class SimplePipelinePorts(Protocol):
    async def plan(
        self,
        run_id: UUID,
        previous: PlanRevision | None,
        feedback: SimpleRepairFeedback | None,
    ) -> SimplePortResult[PlanRevision]: ...

    async def generate(
        self,
        run_id: UUID,
        plan: PlanRevision,
        previous: CandidateRevision | None,
        feedback: SimpleRepairFeedback | None,
    ) -> SimplePortResult[CandidateRevision]: ...

    async def run_execution(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
    ) -> SimplePortResult[ExecutionEvidence]: ...

    async def check_contract(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> SimplePortResult[BasicContractResult]: ...

    async def review(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        attempt: int,
    ) -> SimplePortResult[SemanticReviewEvidence]: ...

    async def export(
        self,
        run_id: UUID,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> SimplePortResult[ConversionEvidence]: ...

    async def save(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
    ) -> SimplePortResult[MaterializedArtifact]: ...


CancelCheck = Callable[[], Awaitable[bool]]
SoundCandidate = tuple[
    PlanRevision,
    CandidateRevision,
    ExecutionEvidence,
    SemanticReviewEvidence,
]


class SimpleCircuitPipeline:
    """Run the fixed Plan → Generate → Execute → Review → Export → Save flow."""

    def __init__(
        self,
        *,
        ports: SimplePipelinePorts,
        budget: SimplePipelineBudget | None = None,
        cancel_requested: CancelCheck | None = None,
        out_of_time: Callable[[], bool] | None = None,
        remaining_time_s: Callable[[], float] | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ports = ports
        self._budget = budget or SimplePipelineBudget()
        self._cancel_requested = cancel_requested
        # Consulted only between candidates. The worker wraps the whole run in
        # asyncio.timeout, which cancels mid-stage and yields nothing; this lets the
        # pipeline stop one candidate EARLY and terminalize with a result instead.
        self._out_of_time_check = out_of_time
        self._remaining_time_s = remaining_time_s
        self._monotonic = monotonic
        self._stage_durations: dict[SimplePipelineStage, list[float]] = {}
        self._sound_candidate_available = False

    async def run(self, run_id: UUID) -> SimplePipelineOutcome:
        counts = {
            "plan_attempts": 0,
            "generation_attempts": 0,
            "execution_attempts": 0,
            "review_attempts": 0,
            "save_attempts": 0,
        }
        plan: PlanRevision | None = None
        candidate: CandidateRevision | None = None
        execution: ExecutionEvidence | None = None
        review: SemanticReviewEvidence | None = None
        warnings: list[SimplePipelineFailure] = []
        plan_feedback: SimpleRepairFeedback | None = None
        generation_feedback: SimpleRepairFeedback | None = None
        consecutive_code_repairs = 0
        soundest: SoundCandidate | None = None
        soundest_score: tuple[int, int, int, int] | None = None
        attempts: list[dict[str, Any]] = []

        while True:
            if plan is None or plan_feedback is not None:
                plan_result = await self._obtain_plan(
                    run_id,
                    previous=plan,
                    feedback=plan_feedback,
                    counts=counts,
                )
                if isinstance(plan_result, SimplePipelineOutcome):
                    assert plan_result.failure is not None
                    return await self._recover_sound_candidate_or_fail(
                        run_id,
                        failure=plan_result.failure,
                        soundest=soundest,
                        counts=counts,
                        warnings=warnings,
                        plan=plan,
                        candidate=candidate,
                        execution=execution,
                        review=review,
                    )
                new_plan = plan_result
                binding_failure = self._validate_plan(run_id, new_plan, plan)
                if binding_failure is not None:
                    return self._failed(
                        binding_failure,
                        counts,
                        plan=plan,
                        candidate=candidate,
                        execution=execution,
                        review=review,
                        warnings=warnings,
                    )
                plan = new_plan
                plan_feedback = None
                generation_feedback = None
                consecutive_code_repairs = 0

            out_of_budget = counts["generation_attempts"] >= self._budget.max_generation_attempts
            out_of_time = self._out_of_time(plan, counts["generation_attempts"])
            if out_of_budget or out_of_time:
                if soundest is not None:
                    # Same reasoning as the review-driven fallback below: a sound,
                    # executed candidate is not thrown away because the run ran out of
                    # room. Reaching this from the DEADLINE matters most — the worker's
                    # asyncio.timeout cancels the pipeline outright, so a run that hits
                    # the wall delivers nothing at all, which is strictly worse than a
                    # budget-exhausted one.
                    plan, candidate, execution, review = soundest
                    return await self._finalize(
                        run_id,
                        plan=plan,
                        candidate=candidate,
                        execution=execution,
                        review=review,
                        counts=counts,
                        warnings=warnings,
                    )
                return self._failed(
                    SimplePipelineFailure(
                        kind=(
                            SimpleFailureKind.TIMEOUT
                            if out_of_time
                            else SimpleFailureKind.GENERATION
                        ),
                        stage=SimplePipelineStage.GENERATING,
                        code=(
                            "run_time_budget_exhausted"
                            if out_of_time
                            else "candidate_budget_exhausted"
                        ),
                        message=(
                            "stopped before starting another candidate the run had no time for"
                            if out_of_time
                            else "candidate generation budget exhausted"
                        ),
                    ),
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
                )

            counts["generation_attempts"] += 1
            generated = await self._invoke(
                SimplePipelineStage.GENERATING,
                lambda: self._ports.generate(
                    run_id,
                    plan,
                    candidate,
                    generation_feedback or self._history_feedback(attempts),
                ),
            )
            if generated.failure is not None:
                if (
                    generated.failure.retryable
                    and generated.failure.retry_target is SimpleRetryTarget.GENERATION
                    and counts["generation_attempts"] < self._budget.max_generation_attempts
                ):
                    generation_feedback = self._feedback(generated.failure)
                    continue
                return await self._recover_sound_candidate_or_fail(
                    run_id,
                    failure=generated.failure,
                    soundest=soundest,
                    counts=counts,
                    warnings=warnings,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                )
            new_candidate = generated.value
            assert new_candidate is not None
            binding_failure = self._validate_candidate(run_id, plan, new_candidate, candidate)
            if binding_failure is not None:
                return self._failed(
                    binding_failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
                )
            candidate = new_candidate
            generation_feedback = None
            execution = None
            review = None

            executed = await self._execute(run_id, plan, candidate, counts)
            if isinstance(executed, SimplePipelineFailure):
                return await self._recover_sound_candidate_or_fail(
                    run_id,
                    failure=executed,
                    soundest=soundest,
                    counts=counts,
                    warnings=warnings,
                    plan=plan,
                    candidate=candidate,
                )
            execution = executed
            binding_failure = self._validate_execution(candidate, execution)
            if binding_failure is not None:
                return self._failed(
                    binding_failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    warnings=warnings,
                )
            if not execution.succeeded:
                failure = self._execution_failure(execution)
                signature = self._execution_failure_signature(failure)
                self._record_attempt(
                    attempts,
                    candidate=candidate,
                    reason=failure.code,
                    diagnostics=self._failure_diagnostics(failure),
                    failure_signature=signature,
                )
                repeated_failure = (
                    sum(attempt.get("failure_signature") == signature for attempt in attempts) >= 2
                )
                if (
                    failure.kind
                    in {
                        SimpleFailureKind.RESOURCE,
                        SimpleFailureKind.TIMEOUT,
                    }
                    or repeated_failure
                ) and counts["plan_attempts"] < self._budget.max_plan_attempts:
                    plan_feedback = self._feedback(
                        self._escalated_execution_failure(
                            failure,
                            repeated=repeated_failure,
                        ),
                        attempts,
                    )
                    continue
                if counts["generation_attempts"] < self._budget.max_generation_attempts:
                    generation_feedback = self._feedback(failure, attempts)
                    continue
                return await self._recover_sound_candidate_or_fail(
                    run_id,
                    failure=failure,
                    soundest=soundest,
                    counts=counts,
                    warnings=warnings,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                )

            checked = await self._invoke(
                SimplePipelineStage.CHECKING,
                lambda: self._ports.check_contract(run_id, plan, candidate, execution),
            )
            if checked.failure is not None:
                return await self._recover_sound_candidate_or_fail(
                    run_id,
                    failure=checked.failure,
                    soundest=soundest,
                    counts=counts,
                    warnings=warnings,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                )
            contract = checked.value
            assert contract is not None
            if not contract.passed:
                failure = SimplePipelineFailure(
                    kind=(
                        SimpleFailureKind.PLAN
                        if contract.retry_target is SimpleRetryTarget.PLANNING
                        else SimpleFailureKind.CODE
                    ),
                    stage=SimplePipelineStage.CHECKING,
                    code=contract.code,
                    message=contract.message,
                    retryable=True,
                    retry_target=contract.retry_target,
                    details={"diagnostics": list(contract.diagnostics)},
                )
                self._record_attempt(
                    attempts,
                    candidate=candidate,
                    reason=contract.code,
                    diagnostics=list(contract.diagnostics),
                )
                if (
                    contract.retry_target is SimpleRetryTarget.PLANNING
                    and counts["plan_attempts"] < self._budget.max_plan_attempts
                ):
                    plan_feedback = self._feedback(failure, attempts)
                    continue
                if (
                    contract.retry_target is SimpleRetryTarget.GENERATION
                    and counts["generation_attempts"] < self._budget.max_generation_attempts
                ):
                    generation_feedback = self._feedback(failure, attempts)
                    continue
                return await self._recover_sound_candidate_or_fail(
                    run_id,
                    failure=failure,
                    soundest=soundest,
                    counts=counts,
                    warnings=warnings,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                )

            reviewed = await self._review(run_id, plan, candidate, execution, counts)
            if isinstance(reviewed, SimplePipelineFailure):
                recovered = self._recover_invalid_review(
                    failure=reviewed,
                    plan=plan,
                    candidate=candidate,
                    counts=counts,
                    consecutive_code_repairs=consecutive_code_repairs,
                )
                if recovered is not None:
                    if isinstance(recovered, SimplePipelineFailure):
                        return await self._recover_sound_candidate_or_fail(
                            run_id,
                            failure=recovered,
                            soundest=soundest,
                            counts=counts,
                            warnings=warnings,
                            plan=plan,
                            candidate=candidate,
                            execution=execution,
                        )
                    action, feedback, consecutive_code_repairs = recovered
                    if action is SimpleNextAction.REPLAN:
                        plan_feedback = feedback
                    else:
                        generation_feedback = feedback
                    continue
                return await self._recover_sound_candidate_or_fail(
                    run_id,
                    failure=reviewed,
                    soundest=soundest,
                    counts=counts,
                    warnings=warnings,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                )
            review = reviewed
            binding_failure = self._validate_review(candidate, execution, review)
            if binding_failure is not None:
                return self._failed(
                    binding_failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
                )

            if self._deterministically_sound(review):
                # Keep the strongest candidate whose TRUSTED evidence was complete.
                # Reaching review already proves it executed and satisfied the basic
                # contract; this adds "no deterministic check objected, and the
                # reviewer found nothing blocking". Kept as a fallback so an advisory
                # opinion cannot destroy a run whose evidence is sound — see
                # _accept_without_review_acceptance below.
                score = self._sound_candidate_score(candidate, review)
                if soundest_score is None or score > soundest_score:
                    soundest = (plan, candidate, execution, review)
                    soundest_score = score
                    self._sound_candidate_available = True

            consecutive_code_repairs = (
                consecutive_code_repairs + 1
                if review.decision is SemanticReviewDecision.CODE_REPAIR
                else 0
            )
            action = self._next_action(
                review,
                consecutive_code_repairs=consecutive_code_repairs,
                counts=counts,
            )
            if action is SimpleNextAction.REPAIR_CODE:
                self._record_attempt(
                    attempts,
                    candidate=candidate,
                    reason=review.reason_code,
                    review=review,
                    observed=execution.result,
                )
                generation_feedback = self._review_feedback(
                    action=action,
                    review=review,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    message="intent review requested code repair",
                    consecutive_code_repairs=consecutive_code_repairs,
                    attempts=attempts,
                )
                continue
            if action is SimpleNextAction.REPLAN:
                self._record_attempt(
                    attempts,
                    candidate=candidate,
                    reason=review.reason_code,
                    review=review,
                    observed=execution.result,
                )
                escalated = review.decision is SemanticReviewDecision.CODE_REPAIR
                plan_feedback = self._review_feedback(
                    action=action,
                    review=review,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    message=(
                        "repeated code repair did not resolve the review; revise the Plan "
                        "and its success criterion before generating another candidate"
                        if escalated
                        else "intent review requested replanning"
                    ),
                    consecutive_code_repairs=consecutive_code_repairs,
                    code="repeated_code_repair" if escalated else review.reason_code,
                    attempts=attempts,
                )
                continue
            if action is SimpleNextAction.EXPLAIN_FAILURE and soundest is not None:
                # The budget is gone and the reviewer never said READY, but one
                # candidate's trusted evidence is complete. ADR-0023 calls the intent
                # review advisory; letting an advisory opinion be the only reason a
                # sound, executed, contract-satisfying artifact is destroyed would make
                # it the strongest gate in the pipeline instead of the weakest. Deliver
                # it, recorded as review-unaccepted so nothing claims otherwise.
                plan, candidate, execution, review = soundest
                soundest = None
            elif action is SimpleNextAction.EXPLAIN_FAILURE:
                failure_code = (
                    "plan_budget_exhausted"
                    if review.decision is SemanticReviewDecision.REPLAN
                    else "candidate_budget_exhausted"
                )
                return self._failed(
                    self._review_failure(review, failure_code),
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
                )

            return await self._finalize(
                run_id,
                plan=plan,
                candidate=candidate,
                execution=execution,
                review=review,
                counts=counts,
                warnings=warnings,
            )

    async def _finalize(
        self,
        run_id: UUID,
        *,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
        counts: dict[str, int],
        warnings: list[SimplePipelineFailure],
    ) -> SimplePipelineOutcome:
        """Export (best effort) and save one accepted candidate.

        Extracted so every exhaustion path can reach it. The generation-budget guard
        used to terminalize on its own, which meant Amendment 2's best-effort delivery
        fired only when the budget ran out DURING review — an execution failure that
        consumed the last revision still threw a sound earlier candidate away.
        """

        conversion: ConversionEvidence | None
        exported = await self._invoke(
            SimplePipelineStage.EXPORTING,
            lambda: self._ports.export(run_id, candidate, execution),
        )
        if exported.failure is not None:
            # ADR-0023: export is best effort and cannot gate saving the
            # framework-native artifact. PERSISTENCE counts here too — failing to
            # record OPTIONAL interchange data is not a reason to discard the program
            # the run exists to produce. INTEGRITY stays fatal: that is a binding
            # violation, and the save it guards must not proceed on unbound evidence.
            if exported.failure.kind not in {
                SimpleFailureKind.INTEGRITY,
                SimpleFailureKind.CANCELLED,
            }:
                warnings.append(exported.failure)
                conversion = None
            else:
                return self._failed(
                    exported.failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
                )
        else:
            conversion = exported.value
            assert conversion is not None
            binding_failure = self._validate_conversion(candidate, execution, conversion)
            if binding_failure is not None:
                return self._failed(
                    binding_failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
                )

        saved = await self._save(
            run_id,
            plan,
            candidate,
            execution,
            review,
            conversion,
            counts,
        )
        if isinstance(saved, SimplePipelineFailure):
            return self._failed(
                saved,
                counts,
                plan=plan,
                candidate=candidate,
                execution=execution,
                review=review,
                conversion=conversion,
                warnings=warnings,
            )
        binding_failure = self._validate_artifact(candidate, saved)
        if binding_failure is not None:
            return self._failed(
                binding_failure,
                counts,
                plan=plan,
                candidate=candidate,
                execution=execution,
                review=review,
                conversion=conversion,
                warnings=warnings,
            )
        return SimplePipelineOutcome(
            status=SimplePipelineStatus.SUCCEEDED,
            stage=SimplePipelineStage.COMPLETED,
            counters=self._counters(counts),
            plan=plan,
            candidate=candidate,
            execution=execution,
            review=review,
            conversion=conversion,
            artifact=saved,
            warnings=tuple(warnings),
        )

    async def _recover_sound_candidate_or_fail(
        self,
        run_id: UUID,
        *,
        failure: SimplePipelineFailure,
        soundest: SoundCandidate | None,
        counts: dict[str, int],
        warnings: list[SimplePipelineFailure],
        plan: PlanRevision | None = None,
        candidate: CandidateRevision | None = None,
        execution: ExecutionEvidence | None = None,
        review: SemanticReviewEvidence | None = None,
    ) -> SimplePipelineOutcome:
        """Deliver trusted work when a later, recoverable subsystem stops responding.

        Integrity failures, explicit cancellation, and persistence failures remain
        fail-closed. Everything else here is a failure to improve or re-check a later
        revision; it must not erase an earlier candidate whose execution, contract,
        and deterministic evidence were already complete.
        """

        if soundest is not None and failure.kind not in {
            SimpleFailureKind.INTEGRITY,
            SimpleFailureKind.CANCELLED,
            SimpleFailureKind.PERSISTENCE,
        }:
            warnings.append(failure)
            fallback_plan, fallback_candidate, fallback_execution, fallback_review = soundest
            return await self._finalize(
                run_id,
                plan=fallback_plan,
                candidate=fallback_candidate,
                execution=fallback_execution,
                review=fallback_review,
                counts=counts,
                warnings=warnings,
            )
        return self._failed(
            failure,
            counts,
            plan=plan,
            candidate=candidate,
            execution=execution,
            review=review,
            warnings=warnings,
        )

    async def _obtain_plan(
        self,
        run_id: UUID,
        *,
        previous: PlanRevision | None,
        feedback: SimpleRepairFeedback | None,
        counts: dict[str, int],
    ) -> PlanRevision | SimplePipelineOutcome:
        while counts["plan_attempts"] < self._budget.max_plan_attempts:
            counts["plan_attempts"] += 1
            result = await self._invoke(
                SimplePipelineStage.PLANNING,
                lambda: self._ports.plan(run_id, previous, feedback),
            )
            if result.failure is None:
                assert result.value is not None
                return result.value
            if not (
                result.failure.retryable
                and result.failure.retry_target is SimpleRetryTarget.PLANNING
                and counts["plan_attempts"] < self._budget.max_plan_attempts
            ):
                return self._failed(result.failure, counts, plan=previous)
            feedback = self._feedback(result.failure)
        return self._failed(
            SimplePipelineFailure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="plan_budget_exhausted",
                message="plan emission budget exhausted",
            ),
            counts,
            plan=previous,
        )

    async def _execute(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        counts: dict[str, int],
    ) -> ExecutionEvidence | SimplePipelineFailure:
        for attempt in range(1, self._budget.max_execution_attempts_per_candidate + 1):
            counts["execution_attempts"] += 1
            result = await self._invoke(
                SimplePipelineStage.EXECUTING,
                lambda: self._ports.run_execution(run_id, plan, candidate),
            )
            if result.failure is None:
                assert result.value is not None
                return result.value
            if not (
                result.failure.retryable
                and result.failure.retry_target is SimpleRetryTarget.EXECUTION
                and attempt < self._budget.max_execution_attempts_per_candidate
            ):
                return result.failure
        raise AssertionError("execution loop must return")

    async def _review(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        counts: dict[str, int],
    ) -> SemanticReviewEvidence | SimplePipelineFailure:
        # The budget now covers only MALFORMED reviews — a review that parsed always
        # names a next step, so re-asking would resend identical plan/candidate/
        # execution evidence at temperature 0 and get the identical answer back.
        # That retry used to double every stalled run's review latency for nothing.
        for attempt in range(1, self._budget.max_review_attempts_per_candidate + 1):
            counts["review_attempts"] += 1
            result = await self._invoke(
                SimplePipelineStage.REVIEWING,
                lambda: self._ports.review(run_id, plan, candidate, execution, attempt),
            )
            if result.failure is not None:
                if (
                    result.failure.retryable
                    and result.failure.retry_target is SimpleRetryTarget.REVIEW
                    and attempt < self._budget.max_review_attempts_per_candidate
                ):
                    continue
                return result.failure
            review = result.value
            assert review is not None
            binding_failure = self._validate_review(candidate, execution, review)
            if binding_failure is not None:
                return binding_failure
            return review
        raise AssertionError("review loop must return")

    async def _save(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
        counts: dict[str, int],
    ) -> MaterializedArtifact | SimplePipelineFailure:
        for attempt in range(1, self._budget.max_save_attempts + 1):
            counts["save_attempts"] += 1
            result = await self._invoke(
                SimplePipelineStage.SAVING,
                lambda: self._ports.save(
                    run_id,
                    plan,
                    candidate,
                    execution,
                    review,
                    conversion,
                ),
            )
            if result.failure is None:
                assert result.value is not None
                return result.value
            if not (
                result.failure.retryable
                and result.failure.retry_target is SimpleRetryTarget.SAVE
                and attempt < self._budget.max_save_attempts
            ):
                return result.failure
        raise AssertionError("save loop must return")

    def _out_of_time(self, _plan: PlanRevision, generation_attempts: int) -> bool:
        if self._out_of_time_check is not None and self._out_of_time_check():
            return True
        if self._remaining_time_s is None or generation_attempts == 0:
            # With no candidate there is nothing useful to finalize. Always spend
            # one attempt so a short-but-feasible task is not rejected by defaults.
            return False
        remaining = max(0.0, self._remaining_time_s())
        reserve = self._estimated_finalization_s()
        # Do not require a whole predicted candidate to fit. That conservative rule
        # left revision budget unused after one slow outlier. Start while there is a
        # useful work window, then bound each stage so trusted work still has time to
        # export and save.
        return remaining <= reserve + 15.0

    def _estimated_finalization_s(self) -> float:
        """Reserve only the export/save tail; candidate stages have soft deadlines."""

        defaults = {
            SimplePipelineStage.EXPORTING: 8.0,
            SimplePipelineStage.SAVING: 12.0,
        }
        floors = {
            SimplePipelineStage.EXPORTING: 3.0,
            SimplePipelineStage.SAVING: 5.0,
        }
        predicted = 0.0
        for stage, default in defaults.items():
            samples = self._stage_durations.get(stage)
            if samples:
                # The slower of the last three stages protects against a single fast
                # response making the next start unsafe; 1.5x absorbs normal jitter.
                predicted += max(floors[stage], max(samples[-3:]) * 1.5)
            else:
                predicted += default
        return predicted + max(5.0, predicted * 0.1)

    def _estimated_save_s(self) -> float:
        samples = self._stage_durations.get(SimplePipelineStage.SAVING)
        predicted = max(5.0, max(samples[-3:]) * 1.5) if samples else 12.0
        return predicted + 5.0

    def _stage_timeout_s(self, stage: SimplePipelineStage) -> float | None:
        if self._remaining_time_s is None or stage is SimplePipelineStage.SAVING:
            return None
        remaining = max(0.0, self._remaining_time_s())
        if stage is SimplePipelineStage.EXPORTING:
            reserve = self._estimated_save_s()
        else:
            reserve = self._estimated_finalization_s() if self._sound_candidate_available else 5.0
        return max(0.1, remaining - reserve)

    async def _invoke(
        self,
        stage: SimplePipelineStage,
        operation: Callable[[], Awaitable[SimplePortResult[T]]],
    ) -> SimplePortResult[T]:
        if self._cancel_requested is not None:
            try:
                if await self._cancel_requested():
                    return SimplePortResult.failed(
                        SimplePipelineFailure(
                            kind=SimpleFailureKind.CANCELLED,
                            stage=stage,
                            code="run_cancelled",
                            message="run was cancelled",
                        )
                    )
            except Exception:  # cancellation storage failure is terminal, never ignored
                return SimplePortResult.failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.INTERNAL,
                        stage=stage,
                        code="cancellation_check_failed",
                        message="could not determine cancellation state",
                    )
                )
        started_at = self._monotonic()
        try:
            timeout_s = self._stage_timeout_s(stage)
            if timeout_s is None:
                result = await operation()
            else:
                async with asyncio.timeout(timeout_s):
                    result = await operation()
        except TimeoutError:
            return SimplePortResult.failed(
                SimplePipelineFailure(
                    kind=SimpleFailureKind.TIMEOUT,
                    stage=stage,
                    code="stage_time_budget_exhausted",
                    message=f"{stage.value} stopped to preserve time for finalization",
                )
            )
        except Exception:  # raw exception text must not cross the product boundary
            log.exception("unexpected simple pipeline stage failure", extra={"stage": stage.value})
            return SimplePortResult.failed(
                SimplePipelineFailure(
                    kind=SimpleFailureKind.INTERNAL,
                    stage=stage,
                    code="unexpected_stage_error",
                    message=f"{stage.value} failed unexpectedly",
                )
            )
        finally:
            duration = max(0.0, self._monotonic() - started_at)
            self._stage_durations.setdefault(stage, []).append(duration)
        if result.failure is not None and result.failure.stage is not stage:
            return SimplePortResult.failed(
                SimplePipelineFailure(
                    kind=SimpleFailureKind.INTEGRITY,
                    stage=stage,
                    code="failure_stage_mismatch",
                    message="port returned a failure for a different stage",
                )
            )
        return result

    @staticmethod
    def _validate_plan(
        run_id: UUID,
        plan: PlanRevision,
        previous: PlanRevision | None,
    ) -> SimplePipelineFailure | None:
        if plan.run_id != run_id:
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.PLANNING, "plan_run_mismatch"
            )
        if previous is None:
            if plan.revision != 1 or plan.parent_plan_id is not None:
                return SimpleCircuitPipeline._integrity(
                    SimplePipelineStage.PLANNING, "initial_plan_revision_mismatch"
                )
        else:
            if plan.parent_plan_id != previous.plan_id or plan.revision != previous.revision + 1:
                return SimpleCircuitPipeline._integrity(
                    SimplePipelineStage.PLANNING, "plan_revision_mismatch"
                )
            if plan.plan.framework is not previous.plan.framework:
                return SimpleCircuitPipeline._integrity(
                    SimplePipelineStage.PLANNING, "plan_framework_changed"
                )
        return None

    @staticmethod
    def _validate_candidate(
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        previous: CandidateRevision | None,
    ) -> SimplePipelineFailure | None:
        if candidate.run_id != run_id or candidate.plan_id != plan.plan_id:
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.GENERATING, "candidate_plan_binding_mismatch"
            )
        if candidate.framework is not plan.plan.framework:
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.GENERATING, "candidate_framework_mismatch"
            )
        if previous is None:
            if candidate.revision != 1 or candidate.parent_candidate_id is not None:
                return SimpleCircuitPipeline._integrity(
                    SimplePipelineStage.GENERATING, "initial_candidate_revision_mismatch"
                )
        elif (
            candidate.parent_candidate_id != previous.candidate_id
            or candidate.revision != previous.revision + 1
        ):
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.GENERATING, "candidate_revision_mismatch"
            )
        return None

    @staticmethod
    def _validate_execution(
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> SimplePipelineFailure | None:
        if (
            execution.candidate_id != candidate.candidate_id
            or execution.source_fingerprint != candidate.source_fingerprint
        ):
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.EXECUTING, "execution_binding_mismatch"
            )
        return None

    @staticmethod
    def _validate_review(
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
    ) -> SimplePipelineFailure | None:
        try:
            review.assert_binding(candidate, execution)
        except ValueError:
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.REVIEWING, "review_binding_mismatch"
            )
        return None

    @staticmethod
    def _validate_conversion(
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        conversion: ConversionEvidence,
    ) -> SimplePipelineFailure | None:
        if (
            conversion.candidate_id != candidate.candidate_id
            or conversion.execution_id != execution.execution_id
            or conversion.source_fingerprint != candidate.source_fingerprint
        ):
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.EXPORTING, "conversion_binding_mismatch"
            )
        return None

    @staticmethod
    def _validate_artifact(
        candidate: CandidateRevision,
        artifact: MaterializedArtifact,
    ) -> SimplePipelineFailure | None:
        if (
            artifact.candidate_id != candidate.candidate_id
            or artifact.framework is not candidate.framework
            or artifact.source_fingerprint != candidate.source_fingerprint
        ):
            return SimpleCircuitPipeline._integrity(
                SimplePipelineStage.SAVING, "artifact_binding_mismatch"
            )
        return None

    @staticmethod
    def _execution_failure(execution: ExecutionEvidence) -> SimplePipelineFailure:
        kind = execution.failure_kind or ExecutionFailureKind.CODE_ERROR
        failure_kind = {
            ExecutionFailureKind.TIMEOUT: SimpleFailureKind.TIMEOUT,
            ExecutionFailureKind.MEMORY_EXHAUSTED: SimpleFailureKind.RESOURCE,
            ExecutionFailureKind.RESOURCE_LIMIT: SimpleFailureKind.RESOURCE,
            ExecutionFailureKind.CODE_ERROR: SimpleFailureKind.CODE,
        }[kind]
        retry_target = (
            SimpleRetryTarget.PLANNING
            if kind is ExecutionFailureKind.RESOURCE_LIMIT
            else SimpleRetryTarget.GENERATION
        )
        observation = execution.observation
        details: dict[str, Any] = {
            "exit_code": execution.exit_code,
            "failure_kind": kind.value,
        }
        for key in (
            "evidence_error",
            "sandbox_error",
            "contract_diagnostics",
            "guard_violations",
        ):
            value = observation.get(key)
            if isinstance(value, str):
                # Tracebacks end with the actionable exception, so retain the tail.
                details[key] = value[-4_000:]
            elif isinstance(value, list):
                details[key] = [str(item)[-500:] for item in value[:20]]
        for key in (
            "estimated_memory_mb",
            "memory_limit_mb",
            "qubits",
        ):
            value = observation.get(key)
            if isinstance(value, int | float):
                details[key] = value
        return SimplePipelineFailure(
            kind=failure_kind,
            stage=SimplePipelineStage.EXECUTING,
            code=f"execution_{kind.value}",
            message="candidate execution did not satisfy the execution contract",
            retryable=True,
            retry_target=retry_target,
            details=details,
        )

    @staticmethod
    def _failure_diagnostics(failure: SimplePipelineFailure) -> list[str]:
        """Flatten bounded actionable diagnostics for later repair revisions."""

        diagnostics: list[str] = []
        for key in (
            "diagnostics",
            "contract_diagnostics",
            "guard_violations",
            "evidence_error",
            "sandbox_error",
        ):
            value = failure.details.get(key)
            if isinstance(value, str) and value.strip():
                diagnostics.append(f"{key}: {value[-4_000:]}")
            elif isinstance(value, (list, tuple)):
                diagnostics.extend(
                    f"{key}: {str(item)[-500:]}" for item in value[:20] if str(item).strip()
                )
        return diagnostics[-24:]

    @staticmethod
    def _execution_failure_signature(failure: SimplePipelineFailure) -> str:
        """Stable defect identity used to detect a non-converging repair loop."""

        diagnostics = SimpleCircuitPipeline._failure_diagnostics(failure)
        tail = diagnostics[-1] if diagnostics else ""
        return f"{failure.code}|{tail[-800:]}"

    @staticmethod
    def _escalated_execution_failure(
        failure: SimplePipelineFailure,
        *,
        repeated: bool,
    ) -> SimplePipelineFailure:
        details = dict(failure.details)
        details["controller"] = {
            "action": SimpleNextAction.REPLAN.value,
            "reason": (
                "same_execution_failure_repeated" if repeated else "execution_resource_or_timeout"
            ),
        }
        return SimplePipelineFailure(
            kind=failure.kind,
            stage=failure.stage,
            code=("repeated_execution_failure" if repeated else f"{failure.code}_requires_replan"),
            message=(
                "the same execution defect survived a code repair; change the "
                "implementation strategy and resource assumptions in the Plan"
                if repeated
                else "revise the Plan to fit the sandbox runtime and resource limits"
            ),
            retryable=True,
            retry_target=SimpleRetryTarget.PLANNING,
            details=details,
        )

    @staticmethod
    def _review_failure(review: SemanticReviewEvidence, code: str) -> SimplePipelineFailure:
        return SimplePipelineFailure(
            kind=SimpleFailureKind.REVIEW,
            stage=SimplePipelineStage.REVIEWING,
            code=code,
            message="intent review did not align the candidate",
            details={
                "reason_code": review.reason_code,
                "decision": review.decision.value,
            },
        )

    @staticmethod
    def _history_feedback(
        attempts: list[dict[str, Any]],
    ) -> SimpleRepairFeedback | None:
        """Carry the defect history across a replan.

        A replan clears generation_feedback, which is right for the critique of a plan
        that no longer exists — but the code defects it collected are facts about the
        code, not about the plan. Dropping them let the first candidate under a new
        plan re-make the exact defects that forced the replan, spending the enlarged
        budget on ground already covered.
        """

        if not attempts:
            return None
        return SimpleRepairFeedback(
            stage=SimplePipelineStage.GENERATING,
            code="prior_attempts_only",
            message=(
                "the Plan was revised; these earlier revisions were rejected for the "
                "reasons listed and must not be repeated"
            ),
            details={"prior_attempts": list(attempts)},
        )

    @staticmethod
    def _record_attempt(
        attempts: list[dict[str, Any]],
        *,
        candidate: CandidateRevision,
        reason: str,
        review: SemanticReviewEvidence | None = None,
        diagnostics: list[str] | None = None,
        observed: dict[str, Any] | None = None,
        failure_signature: str | None = None,
    ) -> None:
        """Keep a compact record of what was already tried, and why it was rejected.

        The generation port only ever sees the IMMEDIATELY preceding candidate, so
        without this the model can re-make a mistake it made two revisions ago — and
        at temperature 0 it reliably does. namekoQ gets this for free: its agent is
        one conversation, so every earlier attempt, traceback, and critic verdict is
        still in the message history when it writes attempt four.

        Sources are deliberately excluded. The previous source is already sent in
        full, and the useful signal from older attempts is the DEFECT and the fix
        that was already prescribed and did not work, not another 100 KB of code.
        """

        entry: dict[str, Any] = {
            "revision": candidate.revision,
            "rejected_because": reason,
        }
        if observed:
            # What that revision actually reported. "You already tried X and it
            # produced Y" is the comparison that makes a repair converge.
            entry["reported"] = observed
        critic = review.feedback.get("critic") if review is not None else None
        if isinstance(critic, dict):
            for key in ("summary", "mismatches", "repair_instructions", "failed_checks"):
                value = critic.get(key)
                if value:
                    entry[key] = value
        if diagnostics:
            entry["diagnostics"] = diagnostics
        if failure_signature:
            entry["failure_signature"] = failure_signature
        attempts.append(entry)

    @staticmethod
    def _deterministically_sound(review: SemanticReviewEvidence) -> bool:
        """One definition, shared with the durable stores. See
        SemanticReviewEvidence.evidence_is_complete."""

        return review.evidence_is_complete()

    @staticmethod
    def _sound_candidate_score(
        candidate: CandidateRevision,
        review: SemanticReviewEvidence,
    ) -> tuple[int, int, int, int]:
        """Prefer accepted, lower-severity, better-evidenced, later revisions."""

        severity_score = {
            None: 3,
            "none": 4,
            "minor": 2,
            "major": 1,
            "blocking": 0,
        }[review.severity]
        checks = review.feedback.get("basic_checks")
        passed_checks = (
            sum(isinstance(check, dict) and check.get("result") == "pass" for check in checks)
            if isinstance(checks, list)
            else 0
        )
        return (
            int(review.decision is SemanticReviewDecision.READY),
            severity_score,
            passed_checks,
            candidate.revision,
        )

    def _next_action(
        self,
        review: SemanticReviewEvidence,
        *,
        consecutive_code_repairs: int,
        counts: dict[str, int],
    ) -> SimpleNextAction:
        """Bounded nameko-style transition policy.

        The reviewer advises; this controller owns transitions. A second
        consecutive CODE_REPAIR means one code-only remedy already failed, so
        the remaining uncertainty includes the Plan and must be replanned when
        that budget is available. This prevents a mistaken success criterion
        from consuming every candidate revision.
        """

        if review.decision is SemanticReviewDecision.READY:
            return SimpleNextAction.ACCEPT
        if review.decision is SemanticReviewDecision.REPLAN:
            return (
                SimpleNextAction.REPLAN
                if counts["plan_attempts"] < self._budget.max_plan_attempts
                else SimpleNextAction.EXPLAIN_FAILURE
            )
        if (
            review.decision is SemanticReviewDecision.CODE_REPAIR
            and consecutive_code_repairs >= self._budget.max_consecutive_code_repairs
            and counts["plan_attempts"] < self._budget.max_plan_attempts
        ):
            return SimpleNextAction.REPLAN
        if counts["generation_attempts"] < self._budget.max_generation_attempts:
            return SimpleNextAction.REPAIR_CODE
        return SimpleNextAction.EXPLAIN_FAILURE

    def _recover_invalid_review(
        self,
        *,
        failure: SimplePipelineFailure,
        plan: PlanRevision,
        candidate: CandidateRevision,
        counts: dict[str, int],
        consecutive_code_repairs: int,
    ) -> tuple[SimpleNextAction, SimpleRepairFeedback, int] | SimplePipelineFailure | None:
        """Treat exhausted malformed-review retries as recoverable feedback.

        A malformed critic is not evidence that a successfully executed candidate
        is irreparable. It cannot authorize acceptance either, so route it through
        the same bounded repair/replan controller as an explicit CODE_REPAIR.
        Other review failures (for example provider outage) retain their typed
        terminal behavior instead of pointlessly regenerating equivalent code.
        """
        if not (
            failure.kind is SimpleFailureKind.MODEL_OUTPUT
            and failure.stage is SimplePipelineStage.REVIEWING
        ):
            return None

        next_streak = consecutive_code_repairs + 1
        action = (
            SimpleNextAction.REPLAN
            if (
                next_streak >= self._budget.max_consecutive_code_repairs
                and counts["plan_attempts"] < self._budget.max_plan_attempts
            )
            else SimpleNextAction.REPAIR_CODE
        )
        details = dict(failure.details)
        details["controller"] = {
            "action": action.value,
            "candidate_revision": candidate.revision,
            "consecutive_code_repairs": next_streak,
            "review_failure_code": failure.code,
            "primary_metric": plan.plan.success_criteria.primary_metric,
            "expected_range": plan.plan.success_criteria.expected_range,
        }
        if action is SimpleNextAction.REPLAN:
            return (
                action,
                SimpleRepairFeedback(
                    stage=SimplePipelineStage.REVIEWING,
                    code="repeated_review_output_invalid",
                    message=(
                        "the reviewer could not return usable structured feedback after "
                        "repeated attempts; revise the Plan before generating another candidate"
                    ),
                    details=details,
                ),
                next_streak,
            )
        if counts["generation_attempts"] < self._budget.max_generation_attempts:
            return (
                action,
                SimpleRepairFeedback(
                    stage=SimplePipelineStage.REVIEWING,
                    code=failure.code,
                    message=(
                        "the reviewer could not return usable structured feedback; "
                        "produce a simpler, directly inspectable candidate"
                    ),
                    details=details,
                ),
                next_streak,
            )
        return SimplePipelineFailure(
            kind=SimpleFailureKind.REVIEW,
            stage=SimplePipelineStage.REVIEWING,
            code="review_feedback_budget_exhausted",
            message=(
                "reviewer output remained unusable after the bounded repair budget; "
                "the last candidate is available for inspection"
            ),
            details=details,
        )

    @staticmethod
    def _review_feedback(
        *,
        action: SimpleNextAction,
        review: SemanticReviewEvidence,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        message: str,
        consecutive_code_repairs: int,
        code: str | None = None,
        attempts: list[dict[str, Any]] | None = None,
    ) -> SimpleRepairFeedback:
        metric = plan.plan.success_criteria.primary_metric
        observed = execution.result.get(metric)
        if not isinstance(observed, str | int | float | bool | type(None)):
            observed = None
        details = dict(review.feedback)
        details["controller"] = {
            "action": action.value,
            "candidate_revision": candidate.revision,
            "consecutive_code_repairs": consecutive_code_repairs,
            "observed_primary_metric": observed,
            "primary_metric": metric,
            "expected_range": plan.plan.success_criteria.expected_range,
            "review_decision": review.decision.value,
            "review_reason_code": review.reason_code,
        }
        if attempts:
            details["prior_attempts"] = list(attempts)
        return SimpleRepairFeedback(
            stage=SimplePipelineStage.REVIEWING,
            code=code or review.reason_code,
            message=message,
            details=details,
        )

    @staticmethod
    def _feedback(
        failure: SimplePipelineFailure,
        attempts: list[dict[str, Any]] | None = None,
    ) -> SimpleRepairFeedback:
        details = dict(failure.details)
        if attempts:
            details["prior_attempts"] = list(attempts)
        return SimpleRepairFeedback(
            stage=failure.stage,
            code=failure.code,
            message=failure.message,
            details=details,
        )

    @staticmethod
    def _integrity(stage: SimplePipelineStage, code: str) -> SimplePipelineFailure:
        return SimplePipelineFailure(
            kind=SimpleFailureKind.INTEGRITY,
            stage=stage,
            code=code,
            message="durable evidence binding failed",
        )

    @staticmethod
    def _counters(counts: dict[str, int]) -> SimplePipelineCounters:
        return SimplePipelineCounters(**counts)

    @classmethod
    def _failed(
        cls,
        failure: SimplePipelineFailure,
        counts: dict[str, int],
        *,
        plan: PlanRevision | None = None,
        candidate: CandidateRevision | None = None,
        execution: ExecutionEvidence | None = None,
        review: SemanticReviewEvidence | None = None,
        conversion: ConversionEvidence | None = None,
        warnings: list[SimplePipelineFailure] | tuple[SimplePipelineFailure, ...] = (),
    ) -> SimplePipelineOutcome:
        return SimplePipelineOutcome(
            status=(
                SimplePipelineStatus.CANCELLED
                if failure.kind is SimpleFailureKind.CANCELLED
                else SimplePipelineStatus.FAILED
            ),
            stage=failure.stage,
            counters=cls._counters(counts),
            plan=plan,
            candidate=candidate,
            execution=execution,
            review=review,
            conversion=conversion,
            failure=failure,
            warnings=tuple(warnings),
        )

    @classmethod
    def _with_context(
        cls,
        outcome: SimplePipelineOutcome,
        *,
        plan: PlanRevision | None,
        candidate: CandidateRevision | None,
        execution: ExecutionEvidence | None,
        review: SemanticReviewEvidence | None,
        warnings: list[SimplePipelineFailure],
        counts: dict[str, int],
    ) -> SimplePipelineOutcome:
        assert outcome.failure is not None
        return cls._failed(
            outcome.failure,
            counts,
            plan=plan or outcome.plan,
            candidate=candidate,
            execution=execution,
            review=review,
            warnings=warnings,
        )
