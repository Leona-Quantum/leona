"""Scoped persistence for durable agent steps and candidate evidence."""

from __future__ import annotations

import uuid
from typing import Any

from majorana_contracts import Scope
from sqlalchemy import func, select, update

from ..db import AsyncSession
from ..orm import (
    AgentRun,
    AgentStep,
    CandidateConversion,
    CandidateExecution,
    CandidateVerification,
    Run,
    RunCandidate,
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
    row.plan_id = plan_id
    row.plan = plan
    row.updated_at = func.now()
    await session.flush()


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
    await _scoped_run(scope, session, run_id)
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
    if await get_candidate(scope, session, run_id, values["candidate_id"]) is None:
        raise NotFoundError("candidate")
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


async def add_conversion(
    scope: Scope, session: AsyncSession, run_id: uuid.UUID, values: dict[str, Any]
) -> CandidateConversion:
    require_write(scope)
    if await get_candidate(scope, session, run_id, values["candidate_id"]) is None:
        raise NotFoundError("candidate")
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
    await session.execute(
        update(AgentRun)
        .where(AgentRun.run_id == run_id)
        .values(publication=publication, updated_at=func.now())
    )
