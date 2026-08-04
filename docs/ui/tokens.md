# Design tokens

Source of truth: `packages/ts/ui/tokens.css` — the ONLY file allowed to contain raw
hex (CI: `scripts/check-raw-hex.mjs`). Values are owner-ratified taste; do not add or
"adjust" values.

**Rule zero: never introduce a color, font size, spacing value, or radius that is not a
token here.** Taste decisions have been made. Deviation needs an owner taste-check, not
agent judgment. And **any requirement that conflicts with WCAG AA loses to WCAG AA** —
that precedence is not negotiable either.

**This file states rules, not values, on purpose.** The palette is not restated here
because a second copy of the hexes is a second writer, and that is not hypothetical: the
external UI spec this file replaces carried its own copy of the palette, it was dark-only,
and it still said so months after the light theme shipped. If you need a value, read
`tokens.css`. The table below names what each token is *for*.

Every `var(--token)` must resolve: an undefined custom property invalidates the whole
declaration and the browser drops it silently. CI enforces this (`scripts/check-token-vars.mjs`)
because it had already bitten us — `--fs-11`, `--fs-24`, `--sp-5/10/16`, and the entire
`--mj-*` namespace were referenced but never defined, so those rules never applied. Give
`var()` a fallback if you genuinely mean "may be absent".

## Token inventory (roles, not values)

| Token | Role |
|---|---|
| `--bg-0` / `--bg-1` / `--bg-2` | app background / panel-card / raised (hover, code blocks, table header) |
| `--border-0` | hairlines |
| `--text-0` / `--text-1` / `--text-2` | primary / secondary / placeholder-disabled |
| `--accent`, `--accent-press` | links, focus, primary buttons, running-stage — the one chromatic hue; press state |
| `--ok` / `--warn` / `--err` | verified-pass / lossy-partial-skipped-with-reason / failed-unsupported |
| `--mono-tint` | numbers and IDs inside prose |
| `--font-ui` / `--font-display` / `--font-mono` | Instrument Sans / Instrument Serif / JetBrains Mono |
| `--fs-12…--fs-28`, `--fs-display-1…3` | the whole sanctioned type scale |
| `--sp-1…--sp-16` | 4-px grid; `--sp-N` = N×4px |
| `--radius-control` / `--radius-card` | 6 px / 10 px |
| `--content-max` | 1200 px |
| `--control-h-cta`, `--control-px-cta` | public marketing CTA box only (added 2026-07-31); the workspace keeps its 32 px control height |
| `--ease-out-ui`, `--dur-press`, `--dur-hover` | one easing and two durations, so hover/press across the product reads as the same hand |
| `--sidebar-expanded/-collapsed`, `--composer-max`, `--sidebar-menu-*`, `--border-hairline`, `--shadow-popover` | workspace geometry |
| `--lab-*` (10 tokens) | **not part of the product palette** — see below |

**The one exception, and it is fenced.** `tokens.css` also defines a `--lab-*` ramp under
`[data-surface="lab"]`: a near-black instrument-panel ground with a single phosphor-amber
signal, deliberately *not* the warm-paper/moss identity, theme-locked dark because an
oscilloscope has no light mode. It is an exploration of an alternative direction (added
2026-07-31), it is **not owner-ratified**, and the attribute selector is what keeps it from
reaching any existing page — only `apps/web/app/lab/` opts in. Do not reference a `--lab-*`
token from a product surface, and do not promote one into the ramps above without a taste-
check. If the direction is rejected, the block and `/lab` are deleted together.

Its contrast ratios are computed against all three lab grounds and written into the block
because they had to be: `--lab-ink-2` shipped as `#626d76`, which measured 3.70:1 — below
AA at every size it was used at — under a comment certifying 4.6:1. Recompute before
changing any value there; the comment is not the measurement.

## The palettes

Dark palette (owner directive 2026-07-11, refined same day): **warm-gray, color-minimal.**
The owner approved the earthy dark palette but asked to keep chromatic color to a minimum —
"more grayscale like ChatGPT/Claude Code, easier on the eyes and colorblind-accessible,
but keep that warm flavour." So the neutrals are a near-neutral **warm-gray** ramp (a
subtle R>G>B tilt is the only "flavour"; chroma pulled ~40% below the first earthy cut),
and chromatic color is rationed to one moss-green `--accent` plus three verdict signals.
The warm tilt is inherited, not arbitrary: the agent was once called Nameko, after the
amber-capped mushroom, and the palette was built around that. The name is retired (the
agent is Nala, the surfaces are Studio and Atlas) but the tokens were kept — they were
approved on their own merits, and **every surface shares one foundation.** A
surface-scoped accent can be added later if one surface genuinely needs to diverge; none
does today.

Verdict colors (`--ok` emerald, `--warn` amber, `--err` red) are **always paired with a
glyph** so status never rides on hue alone (deuteranopia-safe): the rail dots carry
✓ / – / ✕, and the verdict banner leads with its word label ("Verified" / "Failed" / …)
plus a thin colored left edge — no full-color text.

**The two-greens case, resolved.** On the S3 rail the running dot (moss `--accent`) and the
pass dot (emerald `--ok`) are both green. They are told apart by glyph — **–** vs **✓** —
so they no longer read alike in a static screenshot or to a colorblind viewer. The 1.2 s
ring fade and the live elapsed timer are secondary differentiators, not the primary cue.

Light palette (owner directive 2026-07-17, superseding the 2026-07-14 strict-monochrome
rule): light shares the **same chromatic identity as dark** — warm paper neutrals, the
moss `--accent`, and emerald/amber/red verdict tokens. Hues match the dark palette;
lightness is dropped where AA contrast requires it. Status stays glyph-and-word paired.
The header toggle stores the explicit selection locally; without one, the OS preference
is used. The light audit pairs are text-0/bg-0 16.5:1, text-1/bg-1 6.6:1,
text-2/bg-0 5.0:1, accent/bg-0 5.3:1, ok/bg-1 4.6:1, warn/bg-1 5.2:1, and err/bg-1 5.3:1.

## Rules

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
  rules that reached **5.2rem (83px)** with -0.05em tracking — the "huge vibecoded text"
  the owner called out. Do not reintroduce a bare `clamp()` font-size; add a token or use
  one of these.
- Space: 4-px grid, `--sp-N` = N×4px (4, 8, 12, 16, 20, 24, 32, 40, 48, 64).
  Radius: 6 controls / 10 cards.
  Shadows: none — borders do the work. Content max-width 1200 px.
- Contrast pre-checked, all ≥ WCAG AA (dark: text-0/bg-0 15.6:1, text-1/bg-1 6.4:1,
  accent/bg-0 6.3:1, ok/bg-1 7.5:1, warn/bg-1 8.3:1, err/bg-1 4.8:1); never "brighten"
  or "soften" a pair.
- Tailwind utilities resolve to tokens via `@theme inline` in `apps/web/app/globals.css`
  (e.g. `bg-bg-1`, `text-text-1`, `text-ok`).

## Brand mark

The lion-and-swoosh scribble became a **Dirac ket `|·⟩`** (owner taste-check 2026-07-16) —
a bar, a chevron, a state between them. Three shapes on one baseline, so it survives at
16 px, and it reads to quantum researchers rather than as another orbit-and-electron logo.
It shipped as the first real favicon this product has had: `apps/web/app/icon.svg` and
`apple-icon.svg`. There was none before.
