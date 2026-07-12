# AGENTS.md — packages/ts/ui-visual

Visual / accessibility test harness for `@majorana/ui`. Not shipped to users. Domain home:
`docs/ui/` (read its README first). Spec of record: `plans/roadmap/04-ui-specifications.md` §5.

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

Invariants:
- No Next, no auth, no dev server. Do not screenshot the running app (it is WorkOS-gated
  and `middleware.ts` is CODEOWNERS blast-radius) — render from source instead.
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
