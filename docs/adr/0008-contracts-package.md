# ADR-0008: Contracts package is the spine

**Date:** 2026-07-09 · **Status:** accepted
**Context:** TS frontend + Python backend (ADR-0002) needs type safety without shared
runtime; the old repos drifted because types were duplicated by hand.
**Decision:** `packages/py/contracts`: Pydantic models are the single source of truth →
OpenAPI export → generated TS types (`openapi-typescript`) in `packages/ts/contracts-gen`
(committed, never hand-edited; CI regenerates and diffs — mismatch fails the build). The
`RunEvent` union type (stage transitions/results/errors) lives here; the UI is a pure
renderer of the event log, so stored runs replay identically (fixtures for free).
**Consequences:** Buys end-to-end types and replayable runs. Costs: codegen step in CI
and generated-code churn in diffs. Contracts changes are orchestrator-only
(plans/rebuild/09-agent-operating-model.md §2). Reversal trigger: none — mechanism could swap (e.g. different
generator) without changing the principle.
