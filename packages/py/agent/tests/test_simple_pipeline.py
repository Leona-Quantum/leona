"""Provider-free audit matrix for the fixed nameko-style pipeline."""

from __future__ import annotations

import hashlib
import json
from uuid import UUID, uuid4

import pytest
from majorana_agent import (
    BasicContractResult,
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionFailureKind,
    MaterializedArtifact,
    PlanRevision,
    SemanticReviewEvidence,
    SimpleCircuitPipeline,
    SimpleFailureKind,
    SimplePipelineBudget,
    SimplePipelineFailure,
    SimplePipelineStage,
    SimplePipelineStatus,
    SimplePortResult,
    SimpleRetryTarget,
)
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram


def _plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build and execute a Bell circuit",
            "algorithm_rationale": "Entanglement matches the requested state",
            "parameters": {"shots": 100, "seed": 7},
            "qubits_estimate": 2,
            "expected_runtime_sec": 10,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
        }
    )


def _plan_revision(
    run_id: UUID,
    revision: int,
    *,
    parent_plan_id: UUID | None = None,
    reason: str | None = None,
) -> PlanRevision:
    plan = _plan()
    fingerprint = hashlib.sha256(
        json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return PlanRevision(
        plan_id=uuid4(),
        run_id=run_id,
        revision=revision,
        parent_plan_id=parent_plan_id,
        plan=plan,
        plan_fingerprint=fingerprint,
        replan_reason=reason,
    )


class FakePorts:
    def __init__(
        self,
        *,
        reviews: list[SemanticReviewDecision] | None = None,
        fail_first_execution: bool = False,
        export_failure: SimplePipelineFailure | None = None,
        save_failures: int = 0,
    ) -> None:
        self.calls: list[str] = []
        self.review_decisions = list(reviews or [SemanticReviewDecision.READY])
        self.fail_first_execution = fail_first_execution
        self.export_failure = export_failure
        self.save_failures = save_failures
        self.plan_feedback = []
        self.generation_feedback = []

    async def plan(self, run_id, previous, feedback):
        self.calls.append("plan")
        self.plan_feedback.append(feedback)
        revision = 1 if previous is None else previous.revision + 1
        return SimplePortResult.success(
            _plan_revision(
                run_id,
                revision,
                parent_plan_id=previous.plan_id if previous else None,
                reason=feedback.message if previous and feedback else None,
            )
        )

    async def generate(self, run_id, plan, previous, feedback):
        self.calls.append("generate")
        self.generation_feedback.append(feedback)
        revision = 1 if previous is None else previous.revision + 1
        source = (
            "from qiskit import QuantumCircuit\n"
            f"REVISION = {revision}\n"
            "FINAL_CIRCUIT = QuantumCircuit(2)\n"
            "RESULT = {'counts': {'00': 50, '11': 50}}\n"
        )
        program = FrameworkProgram(framework=Framework.QISKIT, source=source)
        return SimplePortResult.success(
            CandidateRevision(
                candidate_id=uuid4(),
                run_id=run_id,
                tool_call_id=f"simple-generate-{revision}",
                revision=revision,
                parent_candidate_id=previous.candidate_id if previous else None,
                plan_id=plan.plan_id,
                framework=Framework.QISKIT,
                source=source,
                source_fingerprint=program.fingerprint,
            )
        )

    async def run_execution(self, _run_id, _plan, candidate):
        self.calls.append("execute")
        should_fail = self.fail_first_execution and candidate.revision == 1
        return SimplePortResult.success(
            ExecutionEvidence(
                execution_id=uuid4(),
                candidate_id=candidate.candidate_id,
                source_fingerprint=candidate.source_fingerprint,
                environment_fingerprint="e" * 64,
                sandbox_provider="test",
                exit_code=1 if should_fail else 0,
                failure_kind=ExecutionFailureKind.CODE_ERROR if should_fail else None,
                duration_ms=3,
                result={} if should_fail else {"counts": {"00": 50, "11": 50}},
                observation=(
                    {
                        "evidence_error": "code_error",
                        "sandbox_error": ("prefix-" + "x" * 4_500 + "\nNameError: broken_api"),
                        "guard_violations": ["disallowed_import:qiskit_algorithms"],
                    }
                    if should_fail
                    else {}
                ),
            )
        )

    async def check_contract(self, _run_id, _plan, _candidate, _execution):
        self.calls.append("check")
        return SimplePortResult.success(BasicContractResult(passed=True))

    async def review(self, _run_id, _plan, candidate, execution, attempt):
        self.calls.append("review")
        decision = (
            self.review_decisions.pop(0)
            if self.review_decisions
            else (SemanticReviewDecision.READY)
        )
        failure_class = None
        retry_target = RetryTarget.NONE
        if decision is SemanticReviewDecision.CODE_REPAIR:
            failure_class = VerificationFailureClass.CANDIDATE_DEFECT
            retry_target = RetryTarget.CODE_GENERATION
        elif decision is SemanticReviewDecision.REPLAN:
            failure_class = VerificationFailureClass.PLAN_DEFECT
            retry_target = RetryTarget.PLANNING
        elif decision is SemanticReviewDecision.INCONCLUSIVE:
            failure_class = VerificationFailureClass.VERIFIER_FAILURE
            retry_target = RetryTarget.VERIFICATION
        return SimplePortResult.success(
            SemanticReviewEvidence(
                review_id=uuid4(),
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                attempt_seq=attempt,
                decision=decision,
                reason_code=f"review_{decision.value}",
                failure_class=failure_class,
                retry_target=retry_target,
                feedback={"decision": decision.value},
            )
        )

    async def export(self, _run_id, candidate, execution):
        self.calls.append("export")
        if self.export_failure is not None:
            return SimplePortResult.failed(self.export_failure)
        return SimplePortResult.success(
            ConversionEvidence(
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                status="unavailable",
                reason="test adapter has no exporter",
            )
        )

    async def save(self, _run_id, _plan, candidate, _execution, _review, _conversion):
        self.calls.append("save")
        if self.save_failures:
            self.save_failures -= 1
            return SimplePortResult.failed(
                SimplePipelineFailure(
                    kind=SimpleFailureKind.PERSISTENCE,
                    stage=SimplePipelineStage.SAVING,
                    code="database_temporarily_unavailable",
                    message="artifact save can be retried",
                    retryable=True,
                    retry_target=SimpleRetryTarget.SAVE,
                )
            )
        return SimplePortResult.success(
            MaterializedArtifact(
                artifact_id=uuid4(),
                version_id=uuid4(),
                version_seq=1,
                candidate_id=candidate.candidate_id,
                framework=candidate.framework,
                source_fingerprint=candidate.source_fingerprint,
            )
        )


async def test_fixed_happy_path_has_no_model_selected_transition():
    ports = FakePorts()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert ports.calls == ["plan", "generate", "execute", "check", "review", "export", "save"]
    assert outcome.artifact is not None
    assert outcome.counters.plan_attempts == 1
    assert outcome.counters.generation_attempts == 1
    assert outcome.counters.review_attempts == 1


async def test_execution_error_repairs_with_a_new_candidate_revision():
    ports = FakePorts(fail_first_execution=True)
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None
    assert outcome.candidate.revision == 2
    assert ports.calls[:5] == ["plan", "generate", "execute", "generate", "execute"]
    assert outcome.counters.generation_attempts == 2
    feedback = ports.generation_feedback[1]
    assert feedback is not None
    assert feedback.details["failure_kind"] == "code_error"
    assert feedback.details["sandbox_error"].endswith("NameError: broken_api")
    assert len(feedback.details["sandbox_error"]) == 4_000
    assert feedback.details["guard_violations"] == ["disallowed_import:qiskit_algorithms"]


async def test_retryable_plan_port_failure_retries_once_then_succeeds():
    class FlakyPlanPorts(FakePorts):
        def __init__(self):
            super().__init__()
            self.failed_once = False

        async def plan(self, run_id, previous, feedback):
            if not self.failed_once:
                self.failed_once = True
                self.calls.append("plan")
                return SimplePortResult.failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.PROVIDER,
                        stage=SimplePipelineStage.PLANNING,
                        code="provider_timeout",
                        message="planner provider timed out",
                        retryable=True,
                        retry_target=SimpleRetryTarget.PLANNING,
                    )
                )
            return await super().plan(run_id, previous, feedback)

    ports = FlakyPlanPorts()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.plan_attempts == 2
    assert ports.calls[:2] == ["plan", "plan"]


