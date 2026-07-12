"""Per-stage model constants. Strong model for judgment-heavy stages (plan,
verify-critic), cheaper tiers for generation and writeback — the token-economy
tiering from the house workflow.

Provider: owner confirmed OpenAI + DeepSeek (2026-07-10 Owner Inbox — the legacy
product's providers; keys live in the nameko Vercel project). The OpenAI-compatible
profile is therefore the effective production default; the Anthropic profile
remains available behind MAJORANA_LLM_PROVIDER=anthropic. Every constant is
overridable by env so switching models is a config change."""

from __future__ import annotations

import os

from majorana_contracts.enums import Stage

# Per-provider stage defaults. Override any stage with MAJORANA_MODEL_<STAGE>.
_DEFAULTS: dict[str, dict[str, str]] = {
    "openai": {
        # Legacy nameko tiering: GPT for judgment, DeepSeek for volume work.
        "plan": "gpt-5.5",  # structured planning + judgment
        # Non-reasoning tier: v4-pro reproducibly burned its whole 8192 budget on
        # reasoning with zero content on VQE-scale tasks (bench-14, 2026-07-11);
        # deepseek-chat produced real code in 1.5k tokens / 14s on the same case.
        "generate": "deepseek-chat",
        "verify": "gpt-5.5",  # strict critic — high-stakes review
        "writeback": "deepseek-v4-pro",  # library metadata + explanations
    },
    "anthropic": {
        "plan": "claude-opus-4-8",
        "generate": "claude-sonnet-5",
        "verify": "claude-opus-4-8",
        "writeback": "claude-haiku-4-5-20251001",
    },
}


def resolve_provider() -> str:
    """Which provider profile is active: MAJORANA_LLM_PROVIDER wins; otherwise
    infer from which API keys are present (OpenAI/DeepSeek preferred — the
    owner-confirmed providers), falling back to anthropic."""
    explicit = os.environ.get("MAJORANA_LLM_PROVIDER")
    if explicit:
        if explicit not in _DEFAULTS:
            raise ValueError(f"unknown MAJORANA_LLM_PROVIDER {explicit!r}")
        return explicit
    if os.environ.get("OPENAI_API_KEY") or os.environ.get("DEEPSEEK_API_KEY"):
        return "openai"
    return "anthropic"


def model_for(stage: Stage | str) -> str:
    """The model id for a pipeline stage. Deterministic control-plane stages
    (screen, estimates, compilation, execution, baseline, analysis, save) fall
    back to the generate-tier default if a caller asks for a model anyway."""
    key = stage.value if isinstance(stage, Stage) else str(stage)
    env = os.environ.get(f"MAJORANA_MODEL_{key.upper()}")
    defaults = _DEFAULTS[resolve_provider()]
    return env or defaults.get(key, defaults["generate"])
