# AGENTS.md — majorana-llm

LLM client, per-stage model constants, and system prompts (Phase 2 step 3).

- **The pipeline depends only on `LLMClient`** (a Protocol). Production runs use the
  configured provider client (`OpenAICompatibleLLM` or `AnthropicLLM`), loaded lazily
  from environment credentials. Every call returns token counts for the `llm.call`
  event / quotas.
- **Live acceptance and eval runs must use a real provider.** Unit tests may isolate
  SDK transport boundaries, but they must not substitute scripted model output for a
  product run.
- **Provider is Anthropic by default but not pinned by the plan** — the legacy product used
  DeepSeek/OpenAI. Model ids live in `models.py`, overridable per stage via
  `MAJORANA_MODEL_<STAGE>`. Confirm the provider with the owner before spend.
- **Product invariants are hard-coded in the prompts** (`prompts.py`): Qiskit is the
  default framework (no silent switch — DECISIONS.md 2026-07-10), selected-framework
  source remains canonical, OpenQASM is conversion-only, and results are never invented.
- Prompts state behavior + honesty rules only; the orchestrator (pipeline state machine)
  owns stage transitions and tool order, never the model.
