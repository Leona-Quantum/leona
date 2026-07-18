"""Postgres contention tests for fenced Dead Letter callback reservations."""

import datetime as dt
import os
import uuid

import pytest
from sqlalchemy import func, select, update

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Job
from majorana_api.repos import system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="job queue contention needs DATABASE_URL"
)


@pytest.fixture
async def factory():
    engine = engine_from_env()
    try:
        yield session_factory(engine)
    finally:
        await engine.dispose()


async def _terminal_job(factory) -> uuid.UUID:
    async with factory() as session:
        job = await system.enqueue_job(session, kind="test.dead-letter", payload={})
        job.status = "dead"
        await session.commit()
        return job.id


async def _running_job(factory) -> tuple[uuid.UUID, uuid.UUID]:
    job_id = uuid.uuid4()
    lease_token = uuid.uuid4()
    now = dt.datetime.now(dt.timezone.utc)
    async with factory() as session:
        session.add(
            Job(
                id=job_id,
                kind="test.running",
                payload={},
                status="running",
                attempts=1,
                max_attempts=3,
                locked_by="late-worker",
                locked_at=now,
                lease_token=lease_token,
                lease_expires_at=now + dt.timedelta(seconds=45),
            )
        )
        await session.commit()
    return job_id, lease_token


@requires_db
async def test_two_workers_cannot_reserve_the_same_dead_letter(factory):
    job_id = await _terminal_job(factory)

    async with factory() as first_session, factory() as second_session:
        first = await system.claim_pending_dead_letter(
            first_session, worker_id="worker-a", lease_seconds=45
        )
        second = await system.claim_pending_dead_letter(
            second_session, worker_id="worker-b", lease_seconds=45
        )
        assert first is not None and first.id == job_id
        assert second is None
        first_token = first.dead_letter_lease_token
        assert first_token is not None
        await first_session.commit()

    async with factory() as session:
        assert (
            await system.mark_job_dead_lettered(
                session,
                job_id=job_id,
                delivery_token=uuid.uuid4(),
            )
            is False
        )
        assert (
            await system.mark_job_dead_lettered(
                session,
                job_id=job_id,
                delivery_token=first_token,
            )
            is True
        )
        await session.commit()
        delivered = await session.get(Job, job_id)
        assert delivered is not None
        assert delivered.dead_lettered_at is not None
        assert delivered.dead_letter_lease_token is None


@requires_db
async def test_expired_dead_letter_reservation_is_reclaimable(factory):
    job_id = await _terminal_job(factory)
    async with factory() as session:
        first = await system.claim_pending_dead_letter(
            session, worker_id="crashed-worker", lease_seconds=45
        )
        assert first is not None
        first_token = first.dead_letter_lease_token
        await session.commit()

    async with factory() as session:
        await session.execute(
            update(Job).where(Job.id == job_id).values(dead_letter_lease_expires_at=func.now())
        )
        await session.commit()

    async with factory() as session:
        reclaimed = await system.claim_pending_dead_letter(
            session, worker_id="replacement-worker", lease_seconds=45
        )
        assert reclaimed is not None and reclaimed.id == job_id
        assert reclaimed.dead_letter_lease_token != first_token
        await session.commit()

        persisted_token = await session.scalar(
            select(Job.dead_letter_lease_token).where(Job.id == job_id)
        )
        assert persisted_token == reclaimed.dead_letter_lease_token


@requires_db
async def test_expired_matching_job_token_cannot_finish_or_retry(factory):
    job_id, lease_token = await _running_job(factory)
    async with factory() as session:
        await session.execute(
            update(Job).where(Job.id == job_id).values(lease_expires_at=func.now())
        )
        await session.commit()

    async with factory() as session:
        with pytest.raises(system.JobLeaseLostError):
            await system.finish_job(
                session,
                job_id=job_id,
                lease_token=lease_token,
                status="done",
            )
        with pytest.raises(system.JobLeaseLostError):
            await system.retry_job(
                session,
                job_id=job_id,
                lease_token=lease_token,
                last_error="late",
                last_error_kind="retryable",
            )
        persisted = await session.get(Job, job_id)
        assert persisted is not None and persisted.status == "running"
        await session.rollback()

    async with factory() as session:
        recovery = await system.recover_stale_jobs(session)
        assert recovery.requeued == 1
        await session.commit()
