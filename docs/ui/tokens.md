# Design tokens

Source of truth: `packages/ts/ui/tokens.css` — the ONLY file allowed to contain raw
hex (CI: `scripts/check-raw-hex.mjs`). Values are owner-ratified taste from
`plans/roadmap/04-ui-specifications.md` §1; do not add or "adjust" values.

Palette (owner directive 2026-07-11, refined same day): **warm-gray, color-minimal.**
The owner approved the earthy palette but asked to keep chromatic color to a minimum —
"more grayscale like ChatGPT/Claude Code, easier on the eyes and colorblind-accessible,
but keep that warm flavour." So the neutrals are a near-neutral **warm-gray** ramp (a
subtle R>G>B tilt is the only "flavour"; low chroma), and chromatic color is rationed to
one moss-green `--accent` plus three verdict signals. Nameko is the amber-capped mushroom;
Quepo (Library) shares these tokens for now. Verdict colors (`--ok` emerald, `--warn`
amber, `--err` red) are **always paired with a glyph** so status never rides on hue alone
(deuteranopia-safe): the rail dots carry ✓ / – / ✕, and the verdict banner leads with its
word label ("Verified" / "Failed" / …) plus a thin colored left edge — no full-color text.

Rules:
- Dark-first; MVP ships dark-only. Names are semantic (`--bg-0`, `--text-1`, verdict
  colors `--ok/--warn/--err`) so a light theme is a token swap later.
- Type scale (px): 12, 13 (base), 14, 16, 20, 28 — nothing else. Weights 400 / 500
  (headings, buttons) / 600 (page title only).
- Fonts: Inter (UI), JetBrains Mono (code, numbers, IDs — always mono for numerics).
  Apps load real faces via next/font and override `--font-ui` / `--font-mono`.
- Space: 4-px grid (4, 8, 12, 16, 24, 32, 48). Radius: 6 controls / 10 cards.
  Shadows: none — borders do the work. Content max-width 1200 px.
- Contrast pre-checked, all ≥ WCAG AA (text-0/bg-0 15.6:1, text-1/bg-1 6.4:1,
  accent/bg-0 6.3:1, ok/bg-1 7.5:1, warn/bg-1 8.3:1, err/bg-1 4.8:1); never "brighten"
  or "soften" a pair.
- Tailwind utilities resolve to tokens via `@theme inline` in `apps/web/app/globals.css`
  (e.g. `bg-bg-1`, `text-text-1`, `text-ok`).
