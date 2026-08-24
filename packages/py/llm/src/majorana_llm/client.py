"""LLM client abstraction for the configured production providers.

The worker depends only on the `LLMClient` protocol; `default_llm()` selects the
configured OpenAI-compatible or Anthropic client from the environment. Every call
returns token counts so the worker can emit the llm.call event (ADR-0009) and
enforce quotas.
"""

from __future__ import annotations

import asyncio
import json
import math
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


class LLMRequest(BaseModel):
    model: str
    system: str
    user: str = ""
    messages: list["LLMMessage"] | None = None
    # No default cap: an OpenAI-compatible call with max_tokens omitted lets the
    # provider use its own ceiling instead of an arbitrary one we picked (namekoQ
    # never sets this either). A self-imposed cap is what turned reasoning-token
    # consumption into an outage: bench-14 (2026-07-11) found deepseek-v4-pro
    # burning an 8192 budget entirely on reasoning, zero code out, on VQE-scale
    # tasks — the ceiling was the failure, not something reasoning merely bumped
    # into. Anthropic's Messages API requires a numeric value; AnthropicLLM
    # supplies one only there (see _ANTHROPIC_DEFAULT_MAX_TOKENS).
    max_tokens: int | None = Field(default=None, ge=1)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    # Structured decoding: a JSON Schema the reply must satisfy. On OpenAI-compatible
    # endpoints this becomes response_format json_schema (the durable fix for
    # plan_invalid — prompt-only schema injection is proven unreliable, DECISIONS
    # 2026-07-11); other clients fall back to injecting the schema into the prompt.
    response_schema: dict[str, Any] | None = None
    schema_name: str = "structured_output"


class LLMResponse(BaseModel):
    text: str
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class LLMProviderError(RuntimeError):
    """Sanitized provider failure with an explicit retry decision."""

    def __init__(
        self,
        *,
        provider: str,
        model: str,
        code: str,
        retryable: bool,
        status_code: int | None = None,
    ) -> None:
        self.provider = provider
        self.model = model
        self.code = code
        self.retryable = retryable
        self.status_code = status_code
        status = f"; HTTP {status_code}" if status_code is not None else ""
        super().__init__(f"{provider} request failed ({code}{status}; model={model})")

    def safe_details(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "provider_code": self.code,
            "status_code": self.status_code,
            "retryable": self.retryable,
        }


DeltaHandler = Callable[[str, str], Awaitable[None]]

_DEFAULT_PROVIDER_TIMEOUT_SECONDS = 120.0
_MAX_PROVIDER_TIMEOUT_SECONDS = 600.0

#: Monotonic deadline of the pipeline stage the current call belongs to, or None
#: outside a bounded stage. Set by the caller that owns the stage budget; read
#: here so the provider attempt cannot outlive it. A ContextVar rather than a
#: parameter because the deadline has to cross three packages and every
#: `LLMClient` implementation without widening the protocol every caller
#: implements — and because it propagates down an await chain by itself.
_stage_deadline: ContextVar[float | None] = ContextVar("majorana_llm_stage_deadline", default=None)

#: Fraction of a stage's remaining time one provider attempt may consume. Half,
#: so a stalled attempt still leaves the stage room to retry and succeed rather
#: than handing back a run that has already spent its whole budget.
_STAGE_ATTEMPT_SHARE = 0.5
#: Never cut an attempt below this: healthy plan/generate calls measured 4-26 s,
#: so a smaller bound would start failing calls that were about to answer.
_MIN_STAGE_ATTEMPT_SECONDS = 30.0


@contextmanager
def stage_budget(seconds: float | None) -> Iterator[None]:
    """Bind provider attempts made inside this block to a stage's remaining time.

    Takes a duration rather than a deadline on purpose: the caller that owns the
    budget may be running on an injected clock (the pipeline takes `monotonic` so
    its tests can drive time), and an absolute value from that clock would be
    meaningless here. Resolving it against the running loop at entry keeps both
    ends of the comparison on one clock.
    """

    deadline: float | None = None
    if seconds is not None:
        try:
            deadline = asyncio.get_running_loop().time() + seconds
        except RuntimeError:  # no running loop: nothing to bound against
            deadline = None
    token = _stage_deadline.set(deadline)
    try:
        yield
    finally:
        _stage_deadline.reset(token)


