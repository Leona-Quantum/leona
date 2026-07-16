from types import SimpleNamespace
from uuid import uuid4

from majorana_agent import CandidateRevision, ExecutionEvidence, VerificationEvidence
from majorana_contracts.enums import Algorithm, Framework, VerificationMethod, VerifierDecision
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_llm import LLMResponse
from majorana_sandbox import SandboxResult
from majorana_worker.agent_ports import (
    EvidenceVerifier,
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
                "resource_metrics": {
                    "qubits": 2,
                    "depth": 2,
                    "gate_count": 2,
                    "two_qubit_gate_count": 1,
                    "measurement_count": 2,
                }
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
