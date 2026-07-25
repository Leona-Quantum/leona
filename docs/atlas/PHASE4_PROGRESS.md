# Atlas VQE MVP — Phase 4 progress record

**Date:** 2026-07-24; integrity remediation 2026-07-25
**Status:** implemented against static fixture data, build/typecheck/lint/
existing-test-suite all pass, exercised over real HTTP against a running dev
server. **Not** visually verified in an actual browser (no browser/screenshot
tool available in this session) — see §5 for exactly what was and wasn't
checked.

## 1. The naming collision this phase found, and how it was resolved

Before writing any UI code, investigating the existing frontend found that
`/repository` — a pre-existing, public, unauthenticated, 283-record circuit
catalog — is *already* branded "Atlas" throughout the product (nav label,
page `<title>`, "Search the Atlas" copy). The plan's own Phase 4 text
anticipates exactly this kind of collision ("既存`/repository`との
identity/search重複をADRで解決") but doesn't resolve it. The owner was asked
directly and chose to merge the new VQE corpus into the existing
`/repository` page rather than mint a second "Atlas" surface. Full reasoning
in **ADR-0027**, including a second, code-level finding made while
implementing that choice: `PublicRepositoryEntry` (the type every existing
`/repository` record is shaped as) requires a real circuit `visualization`
and `codeVariants` — fields the literature-only VQE corpus genuinely doesn't
have at this annotation depth (Phase 2/ADR-0026 stopped before execution).
Forcing VQE records through that type would mean fabricating data, so VQE
records use their own types instead, sharing only the page/URL/nav identity,
not the TypeScript shape.

## 2. What was built

- **ADR-0027** (`docs/adr/0027-atlas-vqe-ui-merges-into-existing-repository.md`):
  the merge decision and its consequences, including the reversal trigger.
- **`scripts/generate-atlas-vqe-corpus.mjs`** (+ `--check`): projects
  `docs/atlas/corpus/{papers,repositories,comparisons}/*.json` into one
  deterministic, committed bundle apps/web imports as a static JSON module —
  `apps/web/lib/atlas-vqe/corpus-data.generated.json` (26 papers, 15
  repositories, 3 comparisons, 96 KB). Wired into the `ts` CI job's existing
  "generated artifact is current" pattern (mirrors
  `generate-catalog-bootstrap-manifest.mjs --check`). No wall-clock
  timestamp or git SHA is embedded, deliberately — either would make
  `--check` fail on every run regardless of actual content drift.
- **`apps/web/lib/atlas-vqe/types.ts`**: hand-written types
  (`VqePaperRecord`, `VqeRepositoryRecord`, `VqeComparisonRecord`, etc.)
  mirroring the corpus JSON field-for-field, including every
  `unknown`/`null`/`machine_validated` marker already in the corpus. The
  2026-07-25 remediation corrected nullable `notes`, volume/pages, and
  validation metadata and added fail-closed runtime validation with tests.
- **`apps/web/lib/atlas-vqe/source.ts`**: reads the static bundle (import,
  not a network/DB fetch), with accessors (`getVqePapers`, `getVqePaper`,
  `getVqeRepositories`, `getVqeComparisons`, `getRepositoriesForPaper`,
  `getComparisonsForPaper`, `getRepositoryRelationBreakdown`) and a light
  runtime validation pass on the imported bundle. Shape drift throws with a
  field path instead of silently converting corrupted scientific data into
  an empty corpus.
- **`apps/web/app/repository/atlas-content-switch.tsx`**: the one new piece
  of UI on the existing browse page — a "Circuits" / "VQE Methods" toggle.
  The existing `RepositoryBrowser` (552 lines, the mature circuit browser)
  is untouched; VQE gets its own sibling component instead of a forced
  merge into that component's card/filter shape.
- **`apps/web/app/repository/vqe/vqe-methods-browser.tsx`**: Papers /
  Components / Repositories / Comparisons sub-tabs. Components are explicitly
  labelled paper annotations and use `paper_id:index` only as a browse key,
  never as fabricated durable identity. Search + method-family filter for
  papers, search + relation filter for repositories (with the 4-way
  relation breakdown — official/author/general_framework_library/
  third_party_reference_implementation — always shown together, per the
  plan's own acceptance wording, restated from the miscount ADR-0026 caught
  in Phase 2), and the 3 comparison reports with their `is_manual_gold`/
  `human_validated` flags rendered as visible badges, never implied away.
- **`apps/web/app/repository/vqe/[paperId]/page.tsx`** +
  `vqe-paper-detail.tsx`: paper detail — components table (type/family/
  notes/evidence locator), workflow composition notes, linked implementation
  repositories (`implementation_ref` + reverse `associated_paper_ids`
  lookups, both checked since the corpus doesn't always record the relation
  symmetrically from both sides), linked comparison reports,
  `sources_verified` links, and explicit, never-blank sections for
  `unknown_or_ambiguous_fields`, `conflicting_fields`, and
  `negative_results_or_missing_implementation`.
- **`apps/web/app/repository/vqe/compare/[comparisonId]/page.tsx`** +
  `vqe-comparison-detail.tsx`: the dimension-by-dimension table
  (fixed/changed/unknown, with detail + evidence locator, unknown never
  collapsed to blank), classification badge, and `is_manual_gold`/
  `human_validated` stated in plain text as well as badges — not just
  present in the data.
- **CSS** (`packages/ts/ui/styles.css`, +~90 lines): reuses the existing
  `.mj-repository-*`/`.mj-repo-*`/`.mj-repo-section`/`.mj-repo-comparison-table`
  classes wherever the shape already fit (controls, category nav, result
  count, empty state, card layout, detail hero, collapsible sections,
  comparison table); added only what didn't already exist — a tab-switch
  control, a 4th "neutral" badge tone (`.mj-verdict` only has ok/warn/err,
  and VQE's `unknown` states are informational, not a warning), a relation-
  breakdown strip, and a plain list for the unknown/conflict sections. No
  raw hex, no new design tokens, no new component library — verified by the
  existing `check-raw-hex.mjs`/`check-token-vars.mjs` gates, which pass.

## 3. Design decisions made in this phase (and why)

1. **Data source is the generated static bundle, not the Phase 3
   authenticated API.** `/repository` is public and unauthenticated; every
   Phase 3 `/v1/atlas/*` endpoint requires a resolved `Scope` (Bearer
   token). Opening an anonymous passthrough to authenticated data was
   already rejected as a pattern by `repository-source.ts`'s own comment
   ("Adding a public passthrough would create a second unauthenticated
   surface for no gain"), and the DB-backed endpoints would return empty
   lists today regardless — no real corpus import has run
   (`docs/atlas/PHASE3_PROGRESS.md` §4). When that import ships and a
   public-read decision for it is made (a separate, deferred decision),
   this UI's data source can swap to a live fetch the same way
   `repository-source.ts` already swaps between its static fallback and the
   live catalog API.
2. **Components are browsable observations, not invented entities.**
   The first implementation only exposed inline components on paper detail
   pages, which did not satisfy the plan's explicit “50 components filterable”
   acceptance criterion. The remediation adds a 59-record Components view
   filterable by component type and searchable by family/name/paper. Its
   `paper_id:index` key is documented as a UI observation key only. Durable
   identity still begins only after Phase 3 ArtifactVersion import. Problems
   remain unstructured `problem_summary` values and are searchable through
   Papers; a canonical Problem entity would be a post-MVP schema change, not
   something this UI may infer.
3. **The public browse payload is bounded after the 2026-07-25
   remediation.** The server maps full paper/repository/comparison records to
   explicit list projections before crossing the client-component boundary;
   components, evidence locators, source lists, unknown/conflict detail, and
   comparison dimensions remain on detail routes. A hard 100-record static
   list limit fails closed and requires server-side pagination before corpus
   growth can turn into an unbounded client payload.
4. **No new interactivity needed a reduced-motion or custom-keyboard
   affordance.** Every new interactive element (the tab switch, the
   sub-tab buttons, the `<details>` disclosure sections) is a plain native
   `<button>`/`<details>` with no CSS transition/animation added — keyboard
   operability comes from using real interactive HTML elements, and there
   is nothing animated to gate behind `prefers-reduced-motion`. This is not
   a claim that reduced-motion support was "implemented" in any active
   sense; there was simply nothing to disable.

## 4. What was tested, and how

- **`corepack pnpm exec tsc --noEmit`** in `apps/web` and in `packages/ts/ui`
  — both clean, 0 errors.
- **`corepack pnpm run lint`** in `apps/web` (`check-raw-hex.mjs` +
  `check-token-vars.mjs`, the same scripts `packages/ts/ui`'s own `lint`
  script runs) — both OK.
- **`corepack pnpm run test`** in `apps/web` — 92 tests pass, including
  fail-closed corpus runtime-validation tests.
- **`corepack pnpm run build`** (`next build`, production build, Turbopack)
  — compiled successfully, all 336 routes generated including the two new
  ones (`/repository/vqe/[paperId]`, `/repository/vqe/compare/[comparisonId]`),
  both rendering as `ƒ` (server-rendered on demand) — the same rendering
  mode `/repository/[slug]` already uses, so this is not a new regression
  class, it's consistent with the existing detail-page precedent.
- **Real HTTP smoke test against a running `next dev` server** (curl, not a
  browser): `/repository` returns 200 and contains the new "VQE Methods"
  tab markup; `/repository/vqe/peruzzo2014` returns 200 and contains the
  real paper title; `/repository/vqe/compare/peruzzo2014_vs_shen2017`
  returns 200 and contains `is_manual_gold: false` and its `partial`
  classification; `/repository/vqe/does-not-exist` correctly 404s; the dev
  server log showed no runtime errors or warnings across any of these
  requests.
- **`node scripts/generate-atlas-vqe-corpus.mjs --check`** passes against
  the committed bundle.
- **2026-07-25 actual-browser remediation:** at a 390×844 viewport, both
  detail tables kept the document width at 390px while the table alone
  scrolled horizontally (`324→680px` and `358→960px`); both scroll regions
  had `tabIndex=0`; blank table cells were 0. The Components tab rendered
  all 59 annotations, and selecting `compression` produced exactly 3 cards.
  Browser console error count was 0. Dark/light visual-regression screenshots
  remain a Phase 6 task; they are not claimed complete here.

**2026-07-25 remediation browser result:** the prior audit found mobile
horizontal overflow and a blank null note. Detail tables are now contained in
keyboard-focusable horizontal-scroll regions and null notes render as explicit
unknown. Automated corpus runtime-validation tests were added; final browser
re-verification is recorded in the remediation report.

## 5. Acceptance against the plan's own Phase 4 rules

- 25 papers / 50 components filterable — done: 26 papers are searchable and
  filterable by method family; 59 paper-annotated components are independently
  searchable/filterable without claiming canonical component identity (§3.2).
- Navigate component → related workflow/paper — repositories link back to
  their associated papers and vice versa; components are shown in the
  context of the paper that documents them (their only real identity at
  this corpus depth).
- Display all 3 comparison reports — done, verified live over HTTP.
- Never convert unknown/conflict to blank — done: every `null`/`"unknown"`
  value renders as an explicit "unknown" badge or a `?? copy.unknown`
  fallback string, never an empty cell.
- Don't send the full raw corpus to the client without limit — enforced by
  list/detail projections and a 100-record static-list ceiling (§3 item 3).
- Keyboard, responsive, dark/light, reduced motion — dark/light is
  automatic (every new style uses existing theme-aware tokens, no raw hex);
  keyboard works because every control is a native interactive element;
  responsive tables and keyboard focus were checked in an actual browser
  (§4); reduced motion has nothing to disable (§3 item 4). Dark/light
  screenshot regression remains open for Phase 6.
- Loading, empty, failure via fixtures — added to `apps/web/app/dev/ui/fixtures.tsx`:
  a live `VqeMethodsBrowser` rendered with the real corpus, the same
  component rendered with empty arrays (its real empty state, not a mock),
  a loading skeleton (reusing the existing `mj-loading-screen`/`mj-skeleton`
  markup), and a failure state (reusing `/repository`'s own error copy).

## 6. What this document is asking for

Nothing here required an owner-approval gate the way Phase 3's Neon
connection did — the plan names Claude Code as the primary UI owner for
this phase, and the one genuine product-identity decision this phase
surfaced (the `/repository` "Atlas" naming collision) was already taken
back to the owner before any UI code was written (§1). This document
records what shipped. The earlier size-bound and actual-browser gaps were
remediated on 2026-07-25; dark/light screenshot regression and the canonical
Problem entity remain explicitly deferred, and this is not a request to
stop — it's the same kind of stop-and-report discipline used for Phase 0/2/3,
applied here because this phase, like those, changed real product surface.
