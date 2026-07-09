# ADR-0012: Staged posture — foundation first, demo at Phase 3

**Date:** 2026-07-09 · **Status:** accepted (owner-confirmed)
**Context:** Choice among demo-first (fast visible progress, guaranteed pipeline rework),
architecture-max (over-builds pre-users), and staged.
**Decision:** Staged: Phases 0–2 build the spine (repo/CI, contracts/auth/schema,
headless pipeline) with no visible UI; Phase 3 ships the polished Execute surface; Phase
4 hardens for launch. The demo lands at end of Phase 3; nothing is built twice.
**Consequences:** Buys a pipeline that never gets rebuilt under a UI, and an honest eval
baseline before demos. Costs: no visible demo for the first two phases — the owner
accepts delayed gratification. Reversal trigger: a hard external demo deadline would
force a re-plan at a phase boundary (plans/rebuild/08 standing rule).
