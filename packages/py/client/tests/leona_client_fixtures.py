"""Shared test data: ten real catalog rows, and a fake API that serves them.

The rows are real (see `_about` in fixtures/catalog_rows.json), so a test that
reads a verdict off one of them is reading what production serves, not a record
shaped to make the test pass.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from leona_client.atlas import AtlasRow, parse_rows

FIXTURE = Path(__file__).parent / "fixtures" / "catalog_rows.json"


def raw_rows() -> list[dict[str, Any]]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["rows"]


def rows() -> list[AtlasRow]:
    parsed, rejected = parse_rows(raw_rows())
    assert not rejected
    return parsed


def row(slug: str) -> AtlasRow:
    for candidate in rows():
        if candidate.slug == slug:
            return candidate
    raise KeyError(slug)


def record(slug: str) -> dict[str, Any]:
    return dict(row(slug).record)


class FakeCatalogApi:
    """Serves `GET /v1/catalog/entries?limit=&offset=` the way the real route pages.

    `requests` records every request, so a test can assert that nothing else was
    asked for and that no credential was sent.
    """

    def __init__(
        self,
        payload: list[dict[str, Any]] | None = None,
        *,
        total: Callable[[int], int | None] | None = None,
        status: int = 200,
    ) -> None:
        self.payload = raw_rows() if payload is None else payload
        self.total = total or (lambda _call: len(self.payload))
        self.status = status
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"detail": "nope"})
        limit = int(request.url.params.get("limit", "500"))
        offset = int(request.url.params.get("offset", "0"))
        headers = {}
        total = self.total(len(self.requests))
        if total is not None:
            headers["X-Catalog-Total"] = str(total)
        return httpx.Response(200, json=self.payload[offset : offset + limit], headers=headers)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)
