"""Prove the configured models exist before a run needs them.

Why this module exists (2026-07-26). Every production execute run failed instantly
for days while ten CI gates and the deploy workflow stayed green. The live Cloud Run
worker carried `MAJORANA_MODEL_PLAN=deepseek-reasoner` and
`MAJORANA_MODEL_GENERATE=deepseek-chat` — names DeepSeek's endpoint had retired — so
the plan stage 400'd on its first call. Three things conspired:

* the overrides were live-service state that no repo file owned, and
  `gcloud run deploy --image` preserves them, so no deploy ever corrected them;
* chat had no override, so it kept working and the product looked half-alive; and
* nothing between `pytest` and a human clicking Run ever asked a provider to
  answer, so "deployed" and "can call a model" were never the same claim.

The check is deliberately asymmetric. Reporting a model as unsupported requires
proof: a provider-served list that does not contain it. Everything else — no key, no
SDK, an unreachable endpoint, a provider with no model-list API — yields UNKNOWN.
A preflight that cries wolf when the network hiccups would be turned off within a
week, and then it would be worth nothing on the day it was right.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from enum import Enum

from majorana_llm.client import endpoint_for
from majorana_llm.models import model_for, resolve_provider

#: The roles a production process actually resolves a model for. Kept explicit
#: rather than derived from Stage: most Stage members are pipeline steps that
#: never call a model, and preflighting a role nobody uses would report drift
#: nobody can hit.
PRODUCTION_ROLES: tuple[str, ...] = (
    "chat",
    "route",
    "plan",
    "generate",
    "audit",
    "verify",
)


class ModelStatus(str, Enum):
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class RoleModel:
    role: str
    model: str
    status: ModelStatus
    #: Present only for UNKNOWN — why the check could not decide.
    reason: str | None = None


@dataclass(frozen=True)
class PreflightReport:
    provider: str
    roles: tuple[RoleModel, ...] = field(default_factory=tuple)

    @property
    def unsupported(self) -> tuple[RoleModel, ...]:
        return tuple(role for role in self.roles if role.status is ModelStatus.UNSUPPORTED)

    @property
    def proven(self) -> bool:
        """True when at least one role was decided either way."""
        return any(role.status is not ModelStatus.UNKNOWN for role in self.roles)

    def as_log_payload(self) -> dict[str, object]:
        """Bounded, secret-free structure for an operational log line."""
        return {
            "provider": self.provider,
            "unsupported": [{"role": role.role, "model": role.model} for role in self.unsupported],
            "checked": {role.role: role.model for role in self.roles},
        }


def configured_models(roles: tuple[str, ...] = PRODUCTION_ROLES) -> dict[str, str]:
    """role -> the model id this process would actually send, env overrides applied."""
    return {role: model_for(role) for role in roles}


async def _openai_served_models(base_url: str | None, api_key: str) -> frozenset[str] | None:
    """Model ids the endpoint serves, or None when it could not be asked.

    Uses the same SDK and routing as a real completion, so an endpoint that
    answers here is the endpoint a run would reach.
    """
    try:
        from openai import AsyncOpenAI  # type: ignore
    except Exception:
        return None
    try:
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=10.0)
        listing = await client.models.list()
    except Exception:
        # Unreachable, unauthorized, or an endpoint without /models. None of
        # these prove anything about a model id.
        return None
    served = {
        model_id
        for model in getattr(listing, "data", []) or []
        if isinstance(model_id := getattr(model, "id", None), str)
    }
    return frozenset(served) or None


async def _anthropic_served_models(api_key: str) -> frozenset[str] | None:
    try:
        from anthropic import AsyncAnthropic  # type: ignore
    except Exception:
        return None
    try:
        client = AsyncAnthropic(api_key=api_key, max_retries=0, timeout=10.0)
        listing = await client.models.list()
    except Exception:
        return None
    served = {
        model_id
        for model in getattr(listing, "data", []) or []
        if isinstance(model_id := getattr(model, "id", None), str)
    }
    return frozenset(served) or None


async def check_configured_models(
    roles: tuple[str, ...] = PRODUCTION_ROLES,
) -> PreflightReport:
    """Ask each configured endpoint whether it serves the model we would send.

    Endpoints are queried once per distinct (base_url, key) pair, not once per
    role, because the per-stage tiering routinely points several roles at the
    same model.
    """
    provider = resolve_provider()
    wanted = configured_models(roles)

    # model id -> (base_url, key_env); DeepSeek and OpenAI ids can coexist under
    # the same "openai" profile, and they are different endpoints with different
    # catalogues.
    served_by_endpoint: dict[tuple[str | None, str], frozenset[str] | None] = {}
    missing_key: set[tuple[str | None, str]] = set()

    async def served_for(model: str) -> tuple[frozenset[str] | None, str | None]:
        if provider == "anthropic":
            endpoint: tuple[str | None, str] = (None, "ANTHROPIC_API_KEY")
        else:
            endpoint = endpoint_for(model)
        if endpoint in missing_key:
            return None, "credentials_missing"
        if endpoint not in served_by_endpoint:
            api_key = os.environ.get(endpoint[1])
            if not api_key:
                missing_key.add(endpoint)
                return None, "credentials_missing"
            served_by_endpoint[endpoint] = (
                await _anthropic_served_models(api_key)
                if provider == "anthropic"
                else await _openai_served_models(endpoint[0], api_key)
            )
        served = served_by_endpoint[endpoint]
        return served, None if served is not None else "model_list_unavailable"

    results: list[RoleModel] = []
    for role, model in wanted.items():
        served, reason = await served_for(model)
        if served is None:
            results.append(RoleModel(role, model, ModelStatus.UNKNOWN, reason))
        elif model in served:
            results.append(RoleModel(role, model, ModelStatus.SUPPORTED))
        else:
            results.append(RoleModel(role, model, ModelStatus.UNSUPPORTED))
    return PreflightReport(provider=provider, roles=tuple(results))


async def check_with_timeout(
    timeout_s: float = 20.0,
    roles: tuple[str, ...] = PRODUCTION_ROLES,
) -> PreflightReport:
    """check_configured_models bounded by a wall clock; a slow provider is UNKNOWN.

    A startup check must never be able to delay the poll loop indefinitely — the
    worker's job is to drain the queue, not to finish this.

    Only the timeout is swallowed. A CancelledError means the *caller* is shutting
    down, and absorbing it would keep this coroutine running through a drain — long
    enough to emit a startup alarm while the worker is stopping.
    """
    try:
        return await asyncio.wait_for(check_configured_models(roles), timeout=timeout_s)
    except TimeoutError:
        provider = resolve_provider()
        return PreflightReport(
            provider=provider,
            roles=tuple(
                RoleModel(role, model, ModelStatus.UNKNOWN, "timeout")
                for role, model in configured_models(roles).items()
            ),
        )
