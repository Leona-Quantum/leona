from __future__ import annotations

import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from defusedxml.common import DefusedXmlException, DTDForbidden
from majorana_llm import LLMResponse

from majorana_worker import handlers
from majorana_worker.research import (
    RESEARCH_ENABLED_ENV,
    ArxivResearchClient,
    ResearchResult,
    ResearchSource,
    normalize_research_query,
    parse_atom_entries,
    research_enabled,
)
from majorana_worker.simple_ports import ProductionSimplePipelinePorts


def test_parse_atom_entries_keeps_only_canonical_arxiv_sources() -> None:
    xml = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/2401.12345v2</id>
        <title>  A useful quantum method  </title>
        <summary> A short abstract.\nWith a second line. </summary>
      </entry>
      <entry>
        <id>https://evil.example/paper</id>
        <title>Untrusted</title><summary>Should be ignored.</summary>
      </entry>
    </feed>"""
    assert parse_atom_entries(xml) == (
        ResearchSource(
            title="A useful quantum method",
            url="https://arxiv.org/abs/2401.12345v2",
            excerpt="A short abstract. With a second line.",
        ),
    )


def test_normalize_research_query_is_bounded_and_single_line() -> None:
    query = normalize_research_query("  recent\nquantum   error correction  ")
    assert query == "recent quantum error correction"
    assert len(normalize_research_query("x" * 400)) == 300


@pytest.mark.asyncio
async def test_agent_decision_emits_bounded_research_provenance() -> None:
    class LLM:
        async def complete(self, request, *, on_delta=None):
            assert request.schema_name == "research_triage"
            return LLMResponse(
                text='{"needed": true, "query": "recent quantum error correction"}',
                model="test",
                input_tokens=1,
                output_tokens=1,
            )

    class Client:
        async def search(self, query: str) -> ResearchResult:
            assert query == "recent quantum error correction"
            return ResearchResult(
                query=query,
                sources=(
                    ResearchSource(
                        title="A paper",
                        url="https://arxiv.org/abs/2401.12345",
                        excerpt="An abstract.",
                    ),
                ),
            )

    class Sink:
        def __init__(self):
            self.events = []

        async def emit(self, type, payload, *, event_id=None):
            self.events.append((type, payload, event_id))

    ports = object.__new__(ProductionSimplePipelinePorts)
    ports._task_prompt = "Compare recent error-correction methods."
    ports._conversation_messages = ()
    ports._prior_user_requests = []
    ports._llm = LLM()
    ports._research_client = Client()
    ports._research_sink = Sink()

    result = await ports._research_for_plan(uuid4(), previous=None)

    assert result is not None and len(result.sources) == 1
    assert ports._research_sink.events[0][0] == "research.completed"
    assert ports._research_sink.events[0][1]["sources"][0]["url"].startswith(
        "https://arxiv.org/abs/"
    )


# --- ai-ops#89 guard 1: the environment kill switch -------------------------


def test_research_is_enabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv(RESEARCH_ENABLED_ENV, raising=False)
    assert research_enabled() is True


@pytest.mark.parametrize("value", ["1", "true", "TRUE", " yes ", "on", "enabled"])
def test_recognised_affirmatives_keep_research_on(monkeypatch, value: str) -> None:
    monkeypatch.setenv(RESEARCH_ENABLED_ENV, value)
    assert research_enabled() is True


@pytest.mark.parametrize(
    "value", ["0", "false", "no", "off", "disabled", "OFF", "please stop", "", "   "]
)
def test_anything_not_an_affirmative_switches_research_off(monkeypatch, value: str) -> None:
    """A kill switch may not require the operator to guess our spelling.

    Absent means on, and so does a value we recognise as yes. Everything else is
    someone reaching for this variable to stop something, and is honoured — the
    empty string included, which is a field someone cleared in a console and is
    how every other empty-valued variable in this deployment already reads.
    """
    monkeypatch.setenv(RESEARCH_ENABLED_ENV, value)
    assert research_enabled() is False


def test_disabled_research_withholds_the_sink_the_pipeline_gates_on(monkeypatch) -> None:
    ctx = SimpleNamespace(sink=object())

    monkeypatch.delenv(RESEARCH_ENABLED_ENV, raising=False)
    assert handlers._research_sink_for(ctx) is ctx.sink

    monkeypatch.setenv(RESEARCH_ENABLED_ENV, "off")
    assert handlers._research_sink_for(ctx) is None


async def test_disabled_research_never_reaches_the_llm() -> None:
    """The switch has to be worth its name: no sink, no triage call.

    `_research_for_plan` returning None is not on its own proof of anything —
    it also returns None when the model declines, when triage fails to parse,
    and when the provider is down. So this counts the calls instead. It has to:
    `_research_for_plan` wraps the triage call in `except Exception`, so a stub
    that raised on being called would be swallowed and this test would pass with
    the guard deleted. Verified by deleting it.
    """

    class LLM:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise AssertionError("triage LLM call made with research disabled")

    class Client:
        def __init__(self) -> None:
            self.calls = 0

        async def search(self, query: str) -> ResearchResult:
            self.calls += 1
            return ResearchResult(query=query)

    llm, client = LLM(), Client()
    ports = object.__new__(ProductionSimplePipelinePorts)
    ports._task_prompt = "Compare recent error-correction methods."
    ports._conversation_messages = ()
    ports._prior_user_requests = []
    ports._llm = llm
    ports._research_client = client
    ports._research_sink = None  # what `_research_sink_for` returns when disabled

    assert await ports._research_for_plan(uuid4(), previous=None) is None
    assert llm.calls == 0, "the kill switch let a triage call through"
    assert client.calls == 0, "the kill switch let a lookup through"


# --- ai-ops#89 guard 2: a bound on the wait --------------------------------


async def test_a_queued_lookup_declines_instead_of_waiting_out_the_interval() -> None:
    """Contention, simulated by holding the lock the queue is built on.

    The real wedge is twenty runs spaced three seconds apart, which a test may
    not sit through. Holding `_rate_lock` from another thread reproduces exactly
    what the twentieth run meets, in the time it takes to fail.
    """
    client = ArxivResearchClient(budget_s=1.0)
    holder_may_release = threading.Event()

    def hold() -> None:
        with ArxivResearchClient._rate_lock:
            holder_may_release.wait(timeout=10.0)

    holder = threading.Thread(target=hold)
    holder.start()
    try:
        started = time.monotonic()
        result = await client.search("recent quantum error correction")
        elapsed = time.monotonic() - started
    finally:
        holder_may_release.set()
        holder.join(timeout=10.0)

    assert result.sources == ()
    assert result.error is not None
    # Bounded by the budget, not by the queue ahead of it.
    assert elapsed < 5.0


def test_a_queued_lookup_gives_its_thread_back(monkeypatch) -> None:
    """The half `asyncio.wait_for` cannot do, asserted where it happens.

    Cancelling the awaitable returns control to the run but leaves the thread
    blocked on the lock, so on its own it bounds the wait and not the pool. This
    drives `_search_sync` directly, with the lock held elsewhere, and asserts the
    call *returns* — which is the thread going back to the pool.
    """
    client = ArxivResearchClient()
    holder_may_release = threading.Event()
    holding = threading.Event()

    def hold() -> None:
        with ArxivResearchClient._rate_lock:
            holding.set()
            holder_may_release.wait(timeout=10.0)

    holder = threading.Thread(target=hold)
    holder.start()
    try:
        assert holding.wait(timeout=5.0), "the lock was never taken; the test proves nothing"
        started = time.monotonic()
        result = client._search_sync("recent quantum error correction", time.monotonic() + 0.3)
        elapsed = time.monotonic() - started
    finally:
        holder_may_release.set()
        holder.join(timeout=10.0)

    assert result.sources == ()
    assert result.error == "arXiv lookup skipped (queue busy)"
    assert elapsed < 3.0, "the thread waited out the queue instead of declining"


async def test_a_lookup_that_overruns_its_budget_is_a_result_not_an_exception(
    monkeypatch,
) -> None:
    """`wait_for` is the outer clock, and it must degrade rather than raise.

    Research is best effort: a timeout has to mean "plan without research", so
    the caller receives a ResearchResult with no sources — the same shape an
    arXiv outage produces, which `plan()` already renders as available: false.
    """
    client = ArxivResearchClient(budget_s=1.0)
    caller_gave_up = threading.Event()

    def slow(query: str, deadline: float) -> ResearchResult:
        # Blocks until the caller has stopped waiting, then unwinds, so the test
        # neither races the budget nor leaves a sleeping thread behind it.
        caller_gave_up.wait(timeout=10.0)
        return ResearchResult(query=query, error="answered too late to be used")

    monkeypatch.setattr(client, "_search_sync", slow)

    try:
        result = await client.search("recent quantum error correction")
    finally:
        caller_gave_up.set()

    assert result.sources == ()
    assert result.error == "arXiv lookup timed out"


async def test_a_timed_out_lookup_still_lets_the_run_plan() -> None:
    """The degraded path, end to end through the adapter.

    A timeout must reach `plan()` as a ResearchResult with no sources rather
    than as a raised exception or a None that hides that anything was tried, and
    the provenance event must record the reason.
    """

    class LLM:
        async def complete(self, request, *, on_delta=None):
            return LLMResponse(
                text='{"needed": true, "query": "recent quantum error correction"}',
                model="test",
                input_tokens=1,
                output_tokens=1,
            )

    class TimingOutClient:
        async def search(self, query: str) -> ResearchResult:
            return ResearchResult(query=query, error="arXiv lookup timed out")

    class Sink:
        def __init__(self):
            self.events = []

        async def emit(self, type, payload, *, event_id=None):
            self.events.append((type, payload, event_id))

    ports = object.__new__(ProductionSimplePipelinePorts)
    ports._task_prompt = "Compare recent error-correction methods."
    ports._conversation_messages = ()
    ports._prior_user_requests = []
    ports._llm = LLM()
    ports._research_client = TimingOutClient()
    ports._research_sink = Sink()

    result = await ports._research_for_plan(uuid4(), previous=None)

    assert result is not None
    assert result.sources == ()
    assert result.error == "arXiv lookup timed out"
    type_, payload, _ = ports._research_sink.events[0]
    assert type_ == "research.completed"
    assert payload["sources"] == []
    assert payload["error"] == "arXiv lookup timed out"


def test_parse_atom_entries_refuses_an_entity_bomb() -> None:
    """A hostile feed must be refused, not expanded.

    This is the whole reason `research.py` parses with defusedxml rather than
    the stdlib: the expansion happens on the WORKER, the process a user's run is
    waiting on, so a body like this costs memory and CPU where it hurts most.
    The stdlib parser expands it happily.
    """
    bomb = b"""<?xml version="1.0"?>
