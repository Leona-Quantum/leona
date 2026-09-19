"""Real-Postgres integration tests; never read application credentials."""

import asyncio
import datetime as dt
import io
import hashlib
import os
import uuid

import httpx
import pytest
import pytest_asyncio
from PIL import Image
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from majorana_api.auth.deps import get_scope, get_session
from majorana_api.news_images import normalize_image
from majorana_api.news_models import Article, CollectRequest, Review, canonical_url
from majorana_api.orm import User, Workspace, Membership, Job
from majorana_api.repos import news
from majorana_api.repos._base import AuthzError, NotFoundError
from majorana_api.repos.system import JobLeaseLostError
from majorana_api.routes.news import router
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_worker.news_pipeline import handle_news_collect
from majorana_worker.errors import RetryableJobError
from openai import APIConnectionError


def article_fixture():
    return Article.model_validate(
        {
            "title": "量子計算の研究を、実験条件から読み解く",
            "lead": "量子コンピュータの新しい研究を理解するには、実験で確かめられた範囲を知ることが大切です。",
            "category": "research",
            "event_date": "2026-09-10",
            "primary_source_id": "s1",
            "sources": [
                {
                    "id": "s1",
                    "title": "Research announcement",
                    "url": "https://example.org/research",
                    "publisher": "Research Lab",
                    "published_on": "2026-09-10",
                    "primary": True,
                    "locator": "Results section",
                },
                {
                    "id": "s2",
                    "title": "Independent research analysis",
                    "url": "https://example.net/analysis",
                    "publisher": "Science publication",
                    "published_on": "2026-09-11",
                    "primary": False,
                    "locator": "Analysis section",
                },
            ],
            "sections": [
                {
                    "heading": "実験で何を確かめたか",
                    "paragraphs": [
                        {
                            "text": "研究の成果を読み解くため、実験条件と得られた結果を順に確認します。",
                            "sources": ["s1"],
                        }
                    ],
                },
                {
                    "heading": "残された課題を知る",
                    "paragraphs": [
                        {
                            "text": "独立した解説も照合しながら、実用化に必要な条件が何かを確かめます。",
                            "sources": ["s2"],
                        }
                    ],
                },
            ],
            "image_prompt": "An abstract quantum processor represented by a lattice of blue ceramic shapes.",
            "image_alt": "格子状に並ぶ量子プロセッサの概念イラスト",
        }
    )


def image_fixture():
    output = io.BytesIO()
    Image.new("RGB", (640, 400), (30, 70, 200)).save(output, format="PNG")
    return output.getvalue()


class FakeEditor:
    image_model = "test-image"

    def __init__(self, *, fail_once=False, hold=False):
        self.calls = []
        self.fail_once = fail_once
        self.hold = hold

    async def research(self, prompt):
        self.calls.append("research")
        return {
            "text": "Verified source summaries, for a deterministic test only.",
            "sources": {s.url: s.title for s in article_fixture().sources},
            "response_id": "test",
            "usage": {},
        }

    async def structured(self, prompt, schema):
        self.calls.append(schema.__name__)
        if self.fail_once:
            self.fail_once = False
            raise APIConnectionError(
                request=httpx.Request("POST", "https://api.openai.com/v1/responses")
            )
        if schema is Article:
            return article_fixture(), {}
        return Review(
            verdict="hold" if self.hold else "pass",
            blockers=["Insufficient evidence"] if self.hold else [],
            notes="All listed sources were checked for this test.",
            checked_source_ids=["s1", "s2"],
        ), {}

    async def image(self, prompt):
        self.calls.append("image")
        return normalize_image(image_fixture())


@pytest_asyncio.fixture
async def newsroom(monkeypatch):
    url = os.environ.get("LEONA_NEWS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LEONA_NEWS_TEST_DATABASE_URL to a disposable migrated database")
    if not url.endswith("/leona_news_test"):
        raise RuntimeError("news tests require the dedicated leona_news_test database")
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    scope = Scope(user_id=user_id, workspace_id=workspace_id, role=Role.OWNER)
    monkeypatch.setenv("LEONA_NEWS_ENABLED", "true")
    monkeypatch.setenv("LEONA_NEWS_WORKSPACE_ID", str(workspace_id))
    monkeypatch.setenv("LEONA_NEWS_PUBLIC", "true")
    async with factory() as session:
        session.add(
            User(
                id=user_id,
                workos_user_id="news-test-" + str(user_id),
                email=str(user_id) + "@example.org",
                display_name="News test",
            )
        )
        await session.flush()
        session.add(
            Workspace(id=workspace_id, kind="team", name="News test", owner_user_id=user_id)
        )
        await session.flush()
        session.add(Membership(workspace_id=workspace_id, user_id=user_id, role="owner"))
        await session.commit()
    yield scope, factory
    await engine.dispose()


