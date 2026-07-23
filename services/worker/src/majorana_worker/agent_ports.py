"""Production ports for the framework-native circuit agent tools."""

from __future__ import annotations

import hashlib
import json
import signal
from dataclasses import replace
from typing import Any, Literal
from uuid import UUID, uuid4

from majorana_agent import (
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionFailureKind,
    ExecutionOutput,
    MaterializedArtifact,
    RepairInstruction,
    SemanticReviewEvidence,
    SemanticReviewOutput,
    StrictVerificationAttempt,
    VerificationOutput,
)
from majorana_contracts import Scope
from majorana_contracts.enums import (
    Algorithm,
    ArtifactType,
    ExportStatus,
    Framework,
    MeasurementPolicy,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationMethod,
    VerifierDecision,
    evidence_strength_of,
)
from majorana_contracts.plan import Plan
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
    BaselineProblemError,
    HamiltonianError,
    assess_evidence_sufficiency,
    energy_tolerance,
    extract_counts,
    ground_state_energy,
    objective_tolerance,
    optimal_objective,
    verify_brute_force,
    verify_bell_state_property,
    verify_exact_diag,
    verify_ghz_state_property,
    verify_native_sampled_counts,
    verify_native_statistical_counts,
    verify_return_contract,
    verify_statistical_counts_pair,
)
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from majorana_api.db import AsyncSession
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import runs as runs_repo


