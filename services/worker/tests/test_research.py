from __future__ import annotations

from uuid import uuid4

import pytest
from majorana_llm import LLMResponse

from majorana_worker.research import (
    ResearchResult,
    ResearchSource,
    normalize_research_query,
    parse_atom_entries,
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
