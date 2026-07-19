# Leona Quantum — brand refresh handoff

Drop-in assets for the `apps/web` Next.js app. Everything here reuses the existing
design tokens (`packages/ts/ui/tokens.css`) — no new colors. Accent is `--accent`
(moss `#7ba05b` dark / `#48682e` light), neutrals are the warm-gray ramp, fonts are
Instrument Serif (display) + Instrument Sans (UI) + JetBrains Mono (numbers/labels).

## Visual reference (open in the design tool)
- `../Leona Quantum Brand.dc.html` — current board: logo variants, measurement lab,
  all motion loops, icon set, wordmarks, in-context site mock.
- `../Leona Quantum Brand v1.dc.html` — first pass (constellation-forward logo set),
  kept for reference.

## What's in this folder
| File | What it is | Where it goes |
|---|---|---|
| `globals-additions.css` | All `@keyframes` the components use | append to `apps/web/app/globals.css` |
| `components/BrandMarks.tsx` | Refined 1a logo variants: `FangKet`, `ClawBracket`, `Mane` | `apps/web/components/` |
| `components/ElectronField.tsx` | Canvas loop: electrons orbit a nucleus, then converge to the **logo** or the **Leo constellation** (slow 12s cycle) | `apps/web/components/` |
| `components/MeasurementLab.tsx` | Interactive superposition → measurement → histogram (bias slider, Measure / ×10 / Reset) | `apps/web/components/` |

All three components read colors from CSS custom properties at runtime, so they theme
automatically (same approach as the existing `leo-constellation.tsx`) and respect
`prefers-reduced-motion`.

## The logo decision (open item)
The user liked concept **1a (Ket Regulus)** — the current `BrandMark` in `icons.tsx`
is already this shape and stays valid. The three variants in `BrandMarks.tsx` swap the
constellation sickle for a lioness cue; pick ONE as primary, then:
1. Replace `BrandMark` in `apps/web/components/icons.tsx` with the chosen variant.
2. Re-cut `apps/web/app/icon.svg` (favicon) to match — it's hand-synced, hex-literal.
- **FangKet** — closing bracket hooks into a canine fang; Regulus is a watching eye.
- **ClawBracket** — the ket angle becomes a three-stroke claw swipe.
- **Mane** — Regulus radiates a mane (most legible at 16px).

## Suggested placements
- `ElectronField target="logo"` → run "running" state / route loader (replaces the
  generic spinner). `target="constellation"` → marketing hero background or empty states.
- `MeasurementLab` → a "how verification works" explainer on `/open-source` or docs.
- The **lioness-at-play** loop and **phase-orbit spinner** are SVG + CSS only — lift
  them straight from the `.dc.html` board (sections `#play` and motion tile 03); the
  keyframes they need are already in `globals-additions.css` (`lq-paw`, `lq-ball`,
  `lq-crouch`, `lq-sway`, `lq-orbit`).
- The refreshed **quantum icon set** (qubit, superposition, phase, entangle, gate,
  measure, circuit, ket, verify, Leo) follows the exact `Icon` wrapper in `icons.tsx`
  (16px viewBox, 1.35 stroke, round caps) — copy the paths from the board's icon
  section into new exports in `icons.tsx`.

## Notes
- These are `.tsx` for your build — they will NOT run in the design tool as-is.
- No external deps; React 18/19 client components (`"use client"`).