class LLMPlanner:
    # The Plan schema's own ceiling (PlanParameters.shots le=20000). The run API
    # accepts up to 1e6; a larger request is clamped rather than rejected, and
    # the clamp is visible in the plan the user gets back.
    _PLAN_SHOTS_CEILING = 20_000
    # The Plan schema's own ceiling (PlanParameters.seed le=2**31-1).
    _PLAN_SEED_CEILING = 2**31 - 1

    def __init__(
        self,
        *,
        llm: LLMClient,
        task_prompt: str,
        framework: Framework,
        requested_shots: int | None = None,
        requested_seed: int | None = None,
    ) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        self._framework = framework
        self._requested_shots = (
            min(requested_shots, self._PLAN_SHOTS_CEILING)
            if requested_shots is not None and requested_shots >= 1
            else None
        )
        # Out-of-range seeds are dropped rather than clamped: a clamped seed is a
        # DIFFERENT seed silently presented as the user's, which is the opposite
        # of what a seed is for. Shots clamp because 20000 shots still answers the
        # question 1e6 shots asked; seed 5 does not answer what seed 2**40 asked.
        self._requested_seed = (
            requested_seed
            if requested_seed is not None and 0 <= requested_seed <= self._PLAN_SEED_CEILING
            else None
        )

    # One retry, not a loop: the plan contract rejects self-contradictory plans
    # (see Plan._statistical_needs_distribution_evidence), and handing the planner
    # its own objection fixes those in one pass. More attempts would spend the
    # user's latency re-rolling the same temperature-0 output.
    _PLAN_ATTEMPTS = 2

    async def create_plan(self, _run_id: UUID) -> Plan:
        return await self._generate_plan()

    async def revise_plan(self, _run_id: UUID, previous: Plan, plan_defect_feedback: str) -> Plan:
        return await self._generate_plan(
            previous=previous,
            plan_defect_feedback=plan_defect_feedback,
        )

    async def _generate_plan(
        self,
        *,
        previous: Plan | None = None,
        plan_defect_feedback: str | None = None,
    ) -> Plan:
        objection: str | None = None
        for attempt in range(self._PLAN_ATTEMPTS):
            prompt = render_plan_prompt(
                self._task_prompt,
                requested_framework=self._framework,
                requested_shots=self._requested_shots,
                requested_seed=self._requested_seed,
            )
            user = prompt.user
            if previous is not None:
                user = (
                    f"{user}\n\nRevise this immutable prior Plan; do not edit it in place:\n"
                    f"{json.dumps(previous.model_dump(mode='json'), sort_keys=True)}\n\n"
                    f"Typed plan_defect feedback:\n{plan_defect_feedback}\n\n"
                    "Emit the complete next Plan revision. Preserve framework, seed, and shots."
                )
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
            if self._requested_shots is not None:
                # Enforced, not requested: runs submitted with shots=4096 were
                # silently planned at 1024 because nothing carried the value past
                # the run row. The plan rides into the generation context, so the
                # override reaches the emitted code; the statistical threshold is
                # computed from the shots actually observed either way.
                plan.parameters.shots = self._requested_shots
            elif previous is not None:
                plan.parameters.shots = previous.parameters.shots
            if self._requested_seed is not None:
                plan.parameters.seed = self._requested_seed
            elif previous is not None:
                plan.parameters.seed = previous.parameters.seed
            # After the shots override, because the tolerance depends on the
            # shots that will actually run.
            contradiction = self._exact_diag_range_contradiction(
                plan
            ) or self._brute_force_range_contradiction(plan)
            if contradiction is not None:
                if attempt == self._PLAN_ATTEMPTS - 1:
                    raise StageOutputError(contradiction)
                objection = contradiction
                continue
            return plan
        raise AssertionError("unreachable: loop returns or raises on the final attempt")

    @staticmethod
    def _exact_diag_range_contradiction(plan: Plan) -> str | None:
        """A plan whose success range cannot contain its own ground truth is
        unsatisfiable before any code exists.

        Live run 019f7f81-4a61 (weighted-MaxCut QAOA): the planner declared an
        Ising Hamiltonian (ground energy -4.5) and success_criteria demanding
        best_cut_weight in [5.5, 6.0]. exact_diag only passes a value within
        tolerance of -4.5, so the two checks could never both pass — the model
        reported the CORRECT max cut of 6.0 four times and burned the candidate
        budget. A cut weight is an affine transform of the Ising energy, not the
        energy; the planner pointed an energy check at a non-energy metric, and
        no code can repair a plan. Both numbers are plan-declared, so the
        contradiction is computable the moment the plan is parsed — one planner
        retry instead of a dead run, the same trade #90 made for `statistical`.

        Runs only here in the planner, never in the Plan model: a stored plan
        that predates this gate must keep rehydrating (standing lesson 15).
        """
        verification_plan = plan.verification_plan
        if verification_plan is None or VerificationMethod.EXACT_DIAG not in (
            verification_plan.methods or []
        ):
            return None
        terms = verification_plan.reference_hamiltonian
        expected_range = plan.success_criteria.expected_range
        if not terms or not expected_range:
            return None
        pairs = [(term.coefficient, term.pauli) for term in terms]
        try:
            exact = ground_state_energy(pairs)
            tolerance = energy_tolerance(pairs, plan.parameters.shots)
        except HamiltonianError:
            # Malformed Hamiltonians are the plan contract's beat; the verifier
            # also names them `fault: plan`. Not this gate's job.
            return None
        low = expected_range.get("min", float("-inf"))
        high = expected_range.get("max", float("inf"))
        if low <= exact + tolerance and exact - tolerance <= high:
            return None
        metric = plan.success_criteria.primary_metric
        return (
            f"unsatisfiable verification plan: exact_diag only passes a "
            f"{metric} within {tolerance:.6f} of the declared Hamiltonian's "
            f"ground-state energy {exact:.6f}, but success_criteria.expected_range "
            f"[{low}, {high}] contains no such value, so the two checks can never "
            "both pass. Either the promised metric is not the energy of the "
            "declared operator (a cut WEIGHT is not an Ising energy — drop "
            "exact_diag, or promise the energy itself as the primary metric and "
            "set the range around the ground-state energy), or the Hamiltonian or "
            "range is written wrong."
        )

    @staticmethod
    def _brute_force_range_contradiction(plan: Plan) -> str | None:
        """A plan whose success range cannot contain its instance's own optimum
        is unsatisfiable before any code exists.

        The combinatorial mirror of `_exact_diag_range_contradiction`, guarding
        the same failure shape from the other direction: `brute_force` only
        passes a value at the declared instance's true optimum, so an
        expected_range that excludes the optimum makes the two checks jointly
        unsatisfiable and the run burns its budget on correct code. Both numbers
        are plan-declared, so the contradiction is computable the moment the
        plan is parsed. Runs only here in the planner, never in the Plan model:
        a stored plan that predates this gate must keep rehydrating (standing
        lesson 15).
        """
        verification_plan = plan.verification_plan
        if verification_plan is None or VerificationMethod.BRUTE_FORCE not in (
            verification_plan.methods or []
        ):
            return None
        problem = verification_plan.reference_problem
        expected_range = plan.success_criteria.expected_range
        if problem is None or not expected_range:
            return None
        terms = [(term.i, term.j, term.weight) for term in problem.terms]
        try:
            optimum = optimal_objective(problem.kind, problem.num_variables, terms)
            tolerance = objective_tolerance(terms)
        except BaselineProblemError:
            # Malformed instances are the plan contract's beat; the verifier
            # also names them `fault: plan`. Not this gate's job.
            return None
        low = expected_range.get("min", float("-inf"))
        high = expected_range.get("max", float("inf"))
        if low <= optimum + tolerance and optimum - tolerance <= high:
            return None
        metric = plan.success_criteria.primary_metric
        objective_word = "maximum cut weight" if problem.kind == "maxcut" else "minimum QUBO value"
        return (
            f"unsatisfiable verification plan: brute_force only passes a {metric} "
            f"at the declared instance's true optimum — its {objective_word} is "
            f"{optimum:.6f} — but success_criteria.expected_range [{low}, {high}] "
            "does not contain that value, so the two checks can never both pass. "
            "Either the promised metric is not the objective of the declared "
            "instance, or the instance or range is written wrong. Set the range "
            "around the true optimum, fix the declared terms, or drop brute_force."
        )


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


def _measurement_policy_disagreement(
    policy: MeasurementPolicy, measurement_count: Any, observed_qubits: Any
) -> str:
    """One sentence naming what disagreed with the policy, and the edit that fixes it.

    Every branch names a replacement, because a rule with no substitute is not
    actionable (standing lesson 2).
    """
    if type(measurement_count) is not int:
        return (
            "the trusted observer recorded no measurement count for FINAL_CIRCUIT, so "
            "the policy could not be checked at all; bind FINAL_CIRCUIT to the actual "
            "circuit object at module scope"
        )
    if policy is MeasurementPolicy.NONE:
        return (
            f"the plan promises an unmeasured circuit but FINAL_CIRCUIT carries "
            f"{measurement_count} measurement(s); publish the bare circuit and do any "
            "sampling on a separate measured copy"
        )
    if policy is MeasurementPolicy.MEASURE_ALL:
        if measurement_count == 0:
            return (
                "FINAL_CIRCUIT carries no measurement at all, but the plan promises "
                f"every one of its {observed_qubits} qubits is measured; add "
                "measure_all() to the circuit you bind to FINAL_CIRCUIT, or bind the "
                "measured copy you actually sampled"
            )
        return (
            f"FINAL_CIRCUIT measures {measurement_count} of its {observed_qubits} "
            "qubits, but the plan promises all of them; measure the remaining qubits "
            "in the circuit you bind to FINAL_CIRCUIT"
        )
    return (
        f"FINAL_CIRCUIT's {measurement_count} measurement(s) do not satisfy policy {policy.value}"
    )


