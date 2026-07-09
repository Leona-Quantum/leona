# AGENTS.md — apps/web

Next.js App Router UI. Thin renderer: NO business logic in API routes (session/BFF glue
only). Consumes typed events/DTOs from `packages/ts/contracts-gen` (generated — if types
are wrong, fix `packages/py/contracts` and regenerate, never edit here).

Rules of the surface: `plans/rebuild/07-ui-product.md` (routes, screens S1–S9, quality
bar). Every async view ships loading/empty/error states. Budgets (Lighthouse CI): perf
≥90 landing/library, LCP <2.5s, CLS <0.1, first-load JS <250KB gz on /run.
Styling: Tailwind v4 + vendored components in `packages/ts/ui` + tokens.css. No new
styling systems, no component libraries.
Nav labels live in one config file — surface naming (Run/Library) is owner-revisable.
