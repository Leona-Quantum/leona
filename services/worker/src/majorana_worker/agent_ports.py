"""Production ports for the framework-native circuit agent tools."""

from __future__ import annotations

import hashlib
import json
import signal
from typing import Any, Literal
from uuid import UUID, uuid4

from majorana_agent import (
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionFailureKind,
    ExecutionOutput,
    PublishedArtifact,
    RepairInstruction,
    VerificationEvidence,
    VerificationOutput,
)
from majorana_contracts import Scope
from majorana_contracts.enums import (
    ArtifactType,
    ExportStatus,
    Framework,
    MeasurementPolicy,
    VerificationMethod,
    VerifierDecision,
    evidence_strength_of,
)
from majorana_contracts.plan import EXACT_MAX_QUBITS, Plan
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm
from majorana_llm import (
    LLMClient,
    LLMRequest,
    StageOutputError,
    extract_json,
    model_for,
    parse_plan,
    render_plan_prompt,
)
from majorana_openqasm import OpenQASMError, normalize
from majorana_sandbox import ExecutionSpec, GuardRejection, Sandbox
from majorana_sandbox import run as sandbox_run
from majorana_verification import (
    extract_counts,
    verify_exact,
    verify_exact_native,
    verify_native_sampled_counts,
    verify_native_statistical_counts,
    verify_return_contract,
    verify_statistical_counts,
    verify_statistical_counts_pair,
)
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from majorana_api.db import AsyncSession
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import runs as runs_repo


class LLMPlanner:
    def __init__(
        self,
        *,
        llm: LLMClient,
        task_prompt: str,
        framework: Framework,
        has_parent_artifact: bool = False,
    ) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        self._framework = framework
        self._has_parent_artifact = has_parent_artifact

    # One retry, not a loop: the plan contract rejects self-contradictory plans
    # (see Plan._statistical_needs_distribution_evidence), and handing the planner
    # its own objection fixes those in one pass. More attempts would spend the
    # user's latency re-rolling the same temperature-0 output.
    _PLAN_ATTEMPTS = 2

    async def create_plan(self, _run_id: UUID) -> Plan:
        objection: str | None = None
        for attempt in range(self._PLAN_ATTEMPTS):
            prompt = render_plan_prompt(
                self._task_prompt,
                requested_framework=self._framework,
                has_parent_artifact=self._has_parent_artifact,
            )
            user = prompt.user
            if objection is not None:
                user = (
                    f"{user}\n\nYour previous plan was rejected by the plan contract:\n"
                    f"{objection}\n\nEmit a corrected plan that resolves this."
                )
            response = await self._llm.complete(
                LLMRequest(
                    model=model_for("plan"),
                    system=prompt.system,
                    user=user,
                    max_tokens=4096,
                    temperature=0.0,
                    response_schema=Plan.model_json_schema(),
                    schema_name="request_plan",
                )
            )
            try:
                plan = parse_plan(response.text)
            except StageOutputError as exc:
                if attempt == self._PLAN_ATTEMPTS - 1:
                    raise
                objection = str(exc)
                continue
            if plan.framework is not self._framework:
                raise ValueError("planner changed the user-selected framework")
            return plan
        raise AssertionError("unreachable: loop returns or raises on the final attempt")


