import sys
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import Stage
from majorana_llm import (
    CHAT_SYSTEM_PROMPT,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    RetryingLLM,
    SIMPLE_GENERATION_SYSTEM_PROMPT,
    SIMPLE_PLAN_SYSTEM_PROMPT,
    SIMPLE_REVIEW_SYSTEM_PROMPT,
    StageOutputError,
    classify_provider_error,
    endpoint_for,
    extract_json,
    model_for,
    resolve_provider,
)


def test_generation_prompt_always_embeds_nameko_style_reference_implementations():
    prompt = SIMPLE_GENERATION_SYSTEM_PROMPT

    assert "Reference implementations (always available)" in prompt
    assert "Example 1 — Qiskit Bell state" in prompt
    assert "Example 2 — Qiskit H2 VQE" in prompt
    assert "Example 3 — Qiskit portfolio QAOA" in prompt
    assert '("II", -0.3324043)' in prompt
    assert "TOTAL energies near -1.137 Ha" in prompt
    assert "DEMO DATA ONLY" in prompt
    assert "The request and known_reference override every example." in prompt
    assert prompt.count("FINAL_CIRCUIT =") >= 3
    assert prompt.count("RESULT =") >= 3


def test_model_constants_use_v4_pro_for_all_product_stages_and_are_env_overridable(monkeypatch):
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "openai")
    assert model_for("chat") == "deepseek-v4-pro"
    assert model_for("route") == "deepseek-v4-pro"
    assert model_for(Stage.PLAN) == "deepseek-v4-pro"
    assert model_for(Stage.GENERATE) == "deepseek-v4-pro"
    assert model_for(Stage.VERIFY) == "deepseek-v4-pro"
    monkeypatch.setenv("MAJORANA_MODEL_PLAN", "custom-model")
    assert model_for(Stage.PLAN) == "custom-model"


def _clear_provider_env(monkeypatch):
    for var in ("MAJORANA_LLM_PROVIDER", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def test_provider_resolution_prefers_owner_confirmed_keys(monkeypatch):
    _clear_provider_env(monkeypatch)
    assert resolve_provider() == "anthropic"  # no keys → safe fallback
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    assert resolve_provider() == "openai"
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "anthropic")
    assert resolve_provider() == "anthropic"  # explicit env wins
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "nonsense")
    with pytest.raises(ValueError):
        resolve_provider()


def test_model_defaults_follow_provider_profile(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    assert model_for(Stage.PLAN) == "deepseek-v4-pro"
    assert model_for(Stage.GENERATE) == "deepseek-v4-pro"
    assert model_for(Stage.VERIFY) == "deepseek-v4-pro"


def test_endpoint_routing_by_model_prefix(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_BASE_URL", raising=False)
    base, key_env = endpoint_for("deepseek-v4-pro")
    assert base == "https://api.deepseek.com" and key_env == "DEEPSEEK_API_KEY"
    base, key_env = endpoint_for("gpt-5.5")
    assert base is None and key_env == "OPENAI_API_KEY"


def test_structured_decoding_routes_per_endpoint():
    from majorana_llm.client import decode_params

    schema = {"type": "object", "properties": {"a": {"type": "string"}}}
    req = LLMRequest(model="m", system="sys", user="u", response_schema=schema, schema_name="plan")
    # OpenAI: true json_schema, system untouched.
    params, system = decode_params(req, "OPENAI_API_KEY")
    assert params["response_format"]["type"] == "json_schema"
    assert params["response_format"]["json_schema"]["schema"] == schema
    assert system == "sys"
    # DeepSeek rejects json_schema → json_object + schema injected into the system.
    params, system = decode_params(req, "DEEPSEEK_API_KEY")
    assert params["response_format"] == {"type": "json_object"}
    assert params["extra_body"] == {"thinking": {"type": "disabled"}}
    assert '"a"' in system and system.startswith("sys")
    # No schema → no response_format at all.
    params, system = decode_params(LLMRequest(model="m", system="sys", user="u"), "OPENAI_API_KEY")
    assert "response_format" not in params


def test_request_schema_is_optional_on_the_request_model():
    assert LLMRequest(model="m", system="s", user="u").response_schema is None


def test_max_tokens_defaults_to_unset_and_stays_out_of_the_wire_params():
    """No self-imposed cap unless a caller opts in: bench-14 (2026-07-11) found a
    reasoning model burning a fixed max_tokens budget entirely on reasoning, zero
    code out — the cap itself was the failure. Omitted here, the provider's own
    ceiling applies instead (the same choice namekoQ makes throughout)."""
    from majorana_llm.client import decode_params

    req = LLMRequest(model="m", system="sys", user="u")
    assert req.max_tokens is None
    openai_params, _ = decode_params(req, "OPENAI_API_KEY")
    assert "max_completion_tokens" not in openai_params
    deepseek_params, _ = decode_params(req, "DEEPSEEK_API_KEY")
    assert "max_tokens" not in deepseek_params

    capped = LLMRequest(model="m", system="sys", user="u", max_tokens=2048)
    assert decode_params(capped, "OPENAI_API_KEY")[0]["max_completion_tokens"] == 2048
    assert decode_params(capped, "DEEPSEEK_API_KEY")[0]["max_tokens"] == 2048


async def test_openai_compatible_llm_streams_reasoning_and_output(monkeypatch):
    calls: list[dict] = []
    client_options: list[dict] = []

    async def provider_stream():
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(delta=SimpleNamespace(reasoning_content="think ", content=None))
            ],
            usage=None,
        )
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(delta=SimpleNamespace(reasoning_content=None, content="answer"))
            ],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
        )

    class RecordingCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return provider_stream()

    class RecordingAsyncOpenAI:
        def __init__(self, **kwargs):
            client_options.append(kwargs)
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    seen: list[tuple[str, str]] = []

    async def on_delta(text: str, kind: str) -> None:
        seen.append((text, kind))

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user"),
        on_delta=on_delta,
    )

    assert response.text == "answer"
    assert response.input_tokens == 3
    assert response.output_tokens == 2
    assert seen == [("think ", "reasoning"), ("answer", "output")]
    assert calls[0]["stream"] is True
    assert calls[0]["extra_body"] == {"thinking": {"type": "disabled"}}
    assert client_options[0]["max_retries"] == 0