def provider_timeout_seconds() -> float:
    """The configured ceiling for one provider attempt."""

    import os

    raw = os.environ.get("MAJORANA_LLM_TIMEOUT_SECONDS")
    if raw is None:
        return _DEFAULT_PROVIDER_TIMEOUT_SECONDS
    try:
        value = float(raw)
    except ValueError:
        return _DEFAULT_PROVIDER_TIMEOUT_SECONDS
    if not math.isfinite(value) or not 1.0 <= value <= _MAX_PROVIDER_TIMEOUT_SECONDS:
        return _DEFAULT_PROVIDER_TIMEOUT_SECONDS
    return value


def attempt_timeout_seconds(now: float | None = None) -> float:
    """Bound one provider attempt so a half-open response cannot stall a run forever.

    The configured ceiling alone could not do that. It defaults to 120 s while a
    stage of a 120 s run gets roughly 90 s, so the ceiling was unreachable: every
    stalled provider call was cancelled by the stage budget instead, and surfaced
    as `stage_time_budget_exhausted` — a TIMEOUT failure, which is not retryable.
    One unanswered request therefore killed the whole run while naming Leona's own
    budget management as the cause.

    Measured in production 2026-08-02, runs 019fc318 and 019fc325: the plan stage
    opened its provider request and the transaction carrying it stayed open for
    91.6 s, against a ~90 s stage budget and a 120 s ceiling. Both runs died with
    ~25 s of finalization reserve untouched and no retry attempted.

    So an attempt gets the smaller of the ceiling and its share of the time the
    stage actually has left. A stall then fails as a retryable provider timeout
    with budget still on the clock, which is the difference between a slow plan
    and a failed run.

    This value is handed to httpx, whose `Timeout` bounds each OPERATION —
    connect, read, write, pool — and not the request's total lifetime. On a
    streaming call every chunk resets the read timeout, so a provider dripping
    one token at a time could outlive any per-operation bound. Both `complete`
    implementations therefore also wrap the call in `asyncio.timeout()` with the
    same number, which is the only thing here that bounds wall clock.
    """

    ceiling = provider_timeout_seconds()
    deadline = _stage_deadline.get()
    if deadline is None:
        return ceiling
    if now is None:
        try:
            now = asyncio.get_running_loop().time()
        except RuntimeError:  # no running loop: nothing is enforcing a stage budget
            return ceiling
    remaining = deadline - now
    if remaining <= 0.0:
        # The stage is already over. Do not hand the provider a negative or zero
        # timeout (httpx treats <= 0 inconsistently); let the caller's own
        # cancellation win on the first await.
        return _MIN_STAGE_ATTEMPT_SECONDS
    share = max(remaining * _STAGE_ATTEMPT_SHARE, _MIN_STAGE_ATTEMPT_SECONDS)
    return min(ceiling, share, remaining)


class LLMMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


def request_messages(request: LLMRequest) -> list[dict[str, str]]:
    """Return the conversation body without changing the legacy single-user API."""
    if request.messages is not None:
        return [message.model_dump() for message in request.messages]
    return [{"role": "user", "content": request.user}]


def conversation_request_messages(
    history: Sequence[Mapping[str, str]], current_user: str
) -> list[dict[str, str]] | None:
    """History with the current request appended, or None when there is none.

    The inverse of `request_messages`, and deliberately in the same module: this
    is the only place that decides what a conversation turn looks like on the
    wire. Three callers (intent routing, the pipeline stages, and chat) each
    built this list themselves and had already drifted on the empty case — chat
    returned a one-element list where the others returned None. Both reach the
    provider as the same single user turn *only because* `request_messages`
    falls back to `request.user`, which is a coincidence of two functions
    agreeing, not a guarantee. Returning None here makes it one function.
    """
    if not history:
        return None
    return [
        *({"role": message["role"], "content": message["content"]} for message in history),
        {"role": "user", "content": current_user},
    ]


class LLMClient(Protocol):
    async def complete(
        self, request: LLMRequest, *, on_delta: DeltaHandler | None = None
    ) -> LLMResponse: ...


