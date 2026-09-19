"""News persistence. Every operation establishes and predicates the newsroom scope."""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from typing import Any

from majorana_contracts import Scope
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..news_models import Article, CollectRequest, publication_errors
from ..orm import Job, NewsArticle, NewsAsset, NewsBatch, Workspace
from ._base import NotFoundError, require_admin, require_write, touched_now
from .system import JobLeaseLostError, enqueue_job


class NewsConflict(ValueError):
    pass


async def _context(scope: Scope, session: AsyncSession):
    await session.execute(
        text("select set_config('leona.news_workspace_id', :workspace, true)"),
        {"workspace": str(scope.workspace_id)},
    )


async def _fence(scope: Scope, session: AsyncSession):
    """Lock the live queue lease in the same transaction as each checkpoint."""
    await _context(scope, session)
    lease = session.info.get("news_job_lease")
    if not lease:
        raise JobLeaseLostError("news worker requires a fenced queue lease")
    job = await session.scalar(
        select(Job)
        .where(
            Job.id == lease[0],
            Job.lease_token == lease[1],
            Job.status == "running",
            Job.lease_expires_at > func.now(),
        )
        .with_for_update()
    )
    if job is None or job.payload.get("workspace_id") != str(scope.workspace_id):
        raise JobLeaseLostError("news job lease lost")