<!DOCTYPE feed [
  <!ENTITY a "AAAAAAAAAA">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
]>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>&c;</title></entry></feed>"""
    with pytest.raises(DefusedXmlException):
        parse_atom_entries(bomb)


def test_parse_atom_entries_refuses_a_declaration_only_dtd() -> None:
    """`forbid_dtd=True` is passed explicitly, and this is what proves it.

    defusedxml 0.7.1 defaults `forbid_dtd` to False, so without the explicit
    argument this document parses fine — which would make the comment above the
    import claim more than the code does. An arXiv Atom response never carries a
    DTD, so refusing one costs nothing real.
    """
    with_dtd = b"""<?xml version="1.0"?>
<!DOCTYPE feed SYSTEM "feed.dtd">
<feed xmlns="http://www.w3.org/2005/Atom"></feed>"""
    with pytest.raises(DTDForbidden):
        parse_atom_entries(with_dtd)


def test_parse_atom_entries_still_reads_an_ordinary_feed() -> None:
    """The control. A guard that refuses everything would pass both tests above."""
    ordinary = b"""<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>A paper</title>
    <summary>An abstract.</summary>
    <id>https://arxiv.org/abs/2401.00001</id>
  </entry>
</feed>"""
    sources = parse_atom_entries(ordinary)
    assert len(sources) == 1
    assert sources[0].title == "A paper"
    assert sources[0].url == "https://arxiv.org/abs/2401.00001"
