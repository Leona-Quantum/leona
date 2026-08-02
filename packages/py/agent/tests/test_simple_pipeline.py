"""Provider-free audit matrix for the fixed nameko-style pipeline."""

from __future__ import annotations

import asyncio
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
        review_feedback: dict | None = None,
        review_severity: str | None = None,
    ) -> None:
        self.calls: list[str] = []
        self.review_decisions = list(reviews or [SemanticReviewDecision.READY])
        self._last_review = SemanticReviewDecision.READY
        self.review_feedback = review_feedback
        self.review_severity = review_severity
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
        # Repeat the last scripted decision once the script runs out, so a test that
        # means "a reviewer that never accepts" stays true regardless of the budget.
        if self.review_decisions:
            self._last_review = self.review_decisions.pop(0)
        decision = self._last_review
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
                severity=self.review_severity,
                feedback=self.review_feedback
                if self.review_feedback is not None
                else {"decision": decision.value},
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


async def test_blocked_review_repairs_candidate_and_continues_autonomously():
    ports = FakePorts(
        reviews=[
            SemanticReviewDecision.CODE_REPAIR,
            SemanticReviewDecision.READY,
        ]
    )
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None and outcome.candidate.revision == 2
    # One review call per candidate. A review that parsed always names a next step,
    # so re-asking it the identical question was pure latency.
    assert outcome.counters.review_attempts == 2
    feedback = ports.generation_feedback[1]
    assert feedback is not None
    assert "code repair" in feedback.message


async def test_repeated_code_repair_escalates_to_replan_before_spending_the_budget():
    """The escalation that a never-accepting review used to make unreachable.

    Two consecutive code repairs mean one code-only remedy already failed, so the
    remaining uncertainty includes the Plan. This branch keys on CONSECUTIVE
    CODE_REPAIR decisions, which is why the retired fourth "cannot tell" outcome
    could burn every candidate revision without the replan budget ever being touched.
    """

    ports = FakePorts(reviews=[SemanticReviewDecision.CODE_REPAIR])
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.counters.plan_attempts == SimplePipelineBudget().max_plan_attempts
    assert ports.plan_feedback[1] is not None
    assert "revise the Plan" in ports.plan_feedback[1].message
    assert "export" not in ports.calls
    assert "save" not in ports.calls


async def test_never_accepted_review_stops_at_candidate_budget_without_certifying():
    ports = FakePorts(reviews=[SemanticReviewDecision.CODE_REPAIR])
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_generation_attempts=2, max_plan_attempts=1),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "candidate_budget_exhausted"
    assert outcome.counters.generation_attempts == 2
    assert outcome.counters.review_attempts == 2
    assert "export" not in ports.calls
    assert "save" not in ports.calls
    final_feedback = ports.generation_feedback[1]
    assert final_feedback is not None
    assert final_feedback.details["candidate_budget"] == {
        "attempt": 2,
        "limit": 2,
        "remaining_after_this": 0,
        "last_chance": True,
    }


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


# --- An advisory review cannot destroy a sound run ------------------------------
#
# namekoQ has no acceptance gate at all: its loop ends on a step count and whatever
# the model last said is the deliverable. Majorana made the reviewer's READY a
# precondition for producing anything, so an advisory opinion — ADR-0023's own word
# for it — was the strongest gate in the pipeline. These pin the fallback.


def _sound_review_feedback() -> dict:
    return {"basic_checks": [{"method": "success_criteria", "result": "pass"}]}


async def test_sound_candidate_is_delivered_when_review_never_accepts():
    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback=_sound_review_feedback(),
        review_severity="minor",
    )

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.artifact is not None
    # Delivered, but nothing pretends the reviewer accepted it.
    assert outcome.review is not None
    assert outcome.review.decision is SemanticReviewDecision.CODE_REPAIR
    assert "save" in ports.calls


async def test_a_blocking_defect_is_never_delivered_as_a_fallback():
    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback=_sound_review_feedback(),
        review_severity="blocking",
    )

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert "save" not in ports.calls


async def test_a_failed_deterministic_check_is_never_delivered_as_a_fallback():
    """The fallback rests on trusted evidence, so a failed check disqualifies it —
    including a Plan-declared reference the reported number contradicted."""

    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback={
            "basic_checks": [
                {"method": "success_criteria", "result": "pass"},
                {"method": "exact_diag", "result": "fail"},
            ]
        },
        review_severity="minor",
    )

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert "save" not in ports.calls


async def test_an_accepted_review_still_takes_the_normal_path():
    ports = FakePorts(reviews=[SemanticReviewDecision.READY])

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.review is not None
    assert outcome.review.decision is SemanticReviewDecision.READY
    assert outcome.counters.generation_attempts == 1


