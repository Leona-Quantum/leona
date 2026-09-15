"""The in-process page cache in front of `GET /v1/catalog/entries` (routes/catalog.py).

Why it exists is on `CATALOG_LIST_PAGE_CACHE_TTL_SECONDS`: on 2026-09-15 the
listing was requested ~250 times a second, each request ran two database reads,
Cloud SQL sat at 100% CPU, and Cloud Run refused 80% of all API traffic. These
tests pin the four properties that made the cache a fix rather than a new
failure: repeated reads skip the database, concurrent cold reads share ONE load,
pages and views never share a slot, and nothing outlives its TTL or a failed load.

Called directly with the repository layer doubled out, the same pattern as
test_catalog_cache_control.py, so no database is needed.
"""

import asyncio
import datetime as dt
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import Response
from majorana_contracts import PublicCatalogEntry

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.repos import catalog as catalog_repo
from majorana_api.routes import catalog as catalog_routes
from majorana_api.settings import Settings

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


@pytest.fixture(autouse=True)
def _empty_cache():
    catalog_routes._LIST_PAGE_CACHE.clear()
    yield
    catalog_routes._LIST_PAGE_CACHE.clear()


def _authority() -> CatalogAuthority:
    return CatalogAuthority(
        enabled=True,
        workspace_id=uuid.uuid4(),
        importer_user_id=uuid.uuid4(),
        public_reader_user_id=uuid.uuid4(),
    )


def _entry(slug: str) -> PublicCatalogEntry:
    return PublicCatalogEntry(
        slug=slug,
        execution_state="template_only",
        updated_at=dt.datetime.now(dt.timezone.utc),
    )


async def _call(authority: CatalogAuthority, **params) -> tuple[list[PublicCatalogEntry], Response]:
    response = Response()
    entries = await catalog_routes.list_catalog_entries(
        scope=authority.public_scope(),
        session=None,
        settings=Settings(**SETTINGS_KWARGS, catalog_authority=authority),
        response=response,
        view=params.get("view", "full"),
        limit=params.get("limit", 100),
        offset=params.get("offset", 0),
    )
    return entries, response


def _double_repo(monkeypatch, total: int = 2, entries=None):
    count = AsyncMock(return_value=total)
    listing = AsyncMock(return_value=entries if entries is not None else [_entry("a"), _entry("b")])
    monkeypatch.setattr(catalog_repo, "count_public_catalog_entries", count)
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", listing)
    return count, listing


async def test_a_repeated_page_is_served_without_touching_the_database(monkeypatch):
    count, listing = _double_repo(monkeypatch)
    authority = _authority()

    first, first_response = await _call(authority)
    second, second_response = await _call(authority)

    assert count.await_count == 1
    assert listing.await_count == 1
    assert [e.slug for e in second] == [e.slug for e in first] == ["a", "b"]
    # The completeness header the web client checks must be on a cache hit too,
    # or a paginating client reads a hit as a pre-pagination server.
    assert first_response.headers[catalog_routes.CATALOG_TOTAL_HEADER] == "2"
    assert second_response.headers[catalog_routes.CATALOG_TOTAL_HEADER] == "2"
    assert second_response.headers["cache-control"].startswith("public, max-age=")


async def test_concurrent_cold_requests_share_one_database_load(monkeypatch):
    authority = _authority()
    started = asyncio.Event()

    async def slow_list(*_args, **_kwargs):
        started.set()
        await asyncio.sleep(0.05)
        return [_entry("a")]

    count = AsyncMock(return_value=1)
    listing = AsyncMock(side_effect=slow_list)
    monkeypatch.setattr(catalog_repo, "count_public_catalog_entries", count)
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", listing)

    results = await asyncio.gather(*(_call(authority) for _ in range(25)))

    assert listing.await_count == 1
    assert count.await_count == 1
    assert all([e.slug for e in entries] == ["a"] for entries, _ in results)
    assert catalog_routes._LIST_PAGE_CACHE._locks == {}


async def test_pages_views_and_workspaces_never_share_a_slot(monkeypatch):
    count, listing = _double_repo(monkeypatch, total=0, entries=[])
    authority = _authority()

    await _call(authority, offset=0)
    await _call(authority, offset=100)
    await _call(authority, offset=0, view="list")
    await _call(authority, offset=0, limit=50)
    await _call(_authority(), offset=0)

    assert listing.await_count == 5
    offsets = [call.kwargs["offset"] for call in listing.await_args_list]
    assert offsets == [0, 100, 0, 0, 0]


async def test_limit_and_offset_are_clamped_before_they_become_a_key(monkeypatch):
    _count, listing = _double_repo(monkeypatch, total=0, entries=[])
    authority = _authority()

    await _call(authority, limit=10_000, offset=-5)
    await _call(authority, limit=catalog_routes.CATALOG_ENTRIES_MAX_LIMIT, offset=0)

    assert listing.await_count == 1


async def test_an_expired_page_is_loaded_again(monkeypatch):
    _count, listing = _double_repo(monkeypatch)
    authority = _authority()
    clock = [1000.0]
    monkeypatch.setattr(catalog_routes, "_now", lambda: clock[0])

    await _call(authority)
    clock[0] += catalog_routes.CATALOG_LIST_PAGE_CACHE_TTL_SECONDS - 0.001
    await _call(authority)
    assert listing.await_count == 1

    clock[0] += 0.002
    await _call(authority)
    assert listing.await_count == 2


async def test_a_failed_load_is_not_cached(monkeypatch):
    authority = _authority()
    count = AsyncMock(side_effect=[RuntimeError("database unavailable"), 1])
    listing = AsyncMock(return_value=[_entry("a")])
    monkeypatch.setattr(catalog_repo, "count_public_catalog_entries", count)
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", listing)

    with pytest.raises(RuntimeError):
        await _call(authority)
    entries, _response = await _call(authority)

    assert [e.slug for e in entries] == ["a"]
    assert count.await_count == 2
    assert catalog_routes._LIST_PAGE_CACHE._locks == {}


async def test_the_cache_is_bounded(monkeypatch):
    _count, listing = _double_repo(monkeypatch, total=0, entries=[])
    authority = _authority()
    bound = catalog_routes.CATALOG_LIST_PAGE_CACHE_MAX_ENTRIES

    for offset in range(bound + 10):
        await _call(authority, offset=offset)

    assert len(catalog_routes._LIST_PAGE_CACHE._values) == bound
    # The oldest pages were evicted, so asking for offset 0 again loads it.
    before = listing.await_count
    await _call(authority, offset=0)
    assert listing.await_count == before + 1


def test_the_in_process_ttl_is_inside_the_shared_cache_window():
    assert (
        catalog_routes.CATALOG_LIST_PAGE_CACHE_TTL_SECONDS
        < catalog_routes.CATALOG_CACHE_MAX_AGE_SECONDS
    )