class _VerificationPrimitives:
    def __init__(self, *, llm: LLMClient | None, task_prompt: str) -> None:
        self._llm = llm
        self._task_prompt = task_prompt

    def fast_checks(
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
        resource_available = not circuit_expected or (
            isinstance(metrics, dict) and type(observed_qubits) is int
        )
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
                "result": (
                    "pass" if resource_ok else "fail" if resource_available else "unavailable"
                ),
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
                "observed_qubits": observed_qubits,
            }
            if metrics_error is not None:
                measurement_details["reason"] = metrics_error
            if not measurement_ok:
                # Standing lesson 12: the number names the symptom, a sentence names
                # the cause. "measurement_count: 0" against policy measure_all told
                # four VQE candidates nothing they could act on, and the run died on
                # candidate_budget_exhausted (019f7f2d-9504). The plan contract now
                # refuses that pairing up front, so reaching here means the CODE, not
                # the plan, disagrees with the policy — and the fix belongs in the
                # code. Failure only, and bounded.
                measurement_details["disagreement"] = _measurement_policy_disagreement(
                    policy, measurement_count, observed_qubits
                )
            checks.append(
                {
                    "method": "measurement_policy",
                    "result": (
                        "pass"
                        if measurement_ok
                        else "unavailable"
                        if type(measurement_count) is not int
                        else "fail"
                    ),
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
        expected_type = (
            plan.artifact_contract.expected_return_type if plan.artifact_contract else None
        )
        outcome = verify_return_contract(execution.result, plan.expected_output_keys, expected_type)
        checks.append(
            {
                "method": outcome.method.value,
                "result": outcome.result.value,
                "details": outcome.details,
            }
        )
        return checks

    def strict_checks(self, execution: ExecutionEvidence, plan: Plan) -> list[dict[str, Any]]:
        methods = list(plan.verification_plan.methods) if plan.verification_plan else []
        checks: list[dict[str, Any]] = [*self._state_property_checks(execution, plan)]
        for method in methods:
            if method is VerificationMethod.RETURN_CONTRACT:
                continue
            if method is VerificationMethod.EXACT:
                checks.append(
                    {
                        "method": method.value,
                        "result": "unavailable",
                        "details": {"reason": "Plan-authored QASM exact verification is retired"},
                    }
                )
                continue
            if method is VerificationMethod.STATISTICAL:
                checks.extend(self._statistical_checks(execution, plan))
                continue
            if method is VerificationMethod.EXACT_DIAG:
                checks.append(self._exact_diag_check(execution, plan))
                continue
            if method is VerificationMethod.BRUTE_FORCE:
                checks.append(self._brute_force_check(execution, plan))
                continue
            checks.append(
                {
                    "method": method.value,
                    "result": "unavailable",
                    "details": {"reason": "no trusted strict verifier is registered"},
                }
            )

        # Fixed policy may collect free framework-native evidence even when the
        # Plan did not request a statistical method. This never invokes QASM.
        if VerificationMethod.STATISTICAL not in methods:
            native_sampled = execution.observation.get("native_sampled")
            native_statevector = execution.observation.get("native_statevector")
            reported = extract_counts(execution.result, plan.expected_output_keys)
            thresholds = (
                plan.verification_plan.thresholds if plan.verification_plan else None
            ) or {}
            threshold = thresholds.get("tvd_max", thresholds.get("total_variation_max"))
            physical_check_ran = False
            if reported is not None and isinstance(native_statevector, dict):
                outcome = verify_native_statistical_counts(
                    native_statevector,
                    reported,
                    threshold,
                )
                physical_check_ran = True
                checks.append(
                    {
                        "method": outcome.method.value,
                        "result": outcome.result.value,
                        "details": outcome.details,
                    }
                )
            if reported is not None and isinstance(native_sampled, dict):
                outcome = verify_native_sampled_counts(
                    reported,
                    native_sampled,
                    threshold,
                )
                physical_check_ran = True
                checks.append(
                    {
                        "method": outcome.method.value,
                        "result": outcome.result.value,
                        "details": outcome.details,
                    }
                )
            if reported is not None and not physical_check_ran:
                checks.append(
                    {
                        "method": VerificationMethod.STATISTICAL.value,
                        "result": "unavailable",
                        "details": {
                            "reason": "reported counts lack trusted native comparison evidence",
                            "claim": "reported counts agree with the executed circuit",
                        },
                    }
                )
        return checks

    @staticmethod
    def _state_property_checks(execution: ExecutionEvidence, plan: Plan) -> list[dict[str, Any]]:
        if plan.algorithm not in {Algorithm.BELL, Algorithm.GHZ}:
            return []
        claim = plan.verification_plan.state_preparation_claim if plan.verification_plan else None
        method = (
            VerificationMethod.BELL_STATE_PROPERTY
            if plan.algorithm is Algorithm.BELL
            else VerificationMethod.GHZ_STATE_PROPERTY
        )
        if claim is None:
            return [
                {
                    "method": method.value,
                    "result": "unavailable",
                    "details": {
                        "reason": "no semantically accepted typed state-preparation claim",
                        "claim": f"{plan.algorithm.value} state preparation",
                    },
                }
            ]
        payload = execution.observation.get("native_statevector")
        if not isinstance(payload, dict):
            return [
                {
                    "method": method.value,
                    "result": "unavailable",
                    "details": {
                        "reason": "framework-native statevector evidence is unavailable",
                        "claim": (
                            f"accepted {plan.algorithm.value} target with relative phase "
                            f"{claim.relative_phase_radians} radians"
                        ),
                    },
                }
            ]
        outcome = (
            verify_bell_state_property(payload, claim.relative_phase_radians)
            if plan.algorithm is Algorithm.BELL
            else verify_ghz_state_property(
                payload,
                claim.qubits,
                claim.relative_phase_radians,
            )
        )
        return [
            {
                "method": outcome.method.value,
                "result": outcome.result.value,
                "details": outcome.details,
            }
        ]

    @staticmethod
    def _native_optimization_check(
        program: FrameworkProgram, execution: ExecutionEvidence
    ) -> dict[str, Any]:
        observed = execution.observation.get("native_optimization")
        if not isinstance(observed, dict) or type(observed.get("applied")) is not bool:
            return {
                "method": "native_optimization_evidence",
                "result": "unavailable",
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

    @staticmethod
    def _exact_diag_check(execution: ExecutionEvidence, plan: Plan) -> dict[str, Any]:
        """The reported energy against independent classical ground truth.

        The only check in the panel whose reference is neither the candidate's own
        circuit nor a re-execution of it, and therefore the only physical evidence
        a variational run can earn at all: a VQE reports a scalar, so `statistical`
        has no distribution and `exact` has no reference circuit.

        The plan contract has already guaranteed the Hamiltonian exists, is
        uniform, fits the diagonalizer, and that primary_metric is a promised key
        — so the only thing that can be absent here is the value the candidate was
        supposed to print, and that is genuinely a fact about the candidate.
        """
        verification_plan = plan.verification_plan
        terms = verification_plan.reference_hamiltonian if verification_plan else None
        if not terms:
            return {
                "method": VerificationMethod.EXACT_DIAG.value,
                "result": "fail",
                "details": {
                    "error": "required evidence unavailable",
                    "reason": "the plan listed exact_diag without a reference_hamiltonian",
                    "fault": "plan",
                },
            }
        thresholds = (verification_plan.thresholds if verification_plan else None) or {}
        metric = plan.success_criteria.primary_metric
        outcome = verify_exact_diag(
            [(term.coefficient, term.pauli) for term in terms],
            execution.result.get(metric),
            shots=plan.parameters.shots,
            # `thresholds` finally has a consumer beyond tvd_max. It may only
            # TIGHTEN the computed bound — see verify_exact_diag.
            declared_tolerance=thresholds.get(
                f"{metric}_error_max", thresholds.get("energy_error_max")
            ),
        )
        return {
            "method": outcome.method.value,
            "result": outcome.result.value,
            "details": outcome.details | {"metric": metric},
        }

    @staticmethod
    def _brute_force_check(execution: ExecutionEvidence, plan: Plan) -> dict[str, Any]:
        """The reported combinatorial objective against enumerated ground truth.

        The check that speaks a cut metric's own units — `exact_diag` grades
        energies, and pointing it at a cut weight is the category error #126 now
        refuses at plan time. The plan contract has already guaranteed the
        instance exists, its indices fit its variable count, and that
        primary_metric is a promised key — so the only thing that can be absent
        here is the value the candidate was supposed to print, and that is
        genuinely a fact about the candidate.
        """
        verification_plan = plan.verification_plan
        problem = verification_plan.reference_problem if verification_plan else None
        if problem is None:
            return {
                "method": VerificationMethod.BRUTE_FORCE.value,
                "result": "fail",
                "details": {
                    "error": "required evidence unavailable",
                    "reason": "the plan listed brute_force without a reference_problem",
                    "fault": "plan",
                },
            }
        metric = plan.success_criteria.primary_metric
        outcome = verify_brute_force(
            problem.kind,
            problem.num_variables,
            [(term.i, term.j, term.weight) for term in problem.terms],
            execution.result.get(metric),
        )
        return {
            "method": outcome.method.value,
            "result": outcome.result.value,
            "details": outcome.details | {"metric": metric},
        }

    @staticmethod
    def _statistical_checks(execution: ExecutionEvidence, plan: Plan) -> list[dict[str, Any]]:
        """Independent claims, reported separately.

        `statistical` is correctness: the reported counts against the Born
        distribution of the circuit that actually ran. The distribution comes
        from the framework's OWN simulator when the observer produced it
        (`native_statevector` — plans/framework-native-verification.md: no
        conversion in the trust path; three of the four defects in that family
        were conversion defects). Without native evidence this check is
        unavailable; interchange QASM is never a correctness fallback.

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
        checks: list[dict[str, Any]] = []
        physical_check_ran = False
        if reported is not None and isinstance(native_statevector, dict):
            outcome = verify_native_statistical_counts(native_statevector, reported, threshold)
            physical_check_ran = True
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
            physical_check_ran = True
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
        if not physical_check_ran:
            checks.append(
                {
                    "method": VerificationMethod.STATISTICAL.value,
                    "result": "unavailable",
                    "details": {
                        "error": "required evidence unavailable",
                        "reported_counts": reported is not None,
                        "native_statevector": isinstance(native_statevector, dict),
                        "native_sampled": isinstance(native_sampled, dict),
                        "repeat_execution": second is not None,
                    },
                }
            )
        return checks

    async def critic(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        checks: list[dict[str, Any]],
    ) -> _CriticOutput:
        if self._llm is None:
            raise RuntimeError("semantic reviewer requires an LLM client")
        request = LLMRequest(
            model=model_for("verify"),
            system=(
                "Act as an independent, fail-closed quantum-program critic. Judge request-to-plan, "
                "plan-to-code, and success-criteria-to-result alignment using only supplied evidence. "
                "Check the artifact contract, selected framework, measurement policy, seeds, shots, "
                "tolerances, qubit ordering, forbidden operations, required invariants, and whether "
                "the evidence actually proves each claim. A deterministic FAIL would have stopped "
                "before this review and cannot be overridden. SKIPPED and UNAVAILABLE mean that a "
                "check did not establish a defect. Return pass only with medium/high confidence, no "
                "mismatch, and at most minor severity. Use inconclusive for uncertainty or missing "
                "evidence; request repair or replan only for a clear semantic mismatch."
            ),
            user=json.dumps(
                {
                    "request": self._task_prompt,
                    "plan": plan.model_dump(mode="json"),
                    "framework": candidate.framework.value,
                    "source": candidate.source,
                    "execution": {
                        "execution_id": str(execution.execution_id),
                        "source_fingerprint": execution.source_fingerprint,
                        "environment_fingerprint": execution.environment_fingerprint,
                        "sandbox_provider": execution.sandbox_provider,
                        "exit_code": execution.exit_code,
                        "duration_ms": execution.duration_ms,
                        "result": execution.result,
                        "observation": {
                            key: execution.observation[key]
                            for key in (
                                "resource_metrics",
                                "native_optimization",
                                "evidence_error",
                                "contract_diagnostics",
                                "native_sampled",
                                "verification_repeat_result",
                            )
                            if key in execution.observation
                        },
                    },
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
            try:
                response = await self._llm.complete(request)
            except Exception as exc:
                last_error = exc
                continue
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


class SemanticReviewResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    decision: SemanticReviewDecision
    critic: dict[str, Any]
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget = RetryTarget.NONE
    reason_code: str
    repair: RepairInstruction | None = None


class FastCandidateChecker:
    """Trusted structural checks that never call an LLM or launch a simulation."""

    def __init__(self) -> None:
        self._primitives = _VerificationPrimitives(llm=None, task_prompt="")

    def check(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> list[dict[str, Any]]:
        if not (
            candidate.candidate_id == execution.candidate_id
            and candidate.source_fingerprint == execution.source_fingerprint
        ):
            return [
                {
                    "method": "structural",
                    "result": "fail",
                    "details": {"error": "candidate/execution fingerprint binding mismatch"},
                }
            ]
        return self._primitives.fast_checks(candidate, execution, plan)


class SemanticCandidateReviewer:
    """Evidence-reading LLM review. It cannot execute tools or produce final PASS."""

    def __init__(self, *, llm: LLMClient, task_prompt: str) -> None:
        self._primitives = _VerificationPrimitives(llm=llm, task_prompt=task_prompt)

    async def review(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        fast_checks: list[dict[str, Any]],
    ) -> SemanticReviewResult:
        critic = await self._primitives.critic(candidate, execution, plan, fast_checks)
        payload = critic.model_dump(mode="json")
        clean = (
            critic.decision is VerifierDecision.PASS
            and critic.confidence != "low"
            and critic.severity in {"none", "minor"}
            and not critic.failed_checks
            and not critic.mismatches
            and not critic.required_recheck
        )
        if clean:
            return SemanticReviewResult(
                decision=SemanticReviewDecision.READY,
                critic=payload,
                reason_code="semantic_ready",
            )
        if critic.failed_checks == ["critic_output_schema"]:
            return SemanticReviewResult(
                decision=SemanticReviewDecision.INCONCLUSIVE,
                critic=payload,
                failure_class=VerificationFailureClass.VERIFIER_FAILURE,
                retry_target=RetryTarget.VERIFICATION,
                reason_code="semantic_reviewer_failure",
            )
        if critic.confidence == "low":
            return SemanticReviewResult(
                decision=SemanticReviewDecision.INCONCLUSIVE,
                critic=payload,
                failure_class=VerificationFailureClass.EVIDENCE_GAP,
                retry_target=RetryTarget.VERIFICATION,
                reason_code="semantic_review_inconclusive",
            )
        if critic.decision is VerifierDecision.INCONCLUSIVE:
            return SemanticReviewResult(
                decision=SemanticReviewDecision.INCONCLUSIVE,
                critic=payload,
                failure_class=VerificationFailureClass.EVIDENCE_GAP,
                retry_target=RetryTarget.VERIFICATION,
                reason_code="semantic_evidence_gap",
            )
        if critic.decision is VerifierDecision.PASS:
            return SemanticReviewResult(
                decision=SemanticReviewDecision.INCONCLUSIVE,
                critic=payload,
                failure_class=VerificationFailureClass.EVIDENCE_GAP,
                retry_target=RetryTarget.VERIFICATION,
                reason_code="semantic_pass_requires_recheck",
            )
        if not critic.failed_checks and not critic.mismatches:
            return SemanticReviewResult(
                decision=SemanticReviewDecision.INCONCLUSIVE,
                critic=payload,
                failure_class=VerificationFailureClass.EVIDENCE_GAP,
                retry_target=RetryTarget.VERIFICATION,
                reason_code="semantic_mismatch_not_grounded",
            )

        plan_defect = self._is_plan_defect(critic)
        decision = (
            SemanticReviewDecision.REPLAN if plan_defect else SemanticReviewDecision.CODE_REPAIR
        )
        repair = RepairInstruction(
            category="plan_defect" if plan_defect else "intent_alignment_failed",
            severity=critic.severity,
            confidence=critic.confidence,
            evidence=[
                critic.summary,
                *critic.failed_checks,
                *(item.model_dump_json() for item in critic.mismatches),
            ],
            repairs=critic.repair_plan
            or critic.suggestions
            or [
                "Revise the Plan to match the request."
                if plan_defect
                else "Align the implementation with the accepted Plan."
            ],
            preserve_invariants=[f"framework={candidate.framework.value}", "assign RESULT"],
            required_rechecks=critic.required_recheck or ["all"],
        )
        return SemanticReviewResult(
            decision=decision,
            critic=payload,
            failure_class=(
                VerificationFailureClass.PLAN_DEFECT
                if plan_defect
                else VerificationFailureClass.CANDIDATE_DEFECT
            ),
            retry_target=RetryTarget.PLANNING if plan_defect else RetryTarget.CODE_GENERATION,
            reason_code="semantic_plan_mismatch" if plan_defect else "semantic_code_mismatch",
            repair=repair,
        )

    @staticmethod
    def _is_plan_defect(critic: _CriticOutput) -> bool:
        signals = [*critic.failed_checks, *(item.area for item in critic.mismatches)]
        normalized = " ".join(signals).lower().replace("_", "-")
        return "request-to-plan" in normalized or ("request" in normalized and "plan" in normalized)


class StrictEvidenceVerifier:
    """Trusted physical/problem-specific checks and final three-state aggregation."""

    def __init__(self) -> None:
        self._primitives = _VerificationPrimitives(llm=None, task_prompt="")

    def check(self, execution: ExecutionEvidence, plan: Plan) -> list[dict[str, Any]]:
        return self._primitives.strict_checks(execution, plan)

    def verify(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        semantic: SemanticReviewResult,
        prior_checks: list[dict[str, Any]],
    ) -> VerificationOutput:
        try:
            strict_checks = self.check(execution, plan)
        except Exception as exc:
            strict_checks = [
                {
                    "method": "structural",
                    "result": "error",
                    "details": {"error": type(exc).__name__, "reason": str(exc)[:1000]},
                }
            ]
        if semantic.decision is not SemanticReviewDecision.READY:
            for check in strict_checks:
                if (
                    check.get("method")
                    not in {
                        VerificationMethod.BELL_STATE_PROPERTY.value,
                        VerificationMethod.GHZ_STATE_PROPERTY.value,
                        VerificationMethod.EXACT_DIAG.value,
                        VerificationMethod.BRUTE_FORCE.value,
                    }
                    or check.get("result") != "fail"
                ):
                    continue
                check["result"] = "unavailable"
                check["details"] = {
                    **check.get("details", {}),
                    "reason": (
                        "Plan-declared target was not accepted by semantic review; "
                        "its mismatch cannot establish a candidate defect"
                    ),
                    "original_result": "fail",
                }
        checks = [*prior_checks, *strict_checks]
        failures = [check for check in checks if check["result"] == "fail"]
        if failures:
            plan_defect = all(check.get("details", {}).get("fault") == "plan" for check in failures)
            failure_class = (
                VerificationFailureClass.PLAN_DEFECT
                if plan_defect
                else VerificationFailureClass.CANDIDATE_DEFECT
            )
            retry_target = RetryTarget.PLANNING if plan_defect else RetryTarget.CODE_GENERATION
            return VerificationOutput(
                decision=VerifierDecision.FAIL,
                deterministic_checks=checks,
                critic=semantic.critic,
                repair=RepairInstruction(
                    category=(
                        "plan_defect" if plan_defect else "deterministic_verification_failed"
                    ),
                    severity="blocking",
                    confidence="high",
                    evidence=[json.dumps(check, sort_keys=True, default=str) for check in failures],
                    repairs=[
                        "Revise the accepted Plan."
                        if plan_defect
                        else "Repair the failing checks without changing the framework."
                    ],
                    preserve_invariants=[f"framework={candidate.framework.value}", "assign RESULT"],
                    required_rechecks=[check["method"] for check in failures],
                ),
                semantic_review_decision=semantic.decision,
                failure_class=failure_class,
                retry_target=retry_target,
                candidate_defect_observed=not plan_defect,
                reason_code="strict_plan_defect" if plan_defect else "strict_candidate_defect",
            )
        errors = [check for check in checks if check["result"] == "error"]
        unavailable = [check for check in checks if check["result"] == "unavailable"]
        if errors or unavailable or semantic.decision is SemanticReviewDecision.INCONCLUSIVE:
            return VerificationOutput(
                decision=VerifierDecision.INCONCLUSIVE,
                deterministic_checks=checks,
                critic=semantic.critic,
                semantic_review_decision=semantic.decision,
                failure_class=(
                    VerificationFailureClass.VERIFIER_FAILURE
                    if errors
                    else semantic.failure_class or VerificationFailureClass.EVIDENCE_GAP
                ),
                retry_target=(
                    RetryTarget.VERIFICATION
                    if errors
                    else semantic.retry_target
                    if semantic.decision is SemanticReviewDecision.INCONCLUSIVE
                    else RetryTarget.VERIFICATION
                ),
                candidate_defect_observed=False,
                reason_code="strict_verifier_error" if errors else "insufficient_evidence",
            )
        sufficiency = assess_evidence_sufficiency(
            plan.algorithm,
            checks,
            reported_counts=extract_counts(execution.result, plan.expected_output_keys) is not None,
        )
        if not sufficiency.sufficient:
            return VerificationOutput(
                decision=VerifierDecision.INCONCLUSIVE,
                deterministic_checks=checks,
                critic=semantic.critic,
                semantic_review_decision=semantic.decision,
                failure_class=(
                    VerificationFailureClass.EVIDENCE_GAP
                    if sufficiency.capability_supported
                    else VerificationFailureClass.CAPABILITY_LIMIT
                ),
                retry_target=RetryTarget.NONE,
                candidate_defect_observed=False,
                reason_code="strict_evidence_insufficient",
            )
        return VerificationOutput(
            decision=VerifierDecision.PASS,
            deterministic_checks=checks,
            critic=semantic.critic,
            semantic_review_decision=semantic.decision,
            retry_target=RetryTarget.NONE,
            candidate_defect_observed=False,
            reason_code="strict_pass",
        )


class EvidenceVerifier:
    """Compatibility facade; the state-machine split lands in a later step."""

    def __init__(self, *, llm: LLMClient, task_prompt: str) -> None:
        self._fast = FastCandidateChecker()
        self._semantic = SemanticCandidateReviewer(llm=llm, task_prompt=task_prompt)
        self._strict = StrictEvidenceVerifier()

    async def verify(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> VerificationOutput:
        fast_checks = self._fast.check(candidate, execution, plan)
        failures = [check for check in fast_checks if check["result"] == "fail"]
        if failures:
            return VerificationOutput(
                decision=VerifierDecision.FAIL,
                deterministic_checks=fast_checks,
                repair=RepairInstruction(
                    category="deterministic_verification_failed",
                    severity="blocking",
                    confidence="high",
                    evidence=[json.dumps(check, sort_keys=True, default=str) for check in failures],
                    repairs=["Repair the failing checks without changing the framework."],
                    preserve_invariants=[f"framework={candidate.framework.value}", "assign RESULT"],
                    required_rechecks=[check["method"] for check in failures],
                ),
                failure_class=VerificationFailureClass.CANDIDATE_DEFECT,
                retry_target=RetryTarget.CODE_GENERATION,
                candidate_defect_observed=True,
                reason_code="fast_candidate_defect",
            )
        semantic = await self._semantic.review(candidate, execution, plan, fast_checks)
        if semantic.decision in {
            SemanticReviewDecision.CODE_REPAIR,
            SemanticReviewDecision.REPLAN,
        }:
            return VerificationOutput(
                decision=VerifierDecision.FAIL,
                deterministic_checks=fast_checks,
                critic=semantic.critic,
                repair=semantic.repair,
                semantic_review_decision=semantic.decision,
                failure_class=semantic.failure_class,
                retry_target=semantic.retry_target,
                candidate_defect_observed=(semantic.decision is SemanticReviewDecision.CODE_REPAIR),
                reason_code=semantic.reason_code,
            )
        output = self._strict.verify(candidate, execution, plan, semantic, fast_checks)
        sufficiency = assess_evidence_sufficiency(
            plan.algorithm,
            output.deterministic_checks,
            reported_counts=extract_counts(execution.result, plan.expected_output_keys) is not None,
        )
        satisfied = set(sufficiency.satisfied_claims)
        return replace(
            output,
            claim_coverage=[
                {"claim": claim, "status": "verified" if claim in satisfied else "unverified"}
                for claim in sufficiency.required_claims
            ],
            unverified_claims=list(sufficiency.missing_claims),
        )


class EvidenceReviewer:
    """Semantic-review port used by the audited state machine."""

    def __init__(self, *, llm: LLMClient, task_prompt: str) -> None:
        self._fast = FastCandidateChecker()
        self._semantic = SemanticCandidateReviewer(llm=llm, task_prompt=task_prompt)

    async def review(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> SemanticReviewOutput:
        fast_checks = self._fast.check(candidate, execution, plan)
        failures = [check for check in fast_checks if check["result"] == "fail"]
        if failures:
            repair = RepairInstruction(
                category="deterministic_verification_failed",
                severity="blocking",
                confidence="high",
                evidence=[json.dumps(check, sort_keys=True, default=str) for check in failures],
                repairs=["Repair the failing checks without changing the framework."],
                preserve_invariants=[f"framework={candidate.framework.value}", "assign RESULT"],
                required_rechecks=[check["method"] for check in failures],
            )
            return SemanticReviewOutput(
                decision=SemanticReviewDecision.CODE_REPAIR,
                feedback={
                    "fast_checks": fast_checks,
                    "repair": repair.model_dump(mode="json"),
                },
                reason_code="fast_candidate_defect",
                failure_class=VerificationFailureClass.CANDIDATE_DEFECT,
                retry_target=RetryTarget.CODE_GENERATION,
                confidence="high",
                severity="blocking",
            )
        semantic = await self._semantic.review(candidate, execution, plan, fast_checks)
        return SemanticReviewOutput(
            decision=semantic.decision,
            feedback={
                "fast_checks": fast_checks,
                "critic": semantic.critic,
                "repair": semantic.repair.model_dump(mode="json") if semantic.repair else None,
            },
            reason_code=semantic.reason_code,
            failure_class=semantic.failure_class,
            retry_target=semantic.retry_target,
            confidence=(semantic.critic.get("confidence") if semantic.critic else None),
            severity=(semantic.critic.get("severity") if semantic.critic else None),
        )


class EvidenceStrictVerifier:
    """Strict deterministic port consuming immutable semantic-review evidence."""

    def __init__(self) -> None:
        self._fast = FastCandidateChecker()
        self._strict = StrictEvidenceVerifier()

    async def verify_strict(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        review: SemanticReviewEvidence,
    ) -> VerificationOutput:
        semantic = SemanticReviewResult(
            decision=review.decision,
            critic=review.feedback.get("critic") or {},
            failure_class=review.failure_class,
            retry_target=review.retry_target,
            reason_code=review.reason_code,
            repair=(
                RepairInstruction.model_validate(review.feedback["repair"])
                if review.feedback.get("repair")
                else None
            ),
        )
        fast_checks = self._fast.check(candidate, execution, plan)
        output = self._strict.verify(candidate, execution, plan, semantic, fast_checks)
        sufficiency = assess_evidence_sufficiency(
            plan.algorithm,
            output.deterministic_checks,
            reported_counts=extract_counts(execution.result, plan.expected_output_keys) is not None,
        )
        satisfied = set(sufficiency.satisfied_claims)
        return replace(
            output,
            claim_coverage=[
                {"claim": claim, "status": "verified" if claim in satisfied else "unverified"}
                for claim in sufficiency.required_claims
            ],
            unverified_claims=list(sufficiency.missing_claims),
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


class RepoArtifactMaterializer:
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

    async def materialize(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        verification: StrictVerificationAttempt,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
        plan: Plan,
    ) -> MaterializedArtifact:
        verification.assert_binding(candidate, execution, review)
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
        critic = review.feedback.get("critic")
        critic = critic if isinstance(critic, dict) else {}
        residual_risks = critic.get("residual_risks")
        residual_risks = (
            [str(item)[:1000] for item in residual_risks][:20]
            if isinstance(residual_risks, list)
            else []
        )
        limitations_list = list(dict.fromkeys([*residual_risks, *verification.unverified_claims]))
        limitations = "\n".join(limitations_list) or None
        strength = verification.evidence_strength or evidence_strength_of(verification.checks)
        checks = [
            {
                "method": check.get("method"),
                "result": check.get("result"),
                "details": check.get("details", {}),
            }
            for check in verification.checks
        ]
        failed_checks = [check for check in checks if check["result"] == "fail"]
        unavailable_checks = [
            check for check in checks if check["result"] in {"skipped", "unavailable", "error"}
        ]
        version = await artifacts_repo.create_version(
            self._scope,
            self._session,
            artifact_id,
            qasm_version="3.0" if qasm else None,
            qasm=qasm,
            metadata={
                "source": "agent_candidate",
                "candidate_id": str(candidate.candidate_id),
                "candidate_revision": candidate.revision,
                "source_fingerprint": candidate.source_fingerprint,
                "execution_id": str(execution.execution_id),
                "verification_attempt_id": str(verification.attempt_id),
                "semantic_review_id": str(review.review_id),
                "canonical_representation": "framework_code",
                "openqasm_role": "interchange" if qasm else "unavailable",
                "verification_summary": {
                    "verified": verification.decision is VerifierDecision.PASS,
                    "decision": verification.decision.value,
                    "evidence_strength": strength.value,
                    "reason_code": verification.reason_code,
                    "checks": checks,
                    "failed_checks": failed_checks,
                    "unavailable_checks": unavailable_checks,
                    "semantic_review": {
                        "decision": review.decision.value,
                        "reason_code": review.reason_code,
                        "confidence": review.confidence,
                        "severity": review.severity,
                        "summary": critic.get("summary"),
                    },
                    "residual_risks": residual_risks,
                    "unverified_claims": verification.unverified_claims,
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
        return MaterializedArtifact(
            artifact_id=artifact_id,
            version_id=version.id,
            version_seq=version.seq,
            candidate_id=candidate.candidate_id,
            framework=candidate.framework,
            source_fingerprint=candidate.source_fingerprint,
        )