# --- Repair history --------------------------------------------------------------
#
# The generation port only ever receives the immediately preceding candidate, so
# without an accumulated record the model can re-make a mistake it made two
# revisions ago — and at temperature 0 it reliably does. namekoQ gets this free from
# its single-conversation message history.


async def test_repair_feedback_accumulates_every_earlier_rejection():
    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback={
            "critic": {
                "summary": "the entangling gate is still missing",
                "mismatches": ["no CNOT between the qubits"],
                "repair_instructions": ["add qc.cx(0, 1)"],
            }
        },
        review_severity="minor",
    )

    await SimpleCircuitPipeline(ports=ports).run(uuid4())

    # Feedback for the 2nd candidate knows about 1 rejection; the 3rd knows about 2.
    second = ports.generation_feedback[1]
    third = ports.generation_feedback[2]
    assert second is not None and third is not None
    assert [entry["revision"] for entry in second.details["prior_attempts"]] == [1]
    assert [entry["revision"] for entry in third.details["prior_attempts"]] == [1, 2]
    # The fix that was already prescribed and did not work travels with it.
    assert third.details["prior_attempts"][0]["repair_instructions"] == ["add qc.cx(0, 1)"]
    assert third.details["prior_attempts"][0]["rejected_because"]


async def test_execution_failures_are_recorded_in_the_history_too():
    ports = FakePorts(fail_first_execution=True)

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    second = ports.generation_feedback[1]
    assert second is not None
    prior = second.details["prior_attempts"]
    assert [entry["revision"] for entry in prior] == [1]
    assert prior[0]["rejected_because"]


async def test_the_first_generation_carries_no_history():
    ports = FakePorts()

    await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert ports.generation_feedback[0] is None


async def test_defect_history_survives_a_replan():
    """A replan clears the plan's critique — which is right — but the code defects it
    collected are facts about the code, so dropping them let the first candidate under
    a new plan re-make the exact defects that forced the replan."""

    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback={"critic": {"repair_instructions": ["add qc.cx(0, 1)"]}},
        review_severity="minor",
    )

    await SimpleCircuitPipeline(ports=ports).run(uuid4())

    # The 3rd generation is the first under the revised plan (2 consecutive code
    # repairs escalate), so its feedback is the carried-over history, not a critique.
    third = ports.generation_feedback[2]
    assert third is not None
    assert third.code == "prior_attempts_only"
    assert [entry["revision"] for entry in third.details["prior_attempts"]] == [1, 2]


async def test_running_out_of_time_delivers_the_sound_candidate_instead_of_nothing():
    """The worker's asyncio.timeout cancels mid-stage and yields nothing at all, which
    is strictly worse than budget exhaustion. The pipeline stops one candidate early."""

    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback={"basic_checks": [{"method": "success_criteria", "result": "pass"}]},
        review_severity="minor",
    )
    clock = {"expired": False}

    async def run():
        return await SimpleCircuitPipeline(
            ports=ports,
            out_of_time=lambda: clock["expired"],
        ).run(uuid4())

    # Time runs out after the first candidate has been reviewed.
    original = ports.review

    async def review_then_expire(*args, **kwargs):
        result = await original(*args, **kwargs)
        clock["expired"] = True
        return result

    ports.review = review_then_expire
    outcome = await run()

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.artifact is not None
    assert outcome.counters.generation_attempts == 1
    assert "save" in ports.calls


async def test_running_out_of_time_without_a_sound_candidate_is_a_typed_failure():
    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback={"basic_checks": [{"method": "success_criteria", "result": "fail"}]},
        review_severity="minor",
    )

    outcome = await SimpleCircuitPipeline(ports=ports, out_of_time=lambda: True).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "run_time_budget_exhausted"
    assert "save" not in ports.calls


class _FakeMonotonic:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class _ClockedPorts(FakePorts):
    def __init__(self, clock: _FakeMonotonic, *, slow: bool) -> None:
        super().__init__(
            reviews=[SemanticReviewDecision.CODE_REPAIR],
            review_feedback=_sound_review_feedback(),
            review_severity="minor",
        )
        self.clock = clock
        self.slow = slow

    async def plan(self, *args):
        result = await super().plan(*args)
        self.clock.advance(1)
        return result

    async def generate(self, *args):
        result = await super().generate(*args)
        self.clock.advance(20 if self.slow else 2)
        return result

    async def run_execution(self, *args):
        result = await super().run_execution(*args)
        self.clock.advance(20 if self.slow else 2)
        return result

    async def check_contract(self, *args):
        result = await super().check_contract(*args)
        self.clock.advance(1)
        return result

    async def review(self, *args):
        result = await super().review(*args)
        self.clock.advance(20 if self.slow else 2)
        return result

    async def export(self, *args):
        result = await super().export(*args)
        self.clock.advance(1)
        return result

    async def save(self, *args):
        result = await super().save(*args)
        self.clock.advance(1)
        return result


