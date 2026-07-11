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
| Pipeline stage rail (S3, the brand) | `packages/ts/ui/src/stage-rail.tsx` |
| Verdict banner (S4) | `packages/ts/ui/src/verdict-banner.tsx` |
| Empty states | `packages/ts/ui/src/empty-state.tsx` |
| Route fixtures (all component states, screenshot source) | `apps/web/app/dev/ui` (404s in prod) |
| Style gate (no raw hex outside tokens.css) | `scripts/check-raw-hex.mjs`, runs as `@majorana/ui` `lint` in CI |
| Tailwind v4 theme mapping | `apps/web/app/globals.css` (`@theme inline` → token vars) |

## Current state (2026-07-11)

Shell + nav + tokens + rail/banner/empty components shipped with route stubs for
/run, /library, /account (first UI PR). Not built yet: real composer (S2), live
pipeline view against the RunEvent stream (S3/S4 wiring), library list/detail
(S5/S6), public pages (S7), landing (S1), account meters (S9), Playwright
screenshot/axe CI, owner taste-check (pending on S3/S4).

## Quality bar (CI-checkable subset in 07 §5)

WCAG 2.1 AA; designed loading/empty/error states on every async view; CLS < 0.1
(rail reserves height); /run first-load JS < 250 KB gz; every number rendered has
units/tolerances; replay of a stored run re-renders identically (07 §6).
