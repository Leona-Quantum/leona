"""Durability and trust-boundary tests for ADR-0023 production ports."""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from majorana_agent import (
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionOutput,
    MaterializedArtifact,
    MemoryAgentStore,
    SemanticReviewEvidence,
    SimpleCircuitPipeline,
    SimplePipelineStatus,
)
from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_llm import LLMProviderError, LLMResponse

from majorana_worker import simple_ports as simple_ports_module
from majorana_worker.simple_ports import (
    ProductionSimplePipelinePorts,
    RepoReviewArtifactSaver,
    SimpleIntentReviewer,
    SimpleIntentReviewResult,
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
    assert "artifact_contract" not in llm.requests[0].response_schema["properties"]
    assert "verification_plan" not in llm.requests[0].response_schema["properties"]
    assert llm.requests[1].schema_name == "generate_circuit"
    assert executor.calls == reviewer.calls == converter.calls == saver.calls == 1
    assert all(result.tool_call_id.startswith("simple:") for result in observer.results)
    assert all(result.name.value != "strict_verify" for result in observer.results)
    assert all(result.state.value != "ready_for_strict_verification" for result in observer.results)


async def test_simple_plan_ignores_legacy_measurement_contract_that_killed_vqe():
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
    assert planned.value.plan.artifact_contract is None
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

    assert result.decision is SemanticReviewDecision.INCONCLUSIVE
    assert result.reason_code == "intent_review_inconclusive"


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
            json.dumps(
                {
                    "decision": "inconclusive",
                    "confidence": "low",
                    "severity": "none",
                    "summary": "insufficient evidence",
                }
            ),
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
    assert len(review_llm.requests) == 2
    assert '"review_attempt": 1' in review_llm.requests[0].user
    assert '"review_attempt": 2' in review_llm.requests[1].user
    assert review_llm.requests[0].user != review_llm.requests[1].user


async def test_production_ports_regenerate_after_repeated_inconclusive_review():
    ports, generation_llm, *_ = _ports()
    generation_llm.texts.append(json.dumps({"source": _SOURCE}))
    review_llm = QueueLLM(
        [
            json.dumps(
                {
                    "decision": "inconclusive",
                    "confidence": "low",
                    "severity": "none",
                    "summary": "the result does not expose enough evidence",
                    "failed_checks": ["success_criteria"],
                    "residual_risks": ["primary metric interpretation is unclear"],
                }
            ),
            json.dumps(
                {
                    "decision": "inconclusive",
                    "confidence": "low",
                    "severity": "none",
                    "summary": "a clearer candidate is required",
                    "failed_checks": ["success_criteria"],
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
    assert len(review_llm.requests) == 3
    assert len(generation_llm.requests) == 3
    repair_request = json.loads(generation_llm.requests[2].user)
    assert repair_request["previous_source"]
    assert repair_request["repair_feedback"]["code"] == "intent_review_inconclusive"
    assert "expose the missing evidence" in repair_request["repair_feedback"]["message"]


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


async def test_repo_review_saver_marks_artifact_private_and_not_verified(monkeypatch):
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
        decision=SemanticReviewDecision.READY,
        confidence="high",
        severity="none",
        reason_code="semantic_ready",
        retry_target=RetryTarget.NONE,
        feedback={
            "critic": {
                "summary": "aligned",
                "residual_risks": ["AI review may miss a semantic defect"],
            }
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
    assert metadata["review_summary"]["status"] == "aligned"
    summary = metadata["verification_summary"]
    assert summary["decision"] == "inconclusive"
    assert summary["semantic_review_decision"] == "ready"
    assert summary["evidence_strength"] == "structural"
    assert summary["reason_code"] == "ai_review_aligned"
    assert summary["candidate_defect_observed"] is False
    assert summary["failure_class"] == "evidence_gap"
    assert summary["retry_target"] == "none"
    assert summary["checks"] == [
        {"method": "structural", "result": "pass"},
        {"method": "return_contract", "result": "pass"},
        {"method": "success_criteria", "result": "pass"},
    ]
    assert "verification_attempt_id" not in metadata
    assert "strict quantum correctness" in captured["version"]["limitations"]
    assert captured["run_binding"] == (run_id, version_id)


async def test_repo_review_saver_rejects_non_aligned_review():
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

    with pytest.raises(ValueError, match="aligned intent review"):
        await saver.save(
            candidate,
            execution,
            review,
            None,
            planned.value.plan,
        )
