"""Trusted implementations behind the model-visible circuit tools.

The model may propose source only to a selected-framework simulation tool.  Every
later tool resolves immutable records by candidate id, preventing source/result
substitution between execution, verification, conversion, and publication.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID, uuid4

from majorana_agent.broker import ToolHandler, ToolPolicyError
from majorana_agent.models import (
    CandidateRevision,
    CandidateStatus,
    ConversionEvidence,
    ExecutionEvidence,
    ExecutionFailureKind,
    PlanRecord,
    PublishedArtifact,
    RepairInstruction,
    ToolCall,
    ToolName,
    VerificationEvidence,
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
            ToolName.SIMULATE_QISKIT: self.simulate,
            ToolName.SIMULATE_CIRQ: self.simulate,
            ToolName.SIMULATE_PENNYLANE: self.simulate,
            ToolName.VERIFY_INTENT_ALIGNMENT: self.verify,
            ToolName.CONVERT_TO_OPENQASM: self.convert,
            ToolName.PUBLISH_ARTIFACT: self.publish,
        }

    async def request_plan(self, run_id: UUID, _call: ToolCall) -> dict[str, Any]:
        existing = await self._store.latest_plan(run_id)
        if existing is not None:
            return {"plan_id": str(existing.plan_id), "plan": existing.plan.model_dump(mode="json")}
        plan = await self._planner.create_plan(run_id)
        if plan.framework is not self._framework:
            raise ToolPolicyError(
                "framework_mismatch", "planner changed the user-selected framework"
            )
        record = PlanRecord(plan_id=uuid4(), run_id=run_id, plan=plan)
        await self._store.add_plan(record)
        return {"plan_id": str(record.plan_id), "plan": plan.model_dump(mode="json")}

    async def simulate(self, run_id: UUID, call: ToolCall) -> dict[str, Any]:
        source = call.arguments.get("source")
        if not isinstance(source, str) or not source.strip():
            raise ToolPolicyError("invalid_arguments", "source must be non-empty framework code")
        plan_record = await self._store.latest_plan(run_id)
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
        evidence = await self._store.verification_for(run_id, candidate.candidate_id)
        if evidence is None:
            plan_record = await self._store.plan(run_id, candidate.plan_id)
            output = await self._verifier.verify(candidate, execution, plan_record.plan)
            evidence = VerificationEvidence(
                verification_id=uuid4(),
                candidate_id=candidate.candidate_id,
                execution_id=execution.execution_id,
                source_fingerprint=candidate.source_fingerprint,
                decision=output.decision,
                deterministic_checks=output.deterministic_checks,
                critic=output.critic,
                repair=output.repair,
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