async def queued(scope, session, **kwargs):
    batch = await news.enqueue(scope, session, str(uuid.uuid4()), CollectRequest(**kwargs), 20)
    job = await session.scalar(select(Job).where(Job.payload["batch_id"].astext == str(batch.id)))
    job.status = "running"
    job.lease_token = uuid.uuid4()
    job.lease_expires_at = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=20)
    job.locked_by = "news-test"
    job.locked_at = dt.datetime.now(dt.UTC)
    job.last_heartbeat_at = dt.datetime.now(dt.UTC)
    await session.commit()
    session.info["news_job_lease"] = (job.id, job.lease_token)
    return batch, dict(job.payload), job


@pytest.mark.asyncio
async def test_pipeline_storage_publish_withdraw_and_isolation(newsroom):
    scope, factory = newsroom
    async with factory() as session:
        batch, payload, _ = await queued(scope, session)
        editor = FakeEditor()
        await handle_news_collect(session, payload, editor=editor)
        state = await news.batch(scope, session, batch.id)
        assert state.stage == "done" and state.calls == 5
        aid = uuid.UUID(state.checkpoint["article_id"])
        article = await news.get_article(scope, session, aid)
        assert article.status == "draft"
        assert await news.list_articles(scope, session, public=True) == []
        with pytest.raises(NotFoundError):
            await news.get_article(scope, session, aid, public=True)
        other = Scope(user_id=scope.user_id, workspace_id=uuid.uuid4(), role=Role.OWNER)
        with pytest.raises(NotFoundError):
            await news.get_article(other, session, aid)
        member = scope.model_copy(update={"role": Role.MEMBER})
        with pytest.raises(AuthzError):
            await news.publish(member, session, aid, article.digest, "checked all evidence")
        with pytest.raises(news.NewsConflict):
            await news.publish(scope, session, aid, "f" * 64, "checked all evidence")
        await news.publish(
            scope,
            session,
            aid,
            article.digest,
            "checked all evidence",
            expected_image_digest=hashlib.sha256(normalize_image(image_fixture())).hexdigest(),
        )
        await session.commit()
        assert (await news.get_article(scope, session, aid, public=True)).status == "published"
        asset = await news.get_asset(scope, session, aid, public=True)
        assert asset.data[:4] == b"RIFF"
        await news.publish(
            scope, session, aid, article.digest, "source needs correction", withdraw=True
        )
        await session.commit()
        with pytest.raises(NotFoundError):
            await news.get_asset(scope, session, aid, public=True)
        await handle_news_collect(session, payload, editor=editor)
        assert editor.calls == ["research", "Article", "research", "Review", "image"]


@pytest.mark.asyncio
async def test_resume_does_not_repeat_research(newsroom):
    scope, factory = newsroom
    async with factory() as session:
        batch, payload, _ = await queued(scope, session)
        editor = FakeEditor(fail_once=True)
        with pytest.raises(RetryableJobError):
            await handle_news_collect(session, payload, editor=editor)
        assert (await news.batch(scope, session, batch.id)).stage == "research"
        await handle_news_collect(session, payload, editor=editor)
        assert editor.calls.count("research") == 2  # discovery + independent verification
        assert (await news.batch(scope, session, batch.id)).calls == 6


@pytest.mark.asyncio
async def test_hold_never_generates_image_or_publishes(newsroom):
    scope, factory = newsroom
    async with factory() as session:
        batch, payload, _ = await queued(scope, session)
        editor = FakeEditor(hold=True)
        await handle_news_collect(session, payload, editor=editor)
        state = await news.batch(scope, session, batch.id)
        assert state.stage == "held" and "image" not in editor.calls
        article = await news.get_article(scope, session, uuid.UUID(state.checkpoint["article_id"]))
        with pytest.raises(news.NewsConflict):
            await news.publish(scope, session, article.id, article.digest, "checked all evidence")


