# AGENTS.md — packages/ts/ui

Vendored components + design tokens. Domain home: `docs/ui/` (read its README first).
Spec of record: `plans/roadmap/04-ui-specifications.md` (until folded into docs/ui/).

Invariants:
- `tokens.css` is the ONLY file allowed to contain raw hex colors (CI: `lint` runs
  `scripts/check-raw-hex.mjs`). Never add a color/size/spacing/radius not in tokens.
- No external component libraries — components are owned code (Radix primitives are the
  only permitted dependency, added only when a component genuinely needs one).
- Only permitted animations: rail state transitions (150 ms ease-out), skeleton shimmer,
  toast enter/exit. `prefers-reduced-motion` must be honored.
- Components are pure renderers of typed data (no fetching, no run state) so the replay
  rule (07-ui-product.md §6) holds and fixtures can drive every state.
- Copy: verdicts/exports/buttons per `docs/ui/copy.md`. No exclamation marks, no emoji.
- Nav labels: `src/nav-config.ts` only (owner-revisable surface naming).
