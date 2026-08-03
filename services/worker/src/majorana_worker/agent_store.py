"""Repository-backed store for the fixed pipeline's durable boundaries."""

from __future__ import annotations

from uuid import UUID

from majorana_agent import (
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    MaterializedArtifact,
    PlanRevision,
    SemanticReviewEvidence,
    ToolCall,
    ToolResult,
)
from majorana_contracts import Scope
from majorana_contracts.enums import Framework

from majorana_api.db import AsyncSession
from majorana_api.repos import agent as agent_repo


class RepoAgentStore:
    def __init__(self, scope: Scope, session: AsyncSession) -> None:
        self._scope = scope
        self._session = session

    async def has_legacy_progress(self, run_id: UUID) -> bool:
        """Detect an old in-flight tool loop before the fixed pipeline spends work."""
        steps = await agent_repo.list_steps(self._scope, self._session, run_id)
        if steps:
            return any(not row.tool_call_id.startswith("simple:") for row in steps)
        plan = await agent_repo.latest_plan_revision(self._scope, self._session, run_id)
        candidates = await agent_repo.list_candidates(self._scope, self._session, run_id)
        return plan is not None or bool(candidates)

    async def completed_tool_call(self, run_id: UUID, tool_call_id: str) -> ToolResult | None:
        row = await agent_repo.get_step(self._scope, self._session, run_id, tool_call_id)
        if row is None or row.status != "completed":
            return None
        return ToolResult(
            tool_call_id=row.tool_call_id,
            name=row.name,
            ok=row.error_code is None,
            state=row.state,
            payload=row.result or {},
            error_code=row.error_code,
            error_message=row.error_message,
        )

    async def begin_tool_call(self, run_id: UUID, call: ToolCall) -> None:
        existing = await agent_repo.get_step(self._scope, self._session, run_id, call.tool_call_id)
        if existing is not None:
            stored = ToolCall(
                tool_call_id=existing.tool_call_id,
                name=existing.name,
                arguments=existing.arguments,
            )
            if stored != call:
                raise ValueError("tool_call_id was reused with different arguments")
            return
        await agent_repo.begin_step(
            self._scope,
            self._session,
            run_id,
            tool_call_id=call.tool_call_id,
            name=call.name.value,
            arguments=call.arguments,
        )
        await self._session.commit()

    async def finish_tool_call(self, run_id: UUID, result: ToolResult) -> None:
        await agent_repo.finish_step(
            self._scope,
            self._session,
            run_id,
            tool_call_id=result.tool_call_id,
            state=result.state.value,
            result=result.payload,
            error_code=result.error_code,
            error_message=result.error_message,
        )
        await self._session.commit()

    async def list_tool_results(self, run_id: UUID) -> list[ToolResult]:
        rows = await agent_repo.list_steps(self._scope, self._session, run_id)
        return [
            ToolResult(
                tool_call_id=row.tool_call_id,
                name=row.name,
                ok=row.error_code is None,
                state=row.state,
                payload=row.result or {},
                error_code=row.error_code,
                error_message=row.error_message,
            )
            for row in rows
            if row.status == "completed"
        ]

    @staticmethod
    def _plan_revision(row) -> PlanRevision:
        return PlanRevision(
            plan_id=row.id,
            run_id=row.run_id,
            revision=row.revision,
            parent_plan_id=row.parent_plan_id,
            plan=row.plan,
            plan_fingerprint=row.plan_fingerprint,
            replan_reason=row.replan_reason,
        )

    async def append_plan_revision(self, record: PlanRevision) -> None:
        await agent_repo.append_plan_revision(
            self._scope,
            self._session,
            record.run_id,
            {
                "id": record.plan_id,
                "revision": record.revision,
                "parent_plan_id": record.parent_plan_id,
                "plan": record.plan.model_dump(mode="json"),
                "plan_fingerprint": record.plan_fingerprint,
                "replan_reason": record.replan_reason,
            },
        )
        await self._session.commit()

    async def plan_revision(self, run_id: UUID, plan_id: UUID) -> PlanRevision:
        row = await agent_repo.get_plan_revision(self._scope, self._session, run_id, plan_id)
        if row is None:
            raise KeyError(plan_id)
        return self._plan_revision(row)

    async def select_current_plan(self, run_id: UUID, plan_id: UUID) -> None:
        await agent_repo.select_current_plan(self._scope, self._session, run_id, plan_id)
        await self._session.commit()

    @staticmethod
    def _candidate(row) -> CandidateRevision:
        return CandidateRevision(
            candidate_id=row.id,
            run_id=row.run_id,
            tool_call_id=row.tool_call_id,
            revision=row.revision,
            parent_candidate_id=row.parent_candidate_id,
            plan_id=row.plan_id,
            framework=Framework(row.framework),
            source=row.source,
            source_fingerprint=row.source_fingerprint,
            status=row.status,
        )

    async def add_candidate(self, candidate: CandidateRevision) -> None:
        existing = await self.list_candidates(candidate.run_id)
        expected_revision = len(existing) + 1
        if candidate.revision != expected_revision:
            raise ValueError(f"candidate revision must be {expected_revision}")
        expected_parent = existing[-1].candidate_id if existing else None
        if candidate.parent_candidate_id != expected_parent:
            raise ValueError("candidate parent must be the previous revision")
        await agent_repo.add_candidate(
            self._scope,
            self._session,
            candidate.run_id,
            {
                "id": candidate.candidate_id,
                "tool_call_id": candidate.tool_call_id,
                "revision": candidate.revision,
                "parent_candidate_id": candidate.parent_candidate_id,
                "plan_id": candidate.plan_id,
                "framework": candidate.framework.value,
                "source": candidate.source,
                "source_fingerprint": candidate.source_fingerprint,
                "status": candidate.status.value,
            },
        )
        await self._session.commit()

    async def set_candidate_status(self, run_id: UUID, candidate_id: UUID, status: str) -> None:
        await agent_repo.set_candidate_status(
            self._scope, self._session, run_id, candidate_id, status
        )
        await self._session.commit()

    async def candidate(self, run_id: UUID, candidate_id: UUID) -> CandidateRevision:
        row = await agent_repo.get_candidate(self._scope, self._session, run_id, candidate_id)
        if row is None:
            raise KeyError(candidate_id)
        return self._candidate(row)

    async def candidate_for_tool_call(
        self, run_id: UUID, tool_call_id: str
    ) -> CandidateRevision | None:
        row = await agent_repo.get_candidate_by_tool_call(
            self._scope, self._session, run_id, tool_call_id
        )
        return self._candidate(row) if row is not None else None

    async def list_candidates(self, run_id: UUID) -> list[CandidateRevision]:
        rows = await agent_repo.list_candidates(self._scope, self._session, run_id)
        return [self._candidate(row) for row in rows]

    async def add_execution(self, evidence: ExecutionEvidence) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, evidence.candidate_id
        )
        if row is None:
            raise KeyError(evidence.candidate_id)
        candidate = self._candidate(row)
        if candidate.source_fingerprint != evidence.source_fingerprint:
            raise ValueError("execution fingerprint does not match candidate")
        await agent_repo.add_execution(
            self._scope,
            self._session,
            candidate.run_id,
            {
                "id": evidence.execution_id,
                "candidate_id": evidence.candidate_id,
                "source_fingerprint": evidence.source_fingerprint,
                "environment_fingerprint": evidence.environment_fingerprint,
                "sandbox_provider": evidence.sandbox_provider,
                "exit_code": evidence.exit_code,
                "failure_kind": evidence.failure_kind.value if evidence.failure_kind else None,
                "duration_ms": evidence.duration_ms,
                "result": evidence.result,
                "observation": evidence.observation,
            },
        )
        await self._session.commit()

    async def execution_for(self, run_id: UUID, candidate_id: UUID) -> ExecutionEvidence | None:
        row = await agent_repo.get_execution(self._scope, self._session, run_id, candidate_id)
        if row is None:
            return None
        return ExecutionEvidence(
            execution_id=row.id,
            candidate_id=row.candidate_id,
            source_fingerprint=row.source_fingerprint,
            environment_fingerprint=row.environment_fingerprint,
            sandbox_provider=row.sandbox_provider,
            exit_code=row.exit_code,
            failure_kind=row.failure_kind,
            duration_ms=row.duration_ms,
            result=row.result,
            observation=row.observation,
        )

    @staticmethod
    def _semantic_review(row) -> SemanticReviewEvidence:
        return SemanticReviewEvidence(
            review_id=row.id,
            candidate_id=row.candidate_id,
            execution_id=row.execution_id,
            source_fingerprint=row.source_fingerprint,
            attempt_seq=row.attempt_seq,
            decision=row.decision,
            confidence=row.confidence,
            severity=row.severity,
            reason_code=row.reason_code,
            failure_class=row.failure_class,
            retry_target=row.retry_target,
            feedback=row.feedback,
        )

    async def append_semantic_review(self, evidence: SemanticReviewEvidence) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, evidence.candidate_id
        )
        if row is None:
            raise KeyError(evidence.candidate_id)
        candidate = self._candidate(row)
        execution = await self.execution_for(candidate.run_id, candidate.candidate_id)
        if execution is None:
            raise ValueError("candidate must be executed before semantic review")
        evidence.assert_binding(candidate, execution)
        await agent_repo.append_semantic_review(
            self._scope,
            self._session,
            candidate.run_id,
            {
                "id": evidence.review_id,
                "candidate_id": evidence.candidate_id,
                "execution_id": evidence.execution_id,
                "source_fingerprint": evidence.source_fingerprint,
                "attempt_seq": evidence.attempt_seq,
                "decision": evidence.decision.value,
                "confidence": evidence.confidence,
                "severity": evidence.severity,
                "reason_code": evidence.reason_code,
                "failure_class": (evidence.failure_class.value if evidence.failure_class else None),
                "retry_target": evidence.retry_target.value,
                "feedback": evidence.feedback,
            },
        )
        await self._session.commit()

    async def latest_semantic_review(
        self, run_id: UUID, candidate_id: UUID
    ) -> SemanticReviewEvidence | None:
        row = await agent_repo.latest_semantic_review(
            self._scope, self._session, run_id, candidate_id
        )
        return self._semantic_review(row) if row is not None else None

    async def semantic_review(self, run_id, candidate_id, review_id):
        row = await agent_repo.get_semantic_review(
            self._scope, self._session, run_id, candidate_id, review_id
        )
        return self._semantic_review(row) if row is not None else None

    async def add_conversion(self, evidence: ConversionEvidence) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, evidence.candidate_id
        )
        if row is None:
            raise KeyError(evidence.candidate_id)
        candidate = self._candidate(row)
        execution = await self.execution_for(candidate.run_id, candidate.candidate_id)
        review = await self.latest_semantic_review(candidate.run_id, candidate.candidate_id)
        if review is None or not review.has_recorded_checks():
            raise ValueError("conversion requires a review with recorded deterministic checks")
        if execution is None or not (
            review.execution_id == evidence.execution_id == execution.execution_id
            and candidate.source_fingerprint
            == review.source_fingerprint
            == evidence.source_fingerprint
            == execution.source_fingerprint
        ):
            raise ValueError("conversion fingerprint/execution binding mismatch")
        await agent_repo.add_conversion(
            self._scope,
            self._session,
            candidate.run_id,
            evidence.model_dump(mode="python"),
        )
        await self._session.commit()

    async def conversion_for(self, run_id: UUID, candidate_id: UUID) -> ConversionEvidence | None:
        row = await agent_repo.get_conversion(self._scope, self._session, run_id, candidate_id)
        if row is None:
            return None
        return ConversionEvidence(
            candidate_id=row.candidate_id,
            execution_id=row.execution_id,
            source_fingerprint=row.source_fingerprint,
            status=row.status,
            qasm=row.qasm,
            reason=row.reason,
        )

    async def add_materialization(self, materialization: MaterializedArtifact) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, materialization.candidate_id
        )
        if row is None:
            raise KeyError(materialization.candidate_id)
        candidate = self._candidate(row)
        execution = await self.execution_for(candidate.run_id, candidate.candidate_id)
        review = await self.latest_semantic_review(candidate.run_id, candidate.candidate_id)
        if execution is None:
            raise ValueError("materialization requires execution evidence")
        if (
            execution.candidate_id != candidate.candidate_id
            or execution.source_fingerprint != candidate.source_fingerprint
        ):
            raise ValueError("materialization execution evidence does not match candidate")
        if materialization.execution_status == "not_run":
            if not execution.was_not_run:
                raise ValueError(
                    "unexecuted materialization requires trusted not-run preflight evidence"
                )
            if review is not None:
                # A review that EXISTS must be bound to this candidate and this
                # execution even when nothing ran. `handlers._finish_simple_pipeline`
                # already asserts it on the unexecuted path; leaving it out here
                # meant the store admitted a materialization the worker would
                # then refuse, and — worse — that a caller reaching the store
                # directly could file an artifact carrying somebody else's
                # review. The not-run relaxation is about the review being
                # OPTIONAL, never about an unbound one being acceptable.
                review.assert_binding(candidate, execution)
        else:
            if not execution.succeeded:
                raise ValueError("materialization requires successful execution")
            if review is None or not review.has_recorded_checks():
                raise ValueError(
                    "materialization requires a review with recorded deterministic checks"
                )
            review.assert_binding(candidate, execution)
        if candidate.source_fingerprint != materialization.source_fingerprint:
            raise ValueError("materialization fingerprint does not match candidate")
        await agent_repo.set_materialization(
            self._scope,
            self._session,
            candidate.run_id,
            materialization.model_dump(mode="json"),
        )
        await self._session.commit()

    async def materialization_for(
        self, run_id: UUID, candidate_id: UUID
    ) -> MaterializedArtifact | None:
        row = await agent_repo.get_or_create_agent_run(self._scope, self._session, run_id)
        if row.materialization is None:
            return None
        materialization = MaterializedArtifact.model_validate(row.materialization)
        return materialization if materialization.candidate_id == candidate_id else None
