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
    PlanRecord,
    PlanRevision,
    PublishedArtifact,
    RepairInstruction,
    ToolCall,
    ToolName,
    ToolResult,
    VerificationEvidence,
    _plan_fingerprint,
)
from majorana_agent.store import AgentStore
from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram


# The sandbox's captured stdout/stderr is persisted for humans, never shown to the
# model. It is output the generated code chose to write, so anything in it that reads
# like an instruction or like a result must not reach the loop that judges that code.
_CAPTURED_OUTPUT_KEYS = ("sandbox_stdout", "sandbox_stderr", "sandbox_output_truncated")


def _without_captured_output(observation: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in observation.items() if key not in _CAPTURED_OUTPUT_KEYS}


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


class CandidateVerifier(Protocol):
    async def verify(
        self, candidate: CandidateRevision, execution: ExecutionEvidence, plan: Plan
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


class CircuitToolset:
    def __init__(
        self,
        *,
        store: AgentStore,
        framework: Framework,
        planner: Planner,
        executor: CandidateExecutor,
        verifier: CandidateVerifier,
        converter: OpenQASMConverter,
        publisher: ArtifactPublisher,
    ) -> None:
        self._store = store
        self._framework = framework
        self._planner = planner
        self._executor = executor
        self._verifier = verifier
        self._converter = converter
        self._publisher = publisher

    def handlers(self) -> dict[ToolName, ToolHandler]:
        return {
            ToolName.REQUEST_PLAN: self.request_plan,
            ToolName.REPLAN: self.replan,
            ToolName.SIMULATE_QISKIT: self.simulate,
            ToolName.SIMULATE_CIRQ: self.simulate,
            ToolName.SIMULATE_PENNYLANE: self.simulate,
            ToolName.VERIFY_INTENT_ALIGNMENT: self.verify,
            ToolName.CONVERT_TO_OPENQASM: self.convert,
            ToolName.PUBLISH_ARTIFACT: self.publish,
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
            (
                item
                for item in reversed(results)
                if item.ok
                and item.name is ToolName.VERIFY_INTENT_ALIGNMENT
                and item.payload.get("failure_class") == VerificationFailureClass.PLAN_DEFECT.value
                and item.payload.get("retry_target") == RetryTarget.PLANNING.value
            ),
            None,
        )
        if result is None:
            raise ToolPolicyError(
                "replan_not_authorized", "replan requires typed plan_defect feedback"
            )
        reason = result.payload.get("reason_code") or "semantic_plan_defect"
        repair = result.payload.get("repair")
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
            if evidence.resource_exhausted:
                return {
                    "candidate_id": str(candidate.candidate_id),
                    "revision": candidate.revision,
                    "source_fingerprint": candidate.source_fingerprint,
                    "execution_id": str(evidence.execution_id),
                    "execution_ok": False,
                    "resource_exhausted": True,
                    "failure_kind": evidence.failure_kind.value,
                    "sandbox_runs": evidence.observation.get("sandbox_runs", 0),
                    "resource_evidence": _without_captured_output(evidence.observation),
                }
            return {
                "candidate_id": str(candidate.candidate_id),
                "revision": candidate.revision,
                "source_fingerprint": candidate.source_fingerprint,
                "execution_id": str(evidence.execution_id),
                "execution_ok": False,
                "resource_exhausted": False,
                "failure_kind": evidence.failure_kind.value,
                "sandbox_runs": evidence.observation.get("sandbox_runs", 1),
                "repair": {
                    "category": "execution_failed",
                    # `contract_diagnostics` is the ONLY evidence a candidate rejected
                    # before the sandbox has. That path never runs, so there is no
                    # stderr and no sandbox_error, and omitting it left the model with
                    # "sandbox exit was non-zero" and nothing else — less than the
                    # traceback it would have got by being allowed to fail at runtime.
                    # Teleportation regressed exactly that way on production run
                    # 019f7dd4-c3c6: the Qiskit 2.0 `c_if` diagnostic fired on all four
                    # candidates, correctly, and told the model nothing.
                    "evidence": [
                        *(
                            str(item)
                            for item in evidence.observation.get("contract_diagnostics", [])
                        ),
                        str(
                            evidence.observation.get("evidence_error", "sandbox exit was non-zero")
                        ),
                        *(
                            [str(evidence.observation["sandbox_error"])[-2000:]]
                            if evidence.observation.get("sandbox_error")
                            else []
                        ),
                    ],
                    "repairs": ["Repair the framework code and submit a new candidate revision."],
                },
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

    async def convert(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        candidate = await self._bound_candidate(run_id, call.arguments)
        verification = await self._store.verification_for(run_id, candidate.candidate_id)
        if verification is None or verification.decision is not VerifierDecision.PASS:
            raise ToolPolicyError("candidate_unverified", "conversion requires verification PASS")
        execution = await self._store.execution_for(run_id, candidate.candidate_id)
        if execution is None:
            raise ToolPolicyError("execution_missing", "conversion requires execution evidence")
        evidence = await self._store.conversion_for(run_id, candidate.candidate_id)
        if evidence is None:
            qasm, reason = await self._converter.convert(candidate, execution)
            evidence = ConversionEvidence(
                candidate_id=candidate.candidate_id,
                source_fingerprint=candidate.source_fingerprint,
                status="available" if qasm else "unavailable",
                qasm=qasm,
                reason=reason,
            )
            await self._store.add_conversion(evidence)
        return evidence.model_dump(mode="json", exclude={"qasm"})

    async def publish(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        candidate = await self._bound_candidate(run_id, call.arguments)
        verification = await self._store.verification_for(run_id, candidate.candidate_id)
        if verification is None or verification.decision is not VerifierDecision.PASS:
            raise ToolPolicyError("candidate_unverified", "publication requires verification PASS")
        if verification.source_fingerprint != candidate.source_fingerprint:
            raise ToolPolicyError("fingerprint_mismatch", "verified source differs from candidate")
        publication = await self._store.publication_for(run_id, candidate.candidate_id)
        if publication is None:
            execution = await self._store.execution_for(run_id, candidate.candidate_id)
            if execution is None or not execution.succeeded:
                raise ToolPolicyError(
                    "execution_missing", "publication requires successful execution evidence"
                )
            if execution.source_fingerprint != candidate.source_fingerprint:
                raise ToolPolicyError(
                    "fingerprint_mismatch", "executed source differs from candidate"
                )
            conversion = await self._store.conversion_for(run_id, candidate.candidate_id)
            plan = (await self._store.plan(run_id, candidate.plan_id)).plan
            publication = await self._publisher.publish(
                candidate, execution, verification, conversion, plan
            )
            if publication.candidate_id != candidate.candidate_id:
                raise ToolPolicyError(
                    "publication_mismatch", "publisher returned a different candidate"
                )
            if publication.source_fingerprint != candidate.source_fingerprint:
                raise ToolPolicyError(
                    "fingerprint_mismatch", "published source differs from candidate"
                )
            await self._store.add_publication(publication)
        await self._store.set_candidate_status(
            run_id, candidate.candidate_id, CandidateStatus.PUBLISHED.value
        )
        return publication.model_dump(mode="json")

    async def _bound_candidate(self, run_id: UUID, arguments: dict[str, Any]) -> CandidateRevision:
        try:
            candidate_id = UUID(str(arguments["candidate_id"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ToolPolicyError("invalid_arguments", "candidate_id must be a UUID") from exc
        return await self._store.candidate(run_id, candidate_id)