class SandboxCandidateExecutor:
    _STATEVECTOR_BYTES_PER_AMPLITUDE = 32

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
                failure_kind=ExecutionFailureKind.CODE_ERROR,
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
        estimated_memory_mb = self._statevector_memory_mb(plan.qubits_estimate)
        if circuit_expected and estimated_memory_mb >= spec.memory_mb:
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=self._sandbox.provider,
                exit_code=75,
                failure_kind=ExecutionFailureKind.RESOURCE_LIMIT,
                duration_ms=0,
                result={},
                observation={
                    "evidence_error": "statevector_memory_preflight_exceeded",
                    "estimated_memory_mb": estimated_memory_mb,
                    "memory_limit_mb": spec.memory_mb,
                    "estimate_model": "32_bytes_per_complex_amplitude",
                    "qubits": plan.qubits_estimate,
                    "sandbox_runs": 0,
                },
            )
        # A guard rejection is a fixable property of the generated code, not an
        # infrastructure fault. `sandbox_run` RAISES it, and until 2026-07-20 nothing
        # here caught it — so the exception escaped the agent loop and dead-lettered
        # the whole job. A live QAOA task died that way on `disallowed_import:
        # qiskit_algorithms`, a package the agent can simply stop importing. Returning
        # it as a failed execution hands the violation to the repair loop instead.
        try:
            result = await sandbox_run(self._sandbox, spec)
        except GuardRejection as rejection:
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=self._sandbox.provider,
                exit_code=1,
                failure_kind=ExecutionFailureKind.CODE_ERROR,
                duration_ms=0,
                result={},
                observation={
                    "evidence_error": "guard_rejected",
                    "guard_violations": list(rejection.violations),
                    "sandbox_error": str(rejection),
                    "sandbox_runs": 0,
                },
            )
        observation = (result.protected_result or {}) | self._captured_output(result)
        if not result.ok:
            failure_kind = self._classify_failure(result.exit_code, result.stderr)
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=result.provider,
                exit_code=result.exit_code or 1,
                failure_kind=failure_kind,
                duration_ms=result.duration_ms,
                result={},
                observation=observation
                | {
                    "evidence_error": failure_kind.value,
                    "sandbox_error": result.stderr[-4000:],
                    "sandbox_runs": 1,
                },
            )
        if observation.get("source_fingerprint") != candidate.source_fingerprint:
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=result.provider,
                exit_code=result.exit_code or 3,
                failure_kind=ExecutionFailureKind.CODE_ERROR,
                duration_ms=result.duration_ms,
                result={},
                observation={"evidence_error": "source_fingerprint_mismatch"},
            )
        structured_result = observation.get("result")
        if result.ok and not isinstance(structured_result, dict):
            # The epilogue distinguishes "RESULT was never assigned" from "RESULT
            # was assigned and could not be serialized", and until 2026-07-20 both
            # arrived here as the bare "RESULT_missing". That is the difference
            # between a repair the model can make and one it cannot: a live
            # PennyLane Bell run returned `qml.counts()` directly, whose numpy
            # scalars are not JSON-serializable, and rewrote the same unserializable
            # dict four times because nothing ever told it the value was the
            # problem rather than its absence.
            serialization_error = observation.get("result_error")
            evidence_error = (
                "RESULT_not_json_serializable"
                if serialization_error is not None
                else "RESULT_missing"
            )
            hint = (
                "RESULT was assigned but is not JSON-serializable — convert framework "
                "or numpy values to plain Python types (int(), float(), str()) before "
                "assigning them, including inside nested dicts."
                if serialization_error is not None
                else "RESULT was never assigned at module scope."
            )
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=result.provider,
                exit_code=3,
                failure_kind=ExecutionFailureKind.CODE_ERROR,
                duration_ms=result.duration_ms,
                result={},
                observation=observation | {"evidence_error": evidence_error, "evidence_hint": hint},
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
                    failure_kind=(
                        self._classify_failure(repeated.exit_code, repeated.stderr)
                        if not repeated.ok
                        else ExecutionFailureKind.CODE_ERROR
                    ),
                    duration_ms=result.duration_ms + repeated.duration_ms,
                    result=structured_result or {},
                    observation=observation
                    | {
                        "evidence_error": "repeat_execution_failed",
                        "repeat_sandbox_error": repeated.stderr[-4000:],
                        "sandbox_runs": 2,
                    },
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

    # Owner decision 2026-07-20: persist the program's output. Until then the
    # sandbox.result event hardcoded stdout/stderr to "", so an empty stdout was an
    # emitter artifact and never evidence about the program — which cost a diagnosis.
    #
    # It stays untrusted on both axes. It is capped so a runaway print loop cannot
    # bloat a row; and it is NOT forwarded to the model (see ToolBroker's
    # resource_evidence) or parsed for values, because generated code writing
    # "ignore previous instructions" or a plausible-looking result dict into stdout
    # must not be able to influence the loop that judges it. RESULT remains the only
    # trusted data channel.
    _OUTPUT_LIMIT = 4000

    @classmethod
    def _captured_output(cls, result: Any) -> dict[str, Any]:
        stdout, stderr = result.stdout or "", result.stderr or ""
        return {
            "sandbox_stdout": stdout[-cls._OUTPUT_LIMIT :],
            "sandbox_stderr": stderr[-cls._OUTPUT_LIMIT :],
            "sandbox_output_truncated": (
                len(stdout) > cls._OUTPUT_LIMIT or len(stderr) > cls._OUTPUT_LIMIT
            ),
        }

    @classmethod
    def _statevector_memory_mb(cls, qubits: int) -> int:
        return (cls._STATEVECTOR_BYTES_PER_AMPLITUDE * (1 << qubits) + (1 << 20) - 1) // (1 << 20)

    @staticmethod
    def _classify_failure(exit_code: int, stderr: str) -> ExecutionFailureKind:
        message = stderr.lower()
        if "timeout" in message or "timed out" in message:
            return ExecutionFailureKind.TIMEOUT
        if any(
            marker in message
            for marker in ("memoryerror", "out of memory", "oom", "cannot allocate memory")
        ) or exit_code in {-signal.SIGKILL, 128 + signal.SIGKILL}:
            return ExecutionFailureKind.MEMORY_EXHAUSTED
        return ExecutionFailureKind.CODE_ERROR

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


