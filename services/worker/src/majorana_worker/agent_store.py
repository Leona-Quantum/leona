"""Repository-backed AgentStore with a commit at every durable boundary."""

from __future__ import annotations

from uuid import UUID

from majorana_agent import (
    AgentState,
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    PlanRecord,
    PublishedArtifact,
    ToolCall,
    ToolResult,
    VerificationEvidence,
)
from majorana_contracts import Scope
from majorana_contracts.enums import Framework

from majorana_api.db import AsyncSession
from majorana_api.repos import agent as agent_repo


class RepoAgentStore:
    def __init__(self, scope: Scope, session: AsyncSession) -> None:
        self._scope = scope
        self._session = session

    async def state(self, run_id: UUID) -> AgentState:
        row = await agent_repo.get_or_create_agent_run(self._scope, self._session, run_id)
        await self._session.commit()
        return AgentState(row.state)

    async def set_state(self, run_id: UUID, state: AgentState) -> None:
        await agent_repo.set_agent_state(self._scope, self._session, run_id, state.value)
        await self._session.commit()

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

    async def tool_call(self, run_id: UUID, tool_call_id: str) -> ToolCall | None:
        row = await agent_repo.get_step(self._scope, self._session, run_id, tool_call_id)
        if row is None:
            return None
        return ToolCall(
            tool_call_id=row.tool_call_id,
            name=row.name,
            arguments=row.arguments,
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

    async def add_plan(self, record: PlanRecord) -> None:
        await agent_repo.set_plan(
            self._scope,
            self._session,
            record.run_id,
            plan_id=record.plan_id,
            plan=record.plan.model_dump(mode="json"),
        )
        await self._session.commit()

    async def plan(self, run_id: UUID, plan_id: UUID) -> PlanRecord:
        row = await agent_repo.get_or_create_agent_run(self._scope, self._session, run_id)
        if row.plan_id != plan_id or row.plan is None:
            raise KeyError(plan_id)
        return PlanRecord(plan_id=plan_id, run_id=run_id, plan=row.plan)

    async def latest_plan(self, run_id: UUID) -> PlanRecord | None:
        row = await agent_repo.get_or_create_agent_run(self._scope, self._session, run_id)
        if row.plan_id is None or row.plan is None:
            return None
        return PlanRecord(plan_id=row.plan_id, run_id=run_id, plan=row.plan)

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

    async def latest_candidate(self, run_id: UUID) -> CandidateRevision | None:
        rows = await agent_repo.list_candidates(self._scope, self._session, run_id)
        return self._candidate(rows[-1]) if rows else None

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

    async def add_verification(self, evidence: VerificationEvidence) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, evidence.candidate_id
        )
        if row is None:
            raise KeyError(evidence.candidate_id)
        candidate = self._candidate(row)
        execution = await self.execution_for(candidate.run_id, candidate.candidate_id)
        if execution is None or execution.execution_id != evidence.execution_id:
            raise ValueError("verification references a different execution")
        if (
            candidate.source_fingerprint != evidence.source_fingerprint
            or execution.source_fingerprint != evidence.source_fingerprint
        ):
            raise ValueError("verification fingerprint does not match executed candidate")
        await agent_repo.add_verification(
            self._scope,
            self._session,
            candidate.run_id,
            {
                "id": evidence.verification_id,
                "candidate_id": evidence.candidate_id,
                "execution_id": evidence.execution_id,
                "source_fingerprint": evidence.source_fingerprint,
                "decision": evidence.decision.value,
                "deterministic_checks": evidence.deterministic_checks,
                "critic": evidence.critic,
                "repair": evidence.repair.model_dump(mode="json") if evidence.repair else None,
            },
        )
        await self._session.commit()

    async def verification_for(
        self, run_id: UUID, candidate_id: UUID
    ) -> VerificationEvidence | None:
        row = await agent_repo.get_verification(self._scope, self._session, run_id, candidate_id)
        if row is None:
            return None
        return VerificationEvidence(
            verification_id=row.id,
            candidate_id=row.candidate_id,
            execution_id=row.execution_id,
            source_fingerprint=row.source_fingerprint,
            decision=row.decision,
            deterministic_checks=row.deterministic_checks,
            critic=row.critic,
            repair=row.repair,
        )

    async def add_conversion(self, evidence: ConversionEvidence) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, evidence.candidate_id
        )
        if row is None:
            raise KeyError(evidence.candidate_id)
        candidate = self._candidate(row)
        verification = await self.verification_for(candidate.run_id, candidate.candidate_id)
        if verification is None:
            raise ValueError("candidate must be verified before conversion")
        if candidate.source_fingerprint != evidence.source_fingerprint:
            raise ValueError("conversion fingerprint does not match candidate")
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
            source_fingerprint=row.source_fingerprint,
            status=row.status,
            qasm=row.qasm,
            reason=row.reason,
        )

    async def add_publication(self, publication: PublishedArtifact) -> None:
        row = await agent_repo.get_candidate_by_id(
            self._scope, self._session, publication.candidate_id
        )
        if row is None:
            raise KeyError(publication.candidate_id)
        candidate = self._candidate(row)
        verification = await self.verification_for(candidate.run_id, candidate.candidate_id)
        if verification is None or verification.decision.value != "pass":
            raise ValueError("publication requires verification PASS")
        if candidate.source_fingerprint != publication.source_fingerprint:
            raise ValueError("publication fingerprint does not match candidate")
        await agent_repo.set_publication(
            self._scope,
            self._session,
            candidate.run_id,
            publication.model_dump(mode="json"),
        )
        await self._session.commit()

    async def publication_for(self, run_id: UUID, candidate_id: UUID) -> PublishedArtifact | None:
        row = await agent_repo.get_or_create_agent_run(self._scope, self._session, run_id)
        if row.publication is None:
            return None
        publication = PublishedArtifact.model_validate(row.publication)
        return publication if publication.candidate_id == candidate_id else None
