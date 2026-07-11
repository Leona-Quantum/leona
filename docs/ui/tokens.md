# Design tokens

Source of truth: `packages/ts/ui/tokens.css` — the ONLY file allowed to contain raw
hex (CI: `scripts/check-raw-hex.mjs`). Values are owner-ratified taste from
`plans/roadmap/04-ui-specifications.md` §1; do not add or "adjust" values.

Rules:
- Dark-first; MVP ships dark-only. Names are semantic (`--bg-0`, `--text-1`, verdict
  colors `--ok/--warn/--err`) so a light theme is a token swap later.
- Type scale (px): 12, 13 (base), 14, 16, 20, 28 — nothing else. Weights 400 / 500
  (headings, buttons) / 600 (page title only).
- Fonts: Inter (UI), JetBrains Mono (code, numbers, IDs — always mono for numerics).
  Apps load real faces via next/font and override `--font-ui` / `--font-mono`.
- Space: 4-px grid (4, 8, 12, 16, 24, 32, 48). Radius: 6 controls / 10 cards.
  Shadows: none — borders do the work. Content max-width 1200 px.
- Contrast pre-checked (text-0/bg-0 ≈ 15:1, text-1/bg-1 ≈ 7:1, accent/bg-0 ≈ 5.6:1);
  never "brighten" or "soften" a pair.
- Tailwind utilities resolve to tokens via `@theme inline` in `apps/web/app/globals.css`
  (e.g. `bg-bg-1`, `text-text-1`, `text-ok`).
