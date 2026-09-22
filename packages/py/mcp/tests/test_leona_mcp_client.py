"""Paging, completeness, caching and failure handling of the catalog client, offline."""

from __future__ import annotations

import httpx
import pytest
from leona_mcp_fixtures import FakeCatalogApi, raw_rows

from leona_mcp import client as client_module
from leona_mcp.client import (
    API_URL_ENV,
    DEFAULT_API_URL,
    CatalogClient,
    CatalogUnavailable,
    api_url_from_env,
)


@pytest.fixture
def small_pages(monkeypatch):
    """Pages of 3, so the ten fixture rows take four requests."""
    monkeypatch.setattr(client_module, "PAGE_SIZE", 3)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_walks_every_page_and_asks_only_for_the_public_listing(small_pages):
    api = FakeCatalogApi()
    rows = await CatalogClient("https://api.example", transport=api.transport()).rows()
    assert [r.slug for r in rows] == [r["slug"] for r in raw_rows()]
    assert [(r.method, r.url.path, r.url.params["offset"]) for r in api.requests] == [
        ("GET", "/v1/catalog/entries", "0"),
        ("GET", "/v1/catalog/entries", "3"),
        ("GET", "/v1/catalog/entries", "6"),
        ("GET", "/v1/catalog/entries", "9"),
    ]
    for request in api.requests:
        assert request.url.host == "api.example"
        assert "view" not in request.url.params  # the full view: see atlas.py
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        assert request.headers["user-agent"].startswith("leona-mcp/")


async def test_a_second_read_within_the_ttl_makes_no_request():
    api = FakeCatalogApi()
    clock = Clock()
    catalog = CatalogClient(
        "https://api.example", transport=api.transport(), ttl_seconds=600, clock=clock
    )
    await catalog.rows()
    assert len(api.requests) == 1  # ten rows fit one page of 100
    clock.now += 599
    await catalog.rows()
    assert len(api.requests) == 1
    clock.now += 2
    await catalog.rows()
    assert len(api.requests) == 2


async def test_a_short_listing_is_refused_rather_than_served_partial(small_pages):
    # The server says 12, its pages hold 10, on both walks.
    api = FakeCatalogApi(total=lambda _call: 12)
    with pytest.raises(CatalogUnavailable, match="reported 12 records but its pages held 10"):
        await CatalogClient("https://api.example", transport=api.transport()).rows()


async def test_a_publication_between_pages_is_read_again_once(small_pages):
    # First walk: the count moves on page 2. Second walk: consistent.
    totals = iter([10, 11] + [10] * 10)
    api = FakeCatalogApi(total=lambda _call: next(totals))
    rows = await CatalogClient("https://api.example", transport=api.transport()).rows()
    assert len(rows) == 10
    assert len(api.requests) == 2 + 4


async def test_a_count_that_keeps_moving_gives_up_and_says_why(small_pages):
    api = FakeCatalogApi(total=lambda call: 10 + call)
    with pytest.raises(CatalogUnavailable, match="publication is in progress"):
        await CatalogClient("https://api.example", transport=api.transport()).rows()


async def test_a_server_without_the_total_header_sends_everything_at_once():
    api = FakeCatalogApi(total=lambda _call: None)
    rows = await CatalogClient("https://api.example", transport=api.transport()).rows()
    assert len(rows) == 10 and len(api.requests) == 1


async def test_duplicate_records_across_pages_are_not_served(small_pages):
    payload = raw_rows()
    payload[5] = payload[0]
    api = FakeCatalogApi(payload)
    with pytest.raises(CatalogUnavailable, match="appeared on two pages"):
        await CatalogClient("https://api.example", transport=api.transport()).rows()


@pytest.mark.parametrize("status", [404, 429, 500])
async def test_an_http_error_is_reported_in_plain_words(status):
    api = FakeCatalogApi(status=status)
    with pytest.raises(CatalogUnavailable, match=f"answered HTTP {status}"):
        await CatalogClient("https://api.example", transport=api.transport()).rows()


async def test_a_timeout_and_an_unreachable_host_are_reported():
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(CatalogUnavailable, match="did not answer in time"):
        await CatalogClient("https://api.example", transport=httpx.MockTransport(timeout)).rows()
    with pytest.raises(CatalogUnavailable, match="Could not reach"):
        await CatalogClient("https://api.example", transport=httpx.MockTransport(refused)).rows()


async def test_a_body_that_is_not_a_list_or_not_json_is_refused():
    def not_list(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"rows": []}, headers={"X-Catalog-Total": "0"})

    def not_json(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>", headers={"X-Catalog-Total": "0"})

    with pytest.raises(CatalogUnavailable, match="other than a list"):
        await CatalogClient("https://api.example", transport=httpx.MockTransport(not_list)).rows()
    with pytest.raises(CatalogUnavailable, match="not JSON"):
        await CatalogClient("https://api.example", transport=httpx.MockTransport(not_json)).rows()


async def test_a_failed_read_is_not_cached():
    calls = {"n": 0}

    def flaky(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json=raw_rows(), headers={"X-Catalog-Total": "10"})

    catalog = CatalogClient("https://api.example", transport=httpx.MockTransport(flaky))
    with pytest.raises(CatalogUnavailable):
        await catalog.rows()
    assert len(await catalog.rows()) == 10


def test_the_api_url_defaults_to_production_and_can_be_overridden(monkeypatch):
    monkeypatch.delenv(API_URL_ENV, raising=False)
    assert api_url_from_env() == DEFAULT_API_URL
    monkeypatch.setenv(API_URL_ENV, "http://localhost:8000/")
    assert api_url_from_env() == "http://localhost:8000"
    assert CatalogClient().base_url == "http://localhost:8000"
    monkeypatch.setenv(API_URL_ENV, "file:///etc/passwd")
    with pytest.raises(ValueError, match="must be an http"):
        api_url_from_env()
