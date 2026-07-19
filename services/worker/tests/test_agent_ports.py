import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from majorana_agent import CandidateRevision, ExecutionEvidence, VerificationEvidence
from majorana_contracts.enums import Algorithm, Framework, VerificationMethod, VerifierDecision
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_llm import LLMResponse, StageOutputError
from majorana_sandbox import SandboxResult
from majorana_worker.agent_ports import (
    EvidenceVerifier,
    LLMPlanner,
    RepoArtifactPublisher,
    SandboxCandidateExecutor,
    TrustedOpenQASMConverter,
)


def _plan(*, expected_keys=None) -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build and verify a Bell circuit",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": expected_keys or ["counts"],
        }
    )


def _candidate() -> CandidateRevision:
    source = "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'00': 1}}\n"
    return CandidateRevision(
        candidate_id=uuid4(),
        run_id=uuid4(),
        tool_call_id="simulate-1",
        revision=1,
        plan_id=uuid4(),
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )


def _execution(candidate, *, result=None, observation=None):
    return ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="1" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result=result or {"counts": {"00": 1}},
        observation=(
            observation
            if observation is not None
            else {
                # The trusted observer stamps this on every circuit run before it
                # records anything else (majorana_frameworks.adapters), so a
                # fixture without it is not a shape production can produce — and
                # the verifier now fails closed when it is absent.
                "native_optimization": {"applied": False},
                "resource_metrics": {
                    "qubits": 2,
                    "depth": 2,
                    "gate_count": 2,
                    "two_qubit_gate_count": 1,
                    "measurement_count": 2,
                },
            }
        ),
    )


class MustNotRunLLM:
    async def complete(self, *_args, **_kwargs):
        raise AssertionError("critic must not override deterministic failure")


async def test_deterministic_failure_short_circuits_semantic_critic():
    candidate = _candidate()
    verifier = EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state")
    output = await verifier.verify(
        candidate,
        _execution(candidate, result={"wrong": True}),
        _plan(expected_keys=["counts"]),
    )
    assert output.decision is VerifierDecision.FAIL
    assert output.repair is not None
    assert output.repair.category == "deterministic_verification_failed"


class PassingCriticLLM:
    async def complete(self, request, *, on_delta=None):
        return LLMResponse(
            text=(
                '{"decision":"pass","confidence":"high","severity":"none",'
                '"summary":"Request, plan, code, and result align.","passed_checks":["intent"],'
                '"failed_checks":[],"mismatches":[],"suggestions":[],"repair_plan":[],'
                '"required_recheck":[],"residual_risks":[]}'
            ),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


async def test_semantic_critic_runs_only_after_deterministic_pass():
    candidate = _candidate()
    output = await EvidenceVerifier(llm=PassingCriticLLM(), task_prompt="Bell state").verify(
        candidate, _execution(candidate), _plan()
    )
    assert output.decision is VerifierDecision.PASS
    assert all(check["result"] == "pass" for check in output.deterministic_checks)


class MismatchedSandbox:
    provider = "test-sandbox"

    async def _execute(self, _spec):
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=1,
            stdout="",
            stderr="",
            provider=self.provider,
            protected_result={
                "source_fingerprint": "f" * 64,
                "result": {"counts": {"00": 1}},
            },
        )


async def test_executor_rejects_sidecar_for_different_source():
    candidate = _candidate()
    output = await SandboxCandidateExecutor(MismatchedSandbox()).run_candidate(candidate, _plan())
    assert output.exit_code == 3
    assert output.observation == {"evidence_error": "source_fingerprint_mismatch"}


async def test_openqasm_converter_never_uses_stdout_or_reexecutes():
    candidate = _candidate()
    qasm, reason = await TrustedOpenQASMConverter().convert(
        candidate,
        _execution(candidate, observation={"model_stdout": "OPENQASM 3.0;"}),
    )
    assert qasm is None
    assert reason == "framework export unavailable"


class RecordingSandbox:
    provider = "recording"
    environment_id = "recording:v1"

    def __init__(self):
        self.paths = []
        self.calls = 0

    async def _execute(self, spec):
        self.paths.append(spec.protected_result_path)
        self.calls += 1
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=self.calls,
            stdout="",
            stderr="",
            provider=self.provider,
            protected_result={
                "source_fingerprint": spec.source_fingerprint,
                "result": {"counts": {"00": 1}},
            },
        )


