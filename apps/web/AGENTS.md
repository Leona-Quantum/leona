# AGENTS.md — apps/web

Next.js App Router UI. Thin renderer: NO business logic in API routes (session/BFF glue
only). Consumes typed events/DTOs from `packages/ts/contracts-gen` (generated — if types
are wrong, fix `packages/py/contracts` and regenerate, never edit here).

Rules of the surface: `docs/ui/` — `screens.md` (live route map, build status, screen
deltas) and `screens-acceptance.md` (acceptance criteria, flows, quality bar, the replay
rule). Every async view ships loading/empty/error states. Budgets: perf ≥90
landing/studio, LCP <2.5s, CLS <0.1, first-load JS <250KB gz on /run — these are
**targets, not gates**; no workflow measures them (`screens-acceptance.md` §3).
Styling: Tailwind v4 + vendored components in `packages/ts/ui` + tokens.css. No new
styling systems, no component libraries.
Nav labels live in one config file — surface naming (Run/Studio) is owner-revisable.