# `extra="ignore"`, not "forbid". A stray field is not a reason to throw away a
# judgement the critic did make: the fabricated fallback below is blocking, consumes a
# candidate, and asks for a recheck the agent cannot perform. Forbidding extras turned
# a cosmetic serialization slip into a rejection of code the critic never judged.
class _CriticMismatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    area: str = Field(min_length=1, max_length=120)
    expected: str = Field(min_length=1, max_length=600)
    observed: str = Field(min_length=1, max_length=600)
    evidence: str = Field(min_length=1, max_length=1000)
    severity: Literal["minor", "major", "blocking"]


class _CriticOutput(BaseModel):
    """Deliberately small. The whole schema is injected into DeepSeek's system prompt
    (json_object mode has no json_schema support), and the reply has to fit the output
    budget as well — a schema that invites thirty-item lists spends the budget it needs
    to close its own braces. `passed_checks` is gone because nothing downstream ever
    read it; every remaining field is consumed by the repair instruction, the run
    record, or the best-effort artifact."""

    model_config = ConfigDict(extra="ignore")

    decision: VerifierDecision
    confidence: Literal["high", "medium", "low"]
    severity: Literal["none", "minor", "major", "blocking"]
    summary: str = Field(min_length=1, max_length=600)
    failed_checks: list[str] = Field(default_factory=list, max_length=8)
    mismatches: list[_CriticMismatch] = Field(default_factory=list, max_length=5)
    suggestions: list[str] = Field(default_factory=list, max_length=6)
    repair_plan: list[str] = Field(default_factory=list, max_length=6)
    required_recheck: list[str] = Field(default_factory=list, max_length=6)
    residual_risks: list[str] = Field(default_factory=list, max_length=6)