async def test_executor_uses_unique_sidecars_and_counts_repeat_duration():
    plan = Plan.model_validate(
        _plan().model_dump(mode="json")
        | {"verification_plan": {"methods": [VerificationMethod.STATISTICAL]}}
    )
    sandbox = RecordingSandbox()
    output = await SandboxCandidateExecutor(sandbox).run_candidate(_candidate(), plan)
    assert len(set(sandbox.paths)) == 1  # one unique path reused only within this execution
    assert sandbox.paths[0].startswith("/tmp/majorana-result-")
    assert output.duration_ms == 3

    await SandboxCandidateExecutor(sandbox).run_candidate(_candidate(), plan)
    assert sandbox.paths[2] != sandbox.paths[0]


class MustNotCreateSandbox:
    provider = "must-not-run"

    async def _execute(self, _spec):
        raise AssertionError("memory preflight must run before sandbox creation")


async def test_executor_reports_resource_exhaustion_before_large_statevector_run():
    plan = Plan.model_validate(_plan().model_dump(mode="json") | {"qubits_estimate": 27})
    output = await SandboxCandidateExecutor(MustNotCreateSandbox()).run_candidate(
        _candidate(), plan
    )

    assert output.failure_kind.value == "resource_limit"
    assert output.observation["estimated_memory_mb"] == 4096
    assert output.observation["memory_limit_mb"] == 2048
    assert output.observation["sandbox_runs"] == 0


class LowConfidenceCriticLLM:
    async def complete(self, request, *, on_delta=None):
        return LLMResponse(
            text=(
                '{"decision":"pass","confidence":"low","severity":"none",'
                '"summary":"Evidence is insufficient.","passed_checks":[],"failed_checks":[],'
                '"mismatches":[],"suggestions":["Provide stronger evidence"],'
                '"repair_plan":[],"required_recheck":["semantic_critic"],'
                '"residual_risks":["intent uncertain"]}'
            ),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


async def test_semantic_critic_fails_closed_on_low_confidence_pass():
    candidate = _candidate()
    output = await EvidenceVerifier(llm=LowConfidenceCriticLLM(), task_prompt="Bell state").verify(
        candidate, _execution(candidate), _plan()
    )

    assert output.decision is VerifierDecision.FAIL
    assert output.repair is not None
    assert output.repair.required_rechecks == ["semantic_critic"]


async def test_publisher_keeps_compact_long_term_evidence_without_duplicate_variant(
    monkeypatch,
):
    candidate = _candidate()
    execution = _execution(candidate)
    verification = VerificationEvidence(
        verification_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        decision=VerifierDecision.PASS,
        deterministic_checks=[
            {
                "method": "return_contract",
                "result": "pass",
                "details": {"large_transient_evidence": "not copied"},
            }
        ],
        critic={
            "confidence": "high",
            "severity": "minor",
            "summary": "The implementation aligns with the request.",
            "residual_risks": ["Shot noise remains."],
            "repair_plan": [],
        },
    )
    artifact_id = uuid4()
    version_id = uuid4()
    captured = {}

    async def create_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id)

    async def create_version(*_args, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(id=version_id, seq=1)

    async def set_run_artifact_version(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "majorana_worker.agent_ports.artifacts_repo.create_artifact", create_artifact
    )
    monkeypatch.setattr("majorana_worker.agent_ports.artifacts_repo.create_version", create_version)
    monkeypatch.setattr(
        "majorana_worker.agent_ports.runs_repo.set_run_artifact_version",
        set_run_artifact_version,
    )

    publication = await RepoArtifactPublisher(
        scope=object(),
        session=object(),
        run_id=candidate.run_id,
        parent_artifact_id=None,
        title="Bell circuit",
    ).publish(candidate, execution, verification, None, _plan())

    assert publication.version_id == version_id
    assert captured["code"] == candidate.source
    assert captured["framework_variants"] is None
    assert captured["resource_estimates"] == execution.observation["resource_metrics"]
    assert captured["limitations"] == "Shot noise remains."
    summary = captured["metadata"]["verification_summary"]
    assert summary["decision"] == "pass"
    assert summary["deterministic_checks"] == [{"method": "return_contract", "result": "pass"}]
    assert "repair_plan" not in summary["critic"]


def test_verifier_respects_non_circuit_artifact_contract():
    source = "RESULT = {'value': 1}\n"
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=uuid4(),
        tool_call_id="simulate-other",
        revision=1,
        plan_id=uuid4(),
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )
    plan = Plan.model_validate(
        _plan(expected_keys=["value"]).model_dump(mode="json")
        | {
            "success_criteria": {"primary_metric": "value"},
            "artifact_contract": {
                "artifact_type": "other",
                "measurement_policy": "not_applicable",
                "top_level_execution": "required",
            },
        }
    )
    checks = EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="test")._deterministic_checks(
        candidate,
        _execution(candidate, result={"value": 1}, observation={}),
        plan,
    )
    assert next(check for check in checks if check["method"] == "structural")["result"] == "pass"
    assert (
        next(check for check in checks if check["method"] == "resource_contract")["result"]
        == "pass"
    )