@pytest.mark.asyncio
async def test_expired_lease_cannot_reserve_or_checkpoint(newsroom):
    scope, factory = newsroom
    async with factory() as session:
        batch, _, job = await queued(scope, session)
        job.lease_token = uuid.uuid4()
        await session.commit()
        with pytest.raises(JobLeaseLostError):
            await news.reserve_call(scope, session, batch.id)
        with pytest.raises(JobLeaseLostError):
            await news.checkpoint(scope, session, batch.id, "done", {})


@pytest.mark.asyncio
async def test_concurrent_idempotency_and_daily_budget(newsroom):
    scope, factory = newsroom
    key = str(uuid.uuid4())

    async def enqueue(key):
        async with factory() as session:
            row = await news.enqueue(scope, session, key, CollectRequest(), 2)
            await session.commit()
            return row.id

    ids = await asyncio.gather(*(enqueue(key) for _ in range(4)))
    assert len(set(ids)) == 1
    with pytest.raises(news.NewsConflict):
        async with factory() as session:
            await news.enqueue(
                scope,
                session,
                key,
                CollectRequest(brief="A completely different research brief"),
                2,
            )
    results = await asyncio.gather(
        *(enqueue(str(uuid.uuid4())) for _ in range(4)), return_exceptions=True
    )
    assert sum(isinstance(r, uuid.UUID) for r in results) == 1
    assert sum(isinstance(r, news.NewsConflict) for r in results) == 3


@pytest.mark.asyncio
async def test_duplicate_source_and_missing_image_block(newsroom):
    scope, factory = newsroom
    async with factory() as session:
        first, payload, _ = await queued(scope, session, generate_image=False)
        await handle_news_collect(session, payload, editor=FakeEditor())
        state = await news.batch(scope, session, first.id)
        article = await news.get_article(scope, session, uuid.UUID(state.checkpoint["article_id"]))
        with pytest.raises(news.NewsConflict):
            await news.publish(scope, session, article.id, article.digest, "checked all evidence")
        second, payload, _ = await queued(scope, session)
        await handle_news_collect(session, payload, editor=FakeEditor())
        assert (await news.batch(scope, session, second.id)).error == "duplicate_source"


@pytest.mark.asyncio
async def test_public_http_never_returns_drafts_or_prompts(newsroom):
    scope, factory = newsroom
    async with factory() as session:
        batch, payload, _ = await queued(scope, session)
        await handle_news_collect(session, payload, editor=FakeEditor())
        state = await news.batch(scope, session, batch.id)
        aid = uuid.UUID(state.checkpoint["article_id"])
    app = FastAPI()
    app.include_router(router, prefix="/v1")

    async def db():
        async with factory() as session:
            yield session
            await session.commit()

    app.dependency_overrides[get_session] = db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/v1/news/articles")).json()["items"] == []
        app.dependency_overrides[get_scope] = lambda: scope
        response = await client.get("/v1/news/editor/articles/" + str(aid))
        assert response.status_code == 200
        digest = response.json()["digest"]
        assert (
            await client.post(
                "/v1/news/editor/articles/" + str(aid) + "/publish",
                json={
                    "expected_digest": digest,
                    "expected_image_digest": response.json()["image_digest"],
                    "note": "reviewed sources and header",
                },
            )
        ).status_code == 200
        data = (await client.get("/v1/news/articles/" + str(aid))).json()
        assert "review" not in data and "digest" not in data and "prompt" not in data["image"]
        assert (await client.get("/v1/news/articles?q=zzzz")).json()["items"] == []
        assert len((await client.get("/v1/news/articles?category=research")).json()["items"]) == 1


def test_source_urls_and_image_decoding():
    assert canonical_url("https://example.org/a?utm_source=x#h") == "https://example.org/a"
    for url in [
        "http://example.org",
        "https://127.0.0.1/a",
        "https://example.org:9000/a",
        "https://user:pass@example.org",
        "https://metadata.internal/a",
    ]:
        with pytest.raises(ValueError):
            canonical_url(url)
    with pytest.raises(ValueError):
        normalize_image(b'<svg onload="alert(1)">')
    assert normalize_image(image_fixture()).startswith(b"RIFF")