def endpoint_for(model: str) -> tuple[str | None, str]:
    """(base_url, key_env) for an OpenAI-compatible model id. DeepSeek models go
    to the DeepSeek endpoint (OpenAI-compatible API); everything else to OpenAI
    (base_url None = the SDK default). Kept module-level so routing is testable
    without either SDK or key."""
    if model.startswith("deepseek"):
        import os

        return os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), "DEEPSEEK_API_KEY"
    return None, "OPENAI_API_KEY"


def missing_provider_keys() -> frozenset[str]:
    """Which API-key env vars the ACTIVE profile needs and does not have.

    Empty means every role the product can call has a key behind it.

    Derived from the role→model→endpoint chain rather than hand-listed, because
    three hand-listed copies of this had already drifted from `_DEFAULTS`: the
    evals harness demanded both OPENAI_API_KEY and DEEPSEEK_API_KEY for the
    openai profile, and bench.yml's guard said the same in a comment, months
    after every role moved to a deepseek model. A DeepSeek-only environment is a
    complete profile today; both of those would have skipped a run that works.

    Honours MAJORANA_MODEL_* overrides for free: an operator who points one role
    at an OpenAI model makes OPENAI_API_KEY genuinely required, and this reports
    it without anyone remembering to update a list.
    """
    import os

    from majorana_llm.models import model_for, resolve_provider, roles_for_profile

    if resolve_provider() == "anthropic":
        return (
            frozenset() if os.environ.get("ANTHROPIC_API_KEY") else frozenset({"ANTHROPIC_API_KEY"})
        )
    required = {endpoint_for(model_for(role))[1] for role in roles_for_profile()}
    return frozenset(key for key in required if not os.environ.get(key))


def decode_params(request: LLMRequest, key_env: str) -> tuple[dict[str, Any], str]:
    """(extra completion kwargs, effective system prompt) for an OpenAI-compatible
    call. GPT-5-series chat completions deprecate max_tokens (reasoning tokens count
    against max_completion_tokens) and reject non-default temperature; DeepSeek keeps
    the classic parameters. Structured decoding: OpenAI gets response_format
    json_schema; DeepSeek 400s on json_schema ("This response_format type is
    unavailable now", verified live 2026-07-11), so it gets json_object (guarantees
    syntactically valid JSON) plus the schema injected into the system message to pin
    field names/enums. Module-level so the routing is testable without the SDK."""
    params: dict[str, Any]
    if key_env == "DEEPSEEK_API_KEY":
        params = {
            "temperature": request.temperature,
            # namekoQ's production compatibility shim sends this on every
            # DeepSeek request.  It prevents V4 Pro from consuming the response
            # budget and wall clock on hidden reasoning before emitting content.
            "extra_body": {"thinking": {"type": "disabled"}},
        }
        if request.max_tokens is not None:
            params["max_tokens"] = request.max_tokens
    else:
        params = {}
        if request.max_tokens is not None:
            params["max_completion_tokens"] = request.max_tokens
    system = request.system
    if request.response_schema is not None:
        if key_env == "DEEPSEEK_API_KEY":
            params["response_format"] = {"type": "json_object"}
            system = (
                f"{system}\n\nYour reply must be exactly one JSON object that "
                f"validates against this JSON Schema:\n"
                f"{json.dumps(request.response_schema)}"
            )
        else:
            # Not strict-mode: the Plan schema has optional fields and value
            # constraints that strict json_schema rejects; schema-guided
            # decoding is what fixes plan_invalid, not strict validation.
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "schema": request.response_schema,
                },
            }
    return params, system


