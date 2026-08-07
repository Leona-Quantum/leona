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
| `PHASE11_PRIVATE_COMPONENT_FIRST_MVP.md` | Current consolidation plan and acceptance record for the private Component-First MVP |
| `private_mvp/README.md` | Committed capability authority, deterministic gates, failure coverage, and completion audit |
| `atlas_vqe_github_wrapper_master_plan_ja.md` | Long-term product and research architecture; not permission to implement every table or integration |

If the two documents conflict during MVP work, the MVP execution plan controls.
The master plan controls only long-term intent that the MVP plan does not
address. Repository `AGENTS.md`, security invariants, and owner decisions always
override both.

## Current baseline

- Plan date: 2026-08-05 JST
- Latest reconciled `origin/dev`: `78926da581ab80e94a64427a2e3be8e8d5a01a51`
- Development branch: `feature/vqe`
- Baseline Alembic head: `0038`
- MVP priority: freeze and qualify one coherent Private Component-First VQE
  path; do not add new components or public execution
- Primary Golden Journey: H2 / STO-3G Fixed Excitation + SLSQP, followed by
  exactly one changed role (`parameter_optimizer`) to COBYLA
- Component, Workflow, and comparison counts are inventory only. Qualification
  is measured by compatible composition, private execution, controlled swap,
  server-recomputed comparison, save, and same-subject reopen.
- Legacy corpus: source/evidence only, not the primary VQE product surface
- Local/synthetic evidence: Qiskit and PennyLane fixed-H2 executions and the
  SLSQP-to-COBYLA save/compare/reopen journey pass the committed contracts
- Operator-gated evidence: digest-pinned private CI and live WorkOS
  same-subject reopen remain `NOT_RUN — GO判定不可`
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
- Phase 7.6 execution evidence and progress:
  `PHASE76_PROGRESS.md`
- Phase 11 private MVP consolidation:
  `PHASE11_PRIVATE_COMPONENT_FIRST_MVP.md`
- Phase 11 post-push migration reconciliation audit:
  `private_mvp/migration_reconciliation_audit_2026-08-07.md`
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