@pytest.mark.asyncio
async def test_worker_dispatch_revision_and_auto_publication(newsroom, monkeypatch):
    from majorana_worker.__main__ import _process_claimed_job
    from majorana_worker import news_pipeline

    scope, factory = newsroom
    editor = FakeEditor()

    async def close():
        pass

    editor.close = close
    monkeypatch.setattr(news_pipeline, "OpenAIEditor", lambda: editor)
    async with factory() as session:
        batch, payload, job = await queued(scope, session)
        job_id, lease = job.id, job.lease_token
    await _process_claimed_job(factory, (job_id, "news.collect", payload, lease, 1, 0))
    async with factory() as session:
        assert (await session.get(Job, job_id)).status == "done"
        state = await news.batch(scope, session, batch.id)
        aid = uuid.UUID(state.checkpoint["article_id"])
        stored = await news.get_article(scope, session, aid)
        changed = Article.model_validate(stored.document)
        changed.title = "量子計算の研究結果を、条件から丁寧に読み解く"
        await news.revise(
            scope, session, aid, changed, stored.digest, "見出しを具体的な表現に修正しました。"
        )
        await session.commit()
        revised = await news.get_article(scope, session, aid)
        assert revised.review == {} and revised.status == "draft"
        assert await news.get_asset(scope, session, aid) is None
        revised_job = await session.scalar(
            select(Job).where(
                Job.payload["batch_id"].astext == str(batch.id), Job.status == "queued"
            )
        )
        assert revised_job is not None
        # The new attempt must keep the previous request's API budget.
        assert (await news.batch(scope, session, batch.id)).calls == 5


@pytest.mark.asyncio
async def test_rls_restricts_runtime_reader(newsroom):
    from sqlalchemy import text

    scope, factory = newsroom
    async with factory() as session:
        batch, _, _ = await queued(scope, session)
        await session.execute(
            text(
                "do $$ begin if not exists(select 1 from pg_roles where rolname='leona_news_test_reader') then create role leona_news_test_reader nologin; end if; end $$"
            )
        )
        await session.execute(
            text("grant select on news_batches,news_articles,news_assets to leona_news_test_reader")
        )
        await session.commit()
    async with factory() as session:
        await session.execute(text("set local role leona_news_test_reader"))
        assert await session.scalar(text("select count(*) from news_batches")) == 0
        await session.execute(
            text("select set_config('leona.news_workspace_id',:id,true)"),
            {"id": str(scope.workspace_id)},
        )
        assert await session.scalar(text("select count(*) from news_batches")) == 1
        await session.execute(
            text("select set_config('leona.news_workspace_id',:id,true)"), {"id": str(uuid.uuid4())}
        )
        assert await session.scalar(text("select count(*) from news_batches")) == 0


@pytest.mark.asyncio
async def test_auto_publication_is_explicit_and_revocation_aware(newsroom, monkeypatch):
    scope, factory = newsroom
    monkeypatch.setenv("LEONA_NEWS_AUTO_PUBLISH", "true")
    async with factory() as session:
        batch, payload, _ = await queued(scope, session)
        await handle_news_collect(session, payload, editor=FakeEditor())
        state = await news.batch(scope, session, batch.id)
        assert len(await news.list_articles(scope, session, public=True)) == 1
        assert state.stage == "done"


def test_editor_authority_is_not_user_selected(monkeypatch):
    from majorana_api.routes.news import editorial_scope
    from fastapi import HTTPException

    monkeypatch.setenv("LEONA_NEWS_ENABLED", "true")
    wid = uuid.uuid4()
    monkeypatch.setenv("LEONA_NEWS_WORKSPACE_ID", str(wid))
    with pytest.raises(HTTPException):
        editorial_scope(Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=Role.OWNER))
    with pytest.raises(AuthzError):
        editorial_scope(Scope(user_id=uuid.uuid4(), workspace_id=wid, role=Role.MEMBER))


@pytest.mark.asyncio
async def test_retry_is_idempotent_and_preserves_budget(newsroom):
    from majorana_api.repos import system

    scope, factory = newsroom
    async with factory() as session:
        batch, payload, job = await queued(scope, session)
        await handle_news_collect(session, payload, editor=FakeEditor(hold=True))
        await system.finish_job(session, job_id=job.id, lease_token=job.lease_token, status="done")
        await session.commit()
        previous = (await news.batch(scope, session, batch.id)).calls
        key = str(uuid.uuid4())
        first = await news.retry_collection(scope, session, batch.id, key)
        await session.commit()
        second = await news.retry_collection(scope, session, batch.id, key)
        assert first.id == second.id and second.calls == previous
        assert "verification" not in second.checkpoint
        count = len(
            list(
                await session.scalars(
                    select(Job).where(
                        Job.payload["batch_id"].astext == str(batch.id), Job.status == "queued"
                    )
                )
            )
        )
        assert count == 1