def classify_provider_error(
    exception: Exception,
    *,
    provider: str,
    model: str,
) -> LLMProviderError:
    """Map SDK-specific exceptions to a stable, secret-free failure contract."""

    status = getattr(exception, "status_code", None)
    status_code = status if isinstance(status, int) else None
    raw_code = getattr(exception, "code", None)
    body = getattr(exception, "body", None)
    if not isinstance(raw_code, str) and isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("code"), str):
            raw_code = error["code"]
    provider_code = raw_code.lower() if isinstance(raw_code, str) else ""
    name = type(exception).__name__.lower()

    if provider_code in {
        "insufficient_quota",
        "billing_hard_limit_reached",
        "billing_not_active",
    }:
        code, retryable = "quota_exhausted", False
    elif status_code == 429:
        code, retryable = "rate_limited", True
    elif status_code == 401 or "authentication" in name:
        code, retryable = "authentication_failed", False
    elif status_code == 403 or "permission" in name:
        code, retryable = "permission_denied", False
    elif status_code == 404 or provider_code == "model_not_found":
        code, retryable = "model_not_found", False
    elif status_code == 400 or "badrequest" in name:
        code, retryable = "bad_request", False
    elif status_code is not None and status_code >= 500:
        code, retryable = "upstream_unavailable", True
    elif status_code in {408, 409, 425}:
        code, retryable = "transient_http_error", True
    elif isinstance(exception, TimeoutError) or "timeout" in name:
        code, retryable = "timeout", True
    elif "connection" in name:
        code, retryable = "connection_error", True
    else:
        code, retryable = "provider_error", False
    return LLMProviderError(
        provider=provider,
        model=model,
        code=code,
        retryable=retryable,
        status_code=status_code,
    )


