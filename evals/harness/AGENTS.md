# AGENTS.md — majorana-evals (harness)

Runs the eval corpus through the real pipeline and scores it (Phase 2 step 7).

- **Scoring is structural, never a golden number**: verifier_decision, export status
  (when the case pins one), promised output keys, saved-artifact. This measures whether
  the pipeline is honest + end-to-end correct — the ≥60% target in `08-phases.md` is a
  calibration goal, not a release gate.
- **Providers are injected.** Baseline and live self-test runs use a configured real
  LLM client. Local development may pair it with `LocalSubprocessSandbox`; production
  acceptance uses `VercelSandbox`.
- **Corpus** lives in `evals/corpus/*.yaml`, one honest expectation per case, mapped to
  `evals/benchmark-suite-v0.md` categories. The starter set is representative, not the full
  30 — expand it toward the full suite as cases are validated.
- The nightly baseline is `.github/workflows/bench.yml`; it is **inert until
  `ANTHROPIC_API_KEY` is set** (no key → skipped, never faked) and does not block merges.
