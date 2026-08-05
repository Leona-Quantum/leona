# Screens — status, routes and prescriptive deltas

Acceptance criteria and the quality bar: `screens-acceptance.md`. This file tracks the live
route map, build status, the prescriptive screen-level deltas, and decisions that postdate
both.

**If a screen needs a layout not described here or in `components.md`: build the closest
existing pattern, screenshot it, and flag it for an owner taste-check. Do not freestyle.**

Status column re-checked against the code 2026-08-04; S1 and S8 were both marked
"not started" and both had shipped. Everything else is as of 2026-07-14 and has only
grown since — treat an entry that says "pending" as a floor, not a fact.

## Route map (live — principal routes)

```
/                        landing (public)
/repository              public Atlas catalog — searchable, classification + verification
/repository/[slug]       public catalog entry (public, read-only)
/pricing /contact /privacy /terms /open-source   public marketing + legal
/run                     agent home (composer; mode selection)
/run/[taskId]            live conversation + activity for one run (resumable, SSE)
/studio                  circuit workspace — editor, preview, inspector, output, versions
/shared/[projectId]      shared project view (Team tier)
/account                 identity, workspace, members  (+ intercepted modal route)
/workspace               workspace surface
/upgrade                 tier upgrade
/demo  /dev/ui           replay fixtures / component gallery (dev + demo only)
```

Also present and not covered by an S-number: `/dashboard`, `/lab`, `/welcome`.
Unauthenticated paths are enumerated in `apps/web/middleware.ts` (`PUBLIC_PATHS`); the
middleware is secure-by-default, so a new public route needs an entry in **both** matchers
there — they use different syntaxes and the file says so.

Rules: every run and artifact is **addressable by URL** (deep-linkable, refresh-safe).
No modal-only state that cannot be reached by URL. Browser back always works.

**Two route corrections against the retired specs**, so nobody rebuilds from them:

- `/library` and `/library/[artifactId]` are **retired redirects**, not screens. The Vault
  is gone — a saved artifact's list, evidence and versions all live in Studio, so
  `/library` → `/studio` and `/library/[id]` → `/studio?artifact=<id>`. The old specs
  describe `/library` as a filterable artifact list; it is not one. The list component and
  `apps/web/lib/library-data.ts` survive only to back the `/demo` preview.
- The public artifact page is **`/repository/[slug]`**, not `/a/[artifactSlug]`. That path
  has never existed.

There is no `/ops/...` admin surface and no `/account/workspace`; workspace lives at
`/workspace`.

## Status

| # | Screen | Status (2026-07-14; S1/S8 corrected 2026-08-04) |
|---|---|---|
| S1 | Landing | **shipped** — `apps/web/app/page.tsx` (8.9 KB) is the formal public landing page, inside the shared company shell/footer alongside pricing, contact, privacy and terms |
| S2 | Run home | shipped (`/run` composer submits through the authenticated BFF; examples, mode selection, and recent runs are present) |
| S3 | Agent activity | `AgentActivity` + pure `runActivityFromEvents` shipped at `/run/[taskId]`; live BFF event-stream replay, resumable SSE, segmented progress overview, repair history, semantic operation disclosures, revision selection/copy, and structured evidence/log details are wired; raw technical transcripts stay off the normal surface |
| S4 | Result panel | assembled — measured distributions, derived state probabilities, iterative traces, reported values, code, baseline, export, and artifact link; failed runs preserve and label the best available deliverable without implying verification |
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
Owner taste-checks: S3+S4 first, then S6.

**Numbering note.** The retired `07-ui-product.md` §4 numbered S7 = public artifact page,
S8 = auth, S9 = account. When Studio was inserted as S7 the tail shifted by one, so
`screens-acceptance.md`'s S7/S8/S9 criteria are this file's **S8/S9/S10**. The criteria did
not change; only the labels did.

## Prescriptive deltas

These are the screen-level specifics that the acceptance criteria do not fix.

- **Composer (S2, Coda-informed — see `references.md`):** single prompt box, `--composer-max`
  (720 px), mono placeholder "Describe the circuit or problem…". Left dropdown: mode
  (labels "Execute", "Learn", "Explain" — see `copy.md`). Right: model-tier indicator
  (plan-driven, not user-set) + quota meter, e.g. "3/5 runs today". Example prompts as
  quiet cards below, seeded from the eval-corpus families and rotated.
- **Result panel (S4):** order is fixed — verdict banner (full-width strip, never truncated)
  → **Answer** (natural-language result from the analyze stage: interpretation, then
  comparison rows + caveat) → **Approach** (algorithm + why + problem restatement, from the
  plan) → key numbers table → **Verification** (one row per method that ran: method name +
  measured evidence, pass/fail tone on a thin left edge) → code block (copy button, filename
  tab) → baseline table → export badges row → artifact link. The verdict banner text pattern
  names the method: "Verified — statistical (TVD 0.0088 ≤ δ) · seed 42 · 4096 shots" (P1:
  say what was checked, never "IR"). *Owner directive 2026-07-12: the answer + reasoning +
  scientific verification lead the evidence, because that is what a customer asked for and
  it is the trust surface — not just a verdict chip. Sourced from
  `run.analysis` / `plan.produced` / `verification.result` events.* The shipped reducer's
  grouping is in `components.md`.
- **Artifact detail (S6):** five tabs. "Code & IR" is renamed **"Code & Export"** (P1 — IR is
  not user vocabulary). Runs tab = reverse-chronological run records. Verification tab =
  evidence table + collapsible raw run-record JSON; that collapsible is the **only** place raw
  JSON is user-visible (P1/P2).
- **QPU panel:** in S4 after verification — a quiet card "Run on hardware" with backend name,
  estimated cost in credits, estimated queue time, and [Submit] → a confirm dialog that
  restates the cost. **Never auto-submit.** Job states queued / running / done / failed, in a
  "Hardware jobs" rail section (the `references.md` QPU-Jobs pattern).
- **Empty / loading / error:** every list gets a designed empty state — one sentence + one
  action. Artifact list empty: "Nothing verified yet. Your first verified run will appear
  here." + [Start a run].

## Open

- **Screenshot visual-diff (Playwright, ≤ 0.1% tolerance)** over the `ui-visual` stories.
  The axe/a11y half of that gate shipped; the diff half has not. See `components.md`
  §Accessibility harness.
