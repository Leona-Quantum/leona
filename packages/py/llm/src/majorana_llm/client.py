"""LLM client abstraction. The pipeline depends only on the `LLMClient` protocol,
so the deterministic `FakeLLM` (tests, offline E2E) and the real `AnthropicLLM`
(gated on ANTHROPIC_API_KEY) are drop-in swappable. Every call returns token
counts so the worker can emit the llm.call event (ADR-0009) and enforce quotas."""

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
