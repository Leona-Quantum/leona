# AGENTS.md — majorana-evals (harness)

Runs the eval corpus through the real pipeline and scores it (Phase 2 step 7).

- **Scoring is structural, never a golden number**: terminal status/reason, export
  status (when the case pins one), promised keys and values from protected RESULT, and
  saved-artifact. `verifier_decision` is optional and only for a legacy-specific case;
  the default simple pipeline intentionally emits none. This measures whether the
  pipeline is honest + end-to-end correct — the ≥60% target in `08-phases.md` is a
  calibration goal, not a release gate.
- **Providers are injected.** Baseline and live self-test runs use a configured real
  LLM client. Local development may pair it with `LocalSubprocessSandbox`; production
  acceptance uses `VercelSandbox`.
- **Corpus** lives in `evals/corpus/*.yaml`, one honest expectation per case, mapped to
  `evals/benchmark-suite-v0.md` categories. The starter set is representative, not the full
  30 — expand it toward the full suite as cases are validated.
- The nightly baseline is `.github/workflows/bench.yml`; it is **inert until
  `ANTHROPIC_API_KEY` is set** (no key → skipped, never faked) and does not block merges.
- **`majorana_evals.public_benchmarks`** (proposal 1, ai-ops-approved 2026-09-20) scores
  Nala against public benchmarks (Qiskit HumanEval, QCircuitEval) through this same
  direct-handler pattern — see `evals/public-benchmarks/README.md` first, then each
  benchmark's `PROVENANCE.md` for what is vendored, pinned, and NOT yet scored (QCircuitEval
  is structural-only; both benchmarks have a real gradable-task ceiling below 100%, for
  reasons written down there, not a harness defect). There is no workflow for it yet: a
  paid run waits on the owner approving the spend, and the workflow that runs it on every
  model change lands with that approval (a `workflow_dispatch` draft is in this branch's
  history at 09a4c63f).
