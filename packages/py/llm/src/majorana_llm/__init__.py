"""Provider clients and structured prompts for chat and the circuit agent."""

from majorana_llm.client import (
    AnthropicLLM,
    LLMClient,
    LLMMessage,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    OpenAICompatibleLLM,
    RetryingLLM,
    default_llm,
    endpoint_for,
    classify_provider_error,
)
from majorana_llm.models import model_for, resolve_provider
from majorana_llm.parsing import (
    StageOutputError,
    extract_json,
)

from majorana_llm.prompts import (
    CHAT_SYSTEM_PROMPT,
    FRAMEWORK_DIRECTIVE,
    INTENT_ROUTER_SYSTEM_PROMPT,
    SIMPLE_GENERATION_SYSTEM_PROMPT,
    SIMPLE_PLAN_SYSTEM_PROMPT,
    SIMPLE_REVIEW_SYSTEM_PROMPT,
    RenderedPrompt,
    render_intent_prompt,
)

__all__ = [
    "LLMClient",
    "LLMMessage",
    "LLMProviderError",
    "LLMRequest",
    "LLMResponse",
    "AnthropicLLM",
    "OpenAICompatibleLLM",
    "RetryingLLM",
    "default_llm",
    "endpoint_for",
    "classify_provider_error",
    "model_for",
    "resolve_provider",
    "extract_json",
    "StageOutputError",
    "INTENT_ROUTER_SYSTEM_PROMPT",
    "CHAT_SYSTEM_PROMPT",
    "SIMPLE_GENERATION_SYSTEM_PROMPT",
    "SIMPLE_PLAN_SYSTEM_PROMPT",
    "SIMPLE_REVIEW_SYSTEM_PROMPT",
    "FRAMEWORK_DIRECTIVE",
    "RenderedPrompt",
    "render_intent_prompt",
]
