"""LLM client abstraction. The pipeline depends only on the `LLMClient` protocol,
so the deterministic `FakeLLM` (tests, offline E2E) and the real clients —
`OpenAICompatibleLLM` (OpenAI + DeepSeek, the owner-confirmed providers) and
`AnthropicLLM` — are drop-in swappable; `default_llm()` picks by env. Every call
returns token counts so the worker can emit the llm.call event (ADR-0009) and
enforce quotas."""

from __future__ import annotations

from typing import Any, Callable, Protocol

from pydantic import BaseModel, Field


class LLMRequest(BaseModel):
    model: str
    system: str
    user: str
    max_tokens: int = Field(default=4096, ge=1)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)


class LLMResponse(BaseModel):
    text: str
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class LLMClient(Protocol):
    async def complete(self, request: LLMRequest) -> LLMResponse: ...


class FakeLLM:
    """Deterministic client for tests and offline E2E. `responses` maps a model id
    (or "*") to the text to return, or to a callable(request) -> text. Token counts
    are derived from text length so llm.call events are non-trivial but stable."""

    def __init__(self, responses: dict[str, str | Callable[[LLMRequest], str]]) -> None:
        self._responses = responses

    async def complete(self, request: LLMRequest) -> LLMResponse:
        handler: Any = self._responses.get(request.model, self._responses.get("*"))
        if handler is None:
            raise KeyError(f"FakeLLM has no scripted response for model {request.model!r}")
        text = handler(request) if callable(handler) else handler
        return LLMResponse(
            text=text,
            model=request.model,
            input_tokens=max(1, len(request.system) + len(request.user)) // 4,
            output_tokens=max(1, len(text)) // 4,
        )


def endpoint_for(model: str) -> tuple[str | None, str]:
    """(base_url, key_env) for an OpenAI-compatible model id. DeepSeek models go
    to the DeepSeek endpoint (OpenAI-compatible API); everything else to OpenAI
    (base_url None = the SDK default). Kept module-level so routing is testable
    without either SDK or key."""
    if model.startswith("deepseek"):
        import os

        return os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), "DEEPSEEK_API_KEY"
    return None, "OPENAI_API_KEY"


class OpenAICompatibleLLM:
    """Owner-confirmed production client (OpenAI + DeepSeek, 2026-07-10). Routes
    per model id via endpoint_for, so one client serves the mixed per-stage
    tiering (GPT for plan/verify, DeepSeek for generate/writeback). Lazy SDK
    import, same as AnthropicLLM."""

    async def complete(self, request: LLMRequest) -> LLMResponse:
        try:
            from openai import AsyncOpenAI  # type: ignore
        except Exception as exc:  # pragma: no cover - only without the SDK
            raise RuntimeError("install majorana-llm[openai] and set OPENAI_API_KEY/DEEPSEEK_API_KEY") from exc
        import os

        base_url, key_env = endpoint_for(request.model)
        api_key = os.environ.get(key_env)
        if not api_key:
            raise RuntimeError(f"{key_env} is not set (required for model {request.model!r})")

        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        completion = await client.chat.completions.create(
            model=request.model,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            messages=[
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
        )
        usage = completion.usage
        return LLMResponse(
            text=completion.choices[0].message.content or "",
            model=request.model,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )


def default_llm() -> "LLMClient":
    """The production client for the active provider profile (models.resolve_provider):
    OpenAI-compatible when OPENAI/DEEPSEEK keys (or MAJORANA_LLM_PROVIDER=openai) are
    set, Anthropic otherwise."""
    from majorana_llm.models import resolve_provider

    return OpenAICompatibleLLM() if resolve_provider() == "openai" else AnthropicLLM()


class AnthropicLLM:
    """Real provider client. Imports the SDK lazily and reads ANTHROPIC_API_KEY, so
    the package installs and the FakeLLM path runs without either. Provider choice
    is owner-confirmable (see models.py)."""

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key

    async def complete(self, request: LLMRequest) -> LLMResponse:
        try:
            from anthropic import AsyncAnthropic  # type: ignore
        except Exception as exc:  # pragma: no cover - only without the SDK
            raise RuntimeError("install majorana-llm[anthropic] and set ANTHROPIC_API_KEY") from exc

        client = AsyncAnthropic(api_key=self._api_key)  # picks up ANTHROPIC_API_KEY
        message = await client.messages.create(
            model=request.model,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            system=request.system,
            messages=[{"role": "user", "content": request.user}],
        )
        text = "".join(block.text for block in message.content if block.type == "text")
        return LLMResponse(
            text=text,
            model=request.model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
        )
