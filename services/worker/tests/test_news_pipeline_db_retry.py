"""A transient DB commit failure inside the news pipeline must resume, not fail closed.

Regression for Greptile P1 on PR 883: `call()`'s reserve-before-network commit,
a `remember()` checkpoint, and the initial resume-state commit can all raise a
transient SQLAlchemy/psycopg error. Left unclassified, that error would escape
`handle_news_collect` and `_process_claimed_job` (majorana_worker.__main__)
treats any unclassified exception as permanent, marking the whole batch failed
instead of resuming it from its last durable checkpoint.

No real database is used here — this exercises the classification boundary in
`handle_news_collect` directly, with a fake session and monkeypatched repo
calls standing in for the DB.
"""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from majorana_worker import news_pipeline
from majorana_worker.errors import RetryableJobError
from majorana_worker.news_pipeline import handle_news_collect


class _Row:
    def __init__(self, stage="queued", request=None, checkpoint=None):
        self.stage = stage
        self.request = request or {"brief": "test brief", "generate_image": False}
        self.checkpoint = checkpoint or {}


class _FailingCommitSession:
    """Stands in for AsyncSession: commit() raises once, on the Nth call."""

    def __init__(self, *, fail_at_call: int, exc: BaseException):
        self._fail_at_call = fail_at_call
        self._exc = exc
        self.commits = 0
        self.rollbacks = 0

    async def commit(self):
        self.commits += 1
        if self.commits == self._fail_at_call:
            raise self._exc

    async def rollback(self):
        self.rollbacks += 1


class _UnreachableEditor:
    """Any provider call here means the DB failure did not stop the pipeline."""

    async def research(self, prompt):
        raise AssertionError("must not reach the provider once a DB commit failed")

    async def structured(self, prompt, schema):
        raise AssertionError("must not reach the provider once a DB commit failed")


def _async_return(value):
    async def _fn(*args, **kwargs):
        return value

    return _fn


@pytest.fixture
def newsroom_env(monkeypatch):
    workspace_id = uuid.uuid4()
    monkeypatch.setenv("LEONA_NEWS_ENABLED", "true")
    monkeypatch.setenv("LEONA_NEWS_WORKSPACE_ID", str(workspace_id))
    return workspace_id


def _payload(workspace_id):
    return {
        "workspace_id": str(workspace_id),
        "user_id": str(uuid.uuid4()),
        "batch_id": str(uuid.uuid4()),
    }


@pytest.mark.asyncio
async def test_transient_error_on_the_initial_resume_commit_is_retryable(monkeypatch, newsroom_env):
    monkeypatch.setattr(news_pipeline.news, "batch", _async_return(_Row()))
    session = _FailingCommitSession(
        fail_at_call=1, exc=OperationalError("COMMIT", {}, Exception("connection reset"))
    )

    with pytest.raises(RetryableJobError):
        await handle_news_collect(session, _payload(newsroom_env), editor=_UnreachableEditor())


@pytest.mark.asyncio
async def test_transient_error_on_the_reserve_before_network_commit_is_retryable(
    monkeypatch, newsroom_env
):
    """The exact site Greptile flagged: call() commits its reservation before
    ever invoking the provider (news_pipeline.handle_news_collect.call)."""
    monkeypatch.setattr(news_pipeline.news, "batch", _async_return(_Row()))
    monkeypatch.setattr(news_pipeline.news, "list_articles", _async_return([]))
    monkeypatch.setattr(news_pipeline.news, "reserve_call", _async_return(None))
    # commit() is called: (1) initial resume-state commit, (2) after building
    # already_covered, (3) call()'s reserve-before-network commit — fail there.
    session = _FailingCommitSession(
        fail_at_call=3, exc=OperationalError("COMMIT", {}, Exception("connection reset"))
    )

    with pytest.raises(RetryableJobError):
        await handle_news_collect(session, _payload(newsroom_env), editor=_UnreachableEditor())
    assert session.commits == 3, "must fail exactly at the reservation commit, not later"


@pytest.mark.asyncio
async def test_a_non_transient_db_error_stays_permanent(monkeypatch, newsroom_env):
    """An IntegrityError is DBAPIError too, but retrying it reproduces the same
    failure — it must NOT be reclassified as retryable."""
    monkeypatch.setattr(news_pipeline.news, "batch", _async_return(_Row()))
    session = _FailingCommitSession(
        fail_at_call=1,
        exc=IntegrityError("COMMIT", {}, Exception("duplicate key value")),
    )

    with pytest.raises(IntegrityError):
        await handle_news_collect(session, _payload(newsroom_env), editor=_UnreachableEditor())