async def test_openai_compatible_llm_fails_fast_with_typed_missing_credentials(monkeypatch):
    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            raise AssertionError("client must not be created without credentials")

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    from majorana_llm.client import OpenAICompatibleLLM

    with pytest.raises(LLMProviderError) as caught:
        await OpenAICompatibleLLM().complete(
            LLMRequest(model="deepseek-v4-pro", system="system", user="user")
        )

    assert caught.value.code == "credentials_missing"
    assert caught.value.provider == "deepseek"
    assert caught.value.retryable is False


async def test_anthropic_provider_errors_use_the_same_typed_contract(monkeypatch):
    class AuthenticationFailure(Exception):
        status_code = 401

    class FailingMessages:
        async def create(self, **_kwargs):
            raise AuthenticationFailure("secret-bearing SDK message")

    class RecordingAsyncAnthropic:
        def __init__(self, **_kwargs):
            self.messages = FailingMessages()

    monkeypatch.setitem(
        sys.modules,
        "anthropic",
        SimpleNamespace(AsyncAnthropic=RecordingAsyncAnthropic),
    )

    from majorana_llm.client import AnthropicLLM

    with pytest.raises(LLMProviderError) as caught:
        await AnthropicLLM(api_key="test-key").complete(
            LLMRequest(model="claude-sonnet-5", system="system", user="user")
        )

    assert caught.value.code == "authentication_failed"
    assert caught.value.provider == "anthropic"
    assert caught.value.retryable is False
    assert "secret-bearing" not in str(caught.value)


def test_provider_error_classification_separates_quota_from_transient_rate_limit():
    class ProviderFailure(Exception):
        def __init__(self, *, status_code, code):
            self.status_code = status_code
            self.code = code

    quota = classify_provider_error(
        ProviderFailure(status_code=429, code="insufficient_quota"),
        provider="openai",
        model="gpt",
    )
    limited = classify_provider_error(
        ProviderFailure(status_code=429, code="rate_limit_exceeded"),
        provider="deepseek",
        model="deepseek-v4-pro",
    )

    assert quota.code == "quota_exhausted"
    assert quota.retryable is False
    assert limited.code == "rate_limited"
    assert limited.retryable is True
    assert quota.safe_details() == {
        "provider": "openai",
        "model": "gpt",
        "provider_code": "quota_exhausted",
        "status_code": 429,
        "retryable": False,
    }


def test_chat_persona_cannot_narrate_results_it_did_not_produce():
    # The chat turn cannot execute anything, so the persona must not let the
    # model narrate results it did not produce.
    assert "never report simulation output" in CHAT_SYSTEM_PROMPT


def test_grover_plan_and_review_prompts_pin_attainable_iteration_arithmetic():
    assert "four qubits needs about three iterations, not one" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "Recompute simple arithmetic instead of trusting a Plan rationale" in (
        SIMPLE_REVIEW_SYSTEM_PROMPT
    )
    assert "return REPLAN" in SIMPLE_REVIEW_SYSTEM_PROMPT


def test_json_extraction_accepts_fences_and_never_echoes_bad_output():
    assert extract_json('prefix ```json\\n{"ok": true}\\n``` suffix') == '{"ok": true}'
    secret = "sensitive-model-output"
    with pytest.raises(StageOutputError) as captured:
        extract_json(secret)
    assert secret not in str(captured.value)


