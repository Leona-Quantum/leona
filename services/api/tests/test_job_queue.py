"""DB-free checks for fenced job leases, recovery, and bounded retries."""

import datetime as dt
import uuid

import pytest
from sqlalchemy.dialects import postgresql

from majorana_api.orm import Job
from majorana_api.repos import system


class _Result:
    def __init__(self, *, rows=(), rowcount=0):
        self._rows = list(rows)
        self.rowcount = rowcount

    def scalars(self):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows


class _Session:
    def __init__(self, *results):
        self.results = list(results)
        self.statements = []
        self.added = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.results.pop(0)

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        return None


def _job(*, status="queued", attempts=0, max_attempts=3, lease_token=None):
    return Job(
        id=uuid.uuid4(),
        kind="run.execute",
        payload={"run_id": str(uuid.uuid4())},
        status=status,
        run_id=None,
        attempts=attempts,
        max_attempts=max_attempts,
        locked_by="worker" if status == "running" else None,
        locked_at=dt.datetime.now(dt.timezone.utc) if status == "running" else None,
        lease_token=lease_token,
        lease_expires_at=(
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=1)
            if status == "running"
            else None
        ),
        last_heartbeat_at=None,
        run_after=dt.datetime.now(dt.timezone.utc),
        last_error=None,
        last_error_kind=None,
        dead_lettered_at=None,
        dead_letter_error=None,
        dead_letter_attempts=0,
        dead_letter_locked_by=None,
        dead_letter_lease_token=None,
        dead_letter_lease_expires_at=None,
    )


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


async def test_enqueue_bounds_attempts():
    session = _Session()
    job = await system.enqueue_job(session, kind="run.execute", payload={}, max_attempts=5)
    assert job.max_attempts == 5
    assert session.added == [job]

    with pytest.raises(ValueError, match="max_attempts"):
        await system.enqueue_job(session, kind="run.execute", payload={}, max_attempts=0)


async def test_claim_assigns_new_fenced_lease_and_attempt():
    job = _job()
    session = _Session(_Result(rows=[job]), _Result(rowcount=1))

    claimed = await system.claim_job(session, worker_id="worker-a", lease_seconds=30)

    assert claimed is job
    assert job.status == "running"
    assert job.locked_by == "worker-a"
    assert job.lease_token is not None
    assert job.attempts == 1
    update_sql = _sql(session.statements[1])
    assert "lease_token" in update_sql and "lease_expires_at" in update_sql


async def test_heartbeat_fails_closed_after_lease_loss():
    session = _Session(_Result(rowcount=0))
    renewed = await system.heartbeat_job(
        session,
        job_id=uuid.uuid4(),
        lease_token=uuid.uuid4(),
        lease_seconds=30,
    )
    assert renewed is False
    sql = _sql(session.statements[0])
    assert "lease_token" in sql and "lease_expires_at" in sql


async def test_finish_requires_current_lease_token():
    session = _Session(_Result(rowcount=0))
    with pytest.raises(system.JobLeaseLostError):
        await system.finish_job(
            session,
            job_id=uuid.uuid4(),
            lease_token=uuid.uuid4(),
            status="done",
        )
    assert "jobs.lease_expires_at > now()" in _sql(session.statements[0])


async def test_stale_recovery_requeues_or_dead_letters_by_attempt_budget():
    dead = _job(status="running", attempts=3, max_attempts=3, lease_token=uuid.uuid4())
    session = _Session(_Result(rows=[dead]), _Result(rowcount=2))

    recovered = await system.recover_stale_jobs(session)

    assert recovered.requeued == 2
    assert recovered.dead_jobs == (dead,)
    assert all("lease_expires_at" in _sql(stmt) for stmt in session.statements)


