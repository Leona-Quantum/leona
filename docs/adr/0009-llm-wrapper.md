# ADR-0009: LLM access behind an internal `llm` package

**Date:** 2026-07-09 · **Status:** accepted
**Context:** The pipeline calls multiple LLM providers per stage; framework lock-in
(LangChain-class deps) means context bloat for agents and churn risk.
**Decision:** `packages/py/llm`: provider-agnostic thin wrapper over direct
Anthropic/OpenAI SDKs (DeepSeek optional); per-stage model config in one constants
module; every call logged with token counts to `run_events`.
**Consequences:** Buys swap-ability per stage, honest cost accounting (LLM usage is the
real MVP cost line), and small agent context. Costs: we own retry/streaming glue that a
framework would provide. Reversal trigger: none foreseen; adding a provider is additive.
