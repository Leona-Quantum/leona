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

**Corpus and map content is not renderer work, and it has its own rules.** `lib/repository/`
holds the Atlas records, the layer graph, the paper register and the rule tables that classify
them. Before adding a record, a node or a citation, read `docs/adr/0026-sub-paper-extraction.md`
(what may be extracted from a paper, and on what evidence) and `docs/adr/0025-slot-closure.md`
(what pins a slot's population). Both are enforced in `lint` by `scripts/check-repository-data.mjs`,
`scripts/check-layer-graph.mjs` and `scripts/check-paper-register.mjs` — a content change that
skips them fails `ts` in CI, not review.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
