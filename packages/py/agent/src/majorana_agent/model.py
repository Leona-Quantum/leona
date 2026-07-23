"""LLM adapter that selects exactly one typed tool call per durable step."""

from __future__ import annotations

import json
from hashlib import sha256
from uuid import UUID

from majorana_agent.models import (
    ALLOWED_TOOLS_BY_STATE,
    AgentState,
    SIMULATION_TOOL_BY_FRAMEWORK,
    ToolCall,
    ToolName,
    ToolResult,
)
from majorana_agent.prompts import AGENT_SYSTEM_PROMPT
from majorana_agent.templates import REFERENCE_TEMPLATES
from majorana_contracts.enums import Framework
from majorana_llm import LLMClient, LLMRequest, model_for
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class _SelectedTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_call_id: str = Field(min_length=1, max_length=200)
    name: ToolName
    arguments: dict = Field(default_factory=dict)


# Kept as a module-level alias for the shared table in models.py — see the
# comment on ALLOWED_TOOLS_BY_STATE for why this must not be a second copy.
_TOOLS_BY_STATE = ALLOWED_TOOLS_BY_STATE


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
            "parent_plan_id",
            "replan_reason",
            "candidate_id",
            "revision",
            "source_fingerprint",
            "execution_id",
            "execution_ok",
            "review_id",
            "attempt_id",
            "attempt_seq",
            "verification_id",
            "semantic_review_decision",
            "decision",
            "failure_class",
            "retry_target",
            "reason_code",
            "check_summaries",
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

    def __init__(
        self,
        *,
        llm: LLMClient,
        task_prompt: str,
        framework: Framework,
        model: str | None = None,
        initial_source: str | None = None,
    ) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        self._framework = framework
        self._model = model or model_for("generate")
        self._initial_source = initial_source

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
                        # A static, sandbox-executed (not pipeline-verified) reference
                        # for this framework's baseline FINAL_CIRCUIT/RESULT contract
                        # and API conventions — see templates.py.
                        **(
                            {"reference_template": REFERENCE_TEMPLATES[self._framework]}
                            if self._framework in REFERENCE_TEMPLATES
                            else {}
                        ),
                        "state": state.value,
                        "allowed_tools": [name.value for name in allowed],
                        "history": compact_history,
                    },
                    default=str,
                ),
                # No max_tokens: deepseek-v4-pro (models.py) is a reasoning model,
                # and every next_tool() call — not just the ones that write source —
                # pays its reasoning-token cost against whatever cap is set here.
                # bench-14 (2026-07-11) found an 8192 self-imposed ceiling consumed
                # entirely by reasoning on VQE-scale tasks, zero code out; doubling
                # it to 16384 only moved where the same wall was. Omitting the cap
                # (LLMRequest default) lets the provider's own ceiling apply instead
                # of one we picked — the same choice namekoQ makes throughout.
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
