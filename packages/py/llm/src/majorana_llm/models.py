"""Per-stage model constants. Strong model for judgment-heavy stages (plan,
verify-critic), cheaper tiers for generation and writeback — the token-economy
tiering from the house workflow.

Provider is Anthropic by default. The rebuild plan did not pin an LLM provider
(the legacy product used DeepSeek/OpenAI), so this is an owner-confirmable choice;
every constant is overridable by env so switching providers is a config change.
Model ids are the current Claude family."""

from __future__ import annotations

import os

from majorana_contracts.enums import Stage

# Defaults (Anthropic). Override any of them with MAJORANA_MODEL_<STAGE>.
_DEFAULTS: dict[str, str] = {
    "plan": "claude-opus-4-8",  # structured planning + judgment
    "generate": "claude-sonnet-5",  # code generation
    "verify": "claude-opus-4-8",  # strict critic — high-stakes review
    "writeback": "claude-haiku-4-5-20251001",  # library metadata + explanations
}


def model_for(stage: Stage | str) -> str:
    """The model id for a pipeline stage. Stages with no LLM call (simulate,
    baseline, export, save) fall back to the generate-tier default if asked."""
    key = stage.value if isinstance(stage, Stage) else str(stage)
    env = os.environ.get(f"MAJORANA_MODEL_{key.upper()}")
    return env or _DEFAULTS.get(key, _DEFAULTS["generate"])