async def test_retryable_execution_port_failure_retries_same_candidate():
    class FlakyExecutionPorts(FakePorts):
        def __init__(self):
            super().__init__()
            self.failed_once = False

        async def run_execution(self, run_id, plan, candidate):
            if not self.failed_once:
                self.failed_once = True
                self.calls.append("execute")
                return SimplePortResult.failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.RESOURCE,
                        stage=SimplePipelineStage.EXECUTING,
                        code="sandbox_temporarily_unavailable",
                        message="sandbox provider did not start",
                        retryable=True,
                        retry_target=SimpleRetryTarget.EXECUTION,
                    )
                )
            return await super().run_execution(run_id, plan, candidate)

    ports = FlakyExecutionPorts()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.execution_attempts == 2
    assert outcome.counters.generation_attempts == 1


async def test_retryable_review_port_failure_retries_without_new_candidate():
    class FlakyReviewPorts(FakePorts):
        def __init__(self):
            super().__init__()
            self.failed_once = False

        async def review(self, run_id, plan, candidate, execution, attempt):
            if not self.failed_once:
                self.failed_once = True
                self.calls.append("review")
                return SimplePortResult.failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.PROVIDER,
                        stage=SimplePipelineStage.REVIEWING,
                        code="review_provider_timeout",
                        message="review provider timed out",
                        retryable=True,
                        retry_target=SimpleRetryTarget.REVIEW,
                    )
                )
            return await super().review(run_id, plan, candidate, execution, attempt)

    ports = FlakyReviewPorts()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.review_attempts == 2
    assert outcome.counters.generation_attempts == 1


