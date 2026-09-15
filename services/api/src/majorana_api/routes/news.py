"""Authenticated newsroom mutations; anonymous reads only expose published rows."""

import base64
import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from majorana_contracts import Scope
from ..auth.deps import CurrentScope, DbSession
from ..news_config import daily_limit, newsroom_id, public_scope
from ..news_images import normalize_image
from ..news_models import CollectRequest, ImageRequest, PublishRequest, RevisionRequest
from ..repos import news
from ..repos._base import require_admin

router = APIRouter(prefix="/news", tags=["news"])


def editorial_scope(scope: CurrentScope) -> Scope:
    try:
        authority = newsroom_id()
    except (ValueError, KeyError):
        raise HTTPException(404, "newsroom unavailable") from None
    if scope.workspace_id != authority:
        raise HTTPException(404, "newsroom unavailable")
    require_admin(scope)
    return scope


def reader_scope() -> Scope:
    try:
        return public_scope()
    except (ValueError, KeyError):
        raise HTTPException(404, "news unavailable") from None


Editor = Annotated[Scope, Depends(editorial_scope)]
Reader = Annotated[Scope, Depends(reader_scope)]


def _batch(row):
    return {
        "id": str(row.id),
        "stage": row.stage,
        "calls": row.calls,
        "error": row.error,
        "article_id": row.checkpoint.get("article_id"),
        "updated_at": row.updated_at.isoformat(),
    }


async def _article(scope, session, row, public=False, summary=False):
    asset = await news.get_asset(scope, session, row.id, public=public)
    result = {
        "id": str(row.id),
        "document": {
            k: v for k, v in row.document.items() if k not in {"image_prompt", "image_alt"}
        }
        if public
        else row.document,
        "published_at": row.published_at.isoformat() if row.published_at else None,
        "created_at": row.created_at.isoformat(),
        "image": {
            k: v
            for k, v in asset.metadata_json.items()
            if k in {"kind", "credit", "source_url", "license_url", "alt"}
        }
        if asset
        else None,
    }
    if summary:
        result["document"] = {
            k: v
            for k, v in result["document"].items()
            if k in {"title", "lead", "category", "event_date"}
        }
    result["corrections"] = [
        {"at": entry["at"], "note": entry["note"]}
        for entry in row.publication_log
        if entry.get("action") == "revised"
    ]
    if not public:
        result["image_digest"] = hashlib.sha256(asset.data).hexdigest() if asset else None
        result.update(
            status=row.status,
            digest=row.digest,
            review=row.review,
            publication_log=row.publication_log,
            batch_id=str(row.batch_id),
        )
    return result


@router.post("/collections", status_code=202)
async def collect(
    body: CollectRequest,
    scope: Editor,
    session: DbSession,
    idempotency_key: Annotated[str, Header(min_length=8, max_length=120)],
):
    try:
        row = await news.enqueue(scope, session, idempotency_key, body, daily_limit())
    except news.NewsConflict as exc:
        raise HTTPException(409, str(exc)) from None
    return _batch(row)


@router.get("/collections/{batch_id}")
async def collection(batch_id: uuid.UUID, scope: Editor, session: DbSession):
    return _batch(await news.batch(scope, session, batch_id))


@router.get("/editor/articles")
async def drafts(
    scope: Editor,
    session: DbSession,
    before: uuid.UUID | None = None,
    limit: int = Query(20, ge=1, le=50),
    q: str = Query("", max_length=100),
    category: str = Query("", pattern="^(research|industry|policy|products|guide)?$"),
):
    rows = await news.list_articles(
        scope, session, before=before, limit=limit, search=q, category=category
    )
    return {
        "items": [await _article(scope, session, r, summary=True) for r in rows],
        "next_cursor": str(rows[-1].id) if len(rows) == limit else None,
    }


