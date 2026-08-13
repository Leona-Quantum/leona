"""Bounded, provenance-preserving access to arXiv abstracts.

The circuit sandbox never receives this capability.  Research is a worker-side
planning aid: it can read public arXiv metadata, but it cannot follow links,
download papers, or execute anything from a paper.  The caller is responsible
for deciding whether a run actually needs research.
"""

from __future__ import annotations

import asyncio
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass


_ARXIV_API = "https://export.arxiv.org/api/query"
_ATOM = "http://www.w3.org/2005/Atom"
_MAX_RESULTS = 5
_MAX_QUERY_LENGTH = 300
_MIN_REQUEST_INTERVAL_S = 3.0
_USER_AGENT = "LeonaQuantum/1.0 (research metadata)"


@dataclass(frozen=True)
class ResearchSource:
    title: str
    url: str
    excerpt: str

    def as_event_payload(self) -> dict[str, str]:
        return {"title": self.title, "url": self.url, "excerpt": self.excerpt}


@dataclass(frozen=True)
class ResearchResult:
    query: str
    sources: tuple[ResearchSource, ...] = ()
    error: str | None = None


def normalize_research_query(value: str, *, fallback: str = "") -> str:
    """Keep model-proposed queries short and single-line before URL encoding."""

    query = re.sub(r"\s+", " ", value or "").strip()
    if not query:
        query = re.sub(r"\s+", " ", fallback or "").strip()
    return query[:_MAX_QUERY_LENGTH]


def _canonical_abs_url(raw: str) -> str | None:
    parsed = urllib.parse.urlparse(raw.strip())
    host = (parsed.hostname or "").lower()
    if host not in {"arxiv.org", "export.arxiv.org"}:
        return None
    path = parsed.path.replace("/pdf/", "/abs/").rstrip("/")
    if not path.startswith("/abs/"):
        return None
    return f"https://arxiv.org{path}"


def parse_atom_entries(xml: bytes, *, limit: int = _MAX_RESULTS) -> tuple[ResearchSource, ...]:
    """Parse only the title, abstract, and arXiv abs URL from an API response."""

    root = ET.fromstring(xml)
    sources: list[ResearchSource] = []
    for entry in root.findall(f"{{{_ATOM}}}entry"):
        title = " ".join((entry.findtext(f"{{{_ATOM}}}title") or "").split())
        excerpt = " ".join((entry.findtext(f"{{{_ATOM}}}summary") or "").split())
        raw_id = entry.findtext(f"{{{_ATOM}}}id") or ""
        url = _canonical_abs_url(raw_id)
        if url is None:
            for link in entry.findall(f"{{{_ATOM}}}link"):
                if link.attrib.get("rel", "alternate") == "alternate":
                    url = _canonical_abs_url(link.attrib.get("href", ""))
                    if url:
                        break
        if not title or not excerpt or not url:
            continue
        sources.append(ResearchSource(title[:500], url[:2048], excerpt[:4000]))
        if len(sources) >= limit:
            break
    return tuple(sources)


class ArxivResearchClient:
    """Small arXiv API client with process-wide politeness and strict bounds."""

    _rate_lock = threading.Lock()
    _last_request = 0.0

    def __init__(self, *, timeout_s: float = 10.0, max_results: int = _MAX_RESULTS) -> None:
        self._timeout_s = max(1.0, min(timeout_s, 30.0))
        self._max_results = max(1, min(max_results, _MAX_RESULTS))

    def _search_sync(self, query: str) -> ResearchResult:
        with self._rate_lock:
            wait = _MIN_REQUEST_INTERVAL_S - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self.__class__._last_request = time.monotonic()

        params = urllib.parse.urlencode(
            {
                "search_query": f"all:{query}",
                "start": 0,
                "max_results": self._max_results,
                # Prefer current versions when the agent explicitly decided
                # that external research is useful; the abstracts still need
                # to be treated as unreviewed context by the planner.
                "sortBy": "lastUpdatedDate",
                "sortOrder": "descending",
            }
        )
        request = urllib.request.Request(
            f"{_ARXIV_API}?{params}",
            headers={"User-Agent": _USER_AGENT, "Accept": "application/atom+xml"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
                return ResearchResult(query=query, sources=parse_atom_entries(response.read()))
        except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError) as exc:
            # Do not expose response bodies or exception details to the model/user.
            return ResearchResult(query=query, error=f"arXiv lookup failed ({type(exc).__name__})")

    async def search(self, query: str) -> ResearchResult:
        normalized = normalize_research_query(query)
        if not normalized:
            return ResearchResult(query="", error="arXiv lookup skipped: empty query")
        return await asyncio.to_thread(self._search_sync, normalized)
