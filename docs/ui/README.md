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
| Agent activity stream | `packages/ts/ui/src/agent-activity.tsx` + `apps/web/lib/run-activity.ts` |
| Structured run outcome | `packages/ts/ui/src/run-outcome.tsx` + `apps/web/lib/run-outcome.ts` |
| Artifact list/detail | `/library` is retired (redirects into Studio); the list component and `apps/web/lib/library-data.ts` still back the `/demo` preview |
| Studio editor/circuit workspace | `apps/web/app/(app)/studio` + `docs/ui/studio.md` |
| Legacy pipeline fixture | `packages/ts/ui/src/stage-rail.tsx` + `run-view.tsx` (dev visual reference only) |
| Verdict banner (S4) | `packages/ts/ui/src/verdict-banner.tsx` |
| Empty states | `packages/ts/ui/src/empty-state.tsx` |
| Route fixtures (all component states, screenshot source) | `apps/web/app/dev/ui` (404s in prod) |
| a11y gate (axe WCAG A/AA over rendered components) | `packages/ts/ui-visual` → CI job `ui-visual` |
| Style gate (no raw hex outside tokens.css) | `scripts/check-raw-hex.mjs`, runs as `@majorana/ui` `lint` in CI |
| Tailwind v4 theme mapping | `apps/web/app/globals.css` (`@theme inline` → token vars) |

## Current state (2026-07-14, corrected 2026-08-04)

> **Correction, 2026-08-04.** The paragraph below ends with *"The current catalog records
> are static reference data; save/publish actions and API-backed Atlas search remain
> follow-up work."* **That is no longer true and it is load-bearing.**
>
> `MAJORANA_PUBLIC_CATALOG_API` is **on in production**, so `/repository` is served from
> the API's published system catalog (`GET /v1/catalog/entries`), not from the committed
> TypeScript corpus. The corpus remains in the repository as the *editing* surface and as
> a whole-corpus fallback if the API is unreachable — which means **a content fix
> committed here does not reach the public pages** until the manifest is regenerated and
> re-imported. See `docs/runbooks/deploys.md § The public catalog flag` and
> `docs/runbooks/system-catalog.md`.
>
> Two further corrections to the same paragraph: publication is a CLI action
> (`catalog_admin publish-bootstrap`), deliberately not an HTTP route, so "publish
> actions" are not follow-up UI work; and the `dev` → Production promotion listed as
> remaining is done — `deploy.yml` auto-deploys api and worker on every merge to `dev`.
>
> The rest of the paragraph still reads true. It is left unedited below.

The usable authenticated workspace slice is now wired: `/run` has a bottom composer, example
prompts, mode selection, and a persistent collapsible sidebar with recent API-backed runs;
`/run/[taskId]` keeps the result scrollable above the composer and replays the live SSE event
log through semantic activity disclosures. The composer stays compact until focused, replaces
send with Stop during execution, and announces busy state accessibly. Failed runs that retain a
candidate show it as a not-verified Best available result instead of discarding the deliverable.
`/library` is retired and redirects into Studio; and `/studio` is the separate
R&D editor with code, circuit, inspector, output, and framework-version surfaces.
Account now reads identity, workspace, artifact/run counts, and members from the API, with an
owner/admin path to attach an already-provisioned WorkOS user to the workspace. New API users
receive a workspace-scoped Bell-state starter artifact. Replay fixtures are restricted to the
explicit `/demo` route; authenticated pages use the API and retain only a small local fallback
for a just-completed run while remote data settles.

The public surface now includes a shared company shell/footer, a formal landing page, early-access
pricing, contact, privacy, and terms routes, plus a searchable public Atlas catalog that
exposes classification, verification, export status, and provenance without mixing in private
workspace data. Public routes are explicitly allowed through the fail-closed middleware. The current
catalog records are static reference data; save/publish actions and API-backed Atlas search
remain follow-up work. Remaining work is the hosted verified-artifact acceptance run, fuller remote
chat/history persistence, account meters and workspace selection, visual-diff automation, and the
owner-controlled `dev` → Production promotion. Studio edits and framework variants now have a
control-plane write/read path; hosted acceptance still needs to exercise it against the deployed
migration.

## Quality bar (CI-checkable subset in 07 §5)

WCAG 2.1 AA; designed loading/empty/error states on every async view; CLS < 0.1
(rail reserves height); /run first-load JS < 250 KB gz; every number rendered has
units/tolerances; replay of a stored run re-renders identically (07 §6); the output
scroll region must not push the composer off-screen; source code must be keyboard-focusable
and copyable.
