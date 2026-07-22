"""Scoped persistence for durable agent steps and candidate evidence."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from majorana_contracts import Scope
from sqlalchemy import func, select, update

from ..db import AsyncSession
from ..orm import (
    AgentRun,
    AgentLLMCall,
    AgentStep,
    CandidateConversion,
    CandidateExecution,
    CandidateSemanticReview,
    CandidateVerification,
    CandidateVerificationAttempt,
    Run,
    RunCandidate,
    RunPlan,
)
from ..ids import uuid7
from ._base import NotFoundError, require_write


async def _scoped_run(scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> Run:
    row = (
        await session.execute(
            select(Run).where(Run.id == run_id, Run.workspace_id == scope.workspace_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("run")
    return row


async def get_or_create_agent_run(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> AgentRun:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    row = await session.get(AgentRun, run_id)
    if row is None:
        row = AgentRun(run_id=run_id, state="new")
        session.add(row)
        await session.flush()
    return row


async def set_agent_state(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, state: str
) -> None:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    result = await session.execute(
        update(AgentRun).where(AgentRun.run_id == run_id).values(state=state, updated_at=func.now())
    )
    if result.rowcount == 0:
        raise NotFoundError("agent_run")


async def set_plan(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    plan_id: uuid.UUID,
    plan: dict[str, Any],
) -> None:
    require_write(scope)
    row = await get_or_create_agent_run(scope, session, run_id)
    if row.plan_id is not None and row.plan_id != plan_id:
        raise ValueError("agent plan is immutable")
    if row.plan is not None and row.plan != plan:
        raise ValueError("agent plan is immutable")
    row.plan_id = plan_id
    row.plan = plan
    row.updated_at = func.now()
    await session.flush()

    # Compatibility bridge: the current runtime still calls set_plan, while the
    # post-0026 candidate FK requires every selected plan to exist in run_plans.
    # Keep the legacy columns readable and dual-write only the immutable rev1 row.
    revision = await get_plan_revision(scope, session, run_id, plan_id)
    if revision is None:
        await append_plan_revision(
            scope,
            session,
            run_id,
            {
                "id": plan_id,
                "revision": 1,
                "parent_plan_id": None,
                "plan": plan,
                "plan_fingerprint": _fingerprint_plan(plan),
                "replan_reason": None,
            },
        )
    if row.current_plan_id is None:
        await select_current_plan(scope, session, run_id, plan_id)


def _fingerprint_plan(plan: dict[str, Any]) -> str:
    canonical = json.dumps(plan, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


async def get_plan_revision(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, plan_id: uuid.UUID
) -> RunPlan | None:
    return (
        await session.execute(
            select(RunPlan)
            .join(Run, RunPlan.run_id == Run.id)
            .where(
                RunPlan.id == plan_id,
                RunPlan.run_id == run_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def latest_plan_revision(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> RunPlan | None:
    return (
        await session.execute(
            select(RunPlan)
            .join(Run, RunPlan.run_id == Run.id)
            .where(RunPlan.run_id == run_id, Run.workspace_id == scope.workspace_id)
            .order_by(RunPlan.revision.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_current_plan_revision(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> RunPlan | None:
    return (
        await session.execute(
            select(RunPlan)
            .join(
                AgentRun,
                (AgentRun.run_id == RunPlan.run_id) & (AgentRun.current_plan_id == RunPlan.id),
            )
            .join(Run, AgentRun.run_id == Run.id)
            .where(AgentRun.run_id == run_id, Run.workspace_id == scope.workspace_id)
        )
    ).scalar_one_or_none()


async def append_plan_revision(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> RunPlan:
    require_write(scope)
    await get_or_create_agent_run(scope, session, run_id)
    revision = values.get("revision")
    existing = await latest_plan_revision(scope, session, run_id)
    expected_revision = 1 if existing is None else existing.revision + 1
    if revision != expected_revision:
        raise ValueError(f"Plan revision must be {expected_revision}")
    expected_parent = None if existing is None else existing.id
    if values.get("parent_plan_id") != expected_parent:
        raise ValueError("Plan parent must be the preceding revision in the same run")
    plan = values.get("plan")
    if not isinstance(plan, dict) or values.get("plan_fingerprint") != _fingerprint_plan(plan):
        raise ValueError("Plan fingerprint does not match Plan content")
    row = RunPlan(run_id=run_id, **values)
    session.add(row)
    await session.flush()
    return row


async def select_current_plan(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    plan_id: uuid.UUID,
) -> None:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    if await get_plan_revision(scope, session, run_id, plan_id) is None:
        raise ValueError("Plan does not belong to the run")
    changed = await session.execute(
        update(AgentRun)
        .where(AgentRun.run_id == run_id)
        .values(current_plan_id=plan_id, updated_at=func.now())
    )
    if changed.rowcount == 0:
        raise NotFoundError("agent_run")


async def get_step(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, tool_call_id: str
) -> AgentStep | None:
    return (
        await session.execute(
            select(AgentStep)
            .join(Run, AgentStep.run_id == Run.id)
            .where(
                AgentStep.run_id == run_id,
                AgentStep.tool_call_id == tool_call_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def list_steps(scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> list[AgentStep]:
    return list(
        (
            await session.execute(
                select(AgentStep)
                .join(Run, AgentStep.run_id == Run.id)
                .where(AgentStep.run_id == run_id, Run.workspace_id == scope.workspace_id)
                .order_by(AgentStep.created_at, AgentStep.id)
            )
        )
        .scalars()
        .all()
    )


async def get_llm_call(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, request_fingerprint: str
) -> AgentLLMCall | None:
    return (
        await session.execute(
            select(AgentLLMCall)
            .join(Run, AgentLLMCall.run_id == Run.id)
            .where(
                AgentLLMCall.run_id == run_id,
                AgentLLMCall.request_fingerprint == request_fingerprint,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def add_llm_call(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    call_id: uuid.UUID,
    request_fingerprint: str,
    response: dict[str, Any],
    duration_ms: int,
) -> AgentLLMCall:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    row = AgentLLMCall(
        id=call_id,
        run_id=run_id,
        request_fingerprint=request_fingerprint,
        response=response,
        duration_ms=duration_ms,
    )
    session.add(row)
    await session.flush()
    return row


async def mark_llm_call_metered(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, call_id: uuid.UUID
) -> None:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    changed = await session.execute(
        update(AgentLLMCall)
        .where(AgentLLMCall.id == call_id, AgentLLMCall.run_id == run_id)
        .values(metered=True, metered_at=func.now())
    )
    if changed.rowcount == 0:
        raise NotFoundError("agent_llm_call")


async def begin_step(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    tool_call_id: str,
    name: str,
    arguments: dict[str, Any],
) -> AgentStep:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    row = AgentStep(
        id=uuid7(), run_id=run_id, tool_call_id=tool_call_id, name=name, arguments=arguments
    )
    session.add(row)
    await session.flush()
    return row


async def finish_step(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    tool_call_id: str,
    state: str,
    result: dict[str, Any],
    error_code: str | None,
    error_message: str | None,
) -> None:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    changed = await session.execute(
        update(AgentStep)
        .where(
            AgentStep.run_id == run_id,
            AgentStep.tool_call_id == tool_call_id,
            AgentStep.status == "started",
        )
        .values(
            status="completed",
            state=state,
            result=result,
            error_code=error_code,
            error_message=error_message,
            completed_at=func.now(),
        )
    )
    if changed.rowcount == 0:
        existing = await get_step(scope, session, run_id, tool_call_id)
        if existing is None:
            raise NotFoundError("agent_step")


async def add_candidate(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> RunCandidate:
    require_write(scope)
    agent_run = await get_or_create_agent_run(scope, session, run_id)
    selected_plan_id = agent_run.current_plan_id or agent_run.plan_id
    if selected_plan_id is None or selected_plan_id != values.get("plan_id"):
        raise ValueError("candidate plan does not belong to the run")
    parent_id = values.get("parent_candidate_id")
    if parent_id is not None:
        parent = await get_candidate(scope, session, run_id, parent_id)
        if parent is None:
            raise ValueError("candidate parent does not belong to the run")
        if values.get("revision") != parent.revision + 1:
            raise ValueError("candidate parent must be the preceding revision")
    elif values.get("revision") != 1:
        raise ValueError("only the first candidate may omit a parent")
    row = RunCandidate(run_id=run_id, **values)
    session.add(row)
    await session.flush()
    return row


async def get_candidate(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, candidate_id: uuid.UUID
) -> RunCandidate | None:
    return (
        await session.execute(
            select(RunCandidate)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.id == candidate_id,
                RunCandidate.run_id == run_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def get_candidate_by_id(
    scope: Scope, session: AsyncSession, candidate_id: uuid.UUID
) -> RunCandidate | None:
    return (
        await session.execute(
            select(RunCandidate)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.id == candidate_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def get_candidate_by_tool_call(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, tool_call_id: str
) -> RunCandidate | None:
    return (
        await session.execute(
            select(RunCandidate)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                RunCandidate.tool_call_id == tool_call_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def list_candidates(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID
) -> list[RunCandidate]:
    return list(
        (
            await session.execute(
                select(RunCandidate)
                .join(Run, RunCandidate.run_id == Run.id)
                .where(RunCandidate.run_id == run_id, Run.workspace_id == scope.workspace_id)
                .order_by(RunCandidate.revision)
            )
        )
        .scalars()
        .all()
    )


async def set_candidate_status(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    status: str,
) -> None:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    changed = await session.execute(
        update(RunCandidate)
        .where(RunCandidate.id == candidate_id, RunCandidate.run_id == run_id)
        .values(status=status)
    )
    if changed.rowcount == 0:
        raise NotFoundError("candidate")


async def add_execution(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> CandidateExecution:
    require_write(scope)
    candidate = await get_candidate(scope, session, run_id, values["candidate_id"])
    if candidate is None:
        raise NotFoundError("candidate")
    if candidate.source_fingerprint != values.get("source_fingerprint"):
        raise ValueError("execution fingerprint does not match candidate")
    row = CandidateExecution(**values)
    session.add(row)
    await session.flush()
    return row


async def get_execution(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, candidate_id: uuid.UUID
) -> CandidateExecution | None:
    return (
        await session.execute(
            select(CandidateExecution)
            .join(RunCandidate, CandidateExecution.candidate_id == RunCandidate.id)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                CandidateExecution.candidate_id == candidate_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def add_verification(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> CandidateVerification:
    require_write(scope)
    candidate = await get_candidate(scope, session, run_id, values["candidate_id"])
    if candidate is None:
        raise NotFoundError("candidate")
    execution = await get_execution(scope, session, run_id, candidate.id)
    if execution is None:
        raise NotFoundError("candidate_execution")
    if execution.id != values.get("execution_id"):
        raise ValueError("verification references a different execution")
    if not (
        candidate.source_fingerprint
        == execution.source_fingerprint
        == values.get("source_fingerprint")
    ):
        raise ValueError("verification evidence fingerprint mismatch")
    row = CandidateVerification(**values)
    session.add(row)
    await session.flush()
    return row


async def get_verification(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, candidate_id: uuid.UUID
) -> CandidateVerification | None:
    return (
        await session.execute(
            select(CandidateVerification)
            .join(RunCandidate, CandidateVerification.candidate_id == RunCandidate.id)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                CandidateVerification.candidate_id == candidate_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def get_semantic_review(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    review_id: uuid.UUID,
) -> CandidateSemanticReview | None:
    return (
        await session.execute(
            select(CandidateSemanticReview)
            .join(RunCandidate, CandidateSemanticReview.candidate_id == RunCandidate.id)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                CandidateSemanticReview.candidate_id == candidate_id,
                CandidateSemanticReview.id == review_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def latest_semantic_review(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> CandidateSemanticReview | None:
    return (
        await session.execute(
            select(CandidateSemanticReview)
            .join(RunCandidate, CandidateSemanticReview.candidate_id == RunCandidate.id)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                CandidateSemanticReview.candidate_id == candidate_id,
                Run.workspace_id == scope.workspace_id,
            )
            .order_by(CandidateSemanticReview.attempt_seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def append_semantic_review(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> CandidateSemanticReview:
    require_write(scope)
    candidate = await get_candidate(scope, session, run_id, values["candidate_id"])
    if candidate is None:
        raise NotFoundError("candidate")
    execution = await get_execution(scope, session, run_id, candidate.id)
    if execution is None:
        raise NotFoundError("candidate_execution")
    if execution.id != values.get("execution_id"):
        raise ValueError("semantic review references a different execution")
    if not (
        candidate.source_fingerprint
        == execution.source_fingerprint
        == values.get("source_fingerprint")
    ):
        raise ValueError("semantic review evidence fingerprint mismatch")
    latest = await latest_semantic_review(scope, session, run_id, candidate.id)
    expected_attempt = 1 if latest is None else latest.attempt_seq + 1
    if values.get("attempt_seq") != expected_attempt:
        raise ValueError(f"semantic review attempt must be {expected_attempt}")
    row = CandidateSemanticReview(**values)
    session.add(row)
    await session.flush()
    return row


async def latest_strict_verification(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> CandidateVerificationAttempt | None:
    return (
        await session.execute(
            select(CandidateVerificationAttempt)
            .join(RunCandidate, CandidateVerificationAttempt.candidate_id == RunCandidate.id)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                CandidateVerificationAttempt.candidate_id == candidate_id,
                Run.workspace_id == scope.workspace_id,
            )
            .order_by(CandidateVerificationAttempt.attempt_seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def append_strict_verification(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> CandidateVerificationAttempt:
    require_write(scope)
    candidate = await get_candidate(scope, session, run_id, values["candidate_id"])
    if candidate is None:
        raise NotFoundError("candidate")
    execution = await get_execution(scope, session, run_id, candidate.id)
    if execution is None:
        raise NotFoundError("candidate_execution")
    review = await get_semantic_review(
        scope,
        session,
        run_id,
        candidate.id,
        values["semantic_review_id"],
    )
    if review is None:
        raise NotFoundError("candidate_semantic_review")
    if not (
        values.get("execution_id") == execution.id == review.execution_id
        and values.get("source_fingerprint")
        == candidate.source_fingerprint
        == execution.source_fingerprint
        == review.source_fingerprint
    ):
        raise ValueError("strict verification evidence binding mismatch")
    latest = await latest_strict_verification(scope, session, run_id, candidate.id)
    expected_attempt = 1 if latest is None else latest.attempt_seq + 1
    if values.get("attempt_seq") != expected_attempt:
        raise ValueError(f"strict verification attempt must be {expected_attempt}")
    row = CandidateVerificationAttempt(**values)
    session.add(row)
    await session.flush()
    return row


async def add_conversion(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> CandidateConversion:
    require_write(scope)
    candidate = await get_candidate(scope, session, run_id, values["candidate_id"])
    if candidate is None:
        raise NotFoundError("candidate")
    verification = await get_verification(scope, session, run_id, candidate.id)
    if verification is None:
        raise NotFoundError("candidate_verification")
    if not (
        candidate.source_fingerprint
        == verification.source_fingerprint
        == values.get("source_fingerprint")
    ):
        raise ValueError("conversion evidence fingerprint mismatch")
    row = CandidateConversion(**values)
    session.add(row)
    await session.flush()
    return row


async def get_conversion(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, candidate_id: uuid.UUID
) -> CandidateConversion | None:
    return (
        await session.execute(
            select(CandidateConversion)
            .join(RunCandidate, CandidateConversion.candidate_id == RunCandidate.id)
            .join(Run, RunCandidate.run_id == Run.id)
            .where(
                RunCandidate.run_id == run_id,
                CandidateConversion.candidate_id == candidate_id,
                Run.workspace_id == scope.workspace_id,
            )
        )
    ).scalar_one_or_none()


async def set_publication(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, publication: dict[str, Any]
) -> None:
    require_write(scope)
    await _scoped_run(scope, session, run_id)
    changed = await session.execute(
        update(AgentRun)
        .where(AgentRun.run_id == run_id)
        .values(publication=publication, updated_at=func.now())
    )
    if changed.rowcount == 0:
        raise NotFoundError("agent_run")
