import json
from uuid import uuid4

from majorana_agent import AgentState, StructuredToolModel, ToolName
from majorana_contracts.enums import Framework
from majorana_llm import LLMResponse


class FakeLLM:
    def __init__(self, text=None):
        self.request = None
        self.text = text

    async def complete(self, request, *, on_delta=None):
        self.request = request
        return LLMResponse(
            text=self.text
            if self.text is not None
            else json.dumps(
                {
                    "tool_call_id": "call-1",
                    "name": "simulate_qiskit",
                    "arguments": {"source": "FINAL_CIRCUIT = object()"},
                }
            ),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


async def test_model_exposes_only_selected_framework_simulator():
    llm = FakeLLM()
    model = StructuredToolModel(
        llm=llm,
        task_prompt="Bell circuit",
        framework=Framework.QISKIT,
        model="test-model",
    )
    call = await model.next_tool(run_id=uuid4(), state=AgentState.PLANNED, history=[])
    assert call.name is ToolName.SIMULATE_QISKIT
    assert llm.request.response_schema["properties"]["name"] == {"enum": ["simulate_qiskit"]}


async def test_model_turns_malformed_selection_into_broker_feedback_call():
    model = StructuredToolModel(
        llm=FakeLLM("not-json"),
        task_prompt="Bell circuit",
        framework=Framework.QISKIT,
        model="test-model",
    )
    call = await model.next_tool(run_id=uuid4(), state=AgentState.PLANNED, history=[])
    assert call.name is ToolName.SIMULATE_QISKIT
    assert "__model_selection_error__" in call.arguments


async def test_verified_exemplars_reach_the_generation_context_bounded():
    """LLM work list item 4: retrieved code from our own verified corpus rides in
    the per-run user payload. Bounded — oversized sources truncate, entries
    without source drop, and at most two survive."""
    llm = FakeLLM()
    model = StructuredToolModel(
        llm=llm,
        task_prompt="Bell circuit",
        framework=Framework.QISKIT,
        model="test-model",
        exemplars=[
            {"title": "GHZ-4", "family": "GHZ", "source": "x" * 10_000},
            {"title": "no-source", "family": "Bell", "source": ""},
            {"title": "Bell", "family": "Bell", "source": "qc = QuantumCircuit(2)"},
            {"title": "third", "family": "QFT", "source": "print(3)"},
        ],
    )
    await model.next_tool(run_id=uuid4(), state=AgentState.PLANNED, history=[])
    payload = json.loads(llm.request.user)
    exemplars = payload["verified_exemplars"]
    assert [item["title"] for item in exemplars] == ["GHZ-4", "Bell"]
    assert len(exemplars[0]["source"]) == 4000


async def test_no_exemplars_yields_an_empty_list_not_an_absent_field():
    llm = FakeLLM()
    model = StructuredToolModel(
        llm=llm, task_prompt="Bell circuit", framework=Framework.QISKIT, model="test-model"
    )
    await model.next_tool(run_id=uuid4(), state=AgentState.PLANNED, history=[])
    assert json.loads(llm.request.user)["verified_exemplars"] == []
