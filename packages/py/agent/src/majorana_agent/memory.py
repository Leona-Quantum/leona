"""In-memory AgentStore for unit tests and local composition.

Production supplies a repository-backed implementation.  It deliberately follows
the same append-only and idempotency semantics, so tests exercise the real contract.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from majorana_agent.models import (
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


class MemoryAgentStore:
    def __init__(self) -> None:
        self._states: dict[UUID, AgentState] = {}
        self._started: dict[tuple[UUID, str], ToolCall] = {}
        self._results: dict[tuple[UUID, str], ToolResult] = {}
        self._candidates: dict[UUID, list[CandidateRevision]] = defaultdict(list)
        self._plans: dict[UUID, list[PlanRecord]] = defaultdict(list)
        self._executions: dict[tuple[UUID, UUID], ExecutionEvidence] = {}
        self._verifications: dict[tuple[UUID, UUID], VerificationEvidence] = {}
        self._conversions: dict[tuple[UUID, UUID], ConversionEvidence] = {}
        self.publications: list[PublishedArtifact] = []
        self._publication_owners: dict[UUID, UUID] = {}

    async def state(self, run_id: UUID) -> AgentState:
        return self._states.get(run_id, AgentState.NEW)

    async def set_state(self, run_id: UUID, state: AgentState) -> None:
        self._states[run_id] = state

    async def completed_tool_call(self, run_id: UUID, tool_call_id: str) -> ToolResult | None:
        return self._results.get((run_id, tool_call_id))

    async def tool_call(self, run_id: UUID, tool_call_id: str) -> ToolCall | None:
        return self._started.get((run_id, tool_call_id))

    async def begin_tool_call(self, run_id: UUID, call: ToolCall) -> None:
        key = (run_id, call.tool_call_id)
        previous = self._started.get(key)
        if previous is not None and previous != call:
            raise ValueError("tool_call_id was reused with different arguments")
        self._started[key] = call

    async def finish_tool_call(self, run_id: UUID, result: ToolResult) -> None:
        key = (run_id, result.tool_call_id)
        previous = self._results.get(key)
        if previous is not None and previous != result:
            raise ValueError("completed tool call is immutable")
        self._results[key] = result

    async def list_tool_results(self, run_id: UUID) -> list[ToolResult]:
        return [result for (owner, _), result in self._results.items() if owner == run_id]

    async def add_plan(self, record: PlanRecord) -> None:
        if record.run_id in self._plans and self._plans[record.run_id]:
            raise ValueError("a run already has a plan")
        self._plans[record.run_id].append(record)

    async def plan(self, run_id: UUID, plan_id: UUID) -> PlanRecord:
        for record in self._plans[run_id]:
            if record.plan_id == plan_id:
                return record
        raise KeyError(plan_id)

    async def latest_plan(self, run_id: UUID) -> PlanRecord | None:
        records = self._plans[run_id]
        return records[-1] if records else None

    async def add_candidate(self, candidate: CandidateRevision) -> None:
        revisions = self._candidates[candidate.run_id]
        if any(existing.candidate_id == candidate.candidate_id for existing in revisions):
            raise ValueError("candidate_id already exists")
        if any(existing.tool_call_id == candidate.tool_call_id for existing in revisions):
            raise ValueError("tool_call_id already has a candidate")
        expected = len(revisions) + 1
        if candidate.revision != expected:
            raise ValueError(f"candidate revision must be {expected}")
        if revisions and candidate.parent_candidate_id != revisions[-1].candidate_id:
            raise ValueError("candidate parent must be the previous revision")
        revisions.append(candidate)

    async def set_candidate_status(self, run_id: UUID, candidate_id: UUID, status: str) -> None:
        revisions = self._candidates[run_id]
        for index, candidate in enumerate(revisions):
            if candidate.candidate_id == candidate_id:
                revisions[index] = candidate.model_copy(update={"status": status})
                return
        raise KeyError(candidate_id)

    async def candidate(self, run_id: UUID, candidate_id: UUID) -> CandidateRevision:
        for candidate in self._candidates[run_id]:
            if candidate.candidate_id == candidate_id:
                return candidate
        raise KeyError(candidate_id)

    async def candidate_for_tool_call(
        self, run_id: UUID, tool_call_id: str
    ) -> CandidateRevision | None:
        return next(
            (
                candidate
                for candidate in self._candidates[run_id]
                if candidate.tool_call_id == tool_call_id
            ),
            None,
        )

    async def latest_candidate(self, run_id: UUID) -> CandidateRevision | None:
        values = self._candidates[run_id]
        return values[-1] if values else None

    async def list_candidates(self, run_id: UUID) -> list[CandidateRevision]:
        return list(self._candidates[run_id])

    async def add_execution(self, evidence: ExecutionEvidence) -> None:
        key = next(
            (
                key
                for key in self._candidates
                if any(c.candidate_id == evidence.candidate_id for c in self._candidates[key])
            ),
            None,
        )
        if key is None:
            raise KeyError(evidence.candidate_id)
        candidate = await self.candidate(key, evidence.candidate_id)
        if candidate.source_fingerprint != evidence.source_fingerprint:
            raise ValueError("execution fingerprint does not match candidate")
        self._executions[(key, evidence.candidate_id)] = evidence

    async def execution_for(self, run_id: UUID, candidate_id: UUID) -> ExecutionEvidence | None:
        return self._executions.get((run_id, candidate_id))

    async def add_verification(self, evidence: VerificationEvidence) -> None:
        execution = next(
            (
                value
                for (_, candidate_id), value in self._executions.items()
                if candidate_id == evidence.candidate_id
            ),
            None,
        )
        if execution is None:
            raise ValueError("candidate must be executed before verification")
        if execution.execution_id != evidence.execution_id:
            raise ValueError("verification references a different execution")
        if execution.source_fingerprint != evidence.source_fingerprint:
            raise ValueError("verification fingerprint does not match execution")
        owner = next(run for (run, cid) in self._executions if cid == evidence.candidate_id)
        self._verifications[(owner, evidence.candidate_id)] = evidence

    async def verification_for(
        self, run_id: UUID, candidate_id: UUID
    ) -> VerificationEvidence | None:
        return self._verifications.get((run_id, candidate_id))

    async def add_conversion(self, evidence: ConversionEvidence) -> None:
        owner = next(
            (run for (run, cid) in self._verifications if cid == evidence.candidate_id), None
        )
        if owner is None:
            raise ValueError("candidate must be verified before conversion")
        verification = self._verifications[(owner, evidence.candidate_id)]
        if verification.source_fingerprint != evidence.source_fingerprint:
            raise ValueError("conversion fingerprint does not match verification")
        self._conversions[(owner, evidence.candidate_id)] = evidence

    async def conversion_for(self, run_id: UUID, candidate_id: UUID) -> ConversionEvidence | None:
        return self._conversions.get((run_id, candidate_id))

    async def add_publication(self, publication: PublishedArtifact) -> None:
        existing = next(
            (item for item in self.publications if item.candidate_id == publication.candidate_id),
            None,
        )
        if existing is not None and existing != publication:
            raise ValueError("candidate publication is immutable")
        if existing is None:
            self.publications.append(publication)
        owner = next(
            (
                run_id
                for run_id, candidates in self._candidates.items()
                if any(c.candidate_id == publication.candidate_id for c in candidates)
            ),
            None,
        )
        if owner is None:
            raise KeyError(publication.candidate_id)
        self._publication_owners[publication.candidate_id] = owner

    async def publication_for(self, run_id: UUID, candidate_id: UUID) -> PublishedArtifact | None:
        if self._publication_owners.get(candidate_id) != run_id:
            return None
        return next(
            (item for item in self.publications if item.candidate_id == candidate_id),
            None,
        )
