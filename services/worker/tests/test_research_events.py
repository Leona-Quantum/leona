"""Research provenance is emitted before the plan reaches the UI."""

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from majorana_contracts.enums import Framework, RunMode, Stage
from majorana_contracts.events import run_event_adapter
from majorana_llm import FakeLLM
from majorana_llm.models import model_for
from majorana_llm.research import ResearchResult, ResearchSource
from majorana_pipeline import RunContext
from majorana_worker import stage_handlers


PLAN = {
    "domain": "education",
    "framework": "qiskit",
    "algorithm": "Bell",
    "problem_summary": "Prepare a Bell state",
    "algorithm_rationale": "Hadamard plus CX creates entanglement.",
    "parameters": {"shots": 128},
    "qubits_estimate": 2,
    "expected_runtime_sec": 5,
    "success_criteria": {"primary_metric": "fidelity"},
    "expected_output_keys": ["counts"],
}


@dataclass
class RecordingSink:
    events: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((event_type, payload))


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
        llm=FakeLLM({model_for("plan"): json.dumps(PLAN)}),
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


async def _research_result(source: ResearchSource) -> ResearchResult:
    return ResearchResult(query="Bell state reference", sources=(source,))