class OpenAICompatibleLLM:
    """Owner-confirmed production client (OpenAI + DeepSeek, 2026-07-10). Routes
    per model id via endpoint_for, so one client serves the mixed per-stage
    tiering (GPT for plan/verify, DeepSeek for generate/writeback). Lazy SDK
    import, same as AnthropicLLM."""

    async def complete(
        self, request: LLMRequest, *, on_delta: DeltaHandler | None = None
    ) -> LLMResponse:
        base_url, key_env = endpoint_for(request.model)
        provider = "deepseek" if key_env == "DEEPSEEK_API_KEY" else "openai"
        try:
            from openai import AsyncOpenAI  # type: ignore
        except Exception as exc:  # pragma: no cover - only without the SDK
            raise LLMProviderError(
                provider=provider,
                model=request.model,
                code="client_unavailable",
                retryable=False,
            ) from exc
        import os

        api_key = os.environ.get(key_env)
        if not api_key:
            raise LLMProviderError(
                provider=provider,
                model=request.model,
                code="credentials_missing",
                retryable=False,
            )

        params, system = decode_params(request, key_env)

        messages = [{"role": "system", "content": system}, *request_messages(request)]
        # One number, read once: the wall-clock bound below and the
        # per-operation bound handed to httpx must not be two different values.
        attempt_budget = attempt_timeout_seconds()
        try:
            # `asyncio.timeout` is what bounds the WALL CLOCK. httpx's own
            # timeout is per operation and a stream resets its read timeout on
            # every chunk, so the SDK's value alone cannot stop a slow drip from
            # outliving the stage that owns this call. TimeoutError lands in the
            # handler below and is classified as a retryable provider timeout.
            #
            # RetryingLLM below is the one retry authority. Disabling the SDK's
            # implicit retries prevents 3x3 request amplification on one 429.
            client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url,
                max_retries=0,
                timeout=attempt_budget,
            )
            async with asyncio.timeout(attempt_budget):
                if on_delta is None:
                    completion = await client.chat.completions.create(
                        model=request.model,
                        messages=messages,
                        **params,
                    )
                    text = completion.choices[0].message.content or ""
                    usage = completion.usage
                    served_model = getattr(completion, "model", None)
                else:
                    stream = await client.chat.completions.create(
                        model=request.model,
                        messages=messages,
                        stream=True,
                        **params,
                    )
                    text_parts: list[str] = []
                    usage = None
                    served_model = None
                    async for chunk in stream:
                        served_model = getattr(chunk, "model", None) or served_model
                        if getattr(chunk, "usage", None) is not None:
                            usage = chunk.usage
                        for choice in getattr(chunk, "choices", []) or []:
                            delta = choice.delta
                            reasoning = getattr(delta, "reasoning_content", None) or ""
                            content = getattr(delta, "content", None) or ""
                            if reasoning:
                                await on_delta(reasoning, "reasoning")
                            if content:
                                text_parts.append(content)
                                await on_delta(content, "output")
                    text = "".join(text_parts)
        except LLMProviderError:
            raise
        except Exception as exc:
            raise classify_provider_error(
                exc,
                provider=provider,
                model=request.model,
            ) from exc
        # Missing usage must not silently zero the llm.call event (quota/event
        # integrity); use a conservative character-length estimate instead.
        input_chars = len(system) + sum(
            len(message["content"]) for message in request_messages(request)
        )
        return LLMResponse(
            text=text,
            # What the PROVIDER says it served, not what we asked for. An alias or a
            # silent substitution is invisible when the request is echoed back, and
            # this value is what the llm.call event and the stored response row carry —
            # the only durable record of which model actually produced a run.
            model=str(served_model or request.model),
            input_tokens=(
                int(usage.prompt_tokens)
                if usage and getattr(usage, "prompt_tokens", None) is not None
                else max(1, input_chars // 4)
            ),
            output_tokens=(
                int(usage.completion_tokens)
                if usage and getattr(usage, "completion_tokens", None) is not None
                else max(1, len(text) // 4)
            ),
        )


class RetryingLLM:
    """Retries a completion that came back empty, or that failed in transport.

    An empty completion is not a rare event: `deepseek-reasoner` returned one at the
    planning stage on two production runs (019f7dad-3a24, 019f7de2-a45b), and both
    dead-lettered before a line of code was written. Once the real verification
    defects were fixed, the provider returning nothing became the single most common
    reason a run dies — so the retry belongs here, at the one seam every stage passes
    through, rather than being re-implemented per stage.

    It only retries when nothing was delivered. A stream that emitted deltas has
    already been observed by the caller, and replaying it would duplicate the run's
    output; that response is returned as-is even if it is short.
    """

    def __init__(
        self,
        inner: "LLMClient",
        *,
        attempts: int = 3,
        backoff_seconds: float = 1.0,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        if attempts < 1:
            raise ValueError("attempts must be >= 1")
        self._inner = inner
        self._attempts = attempts
        self._backoff = backoff_seconds
        self._sleep = sleep

    async def _wait(self, attempt: int) -> None:
        delay = self._backoff * (2**attempt)
        if self._sleep is not None:
            await self._sleep(delay)
            return
        import asyncio

        await asyncio.sleep(delay)

    async def complete(
        self, request: LLMRequest, *, on_delta: DeltaHandler | None = None
    ) -> LLMResponse:
        emitted = False

        async def tracking_delta(text: str, channel: str) -> None:
            nonlocal emitted
            emitted = True
            assert on_delta is not None
            await on_delta(text, channel)

        last_response: LLMResponse | None = None
        last_error: Exception | None = None
        for attempt in range(self._attempts):
            emitted = False
            try:
                response = await self._inner.complete(
                    request, on_delta=None if on_delta is None else tracking_delta
                )
            except Exception as exc:  # noqa: BLE001 - re-raised below if every attempt fails
                last_error = exc
                retryable = (
                    exc.retryable
                    if isinstance(exc, LLMProviderError)
                    else isinstance(exc, (TimeoutError, ConnectionError))
                )
                if emitted or not retryable or attempt == self._attempts - 1:
                    raise
                await self._wait(attempt)
                continue
            if response.text.strip() or emitted:
                return response
            last_response = response
            if attempt < self._attempts - 1:
                await self._wait(attempt)
        if last_response is not None:
            # Returned, not raised: the caller's parser reports what was missing, and
            # its message already distinguishes an empty completion from prose.
            return last_response
        raise last_error if last_error is not None else RuntimeError("no completion attempted")


def default_llm() -> "LLMClient":
    """The production client for the active provider profile (models.resolve_provider):
    OpenAI-compatible when OPENAI/DEEPSEEK keys (or MAJORANA_LLM_PROVIDER=openai) are
    set, Anthropic otherwise. Wrapped in RetryingLLM because the provider returning
    nothing is now the most common way a run dies."""
    from majorana_llm.models import resolve_provider

    inner = OpenAICompatibleLLM() if resolve_provider() == "openai" else AnthropicLLM()
    return RetryingLLM(inner)


# Unlike the OpenAI-compatible chat completions API, Anthropic's Messages API
# requires a numeric max_tokens on every call — there is no "omit for provider
# default" option. This is the fallback only when a caller left LLMRequest's
# max_tokens unset; it is deliberately generous rather than a tight guess, for
# the same reason the OpenAI-compatible path omits the cap entirely now.
_ANTHROPIC_DEFAULT_MAX_TOKENS = 16384


class AnthropicLLM:
    """Real Anthropic provider client with lazy SDK loading."""

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key

    async def complete(
        self, request: LLMRequest, *, on_delta: DeltaHandler | None = None
    ) -> LLMResponse:
        try:
            from anthropic import AsyncAnthropic  # type: ignore
        except Exception as exc:  # pragma: no cover - only without the SDK
            raise LLMProviderError(
                provider="anthropic",
                model=request.model,
                code="client_unavailable",
                retryable=False,
            ) from exc
        import os

        api_key = self._api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise LLMProviderError(
                provider="anthropic",
                model=request.model,
                code="credentials_missing",
                retryable=False,
            )

        # No response_format on the Messages API — approximate structured decoding
        # by appending the schema to the system prompt (weaker; the OpenAI-compatible
        # profile is the production default).
        system = request.system
        if request.response_schema is not None:
            system = (
                f"{system}\n\nYour reply must be exactly one JSON object that validates "
                f"against this JSON Schema:\n{json.dumps(request.response_schema)}"
            )

        max_tokens = request.max_tokens or _ANTHROPIC_DEFAULT_MAX_TOKENS
        messages = request_messages(request)
        # `request.temperature` is deliberately NOT forwarded on this profile, and
        # the omission is load-bearing rather than an oversight.
        #
        # Sampling parameters are gone from the Messages API on every model this
        # profile is configured for. `models.py` pins `claude-opus-4-8` (plan,
        # verify, analyze) and `claude-sonnet-5` (chat, generate, audit): Opus 4.7
        # and later return 400 for a request carrying `temperature` AT ALL — the
        # default value included — and Sonnet 5 rejects any non-default value, so
        # even the 0.0 this codebase asks for everywhere would be refused.
        #
        # The `anthropic` SDK removed it too. Verified against 1.0.0 rather than
        # read off a changelog: `messages.create` and `messages.stream` have no
        # `temperature` parameter and no `**kwargs`, so passing one is a
        # `TypeError` before a request is ever built. Both call sites below used
        # to, which is why the 0.121.0 -> 1.0.0 bump could not land.
        #
        # Nothing regressed when this was removed, because nothing was working:
        # `resolve_provider()` prefers OpenAI/DeepSeek whenever either key is set,
        # CI sets both, and production sets both — so this branch is a fallback
        # that no test and no deploy has ever executed against the real SDK. It
        # would have failed on the first request that reached it.
        #
        # The OpenAI-compatible profile above still forwards `temperature`, which
        # is correct: those models still accept it. That is a real capability
        # difference between the two profiles, not an inconsistency to tidy — a
        # caller who needs a specific sampling temperature cannot get one from
        # Anthropic's current models through any SDK.
        # Same wall-clock bound as the OpenAI-compatible client above, and for
        # the same reason: the SDK's timeout is per operation, not per request.
        attempt_budget = attempt_timeout_seconds()
        try:
            client = AsyncAnthropic(
                api_key=api_key,
                max_retries=0,
                timeout=attempt_budget,
            )
            async with asyncio.timeout(attempt_budget):
                if on_delta is None:
                    message = await client.messages.create(
                        model=request.model,
                        max_tokens=max_tokens,
                        system=system,
                        messages=messages,
                    )
                    text = "".join(block.text for block in message.content if block.type == "text")
                else:
                    text_parts: list[str] = []
                    async with client.messages.stream(
                        model=request.model,
                        max_tokens=max_tokens,
                        system=system,
                        messages=messages,
                    ) as stream:
                        async for fragment in stream.text_stream:
                            text_parts.append(fragment)
                            await on_delta(fragment, "output")
                        message = await stream.get_final_message()
                    text = "".join(text_parts)
        except LLMProviderError:
            raise
        except Exception as exc:
            raise classify_provider_error(
                exc,
                provider="anthropic",
                model=request.model,
            ) from exc
        return LLMResponse(
            text=text,
            # Provider-reported, for the same reason as the OpenAI-compatible path.
            model=str(getattr(message, "model", None) or request.model),
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
        )
