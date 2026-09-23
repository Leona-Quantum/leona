"""Reading the Atlas from Leona's public API.

Moved here from `leona_mcp.client` in proposal 7 Phase D, unchanged: `leona-mcp`'s
Atlas tools and `leona_client.Client`'s Atlas convenience methods now share this one
fetch implementation instead of each having their own.

One endpoint, anonymous and read-only: `GET /v1/catalog/entries`
(`services/api/src/majorana_api/routes/catalog.py`). It takes no credential, and
this module sends none. Nothing else on the network is contacted.

The full view is read, not `?view=list`, because the list projection drops every
`resources` row except "Qubits" (see the module docstring of `atlas.py`), and the
finder's rules read five other rows.

Paging follows `collectCatalogPages` in `apps/web/lib/catalog-pagination.ts`: pages
of 100, the server's `X-Catalog-Total` header as the completeness check, and a
refusal rather than a partial Atlas when the pages do not add up or any row has no
readable record. A partial catalog looks exactly like a complete one to whoever
reads it, so this never serves one.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from collections.abc import Callable

import httpx

from . import __version__
from .atlas import AtlasRow, parse_rows

logger = logging.getLogger(__name__)

#: The production API. `leona_notebooks` defaults to `https://api.leonaqt.com`, but
#: that name does not resolve (NXDOMAIN, noted in
#: `services/api/src/majorana_api/rate_limit.py`), so this uses the Cloud Run URL the
#: site's own renderer and `deploy-news.yml` use.
DEFAULT_API_URL = "https://majorana-api-nikekeixtq-uw.a.run.app"
API_URL_ENV = "LEONA_API_URL"

ENTRIES_PATH = "/v1/catalog/entries"
TOTAL_HEADER = "X-Catalog-Total"

#: `CATALOG_PAGE_SIZE` in apps/web/lib/catalog-pagination.ts.
PAGE_SIZE = 100
#: A backstop against a server that never finishes: 5,000 records.
MAX_PAGES = 50

#: How long one read of the Atlas is reused. The API marks these responses
#: `public, max-age=300` and records change only when an operator publishes, so ten
#: minutes costs a reader at most one publication's lag.
CACHE_TTL_SECONDS = 600.0

HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

USER_AGENT = f"leona-mcp/{__version__} (+https://github.com/Leona-Quantum/leona)"


class CatalogUnavailable(RuntimeError):
    """The Atlas could not be read in full. The message says why, in plain words."""


def api_url_from_env() -> str:
    raw = os.environ.get(API_URL_ENV, "").strip() or DEFAULT_API_URL
    url = raw.rstrip("/")
    if not url.startswith(("https://", "http://")):
        raise ValueError(f"{API_URL_ENV} must be an http(s) URL, got {raw!r}")
    return url


class CatalogClient:
    """The whole Atlas, fetched on first use and reused for `ttl_seconds`."""

    def __init__(
        self,
        base_url: str | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        ttl_seconds: float = CACHE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.base_url = (base_url or api_url_from_env()).rstrip("/")
        self._transport = transport
        self._ttl = ttl_seconds
        self._clock = clock
        self._rows: list[AtlasRow] | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def rows(self) -> list[AtlasRow]:
        if self._rows is not None and self._clock() < self._expires_at:
            return self._rows
        async with self._lock:
            if self._rows is not None and self._clock() < self._expires_at:
                return self._rows
            rows = await self._fetch_all()
            self._rows = rows
            self._expires_at = self._clock() + self._ttl
            return rows

    async def _fetch_all(self) -> list[AtlasRow]:
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=HTTP_TIMEOUT,
            transport=self._transport,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            follow_redirects=False,
        ) as http:
            try:
                return await self._walk(http)
            except _CatalogChanged as first:
                # A publication landed between two pages. One more walk reads the new
                # state whole; if that also fails, say so rather than loop.
                logger.info("reading the Atlas again: %s", first)
                try:
                    return await self._walk(http)
                except _CatalogChanged as exc:
                    raise CatalogUnavailable(
                        f"The Atlas could not be read as one complete, consistent whole ({exc}). "
                        "Not answering from part of it. If a publication is in progress, try "
                        "again in a minute."
                    ) from exc

    async def _walk(self, http: httpx.AsyncClient) -> list[AtlasRow]:
        collected: list[object] = []
        total: int | None = None
        for page in range(MAX_PAGES):
            response = await self._get(http, page * PAGE_SIZE)
            try:
                payload = response.json()
            except ValueError as exc:
                raise CatalogUnavailable(
                    f"The Atlas API answered page {page + 1} with something that is not JSON."
                ) from exc
            if not isinstance(payload, list):
                raise CatalogUnavailable(
                    f"The Atlas API answered page {page + 1} with something other than a list."
                )
            collected.extend(payload)
            page_total = _parse_total(response.headers.get(TOTAL_HEADER))
            if page == 0:
                if page_total is None:
                    # A server that predates pagination sends the whole corpus at once.
                    break
                total = page_total
            elif page_total is None:
                raise CatalogUnavailable(
                    f"The Atlas API stopped reporting its record count on page {page + 1}."
                )
            elif page_total != total:
                raise _CatalogChanged(
                    f"the record count moved from {total} to {page_total} between pages"
                )
            if total is not None and len(collected) >= total:
                break
            if not payload:
                break
        if total is not None and len(collected) != total:
            raise _CatalogChanged(
                f"the API reported {total} records but its pages held {len(collected)}"
            )
        rows, rejected = parse_rows(collected)
        if rejected:
            # A published entry whose record is null or has no title still counts toward
            # X-Catalog-Total, so the count check above passes. Dropping it and serving
            # the rest would be answering from a partial Atlas, so it fails the read the
            # same way a short count does, and nothing is cached.
            shown = ", ".join(rejected[:10])
            more = f" and {len(rejected) - 10} more" if len(rejected) > 10 else ""
            raise _CatalogChanged(
                f"{len(rejected)} published row(s) had no readable record: {shown}{more}"
            )
        slugs = [row.slug for row in rows]
        if len(set(slugs)) != len(slugs):
            raise _CatalogChanged("a record appeared on two pages")
        return rows

    async def _get(self, http: httpx.AsyncClient, offset: int) -> httpx.Response:
        try:
            response = await http.get(ENTRIES_PATH, params={"limit": PAGE_SIZE, "offset": offset})
        except httpx.TimeoutException as exc:
            raise CatalogUnavailable(
                f"The Atlas API at {self.base_url} did not answer in time."
            ) from exc
        except httpx.HTTPError as exc:
            raise CatalogUnavailable(
                f"Could not reach the Atlas API at {self.base_url}: {exc.__class__.__name__}."
            ) from exc
        if response.status_code != 200:
            raise CatalogUnavailable(
                f"The Atlas API at {self.base_url} answered HTTP {response.status_code}."
            )
        return response


class _CatalogChanged(Exception):
    """The pages of one walk do not describe one state of the catalog."""


def _parse_total(raw: str | None) -> int | None:
    if raw is None or not re.fullmatch(r"[0-9]+", raw.strip()):
        return None
    return int(raw.strip())