# --- RetryingLLM ---------------------------------------------------------------
#
# `deepseek-reasoner` returned a completely empty completion at the planning stage on
# two production runs (019f7dad-3a24, 019f7de2-a45b) and both dead-lettered before a
# line of code was written. Once the real verification defects were fixed, the provider
# returning nothing became the most common reason a run dies.


class _EmptyThenText:
    def __init__(self, empties: int) -> None:
        self.calls = 0
        self._empties = empties

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        text = "" if self.calls <= self._empties else '{"ok": true}'
        return LLMResponse(text=text, model=request.model, input_tokens=1, output_tokens=1)


async def _no_sleep(_delay: float) -> None:
    return None


def _request() -> LLMRequest:
    return LLMRequest(model="deepseek-reasoner", system="s", user="u")


async def test_an_empty_completion_is_retried():
    inner = _EmptyThenText(empties=2)
    response = await RetryingLLM(inner, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3
    assert response.text == '{"ok": true}'


async def test_retries_are_bounded_and_the_last_empty_reply_is_returned_not_raised():
    """Returned, not raised: the caller's parser reports what was missing, and its
    message already tells an empty completion apart from prose (`len=0, blank=True`)."""
    inner = _EmptyThenText(empties=99)
    response = await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3
    assert response.text == ""


async def test_a_transport_failure_is_retried_then_re_raised():
    class _AlwaysRaises:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise TimeoutError("connection reset")

    inner = _AlwaysRaises()
    with pytest.raises(TimeoutError):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3


async def test_a_permanent_provider_failure_is_not_retried():
    class _PermanentFailure:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise LLMProviderError(
                provider="deepseek",
                model=request.model,
                code="authentication_failed",
                retryable=False,
                status_code=401,
            )

    inner = _PermanentFailure()
    with pytest.raises(LLMProviderError, match="authentication_failed"):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 1


async def test_an_unknown_programming_failure_is_not_retried():
    class _ProgrammingFailure:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise RuntimeError("unexpected adapter defect")

    inner = _ProgrammingFailure()
    with pytest.raises(RuntimeError, match="adapter defect"):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 1


async def test_a_transient_provider_failure_uses_only_the_outer_retry_budget():
    class _TransientFailure:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise LLMProviderError(
                provider="deepseek",
                model=request.model,
                code="upstream_unavailable",
                retryable=True,
                status_code=503,
            )

    inner = _TransientFailure()
    with pytest.raises(LLMProviderError, match="upstream_unavailable"):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3


async def test_a_stream_that_already_emitted_is_never_replayed():
    """Retrying after deltas reached the caller would duplicate the run's visible
    output. A response that delivered something is delivered, however short."""

    class _StreamsThenEmpty:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            if on_delta is not None:
                await on_delta("partial", "output")
            return LLMResponse(text="", model=request.model, input_tokens=1, output_tokens=1)

    inner = _StreamsThenEmpty()
    seen: list[str] = []

    async def collect(text: str, _channel: str) -> None:
        seen.append(text)

    await RetryingLLM(inner, sleep=_no_sleep).complete(_request(), on_delta=collect)
    assert inner.calls == 1
    assert seen == ["partial"]


async def test_backoff_grows_between_attempts():
    delays: list[float] = []

    async def record(delay: float) -> None:
        delays.append(delay)

    await RetryingLLM(_EmptyThenText(empties=99), attempts=3, sleep=record).complete(_request())
    assert delays == [1.0, 2.0]


async def test_response_records_the_model_the_provider_says_it_served(monkeypatch):
    """The stored llm.call is the only durable record of which model ran a stage.

    Echoing the requested name back would make an alias or a silent substitution
    invisible, so "is this really running deepseek-v4-pro?" could never be answered
    from the run's own evidence.
    """

    class RecordingCompletions:
        async def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
                usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
                model="deepseek-v4-pro-2026-07-01",
            )

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user")
    )

    assert response.model == "deepseek-v4-pro-2026-07-01"


async def test_response_falls_back_to_the_requested_model_when_none_is_reported(monkeypatch):
    class RecordingCompletions:
        async def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
                usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
                model=None,
            )

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user")
    )

    assert response.model == "deepseek-v4-pro"


async def test_streamed_response_also_records_the_served_model(monkeypatch):
    async def provider_stream():
        yield SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(reasoning_content=None, content="a"))],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
            model="deepseek-v4-pro-2026-07-01",
        )

    class RecordingCompletions:
        async def create(self, **_kwargs):
            return provider_stream()

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    async def on_delta(_text: str, _kind: str) -> None:
        return None

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user"),
        on_delta=on_delta,
    )

    assert response.model == "deepseek-v4-pro-2026-07-01"
