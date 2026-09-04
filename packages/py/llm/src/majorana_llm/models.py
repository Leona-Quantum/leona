"""Per-role model constants for the configured provider profile.

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
        # DeepSeek's current endpoint accepts the v4 model names, not the legacy
        # deepseek-chat alias. Keep every product path on the same supported model
        # unless an operator explicitly overrides a role with MAJORANA_MODEL_*.
        "chat": "deepseek-v4-pro",
        "route": "deepseek-v4-pro",
        # Keep every substantive circuit stage on the same capable model. Mixing
        # OpenAI into planning/review made an otherwise healthy DeepSeek run fail
        # when the OpenAI account returned 429, and deepseek-chat repeatedly
        # produced schema-invalid plans for the live H2 VQE walkthrough.
        "plan": "deepseek-v4-pro",
        # v4-pro reproducibly burned its whole 8192 budget on reasoning with zero
        # content on VQE-scale tasks (bench-14, 2026-07-11), so this was
        # deepseek-chat (non-reasoning) until 2026-07-23. Re-benchmarked that day
        # on a Grover task deepseek-chat could not converge on in 6 candidates
        # (repeating the same qiskit compose() defect every time): v4-pro solved
        # it in 2 candidates, 2744 output tokens, real code both times. The
        # generate-stage max_tokens budget was raised alongside this switch (see
        # model.py) specifically to give harder/VQE-scale tasks more headroom
        # before hitting the exact failure bench-14 found.
        "generate": "deepseek-v4-pro",
        # A small independent pass audits only complex planner-authored classical
        # references before code generation. Use a different served model so one
        # arithmetic transcription is not both proposition and proof.
        "audit": "deepseek-v4-flash",
        "verify": "deepseek-v4-pro",
        "analyze": "deepseek-v4-pro",
        "writeback": "deepseek-v4-pro",  # library metadata + explanations
        # The notebook lane (leona_notebooks): outline/draft/repair/revise are
        # generation-shaped work, same model as "generate"; review is a
        # verification pass, same model as "verify". No owner spend decision
        # has picked a different provider for these yet — plans/notebooks/
        # 00-notebooks-surface.md §7 Q4 raises it as open.
        "notebook_outline": "deepseek-v4-pro",
        "notebook_draft": "deepseek-v4-pro",
        "notebook_repair": "deepseek-v4-pro",
        "notebook_revise": "deepseek-v4-pro",
        "notebook_review": "deepseek-v4-pro",
    },
    "anthropic": {
        "chat": "claude-sonnet-5",
        "route": "claude-haiku-4-5-20251001",
        "plan": "claude-opus-4-8",
        "generate": "claude-sonnet-5",
        "audit": "claude-sonnet-5",
        "verify": "claude-opus-4-8",
        "analyze": "claude-opus-4-8",
        "writeback": "claude-haiku-4-5-20251001",
        "notebook_outline": "claude-sonnet-5",
        "notebook_draft": "claude-sonnet-5",
        "notebook_repair": "claude-sonnet-5",
        "notebook_revise": "claude-sonnet-5",
        "notebook_review": "claude-opus-4-8",
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


def roles_for_profile() -> frozenset[str]:
    """Every role the active profile can be asked for.

    The keys of `_DEFAULTS` are the authority on that set. Anything deriving
    "which credentials do we need" from a shorter hand-written list answers for
    a pipeline the product does not actually run.
    """
    return frozenset(_DEFAULTS[resolve_provider()])


def model_for(stage: Stage | str) -> str:
    """Resolve the model for an agent role; legacy Stage values remain accepted."""
    key = stage.value if isinstance(stage, Stage) else str(stage)
    env = os.environ.get(f"MAJORANA_MODEL_{key.upper()}")
    defaults = _DEFAULTS[resolve_provider()]
    return env or defaults.get(key, defaults["generate"])
