# AGENTS.md — packages/ts/ui

Vendored components + design tokens. Domain home: `docs/ui/` (read its README first).
Spec of record: `docs/ui/` itself — `tokens.md` for values, `components.md` for contracts.
There is no external UI spec any more; a citation to one is stale.

Invariants:
- `tokens.css` is the ONLY file allowed to contain raw hex colors (CI: `lint` runs
  `scripts/check-raw-hex.mjs`). Never add a color/size/spacing/radius not in tokens.
- Every `var(--token)` must resolve (CI: `lint` also runs `scripts/check-token-vars.mjs`).
  An undefined custom property silently voids its whole declaration — this shipped once
  already (`--fs-11`, `--sp-5`, the dead `--mj-*` namespace). Use a `var()` fallback only
  when absence is genuinely intended.
- Type above 28px comes from `--fs-display-1/2/3` and is **public-marketing-site h1/h2
  only** — never in the product shell. No bare `clamp()` font-sizes. `--font-display`
  (Instrument Serif) has one weight: render at 400, never 500/600.
- No external component libraries — components are owned code (Radix primitives are the
  only permitted dependency, added only when a component genuinely needs one).
- **Animations: the closed list lives in `docs/ui/components.md` § Permitted animations, and
  nowhere else.** It is not restated here, and it is not restated in `styles.css`. It used to
  be all three, and all three disagreed — this file named five, the spec named five *different*
  ones, `styles.css` named four, and the code was running eleven `@keyframes` of which four
  appeared on no list at all. `scripts/check-permitted-animations.mjs` (CI: `lint`) now
  reconciles the table against the CSS in both directions, so adding a `@keyframes` without a
  row fails, and a row naming a keyframe nobody runs fails too. `prefers-reduced-motion` must
  be honored, and the check enforces that as well.
  **`@view-transition` takes no selector**, so a navigation transition is enabled
  document-wide and must be scoped by turning `::view-transition-*` off by default —
  including the browser's own default root crossfade — and back on under the surface that
  asked for it.
- Components are pure renderers of typed data (no fetching, no run state) so the replay
  rule (`docs/ui/screens-acceptance.md` §4) holds and fixtures can drive every state.
- Copy: verdicts/exports/buttons per `docs/ui/copy.md`. No exclamation marks, no emoji.
- Nav labels: `src/nav-config.ts` only (owner-revisable surface naming).