@router.get("/editor/articles/{article_id}")
async def draft(article_id: uuid.UUID, scope: Editor, session: DbSession):
    return await _article(scope, session, await news.get_article(scope, session, article_id))


@router.put("/editor/articles/{article_id}/image")
async def upload_image(
    article_id: uuid.UUID, body: ImageRequest, scope: Editor, session: DbSession
):
    try:
        data = normalize_image(base64.b64decode(body.data_base64, validate=True))
        await news.save_asset(
            scope,
            session,
            article_id,
            data,
            {
                "kind": "original",
                "credit": body.credit,
                "source_url": body.source_url,
                "license_url": body.license_url,
                "permission_note": body.permission_note,
                "alt": body.alt,
            },
        )
    except (ValueError, news.NewsConflict) as exc:
        raise HTTPException(422, str(exc)) from None
    return {"saved": True}


@router.post("/editor/articles/{article_id}/publish")
async def publish(article_id: uuid.UUID, body: PublishRequest, scope: Editor, session: DbSession):
    try:
        row = await news.publish(
            scope,
            session,
            article_id,
            body.expected_digest,
            body.note,
            expected_image_digest=body.expected_image_digest,
        )
    except (ValueError, news.NewsConflict) as exc:
        raise HTTPException(409, str(exc)) from None
    return await _article(scope, session, row)


@router.post("/editor/articles/{article_id}/withdraw")
async def withdraw(article_id: uuid.UUID, body: PublishRequest, scope: Editor, session: DbSession):
    try:
        row = await news.publish(
            scope, session, article_id, body.expected_digest, body.note, withdraw=True
        )
    except news.NewsConflict as exc:
        raise HTTPException(409, str(exc)) from None
    return await _article(scope, session, row)


async def _image(scope, session, article_id, public):
    asset, digest = await news.asset_fingerprint(scope, session, article_id, public=public)
    return Response(
        asset.data,
        media_type="image/webp",
        headers={
            "Cache-Control": "no-store",
            "ETag": f'"{digest}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/editor/articles/{article_id}/image")
async def draft_image(article_id: uuid.UUID, scope: Editor, session: DbSession):
    return await _image(scope, session, article_id, False)


@router.get("/articles")
async def published(
    scope: Reader,
    session: DbSession,
    before: uuid.UUID | None = None,
    limit: int = Query(20, ge=1, le=50),
    q: str = Query("", max_length=100),
    category: str = Query("", pattern="^(research|industry|policy|products|guide)?$"),
):
    rows = await news.list_articles(
        scope, session, public=True, before=before, limit=limit, search=q, category=category
    )
    return {
        "items": [await _article(scope, session, r, True, summary=True) for r in rows],
        "next_cursor": str(rows[-1].id) if len(rows) == limit else None,
    }


@router.get("/articles/{article_id}")
async def published_article(article_id: uuid.UUID, scope: Reader, session: DbSession):
    return await _article(
        scope, session, await news.get_article(scope, session, article_id, public=True), True
    )


@router.get("/articles/{article_id}/image")
async def published_image(article_id: uuid.UUID, scope: Reader, session: DbSession):
    return await _image(scope, session, article_id, True)


@router.put("/editor/articles/{article_id}")
async def revise(article_id: uuid.UUID, body: RevisionRequest, scope: Editor, session: DbSession):
    try:
        row = await news.revise(
            scope, session, article_id, body.article, body.expected_digest, body.note
        )
    except news.NewsConflict as exc:
        raise HTTPException(409, str(exc)) from None
    return await _article(scope, session, row)


@router.post("/collections/{batch_id}/retry", status_code=202)
async def retry(
    batch_id: uuid.UUID,
    scope: Editor,
    session: DbSession,
    idempotency_key: Annotated[str, Header(min_length=8, max_length=120)],
):
    try:
        return _batch(await news.retry_collection(scope, session, batch_id, idempotency_key))
    except news.NewsConflict as exc:
        raise HTTPException(409, str(exc)) from None