async def enqueue(
    scope: Scope, session: AsyncSession, key: str, request: CollectRequest, daily_limit: int
):
    require_admin(scope)
    await _context(scope, session)
    # Serializes budget reservations and idempotency even across API instances.
    workspace = await session.scalar(
        select(Workspace)
        .where(Workspace.id == scope.workspace_id, Workspace.deleted_at.is_(None))
        .with_for_update()
    )
    if not workspace:
        raise NotFoundError("workspace")
    previous = await session.scalar(
        select(NewsBatch).where(
            NewsBatch.workspace_id == scope.workspace_id, NewsBatch.request_key == key
        )
    )
    document = request.model_dump(mode="json")
    if previous:
        if previous.request != document:
            raise NewsConflict("idempotency key already used for a different request")
        return previous
    count = await session.scalar(
        select(func.count())
        .select_from(NewsBatch)
        .where(
            NewsBatch.workspace_id == scope.workspace_id,
            NewsBatch.created_at
            >= dt.datetime.now(dt.UTC).replace(hour=0, minute=0, second=0, microsecond=0),
        )
    )
    if count >= daily_limit:
        raise NewsConflict("daily collection limit reached")
    row = NewsBatch(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        request_key=key,
        request=document,
    )
    session.add(row)
    await session.flush()
    await enqueue_job(
        session,
        kind="news.collect",
        payload={
            "batch_id": str(row.id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
        },
        max_attempts=3,
    )
    return row


async def batch(scope: Scope, session: AsyncSession, batch_id: uuid.UUID):
    await _context(scope, session)
    row = await session.scalar(
        select(NewsBatch)
        .where(NewsBatch.id == batch_id, NewsBatch.workspace_id == scope.workspace_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise NotFoundError("news batch")
    return row


async def reserve_call(scope: Scope, session: AsyncSession, batch_id: uuid.UUID):
    require_write(scope)
    await _fence(scope, session)
    row = await batch(scope, session, batch_id)
    if row.calls >= 12:
        raise NewsConflict("batch API call limit reached")
    row.calls += 1
    row.updated_at = touched_now()
    await session.flush()


async def checkpoint(
    scope: Scope,
    session: AsyncSession,
    batch_id: uuid.UUID,
    stage: str,
    data: dict[str, Any],
    error: str | None = None,
):
    require_write(scope)
    await _fence(scope, session)
    row = await batch(scope, session, batch_id)
    row.stage = stage
    row.checkpoint = {**row.checkpoint, **data}
    row.error = error
    row.updated_at = touched_now()
    await session.flush()


async def save_article(
    scope: Scope, session: AsyncSession, batch_id: uuid.UUID, article: Article, review: dict
):
    require_write(scope)
    await _fence(scope, session)
    # The workspace lock serializes duplicate primary sources from distinct batches.
    await session.scalar(
        select(Workspace)
        .where(Workspace.id == scope.workspace_id, Workspace.deleted_at.is_(None))
        .with_for_update()
    )
    row = await session.scalar(
        select(NewsArticle).where(
            NewsArticle.workspace_id == scope.workspace_id,
            NewsArticle.event_key == article.event_key(),
        )
    )
    if row:
        if row.batch_id != batch_id:
            raise NewsConflict("duplicate primary source; an article already exists")
        if row.digest != article.digest():
            raise NewsConflict("article changed during generation")
        if row.status != "published":
            row.review = review
        await session.flush()
        return row
    row = NewsArticle(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        batch_id=batch_id,
        event_key=article.event_key(),
        document=article.model_dump(mode="json"),
        digest=article.digest(),
        review=review,
    )
    session.add(row)
    await session.flush()
    return row


async def get_article(
    scope: Scope,
    session: AsyncSession,
    article_id: uuid.UUID,
    *,
    public: bool = False,
    lock: bool = False,
):
    await _context(scope, session)
    query = select(NewsArticle).where(
        NewsArticle.workspace_id == scope.workspace_id, NewsArticle.id == article_id
    )
    if public:
        query = query.where(NewsArticle.status == "published")
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query.execution_options(populate_existing=True))
    if not row:
        raise NotFoundError("news article")
    return row


async def list_articles(
    scope: Scope,
    session: AsyncSession,
    *,
    public: bool = False,
    limit: int = 20,
    before: uuid.UUID | None = None,
    search: str = "",
    category: str = "",
):
    await _context(scope, session)
    query = select(NewsArticle).where(NewsArticle.workspace_id == scope.workspace_id)
    if public:
        query = query.where(NewsArticle.status == "published")
    if search:
        query = query.where(
            or_(
                NewsArticle.document["title"].astext.icontains(search, autoescape=True),
                NewsArticle.document["lead"].astext.icontains(search, autoescape=True),
            )
        )
    if category:
        query = query.where(NewsArticle.document["category"].astext == category)
    if before:
        query = query.where(NewsArticle.id < before)
    return list(
        (
            await session.scalars(
                query.order_by(NewsArticle.id.desc()).limit(min(max(limit, 1), 50))
            )
        ).all()
    )


async def get_asset(
    scope: Scope, session: AsyncSession, article_id: uuid.UUID, *, public: bool = False
):
    await get_article(scope, session, article_id, public=public)
    return await session.scalar(
        select(NewsAsset).where(
            NewsAsset.workspace_id == scope.workspace_id, NewsAsset.article_id == article_id
        )
    )


async def save_asset(
    scope: Scope,
    session: AsyncSession,
    article_id: uuid.UUID,
    data: bytes,
    metadata: dict,
    *,
    worker: bool = False,
):
    if worker:
        require_write(scope)
        await _fence(scope, session)
    else:
        require_admin(scope)
    article = await get_article(scope, session, article_id, lock=True)
    if article.status == "published":
        raise NewsConflict("withdraw the article before replacing its image")
    if not 1 <= len(data) <= 600000:
        raise ValueError("image must be at most 600 KB")
    asset = await get_asset(scope, session, article_id)
    if asset is None:
        asset = NewsAsset(
            id=uuid7(),
            workspace_id=scope.workspace_id,
            article_id=article_id,
            data=data,
            metadata_json=metadata,
        )
        session.add(asset)
    elif not worker:
        asset.data = data
        asset.metadata_json = metadata
    await session.flush()
    return asset


async def publish(
    scope: Scope,
    session: AsyncSession,
    article_id: uuid.UUID,
    digest: str,
    note: str,
    *,
    withdraw: bool = False,
    expected_image_digest: str | None = None,
):
    require_admin(scope)
    row = await get_article(scope, session, article_id, lock=True)
    if row.digest != digest:
        raise NewsConflict("content changed; reload before publishing")
    if not withdraw:
        errors = publication_errors(Article.model_validate(row.document), row.review, digest)
        if errors:
            raise NewsConflict(", ".join(errors))
        asset = await get_asset(scope, session, article_id)
        if not asset:
            raise NewsConflict("header image is required")
        if expected_image_digest != hashlib.sha256(asset.data).hexdigest():
            raise NewsConflict("image changed; reload before publishing")
    target = "withdrawn" if withdraw else "published"
    if row.status == target:
        return row
    now = touched_now()
    row.status = target
    if not withdraw and not row.published_at:
        row.published_at = now
    row.publication_log = [
        *row.publication_log,
        {
            "action": target,
            "at": now.isoformat(),
            "user_id": str(scope.user_id),
            "digest": digest,
            "note": note,
        },
    ]
    await session.flush()
    return row


async def asset_fingerprint(
    scope: Scope, session: AsyncSession, article_id: uuid.UUID, *, public: bool = False
):
    asset = await get_asset(scope, session, article_id, public=public)
    if not asset:
        raise NotFoundError("news image")
    return asset, hashlib.sha256(asset.data).hexdigest()


async def mark_failed(scope: Scope, session: AsyncSession, batch_id: uuid.UUID):
    require_write(scope)
    await _context(scope, session)
    failed = await session.scalar(
        select(Job)
        .where(
            Job.kind == "news.collect",
            Job.payload["batch_id"].astext == str(batch_id),
            Job.payload["workspace_id"].astext == str(scope.workspace_id),
            Job.status.in_(["dead", "failed"]),
        )
        .with_for_update()
    )
    if failed is None:
        return
    active = await session.scalar(
        select(Job.id).where(
            Job.kind == "news.collect",
            Job.payload["batch_id"].astext == str(batch_id),
            Job.status.in_(["queued", "running"]),
        )
    )
    if active:
        return
    row = await batch(scope, session, batch_id)
    if row.stage not in {"done", "held", "failed"}:
        row.stage = "failed"
        row.error = "queue_retries_exhausted"
        row.updated_at = touched_now()
        await session.flush()


async def schedule(scope: Scope, session: AsyncSession, key: str, daily_limit: int):
    from ..orm import Membership

    await _context(scope, session)
    membership = await session.scalar(
        select(Membership).where(
            Membership.workspace_id == scope.workspace_id, Membership.user_id == scope.user_id
        )
    )
    if membership is None or membership.role not in {"owner", "admin"}:
        raise NewsConflict("scheduled editor is no longer a newsroom administrator")
    return await enqueue(scope, session, key, CollectRequest(), daily_limit)


async def revise(
    scope: Scope,
    session: AsyncSession,
    article_id: uuid.UUID,
    article: Article,
    expected_digest: str,
    note: str,
):
    from sqlalchemy import delete

    require_admin(scope)
    row = await get_article(scope, session, article_id, lock=True)
    if row.status == "published" or row.digest != expected_digest:
        raise NewsConflict("withdraw and reload the article before revising")
    if article.event_key() != row.event_key:
        raise NewsConflict("a different primary source requires a new article")
    job = await session.scalar(
        select(Job).where(
            Job.kind == "news.collect",
            Job.payload["batch_id"].astext == str(row.batch_id),
            Job.status.in_(["queued", "running"]),
        )
    )
    if job:
        raise NewsConflict("generation is still active")
    batch_row = await batch(scope, session, row.batch_id)
    if not {s.url for s in article.sources} <= set(
        batch_row.checkpoint.get("research", {}).get("sources", {})
    ):
        raise NewsConflict("new sources require a new research collection")
    row.publication_log = [
        *row.publication_log,
        {
            "action": "revised",
            "at": touched_now().isoformat(),
            "user_id": str(scope.user_id),
            "note": note,
            "previous_document": row.document,
            "previous_review": row.review,
        },
    ]
    row.document = article.model_dump(mode="json")
    row.digest = article.digest()
    row.review = {}
    row.status = "draft"
    batch_row.checkpoint = {
        "research": batch_row.checkpoint["research"],
        "draft": {"document": row.document},
        "article_id": str(row.id),
    }
    batch_row.stage = "draft"
    batch_row.error = None
    # Budget is cumulative; editing never resets it.
    await session.execute(
        delete(NewsAsset).where(
            NewsAsset.workspace_id == scope.workspace_id, NewsAsset.article_id == row.id
        )
    )
    await enqueue_job(
        session,
        kind="news.collect",
        payload={
            "batch_id": str(row.batch_id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
        },
        max_attempts=3,
    )
    await session.flush()
    return row


async def auto_publish(scope: Scope, session: AsyncSession, article_id: uuid.UUID):
    """Opt-in automation retains the same checks as the human publication route."""
    import os
    from ..orm import Membership

    if os.getenv("LEONA_NEWS_AUTO_PUBLISH") != "true":
        return
    await _fence(scope, session)
    member = await session.scalar(
        select(Membership).where(
            Membership.workspace_id == scope.workspace_id, Membership.user_id == scope.user_id
        )
    )
    if member is None or member.role not in {"admin", "owner"}:
        raise NewsConflict("automatic publication requires a current newsroom administrator")
    from majorana_contracts.enums import Role

    publisher = scope.model_copy(update={"role": Role(member.role)})
    row = await get_article(publisher, session, article_id)
    asset = await get_asset(publisher, session, article_id)
    await publish(
        publisher,
        session,
        article_id,
        row.digest,
        "自動公開設定に基づき、出典検証と画像の保存を確認しました。",
        expected_image_digest=hashlib.sha256(asset.data).hexdigest() if asset else None,
    )


async def retry_collection(scope: Scope, session: AsyncSession, batch_id: uuid.UUID, key: str):
    require_admin(scope)
    await _context(scope, session)
    row = await session.scalar(
        select(NewsBatch)
        .where(NewsBatch.id == batch_id, NewsBatch.workspace_id == scope.workspace_id)
        .with_for_update()
    )
    if row is None:
        raise NotFoundError("news batch")
    previous_keys = row.checkpoint.get("retry_keys", [])
    if key in previous_keys or row.stage == "done":
        return row
    if row.stage not in {"failed", "held"} or row.calls >= 12:
        raise NewsConflict("collection is active or its call budget is exhausted")
    active = await session.scalar(
        select(Job.id).where(
            Job.kind == "news.collect",
            Job.payload["batch_id"].astext == str(batch_id),
            Job.status.in_(["queued", "running"]),
        )
    )
    if active:
        raise NewsConflict("previous job is still closing; retry shortly")
    state = {} if row.error == "duplicate_source" else dict(row.checkpoint)
    if row.stage == "held":
        state.pop("verification", None)
        state.pop("review", None)
    row.checkpoint = {**state, "retry_keys": [*previous_keys, key][-12:]}
    row.stage = "queued"
    row.error = None
    row.updated_at = touched_now()
    await enqueue_job(
        session,
        kind="news.collect",
        payload={
            "batch_id": str(batch_id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
        },
        max_attempts=3,
    )
    await session.flush()
    return row
