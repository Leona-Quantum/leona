"""LLM adapter that selects exactly one typed tool call per durable step."""

from __future__ import annotations

import json
from hashlib import sha256
from uuid import UUID

from majorana_agent.models import (
    AgentState,
    SIMULATION_TOOL_BY_FRAMEWORK,
    ToolCall,
    ToolName,
    ToolResult,
)
from majorana_agent.prompts import AGENT_SYSTEM_PROMPT
from majorana_contracts.enums import Framework
from majorana_llm import LLMClient, LLMRequest, model_for
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class _SelectedTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_call_id: str = Field(min_length=1, max_length=200)
    name: ToolName
    arguments: dict = Field(default_factory=dict)


_TOOLS_BY_STATE: dict[AgentState, tuple[ToolName, ...]] = {
    AgentState.NEW: (ToolName.REQUEST_PLAN,),
    AgentState.PLANNED: tuple(SIMULATION_TOOL_BY_FRAMEWORK.values()),
    AgentState.EXECUTED: (ToolName.VERIFY_INTENT_ALIGNMENT,),
    AgentState.REPAIR_REQUIRED: tuple(SIMULATION_TOOL_BY_FRAMEWORK.values()),
    AgentState.RESOURCE_EXHAUSTED: (),
    AgentState.VERIFIED: (ToolName.CONVERT_TO_OPENQASM, ToolName.PUBLISH_ARTIFACT),
    AgentState.QASM_ATTEMPTED: (ToolName.PUBLISH_ARTIFACT,),
    AgentState.PUBLISHED: (),
    AgentState.COMPLETED: (),
    AgentState.FAILED: (),
    AgentState.CANCELLED: (),
}


def _history_payload(result: ToolResult) -> dict:
    """Keep model context bounded while preserving ids and repair evidence."""
    payload = result.payload
    encoded = json.dumps(payload, default=str)
    if len(encoded) <= 16_000:
        return payload
    bounded = {
        key: value
        for key, value in payload.items()
        if key
        in {
            "plan_id",
            "candidate_id",
            "revision",
            "source_fingerprint",
            "execution_id",
            "execution_ok",
            "verification_id",
            "decision",
            "repair",
            "status",
            "reason",
            "artifact_id",
            "version_id",
            "version_seq",
        }
    }
    if isinstance(payload.get("plan"), dict):
        plan = dict(payload["plan"])
        parameters = plan.get("parameters")
        if isinstance(parameters, dict):
            plan["parameters"] = dict(parameters)
            plan["parameters"].pop("custom", None)
        success = plan.get("success_criteria")
        if isinstance(success, dict):
            plan["success_criteria"] = dict(success)
            plan["success_criteria"].pop("additional_notes", None)
        bounded["plan"] = plan
    if isinstance(payload.get("result"), dict):
        bounded["result_keys"] = sorted(str(key) for key in payload["result"])[:100]
    bounded["payload_truncated"] = True
    return bounded


class StructuredToolModel:
    """Provider-independent tool selection using schema-constrained decoding.

    Providers with different native tool APIs still produce the same durable call
    envelope.  The broker, not this prompt, remains authoritative for policy.
    """

    # Bound per exemplar so two retrieved artifacts cannot crowd out the task
    # and history in the model's context.
    _EXEMPLAR_SOURCE_LIMIT = 4000

    def __init__(
        self,
        *,
        llm: LLMClient,
        task_prompt: str,
        framework: Framework,
        model: str | None = None,
        initial_source: str | None = None,
        exemplars: list[dict[str, str]] | None = None,
    ) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        self._framework = framework
        self._model = model or model_for("generate")
        self._initial_source = initial_source
        self._exemplars = [
            {
                "title": str(exemplar.get("title", ""))[:200],
                "family": str(exemplar.get("family", ""))[:80],
                "source": str(exemplar.get("source", ""))[: self._EXEMPLAR_SOURCE_LIMIT],
            }
            for exemplar in (exemplars or [])
            if exemplar.get("source")
        ][:2]

    async def next_tool(
        self, *, run_id: UUID, state: AgentState, history: list[ToolResult]
    ) -> ToolCall:
        allowed = list(_TOOLS_BY_STATE[state])
        selected_simulator = SIMULATION_TOOL_BY_FRAMEWORK[self._framework]
        allowed = [
            name
            for name in allowed
            if name not in SIMULATION_TOOL_BY_FRAMEWORK.values() or name is selected_simulator
        ]
        if not allowed:
            raise RuntimeError(f"agent state {state.value} has no callable tools")
        schema = _SelectedTool.model_json_schema()
        schema["properties"]["name"] = {"enum": [name.value for name in allowed]}
        compact_history = [
            {
                "tool_call_id": result.tool_call_id,
                "name": result.name.value,
                "ok": result.ok,
                "state": result.state.value,
                "payload": _history_payload(result),
                "error_code": result.error_code,
                "error_message": result.error_message,
            }
            for result in history
        ]
        response = await self._llm.complete(
            LLMRequest(
                model=self._model,
                system=AGENT_SYSTEM_PROMPT,
                user=json.dumps(
                    {
                        "run_id": str(run_id),
                        "task": self._task_prompt,
                        "initial_framework_source": self._initial_source,
                        "selected_framework": self._framework.value,
                        # Code from this workspace's own previously VERIFIED
                        # artifacts, same framework (LLM work list item 4).
                        # Retrieved from our corpus, never the open web.
                        "verified_exemplars": self._exemplars,
                        "state": state.value,
                        "allowed_tools": [name.value for name in allowed],
                        "history": compact_history,
                    },
                    default=str,
                ),
                max_tokens=8192,
                temperature=0.0,
                response_schema=schema,
                schema_name="agent_tool_call",
            )
        )
        try:
            selected = _SelectedTool.model_validate_json(response.text)
            if selected.name not in allowed:
                raise ValueError(f"model selected disallowed tool {selected.name.value}")
        except (ValidationError, ValueError) as exc:
            # Route malformed provider output through the broker so it becomes
            # bounded, durable policy feedback instead of aborting the run or
            # retrying forever without consuming the step budget.
            digest = sha256(
                f"{run_id}:{state.value}:{len(history)}:{response.text}".encode()
            ).hexdigest()[:32]
            return ToolCall(
                tool_call_id=f"invalid-selection-{digest}",
                name=allowed[0],
                arguments={"__model_selection_error__": str(exc)},
            )
        return ToolCall.model_validate(selected.model_dump())
