"""Durability and trust-boundary tests for ADR-0023 production ports."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import get_args
from uuid import uuid4

import pytest
from majorana_agent import (
    SimplePipelineStage,
    SimpleRepairFeedback,
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionOutput,
    MaterializedArtifact,
    MemoryAgentStore,
    SemanticReviewEvidence,
    SimpleCircuitPipeline,
    SimplePipelineStatus,
    SimpleRetryTarget,
)
from majorana_contracts.enums import (
    Algorithm,
    EvidenceStrength,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationMethod,
    VerifierDecision,
)
from majorana_contracts.plan import Plan, ProblemTerm, ReferenceProblem
from majorana_frameworks import FrameworkProgram
from majorana_llm import LLMProviderError, LLMResponse

from majorana_worker import simple_ports as simple_ports_module
from majorana_worker.simple_ports import (
    ProductionSimplePipelinePorts,
    RepoReviewArtifactSaver,
    SimpleIntentReviewer,
    SimpleIntentReviewResult,
    _reference_checks,
    _reference_check_routing,
    passed_reference_methods,
    simple_pipeline_verification_summary,
)


def _plan_payload() -> dict:
    return {
        "domain": "quantum information",
        "framework": "qiskit",
        "algorithm": "Bell",
        "problem_summary": "Build and execute a Bell state circuit",
        "algorithm_rationale": "Entanglement implements the requested state",
        "parameters": {"shots": 100, "seed": 7},
        "qubits_estimate": 2,
        "expected_runtime_sec": 10,
        "success_criteria": {"primary_metric": "counts"},
        "expected_output_keys": ["counts"],
        "verification_plan": {
            "methods": ["return_contract"],
        },
    }


_SOURCE = """from qiskit import QuantumCircuit
FINAL_CIRCUIT = QuantumCircuit(2)
FINAL_CIRCUIT.h(0)
FINAL_CIRCUIT.cx(0, 1)
RESULT = {"counts": {"00": 50, "11": 50}}
"""


class QueueLLM:
    def __init__(self, texts):
        self.texts = list(texts)
        self.requests = []

    async def complete(self, request, *, on_delta=None):
        self.requests.append(request)
        return LLMResponse(
            text=self.texts.pop(0),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


class Executor:
    def __init__(self):
        self.calls = 0

    async def run_candidate(self, candidate, _plan):
        self.calls += 1
        return ExecutionOutput(
            environment_fingerprint="e" * 64,
            sandbox_provider="test",
            exit_code=0,
            duration_ms=1,
            result={"counts": {"00": 50, "11": 50}},
            observation={
                "resource_metrics": {
                    "qubits": 2,
                    "depth": 2,
                    "gate_count": 2,
                    "two_qubit_gate_count": 1,
                    "measurement_count": 0,
                    "estimated_runtime_ms": 1,
                },
                "native_optimization": {"applied": False},
                "interchange_qasm": "OPENQASM 3.0;\nqubit[2] q;",
                "sandbox_stdout": '{"counts": {"wrong": 999}}',
                "sandbox_runs": 1,
            },
        )


class Reviewer:
    def __init__(self):
        self.calls = 0

    async def review(self, _candidate, _execution, _plan, fast_checks, _attempt):
        self.calls += 1
        assert {check["method"] for check in fast_checks} == {
            "structural",
            "return_contract",
            "success_criteria",
        }
        assert (
            next(check for check in fast_checks if check["method"] == "success_criteria")["result"]
            == "pass"
        )
        return SimpleIntentReviewResult(
            decision=SemanticReviewDecision.READY,
            critic={
                "decision": "pass",
                "confidence": "high",
                "severity": "none",
                "summary": "request, plan, source, and RESULT align",
            },
            retry_target=RetryTarget.NONE,
            reason_code="semantic_ready",
        )


class Converter:
    def __init__(self):
        self.calls = 0

    async def convert(self, _candidate, execution):
        self.calls += 1
        return execution.observation["interchange_qasm"], None


class Saver:
    def __init__(self):
        self.calls = 0

    async def save(self, candidate, _execution, _review, _conversion, _plan):
        self.calls += 1
        return MaterializedArtifact(
            artifact_id=uuid4(),
            version_id=uuid4(),
            version_seq=1,
            candidate_id=candidate.candidate_id,
            framework=candidate.framework,
            source_fingerprint=candidate.source_fingerprint,
        )


class Observer:
    def __init__(self):
        self.results = []
        self.candidates = []

    async def candidate_generated(self, _run_id, candidate):
        self.candidates.append(candidate)

    async def tool_finished(self, _run_id, result):
        self.results.append(result)


def _ports(*, observer=None, rollback=None):
    llm = QueueLLM(
        [
            json.dumps(_plan_payload()),
            json.dumps({"source": _SOURCE}),
        ]
    )
    executor = Executor()
    reviewer = Reviewer()
    converter = Converter()
    saver = Saver()
    observer = observer or Observer()
    ports = ProductionSimplePipelinePorts(
        store=MemoryAgentStore(),
        observer=observer,
        llm=llm,
        executor=executor,
        reviewer=reviewer,
        converter=converter,
        saver=saver,
        task_prompt="prepare a two-qubit Bell state",
        framework=Framework.QISKIT,
        requested_shots=100,
        requested_seed=7,
        rollback=rollback,
    )
    return ports, llm, executor, reviewer, converter, saver, observer


async def test_production_ports_complete_fixed_flow_without_strict_verification():
    ports, llm, executor, reviewer, converter, saver, observer = _ports()
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.plan is not None
    assert outcome.plan.plan.verification_plan is None
    assert outcome.execution is not None
    assert outcome.execution.result == {"counts": {"00": 50, "11": 50}}
    assert len(llm.requests) == 2
    assert llm.requests[0].schema_name == "request_plan"
    assert "artifact_contract" in llm.requests[0].response_schema["properties"]
    assert "verification_plan" in llm.requests[0].response_schema["properties"]
    assert llm.requests[1].schema_name == "generate_circuit"
    assert executor.calls == reviewer.calls == converter.calls == saver.calls == 1
    assert all(result.tool_call_id.startswith("simple:") for result in observer.results)
    assert all(result.name.value != "strict_verify" for result in observer.results)
    assert all(result.state.value != "ready_for_strict_verification" for result in observer.results)


async def test_simple_plan_normalizes_measurement_contract_that_killed_vqe():
    ports, llm, *_ = _ports()
    payload = _plan_payload()
    payload["algorithm"] = "VQE"
    payload["expected_output_keys"] = ["energy"]
    payload["success_criteria"] = {"primary_metric": "energy"}
    payload["artifact_contract"] = {
        "artifact_type": "script",
        "measurement_policy": "measure_all",
        "top_level_execution": "required",
    }
    llm.texts[0] = json.dumps(payload)

    planned = await ports.plan(uuid4(), None, None)

    assert planned.value is not None
    assert planned.value.plan.artifact_contract is not None
    assert planned.value.plan.artifact_contract.measurement_policy.value == "only_if_requested"
    assert planned.value.plan.verification_plan is None


async def test_plan_retry_receives_bounded_validation_issues():
    ports, llm, *_ = _ports()
    invalid = _plan_payload()
    invalid["algorithm"] = "invented-algorithm"
    llm.texts = [
        json.dumps(invalid),
        json.dumps(_plan_payload()),
        json.dumps({"source": _SOURCE}),
    ]

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    repair_request = json.loads(llm.requests[1].user)
    feedback = repair_request["repair_feedback"]
    assert feedback["code"] == "plan_output_invalid"
    [issue] = feedback["details"]["validation_issues"]
    assert issue["path"] == "algorithm"
    assert issue["type"] == "enum"
    assert "VQE" in issue["message"]


async def test_permanent_provider_failure_is_specific_and_not_retried_by_stage():
    class FailingLLM:
        def __init__(self):
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise LLMProviderError(
                provider="deepseek",
                model=request.model,
                code="quota_exhausted",
                retryable=False,
                status_code=429,
            )

    ports, *_ = _ports()
    llm = FailingLLM()
    ports._llm = llm

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "plan_provider_quota_exhausted"
    assert outcome.failure.message == (
        "plan provider unavailable (deepseek:quota_exhausted, HTTP 429)"
    )
    assert outcome.failure.details["provider"] == "deepseek"
    assert outcome.counters.plan_attempts == 1
    assert llm.calls == 1


class _RateLimitedLLM:
    async def complete(self, request, *, on_delta=None):
        raise LLMProviderError(
            provider="deepseek",
            model=request.model,
            code="rate_limited",
            retryable=True,
            status_code=429,
        )


async def test_transient_provider_failure_at_plan_is_retryable_within_its_own_stage():
    ports, *_ = _ports()
    ports._llm = _RateLimitedLLM()

    result = await ports.plan(uuid4(), None, None)

    assert result.failure is not None
    assert result.failure.retryable is True
    assert result.failure.retry_target is SimpleRetryTarget.PLANNING
    assert result.failure.code == "plan_provider_rate_limited"


async def test_transient_provider_failure_at_generate_is_retryable_within_its_own_stage():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    ports._llm = _RateLimitedLLM()

    result = await ports.generate(run_id, planned.value, None, None)

    assert result.failure is not None
    assert result.failure.retryable is True
    assert result.failure.retry_target is SimpleRetryTarget.GENERATION
    assert result.failure.code == "generation_provider_rate_limited"


async def test_transient_provider_failure_at_review_is_retryable_within_its_own_stage():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)

    class RateLimitedReviewer:
        async def review(self, *_args, **_kwargs):
            raise LLMProviderError(
                provider="deepseek",
                model="deepseek-v4-pro",
                code="upstream_unavailable",
                retryable=True,
                status_code=503,
            )

    ports._reviewer = RateLimitedReviewer()

    reviewed = await ports.review(run_id, planned.value, generated.value, executed.value, 1)

    assert reviewed.failure is not None
    assert reviewed.failure.retryable is True
    assert reviewed.failure.retry_target is SimpleRetryTarget.REVIEW
    assert reviewed.failure.code == "review_provider_upstream_unavailable"


async def test_plan_and_generate_share_the_exact_task_reference():
    """A live H2 VQE run (019f9763, 2026-07-25) fabricated Hamiltonian coefficients
    that were internally self-consistent but not physically real. The planner and
    generator now receive the same task-matched reference."""
    ports, llm, *_ = _ports()
    # The product's common request omits a bond length. In that case the standard
    # molecular ground-state interpretation is equilibrium geometry; an explicit
    # different bond length is still excluded by known_reference_for_task.
    ports._task_prompt = "Estimate the H2 molecular ground-state energy with VQE"
    payload = _plan_payload()
    payload["algorithm"] = "VQE"
    payload["success_criteria"] = {"primary_metric": "ground_state_energy_Ha"}
    payload["expected_output_keys"] = ["ground_state_energy_Ha"]
    llm.texts[0] = json.dumps(payload)
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    assert planned.value.plan.verification_plan is not None
    terms = planned.value.plan.verification_plan.reference_hamiltonian
    assert terms is not None
    assert terms[0].coefficient == pytest.approx(-0.3324043)

    plan_request = json.loads(llm.requests[-1].user)
    await ports.generate(run_id, planned.value, None, None)

    generation_request = json.loads(llm.requests[-1].user)
    assert plan_request["known_reference"] == generation_request["known_reference"]
    assert "-1.0523732" in generation_request["known_reference"]
    assert "reference_template" not in generation_request


async def test_generate_omits_known_reference_for_an_unmatched_vqe_task():
    ports, llm, *_ = _ports()
    ports._task_prompt = "Estimate LiH at bond length 1.6 Angstrom with VQE"
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    vqe_plan = planned.value.model_copy(
        update={"plan": planned.value.plan.model_copy(update={"algorithm": Algorithm.VQE})}
    )

    generated = await ports.generate(run_id, vqe_plan, None, None)
    assert generated.value is not None

    sent = json.loads(llm.requests[-1].user)
    assert sent["known_reference"] is None


async def test_transient_provider_failure_recovers_within_the_pipeline_retry_budget():
    """A rate limit that outlives RetryingLLM's own backoff must not fail the run:
    the pipeline's bounded per-stage budget (ADR-0023) is exactly the mechanism
    that should absorb it, the same way it already absorbs invalid model output."""

    class FlakyOnceThenQueueLLM:
        def __init__(self, texts):
            self.texts = list(texts)
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            if self.calls == 1:
                raise LLMProviderError(
                    provider="deepseek",
                    model=request.model,
                    code="rate_limited",
                    retryable=True,
                    status_code=429,
                )
            return LLMResponse(
                text=self.texts.pop(0),
                model=request.model,
                input_tokens=1,
                output_tokens=1,
            )

    ports, *_ = _ports()
    ports._llm = FlakyOnceThenQueueLLM(
        [json.dumps(_plan_payload()), json.dumps({"source": _SOURCE})]
    )

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.counters.plan_attempts == 2


async def test_replay_reuses_all_durable_outputs_without_provider_or_sandbox_calls():
    ports, llm, executor, reviewer, converter, saver, observer = _ports()
    run_id = uuid4()

    first = await SimpleCircuitPipeline(ports=ports).run(run_id)
    second = await SimpleCircuitPipeline(ports=ports).run(run_id)

    assert first.status is second.status is SimplePipelineStatus.SUCCEEDED
    assert first.artifact == second.artifact
    assert len(llm.requests) == 2
    assert executor.calls == reviewer.calls == converter.calls == saver.calls == 1
    # Observer may replay an idempotent event, but the durable result is identical.
    assert observer.results


async def test_event_projection_failure_is_reconciled_without_failing_domain_work():
    class FlakyObserver(Observer):
        def __init__(self):
            super().__init__()
            self.failures_remaining = 2

        async def _maybe_fail(self):
            if self.failures_remaining:
                self.failures_remaining -= 1
                raise RuntimeError("event store temporarily unavailable")

        async def candidate_generated(self, run_id, candidate):
            await self._maybe_fail()
            await super().candidate_generated(run_id, candidate)

        async def tool_finished(self, run_id, result):
            await self._maybe_fail()
            await super().tool_finished(run_id, result)

    rollback_calls = 0

    async def rollback():
        nonlocal rollback_calls
        rollback_calls += 1

    observer = FlakyObserver()
    ports, *_ = _ports(observer=observer, rollback=rollback)

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert ports.projection_dirty is True
    assert rollback_calls == 2
    assert observer.results


async def test_replay_after_best_effort_export_failure_does_not_duplicate_artifact():
    ports, llm, executor, reviewer, _converter, saver, _observer = _ports()

    class UnsupportedConverter:
        def __init__(self):
            self.calls = 0

        async def convert(self, _candidate, _execution):
            self.calls += 1
            raise RuntimeError("framework export unsupported")

    converter = UnsupportedConverter()
    ports._converter = converter
    run_id = uuid4()

    first = await SimpleCircuitPipeline(ports=ports).run(run_id)
    second = await SimpleCircuitPipeline(ports=ports).run(run_id)

    assert first.status is second.status is SimplePipelineStatus.SUCCEEDED
    assert first.artifact == second.artifact
    assert len(llm.requests) == 2
    assert executor.calls == reviewer.calls == saver.calls == 1
    assert converter.calls == 2
    assert first.warnings[0].code == "openqasm_export_failed"


async def test_basic_contract_reads_protected_result_not_sandbox_stdout():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    generated = await ports.generate(run_id, planned.value, None, None)
    assert generated.value is not None
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert executed.value is not None
    forged = executed.value.model_copy(update={"result": {}})

    checked = await ports.check_contract(
        run_id,
        planned.value,
        generated.value,
        forged,
    )

    assert checked.value is not None
    assert checked.value.passed is False
    assert "RESULT missing key 'counts'" in checked.value.diagnostics
    assert executed.value.observation["sandbox_stdout"]


async def test_basic_contract_rejects_observed_qubits_above_plan_and_lane():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    generated = await ports.generate(run_id, planned.value, None, None)
    assert generated.value is not None
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert executed.value is not None
    oversized = executed.value.model_copy(
        update={
            "observation": {
                **executed.value.observation,
                "resource_metrics": {"qubits": 28},
            }
        }
    )

    checked = await ports.check_contract(
        run_id,
        planned.value,
        generated.value,
        oversized,
    )

    assert checked.value is not None
    assert checked.value.passed is False
    assert any("27-qubit lane ceiling" in item for item in checked.value.diagnostics)
    assert any("Plan declared 2" in item for item in checked.value.diagnostics)


async def test_simple_intent_reviewer_is_one_advisory_call_over_trusted_evidence():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert planned.value is not None
    assert generated.value is not None
    assert executed.value is not None
    llm = QueueLLM(
        [
            json.dumps(
                {
                    "decision": "ready",
                    "confidence": "high",
                    "severity": "none",
                    "summary": "request, plan, code, and protected RESULT align",
                    "passed_checks": [
                        "request_to_plan",
                        "plan_to_source",
                        "success_criteria",
                        "artifact_contract",
                    ],
                    "residual_risks": ["AI review is advisory"],
                }
            )
        ]
    )
    reviewer = SimpleIntentReviewer(llm=llm, task_prompt="prepare a Bell state")

    result = await reviewer.review(
        generated.value,
        executed.value,
        planned.value.plan,
        [{"method": "return_contract", "result": "pass"}],
        1,
    )

    assert result.decision is SemanticReviewDecision.READY
    assert result.reason_code == "intent_aligned"
    assert len(llm.requests) == 1
    assert "not strict quantum verification" in llm.requests[0].system.lower()
    assert "same four-layer review" in llm.requests[0].system.lower()
    assert "expected_range" in llm.requests[0].system
    assert "sandbox_stdout" not in llm.requests[0].user
    assert '"counts"' in llm.requests[0].user
    assert '"review_attempt": 1' in llm.requests[0].user


async def test_ready_review_with_failed_nameko_check_is_not_accepted():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert planned.value is not None
    assert generated.value is not None
    assert executed.value is not None
    reviewer = SimpleIntentReviewer(
        llm=QueueLLM(
            [
                json.dumps(
                    {
                        "decision": "ready",
                        "confidence": "high",
                        "severity": "none",
                        "summary": "claimed ready despite a failed check",
                        "failed_checks": ["success_criteria"],
                    }
                )
            ]
        ),
        task_prompt="prepare a Bell state",
    )

    result = await reviewer.review(
        generated.value,
        executed.value,
        planned.value.plan,
        [{"method": "success_criteria", "result": "fail"}],
        1,
    )

    assert result.decision is SemanticReviewDecision.CODE_REPAIR
    assert result.reason_code == "intent_code_mismatch"


def test_success_criteria_check_compares_trusted_numeric_result_to_plan_range():
    plan = Plan.model_validate(
        {
            **_plan_payload(),
            "success_criteria": {
                "primary_metric": "score",
                "expected_range": {"min": 0.8, "max": 1.0},
            },
            "expected_output_keys": ["score"],
        }
    )
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=uuid4(),
        source_fingerprint="f" * 64,
        environment_fingerprint="e" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result={"score": 0.75},
        observation={},
    )

    failed = simple_ports_module._success_criteria_check(plan, execution)
    passed = simple_ports_module._success_criteria_check(
        plan,
        execution.model_copy(update={"result": {"score": 0.9}}),
    )

    assert failed["result"] == "fail"
    assert failed["details"]["observed"] == 0.75
    assert passed["result"] == "pass"


async def test_malformed_simple_intent_review_is_typed_model_output_failure():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert planned.value is not None
    assert generated.value is not None
    assert executed.value is not None
    ports._reviewer = SimpleIntentReviewer(
        llm=QueueLLM(["not structured review data"]),
        task_prompt="prepare a Bell state",
    )

    reviewed = await ports.review(
        run_id,
        planned.value,
        generated.value,
        executed.value,
        1,
    )

    assert reviewed.failure is not None
    assert reviewed.failure.kind.value == "model_output"
    assert reviewed.failure.code == "review_output_invalid"
    assert reviewed.failure.retryable is True


async def test_long_but_valid_intent_review_summary_is_normalized_not_rejected():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert planned.value is not None
    assert generated.value is not None
    assert executed.value is not None
    ports._reviewer = SimpleIntentReviewer(
        llm=QueueLLM(
            [
                json.dumps(
                    {
                        "decision": "code_repair",
                        "confidence": "high",
                        "severity": "major",
                        "summary": "x" * 900,
                        "mismatches": ["the estimate is inconsistent"],
                        "repair_instructions": ["correct the estimator"],
                    }
                )
            ]
        ),
        task_prompt="prepare a Bell state",
    )

    reviewed = await ports.review(
        run_id,
        planned.value,
        generated.value,
        executed.value,
        1,
    )

    assert reviewed.failure is None
    assert reviewed.value is not None
    assert reviewed.value.decision is SemanticReviewDecision.CODE_REPAIR
    assert len(reviewed.value.feedback["critic"]["summary"]) == 900


async def test_second_intent_review_attempt_has_a_distinct_metering_request():
    ports, *_ = _ports()
    review_llm = QueueLLM(
        [
            "not a review object at all",
            json.dumps(
                {
                    "decision": "ready",
                    "confidence": "high",
                    "severity": "none",
                    "summary": "request and executed result align",
                }
            ),
        ]
    )
    ports._reviewer = SimpleIntentReviewer(
        llm=review_llm,
        task_prompt="prepare a Bell state",
    )

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.review is not None and outcome.review.attempt_seq == 1
    assert len(review_llm.requests) == 2
    assert '"review_attempt": 1' in review_llm.requests[0].user
    assert '"review_attempt": 2' in review_llm.requests[1].user
    assert review_llm.requests[0].user != review_llm.requests[1].user


async def test_production_ports_regenerate_after_a_blocked_review():
    ports, generation_llm, *_ = _ports()
    generation_llm.texts.append(json.dumps({"source": _SOURCE}))
    review_llm = QueueLLM(
        [
            json.dumps(
                {
                    "decision": "code_repair",
                    "confidence": "high",
                    "severity": "minor",
                    "summary": "the result does not expose the Plan primary metric",
                    "mismatches": ["RESULT omits the planned metric"],
                    "repair_instructions": ["Expose the Plan primary metric in RESULT"],
                }
            ),
            json.dumps(
                {
                    "decision": "ready",
                    "confidence": "high",
                    "severity": "none",
                    "summary": "request, Plan, source, and RESULT align",
                    "passed_checks": [
                        "request_to_plan",
                        "plan_to_source",
                        "success_criteria",
                        "artifact_contract",
                    ],
                }
            ),
        ]
    )
    ports._reviewer = SimpleIntentReviewer(
        llm=review_llm,
        task_prompt="prepare a Bell state",
    )

    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.candidate is not None and outcome.candidate.revision == 2
    # One review call per candidate, not two: the retired retry re-sent identical
    # evidence at temperature 0 and doubled the latency of every blocked run.
    assert len(review_llm.requests) == 2
    assert len(generation_llm.requests) == 3
    repair_request = json.loads(generation_llm.requests[2].user)
    assert repair_request["previous_source"]
    assert repair_request["repair_feedback"]["code"] == "intent_code_mismatch"
    assert "code repair" in repair_request["repair_feedback"]["message"]
    critic = repair_request["repair_feedback"]["details"]["critic"]
    assert critic["repair_instructions"] == ["Expose the Plan primary metric in RESULT"]


async def test_save_failure_rolls_back_before_a_bounded_retry():
    ports, *_ = _ports()
    rollback_calls = 0

    class FlakySaver(Saver):
        async def save(self, candidate, execution, review, conversion, plan):
            if self.calls == 0:
                self.calls += 1
                raise RuntimeError("transaction aborted")
            return await super().save(candidate, execution, review, conversion, plan)

    async def rollback():
        nonlocal rollback_calls
        rollback_calls += 1

    ports._saver = FlakySaver()
    ports._rollback = rollback
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    generated = await ports.generate(run_id, planned.value, None, None)
    assert generated.value is not None
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    assert executed.value is not None
    reviewed = await ports.review(
        run_id,
        planned.value,
        generated.value,
        executed.value,
        1,
    )
    assert reviewed.value is not None

    first = await ports.save(
        run_id,
        planned.value,
        generated.value,
        executed.value,
        reviewed.value,
        None,
    )
    second = await ports.save(
        run_id,
        planned.value,
        generated.value,
        executed.value,
        reviewed.value,
        None,
    )

    assert first.failure is not None
    assert first.failure.code == "artifact_save_failed"
    assert first.failure.retryable is True
    assert rollback_calls == 1
    assert second.value is not None


@pytest.mark.parametrize(
    "decision",
    [SemanticReviewDecision.READY, SemanticReviewDecision.CODE_REPAIR],
)
async def test_repo_review_saver_persists_every_deliverable_artifact_without_verifying(
    monkeypatch,
    decision,
):
    run_id = uuid4()
    candidate_id = uuid4()
    execution_id = uuid4()
    program = FrameworkProgram(Framework.QISKIT, _SOURCE)
    candidate = CandidateRevision(
        candidate_id=candidate_id,
        run_id=run_id,
        tool_call_id="simple:generate:1",
        revision=1,
        plan_id=uuid4(),
        framework=Framework.QISKIT,
        source=program.normalized_source,
        source_fingerprint=program.fingerprint,
    )
    execution = ExecutionEvidence(
        execution_id=execution_id,
        candidate_id=candidate_id,
        source_fingerprint=program.fingerprint,
        environment_fingerprint="e" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result={"counts": {"00": 50, "11": 50}},
        observation={"resource_metrics": {"qubits": 2}},
    )
    review = SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint=program.fingerprint,
        attempt_seq=1,
        decision=decision,
        confidence="high",
        severity="none",
        reason_code=(
            "semantic_ready" if decision is SemanticReviewDecision.READY else "intent_code_mismatch"
        ),
        failure_class=(
            None
            if decision is SemanticReviewDecision.READY
            else VerificationFailureClass.CANDIDATE_DEFECT
        ),
        retry_target=(
            RetryTarget.NONE
            if decision is SemanticReviewDecision.READY
            else RetryTarget.CODE_GENERATION
        ),
        feedback={
            "critic": {
                "summary": (
                    "aligned"
                    if decision is SemanticReviewDecision.READY
                    else "minor improvement requested"
                ),
                "residual_risks": ["AI review may miss a semantic defect"],
            },
            "basic_checks": [
                {"method": "structural", "result": "pass"},
                {"method": "return_contract", "result": "pass"},
                {"method": "success_criteria", "result": "pass"},
            ],
        },
    )
    conversion = ConversionEvidence(
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint=program.fingerprint,
        status="available",
        qasm="OPENQASM 3.0;\nqubit[2] q;",
    )
    plan_payload = _plan_payload()
    plan_payload.pop("verification_plan")
    plan = Plan.model_validate(plan_payload)
    artifact_id = uuid4()
    version_id = uuid4()
    captured = {}

    async def create_artifact(_scope, _session, **values):
        captured["artifact"] = values
        return SimpleNamespace(id=artifact_id)

    async def create_version(_scope, _session, got_artifact_id, **values):
        captured["artifact_id"] = got_artifact_id
        captured["version"] = values
        return SimpleNamespace(id=version_id, seq=1)

    async def set_run_artifact_version(_scope, _session, got_run_id, got_version_id):
        captured["run_binding"] = (got_run_id, got_version_id)

    monkeypatch.setattr(simple_ports_module.artifacts_repo, "create_artifact", create_artifact)
    monkeypatch.setattr(simple_ports_module.artifacts_repo, "create_version", create_version)
    monkeypatch.setattr(
        simple_ports_module.runs_repo,
        "set_run_artifact_version",
        set_run_artifact_version,
    )
    saver = RepoReviewArtifactSaver(
        scope=object(),
        session=object(),
        run_id=run_id,
        parent_artifact_id=None,
        title="Bell state",
    )

    saved = await saver.save(candidate, execution, review, conversion, plan)

    assert saved.version_id == version_id
    metadata = captured["version"]["metadata"]
    expected_status = "aligned" if decision is SemanticReviewDecision.READY else "not_accepted"
    assert metadata["review_summary"]["status"] == expected_status
    summary = metadata["verification_summary"]
    assert summary["decision"] == "inconclusive"
    assert summary["semantic_review_decision"] == decision.value
    assert summary["evidence_strength"] == "structural"
    assert summary["reason_code"] == (
        "ai_review_aligned"
        if decision is SemanticReviewDecision.READY
        else "trusted_evidence_without_review_acceptance"
    )
    assert summary["candidate_defect_observed"] is False
    assert summary["failure_class"] == "evidence_gap"
    assert summary["retry_target"] == "none"
    assert summary["checks"] == [
        {"method": "structural", "result": "pass"},
        {"method": "return_contract", "result": "pass"},
        {"method": "success_criteria", "result": "pass"},
    ]
    assert "verification_attempt_id" not in metadata
    if decision is SemanticReviewDecision.READY:
        assert "strict quantum correctness" in captured["version"]["limitations"]
    else:
        assert "Intent alignment was not established" in captured["version"]["limitations"]
    assert captured["run_binding"] == (run_id, version_id)


async def test_repo_review_saver_rejects_review_without_complete_evidence():
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    candidate = generated.value
    execution = executed.value
    assert candidate is not None and execution is not None and planned.value is not None
    review = SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        decision=SemanticReviewDecision.INCONCLUSIVE,
        reason_code="review_unavailable",
        failure_class=VerificationFailureClass.VERIFIER_FAILURE,
        retry_target=RetryTarget.VERIFICATION,
    )
    saver = RepoReviewArtifactSaver(
        scope=object(),
        session=object(),
        run_id=run_id,
        parent_artifact_id=None,
        title="Bell state",
    )

    with pytest.raises(ValueError, match="complete trusted evidence"):
        await saver.save(
            candidate,
            execution,
            review,
            None,
            planned.value.plan,
        )


# --- Plan-declared reference checks (ADR-0023 §"basic contract checks") ---------
#
# The only check in the fixed pipeline that can contradict a program which is
# internally consistent but physically wrong. Live H2 VQE run 019f9763 reported
# -1.419 Ha against a range derived from its own fabricated Hamiltonian and passed
# every structural check; these tests pin the path that catches that shape.

# Total-energy convention: the electronic identity coefficient -1.0523732 plus the
# nuclear repulsion constant 0.7199689, so diagonalizing these five terms alone
# yields the -1.1373061 Ha the run reports. Declaring the electronic operator while
# reporting the total energy is off by exactly that constant, which is why the
# planner prompt spells the convention out.
_H2_HAMILTONIAN = [
    {"coefficient": -0.3324043, "pauli": "II"},
    {"coefficient": 0.39793742, "pauli": "IZ"},
    {"coefficient": -0.39793742, "pauli": "ZI"},
    {"coefficient": -0.0112801, "pauli": "ZZ"},
    {"coefficient": 0.18093119, "pauli": "XX"},
]


def _vqe_plan(reported: float, *, hamiltonian=None, tolerance=None) -> tuple[Plan, object]:
    verification_plan = {
        "methods": ["exact_diag"],
        "reference_hamiltonian": _H2_HAMILTONIAN if hamiltonian is None else hamiltonian,
    }
    if tolerance is not None:
        verification_plan["thresholds"] = {"energy_Ha_error_max": tolerance}
    plan = Plan.model_validate(
        {
            "domain": "chemistry",
            "framework": "qiskit",
            "algorithm": "VQE",
            "problem_summary": "Estimate the H2 ground-state energy",
            "algorithm_rationale": "VQE targets the requested minimum eigenvalue",
            "parameters": {"shots": 1024},
            "qubits_estimate": 2,
            "expected_runtime_sec": 60,
            "success_criteria": {
                "primary_metric": "energy_Ha",
                # Deliberately wide enough to admit the fabricated answer too: the
                # point is that the range cannot be the thing that catches it.
                "expected_range": {"min": -1.6, "max": -1.0},
            },
            "expected_output_keys": ["energy_Ha"],
            "verification_plan": verification_plan,
        }
    )
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=uuid4(),
        source_fingerprint="a" * 64,
        environment_fingerprint="e" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result={"energy_Ha": reported},
        observation={},
    )
    return plan, execution


def test_reference_check_passes_the_true_h2_ground_state_energy():
    plan, execution = _vqe_plan(-1.1373061)

    checks = _reference_checks(plan, execution)
    check = checks[0] if checks else None

    assert check is not None
    assert check["method"] == "exact_diag"
    assert check["result"] == "pass"


def test_reference_check_catches_the_energy_the_plans_own_range_admitted():
    """The regression this whole path exists for.

    -1.419 Ha sits inside the Plan's expected_range and inside every structural
    contract; only diagonalizing the declared operator contradicts it.
    """

    plan, execution = _vqe_plan(-1.419)
    assert plan.success_criteria.expected_range == {"min": -1.6, "max": -1.0}

    checks = _reference_checks(plan, execution)
    check = checks[0] if checks else None

    assert check is not None
    assert check["result"] == "fail"
    assert check["details"]["reported"] == -1.419


def test_failed_reference_check_routes_to_code_repair_not_inconclusive():
    """A concrete contradiction earns a repaired candidate, not a spent review.

    INCONCLUSIVE routes to RetryTarget.VERIFICATION, which burns review attempts
    without ever regenerating the source that produced the wrong number.
    """

    plan, execution = _vqe_plan(-1.419)

    routing = _reference_check_routing(_reference_checks(plan, execution))

    assert routing == (SemanticReviewDecision.CODE_REPAIR, "reference_check_failed")


def test_expected_range_that_excludes_reference_truth_routes_directly_to_replan():
    plan, execution = _vqe_plan(-1.419)
    plan = plan.model_copy(
        update={
            "success_criteria": plan.success_criteria.model_copy(
                update={"expected_range": {"min": -1.0, "max": -0.5}}
            )
        }
    )

    routing = _reference_check_routing(
        _reference_checks(plan, execution),
        simple_ports_module._success_criteria_check(plan, execution),
    )

    assert routing == (
        SemanticReviewDecision.REPLAN,
        "success_criteria_excludes_reference_truth",
    )


def test_valid_tight_range_still_routes_an_inaccurate_candidate_to_code_repair():
    plan, execution = _vqe_plan(-1.419)
    plan = plan.model_copy(
        update={
            "success_criteria": plan.success_criteria.model_copy(
                update={"expected_range": {"min": -1.14, "max": -1.13}}
            )
        }
    )

    routing = _reference_check_routing(
        _reference_checks(plan, execution),
        simple_ports_module._success_criteria_check(plan, execution),
    )

    assert routing == (SemanticReviewDecision.CODE_REPAIR, "reference_check_failed")


def test_unusable_reference_declaration_is_blamed_on_the_plan():
    """A reference the verifier cannot use fails identically on every candidate.

    Routed off the verifier's own `fault` marker rather than reconstructed here: the
    Plan contract rejects every malformed shape it can see, so this arrives only
    from inside the verifier and must not be charged to the candidate.
    """

    unusable = {
        "method": "exact_diag",
        "result": "fail",
        "details": {
            "error": "reference_hamiltonian is not diagonalizable as declared",
            "fault": "plan",
        },
    }

    assert _reference_check_routing([unusable]) == (
        SemanticReviewDecision.REPLAN,
        "reference_declaration_unusable",
    )
    # A Plan defect outranks a candidate defect: rewriting source against a reference
    # that is itself unusable cannot converge, whichever order the checks ran in.
    contradicted = {"method": "brute_force", "result": "fail", "details": {}}
    assert _reference_check_routing([contradicted, unusable]) == (
        SemanticReviewDecision.REPLAN,
        "reference_declaration_unusable",
    )


def test_non_numeric_metric_fails_rather_than_skipping_the_check():
    plan, execution = _vqe_plan(-1.1373061)
    execution = execution.model_copy(update={"result": {"energy_Ha": "minus one point one"}})

    checks = _reference_checks(plan, execution)
    check = checks[0] if checks else None

    assert check is not None and check["result"] == "fail"


def test_plan_without_a_declared_reference_runs_the_check_not_at_all():
    plan, execution = _vqe_plan(-1.1373061)
    plan = plan.model_copy(update={"verification_plan": None})

    assert _reference_checks(plan, execution) == []
    assert _reference_check_routing([]) is None


def _review_with_checks(checks) -> SemanticReviewEvidence:
    return SemanticReviewEvidence(
        review_id=uuid4(),
        candidate_id=uuid4(),
        execution_id=uuid4(),
        source_fingerprint="a" * 64,
        attempt_seq=1,
        decision=SemanticReviewDecision.READY,
        reason_code="intent_aligned",
        retry_target=RetryTarget.NONE,
        feedback={"basic_checks": checks},
    )


def test_summary_reports_a_physical_grade_without_ever_claiming_a_pass():
    """EvidenceStrength exists to say this: one real claim, still not a verdict."""

    review = _review_with_checks(
        [
            {"method": "success_criteria", "result": "pass"},
            {"method": "exact_diag", "result": "pass"},
        ]
    )
    methods = passed_reference_methods(review)
    assert methods == (VerificationMethod.EXACT_DIAG,)

    summary = simple_pipeline_verification_summary(methods)

    assert summary["evidence_strength"] == EvidenceStrength.PHYSICAL.value
    assert summary["decision"] == VerifierDecision.INCONCLUSIVE.value
    assert "quantum correctness" not in summary["unverified_claims"]
    assert "optimality" in summary["unverified_claims"]
    assert {"method": "exact_diag", "result": "pass"} in summary["checks"]


def test_summary_stays_structural_when_no_reference_check_ran():
    review = _review_with_checks([{"method": "success_criteria", "result": "pass"}])
    assert passed_reference_methods(review) == ()

    summary = simple_pipeline_verification_summary()

    assert summary["evidence_strength"] == EvidenceStrength.STRUCTURAL.value
    assert summary["decision"] == VerifierDecision.INCONCLUSIVE.value
    assert "quantum correctness" in summary["unverified_claims"]


def test_a_failed_reference_check_never_counts_as_evidence_in_the_summary():
    review = _review_with_checks([{"method": "exact_diag", "result": "fail"}])

    assert passed_reference_methods(review) == ()


# --- Every review names a next step -------------------------------------------
#
# The retired fourth outcome ("cannot tell") named none, so the controller could
# only regenerate identical evidence until the candidate budget ran out — and the
# Plan escalation, which keys on consecutive CODE_REPAIR decisions, never fired.


def _critic(**overrides) -> str:
    payload = {
        "decision": "ready",
        "confidence": "high",
        "severity": "none",
        "summary": "request, Plan, source, and RESULT align",
        "passed_checks": ["plan_to_source"],
        "failed_checks": [],
        "mismatches": [],
        "repair_instructions": [],
        "residual_risks": [],
    }
    return json.dumps({**payload, **overrides})


async def _decide(payload: str, checks=None) -> SimpleIntentReviewResult:
    ports, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    generated = await ports.generate(run_id, planned.value, None, None)
    executed = await ports.run_execution(run_id, planned.value, generated.value)
    reviewer = SimpleIntentReviewer(llm=QueueLLM([payload]), task_prompt="bell state")
    return await reviewer.review(
        generated.value,
        executed.value,
        planned.value.plan,
        checks if checks is not None else [{"method": "structural", "result": "pass"}],
        1,
    )


@pytest.mark.parametrize(
    "payload,expected",
    [
        (_critic(), SemanticReviewDecision.READY),
        # An honest nit no longer overturns the reviewer's own acceptance. It used to,
        # which meant the more carefully a reviewer worked the more likely it was to
        # send a good candidate back around the loop.
        (_critic(mismatches=["shots 100 vs 1024 requested"]), SemanticReviewDecision.READY),
        (_critic(residual_risks=["shot noise"]), SemanticReviewDecision.READY),
        # A correctly diagnosed small bug is repairable as a repair.
        (
            _critic(decision="code_repair", severity="minor", repair_instructions=["add cx"]),
            SemanticReviewDecision.CODE_REPAIR,
        ),
        # A reviewer that asks for another candidate while naming nothing to change
        # has described a residual risk, not a defect — but only its GRADE says so.
        # This case keeps its clean grade, so it does not spend a source revision.
        (_critic(decision="code_repair"), SemanticReviewDecision.READY),
        (_critic(decision="inconclusive"), SemanticReviewDecision.READY),
        # An unhedged blocker is still a blocker, whatever the model called it, and
        # whether or not it went on to itemise what it found. The empty list is a
        # missing follow-up, not a retraction.
        (_critic(severity="blocking"), SemanticReviewDecision.CODE_REPAIR),
        (_critic(confidence="low"), SemanticReviewDecision.CODE_REPAIR),
        (
            _critic(
                severity="blocking",
                failed_checks=["source omits the requested entangling gate"],
            ),
            SemanticReviewDecision.CODE_REPAIR,
        ),
        (
            _critic(
                decision="replan",
                severity="major",
                mismatches=["the Plan targets the wrong algorithm"],
            ),
            SemanticReviewDecision.REPLAN,
        ),
        # A model that answers "cannot tell" anyway is routed, not parked.
        (_critic(decision="inconclusive", confidence="low"), SemanticReviewDecision.CODE_REPAIR),
    ],
)
async def test_every_review_outcome_names_an_actionable_next_step(payload, expected):
    result = await _decide(payload)

    assert result.decision is expected
    assert result.decision is not SemanticReviewDecision.INCONCLUSIVE
    assert result.retry_target is not RetryTarget.VERIFICATION


# --- A refusing grade can never be published as an acceptance -----------------
#
# The verdict ("does this review clear the candidate?") and its disposition
# ("which layer gets the next attempt?") are two facts. Fusing them once already
# shipped as a proposal to return READY whenever the reviewer had not itemised a
# finding — which reads `failed_checks`/`mismatches`/`repair_instructions`, all
# defaulting to `[]` in model-authored JSON, as permission rather than as the
# absence of evidence they actually are. The grades below are read off
# _IntentReviewOutput's own Literal annotations, so widening the schema without
# deciding which side of the gate a new grade belongs on fails here rather than
# silently defaulting to "accepting".


def _declared_grades(field: str) -> tuple[str, ...]:
    annotation = simple_ports_module._IntentReviewOutput.model_fields[field].annotation
    return tuple(get_args(annotation))


def test_the_grade_domains_are_exactly_partitioned_into_accepting_and_refusing():
    severities = set(_declared_grades("severity"))
    confidences = set(_declared_grades("confidence"))

    assert severities == {"none", "minor", "major", "blocking"}
    assert confidences == {"high", "medium", "low"}
    assert simple_ports_module._ACCEPTING_SEVERITIES == frozenset({"none", "minor"})
    assert simple_ports_module._ACCEPTING_CONFIDENCES == frozenset({"high", "medium"})
    # Every declared grade is classified. A grade outside the accepting set is a
    # refusal by construction, so a new enum member cannot arrive pre-approved.
    assert simple_ports_module._ACCEPTING_SEVERITIES <= severities
    assert simple_ports_module._ACCEPTING_CONFIDENCES <= confidences


@pytest.mark.parametrize("severity", _declared_grades("severity"))
@pytest.mark.parametrize("confidence", _declared_grades("confidence"))
@pytest.mark.parametrize("decision", ["ready", "code_repair", "replan", "inconclusive"])
async def test_a_refusing_grade_is_never_accepted_however_bare_the_review(
    severity, confidence, decision
):
    """Sweep every grade with a review that itemises nothing at all.

    An empty findings list is the shape that made this reachable: a reviewer can
    grade a circuit `blocking` and still return no `failed_checks`, no
    `mismatches` and no `repair_instructions`. Acceptance must follow the grade,
    not the itemisation.
    """

    result = await _decide(
        _critic(
            decision=decision,
            severity=severity,
            confidence=confidence,
            summary="graded without itemising anything",
            passed_checks=[],
            failed_checks=[],
            mismatches=[],
            repair_instructions=[],
            residual_risks=[],
        )
    )

    accepting = severity in {"none", "minor"} and confidence in {"high", "medium"}
    assert (result.decision is SemanticReviewDecision.READY) is accepting, (
        f"severity={severity!r} confidence={confidence!r} decision={decision!r} "
        f"produced {result.decision!r}"
    )
    assert (result.reason_code == "intent_aligned") is accepting


@pytest.mark.parametrize("severity", ["major", "blocking"])
@pytest.mark.parametrize("reference_methods", [(), (VerificationMethod.EXACT_DIAG,)])
async def test_a_blocking_review_never_reaches_the_user_as_an_aligned_run(
    severity, reference_methods
):
    """The whole projection, not just the mapping.

    READY is what `_summary_reason_code` turns into `ai_review_aligned`, and
    `apps/web/lib/run-outcome.ts` renders that reason code as "The circuit
    executed and matched the request" with an "Executed" badge. Asserting the
    decision alone would still pass if a later refactor published a refusal under
    an accepting reason code, so pin the sentence the user is shown.
    """

    result = await _decide(_critic(severity=severity, summary="the circuit is wrong"))

    assert result.decision is not SemanticReviewDecision.READY
    summary = simple_pipeline_verification_summary(reference_methods, result.decision)
    assert not str(summary["reason_code"]).startswith("ai_review_aligned")
    assert summary["reason_code"] == "trusted_evidence_without_review_acceptance"
    # The user is told which claim was not established, rather than being left to
    # infer that the reviewer signed off.
    assert "intent alignment" in summary["unverified_claims"]


async def test_a_deterministic_failure_outranks_an_unblemished_grade():
    result = await _decide(
        _critic(),
        checks=[{"method": "success_criteria", "result": "fail"}],
    )

    assert result.decision is SemanticReviewDecision.CODE_REPAIR
    assert result.reason_code != "intent_aligned"


async def test_a_failed_deterministic_check_outranks_a_claimed_acceptance():
    result = await _decide(_critic(), [{"method": "success_criteria", "result": "fail"}])

    assert result.decision is SemanticReviewDecision.CODE_REPAIR
    assert "success_criteria" in result.critic["failed_checks"]


def test_the_reviewer_schema_cannot_ask_for_the_retired_outcome():
    """Schema-guided decoding must not be able to emit a decision with no next step."""

    schema = simple_ports_module._IntentReviewOutput.model_json_schema()

    assert schema["properties"]["decision"]["enum"] == ["ready", "code_repair", "replan"]


def test_every_declared_reference_method_actually_runs():
    """A Plan may name more than one; checking only the first would put a method in
    the evidence that nothing evaluated."""

    plan, execution = _vqe_plan(-1.1373061)
    plan = plan.model_copy(
        update={
            "expected_output_keys": ["energy_Ha"],
            "verification_plan": plan.verification_plan.model_copy(
                update={
                    "methods": [
                        VerificationMethod.EXACT_DIAG,
                        VerificationMethod.BRUTE_FORCE,
                    ],
                    "reference_problem": ReferenceProblem(
                        kind="maxcut",
                        num_variables=3,
                        terms=[ProblemTerm(i=0, j=1, weight=1.0)],
                    ),
                }
            ),
        }
    )

    checks = _reference_checks(plan, execution)

    assert [check["method"] for check in checks] == ["exact_diag", "brute_force"]
    # The energy satisfies the Hamiltonian but is not this instance's cut weight, so
    # the second check must be the one that objects.
    assert checks[0]["result"] == "pass"
    assert checks[1]["result"] == "fail"
    assert _reference_check_routing(checks) == (
        SemanticReviewDecision.CODE_REPAIR,
        "reference_check_failed",
    )


async def test_reference_failure_replans_through_the_real_review_port():
    """End-to-end wiring: a Plan-declared reference that the RESULT contradicts must
    reach the durable review as a typed routing decision, not as reviewer prose."""

    ports, _llm, _executor, *_ = _ports()
    run_id = uuid4()
    plan_payload = _plan_payload()
    plan_payload["expected_output_keys"] = ["energy_Ha"]
    plan_payload["success_criteria"] = {"primary_metric": "energy_Ha"}
    plan_payload["algorithm"] = "VQE"
    plan_payload["verification_plan"] = {
        "methods": ["exact_diag"],
        "reference_hamiltonian": _H2_HAMILTONIAN,
    }
    # Enough shots that the shot-noise allowance is narrower than the error under
    # test; see test_exact_diag_allowance_widens_with_low_shot_counts.
    plan_payload["parameters"] = {"shots": 4096, "seed": 7}
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    plan = planned.value.model_copy(
        update={"plan": Plan.model_validate({**plan_payload, "framework": "qiskit"})}
    )
    plan = plan.model_copy(
        update={"plan_fingerprint": simple_ports_module._plan_fingerprint(plan.plan)}
    )
    generated = await ports.generate(run_id, plan, None, None)
    assert generated.value is not None
    executed = await ports.run_execution(run_id, plan, generated.value)
    assert executed.value is not None
    # The fabricated-energy shape: self-consistent, inside any plausible range, and
    # contradicted only by diagonalizing the operator the Plan declared.
    execution = executed.value.model_copy(update={"result": {"energy_Ha": -1.419}})

    # A reviewer that would have accepted it outright.
    ports._reviewer = SimpleIntentReviewer(llm=QueueLLM([_critic()]), task_prompt="h2 vqe")
    reviewed = await ports.review(run_id, plan, generated.value, execution, 1)

    assert reviewed.value is not None
    assert reviewed.value.decision is SemanticReviewDecision.CODE_REPAIR
    assert reviewed.value.reason_code == "reference_check_failed"
    assert reviewed.value.retry_target is RetryTarget.CODE_GENERATION
    stored = [
        check
        for check in reviewed.value.feedback["basic_checks"]
        if check["method"] == "exact_diag"
    ]
    assert stored and stored[0]["result"] == "fail"
    assert passed_reference_methods(reviewed.value) == ()


def test_exact_diag_allowance_widens_with_low_shot_counts():
    """A documented limit of the check, pinned so it cannot surprise anyone twice.

    `exact_diag` grants a shot-noise allowance derived from the declared shot count,
    so a low-shot plan cannot distinguish a wrong energy from a noisy one: the same
    0.28 Ha fabrication that fails at 4096 shots passes at 100. That is honest
    physics rather than a defect — with 100 samples the run genuinely has not
    measured the difference — but it means a Plan that wants this check to bite must
    either plan enough shots or declare a tighter tolerance, which is what the
    planner directive now says.
    """

    loose, execution = _vqe_plan(-1.419)
    loose = loose.model_copy(
        update={"parameters": loose.parameters.model_copy(update={"shots": 100})}
    )
    tight = loose.model_copy(
        update={"parameters": loose.parameters.model_copy(update={"shots": 4096})}
    )

    assert _reference_checks(loose, execution)[0]["result"] == "pass"
    assert _reference_checks(tight, execution)[0]["result"] == "fail"


def test_a_plan_declared_tolerance_can_tighten_a_loose_shot_allowance():
    loose, execution = _vqe_plan(-1.419)
    loose = loose.model_copy(
        update={"parameters": loose.parameters.model_copy(update={"shots": 100})}
    )
    tightened = loose.model_copy(
        update={
            "verification_plan": loose.verification_plan.model_copy(
                update={"thresholds": {"energy_Ha_error_max": 0.01}}
            )
        }
    )

    assert _reference_checks(loose, execution)[0]["result"] == "pass"
    assert _reference_checks(tightened, execution)[0]["result"] == "fail"


def test_summary_marks_intent_alignment_unverified_when_review_did_not_accept():
    summary = simple_pipeline_verification_summary(
        (VerificationMethod.EXACT_DIAG,), SemanticReviewDecision.CODE_REPAIR
    )

    assert summary["reason_code"] == "trusted_evidence_without_review_acceptance"
    assert summary["semantic_review_decision"] == SemanticReviewDecision.CODE_REPAIR.value
    assert "intent alignment" in summary["unverified_claims"]
    # The reference check still ran, so that claim stays withdrawn from the list.
    assert "quantum correctness" not in summary["unverified_claims"]
    assert summary["evidence_strength"] == EvidenceStrength.PHYSICAL.value
    assert summary["decision"] == VerifierDecision.INCONCLUSIVE.value


def test_summary_without_reference_or_acceptance_withdraws_nothing():
    summary = simple_pipeline_verification_summary((), SemanticReviewDecision.CODE_REPAIR)

    assert summary["evidence_strength"] == EvidenceStrength.STRUCTURAL.value
    for claim in ("quantum correctness", "physical fidelity", "optimality", "intent alignment"):
        assert claim in summary["unverified_claims"]


async def test_first_generation_is_deterministic_and_a_repair_samples():
    """At temperature 0 a repair whose prompt barely changed reproduces nearly the
    same program, so a run could spend its whole budget re-deriving one defect."""

    ports, llm, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None

    llm.texts.append(json.dumps({"source": _SOURCE}))
    first = await ports.generate(run_id, planned.value, None, None)
    assert first.value is not None
    assert llm.requests[-1].temperature == 0.0

    llm.texts.append(json.dumps({"source": _SOURCE.replace("h(0)", "h(1)")}))
    await ports.generate(
        run_id,
        planned.value,
        first.value,
        SimpleRepairFeedback(
            stage=SimplePipelineStage.REVIEWING,
            code="intent_code_mismatch",
            message="repair",
            details={"prior_attempts": [{"revision": 1, "rejected_because": "x"}]},
        ),
    )
    assert llm.requests[-1].temperature > 0.0
    # The history the pipeline accumulated has to reach the model, not just the store.
    assert "prior_attempts" in llm.requests[-1].user


async def test_a_repair_can_see_what_the_previous_revision_actually_produced():
    """Without this a repair is blind to its own output: the review calls the reported
    number wrong and the generator rewrites the program having never seen the number."""

    ports, llm, executor, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None
    llm.texts.append(json.dumps({"source": _SOURCE}))
    first = await ports.generate(run_id, planned.value, None, None)
    assert first.value is not None
    await ports.run_execution(run_id, planned.value, first.value)

    llm.texts.append(json.dumps({"source": _SOURCE.replace("h(0)", "h(1)")}))
    await ports.generate(
        run_id,
        planned.value,
        first.value,
        SimpleRepairFeedback(
            stage=SimplePipelineStage.REVIEWING,
            code="intent_code_mismatch",
            message="the reported counts are not a Bell distribution",
            details={},
        ),
    )

    payload = json.loads(llm.requests[-1].user)
    previous = payload["previous_execution"]
    assert previous["exit_code"] == 0
    assert previous["result"] == {"counts": {"00": 50, "11": 50}}
    assert previous["resource_metrics"]["qubits"] == 2


async def test_the_first_generation_has_no_previous_execution():
    ports, llm, *_ = _ports()
    run_id = uuid4()
    planned = await ports.plan(run_id, None, None)
    assert planned.value is not None

    llm.texts.append(json.dumps({"source": _SOURCE}))
    await ports.generate(run_id, planned.value, None, None)

    assert json.loads(llm.requests[-1].user)["previous_execution"] is None
