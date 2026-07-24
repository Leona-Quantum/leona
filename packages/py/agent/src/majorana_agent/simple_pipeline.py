"""Deterministic nameko-style circuit pipeline.

The model supplies typed content through ports; it never selects a tool or the next
stage. Expected failures are returned as data, and every finite-budget path returns a
terminal outcome.
"""

from __future__ import annotations

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
    max_plan_attempts: int = 2
    max_generation_attempts: int = 4
    max_consecutive_code_repairs: int = 2
    max_execution_attempts_per_candidate: int = 2
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


class SimpleCircuitPipeline:
    """Run the fixed Plan → Generate → Execute → Review → Export → Save flow."""

    def __init__(
        self,
        *,
        ports: SimplePipelinePorts,
        budget: SimplePipelineBudget | None = None,
        cancel_requested: CancelCheck | None = None,
    ) -> None:
        self._ports = ports
        self._budget = budget or SimplePipelineBudget()
        self._cancel_requested = cancel_requested

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
        conversion: ConversionEvidence | None = None
        warnings: list[SimplePipelineFailure] = []
        plan_feedback: SimpleRepairFeedback | None = None
        generation_feedback: SimpleRepairFeedback | None = None
        consecutive_code_repairs = 0

        while True:
            if plan is None or plan_feedback is not None:
                plan_result = await self._obtain_plan(
                    run_id,
                    previous=plan,
                    feedback=plan_feedback,
                    counts=counts,
                )
                if isinstance(plan_result, SimplePipelineOutcome):
                    return self._with_context(
                        plan_result,
                        plan=plan,
                        candidate=candidate,
                        execution=execution,
                        review=review,
                        warnings=warnings,
                        counts=counts,
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

            if counts["generation_attempts"] >= self._budget.max_generation_attempts:
                return self._failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.GENERATION,
                        stage=SimplePipelineStage.GENERATING,
                        code="candidate_budget_exhausted",
                        message="candidate generation budget exhausted",
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
                    generation_feedback,
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
                return self._failed(
                    generated.failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    review=review,
                    warnings=warnings,
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
            conversion = None

            executed = await self._execute(run_id, plan, candidate, counts)
            if isinstance(executed, SimplePipelineFailure):
                return self._failed(
                    executed,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    warnings=warnings,
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
                if (
                    execution.failure_kind is ExecutionFailureKind.RESOURCE_LIMIT
                    and counts["plan_attempts"] < self._budget.max_plan_attempts
                ):
                    plan_feedback = self._feedback(failure)
                    continue
                if counts["generation_attempts"] < self._budget.max_generation_attempts:
                    generation_feedback = self._feedback(failure)
                    continue
                return self._failed(
                    failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    warnings=warnings,
                )

            checked = await self._invoke(
                SimplePipelineStage.CHECKING,
                lambda: self._ports.check_contract(run_id, plan, candidate, execution),
            )
            if checked.failure is not None:
                return self._failed(
                    checked.failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    warnings=warnings,
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
                if (
                    contract.retry_target is SimpleRetryTarget.PLANNING
                    and counts["plan_attempts"] < self._budget.max_plan_attempts
                ):
                    plan_feedback = self._feedback(failure)
                    continue
                if (
                    contract.retry_target is SimpleRetryTarget.GENERATION
                    and counts["generation_attempts"] < self._budget.max_generation_attempts
                ):
                    generation_feedback = self._feedback(failure)
                    continue
                return self._failed(
                    failure,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    warnings=warnings,
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
                        return self._failed(
                            recovered,
                            counts,
                            plan=plan,
                            candidate=candidate,
                            execution=execution,
                            warnings=warnings,
                        )
                    action, feedback, consecutive_code_repairs = recovered
                    if action is SimpleNextAction.REPLAN:
                        plan_feedback = feedback
                    else:
                        generation_feedback = feedback
                    continue
                return self._failed(
                    reviewed,
                    counts,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    warnings=warnings,
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
                message = (
                    "intent review remained inconclusive; revise the candidate "
                    "to expose the missing evidence and satisfy the Plan"
                    if review.decision is SemanticReviewDecision.INCONCLUSIVE
                    else "intent review requested code repair"
                )
                generation_feedback = self._review_feedback(
                    action=action,
                    review=review,
                    plan=plan,
                    candidate=candidate,
                    execution=execution,
                    message=message,
                    consecutive_code_repairs=consecutive_code_repairs,
                )
                continue
            if action is SimpleNextAction.REPLAN:
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
                )
                continue
            if action is SimpleNextAction.EXPLAIN_FAILURE:
                failure_code = (
                    "plan_budget_exhausted"
                    if review.decision is SemanticReviewDecision.REPLAN
                    else "intent_review_inconclusive"
                    if review.decision is SemanticReviewDecision.INCONCLUSIVE
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

            exported = await self._invoke(
                SimplePipelineStage.EXPORTING,
                lambda: self._ports.export(run_id, candidate, execution),
            )
            if exported.failure is not None:
                if exported.failure.kind is SimpleFailureKind.EXPORT:
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
        last_inconclusive: SemanticReviewEvidence | None = None
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
            if review.decision is not SemanticReviewDecision.INCONCLUSIVE:
                return review
            last_inconclusive = review
        assert last_inconclusive is not None
        return last_inconclusive

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
        try:
            result = await operation()
        except Exception:  # raw exception text must not cross the product boundary
            return SimplePortResult.failed(
                SimplePipelineFailure(
                    kind=SimpleFailureKind.INTERNAL,
                    stage=stage,
                    code="unexpected_stage_error",
                    message=f"{stage.value} failed unexpectedly",
                )
            )
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
        return SimpleRepairFeedback(
            stage=SimplePipelineStage.REVIEWING,
            code=code or review.reason_code,
            message=message,
            details=details,
        )

    @staticmethod
    def _feedback(failure: SimplePipelineFailure) -> SimpleRepairFeedback:
        return SimpleRepairFeedback(
            stage=failure.stage,
            code=failure.code,
            message=failure.message,
            details=failure.details,
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
