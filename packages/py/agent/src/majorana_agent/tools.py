"""Trusted implementations behind the model-visible circuit tools.

The model may propose source only to a selected-framework simulation tool.  Every
later tool resolves immutable records by candidate id, preventing source/result
substitution between execution, verification, conversion, and publication.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID, uuid4, uuid5

from majorana_agent.broker import ToolHandler, ToolPolicyError
from majorana_agent.models import (
    CandidateRevision,
    CandidateStatus,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionFailureKind,
    MaterializedArtifact,
    PlanRecord,
    PlanRevision,
    PublishedArtifact,
    RepairInstruction,
    SemanticReviewEvidence,
    StrictVerificationAttempt,
    ToolCall,
    ToolName,
    ToolResult,
    VerificationEvidence,
    _plan_fingerprint,
    authorizes_replan,
)
from majorana_agent.store import AgentStore
from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
    evidence_strength_of,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram


# The sandbox's captured stdout/stderr is persisted for humans, never shown to the
# model. It is output the generated code chose to write, so anything in it that reads
# like an instruction or like a result must not reach the loop that judges that code.
_CAPTURED_OUTPUT_KEYS = ("sandbox_stdout", "sandbox_stderr", "sandbox_output_truncated")


def _without_captured_output(observation: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in observation.items() if key not in _CAPTURED_OUTPUT_KEYS}


def _execution_failure_repair(evidence: ExecutionEvidence) -> tuple[dict[str, Any], RetryTarget]:
    """Turn a sandbox failure into bounded, actionable repair feedback."""
    kind = evidence.failure_kind or ExecutionFailureKind.CODE_ERROR
    observation = evidence.observation
    retry_target = (
        RetryTarget.PLANNING
        if kind is ExecutionFailureKind.RESOURCE_LIMIT
        else RetryTarget.CODE_GENERATION
    )
    repairs = {
        ExecutionFailureKind.TIMEOUT: [
            "Reduce repeated simulation, transpilation, or optimizer work so the program finishes within the sandbox timeout.",
            "Do not move an expensive simulator or transpile call into an objective evaluated repeatedly.",
        ],
        ExecutionFailureKind.MEMORY_EXHAUSTED: [
            "Reduce statevector, circuit, or intermediate-memory usage before submitting the next candidate.",
            "Avoid materializing unnecessary matrices or simulator results inside repeated evaluations.",
        ],
        ExecutionFailureKind.RESOURCE_LIMIT: [
            "Revise the Plan's resource requirements; the requested execution exceeds the sandbox lane before code can run.",
        ],
        ExecutionFailureKind.CODE_ERROR: [
            "Repair the framework code and submit a new candidate revision.",
        ],
    }[kind]
    evidence_items = [
        f"execution_failure_kind={kind.value}",
        f"sandbox_exit_code={evidence.exit_code}",
        f"sandbox_duration_ms={evidence.duration_ms}",
        *(str(item) for item in observation.get("contract_diagnostics", [])),
        str(observation.get("evidence_error", kind.value)),
        *([str(observation["sandbox_error"])[-2000:]] if observation.get("sandbox_error") else []),
        *(
            [
                f"estimated_memory_mb={observation['estimated_memory_mb']}",
                f"memory_limit_mb={observation['memory_limit_mb']}",
            ]
            if "estimated_memory_mb" in observation and "memory_limit_mb" in observation
            else []
        ),
    ]
    return (
        {
            "category": f"execution_{kind.value}",
            "evidence": evidence_items,
            "repairs": repairs,
            "retry_target": retry_target.value,
        },
        retry_target,
    )


class Planner(Protocol):
    async def create_plan(self, run_id: UUID) -> Plan: ...

    async def revise_plan(
        self, run_id: UUID, previous: Plan, plan_defect_feedback: str
    ) -> Plan: ...


@dataclass(frozen=True)
class ExecutionOutput:
    environment_fingerprint: str
    sandbox_provider: str
    exit_code: int
    duration_ms: int
    result: dict[str, Any]
    observation: dict[str, Any]
    failure_kind: ExecutionFailureKind | None = None


class CandidateExecutor(Protocol):
    async def run_candidate(self, candidate: CandidateRevision, plan: Plan) -> ExecutionOutput: ...


@dataclass(frozen=True)
class VerificationOutput:
    decision: VerifierDecision
    deterministic_checks: list[dict[str, Any]]
    critic: dict[str, Any] | None = None
    repair: RepairInstruction | None = None
    semantic_review_decision: SemanticReviewDecision | None = None
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget | None = None
    candidate_defect_observed: bool = False
    reason_code: str | None = None
    claim_coverage: list[dict[str, Any]] | None = None
    unverified_claims: list[str] | None = None
    verifier_version: str = "verification-v2"


@dataclass(frozen=True)
class SemanticReviewOutput:
    decision: SemanticReviewDecision
    feedback: dict[str, Any]
    reason_code: str
    retry_target: RetryTarget
    failure_class: VerificationFailureClass | None = None
    confidence: str | None = None
    severity: str | None = None


class CandidateVerifier(Protocol):
    async def verify(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> VerificationOutput: ...


class CandidateReviewer(Protocol):
    async def review(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
    ) -> SemanticReviewOutput: ...


class StrictCandidateVerifier(Protocol):
    async def verify_strict(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        review: SemanticReviewEvidence,
    ) -> VerificationOutput: ...


class OpenQASMConverter(Protocol):
    async def convert(
        self, candidate: CandidateRevision, execution: ExecutionEvidence
    ) -> tuple[str | None, str | None]: ...


class ArtifactPublisher(Protocol):
    async def publish(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        verification: VerificationEvidence,
        conversion: ConversionEvidence | None,
        plan: Plan,
    ) -> PublishedArtifact: ...


class ArtifactMaterializer(Protocol):
    async def materialize(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        verification: StrictVerificationAttempt,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
        plan: Plan,
    ) -> MaterializedArtifact: ...


class CircuitToolset:
    def __init__(
        self,
        *,
        store: AgentStore,
        framework: Framework,
        planner: Planner,
        executor: CandidateExecutor,
        verifier: CandidateVerifier | None = None,
        reviewer: CandidateReviewer | None = None,
        strict_verifier: StrictCandidateVerifier | None = None,
        converter: OpenQASMConverter,
        materializer: ArtifactMaterializer,
    ) -> None:
        self._store = store
        self._framework = framework
        self._planner = planner
        self._executor = executor
        self._verifier = verifier
        self._reviewer = reviewer
        self._strict_verifier = strict_verifier
        self._converter = converter
        self._materializer = materializer

    def handlers(self) -> dict[ToolName, ToolHandler]:
        return {
            ToolName.REQUEST_PLAN: self.request_plan,
            ToolName.REPLAN: self.replan,
            ToolName.SIMULATE_QISKIT: self.simulate,
            ToolName.SIMULATE_CIRQ: self.simulate,
            ToolName.SIMULATE_PENNYLANE: self.simulate,
            ToolName.VERIFY_INTENT_ALIGNMENT: self.verify,
            ToolName.REVIEW_CANDIDATE: self.review_candidate,
            ToolName.STRICT_VERIFY: self.strict_verify,
            ToolName.CONVERT_TO_OPENQASM: self.convert,
            ToolName.MATERIALIZE_ARTIFACT: self.materialize,
        }

    async def request_plan(self, run_id: UUID, _call: ToolCall) -> dict[str, Any]:
        existing = await self._store.current_plan_revision(run_id)
        if existing is not None:
            return {
                "plan_id": str(existing.plan_id),
                "revision": existing.revision,
                "plan": existing.plan.model_dump(mode="json"),
            }
        try:
            plan = await self._planner.create_plan(run_id)
        except Exception as exc:
            raise ToolPolicyError(
                "plan_attempt_failed", f"planner failed: {type(exc).__name__}: {str(exc)[:1000]}"
            ) from exc
        if plan.framework is not self._framework:
            raise ToolPolicyError(
                "framework_mismatch", "planner changed the user-selected framework"
            )
        record = PlanRecord(plan_id=uuid4(), run_id=run_id, plan=plan)
        await self._store.add_plan(record)
        return {
            "plan_id": str(record.plan_id),
            "revision": 1,
            "plan": plan.model_dump(mode="json"),
        }

    async def replan(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        current = await self._store.current_plan_revision(run_id)
        if current is None:
            raise ToolPolicyError("plan_missing", "replan requires a current Plan revision")
        feedback = self._plan_defect_feedback(await self._store.list_tool_results(run_id))
        plan_id = uuid5(run_id, f"majorana:replan:{call.tool_call_id}")
        try:
            existing = await self._store.plan_revision(run_id, plan_id)
        except KeyError:
            existing = None
        if existing is None:
            try:
                plan = await self._planner.revise_plan(run_id, current.plan, feedback)
            except Exception as exc:
                raise ToolPolicyError(
                    "plan_attempt_failed",
                    f"planner failed: {type(exc).__name__}: {str(exc)[:1000]}",
                ) from exc
            self._assert_replan_invariants(current.plan, plan)
            existing = PlanRevision(
                plan_id=plan_id,
                run_id=run_id,
                revision=current.revision + 1,
                parent_plan_id=current.plan_id,
                plan=plan,
                plan_fingerprint=_plan_fingerprint(plan),
                replan_reason=feedback,
            )
            await self._store.append_plan_revision(existing)
        elif existing.plan_id == current.plan_id:
            pass
        elif existing.parent_plan_id != current.plan_id:
            raise ToolPolicyError(
                "stale_plan_replay", "replayed replan no longer extends the current Plan"
            )
        await self._store.select_current_plan(run_id, existing.plan_id)
        return {
            "plan_id": str(existing.plan_id),
            "revision": existing.revision,
            "parent_plan_id": str(existing.parent_plan_id),
            "replan_reason": existing.replan_reason,
            "plan": existing.plan.model_dump(mode="json"),
        }

    @staticmethod
    def _plan_defect_feedback(results: list[ToolResult]) -> str:
        result = next(
            (item for item in reversed(results) if authorizes_replan(item)),
            None,
        )
        if result is None:
            raise ToolPolicyError(
                "replan_not_authorized", "replan requires typed plan_defect feedback"
            )
        reason = result.payload.get("reason_code") or result.payload.get(
            "failure_kind", "semantic_plan_defect"
        )
        repair = result.payload.get("repair")
        if repair is None and isinstance(result.payload.get("feedback"), dict):
            repair = result.payload["feedback"].get("repair")
        return json.dumps(
            {"reason_code": reason, "repair": repair},
            default=str,
            sort_keys=True,
        )[:2000]

    @staticmethod
    def _assert_replan_invariants(previous: Plan, revised: Plan) -> None:
        if revised.framework is not previous.framework:
            raise ToolPolicyError(
                "framework_mismatch", "replan changed the user-selected framework"
            )
        if revised.parameters.seed != previous.parameters.seed:
            raise ToolPolicyError("seed_mismatch", "replan changed the requested seed")
        if revised.parameters.shots != previous.parameters.shots:
            raise ToolPolicyError("shots_mismatch", "replan changed the requested shots")

    async def simulate(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        source = call.arguments.get("source")
        if not isinstance(source, str) or not source.strip():
            raise ToolPolicyError("invalid_arguments", "source must be non-empty framework code")
        plan_record = await self._store.current_plan_revision(run_id)
        if plan_record is None:
            raise ToolPolicyError("plan_missing", "simulation requires a stored plan")
        candidate = await self._store.candidate_for_tool_call(run_id, call.tool_call_id)
        if candidate is None:
            previous = await self._store.latest_candidate(run_id)
            program = FrameworkProgram(framework=self._framework, source=source)
            candidate = CandidateRevision(
                candidate_id=uuid4(),
                run_id=run_id,
                tool_call_id=call.tool_call_id,
                revision=1 if previous is None else previous.revision + 1,
                parent_candidate_id=previous.candidate_id if previous else None,
                plan_id=plan_record.plan_id,
                framework=self._framework,
                source=program.normalized_source,
                source_fingerprint=program.fingerprint,
            )
            await self._store.add_candidate(candidate)
        evidence = await self._store.execution_for(run_id, candidate.candidate_id)
        if evidence is None:
            output = await self._executor.run_candidate(candidate, plan_record.plan)
            evidence = ExecutionEvidence(
                execution_id=uuid4(),
                candidate_id=candidate.candidate_id,
                source_fingerprint=candidate.source_fingerprint,
                environment_fingerprint=output.environment_fingerprint,
                sandbox_provider=output.sandbox_provider,
                exit_code=output.exit_code,
                failure_kind=output.failure_kind,
                duration_ms=output.duration_ms,
                result=output.result,
                observation=output.observation,
            )
            await self._store.add_execution(evidence)
        status = (
            CandidateStatus.EXECUTED
            if evidence.succeeded
            else CandidateStatus.RESOURCE_EXHAUSTED
            if evidence.resource_exhausted
            else CandidateStatus.REPAIR_REQUIRED
        )
        await self._store.set_candidate_status(
            run_id,
            candidate.candidate_id,
            status.value,
        )
        if not evidence.succeeded:
            repair, retry_target = _execution_failure_repair(evidence)
            return {
                "candidate_id": str(candidate.candidate_id),
                "revision": candidate.revision,
                "source_fingerprint": candidate.source_fingerprint,
                "execution_id": str(evidence.execution_id),
                "execution_ok": False,
                "resource_exhausted": evidence.resource_exhausted,
                "failure_kind": evidence.failure_kind.value,
                "sandbox_runs": evidence.observation.get("sandbox_runs", 1),
                "retry_target": retry_target.value,
                "repair": repair,
            }
        return {
            "candidate_id": str(candidate.candidate_id),
            "revision": candidate.revision,
            "plan_id": str(candidate.plan_id),
            "source_fingerprint": candidate.source_fingerprint,
            "execution_id": str(evidence.execution_id),
            "execution_ok": True,
            "sandbox_runs": evidence.observation.get("sandbox_runs", 1),
            "result_keys": sorted(str(key) for key in evidence.result)[:100],
        }

    async def verify(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        if self._verifier is None:
            raise ToolPolicyError(
                "legacy_tool_unavailable", "use review_candidate then strict_verify"
            )
        candidate = await self._bound_candidate(run_id, call.arguments)
        execution = await self._store.execution_for(run_id, candidate.candidate_id)
        if execution is None or not execution.succeeded:
            raise ToolPolicyError("execution_missing", "verification requires successful execution")
        if execution.source_fingerprint != candidate.source_fingerprint:
            raise ToolPolicyError("fingerprint_mismatch", "execution source differs from candidate")
        semantic_review_decision: SemanticReviewDecision | None = None
        reason_code: str | None = None
        evidence = await self._store.verification_for(run_id, candidate.candidate_id)
        if evidence is None:
            plan_record = await self._store.plan(run_id, candidate.plan_id)
            output = await self._verifier.verify(candidate, execution, plan_record.plan)
            semantic_review_decision = output.semantic_review_decision
            reason_code = output.reason_code
            repair = output.repair
            if repair is not None and (
                output.failure_class is not None or output.retry_target is not None
            ):
                repair = repair.model_copy(
                    update={
                        "failure_class": output.failure_class,
                        "retry_target": output.retry_target,
                    }
                )
            evidence = VerificationEvidence(
                verification_id=uuid4(),
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                decision=output.decision,
                deterministic_checks=output.deterministic_checks,
                critic=output.critic,
                repair=repair,
            )
            await self._store.add_verification(evidence)
        await self._store.set_candidate_status(
            run_id,
            candidate.candidate_id,
            CandidateStatus.VERIFIED.value
            if evidence.decision is VerifierDecision.PASS
            else CandidateStatus.REPAIR_REQUIRED.value,
        )
        return {
            "candidate_id": str(candidate.candidate_id),
            "verification_id": str(evidence.verification_id),
            "decision": evidence.decision.value,
            "repair": evidence.repair.model_dump(mode="json") if evidence.repair else None,
            "semantic_review_decision": (
                semantic_review_decision.value if semantic_review_decision is not None else None
            ),
            "failure_class": (
                evidence.repair.failure_class.value
                if evidence.repair and evidence.repair.failure_class
                else None
            ),
            "retry_target": (
                evidence.repair.retry_target.value
                if evidence.repair and evidence.repair.retry_target
                else None
            ),
            "reason_code": reason_code,
        }

    async def review_candidate(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        if self._reviewer is None:
            raise ToolPolicyError("reviewer_unavailable", "semantic reviewer is unavailable")
        candidate = await self._bound_candidate(run_id, call.arguments)
        execution = await self._store.execution_for(run_id, candidate.candidate_id)
        if execution is None or not execution.succeeded:
            raise ToolPolicyError("execution_missing", "semantic review requires execution")
        if execution.source_fingerprint != candidate.source_fingerprint:
            raise ToolPolicyError("fingerprint_mismatch", "execution source differs from candidate")
        attempt_id = uuid5(run_id, f"majorana:semantic-review:{call.tool_call_id}")
        latest = await self._store.latest_semantic_review(run_id, candidate.candidate_id)
        if latest is not None and latest.review_id == attempt_id:
            evidence = latest
        else:
            plan = await self._store.plan(run_id, candidate.plan_id)
            try:
                output = await self._reviewer.review(candidate, execution, plan.plan)
            except Exception as exc:
                output = SemanticReviewOutput(
                    decision=SemanticReviewDecision.INCONCLUSIVE,
                    feedback={"error": f"{type(exc).__name__}: {str(exc)[:1000]}"},
                    reason_code="semantic_reviewer_failure",
                    failure_class=VerificationFailureClass.VERIFIER_FAILURE,
                    retry_target=RetryTarget.VERIFICATION,
                )
            evidence = SemanticReviewEvidence(
                review_id=attempt_id,
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                attempt_seq=1 if latest is None else latest.attempt_seq + 1,
                decision=output.decision,
                confidence=output.confidence,
                severity=output.severity,
                reason_code=output.reason_code,
                failure_class=output.failure_class,
                retry_target=output.retry_target,
                feedback=output.feedback,
            )
            await self._store.append_semantic_review(evidence)
        status = (
            CandidateStatus.REPAIR_REQUIRED
            if evidence.decision
            in {SemanticReviewDecision.CODE_REPAIR, SemanticReviewDecision.REPLAN}
            else CandidateStatus.REVIEWED
        )
        await self._store.set_candidate_status(run_id, candidate.candidate_id, status.value)
        return {
            "candidate_id": str(candidate.candidate_id),
            "execution_id": str(execution.execution_id),
            "review_id": str(evidence.review_id),
            "attempt_seq": evidence.attempt_seq,
            "source_fingerprint": evidence.source_fingerprint,
            "decision": evidence.decision.value,
            "reason_code": evidence.reason_code,
            "failure_class": evidence.failure_class.value if evidence.failure_class else None,
            "retry_target": evidence.retry_target.value,
            "feedback": evidence.feedback,
        }

    async def strict_verify(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        if self._strict_verifier is None:
            raise ToolPolicyError("strict_verifier_unavailable", "strict verifier is unavailable")
        candidate = await self._bound_candidate(run_id, call.arguments)
        execution = await self._store.execution_for(run_id, candidate.candidate_id)
        review = await self._store.latest_semantic_review(run_id, candidate.candidate_id)
        if execution is None or review is None:
            raise ToolPolicyError(
                "review_missing", "strict verification requires execution and semantic review"
            )
        review.assert_binding(candidate, execution)
        attempt_id = uuid5(run_id, f"majorana:strict-verification:{call.tool_call_id}")
        latest = await self._store.latest_strict_verification(run_id, candidate.candidate_id)
        if latest is not None and latest.attempt_id == attempt_id:
            attempt = latest
        else:
            plan = await self._store.plan(run_id, candidate.plan_id)
            try:
                output = await self._strict_verifier.verify_strict(
                    candidate, execution, plan.plan, review
                )
                if (
                    review.decision is SemanticReviewDecision.INCONCLUSIVE
                    and output.decision is VerifierDecision.PASS
                ):
                    output = VerificationOutput(
                        decision=VerifierDecision.INCONCLUSIVE,
                        deterministic_checks=output.deterministic_checks,
                        critic=output.critic,
                        semantic_review_decision=review.decision,
                        failure_class=(
                            review.failure_class or VerificationFailureClass.EVIDENCE_GAP
                        ),
                        retry_target=(
                            review.retry_target
                            if review.retry_target is not RetryTarget.NONE
                            else RetryTarget.VERIFICATION
                        ),
                        reason_code="semantic_uncertainty_prevents_pass",
                        claim_coverage=output.claim_coverage,
                        unverified_claims=output.unverified_claims,
                        verifier_version=output.verifier_version,
                    )
            except Exception as exc:
                output = VerificationOutput(
                    decision=VerifierDecision.INCONCLUSIVE,
                    deterministic_checks=[
                        {
                            "method": "structural",
                            "result": "error",
                            "details": {
                                "check_kind": "strict_verifier",
                                "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
                            },
                        }
                    ],
                    failure_class=VerificationFailureClass.VERIFIER_FAILURE,
                    retry_target=RetryTarget.VERIFICATION,
                    reason_code="strict_verifier_error",
                )
            attempt = StrictVerificationAttempt(
                attempt_id=attempt_id,
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                semantic_review_id=review.review_id,
                source_fingerprint=candidate.source_fingerprint,
                attempt_seq=1 if latest is None else latest.attempt_seq + 1,
                checks=output.deterministic_checks,
                decision=output.decision,
                evidence_strength=evidence_strength_of(output.deterministic_checks),
                claim_coverage=output.claim_coverage or [],
                reason_code=output.reason_code or "strict_verification_complete",
                candidate_defect_observed=output.candidate_defect_observed,
                failure_class=output.failure_class,
                retry_target=output.retry_target or RetryTarget.NONE,
                unverified_claims=output.unverified_claims or [],
                verifier_version=output.verifier_version,
            )
            await self._store.append_strict_verification(attempt)
        if attempt.decision is VerifierDecision.PASS:
            legacy = await self._store.verification_for(run_id, candidate.candidate_id)
            if legacy is None:
                await self._store.add_verification(
                    VerificationEvidence(
                        verification_id=attempt.attempt_id,
                        candidate_id=candidate.candidate_id,
                        execution_id=execution.execution_id,
                        source_fingerprint=candidate.source_fingerprint,
                        decision=VerifierDecision.PASS,
                        deterministic_checks=attempt.checks,
                    )
                )
            await self._store.set_candidate_status(
                run_id, candidate.candidate_id, CandidateStatus.VERIFIED.value
            )
        elif attempt.decision is VerifierDecision.INCONCLUSIVE:
            await self._store.set_candidate_status(
                run_id, candidate.candidate_id, CandidateStatus.INCONCLUSIVE.value
            )
        elif attempt.retry_target in {RetryTarget.CODE_GENERATION, RetryTarget.PLANNING}:
            await self._store.set_candidate_status(
                run_id, candidate.candidate_id, CandidateStatus.REPAIR_REQUIRED.value
            )
        actionable_checks = [
            check
            for check in attempt.checks
            if check.get("result") in {"fail", "unavailable", "error"}
        ][:50]
        return {
            "candidate_id": str(candidate.candidate_id),
            "execution_id": str(execution.execution_id),
            "review_id": str(review.review_id),
            "attempt_id": str(attempt.attempt_id),
            "attempt_seq": attempt.attempt_seq,
            "source_fingerprint": attempt.source_fingerprint,
            "decision": attempt.decision.value,
            "evidence_strength": (
                attempt.evidence_strength.value if attempt.evidence_strength else None
            ),
            "reason_code": attempt.reason_code,
            "failure_class": attempt.failure_class.value if attempt.failure_class else None,
            "retry_target": attempt.retry_target.value,
            "candidate_defect_observed": attempt.candidate_defect_observed,
            "check_summaries": actionable_checks,
            "repair": (
                {
                    "category": attempt.failure_class.value,
                    "evidence": [
                        json.dumps(check, sort_keys=True, default=str)[:2000]
                        for check in actionable_checks
                    ],
                    "repairs": [
                        "Revise the Plan."
                        if attempt.retry_target is RetryTarget.PLANNING
                        else "Repair the candidate and submit a new source revision."
                    ],
                }
                if attempt.decision is VerifierDecision.FAIL
                else None
            ),
        }

    async def convert(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        candidate = await self._bound_candidate(run_id, call.arguments)
        # strict_verify is a certification badge, never a gate — conversion is a
        # mechanical export, not a correctness claim, so it only needs the LLM's
        # READY semantic review regardless of what (if anything) strict_verify found.
        review = await self._store.latest_semantic_review(run_id, candidate.candidate_id)
        if review is None or review.decision is not SemanticReviewDecision.READY:
            raise ToolPolicyError(
                "candidate_not_convertible",
                "conversion requires a READY semantic review",
            )
        expected_execution_id = review.execution_id
        expected_fingerprint = review.source_fingerprint
        execution = await self._store.execution_for(run_id, candidate.candidate_id)
        if execution is None:
            raise ToolPolicyError("execution_missing", "conversion requires execution evidence")
        if not (
            expected_execution_id == execution.execution_id
            and expected_fingerprint == execution.source_fingerprint == candidate.source_fingerprint
        ):
            raise ToolPolicyError(
                "fingerprint_mismatch", "conversion evidence is not bound to this execution"
            )
        evidence = await self._store.conversion_for(run_id, candidate.candidate_id)
        if evidence is None:
            qasm, reason = await self._converter.convert(candidate, execution)
            evidence = ConversionEvidence(
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                status="available" if qasm else "unavailable",
                qasm=qasm,
                reason=reason,
            )
            await self._store.add_conversion(evidence)
        elif not (
            evidence.execution_id == execution.execution_id
            and evidence.source_fingerprint == candidate.source_fingerprint
        ):
            raise ToolPolicyError(
                "fingerprint_mismatch", "stored conversion is bound to stale evidence"
            )
        return evidence.model_dump(mode="json", exclude={"qasm"})

    async def materialize(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        candidate = await self._bound_candidate(run_id, call.arguments)
        # strict_verify is a certification badge on an already-materializable
        # candidate, not a gate — review_candidate (the LLM, namekoQ-style) is
        # the sole authority on whether this goes back to the user. Whatever
        # strict_verify found (PASS/INCONCLUSIVE/FAIL/never attempted) rides
        # along as the badge below; none of those outcomes block materialization.
        verification = await self._store.latest_strict_verification(run_id, candidate.candidate_id)
        materialization = await self._store.materialization_for(run_id, candidate.candidate_id)
        if materialization is None:
            execution = await self._store.execution_for(run_id, candidate.candidate_id)
            if execution is None or not execution.succeeded:
                raise ToolPolicyError(
                    "execution_missing", "materialization requires successful execution evidence"
                )
            if execution.source_fingerprint != candidate.source_fingerprint:
                raise ToolPolicyError(
                    "fingerprint_mismatch", "executed source differs from candidate"
                )
            review = await self._store.latest_semantic_review(run_id, candidate.candidate_id)
            if review is None:
                raise ToolPolicyError(
                    "review_missing", "materialization requires semantic review evidence"
                )
            if verification is None:
                if review.decision is not SemanticReviewDecision.READY:
                    raise ToolPolicyError(
                        "candidate_not_materializable",
                        "private materialization requires a READY semantic review "
                        "or a strict PASS/INCONCLUSIVE verification",
                    )
                # namekoQ-style path: a READY semantic review is enough to hand
                # the circuit back to the user. Record that explicitly as an
                # unattempted (not failed) strict verification rather than
                # inventing evidence that was never gathered — the artifact is
                # stored exactly like today's INCONCLUSIVE materialization: usable,
                # editable, simulatable, and disclosed as not strictly verified.
                verification = StrictVerificationAttempt(
                    attempt_id=uuid5(
                        run_id, f"majorana:strict-verification-unattempted:{candidate.candidate_id}"
                    ),
                    candidate_id=candidate.candidate_id,
                    execution_id=execution.execution_id,
                    semantic_review_id=review.review_id,
                    source_fingerprint=candidate.source_fingerprint,
                    attempt_seq=1,
                    checks=[],
                    decision=VerifierDecision.INCONCLUSIVE,
                    evidence_strength=None,
                    claim_coverage=[],
                    reason_code="strict_verification_not_attempted",
                    candidate_defect_observed=False,
                    failure_class=None,
                    retry_target=RetryTarget.NONE,
                    unverified_claims=[],
                    verifier_version="unattempted",
                )
            try:
                verification.assert_binding(candidate, execution, review)
            except ValueError as exc:
                raise ToolPolicyError("fingerprint_mismatch", str(exc)) from exc
            conversion = await self._store.conversion_for(run_id, candidate.candidate_id)
            if conversion is not None and not (
                conversion.execution_id == execution.execution_id
                and conversion.source_fingerprint == candidate.source_fingerprint
            ):
                raise ToolPolicyError(
                    "fingerprint_mismatch", "conversion is bound to stale evidence"
                )
            if conversion is None:
                # Conversion is a mechanical export, not a judgment call — an
                # artifact must never lose its interchange QASM because the
                # model skipped the convert tool. Observed live on run
                # 019f8eca-af7c: a verified Bell artifact stored "framework
                # only" while its observation held the emitted QASM all along.
                qasm, reason = await self._converter.convert(candidate, execution)
                conversion = ConversionEvidence(
                    candidate_id=candidate.candidate_id,
                    execution_id=execution.execution_id,
                    source_fingerprint=candidate.source_fingerprint,
                    status="available" if qasm else "unavailable",
                    qasm=qasm,
                    reason=reason,
                )
                await self._store.add_conversion(conversion)
            plan = (await self._store.plan(run_id, candidate.plan_id)).plan
            materialization = await self._materializer.materialize(
                candidate, execution, verification, review, conversion, plan
            )
            if materialization.candidate_id != candidate.candidate_id:
                raise ToolPolicyError(
                    "materialization_mismatch", "materializer returned a different candidate"
                )
            if materialization.source_fingerprint != candidate.source_fingerprint:
                raise ToolPolicyError(
                    "fingerprint_mismatch", "materialized source differs from candidate"
                )
            await self._store.add_materialization(materialization)
        await self._store.set_candidate_status(
            run_id, candidate.candidate_id, CandidateStatus.MATERIALIZED.value
        )
        return materialization.model_dump(mode="json")

    async def _bound_candidate(self, run_id: UUID, arguments: dict[str, Any]) -> CandidateRevision:
        try:
            candidate_id = UUID(str(arguments["candidate_id"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ToolPolicyError("invalid_arguments", "candidate_id must be a UUID") from exc
        return await self._store.candidate(run_id, candidate_id)