async def test_retry_uses_exponential_delay_then_dead_letters_at_limit():
    lease_token = uuid.uuid4()
    retryable = _job(status="running", attempts=2, max_attempts=3, lease_token=lease_token)
    session = _Session(_Result(rows=[retryable]), _Result(rowcount=1))

    status, delay = await system.retry_job(
        session,
        job_id=retryable.id,
        lease_token=lease_token,
        last_error="temporary",
        last_error_kind="retryable",
        base_delay_seconds=5,
        max_delay_seconds=60,
    )
    assert (status, delay) == ("queued", 10)
    assert "jobs.lease_expires_at > now()" in _sql(session.statements[0])
    assert "jobs.lease_expires_at > now()" in _sql(session.statements[1])

    exhausted_token = uuid.uuid4()
    exhausted = _job(status="running", attempts=3, max_attempts=3, lease_token=exhausted_token)
    terminal_session = _Session(_Result(rows=[exhausted]), _Result(rowcount=1))
    status, delay = await system.retry_job(
        terminal_session,
        job_id=exhausted.id,
        lease_token=exhausted_token,
        last_error="still temporary",
        last_error_kind="retryable",
    )
    assert (status, delay) == ("dead", 0)


async def test_retry_rejects_an_expired_matching_token():
    session = _Session(_Result(rows=[]))
    with pytest.raises(system.JobLeaseLostError):
        await system.retry_job(
            session,
            job_id=uuid.uuid4(),
            lease_token=uuid.uuid4(),
            last_error="late",
            last_error_kind="retryable",
        )
    assert "jobs.lease_expires_at > now()" in _sql(session.statements[0])


async def test_dead_letter_delivery_is_idempotently_marked():
    delivery_token = uuid.uuid4()
    session = _Session(_Result(rowcount=1))
    assert (
        await system.mark_job_dead_lettered(
            session, job_id=uuid.uuid4(), delivery_token=delivery_token
        )
        is True
    )

    raced = _Session(_Result(rowcount=0))
    assert (
        await system.mark_job_dead_lettered(
            raced, job_id=uuid.uuid4(), delivery_token=delivery_token
        )
        is False
    )

    failed_callback = _Session(_Result(rowcount=1))
    assert (
        await system.mark_job_dead_lettered(
            failed_callback,
            job_id=uuid.uuid4(),
            delivery_token=delivery_token,
            error="callback unavailable",
            retry_delay_seconds=15,
        )
        is True
    )
    sql = _sql(failed_callback.statements[0])
    assert "dead_letter_attempts" in sql and "run_after" in sql
    assert "CASE WHEN" in sql and "dead_lettered_at" in sql
    assert "dead_letter_lease_token" in sql and "dead_letter_lease_expires_at" in sql


async def test_dead_letter_claim_is_skip_locked_and_fenced():
    job = _job(status="dead", attempts=3, max_attempts=3)
    session = _Session(_Result(rows=[job]), _Result(rowcount=1))

    claimed = await system.claim_pending_dead_letter(
        session, worker_id="worker-a", lease_seconds=45
    )

    assert claimed is job
    assert job.dead_letter_locked_by == "worker-a"
    assert job.dead_letter_lease_token is not None
    claim_sql = _sql(session.statements[0])
    assert "FOR UPDATE SKIP LOCKED" in claim_sql
    assert "dead_letter_lease_expires_at" in claim_sql
    update_sql = _sql(session.statements[1])
    assert "dead_letter_lease_token" in update_sql


async def test_dead_letter_retry_budget_is_bounded():
    delivery_token = uuid.uuid4()
    session = _Session(_Result(rowcount=1))
    await system.mark_job_dead_lettered(
        session,
        job_id=uuid.uuid4(),
        delivery_token=delivery_token,
        error="callback unavailable",
        max_delivery_attempts=5,
    )
    sql = _sql(session.statements[0])
    assert "dead_letter_attempts" in sql
    assert "dead_lettered_at" in sql
    assert "CASE WHEN" in sql

    with pytest.raises(ValueError, match="max_delivery_attempts"):
        await system.mark_job_dead_lettered(
            _Session(),
            job_id=uuid.uuid4(),
            delivery_token=delivery_token,
            error="callback unavailable",
            max_delivery_attempts=0,
        )