async def test_invalid_reviewer_output_recovers_through_repair_then_replan():
    class InvalidReviewPorts(FakePorts):
        async def review(self, _run_id, _plan, _candidate, _execution, _attempt):
            self.calls.append("review")
            return SimplePortResult.failed(
                SimplePipelineFailure(
                    kind=SimpleFailureKind.MODEL_OUTPUT,
                    stage=SimplePipelineStage.REVIEWING,
                    code="review_output_invalid",
                    message="intent reviewer returned invalid structured data",
                    retryable=True,
                    retry_target=SimpleRetryTarget.REVIEW,
                )
            )

    ports = InvalidReviewPorts()
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_plan_attempts=2, max_generation_attempts=3),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "review_feedback_budget_exhausted"
    assert outcome.counters.plan_attempts == 2
    assert outcome.counters.generation_attempts == 3
    assert outcome.counters.review_attempts == 6
    assert ports.plan_feedback[1] is not None
    assert ports.plan_feedback[1].code == "repeated_review_output_invalid"
    assert "save" not in ports.calls


async def test_review_can_request_one_replan_without_selecting_tools():
    ports = FakePorts(reviews=[SemanticReviewDecision.REPLAN, SemanticReviewDecision.READY])
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.plan is not None and outcome.plan.revision == 2
    assert outcome.candidate is not None and outcome.candidate.revision == 2
    assert outcome.counters.plan_attempts == 2
    assert ports.calls.count("plan") == 2


async def test_repeated_code_repair_escalates_to_replan_with_observed_metric():
    ports = FakePorts(
        reviews=[
            SemanticReviewDecision.CODE_REPAIR,
            SemanticReviewDecision.CODE_REPAIR,
            SemanticReviewDecision.READY,
        ]
    )
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.plan is not None and outcome.plan.revision == 2
    assert outcome.candidate is not None and outcome.candidate.revision == 3
    assert outcome.counters.plan_attempts == 2
    assert outcome.counters.generation_attempts == 3
    assert ports.calls.count("plan") == 2
    feedback = ports.plan_feedback[1]
    assert feedback is not None
    assert feedback.code == "repeated_code_repair"
    assert feedback.details["controller"] == {
        "action": "replan",
        "candidate_revision": 2,
        "consecutive_code_repairs": 2,
        "observed_primary_metric": None,
        "primary_metric": "counts",
        "expected_range": None,
        "review_decision": "code_repair",
        "review_reason_code": "review_code_repair",
    }


async def test_repeated_code_repair_remains_finite_without_replan_budget():
    ports = FakePorts(reviews=[SemanticReviewDecision.CODE_REPAIR] * 3)
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(
            max_plan_attempts=1,
            max_generation_attempts=3,
        ),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "candidate_budget_exhausted"
    assert outcome.counters.plan_attempts == 1
    assert outcome.counters.generation_attempts == 3
    assert "save" not in ports.calls


async def test_inconclusive_review_repairs_candidate_and_continues_autonomously():
    ports = FakePorts(
        reviews=[
            SemanticReviewDecision.INCONCLUSIVE,
            SemanticReviewDecision.INCONCLUSIVE,
            SemanticReviewDecision.READY,
        ]
    )
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None and outcome.candidate.revision == 2
    assert outcome.counters.review_attempts == 3
    feedback = ports.generation_feedback[1]
    assert feedback is not None
    assert feedback.code == "review_inconclusive"
    assert "expose the missing evidence" in feedback.message


async def test_repeated_inconclusive_review_stops_at_candidate_budget_without_certifying():
    ports = FakePorts(
        reviews=[SemanticReviewDecision.INCONCLUSIVE] * 4,
    )
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_generation_attempts=2),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "intent_review_inconclusive"
    assert outcome.counters.generation_attempts == 2
    assert outcome.counters.review_attempts == 4
    assert "export" not in ports.calls
    assert "save" not in ports.calls


