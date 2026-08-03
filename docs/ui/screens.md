# Screens S1–S9 — status & deltas

Definitions and acceptance criteria: `plans/rebuild/07-ui-product.md` §4 (binding).
Prescriptive deltas: `plans/roadmap/04-ui-specifications.md` §3. This file tracks
build status and decisions that postdate those docs.

Status column re-checked against the code 2026-08-04; S1 and S8 were both marked
"not started" and both had shipped. Everything else is as of 2026-07-14 and has only
grown since — treat an entry that says "pending" as a floor, not a fact.

| # | Screen | Status (2026-07-14; S1/S8 corrected 2026-08-04) |
|---|---|---|
| S1 | Landing | **shipped** — `apps/web/app/page.tsx` (8.9 KB) is the formal public landing page, inside the shared company shell/footer alongside pricing, contact, privacy and terms |
| S2 | Run home | shipped (`/run` composer submits through the authenticated BFF; examples, mode selection, and recent runs are present) |
| S3 | Agent activity | `AgentActivity` + pure `runActivityFromEvents` shipped at `/run/[taskId]`; live BFF event-stream replay, resumable SSE, repair history, semantic operation disclosures, revision selection/copy, and structured evidence/log details are wired; raw technical transcripts stay off the normal surface |
| S4 | Result panel | assembled — verdict → key numbers → code → baseline → export → artifact link, in spec §3 order; failed runs preserve and label the best available deliverable without implying verification |
| S5 | Artifact list | shipped with workspace-scoped API loading, search/filter controls, empty/error states, explicit demo-only fixtures, and storage-only copy |
| S6 | Artifact detail | shipped — tabs expose "Code & Export" with OpenQASM download; current-version, provenance, copy, and Run handoff are wired |
| S7 | Studio editor | owner-directed slice — code editor, semantic circuit preview, inspector, output drawer, and persisted framework variants |
| S8 | Public artifact page | **shipped** — `/repository/[slug]`, with `/repository/(browse)` as the searchable list. Served from the published system catalog in production (`MAJORANA_PUBLIC_CATALOG_API`), not from the static corpus |
| S9 | Auth screens | WorkOS AuthKit flow live from Phase 1 |
| S10 | Account | shipped for identity, workspace data, members, owner/admin member attach, and persisted EN/日本語 preference for shared workspace navigation and account copy; meters, workspace selection, and remaining screen-level translation pending |

Build order (Phase 3): shell+nav ✅ → S3/S4 → S2 → S5/S6 → S7 → S1 → S8/S9 polish.
**Every screen in that order has now been built**, so this is a finished Phase-3 tracker
rather than a plan. What it does not yet track: the Studio canvas↔code seam, projects and
sharing, private materialization, the retired `/library`, tiers/billing and QPU panels.
Owner taste-checks: S3+S4 first, then S6. Result-panel order and QPU-panel spec:
04-ui-specifications.md §3.
