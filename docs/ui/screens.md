# Screens S1–S9 — status & deltas

Definitions and acceptance criteria: `plans/rebuild/07-ui-product.md` §4 (binding).
Prescriptive deltas: `plans/roadmap/04-ui-specifications.md` §3. This file tracks
build status and decisions that postdate those docs.

| # | Screen | Status (2026-07-14) |
|---|---|---|
| S1 | Landing | not started (scaffold `/` sign-in page exists) |
| S2 | Run home | shipped (`/run` composer submits through the authenticated BFF; examples, mode selection, and recent runs are present) |
| S3 | Pipeline view | `RunView` + pure `reduceRunEvents` shipped at `/run/[taskId]`; live BFF event-stream replay, resumable SSE, and typed prose are wired |
| S4 | Result panel | assembled — verdict → key numbers → code → baseline → export → Vault link, in spec §3 order; renders from the same replayed log |
| S5 | Vault list | shipped with workspace-scoped API loading, search/filter controls, empty/error states, explicit demo-only fixtures, and storage-only copy |
| S6 | Artifact detail | shipped — tabs expose "Code & Export" with OpenQASM download; current-version, provenance, copy, and Run handoff are wired |
| S7 | Studio editor | owner-directed slice — code editor, semantic circuit preview, inspector, output drawer, and persisted framework variants |
| S8 | Public artifact page | not started |
| S9 | Auth screens | WorkOS AuthKit flow live from Phase 1 |
| S10 | Account | shipped for identity, workspace data, members, owner/admin member attach, and persisted EN/日本語 preference for shared workspace navigation and account copy; meters, workspace selection, and remaining screen-level translation pending |

Build order (Phase 3): shell+nav ✅ → S3/S4 → S2 → S5/S6 → S7 → S1 → S8/S9 polish.
Owner taste-checks: S3+S4 first, then S6. Result-panel order and QPU-panel spec:
04-ui-specifications.md §3.