async def test_adaptive_time_budget_uses_candidate_budget_when_stages_are_fast():
    clock = _FakeMonotonic()
    ports = _ClockedPorts(clock, slow=False)

    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_generation_attempts=4),
        remaining_time_s=lambda: 100 - clock(),
        monotonic=clock,
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.generation_attempts == 4
    assert outcome.candidate is not None and outcome.candidate.revision == 4


async def test_adaptive_time_budget_stops_slow_loop_and_saves_sound_candidate():
    clock = _FakeMonotonic()
    ports = _ClockedPorts(clock, slow=True)

    outcome = await SimpleCircuitPipeline(
        ports=ports,
        remaining_time_s=lambda: 100 - clock(),
        monotonic=clock,
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.generation_attempts == 1
    assert outcome.candidate is not None and outcome.candidate.revision == 1
    assert clock() < 100


async def test_slow_stage_is_cut_off_before_it_can_consume_finalization_time():
    class HangingSecondGenerationPorts(FakePorts):
        async def generate(self, run_id, plan, previous, feedback):
            if previous is not None:
                await asyncio.sleep(1)
                raise AssertionError("the stage deadline should cancel this operation")
            return await super().generate(run_id, plan, previous, feedback)

    ports = HangingSecondGenerationPorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback=_sound_review_feedback(),
        review_severity="minor",
    )

    remaining_checks = {"count": 0}

    def remaining() -> float:
        remaining_checks["count"] += 1
        # Calls 1-5 bound plan and the first candidate; call 6 admits candidate
        # two; its generation-stage call then sees only 0.1 s beyond the 25 s
        # finalization reserve.
        return 25.1 if remaining_checks["count"] >= 7 else 100.0

    outcome = await SimpleCircuitPipeline(
        ports=ports,
        remaining_time_s=remaining,
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None and outcome.candidate.revision == 1
    assert outcome.counters.generation_attempts == 2
    assert outcome.warnings[-1].code == "stage_time_budget_exhausted"


async def test_slow_optional_export_is_cut_off_so_artifact_can_still_save():
    class HangingExportPorts(FakePorts):
        async def export(self, *_args):
            await asyncio.sleep(1)
            raise AssertionError("the export deadline should cancel this operation")

    ports = HangingExportPorts()
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        remaining_time_s=lambda: 17.1,
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.conversion is None
    assert outcome.warnings[-1].code == "stage_time_budget_exhausted"
    assert ports.calls[-1] == "save"


async def test_an_upstream_timeout_is_not_reported_as_our_budget():
    """A TimeoutError from inside the operation is not the stage running out of time.

    Since Python 3.10 `socket.timeout` IS `TimeoutError`, so a provider read
    timeout lands in the same `except` clause as our own `asyncio.timeout`. Both
    used to claim the stage "stopped to preserve time for finalization" — naming
    Leona's budget management as the cause when the budget was untouched.

    Measured in production: a post-deploy probe reported
    `stage_time_budget_exhausted` at the plan stage 97 ms into a stage that had
    roughly 90 seconds, and the deploy gate's one diagnostic line blamed the
    budget. Here the budget is enormous and the failure is instant, which is that
    shape with the ambiguity removed.
    """

    class InstantlyTimingOutExportPorts(FakePorts):
        async def export(self, *_args):
            raise TimeoutError("upstream read timed out")

    ports = InstantlyTimingOutExportPorts()
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        remaining_time_s=lambda: 10_000.0,
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.conversion is None
    warning = outcome.warnings[-1]
    assert warning.code == "stage_upstream_timed_out"
    # The numbers that make the attribution checkable rather than asserted.
    assert warning.details["elapsed_s"] < warning.details["stage_budget_s"]
    assert ports.calls[-1] == "save"


async def test_export_persistence_failure_does_not_discard_the_artifact():
    """Export is optional interchange data; failing to record it is not a reason to
    throw away the framework-native program the run exists to produce."""

    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.PERSISTENCE,
        stage=SimplePipelineStage.EXPORTING,
        code="export_persistence_failed",
        message="could not persist export evidence",
    )
    ports = FakePorts(export_failure=failure)

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.artifact is not None
    assert outcome.warnings == (failure,)


