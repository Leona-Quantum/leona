import json
from uuid import uuid4

from majorana_agent import AgentState, StructuredToolModel, ToolName
from majorana_contracts.enums import Framework
from majorana_llm import LLMResponse


class FakeLLM:
    def __init__(self):
        self.request = None

    async def complete(self, request, *, on_delta=None):
        self.request = request
        return LLMResponse(
            text=json.dumps(
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
