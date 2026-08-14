"""Bounded, provenance-preserving access to arXiv abstracts.

The circuit sandbox never receives this capability.  Research is a worker-side
planning aid: it can read public arXiv metadata, but it cannot follow links,
download papers, or execute anything from a paper.  The caller is responsible
for deciding whether a run actually needs research.
"""

from __future__ import annotations

import asyncio
import os
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

#: Total wall-clock a single lookup may consume — the queue wait and the HTTP
#: fetch together. See `ArxivResearchClient` for why this number and not another.
_RESEARCH_BUDGET_S = 15.0

RESEARCH_ENABLED_ENV = "MAJORANA_RESEARCH"

#: The only values that keep research on once the variable exists at all.
#: Everything else present in the environment turns it off, which is the
#: asymmetry a kill switch needs: an operator reaching for this during an
#: incident is trying to stop something, and a value we failed to recognise must
#: not be read as consent to keep going. Refusing to start on an unparseable
#: value — the rule `majorana_api.settings` uses for numeric limits — is wrong
#: here for the opposite reason: it would turn a botched attempt to disable an
#: optional enrichment into a worker that will not boot.
_ENABLED_VALUES = frozenset({"1", "true", "yes", "on", "enabled"})


def research_enabled() -> bool:
    """Whether implicit arXiv research may run at all.

    Absent means ON. That is the state every environment is in today, and this
    switch exists to take the feature away in an incident rather than to hold it
    back. Read at call time rather than at import so that flipping the Cloud Run
    variable takes effect on the next revision without a code change, which is
    the whole point of it existing.

    Present-but-empty means OFF, and the distinction is deliberate. An operator
    who clears this field in a console is trying to disable something, and every
    other empty-valued variable in this deployment already reads that way —
    `MAJORANA_CREDENTIAL_KEYS`, `DEPLOY_PROBE_TOKEN`, `TRUSTED_CALLER_TOKEN` all
    treat empty as "off". Losing research when it was wanted costs a slightly
    worse plan; keeping it when it was not is the wedge this switch exists for.

    It is not on `majorana_api.settings.Settings` even though that is where this
    project keeps configuration. The worker cannot construct that object:
    `Settings` validates the API service's whole configuration including
    `WORKOS_CLIENT_ID`, which the worker has never had, and doing it here raised
    RuntimeError on every run once before (see `handlers.py::_ensure_allowance`).
    The worker's own convention for a feature selector is the one used by
    `handlers.py::_default_sandbox` — a named `MAJORANA_*` variable read through
    a documented helper — and this follows it.
    """
    raw = os.environ.get(RESEARCH_ENABLED_ENV)
    if raw is None:
        return True
    return raw.strip().lower() in _ENABLED_VALUES


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
    """Small arXiv API client with process-wide politeness and strict bounds.

    Politeness is a *process-wide* serialisation: one lookup at a time, at least
    `_MIN_REQUEST_INTERVAL_S` apart, enforced by a class-level lock. That is
    correct towards arXiv and dangerous towards ourselves, because the queue it
    creates is unbounded — twenty concurrent runs made the twentieth wait a
    minute, and the waiting happens on `asyncio.to_thread` workers, so past
    roughly the default pool size it stops being this feature's problem and
    starts stalling unrelated worker jobs.

    `budget_s` is the bound on that. It covers the queue wait *and* the fetch
    together, so a lookup either completes inside it or gives up and the run
    plans without research. 15s is chosen against the two numbers either side
    of it: the HTTP timeout is 10s, so the budget must exceed it or a lookup
    that reaches the network on an idle worker could still be killed by the
    clock; and the interval is 3s, so 15s admits at most four or five waiters
    before the rest decline — which is the real ceiling anyway, since a 3s
    global interval cannot serve more than twenty lookups a minute no matter how
    long anyone is willing to wait. Making runs queue past that converts a rate
    limit into latency on a stage the user is watching, and buys nothing.
    """

    _rate_lock = threading.Lock()
    _last_request = 0.0

    def __init__(
        self,
        *,
        timeout_s: float = 10.0,
        max_results: int = _MAX_RESULTS,
        budget_s: float = _RESEARCH_BUDGET_S,
    ) -> None:
        self._timeout_s = max(1.0, min(timeout_s, 30.0))
        self._max_results = max(1, min(max_results, _MAX_RESULTS))
        self._budget_s = max(1.0, budget_s)

    def _search_sync(self, query: str, deadline: float) -> ResearchResult:
        # Bounding the *acquire* is the half that frees the thread. Cancelling
        # the awaitable in `search` below returns control to the run, but the
        # thread it was running on keeps blocking here until it wins the lock —
        # so without this the pool still fills and unrelated jobs still stall.
        if not self._rate_lock.acquire(timeout=max(0.0, deadline - time.monotonic())):
            return ResearchResult(query=query, error="arXiv lookup skipped (queue busy)")
        try:
            wait = _MIN_REQUEST_INTERVAL_S - (time.monotonic() - self._last_request)
            if wait > 0:
                # Declining is the only correct move when the politeness wait
                # would outlast the budget. Sleeping a shortened interval would
                # buy a place in the queue by breaking the promise the queue
                # exists to keep, and arXiv is the party that would notice.
                if time.monotonic() + wait > deadline:
                    return ResearchResult(query=query, error="arXiv lookup skipped (queue busy)")
                time.sleep(wait)
            self.__class__._last_request = time.monotonic()
        finally:
            self._rate_lock.release()

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return ResearchResult(query=query, error="arXiv lookup timed out")

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
            with urllib.request.urlopen(
                request, timeout=min(self._timeout_s, remaining)
            ) as response:
                return ResearchResult(query=query, sources=parse_atom_entries(response.read()))
        except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError) as exc:
            # Do not expose response bodies or exception details to the model/user.
            return ResearchResult(query=query, error=f"arXiv lookup failed ({type(exc).__name__})")

    async def search(self, query: str) -> ResearchResult:
        normalized = normalize_research_query(query)
        if not normalized:
            return ResearchResult(query="", error="arXiv lookup skipped: empty query")
        # Two clocks, deliberately. The deadline handed to the thread starts when
        # the thread starts, so it cannot bound the time the task spends queued
        # in a saturated executor before it runs at all; `wait_for` starts at the
        # call and does. Neither one alone bounds what a caller actually waits.
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._search_sync, normalized, time.monotonic() + self._budget_s),
                timeout=self._budget_s,
            )
        except TimeoutError:
            # Best-effort by design: a lookup that ran out of time is a plan made
            # without research, never a failed run.
            return ResearchResult(query=normalized, error="arXiv lookup timed out")
