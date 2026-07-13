"""A live provider run emits research provenance before the plan reaches the UI."""

import os
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import pytest
from majorana_contracts.enums import Framework, RunMode, Stage
from majorana_contracts.events import run_event_adapter
from majorana_llm import default_llm
from majorana_llm.research import ResearchResult, ResearchSource
from majorana_pipeline import RunContext
from majorana_worker import stage_handlers


def _live_provider_ready() -> bool:
    provider = os.environ.get("MAJORANA_LLM_PROVIDER", "").strip().lower()
    if provider == "anthropic":
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    if provider == "openai":
        return bool(os.environ.get("OPENAI_API_KEY") and os.environ.get("DEEPSEEK_API_KEY"))
    return bool(os.environ.get("ANTHROPIC_API_KEY")) or bool(
        os.environ.get("OPENAI_API_KEY") and os.environ.get("DEEPSEEK_API_KEY")
    )


requires_live_llm = pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_LIVE_LLM") != "1" or not _live_provider_ready(),
    reason="live provider test requires MAJORANA_RUN_LIVE_LLM=1 and configured credentials",
)


@dataclass
class RecordingSink:
    events: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((event_type, payload))


@requires_live_llm
async def test_plan_emits_valid_research_event(monkeypatch):
    source = ResearchSource(
        title="Reference",
        url="https://example.com/reference",
        excerpt="A bounded excerpt.",
    )
    monkeypatch.setattr(
        stage_handlers,
        "research_for_prompt",
        lambda prompt: _research_result(source),
    )
    handlers = stage_handlers.build_stage_handlers(
        scope=None,
        session=None,
        run_id=uuid4(),
        llm=default_llm(),
        sandbox=None,
    )
    sink = RecordingSink()
    ctx = RunContext(
        run_id=uuid4(),
        task_prompt="Explain a Bell state using a published reference",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=128,
        tolerances=None,
        timeout_s=None,
        sink=sink,
    )

    outcome = await handlers[Stage.PLAN](ctx)

    assert outcome.ok is True
    event_type, payload = next(event for event in sink.events if event[0] == "research.completed")
    assert event_type == "research.completed"
    event = run_event_adapter.validate_python(
        {
            "run_id": str(ctx.run_id),
            "seq": 1,
            "ts": "2026-07-12T00:00:00Z",
            "type": event_type,
            **payload,
        }
    )
    assert event.sources[0].url == source.url
    delta_type, delta_payload = next(event for event in sink.events if event[0] == "llm.delta")
    assert delta_type == "llm.delta"
    assert delta_payload["stage"] == Stage.PLAN
    assert delta_payload["kind"] == "output"


async def _research_result(source: ResearchSource) -> ResearchResult:
    return ResearchResult(query="Bell state reference", sources=(source,))
