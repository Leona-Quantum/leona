# AGENTS.md — majorana-llm

LLM client, per-stage model constants, and system prompts (Phase 2 step 3).

- **The pipeline depends only on `LLMClient`** (a Protocol). `FakeLLM` (deterministic,
  for tests + offline E2E) and `AnthropicLLM` (gated on ANTHROPIC_API_KEY, lazy import)
  are drop-in swappable. Every call returns token counts for the `llm.call` event / quotas.
- **Provider is Anthropic by default but not pinned by the plan** — the legacy product used
  DeepSeek/OpenAI. Model ids live in `models.py`, overridable per stage via
  `MAJORANA_MODEL_<STAGE>`. Confirm the provider with the owner before spend.
- **Two product invariants are hard-coded in the prompts** (`prompts.py`): Qiskit is the
  default framework (no silent switch — DECISIONS.md 2026-07-10), and no invented results.
- Prompts state behavior + honesty rules only; the orchestrator (pipeline state machine)
  owns stage transitions and tool order, never the model.
