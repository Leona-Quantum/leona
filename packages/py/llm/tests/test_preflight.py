"""Preflight must prove UNSUPPORTED and must never guess it.

The bug this guards (2026-07-26): stale MAJORANA_MODEL_* overrides on the live
Cloud Run worker named retired DeepSeek models, so every execute run 400'd at the
plan stage while the deploy stayed green.
"""

import pytest
from majorana_llm import preflight
from majorana_llm.preflight import (
    ModelStatus,
    PreflightReport,
    RoleModel,
    check_configured_models,
    configured_models,
)


@pytest.fixture(autouse=True)
def openai_profile(monkeypatch):
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "openai")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-deepseek-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    for role in preflight.PRODUCTION_ROLES:
        monkeypatch.delenv(f"MAJORANA_MODEL_{role.upper()}", raising=False)


def _serve(monkeypatch, served):
    """Pin the endpoint model listing; None means 'could not be asked'."""
    calls: list[tuple[str | None, str]] = []

    async def fake_openai(base_url, api_key):
        calls.append((base_url, api_key))
        return None if served is None else frozenset(served)

    monkeypatch.setattr(preflight, "_openai_served_models", fake_openai)
    return calls


@pytest.mark.asyncio
async def test_configured_models_reflect_env_overrides(monkeypatch):
    monkeypatch.setenv("MAJORANA_MODEL_PLAN", "deepseek-reasoner")

    assert configured_models()["plan"] == "deepseek-reasoner"
    assert configured_models()["generate"] == "deepseek-v4-pro"


@pytest.mark.asyncio
async def test_the_exact_production_drift_is_reported_as_unsupported(monkeypatch):
    """The overrides that were live on 2026-07-26, against the list DeepSeek serves."""
    monkeypatch.setenv("MAJORANA_MODEL_PLAN", "deepseek-reasoner")
    monkeypatch.setenv("MAJORANA_MODEL_GENERATE", "deepseek-chat")
    _serve(monkeypatch, {"deepseek-v4-pro", "deepseek-v4-flash"})

    report = await check_configured_models()

    assert {(role.role, role.model) for role in report.unsupported} == {
        ("plan", "deepseek-reasoner"),
        ("generate", "deepseek-chat"),
    }
    assert report.proven


@pytest.mark.asyncio
async def test_current_defaults_pass_against_the_served_list(monkeypatch):
    _serve(monkeypatch, {"deepseek-v4-pro", "deepseek-v4-flash"})

    report = await check_configured_models()

    assert report.unsupported == ()
    assert all(role.status is ModelStatus.SUPPORTED for role in report.roles)


@pytest.mark.asyncio
async def test_an_unreachable_provider_is_unknown_never_unsupported(monkeypatch):
    """No answer is not a negative answer — the alarm must stay silent."""
    _serve(monkeypatch, None)

    report = await check_configured_models()

    assert report.unsupported == ()
    assert not report.proven
    assert all(role.status is ModelStatus.UNKNOWN for role in report.roles)
    assert all(role.reason == "model_list_unavailable" for role in report.roles)


@pytest.mark.asyncio
async def test_a_missing_key_is_unknown_never_unsupported(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    calls = _serve(monkeypatch, {"deepseek-v4-pro"})

    report = await check_configured_models()

    assert report.unsupported == ()
    assert all(role.reason == "credentials_missing" for role in report.roles)
    assert calls == [], "must not call an endpoint it has no key for"


@pytest.mark.asyncio
async def test_each_endpoint_is_listed_once_not_once_per_role(monkeypatch):
    calls = _serve(monkeypatch, {"deepseek-v4-pro"})

    await check_configured_models()

    assert len(calls) == 1, f"one DeepSeek endpoint, {len(calls)} listings"


@pytest.mark.asyncio
async def test_openai_and_deepseek_ids_are_checked_against_their_own_endpoints(monkeypatch):
    """A mixed profile must not validate an OpenAI id against DeepSeek's catalogue."""
    monkeypatch.setenv("MAJORANA_MODEL_PLAN", "gpt-5")
    seen: dict[str | None, str] = {}

    async def fake_openai(base_url, api_key):
        seen[base_url] = api_key
        return frozenset(
            {"gpt-5"} if base_url is None else {"deepseek-v4-pro", "deepseek-v4-flash"}
        )

    monkeypatch.setattr(preflight, "_openai_served_models", fake_openai)

    report = await check_configured_models()

    assert report.unsupported == ()
    assert set(seen) == {None, "https://api.deepseek.com"}
    assert seen[None] == "test-openai-key"
    assert seen["https://api.deepseek.com"] == "test-deepseek-key"


def test_log_payload_names_the_offenders_and_carries_no_secret():
    report = PreflightReport(
        provider="openai",
        roles=(
            RoleModel("plan", "deepseek-reasoner", ModelStatus.UNSUPPORTED),
            RoleModel("chat", "deepseek-v4-pro", ModelStatus.SUPPORTED),
        ),
    )

    payload = report.as_log_payload()

    assert payload["unsupported"] == [{"role": "plan", "model": "deepseek-reasoner"}]
    assert payload["checked"] == {"plan": "deepseek-reasoner", "chat": "deepseek-v4-pro"}
    assert "key" not in repr(payload).lower()


@pytest.mark.asyncio
async def test_a_shutdown_cancels_the_preflight_instead_of_absorbing_it(monkeypatch):
    """Swallowing CancelledError would keep the check alive through a worker drain."""
    import asyncio

    async def never(*args, **kwargs):
        await asyncio.sleep(3600)

    monkeypatch.setattr(preflight, "check_configured_models", never)
    task = asyncio.create_task(preflight.check_with_timeout(timeout_s=30))
    await asyncio.sleep(0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_a_slow_provider_times_out_to_unknown(monkeypatch):
    import asyncio

    async def slow(*args, **kwargs):
        await asyncio.sleep(3600)

    monkeypatch.setattr(preflight, "check_configured_models", slow)

    report = await preflight.check_with_timeout(timeout_s=0.01)

    assert report.unsupported == ()
    assert not report.proven
    assert all(role.reason == "timeout" for role in report.roles)