class EvidenceVerifier:
    def __init__(
        self, *, llm: LLMClient, task_prompt: str, parent_artifact_qasm: str | None = None
    ) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        # Passed in rather than fetched: the verifier holds no session and no scope,
        # and the parent version is already loaded by the run handler.
        self._parent_artifact_qasm = parent_artifact_qasm

    async def verify(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> VerificationOutput:
        checks = self._deterministic_checks(candidate, execution, plan)
        # "skipped" is non-blocking by design: the check declared itself incapable
        # of judging this circuit (mid-circuit measurement / classical control
        # flow), so there is no criticism a repair could satisfy — failing here
        # burned whole candidate budgets on correct teleportation code. Anything
        # else that is not a pass stays blocking, including result values this
        # code does not recognise: fail-closed for the unknown.
        failures = [check for check in checks if check["result"] not in {"pass", "skipped"}]
        if failures:
            evidence = [json.dumps(check, sort_keys=True, default=str) for check in failures]
            return VerificationOutput(
                decision=VerifierDecision.FAIL,
                deterministic_checks=checks,
                repair=RepairInstruction(
                    category="deterministic_verification_failed",
                    # A failed deterministic check is not a matter of degree.
                    severity="blocking",
                    confidence="high",
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
        critic_passed = (
            critic.decision is VerifierDecision.PASS
            and critic.confidence != "low"
            and critic.severity in {"none", "minor"}
            and not critic.failed_checks
            and not critic.mismatches
        )
        if critic_passed:
            return VerificationOutput(
                decision=VerifierDecision.PASS,
                deterministic_checks=checks,
                critic=critic.model_dump(mode="json"),
            )
        return VerificationOutput(
            decision=VerifierDecision.FAIL,
            deterministic_checks=checks,
            critic=critic.model_dump(mode="json"),
            repair=(
                RepairInstruction(
                    category="intent_alignment_failed",
                    severity=critic.severity,
                    confidence=critic.confidence,
                    evidence=[
                        critic.summary,
                        *critic.failed_checks,
                        *(item.model_dump_json() for item in critic.mismatches),
                    ],
                    repairs=critic.repair_plan
                    or critic.suggestions
                    or ["Align the implementation with the accepted plan."],
                    preserve_invariants=[f"framework={candidate.framework.value}", "assign RESULT"],
                    required_rechecks=critic.required_recheck or ["all"],
                )
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
        metrics_error = execution.observation.get("resource_metrics_error")
        observed_qubits = metrics.get("qubits") if isinstance(metrics, dict) else None
        resource_ok = not circuit_expected or (
            type(observed_qubits) is int
            and observed_qubits > 0
            and observed_qubits <= plan.qubits_estimate
        )
        resource_details: dict[str, Any] = {
            "planned_qubit_ceiling": plan.qubits_estimate,
            "observed_qubits": observed_qubits,
        }
        if metrics_error is not None:
            resource_details["reason"] = metrics_error
        checks.append(
            {
                "method": "resource_contract",
                "result": "pass" if resource_ok else "fail",
                "details": resource_details,
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
            measurement_details: dict[str, Any] = {
                "policy": policy.value,
                "measurement_count": measurement_count,
            }
            if metrics_error is not None:
                measurement_details["reason"] = metrics_error
            checks.append(
                {
                    "method": "measurement_policy",
                    "result": "pass" if measurement_ok else "fail",
                    "details": measurement_details,
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
        # Only meaningful when a circuit was expected: the trusted observer that
        # records this evidence is empty for non-circuit artifacts, so appending
        # the check there would be asserting on evidence nobody was asked to
        # produce. When it IS expected, absent or malformed evidence fails —
        # until 2026-07-20 this slot held a hardcoded "pass", which is worse than
        # no check at all because it lends weight to the evidence list.
        if circuit_expected:
            checks.append(self._native_optimization_check(program, execution))
        methods = list(plan.verification_plan.methods) if plan.verification_plan else []
        if VerificationMethod.RETURN_CONTRACT not in methods:
            methods.append(VerificationMethod.RETURN_CONTRACT)
        for method in methods:
            if method is VerificationMethod.STATISTICAL:
                checks.extend(self._statistical_checks(execution, plan))
                continue
            if method is VerificationMethod.EXACT:
                checks.append(self._exact_check(execution, plan))
                continue
            outcome = None
            if method is VerificationMethod.RETURN_CONTRACT:
                expected_type = (
                    plan.artifact_contract.expected_return_type if plan.artifact_contract else None
                )
                outcome = verify_return_contract(
                    execution.result, plan.expected_output_keys, expected_type
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
        # Opportunistic physical evidence for plans that requested no statistical
        # check at all (the QPE shape that graded `structural`): when the run
        # reported counts AND the observer produced a trusted re-execution, the
        # comparison is free and either upgrades the run's evidence to physical
        # or catches counts the actual circuit contradicts. It cannot fire a
        # false "required evidence unavailable" — absent evidence appends nothing.
        if circuit_expected and VerificationMethod.STATISTICAL not in methods:
            native_sampled = execution.observation.get("native_sampled")
            reported = extract_counts(execution.result, plan.expected_output_keys)
            if reported is not None and isinstance(native_sampled, dict):
                thresholds = (
                    plan.verification_plan.thresholds if plan.verification_plan else None
                ) or {}
                outcome = verify_native_sampled_counts(
                    reported,
                    native_sampled,
                    thresholds.get("tvd_max", thresholds.get("total_variation_max")),
                )
                checks.append(
                    {
                        "method": outcome.method.value,
                        "result": outcome.result.value,
                        "details": outcome.details,
                    }
                )
        return checks

    @staticmethod
    def _native_optimization_check(
        program: FrameworkProgram, execution: ExecutionEvidence
    ) -> dict[str, Any]:
        observed = execution.observation.get("native_optimization")
        if not isinstance(observed, dict) or type(observed.get("applied")) is not bool:
            return {
                "method": "native_optimization_evidence",
                "result": "fail",
                "details": {
                    "error": "no native-optimization evidence in the sandbox observation",
                    "observed": observed,
                },
            }
        classified = program.native_optimization(execution.observation)
        # The observer stamps its verdict from a static read of the source at
        # spec-build time; this reclassifies the source we hold now. They can only
        # disagree if the program that ran is not the program we are judging, which
        # the fingerprint check upstream should already have caught — so a
        # disagreement means one of the two is broken, and fail-closed is correct.
        source_applied = program.native_optimization().applied
        if source_applied is not observed["applied"]:
            return {
                "method": "native_optimization_evidence",
                "result": "fail",
                "details": {
                    "error": "sandbox evidence disagrees with the executed source",
                    "observed_applied": observed["applied"],
                    "source_applied": source_applied,
                },
            }
        return {
            "method": "native_optimization_evidence",
            "result": "pass",
            "details": {
                "applied": classified.applied,
                "mode": classified.mode,
                "reason": classified.reason,
            },
        }

    def _exact_check(self, execution: ExecutionEvidence, plan: Plan) -> dict[str, Any]:
        """Phase-aligned unitary equivalence against a reference circuit.

        The strongest check the pipeline can run, and the only one that compares the
        executed circuit against something other than itself. Until 2026-07-20
        `verify_exact` was production code with no caller, because nothing decided
        where the reference comes from.

        It is framework-agnostic on the candidate side and only on that side. The
        candidate arrives as `interchange_qasm`, which every adapter emits, so a Cirq
        or PennyLane program is compared the same way a Qiskit one is. The reference
        is always OpenQASM — declarative data we parse, never code we run. A
        reference written as framework source would have to be executed in the
        sandbox to mean anything, which would admit a second piece of model-authored
        code as ground truth.

        The two sources prove different things, so `reference_source` is recorded in
        the evidence and the check never claims more than it earned:

        - `plan_declared` — the planner wrote the reference before any code existed.
          It catches code that implements a different circuit than the one intended.
          It cannot catch a mis-specified plan: reference and candidate come from the
          same model.
        - `parent_artifact` — the circuit this run revises, which passed verification
          on its own. Independent evidence, and the equivalence-checking case: the
          revision must not change what the circuit computes.
        """
        verification_plan = plan.verification_plan
        source = verification_plan.reference_source if verification_plan else None
        details: dict[str, Any] = {"reference_source": source}
        if source == "parent_artifact":
            reference = self._parent_artifact_qasm
            details["reference_available"] = reference is not None
        else:
            reference = verification_plan.reference_qasm if verification_plan else None
        candidate_qasm = extract_interchange_qasm(execution.observation).qasm
        native_statevector = execution.observation.get("native_statevector")
        if reference is not None and candidate_qasm is None and isinstance(
            native_statevector, dict
        ):
            # A failed OpenQASM export downgrades the EXPORT, never the verdict
            # (plans/framework-native-verification.md): fall back to comparing the
            # framework-native final state against the reference. Weaker than the
            # unitary comparison — the outcome's evidence says so.
            outcome = verify_exact_native(reference, native_statevector)
            merged = details | outcome.details
            merged["evidence_scope"] = (
                "the framework-native final state matches the reference circuit's "
                "(action on the all-zero state; the candidate's OpenQASM export "
                "was unavailable)"
            )
            return {
                "method": outcome.method.value,
                "result": outcome.result.value,
                "details": merged,
            }
        if reference is None or candidate_qasm is None:
            # Fail, never skip. A check that cannot run is missing evidence, and the
            # plan contract already refuses the reference-less cases it can see — so
            # arriving here means the run genuinely lacks what it promised.
            return {
                "method": VerificationMethod.EXACT.value,
                "result": "fail",
                "details": details
                | {
                    "error": "required evidence unavailable",
                    "reference_qasm": reference is not None,
                    "interchange_qasm": candidate_qasm is not None,
                    "native_statevector": isinstance(native_statevector, dict),
                },
            }
        outcome = verify_exact(reference, candidate_qasm, max_qubits=EXACT_MAX_QUBITS)
        merged = details | outcome.details
        if source == "plan_declared":
            merged["evidence_scope"] = (
                "the executed circuit matches the reference the planner declared; "
                "reference and implementation share an author"
            )
        else:
            merged["evidence_scope"] = (
                "the executed circuit is unitarily equivalent to the parent "
                "artifact's independently verified circuit"
            )
        return {
            "method": outcome.method.value,
            "result": outcome.result.value,
            "details": merged,
        }

    @staticmethod
    def _statistical_checks(execution: ExecutionEvidence, plan: Plan) -> list[dict[str, Any]]:
        """Independent claims, reported separately.

        `statistical` is correctness: the reported counts against the Born
        distribution of the circuit that actually ran. The distribution comes
        from the framework's OWN simulator when the observer produced it
        (`native_statevector` — plans/framework-native-verification.md: no
        conversion in the trust path; three of the four defects in that family
        were conversion defects), and from simulating the interchange QASM only
        as the fallback for runs whose observer produced no native evidence.

        `statistical_native` is the mid-circuit-capable physical check: reported
        counts against a trusted re-execution of the circuit object through the
        framework's own sampler. Feed-forward circuits have no statevector, so
        this is the check that lets them earn a physical grade at all.

        `statistical_reproducibility` is only that the program agrees with
        itself across two executions.
        """
        thresholds = (plan.verification_plan.thresholds if plan.verification_plan else None) or {}
        threshold = thresholds.get("tvd_max", thresholds.get("total_variation_max"))
        reported = extract_counts(execution.result, plan.expected_output_keys)
        native_statevector = execution.observation.get("native_statevector")
        qasm = extract_interchange_qasm(execution.observation).qasm
        checks: list[dict[str, Any]] = []
        if reported is not None and isinstance(native_statevector, dict):
            outcome = verify_native_statistical_counts(native_statevector, reported, threshold)
            checks.append(
                {
                    "method": outcome.method.value,
                    "result": outcome.result.value,
                    "details": outcome.details,
                }
            )
        elif reported is not None and qasm is not None:
            outcome = verify_statistical_counts(qasm, reported, threshold)
            checks.append(
                {
                    "method": outcome.method.value,
                    "result": outcome.result.value,
                    "details": outcome.details,
                }
            )
        native_sampled = execution.observation.get("native_sampled")
        if reported is not None and isinstance(native_sampled, dict):
            outcome = verify_native_sampled_counts(reported, native_sampled, threshold)
            checks.append(
                {
                    "method": outcome.method.value,
                    "result": outcome.result.value,
                    "details": outcome.details,
                }
            )
        repeat_result = execution.observation.get("verification_repeat_result")
        second = (
            extract_counts(repeat_result, plan.expected_output_keys)
            if isinstance(repeat_result, dict)
            else None
        )
        if reported is not None and second is not None:
            outcome = verify_statistical_counts_pair(reported, second, threshold)
            checks.append(
                {
                    "method": "statistical_reproducibility",
                    "result": outcome.result.value,
                    "details": outcome.details,
                }
            )
        if not checks:
            checks.append(
                {
                    "method": VerificationMethod.STATISTICAL.value,
                    "result": "fail",
                    "details": {
                        "error": "required evidence unavailable",
                        "reported_counts": reported is not None,
                        "native_statevector": isinstance(native_statevector, dict),
                        "native_sampled": isinstance(native_sampled, dict),
                        "interchange_qasm": qasm is not None,
                        "repeat_execution": second is not None,
                    },
                }
            )
        return checks

    async def _critic(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        checks: list[dict[str, Any]],
    ) -> _CriticOutput:
        request = LLMRequest(
            model=model_for("verify"),
            system=(
                "Act as an independent, fail-closed quantum-program critic. Judge request-to-plan, "
                "plan-to-code, and success-criteria-to-result alignment using only supplied evidence. "
                "Check the artifact contract, selected framework, measurement policy, seeds, shots, "
                "tolerances, qubit ordering, forbidden operations, required invariants, and whether "
                "the evidence actually proves each claim. Deterministic checks already passed — or "
                "were skipped as structurally incapable of judging this circuit, which is not a "
                "defect in the code — and cannot be overridden. Return pass only with medium/high "
                "confidence, no mismatch, "
                "and at most minor severity; otherwise give a concrete repair plan and rechecks."
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
            # 2048 was not enough headroom for a reasoning model to close its own
            # braces once the evidence blob got large; a truncated object is the same
            # symptom as a refusal and was being read as one.
            max_tokens=3072,
            temperature=0.0,
            response_schema=_CriticOutput.model_json_schema(),
            schema_name="intent_alignment",
        )
        # The critic is asked twice before its failure is allowed to count against the
        # candidate. A malformed completion is the CRITIC's failure, not the code's, and
        # the fabricated verdict below is indistinguishable from a real objection: it is
        # blocking, it consumes a candidate, and its repair plan asks the agent to
        # "re-run semantic verification", which the agent cannot do. So one unparseable
        # response rejected a candidate the critic never actually judged, and four in a
        # row exhausted the budget — a 3-qubit W state died exactly that way on
        # production run 019f7db9-f25c. Temperature is already 0; the retry exists
        # because the failure is in serialization, not in sampling.
        #
        # The parse is tolerant before it is strict. `model_validate_json` needs the
        # whole reply to be the object; a ```json fence or a sentence of preamble made
        # it fail with the verdict sitting intact inside the response. `_extract_json`
        # is the same salvage the plan stage has always had, and the critic never did.
        last_error: Exception | None = None
        for _ in range(2):
            response = await self._llm.complete(request)
            try:
                return _CriticOutput.model_validate_json(response.text)
            except ValidationError as exc:
                last_error = exc
            try:
                return _CriticOutput.model_validate_json(extract_json(response.text))
            except (ValidationError, StageOutputError) as exc:
                last_error = exc
        return _CriticOutput(
            decision=VerifierDecision.FAIL,
            confidence="low",
            severity="blocking",
            summary=(
                "The semantic critic could not return valid structured evidence, twice. "
                "This is a verifier failure, not a defect found in the candidate — the "
                "code below was never actually judged."
            ),
            failed_checks=["critic_output_schema"],
            repair_plan=["Retry the run; no change to the candidate is implied by this result."],
            required_recheck=["semantic_critic"],
            residual_risks=[str(last_error)[:1000] if last_error else "unknown"],
        )


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
        execution: ExecutionEvidence,
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
        # A failed export downgrades the EXPORT, never the verdict
        # (plans/framework-native-verification.md). Until 2026-07-20 this row
        # said `lossless` even when no QASM existed at all.
        export_status = ExportStatus.LOSSLESS if qasm else ExportStatus.UNSUPPORTED
        export_reason = (
            None if qasm else (conversion.reason if conversion else "framework export unavailable")
        )
        resource_metrics = execution.observation.get("resource_metrics")
        resource_estimates = resource_metrics if isinstance(resource_metrics, dict) else None
        critic = verification.critic if isinstance(verification.critic, dict) else {}
        critic_summary = {
            key: critic[key]
            for key in ("confidence", "severity", "summary", "residual_risks")
            if key in critic
        }
        residual_risks = critic.get("residual_risks")
        limitations = (
            "\n".join(str(item) for item in residual_risks)
            if isinstance(residual_risks, list) and residual_risks
            else None
        )
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
                "verification_summary": {
                    "decision": verification.decision.value,
                    # Derived here rather than stored on the evidence row: the checks
                    # are the fact, the grade is a reading of them, and a stored grade
                    # would be free to drift from the list printed beside it.
                    "evidence_strength": evidence_strength_of(
                        verification.deterministic_checks
                    ).value,
                    "deterministic_checks": [
                        {
                            "method": check.get("method"),
                            "result": check.get("result"),
                        }
                        for check in verification.deterministic_checks
                    ],
                    "critic": critic_summary or None,
                },
            },
            code=candidate.source,
            code_lang=candidate.framework.value,
            fingerprint=candidate.source_fingerprint,
            export_status=export_status,
            export_reason=export_reason,
            framework_variants=None,
            resource_estimates=resource_estimates,
            limitations=limitations,
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
