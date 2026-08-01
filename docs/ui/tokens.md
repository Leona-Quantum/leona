# Design tokens

Source of truth: `packages/ts/ui/tokens.css` — the ONLY file allowed to contain raw
hex (CI: `scripts/check-raw-hex.mjs`). Values are owner-ratified taste from
`plans/roadmap/04-ui-specifications.md` §1; do not add or "adjust" values.

Every `var(--token)` must resolve: an undefined custom property invalidates the whole
declaration and the browser drops it silently. CI enforces this (`scripts/check-token-vars.mjs`)
because it had already bitten us — `--fs-11`, `--fs-24`, `--sp-5/10/16`, and the entire
`--mj-*` namespace were referenced but never defined, so those rules never applied. Give
`var()` a fallback if you genuinely mean "may be absent".

Dark palette (owner directive 2026-07-11, refined same day): **warm-gray, color-minimal.**
The owner approved the earthy dark palette but asked to keep chromatic color to a minimum —
"more grayscale like ChatGPT/Claude Code, easier on the eyes and colorblind-accessible,
but keep that warm flavour." So the neutrals are a near-neutral **warm-gray** ramp (a
subtle R>G>B tilt is the only "flavour"; low chroma), and chromatic color is rationed to
one moss-green `--accent` plus three verdict signals. The warm tilt is inherited, not
arbitrary: the agent was once called Nameko, after the amber-capped mushroom, and the
palette was built around that. The name is retired (the agent is Nala, the surfaces are
Studio and Atlas) but the tokens were kept — they were approved on their own merits, and
every surface still shares them. Verdict colors (`--ok` emerald, `--warn`
amber, `--err` red) are **always paired with a glyph** so status never rides on hue alone
(deuteranopia-safe): the rail dots carry ✓ / – / ✕, and the verdict banner leads with its
word label ("Verified" / "Failed" / …) plus a thin colored left edge — no full-color text.

Light palette (owner directive 2026-07-17, superseding the 2026-07-14 strict-monochrome
rule): light shares the **same chromatic identity as dark** — warm paper neutrals, the
moss `--accent`, and emerald/amber/red verdict tokens. Hues match the dark palette;
lightness is dropped where AA contrast requires it. Status stays glyph-and-word paired.
The header toggle stores the explicit selection locally; without one, the OS preference
is used. The light audit pairs are text-0/bg-0 16.5:1, text-1/bg-1 6.6:1,
text-2/bg-0 5.0:1, accent/bg-0 5.3:1, ok/bg-1 4.6:1, warn/bg-1 5.2:1, and err/bg-1 5.3:1.

Rules:
- Light and dark themes share semantic names (`--bg-0`, `--text-1`, verdict colors
  `--ok/--warn/--err`); components must never branch on the active palette.
- Type scale (px): 12, 13 (base), 14, 16, 20, 28 — nothing else. Weights 400 / 500
  (headings, buttons) / 600 (page title only).
- Fonts (owner taste-check 2026-07-16, replacing Inter): **Instrument Sans** (UI),
  **Instrument Serif** (`--font-display`), JetBrains Mono (code, numbers, IDs — always
  mono for numerics). Apps load real faces via next/font and override the font vars.
- `--font-display` is **public-marketing-site h1/h2 only** — never inside the product
  shell, which stays entirely sans so the workspace keeps one voice. It ships a single
  weight: render it at 400 only, or the browser fakes a smeared bold.
- Display scale: `--fs-display-1` (32→44px, landing hero only), `--fs-display-2`
  (28→34px, page h1), `--fs-display-3` (22→24px, section h2). These are the ONLY
  sanctioned sizes above 28px, and 44px is the ceiling. They replaced ad-hoc `clamp()`
  rules that reached 83px — the "huge vibecoded text" the owner called out. Do not
  reintroduce a bare `clamp()` font-size; add a token or use one of these.
- Space: 4-px grid, `--sp-N` = N×4px (4, 8, 12, 16, 20, 24, 32, 40, 48, 64).
  Radius: 6 controls / 10 cards.
  Shadows: none — borders do the work. Content max-width 1200 px.
- Contrast pre-checked, all ≥ WCAG AA (text-0/bg-0 15.6:1, text-1/bg-1 6.4:1,
  accent/bg-0 6.3:1, ok/bg-1 7.5:1, warn/bg-1 8.3:1, err/bg-1 4.8:1); never "brighten"
  or "soften" a pair.
- Tailwind utilities resolve to tokens via `@theme inline` in `apps/web/app/globals.css`
  (e.g. `bg-bg-1`, `text-text-1`, `text-ok`).