async def test_export_failure_is_a_warning_and_does_not_block_python_artifact():
    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.EXPORT,
        stage=SimplePipelineStage.EXPORTING,
        code="openqasm_unavailable",
        message="framework export is unsupported",
    )
    ports = FakePorts(export_failure=failure)
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.conversion is None
    assert outcome.warnings == (failure,)
    assert outcome.artifact is not None
    assert ports.calls[-2:] == ["export", "save"]


async def test_non_export_integrity_failure_cannot_be_downgraded_to_warning():
    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.INTEGRITY,
        stage=SimplePipelineStage.EXPORTING,
        code="conversion_binding_mismatch",
        message="conversion binding failed",
    )
    ports = FakePorts(export_failure=failure)
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure == failure
    assert "save" not in ports.calls


async def test_transient_save_failure_retries_within_finite_budget():
    ports = FakePorts(save_failures=1)
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.save_attempts == 2
    assert ports.calls[-2:] == ["save", "save"]


async def test_persistent_save_failure_exhausts_budget_and_terminates():
    ports = FakePorts(save_failures=3)
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_save_attempts=2),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.kind is SimpleFailureKind.PERSISTENCE
    assert outcome.counters.save_attempts == 2
    assert ports.calls[-2:] == ["save", "save"]


async def test_cancellation_returns_a_terminal_outcome_before_calling_a_port():
    ports = FakePorts()

    async def cancelled():
        return True

    outcome = await SimpleCircuitPipeline(
        ports=ports,
        cancel_requested=cancelled,
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.CANCELLED
    assert outcome.failure is not None
    assert outcome.failure.kind is SimpleFailureKind.CANCELLED
    assert ports.calls == []


async def test_unexpected_exception_is_sanitized_and_terminal():
    class ExplodingPorts(FakePorts):
        async def generate(self, *_args):
            raise RuntimeError("SECRET provider payload")

    outcome = await SimpleCircuitPipeline(ports=ExplodingPorts()).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "unexpected_stage_error"
    assert "SECRET" not in outcome.failure.message


async def test_candidate_budget_exhaustion_is_finite_and_never_saves():
    ports = FakePorts(
        reviews=[
            SemanticReviewDecision.CODE_REPAIR,
            SemanticReviewDecision.CODE_REPAIR,
        ]
    )
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_generation_attempts=2),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "candidate_budget_exhausted"
    assert outcome.counters.generation_attempts == 2
    assert "save" not in ports.calls


async def test_stale_execution_fingerprint_fails_closed():
    class StaleExecutionPorts(FakePorts):
        async def run_execution(self, run_id, plan, candidate):
            result = await super().run_execution(run_id, plan, candidate)
            assert result.value is not None
            return SimplePortResult.success(
                result.value.model_copy(update={"source_fingerprint": "f" * 64})
            )

    outcome = await SimpleCircuitPipeline(ports=StaleExecutionPorts()).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.kind is SimpleFailureKind.INTEGRITY
    assert outcome.failure.code == "execution_binding_mismatch"


async def test_stale_inconclusive_review_fails_before_retrying_review():
    class StaleReviewPorts(FakePorts):
        async def review(self, run_id, plan, candidate, execution, attempt):
            result = await super().review(run_id, plan, candidate, execution, attempt)
            assert result.value is not None
            return SimplePortResult.success(
                result.value.model_copy(
                    update={
                        "decision": SemanticReviewDecision.INCONCLUSIVE,
                        "failure_class": VerificationFailureClass.VERIFIER_FAILURE,
                        "retry_target": RetryTarget.VERIFICATION,
                        "source_fingerprint": "f" * 64,
                    }
                )
            )

    ports = StaleReviewPorts()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.kind is SimpleFailureKind.INTEGRITY
    assert outcome.failure.code == "review_binding_mismatch"
    assert outcome.counters.review_attempts == 1


async def test_initial_candidate_must_start_at_revision_one():
    class SkippedRevisionPorts(FakePorts):
        async def generate(self, run_id, plan, previous, feedback):
            result = await super().generate(run_id, plan, previous, feedback)
            assert result.value is not None
            return SimplePortResult.success(
                result.value.model_copy(update={"revision": 2, "parent_candidate_id": uuid4()})
            )

    outcome = await SimpleCircuitPipeline(ports=SkippedRevisionPorts()).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.kind is SimpleFailureKind.INTEGRITY
    assert outcome.failure.code == "initial_candidate_revision_mismatch"


def test_port_result_and_budget_reject_ambiguous_or_unbounded_shapes():
    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.INTERNAL,
        stage=SimplePipelineStage.PLANNING,
        code="test",
        message="test",
    )
    with pytest.raises(ValueError, match="exactly one"):
        SimplePortResult()
    with pytest.raises(ValueError, match="exactly one"):
        SimplePortResult(value="value", failure=failure)
    with pytest.raises(ValueError, match="at least 1"):
        SimplePipelineBudget(max_plan_attempts=0)