async def test_export_integrity_failure_is_still_fatal():
    """A binding violation is fail-closed: the save it guards must not proceed."""

    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.INTEGRITY,
        stage=SimplePipelineStage.EXPORTING,
        code="export_binding_failed",
        message="export evidence binding failed",
    )
    ports = FakePorts(export_failure=failure)

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert "save" not in ports.calls


async def test_prior_attempts_carry_what_each_revision_reported():
    """ "You already tried X and it produced Y" is the comparison that converges."""

    ports = FakePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback={"critic": {"repair_instructions": ["use the right ansatz"]}},
        review_severity="minor",
    )

    await SimpleCircuitPipeline(ports=ports).run(uuid4())

    second = ports.generation_feedback[1]
    assert second is not None
    assert second.details["prior_attempts"][0]["reported"] == {"counts": {"00": 50, "11": 50}}


async def test_repeated_execution_defect_escalates_to_replan_and_recovers():
    class RepeatedExecutionFailurePorts(FakePorts):
        async def run_execution(self, run_id, plan, candidate):
            if candidate.revision > 2:
                return await super().run_execution(run_id, plan, candidate)
            self.calls.append("execute")
            return SimplePortResult.success(
                ExecutionEvidence(
                    execution_id=uuid4(),
                    candidate_id=candidate.candidate_id,
                    source_fingerprint=candidate.source_fingerprint,
                    environment_fingerprint="e" * 64,
                    sandbox_provider="test",
                    exit_code=1,
                    failure_kind=ExecutionFailureKind.CODE_ERROR,
                    duration_ms=3,
                    result={},
                    observation={
                        "evidence_error": "code_error",
                        "sandbox_error": "NameError: same_broken_api",
                    },
                )
            )

    ports = RepeatedExecutionFailurePorts()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.plan is not None and outcome.plan.revision == 2
    assert outcome.candidate is not None and outcome.candidate.revision == 3
    feedback = ports.plan_feedback[1]
    assert feedback is not None
    assert feedback.code == "repeated_execution_failure"
    assert feedback.details["controller"]["reason"] == "same_execution_failure_repeated"
    assert (
        "sandbox_error: NameError: same_broken_api"
        in feedback.details["prior_attempts"][0]["diagnostics"]
    )


async def test_late_generation_provider_failure_delivers_trusted_candidate():
    class LateProviderFailurePorts(FakePorts):
        async def generate(self, run_id, plan, previous, feedback):
            if previous is not None:
                self.calls.append("generate")
                self.generation_feedback.append(feedback)
                return SimplePortResult.failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.PROVIDER,
                        stage=SimplePipelineStage.GENERATING,
                        code="generation_provider_unavailable",
                        message="generation provider unavailable",
                    )
                )
            return await super().generate(run_id, plan, previous, feedback)

    ports = LateProviderFailurePorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback=_sound_review_feedback(),
        review_severity="minor",
    )
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None and outcome.candidate.revision == 1
    assert outcome.warnings
    assert outcome.warnings[-1].code == "generation_provider_unavailable"
    assert "save" in ports.calls


async def test_best_sound_candidate_replaces_weaker_earlier_fallback():
    class RankedFallbackPorts(FakePorts):
        async def generate(self, run_id, plan, previous, feedback):
            if previous is not None and previous.revision == 2:
                self.calls.append("generate")
                self.generation_feedback.append(feedback)
                return SimplePortResult.failed(
                    SimplePipelineFailure(
                        kind=SimpleFailureKind.PROVIDER,
                        stage=SimplePipelineStage.GENERATING,
                        code="generation_provider_unavailable",
                        message="generation provider unavailable",
                    )
                )
            return await super().generate(run_id, plan, previous, feedback)

        async def review(self, run_id, plan, candidate, execution, attempt):
            result = await super().review(run_id, plan, candidate, execution, attempt)
            assert result.value is not None
            severity = "minor" if candidate.revision == 1 else "none"
            return SimplePortResult.success(result.value.model_copy(update={"severity": severity}))

    ports = RankedFallbackPorts(
        reviews=[SemanticReviewDecision.CODE_REPAIR],
        review_feedback=_sound_review_feedback(),
    )
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None and outcome.candidate.revision == 2
    assert outcome.review is not None and outcome.review.severity == "none"


async def test_export_provider_failure_is_best_effort():
    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.PROVIDER,
        stage=SimplePipelineStage.EXPORTING,
        code="export_provider_unavailable",
        message="export provider unavailable",
    )
    ports = FakePorts(export_failure=failure)

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.conversion is None
    assert outcome.warnings == (failure,)
