"""Provider clients and structured prompts for chat and the circuit agent."""

from majorana_llm.client import (
    AnthropicLLM,
    LLMClient,
    LLMMessage,
    LLMRequest,
    LLMResponse,
    OpenAICompatibleLLM,
    RetryingLLM,
    default_llm,
    endpoint_for,
)
from majorana_llm.models import AnalysisOutput, model_for, resolve_provider
from majorana_llm.parsing import (
    StageOutputError,
    extract_code,
    extract_json,
    parse_analysis,
    parse_plan,
)
# The dead stage prompts (GENERATE/CRITIC/ANALYZE/WRITEBACK, STAGE_PROMPTS, their
# renderers) and the caller-less research module were deleted 2026-07-20 — LLM
# work list items 7 and 8. The live prompts are the three below plus the agent
# package's AGENT_SYSTEM_PROMPT and the worker's inline critic.
from majorana_llm.prompts import (
    FRAMEWORK_DIRECTIVE,
    INTENT_ROUTER_SYSTEM_PROMPT,
    PLAN_SYSTEM_PROMPT,
    QUANTUM_AGENT_SYSTEM_PROMPT,
    RenderedPrompt,
    render_intent_prompt,
    render_plan_prompt,
)

__all__ = [
    "LLMClient",
    "LLMMessage",
    "LLMRequest",
    "LLMResponse",
    "AnthropicLLM",
    "OpenAICompatibleLLM",
    "RetryingLLM",
    "default_llm",
    "endpoint_for",
    "model_for",
    "resolve_provider",
    "AnalysisOutput",
    "parse_plan",
    "extract_code",
    "extract_json",
    "StageOutputError",
    "parse_analysis",
    "PLAN_SYSTEM_PROMPT",
    "INTENT_ROUTER_SYSTEM_PROMPT",
    "QUANTUM_AGENT_SYSTEM_PROMPT",
    "FRAMEWORK_DIRECTIVE",
    "RenderedPrompt",
    "render_plan_prompt",
    "render_intent_prompt",
]