class _ScriptedPlannerLLM:
    """Returns each queued plan JSON in turn, recording the prompts it was given."""

    def __init__(self, *payloads: str) -> None:
        self._payloads = list(payloads)
        self.prompts: list[str] = []

    async def complete(self, request, *, on_delta=None):
        self.prompts.append(request.user)
        return LLMResponse(
            text=self._payloads.pop(0),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


def _plan_payload(*, output_keys, methods) -> str:
    return json.dumps(
        {
            "domain": "optimization",
            "framework": "qiskit",
            "algorithm": Algorithm.QAOA.value,
            "problem_summary": "MaxCut on a 5-node ring",
            "algorithm_rationale": "QAOA is the standard choice for MaxCut",
            "parameters": {"shots": 1024},
            "qubits_estimate": 5,
            "expected_runtime_sec": 60,
            "success_criteria": {"primary_metric": output_keys[0]},
            "expected_output_keys": output_keys,
            "verification_plan": {"methods": methods},
        }
    )


async def test_contradictory_plan_is_re_emitted_with_the_objection():
    """A statistical check with no promised distribution costs one planner retry
    rather than the whole candidate budget."""
    contradictory = _plan_payload(
        output_keys=["optimal_cut", "approximation_ratio"],
        methods=["statistical", "return_contract"],
    )
    corrected = _plan_payload(
        output_keys=["counts", "optimal_cut"], methods=["statistical", "return_contract"]
    )
    llm = _ScriptedPlannerLLM(contradictory, corrected)
    planner = LLMPlanner(llm=llm, task_prompt="MaxCut on a ring", framework=Framework.QISKIT)

    plan = await planner.create_plan(uuid4())

    assert plan.expected_output_keys == ["counts", "optimal_cut"]
    assert len(llm.prompts) == 2
    # The retry must carry the actual objection, not just re-ask the same question.
    assert "statistical" in llm.prompts[1]
    assert "rejected by the plan contract" in llm.prompts[1]


async def test_planner_gives_up_after_the_retry_rather_than_looping():
    contradictory = _plan_payload(
        output_keys=["optimal_cut"], methods=["statistical", "return_contract"]
    )
    llm = _ScriptedPlannerLLM(contradictory, contradictory)
    planner = LLMPlanner(llm=llm, task_prompt="MaxCut on a ring", framework=Framework.QISKIT)

    with pytest.raises(StageOutputError):
        await planner.create_plan(uuid4())
    assert len(llm.prompts) == 2


# --- Checks that can actually fail (2026-07-20) ------------------------------
#
# Three deterministic checks were hardcoded or misdirected: native-optimization
# evidence appended a literal "pass", the statistical check only compared a
# candidate against itself, and the return contract recorded a type comparison it
# never performed. These tests fail against the previous implementation.

_BELL_QASM = (
    'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\n'
    "h q[0];\ncx q[0],q[1];\nmeasure q -> c;\n"
)


def _statistical_plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build and verify a Bell circuit",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
            "verification_plan": {"methods": ["statistical", "return_contract"]},
        }
    )


def _statistical_observation(counts: dict[str, int]) -> dict:
    return {
        "native_optimization": {"applied": False},
        "interchange_qasm": _BELL_QASM,
        "verification_repeat_result": {"counts": counts},
        "resource_metrics": {
            "qubits": 2,
            "depth": 2,
            "gate_count": 2,
            "two_qubit_gate_count": 1,
            "measurement_count": 2,
        },
    }


def _checks_by_method(output) -> dict[str, dict]:
    return {check["method"]: check for check in output.deterministic_checks}


async def test_native_optimization_evidence_fails_when_the_sandbox_reported_none():
    candidate = _candidate()
    output = await EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state").verify(
        candidate,
        _execution(candidate, observation={"resource_metrics": {"qubits": 2}}),
        _plan(),
    )
    check = _checks_by_method(output)["native_optimization_evidence"]
    assert check["result"] == "fail"
    assert output.decision is VerifierDecision.FAIL


