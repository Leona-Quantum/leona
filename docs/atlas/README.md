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
| `atlas_vqe_github_wrapper_master_plan_ja.md` | Long-term product and research architecture; not permission to implement every table or integration |

If the two documents conflict during MVP work, the MVP execution plan controls.
The master plan controls only long-term intent that the MVP plan does not
address. Repository `AGENTS.md`, security invariants, and owner decisions always
override both.

## Current baseline

- Plan date: 2026-07-24 JST
- Git baseline: `4ade53faf37443c90980f7515bbbb83b836240db`
- Development branch: `feature/vqe`
- Baseline Alembic head: `0034`
- MVP priority: curated VQE Component Registry + Browse/Compare UI + proof execution
- MVP corpus: 25 papers / 15 implementation repositories / 50+ components
- Proof execution: identical ScientificExperimentSpec on Qiskit and PennyLane
- GitHub Wrapper: staged after curated Registry validation, metadata-only first
- Main/production Neon: never used for feature migration tests
- Phase 5 record: `PHASE5_PROGRESS.md`
- Phase 6 decision: `PHASE6_GO_NO_GO.md`
- Phase 6 threat, provenance, and rights review:
  `PHASE6_THREAT_RIGHTS_REVIEW.md`
- Phase 6 rollback and disablement runbook: `PHASE6_ROLLBACK.md`

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
