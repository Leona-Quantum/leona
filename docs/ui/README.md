# UI domain

Domain home for the product surface (`apps/web` + `packages/ts/ui`), per
`plans/domain-structure.md`. Spec of record until fully folded in here:
`plans/roadmap/04-ui-specifications.md` (prescriptive edition) over the base
`plans/rebuild/07-ui-product.md` (routes S1–S9, flows F1–F4, quality bar).

**Rule zero: taste decisions are made. When in doubt, copy the token/value from
`tokens.md`; never invent visual design. Deviations need an owner taste-check.**

## Map: concept → code

| Concept | Where |
|---|---|
| Design tokens (only source of hex/sizes/spacing) | `packages/ts/ui/tokens.css` (+ `docs/ui/tokens.md` rules) |
| Component styles | `packages/ts/ui/styles.css` (`mj-*` classes) |
| App shell + primary nav | `packages/ts/ui/src/app-shell.tsx`; labels ONLY in `src/nav-config.ts` |
| Workspace sidebar/history | `apps/web/components/shell.tsx` + `apps/web/lib/chat-history.ts` |
| Run composer | `apps/web/components/run-composer.tsx` (bottom dock; route owns submission) |
| Quepo Studio list/detail | `apps/web/app/(app)/library` + `apps/web/lib/library-data.ts` |
| Pipeline stage rail (S3, the brand) | `packages/ts/ui/src/stage-rail.tsx` |
| Verdict banner (S4) | `packages/ts/ui/src/verdict-banner.tsx` |
| Empty states | `packages/ts/ui/src/empty-state.tsx` |
| Route fixtures (all component states, screenshot source) | `apps/web/app/dev/ui` (404s in prod) |
| a11y gate (axe WCAG A/AA over rendered components) | `packages/ts/ui-visual` → CI job `ui-visual` |
| Style gate (no raw hex outside tokens.css) | `scripts/check-raw-hex.mjs`, runs as `@majorana/ui` `lint` in CI |
| Tailwind v4 theme mapping | `apps/web/app/globals.css` (`@theme inline` → token vars) |

## Current state (2026-07-14)

The usable authenticated workspace slice is now wired: `/run` has a bottom composer, example
prompts, mode selection, and a persistent collapsible sidebar with recent API-backed runs;
`/run/[taskId]` keeps the result scrollable above the composer and replays the live SSE event
log; and `/library` is the Quepo Studio list with search/filter controls plus artifact detail
tabs, copyable source code, export state, run provenance, and the Library → Run context handoff.
Account now reads identity, workspace, artifact/run counts, and members from the API, with an
owner/admin path to attach an already-provisioned WorkOS user to the workspace. New API users
receive a workspace-scoped Bell-state starter artifact. Replay fixtures are restricted to the
explicit `/demo` route; authenticated pages use the API and retain only a small local fallback
for a just-completed run while remote data settles.

The public landing page and local fail-closed auth path are also present. Remaining work is a
hosted verified-artifact acceptance run, fuller remote chat/history persistence, account meters
and workspace selection, visual-diff automation, and the owner-controlled `dev` → Production
promotion.

## Quality bar (CI-checkable subset in 07 §5)

WCAG 2.1 AA; designed loading/empty/error states on every async view; CLS < 0.1
(rail reserves height); /run first-load JS < 250 KB gz; every number rendered has
units/tolerances; replay of a stored run re-renders identically (07 §6); the output
scroll region must not push the composer off-screen; source code must be keyboard-focusable
and copyable.