async def test_native_optimization_evidence_fails_when_it_contradicts_the_source():
    # The source binds no transpile call, so a sandbox claim of applied=True is
    # evidence about a program other than the one being judged.
    candidate = _candidate()
    output = await EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state").verify(
        candidate,
        _execution(
            candidate,
            observation={
                "native_optimization": {"applied": True},
                "resource_metrics": {"qubits": 2},
            },
        ),
        _plan(),
    )
    check = _checks_by_method(output)["native_optimization_evidence"]
    assert check["result"] == "fail"
    assert check["details"]["source_applied"] is False


async def test_statistical_check_rejects_counts_that_are_reproducibly_wrong():
    # "01"/"10" is a self-consistent Bell measurement that cannot happen: the pair
    # check passes (the program agrees with itself) and the Born-distribution check
    # must still fail. This is the case the old verifier let through.
    wrong = {"01": 512, "10": 512}
    candidate = _candidate()
    output = await EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state").verify(
        candidate,
        _execution(
            candidate, result={"counts": wrong}, observation=_statistical_observation(wrong)
        ),
        _statistical_plan(),
    )
    checks = _checks_by_method(output)
    assert checks["statistical_reproducibility"]["result"] == "pass"
    assert checks["statistical"]["result"] == "fail"
    assert output.decision is VerifierDecision.FAIL


async def test_statistical_check_passes_on_counts_matching_the_born_distribution():
    right = {"00": 512, "11": 512}
    candidate = _candidate()
    output = await EvidenceVerifier(llm=PassingCriticLLM(), task_prompt="Bell state").verify(
        candidate,
        _execution(
            candidate, result={"counts": right}, observation=_statistical_observation(right)
        ),
        _statistical_plan(),
    )
    checks = _checks_by_method(output)
    assert checks["statistical"]["result"] == "pass"
    assert checks["statistical"]["details"]["evidence"] == "direct_simulation_vs_reported_counts"
    assert output.decision is VerifierDecision.PASS


async def test_statistical_check_survives_a_missing_repeat_execution():
    # The Born check needs one counts dict, so losing the second execution is no
    # longer fatal — it only costs the reproducibility evidence.
    right = {"00": 512, "11": 512}
    observation = _statistical_observation(right)
    del observation["verification_repeat_result"]
    candidate = _candidate()
    output = await EvidenceVerifier(llm=PassingCriticLLM(), task_prompt="Bell state").verify(
        candidate,
        _execution(candidate, result={"counts": right}, observation=observation),
        _statistical_plan(),
    )
    checks = _checks_by_method(output)
    assert "statistical_reproducibility" not in checks
    assert checks["statistical"]["result"] == "pass"
    assert output.decision is VerifierDecision.PASS


async def test_statistical_check_fails_when_no_evidence_is_available_at_all():
    observation = _statistical_observation({"00": 1})
    del observation["verification_repeat_result"]
    del observation["interchange_qasm"]
    candidate = _candidate()
    output = await EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state").verify(
        candidate,
        _execution(candidate, result={"counts": {"00": 1}}, observation=observation),
        _statistical_plan(),
    )
    check = _checks_by_method(output)["statistical"]
    assert check["result"] == "fail"
    assert check["details"]["error"] == "required evidence unavailable"
    assert check["details"]["interchange_qasm"] is False


class _LowConfidenceMismatchCriticLLM:
    async def complete(self, request, *, on_delta=None):
        return LLMResponse(
            text=json.dumps(
                {
                    "decision": "fail",
                    "confidence": "low",
                    "severity": "major",
                    "summary": "The reported metric does not follow from the circuit.",
                    "passed_checks": [],
                    "failed_checks": ["intent"],
                    "mismatches": [],
                    "suggestions": [],
                    "repair_plan": ["Recompute the metric from the measured counts."],
                    "required_recheck": ["semantic_critic"],
                    "residual_risks": [],
                }
            ),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


async def test_repair_carries_the_critics_grading_not_just_its_prose():
    candidate = _candidate()
    output = await EvidenceVerifier(
        llm=_LowConfidenceMismatchCriticLLM(), task_prompt="Bell state"
    ).verify(candidate, _execution(candidate), _plan())
    assert output.repair is not None
    assert output.repair.severity == "major"
    assert output.repair.confidence == "low"


async def test_deterministic_failure_is_graded_blocking():
    candidate = _candidate()
    output = await EvidenceVerifier(llm=MustNotRunLLM(), task_prompt="Bell state").verify(
        candidate, _execution(candidate, result={"wrong": True}), _plan()
    )
    assert output.repair is not None
    assert output.repair.severity == "blocking"
    assert output.repair.confidence == "high"
