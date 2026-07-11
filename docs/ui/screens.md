# Screens S1–S9 — status & deltas

Definitions and acceptance criteria: `plans/rebuild/07-ui-product.md` §4 (binding).
Prescriptive deltas: `plans/roadmap/04-ui-specifications.md` §3. This file tracks
build status and decisions that postdate those docs.

| # | Screen | Status (2026-07-12) |
|---|---|---|
| S1 | Landing | not started (scaffold `/` sign-in page exists) |
| S2 | Run home | stub shipped (`/run`, disabled composer); real composer per spec §3 pending |
| S3 | Pipeline view | `RunView` + pure `reduceRunEvents` shipped at `/run/[taskId]` from fixture logs (prefix-replay demonstrable); live BFF event-stream wiring pending |
| S4 | Result panel | assembled — verdict → key numbers → code → baseline → export → Library link, in spec §3 order; renders from the same replayed log |
| S5 | Library list | stub with designed empty state shipped |
| S6 | Artifact detail | not started — tab label "Code & Export", never "Code & IR" (P1) |
| S7 | Public artifact page | not started |
| S8 | Auth screens | WorkOS AuthKit flow live from Phase 1 |
| S9 | Account | stub shipped (identity + sign-out); meters pending |

Build order (Phase 3): shell+nav ✅ → S3/S4 → S2 → S5/S6 → S7 → S1 → S8/S9 polish.
Owner taste-checks: S3+S4 first, then S6. Result-panel order and QPU-panel spec:
04-ui-specifications.md §3.
