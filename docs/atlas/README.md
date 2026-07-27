# Atlas / VQE planning index

Atlas is the VQE-focused research layer planned for Majorana / Leona Quantum.
This directory deliberately separates the long-term architecture from the plan
that agents are allowed to execute now.

## Read order for Codex and Claude Code

1. Read the repository root `AGENTS.md` and the nested `AGENTS.md` files for
   every package being changed.
2. Read this file.
3. Read `atlas_vqe_mvp_execution_plan_ja.md`.
4. Read only the relevant part of
   `atlas_vqe_github_wrapper_master_plan_ja.md` when a design decision needs
   deeper context.
5. Confirm the current `origin/dev` commit and Alembic head before editing.

## Documents

| Document | Authority |
|---|---|
| `atlas_vqe_mvp_execution_plan_ja.md` | Executable phase order, scope, gates, Neon/Git workflow, and handoff protocol |
| `PHASE76_FIRST_EXECUTABLE_COMPONENT_SWAP_PLAN.md` | Active plan for correcting Phase 7.5 claims and completing the first persisted, executed, controlled component swap |
| `atlas_vqe_github_wrapper_master_plan_ja.md` | Long-term product and research architecture; not permission to implement every table or integration |

If the two documents conflict during MVP work, the MVP execution plan controls.
The master plan controls only long-term intent that the MVP plan does not
address. Repository `AGENTS.md`, security invariants, and owner decisions always
override both.

## Current baseline

- Plan date: 2026-07-28 JST
- Git baseline: `80b0a8dae972fa1558bf7570219d876189366adf`
- Development branch: `feature/vqe`
- Baseline Alembic head: `0038`
- MVP priority: complete one persisted and executed H2 Optimizer component swap
- Component-first local preview: 29 standard seed candidates, seven Workflow
  templates, and three comparison specifications; these are not yet a complete
  executable interoperability MVP
- Legacy corpus: source/evidence only, not the primary VQE product surface
- Existing proof execution: fixed H2 workflow on Qiskit and PennyLane; the
  composed Optimizer swap and persisted comparison remain Phase 7.6 work
- GitHub Wrapper: staged after curated Registry validation, metadata-only first
- Main/production Neon: never used for feature migration tests
- Phase 5 record: `PHASE5_PROGRESS.md`
- Phase 6 decision: `PHASE6_GO_NO_GO.md`
- Phase 6 private production-system E2E:
  `PHASE6_PRIVATE_PRODUCTION_E2E.md`
- Phase 6 live WorkOS/Vercel/FastAPI/Neon control-plane E2E:
  `PHASE6_LIVE_CONTROL_PLANE_E2E.md`
- Phase 6 threat, provenance, and rights review:
  `PHASE6_THREAT_RIGHTS_REVIEW.md`
- Phase 7 manual GitHub metadata import progress:
  `PHASE7_PROGRESS.md`
- Phase 7.6 first executable Component swap plan:
  `PHASE76_FIRST_EXECUTABLE_COMPONENT_SWAP_PLAN.md`
- Phase 6 rollback and disablement runbook: `PHASE6_ROLLBACK.md`
- Beginner-facing test deployment and dashboard manual:
  `../runbooks/vqe-test-vercel-workos-neon-manual_ja.md`

## Status vocabulary

Every phase and slice uses one of:

```text
not_started
in_progress
blocked_owner
blocked_external
implemented
verified_local
verified_neon
complete
```

Do not mark a phase `complete` when only code exists. Its acceptance gates,
tests, rollback evidence, and required review must also be complete.
