"""In-memory AgentStore for unit tests and local composition.

Production supplies a repository-backed implementation.  It deliberately follows
the same append-only and idempotency semantics, so tests exercise the real contract.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from majorana_agent.models import (
    AgentState,
    CandidateStatus,
    CandidateRevision,
    ConversionEvidence,
    ExecutionEvidence,
    PlanRevision,
    PlanRecord,
    MaterializedArtifact,
    PublishedArtifact,
    SemanticReviewEvidence,
    StrictVerificationAttempt,
    ToolCall,
    ToolResult,
    VerificationEvidence,
    _plan_fingerprint,
)


class MemoryAgentStore:
    def __init__(self) -> None:
        self._states: dict[UUID, AgentState] = {}
        self._started: dict[tuple[UUID, str], ToolCall] = {}
        self._results: dict[tuple[UUID, str], ToolResult] = {}
        self._candidates: dict[UUID, list[CandidateRevision]] = defaultdict(list)
        self._plans: dict[UUID, list[PlanRecord]] = defaultdict(list)
        self._plan_revisions: dict[UUID, list[PlanRevision]] = defaultdict(list)
        self._current_plan_ids: dict[UUID, UUID] = {}
        self._executions: dict[tuple[UUID, UUID], ExecutionEvidence] = {}
        self._verifications: dict[tuple[UUID, UUID], VerificationEvidence] = {}
        self._semantic_reviews: dict[tuple[UUID, UUID], list[SemanticReviewEvidence]] = defaultdict(
            list
        )
        self._strict_verifications: dict[tuple[UUID, UUID], list[StrictVerificationAttempt]] = (
            defaultdict(list)
        )
        self._conversions: dict[tuple[UUID, UUID], ConversionEvidence] = {}
        self.materializations: list[MaterializedArtifact] = []
        self._materialization_owners: dict[UUID, UUID] = {}
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
        revision = PlanRevision(
            plan_id=record.plan_id,
            run_id=record.run_id,
            revision=1,
            plan=record.plan,
            plan_fingerprint=_plan_fingerprint(record.plan),
        )
        await self.append_plan_revision(revision)
        await self.select_current_plan(record.run_id, record.plan_id)
        self._plans[record.run_id].append(record)

    async def plan(self, run_id: UUID, plan_id: UUID) -> PlanRecord:
        revision = await self.plan_revision(run_id, plan_id)
        return PlanRecord(plan_id=revision.plan_id, run_id=run_id, plan=revision.plan)

    async def latest_plan(self, run_id: UUID) -> PlanRecord | None:
        revision = await self.current_plan_revision(run_id)
        return (
            PlanRecord(plan_id=revision.plan_id, run_id=run_id, plan=revision.plan)
            if revision is not None
            else None
        )

    async def append_plan_revision(self, record: PlanRevision) -> None:
        revisions = self._plan_revisions[record.run_id]
        if any(item.plan_id == record.plan_id for item in revisions):
            raise ValueError("plan_id already exists")
        if any(item.revision == record.revision for item in revisions):
            raise ValueError("Plan revision sequence already exists")
        expected_revision = len(revisions) + 1
        if record.revision != expected_revision:
            raise ValueError(f"Plan revision must be {expected_revision}")
        expected_parent = revisions[-1].plan_id if revisions else None
        if record.parent_plan_id != expected_parent:
            raise ValueError("Plan parent must be the preceding revision in the same run")
        revisions.append(record)

    async def plan_revision(self, run_id: UUID, plan_id: UUID) -> PlanRevision:
        for record in self._plan_revisions[run_id]:
            if record.plan_id == plan_id:
                return record
        raise KeyError(plan_id)

    async def current_plan_revision(self, run_id: UUID) -> PlanRevision | None:
        plan_id = self._current_plan_ids.get(run_id)
        return await self.plan_revision(run_id, plan_id) if plan_id is not None else None

    async def select_current_plan(self, run_id: UUID, plan_id: UUID) -> None:
        await self.plan_revision(run_id, plan_id)
        self._current_plan_ids[run_id] = plan_id

    async def add_candidate(self, candidate: CandidateRevision) -> None:
        if self._current_plan_ids.get(candidate.run_id) != candidate.plan_id:
            raise ValueError("candidate plan is not the selected Plan revision")
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
                revisions[index] = candidate.model_copy(update={"status": CandidateStatus(status)})
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
        evidence_key = (key, evidence.candidate_id)
        existing = self._executions.get(evidence_key)
        if existing is not None and existing != evidence:
            raise ValueError("candidate execution evidence is immutable")
        self._executions[evidence_key] = evidence

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
        evidence_key = (owner, evidence.candidate_id)
        existing = self._verifications.get(evidence_key)
        if existing is not None and existing != evidence:
            raise ValueError("candidate verification evidence is immutable")
        self._verifications[evidence_key] = evidence

    async def verification_for(
        self, run_id: UUID, candidate_id: UUID
    ) -> VerificationEvidence | None:
        return self._verifications.get((run_id, candidate_id))

    async def append_semantic_review(self, evidence: SemanticReviewEvidence) -> None:
        owner = next(
            (
                run
                for (run, candidate_id) in self._executions
                if candidate_id == evidence.candidate_id
            ),
            None,
        )
        if owner is None:
            raise ValueError("candidate must be executed before semantic review")
        candidate = await self.candidate(owner, evidence.candidate_id)
        execution = self._executions[(owner, evidence.candidate_id)]
        evidence.assert_binding(candidate, execution)
        attempts = self._semantic_reviews[(owner, evidence.candidate_id)]
        if any(item.attempt_seq == evidence.attempt_seq for item in attempts):
            raise ValueError("semantic review attempt sequence already exists")
        attempts.append(evidence)

    async def latest_semantic_review(
        self, run_id: UUID, candidate_id: UUID
    ) -> SemanticReviewEvidence | None:
        attempts = self._semantic_reviews[(run_id, candidate_id)]
        return max(attempts, key=lambda item: item.attempt_seq) if attempts else None

    async def semantic_review(self, run_id, candidate_id, review_id):
        return next(
            (
                item
                for item in self._semantic_reviews[(run_id, candidate_id)]
                if item.review_id == review_id
            ),
            None,
        )

    async def append_strict_verification(self, attempt: StrictVerificationAttempt) -> None:
        owner = next(
            (
                run
                for (run, candidate_id) in self._executions
                if candidate_id == attempt.candidate_id
            ),
            None,
        )
        if owner is None:
            raise ValueError("candidate must be executed before strict verification")
        candidate = await self.candidate(owner, attempt.candidate_id)
        execution = self._executions[(owner, attempt.candidate_id)]
        review = next(
            (
                item
                for item in self._semantic_reviews[(owner, attempt.candidate_id)]
                if item.review_id == attempt.semantic_review_id
            ),
            None,
        )
        if review is None:
            raise ValueError("strict verification requires its semantic review")
        attempt.assert_binding(candidate, execution, review)
        attempts = self._strict_verifications[(owner, attempt.candidate_id)]
        if any(item.attempt_seq == attempt.attempt_seq for item in attempts):
            raise ValueError("strict verification attempt sequence already exists")
        attempts.append(attempt)

    async def latest_strict_verification(
        self, run_id: UUID, candidate_id: UUID
    ) -> StrictVerificationAttempt | None:
        attempts = self._strict_verifications[(run_id, candidate_id)]
        return max(attempts, key=lambda item: item.attempt_seq) if attempts else None

    async def strict_verification(self, run_id, candidate_id, attempt_id):
        return next(
            (
                item
                for item in self._strict_verifications[(run_id, candidate_id)]
                if item.attempt_id == attempt_id
            ),
            None,
        )

    async def add_conversion(self, evidence: ConversionEvidence) -> None:
        owner = next(
            (
                run_id
                for run_id, candidates in self._candidates.items()
                if any(candidate.candidate_id == evidence.candidate_id for candidate in candidates)
            ),
            None,
        )
        if owner is None:
            raise KeyError(evidence.candidate_id)
        # strict_verify is a certification badge, not a gate: conversion only
        # needs a READY semantic review (see tools.py.convert).
        review = await self.latest_semantic_review(owner, evidence.candidate_id)
        execution = self._executions.get((owner, evidence.candidate_id))
        if review is None or review.decision.value != "ready":
            raise ValueError("conversion requires a READY semantic review")
        if execution is None or not (
            review.execution_id == evidence.execution_id == execution.execution_id
            and review.source_fingerprint
            == evidence.source_fingerprint
            == execution.source_fingerprint
        ):
            raise ValueError("conversion fingerprint/execution binding mismatch")
        evidence_key = (owner, evidence.candidate_id)
        existing = self._conversions.get(evidence_key)
        if existing is not None and existing != evidence:
            raise ValueError("candidate conversion evidence is immutable")
        self._conversions[evidence_key] = evidence

    async def conversion_for(self, run_id: UUID, candidate_id: UUID) -> ConversionEvidence | None:
        return self._conversions.get((run_id, candidate_id))

    async def add_materialization(self, materialization: MaterializedArtifact) -> None:
        owner = next(
            (
                run_id
                for run_id, candidates in self._candidates.items()
                if any(c.candidate_id == materialization.candidate_id for c in candidates)
            ),
            None,
        )
        if owner is None:
            raise KeyError(materialization.candidate_id)
        candidate = next(
            item
            for item in self._candidates[owner]
            if item.candidate_id == materialization.candidate_id
        )
        # strict_verify is a certification badge, not a gate: materialization is
        # authorized by a READY semantic review alone (see broker.py/tools.py),
        # regardless of whether strict_verify ran, or what it found.
        reviews = self._semantic_reviews[(owner, materialization.candidate_id)]
        review = max(reviews, key=lambda item: item.attempt_seq) if reviews else None
        if review is None or review.decision.value != "ready":
            raise ValueError("materialization requires a READY semantic review")
        if candidate.source_fingerprint != materialization.source_fingerprint:
            raise ValueError("materialization fingerprint does not match candidate")
        attempts = self._strict_verifications[(owner, materialization.candidate_id)]
        strict = max(attempts, key=lambda item: item.attempt_seq) if attempts else None
        if strict is not None and strict.source_fingerprint != materialization.source_fingerprint:
            raise ValueError("materialization fingerprint does not match strict evidence")
        existing = next(
            (
                item
                for item in self.materializations
                if item.candidate_id == materialization.candidate_id
            ),
            None,
        )
        if existing is not None and existing != materialization:
            raise ValueError("candidate materialization is immutable")
        if existing is None:
            self.materializations.append(materialization)
        self._materialization_owners[materialization.candidate_id] = owner

    async def materialization_for(
        self, run_id: UUID, candidate_id: UUID
    ) -> MaterializedArtifact | None:
        if self._materialization_owners.get(candidate_id) != run_id:
            return None
        return next(
            (item for item in self.materializations if item.candidate_id == candidate_id),
            None,
        )

    async def add_publication(self, publication: PublishedArtifact) -> None:
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
        existing = next(
            (item for item in self.publications if item.candidate_id == publication.candidate_id),
            None,
        )
        if existing is not None and existing != publication:
            raise ValueError("candidate publication is immutable")
        if existing is None:
            self.publications.append(publication)
        self._publication_owners[publication.candidate_id] = owner

    async def publication_for(self, run_id: UUID, candidate_id: UUID) -> PublishedArtifact | None:
        if self._publication_owners.get(candidate_id) != run_id:
            return None
        return next(
            (item for item in self.publications if item.candidate_id == candidate_id),
            None,
        )
