"""Production ports for the framework-native circuit agent tools."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID, uuid4

from majorana_agent import (
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionOutput,
    PublishedArtifact,
    RepairInstruction,
    VerificationEvidence,
    VerificationOutput,
)
from majorana_baselines import (
    BaselineInstance,
    HamiltonianInstance,
    MaxCutInstance,
    PortfolioInstance,
    QuboInstance,
)
from majorana_contracts import Scope
from majorana_contracts.enums import (
    ArtifactType,
    ExportStatus,
    Framework,
    MeasurementPolicy,
    VerificationMethod,
    VerifierDecision,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm
from majorana_llm import LLMClient, LLMRequest, model_for, parse_plan, render_plan_prompt
from majorana_openqasm import OpenQASMError, normalize
from majorana_sandbox import ExecutionSpec, Sandbox
from majorana_sandbox import run as sandbox_run
from majorana_verification import (
    extract_counts,
    verify_brute_force,
    verify_exact_diag,
    verify_return_contract,
    verify_statistical_counts_pair,
)
from pydantic import BaseModel, ConfigDict, Field

from majorana_api.db import AsyncSession
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import runs as runs_repo


class LLMPlanner:
    def __init__(self, *, llm: LLMClient, task_prompt: str, framework: Framework) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        self._framework = framework

    async def create_plan(self, _run_id: UUID) -> Plan:
        prompt = render_plan_prompt(self._task_prompt, requested_framework=self._framework)
        response = await self._llm.complete(
            LLMRequest(
                model=model_for("plan"),
                system=prompt.system,
                user=prompt.user,
                max_tokens=4096,
                temperature=0.0,
                response_schema=Plan.model_json_schema(),
                schema_name="request_plan",
            )
        )
        plan = parse_plan(response.text)
        if plan.framework is not self._framework:
            raise ValueError("planner changed the user-selected framework")
        return plan


class SandboxCandidateExecutor:
    def __init__(self, sandbox: Sandbox) -> None:
        self._sandbox = sandbox

    async def run_candidate(self, candidate: CandidateRevision, plan: Plan) -> ExecutionOutput:
        program = FrameworkProgram(candidate.framework, candidate.source)
        circuit_expected = (
            plan.artifact_contract is None
            or plan.artifact_contract.artifact_type is not ArtifactType.OTHER
        )
        diagnostics = program.contract_diagnostics(circuit_expected=circuit_expected)
        if diagnostics:
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=self._sandbox.provider,
                exit_code=2,
                duration_ms=0,
                result={},
                observation={"contract_diagnostics": diagnostics},
            )
        spec = ExecutionSpec(
            code=program.normalized_source,
            timeout_s=min(plan.expected_runtime_sec + 30, 120),
            qubits_estimate=plan.qubits_estimate,
            trusted_setup=program.trusted_setup(circuit_expected=circuit_expected),
            trusted_observer=program.trusted_observer(circuit_expected=circuit_expected),
            protected_result_path=f"/tmp/majorana-result-{uuid4().hex}.json",
            source_fingerprint=candidate.source_fingerprint,
        )
        result = await sandbox_run(self._sandbox, spec)
        observation = result.protected_result or {}
        if observation.get("source_fingerprint") != candidate.source_fingerprint:
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=result.provider,
                exit_code=result.exit_code or 3,
                duration_ms=result.duration_ms,
                result={},
                observation={"evidence_error": "source_fingerprint_mismatch"},
            )
        structured_result = observation.get("result")
        if result.ok and not isinstance(structured_result, dict):
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=result.provider,
                exit_code=3,
                duration_ms=result.duration_ms,
                result={},
                observation=observation | {"evidence_error": "RESULT_missing"},
            )
        if result.ok and self._needs_repeat(plan):
            repeated = await sandbox_run(self._sandbox, spec)
            total_duration_ms = result.duration_ms + repeated.duration_ms
            repeated_observation = repeated.protected_result or {}
            if (
                not repeated.ok
                or repeated_observation.get("source_fingerprint") != candidate.source_fingerprint
                or not isinstance(repeated_observation.get("result"), dict)
            ):
                return ExecutionOutput(
                    environment_fingerprint=self._environment_fingerprint(candidate, plan),
                    sandbox_provider=result.provider,
                    exit_code=repeated.exit_code or 4,
                    duration_ms=result.duration_ms + repeated.duration_ms,
                    result=structured_result or {},
                    observation=observation | {"evidence_error": "repeat_execution_failed"},
                )
            observation = observation | {
                "verification_repeat_result": repeated_observation["result"],
                "sandbox_runs": 2,
            }
        else:
            total_duration_ms = result.duration_ms
            observation = observation | {"sandbox_runs": 1}
        return ExecutionOutput(
            environment_fingerprint=self._environment_fingerprint(candidate, plan),
            sandbox_provider=result.provider,
            exit_code=result.exit_code,
            duration_ms=total_duration_ms,
            result=structured_result if isinstance(structured_result, dict) else {},
            observation=observation,
        )

    @staticmethod
    def _needs_repeat(plan: Plan) -> bool:
        return bool(
            plan.verification_plan
            and VerificationMethod.STATISTICAL in plan.verification_plan.methods
        )

    def _environment_fingerprint(self, candidate: CandidateRevision, plan: Plan) -> str:
        manifest = json.dumps(
            {
                "provider": self._sandbox.provider,
                "environment_id": getattr(self._sandbox, "environment_id", self._sandbox.provider),
                "framework": candidate.framework.value,
                "qubits": plan.qubits_estimate,
                "timeout": min(plan.expected_runtime_sec + 30, 120),
                "runner_contract": 1,
            },
            sort_keys=True,
        )
        return hashlib.sha256(manifest.encode()).hexdigest()


class _CriticOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: VerifierDecision
    findings: list[str] = Field(default_factory=list, max_length=20)
    repairs: list[str] = Field(default_factory=list, max_length=20)


_BASELINE_TYPES: dict[str, type[BaselineInstance]] = {
    "maxcut": MaxCutInstance,
    "qubo": QuboInstance,
    "portfolio": PortfolioInstance,
    "hamiltonian": HamiltonianInstance,
}


class EvidenceVerifier:
    def __init__(self, *, llm: LLMClient, task_prompt: str) -> None:
        self._llm = llm
        self._task_prompt = task_prompt

    async def verify(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> VerificationOutput:
        checks = self._deterministic_checks(candidate, execution, plan)
        failures = [check for check in checks if check["result"] != "pass"]
        if failures:
            evidence = [json.dumps(check, sort_keys=True, default=str) for check in failures]
            return VerificationOutput(
                decision=VerifierDecision.FAIL,
                deterministic_checks=checks,
                repair=RepairInstruction(
                    category="deterministic_verification_failed",
                    evidence=evidence,
                    repairs=[
                        "Repair the failing deterministic checks without changing the framework."
                    ],
                    preserve_invariants=(
                        plan.verification_plan.required_invariants
                        if plan.verification_plan and plan.verification_plan.required_invariants
                        else [
                            f"framework={candidate.framework.value}",
                            "bind FINAL_CIRCUIT",
                            "assign RESULT",
                        ]
                    ),
                    required_rechecks=[check["method"] for check in failures],
                ),
            )
        critic = await self._critic(candidate, execution, plan, checks)
        if critic.decision is VerifierDecision.PASS:
            return VerificationOutput(
                decision=VerifierDecision.PASS,
                deterministic_checks=checks,
                critic=critic.model_dump(mode="json"),
            )
        return VerificationOutput(
            decision=critic.decision,
            deterministic_checks=checks,
            critic=critic.model_dump(mode="json"),
            repair=(
                RepairInstruction(
                    category="intent_alignment_failed",
                    evidence=critic.findings,
                    repairs=critic.repairs or ["Align the implementation with the accepted plan."],
                    preserve_invariants=[f"framework={candidate.framework.value}", "assign RESULT"],
                    required_rechecks=["all"],
                )
                if critic.decision is VerifierDecision.FAIL
                else None
            ),
        )

    def _deterministic_checks(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> list[dict[str, Any]]:
        program = FrameworkProgram(candidate.framework, candidate.source)
        circuit_expected = (
            plan.artifact_contract is None
            or plan.artifact_contract.artifact_type is not ArtifactType.OTHER
        )
        diagnostics = program.contract_diagnostics(circuit_expected=circuit_expected)
        checks: list[dict[str, Any]] = [
            {
                "method": "structural",
                "result": "fail" if diagnostics else "pass",
                "details": {"diagnostics": diagnostics},
            }
        ]
        metrics = execution.observation.get("resource_metrics")
        observed_qubits = metrics.get("qubits") if isinstance(metrics, dict) else None
        resource_ok = not circuit_expected or (
            type(observed_qubits) is int
            and observed_qubits > 0
            and observed_qubits <= plan.qubits_estimate
        )
        checks.append(
            {
                "method": "resource_contract",
                "result": "pass" if resource_ok else "fail",
                "details": {
                    "planned_qubit_ceiling": plan.qubits_estimate,
                    "observed_qubits": observed_qubits,
                },
            }
        )
        if plan.artifact_contract is not None:
            policy = plan.artifact_contract.measurement_policy
            measurement_count = (
                metrics.get("measurement_count") if isinstance(metrics, dict) else None
            )
            measurement_ok = type(measurement_count) is int
            if policy is MeasurementPolicy.NONE:
                measurement_ok = measurement_ok and measurement_count == 0
            elif policy is MeasurementPolicy.MEASURE_ALL:
                measurement_ok = (
                    measurement_ok
                    and type(observed_qubits) is int
                    and measurement_count >= observed_qubits
                )
            checks.append(
                {
                    "method": "measurement_policy",
                    "result": "pass" if measurement_ok else "fail",
                    "details": {
                        "policy": policy.value,
                        "measurement_count": measurement_count,
                    },
                }
            )
        expected_range = plan.success_criteria.expected_range
        if expected_range is not None:
            metric_name = plan.success_criteria.primary_metric
            value = execution.result.get(metric_name)
            metric_ok = isinstance(value, int | float) and not isinstance(value, bool)
            if metric_ok and "min" in expected_range:
                metric_ok = value >= expected_range["min"]
            if metric_ok and "max" in expected_range:
                metric_ok = value <= expected_range["max"]
            checks.append(
                {
                    "method": "success_criteria",
                    "result": "pass" if metric_ok else "fail",
                    "details": {
                        "metric": metric_name,
                        "value": value,
                        "expected_range": expected_range,
                    },
                }
            )
        optimization = execution.observation.get("native_optimization")
        checks.append(
            {
                "method": "native_optimization_evidence",
                "result": "pass",
                "details": optimization if isinstance(optimization, dict) else {"applied": False},
            }
        )
        methods = list(plan.verification_plan.methods) if plan.verification_plan else []
        if VerificationMethod.RETURN_CONTRACT not in methods:
            methods.append(VerificationMethod.RETURN_CONTRACT)
        for method in methods:
            outcome = None
            if method is VerificationMethod.RETURN_CONTRACT:
                expected_type = (
                    plan.artifact_contract.expected_return_type if plan.artifact_contract else None
                )
                outcome = verify_return_contract(
                    execution.result, plan.expected_output_keys, expected_type
                )
            elif method is VerificationMethod.STATISTICAL:
                first = extract_counts(execution.result, plan.expected_output_keys)
                repeat_result = execution.observation.get("verification_repeat_result")
                second = (
                    extract_counts(repeat_result, plan.expected_output_keys)
                    if isinstance(repeat_result, dict)
                    else None
                )
                if first is not None and second is not None:
                    thresholds = plan.verification_plan.thresholds or {}
                    threshold = thresholds.get("tvd_max", thresholds.get("total_variation_max"))
                    outcome = verify_statistical_counts_pair(first, second, threshold)
            elif method in {VerificationMethod.BRUTE_FORCE, VerificationMethod.EXACT_DIAG}:
                instance = self._baseline_instance(execution.result)
                claimed = execution.result.get(plan.success_criteria.primary_metric)
                if (
                    instance is not None
                    and isinstance(claimed, int | float)
                    and not isinstance(claimed, bool)
                ):
                    outcome = (
                        verify_brute_force(instance, float(claimed))
                        if method is VerificationMethod.BRUTE_FORCE
                        else verify_exact_diag(instance, float(claimed))
                    )
            if outcome is None:
                checks.append(
                    {
                        "method": method.value,
                        "result": "fail",
                        "details": {"error": "required evidence unavailable"},
                    }
                )
            else:
                checks.append(
                    {
                        "method": outcome.method.value,
                        "result": outcome.result.value,
                        "details": outcome.details,
                    }
                )
        return checks

    @staticmethod
    def _baseline_instance(result: dict[str, Any]) -> BaselineInstance | None:
        raw = result.get("baseline_instance")
        if not isinstance(raw, dict):
            return None
        cls = _BASELINE_TYPES.get(str(raw.get("kind")))
        if cls is None:
            return None
        try:
            return cls.model_validate(raw)
        except ValueError:
            return None

    async def _critic(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        checks: list[dict[str, Any]],
    ) -> _CriticOutput:
        response = await self._llm.complete(
            LLMRequest(
                model=model_for("verify"),
                system=(
                    "Judge semantic alignment using only the supplied request, plan, exact source, "
                    "and deterministic evidence. Deterministic checks already passed and cannot be "
                    "overridden. Return pass only if the implementation fulfills the user intent."
                ),
                user=json.dumps(
                    {
                        "request": self._task_prompt,
                        "plan": plan.model_dump(mode="json"),
                        "framework": candidate.framework.value,
                        "source": candidate.source,
                        "result": execution.result,
                        "checks": checks,
                    },
                    default=str,
                ),
                max_tokens=2048,
                temperature=0.0,
                response_schema=_CriticOutput.model_json_schema(),
                schema_name="intent_alignment",
            )
        )
        return _CriticOutput.model_validate_json(response.text)


class TrustedOpenQASMConverter:
    async def convert(
        self, candidate: CandidateRevision, execution: ExecutionEvidence
    ) -> tuple[str | None, str | None]:
        if execution.source_fingerprint != candidate.source_fingerprint:
            raise ValueError("execution fingerprint does not match candidate")
        extracted = extract_interchange_qasm(execution.observation)
        if extracted.qasm is None:
            return None, extracted.epilogue_error or "framework export unavailable"
        try:
            return normalize(extracted.qasm), None
        except OpenQASMError as exc:
            return None, f"OpenQASM normalization failed: {type(exc).__name__}"


class RepoArtifactPublisher:
    def __init__(
        self,
        *,
        scope: Scope,
        session: AsyncSession,
        run_id: UUID,
        parent_artifact_id: UUID | None,
        title: str,
    ) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id
        self._parent_artifact_id = parent_artifact_id
        self._title = title

    async def publish(
        self,
        candidate: CandidateRevision,
        verification: VerificationEvidence,
        conversion: ConversionEvidence | None,
        plan: Plan,
    ) -> PublishedArtifact:
        artifact_id = self._parent_artifact_id
        if artifact_id is None:
            artifact = await artifacts_repo.create_artifact(
                self._scope,
                self._session,
                slug=f"run-{self._run_id.hex[:12]}",
                title=self._title[:200],
                family=plan.algorithm,
                framework=candidate.framework,
            )
            artifact_id = artifact.id
        qasm = conversion.qasm if conversion and conversion.status == "available" else None
        version = await artifacts_repo.create_version(
            self._scope,
            self._session,
            artifact_id,
            qasm_version="3.0" if qasm else None,
            qasm=qasm,
            metadata={
                "source": "verified_agent_candidate",
                "candidate_id": str(candidate.candidate_id),
                "candidate_revision": candidate.revision,
                "verification_id": str(verification.verification_id),
                "canonical_representation": "framework_code",
                "openqasm_role": "interchange" if qasm else "unavailable",
            },
            code=candidate.source,
            code_lang=candidate.framework.value,
            fingerprint=candidate.source_fingerprint,
            export_status=ExportStatus.LOSSLESS,
            framework_variants={candidate.framework.value: candidate.source},
        )
        await runs_repo.set_run_artifact_version(
            self._scope, self._session, self._run_id, version.id
        )
        return PublishedArtifact(
            artifact_id=artifact_id,
            version_id=version.id,
            version_seq=version.seq,
            candidate_id=candidate.candidate_id,
            framework=candidate.framework,
            source_fingerprint=candidate.source_fingerprint,
        )
