# AGENTS.md — packages/ts/ui

Vendored components + design tokens. Domain home: `docs/ui/` (read its README first).
Spec of record: `plans/roadmap/04-ui-specifications.md` (until folded into docs/ui/).

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
- Only permitted animations: rail state transitions (150 ms ease-out), the running-dot
  pulse (spec §2), skeleton shimmer, toast enter/exit. `prefers-reduced-motion` must be honored.
- Components are pure renderers of typed data (no fetching, no run state) so the replay
  rule (07-ui-product.md §6) holds and fixtures can drive every state.
- Copy: verdicts/exports/buttons per `docs/ui/copy.md`. No exclamation marks, no emoji.
- Nav labels: `src/nav-config.ts` only (owner-revisable surface naming).
