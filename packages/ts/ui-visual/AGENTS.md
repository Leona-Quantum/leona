# AGENTS.md — packages/ts/ui-visual

Visual / accessibility test harness for `@majorana/ui`. Not shipped to users. Domain home:
`docs/ui/` (read its README first). What this harness is required to enforce, and what is
still unbuilt: `docs/ui/screens-acceptance.md` §3.

What it does:
- `src/stories.tsx` lists real `@majorana/ui` component instances in fixed states (every
  StageRail state × interactive/non-interactive, every VerdictBanner verdict, EmptyState,
  RunView across the run fixtures). `src/run-fixtures.ts` is a self-contained copy of the
  canonical RunEvent logs.
- `scripts/render.mjs` bundles the render entry with esbuild (pulling the **real** component
  TSX source + React, inlining `tokens.css` + `styles.css` via the text loader) and writes
  `dist/<story>.html` + `dist/manifest.json`. Rendering from source is the point — the
  harness can't drift from the shipped design system.
- `tests/a11y.spec.ts` loads each rendered story in chromium and asserts **zero** WCAG A/AA
  violations via `@axe-core/playwright`. Scoped to WCAG tags only (not axe best-practice
  rules like `region`, which flag any standalone fragment for not being a full page).
- `src/converge-stories.tsx` renders the **Atlas convergence figures** — every drawable slot
  × both locales, saturated so every openable line is open — by importing `ConvergeCanvas`
  and the layout out of `apps/web` **by relative path**. Not through a package name: that app
  is a Next app, and depending on it here would pull Next into a harness whose whole point is
  not having it. `ConvergeCanvas` carries no `"use client"` and imports nothing but types, so
  esbuild bundles it as a plain function of its props. They go to
  `dist/converge-manifest.json`, a **second** manifest rather than a flag on `Story` — a flag
  the axe sweep filtered by would be one flip away from emptying that sweep's subject list.
- `tests/converge-plate.spec.ts` is the render-level half of the opened-name guard. The
  layout tests in `apps/web` measure numbers and cannot see whether
  `.mj-converge-name-plate` is drawn at all: delete it and every one of them stays green
  while every opened name on the Atlas goes illegible. This asserts the plate exists for all
  86 names on a bone, is opaque, is filled with the surface the figure is drawn on, is
  painted before its own text, and is at least as wide as the text drew. **It cannot assert
  ink-level vertical coverage**, and the file says why at length: Instrument Sans arrives
  through `next/font/google` at build time, so text here draws in the runner's `system-ui`
  substitute whose metrics are not the app's (measured: a 20.57px ascent against the ~9px
  the real face draws). The vertical side is a typographic model against the computed
  font-size instead. Closing that sliver means vendoring the woff2 or measuring on a served
  page — a decision, not an oversight.

Invariants:
- No Next, no auth, no dev server, for the **rendering and a11y** work this package exists
  for. Do not screenshot the running app (it is WorkOS-gated and `middleware.ts` is
  CODEOWNERS blast-radius) — render from source instead.
  **One recorded exception: `scripts/probe-*.mjs`** (added 2026-08-09, D102.11–D102.12). A
  probe measures *browser behaviour*, and the two behaviours it was added for — whether a
  click is intercepted rather than replacing the document, and whether React's reconciliation
  leaves an element in place for a CSS transition to run on — do not exist in a static render
  at all. They need a served page, so one probe starts `@majorana/web` against a built
  `NEXT_DIST_DIR`. That is a deliberate exception to the line above, not an oversight, and it
  is bounded: probes are hand-run, in no pipeline, and no CI job may depend on one. Anything
  that is a *check* rather than a *measurement* still renders from source.
- Scripts: `render` (HTML only), `a11y` (render + axe). It is deliberately **not** named
  `test`: the required `ts` CI job runs `turbo run … test`, which must not pull in a
  chromium download. The dedicated `ui-visual` CI job runs `a11y`.
- esbuild's build script stays blocked (pnpm-workspace `allowBuilds: esbuild: false`); the
  JS build API works without it. Do not enable it.
- When a real WCAG violation surfaces, fix the component in `@majorana/ui` (as the pending
  rail-name contrast and code-block keyboard-focus fixes did) — do not weaken the axe tag
  set to make it pass.
- The screenshot visual-diff slice (roadmap 04 §5 step 2b) reuses `dist/*.html`; its
  baselines must be generated on the CI Linux runner (macOS fonts won't match).
- **`scripts/probe-*.mjs` are probes, not checks — they run in no pipeline, on purpose.**
  They live here because this is the only package with a Chromium, and because an agent
  browser tab is *hidden*: a hidden document skips every view transition and starves
  rendering callbacks, so it cannot tell "does not work" from "did not run". Each probe
  answers one browser-behaviour question that a decision was made on, so the decision can be
  re-checked when a Chromium version moves rather than re-argued from memory. Run one by
  hand from inside this package. Today: `probe-svg-view-transition.mjs` — a
  `view-transition-name` on an element *inside* an `<svg>` is never captured, while CSS
  transitions on `d`/`cx`/`r`/`transform` do fire, including from attribute writes (D102.11);
  `probe-converge-continuity.mjs` — opening a line on the Atlas map moves the drawing rather
  than replacing the document, with JS-off and cross-page navigation as controls (D102.12).
  The second needs a server: `NEXT_DIST_DIR=.next-prod-agent pnpm --filter @majorana/web
  start --port <free port>`, and **check the markup it serves, not the status code** — a
  stale `next-server` from an earlier session answers 200 with a build two surfaces old.
