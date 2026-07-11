# Components (`packages/ts/ui`)

Vendored, owned code. No component libraries; Radix primitives only when a component
genuinely needs one. Components are pure renderers of typed data — no fetching, no
run state — so stored-run replay renders identically and fixtures drive every state.
All states visible at `/dev/ui` (route fixtures; dev/CI only).

Permitted animations (only these): rail state transitions 150 ms ease-out, the
running-ring fade (border-color `--accent`↔transparent @ 1.2 s — spec §2, not an
exception), skeleton shimmer, toast enter/exit. `prefers-reduced-motion` disables them.

## StageRail (S3 — the brand; get this pixel-right)

240 px fixed, full height reserved at mount (no CLS). Row = 16 px dot + stage name +
right-aligned mono elapsed. Stages: Plan → Generate → Simulate → Verify → Baseline →
Export → Save (Convert folded into Export). The name yields first: it truncates with an
ellipsis (`min-width:0`) so it can never collide with the elapsed label inside the fixed
width; the elapsed label holds its width, and the full name stays in the row's aria-label.

The dot is never a filled disc (owner directive 2026-07-12): each terminal state is a
shape glyph in the state color, framed by a thin (1.5 px) same-color ring. The glyph is
the primary signal — status is not color-only, so it stays colorblind-safe and
disambiguates the two green dots (running vs pass) even in a static screenshot. Glyphs
are plain text, not emoji.

| state | ring | glyph | text | extra |
|---|---|---|---|---|
| pending | `--border-0` hollow ring | — | `--text-2` | |
| running | `--accent` ring, fades to transparent @1.2 s (glyph stays solid) | – `--accent` | `--text-0` | live elapsed |
| pass | `--ok` ring | ✓ `--ok` | `--text-0` | |
| skipped | `--warn` ring | – `--warn` | `--text-1` | reason inline at 12 px — hover-only info is banned |
| fail | `--err` ring | ✕ `--err` | `--text-0` | row stays expanded: error summary + "Retry from here" |

`RailStage` is a discriminated union: `skipped` requires `skipReason`, `fail` requires
`errorSummary`. With `onSelect`, rows are buttons that scroll the content panel to the
stage's card; without it the rail renders non-interactive markup (no focusable no-ops).
Acceptance test: refresh mid-run restores identical state from the event log.

## RunView + `reduceRunEvents` (S3/S4 — the pipeline view body)

`RunView` composes `StageRail` + the result panel for `/run/[taskId]`. It holds no state
and reads no wall clock: `reduceRunEvents(events)` is a **pure fold** of the typed
`RunEvent` log into a view model, so the same log always yields identical DOM and a
mid-run refresh just replays a shorter *prefix* of the same log (07 §6). That purity is
the S3 acceptance test — the `/run/[taskId]` fixtures are built so MID_RUN/QUEUED are
strict prefixes of the VERIFIED log, making prefix-replay demonstrable without a server.

Reducer rules worth knowing (all deterministic):
- Stage rail derives from `stage.started`/`stage.finished`; a `baseline` that reports
  `not_applicable_reason` renders **skipped-with-reason**, not pass. `code.generated`
  keeps the highest `revision` (repairs supersede).
- Verdict comes from `run.finished.verifier_decision`: `pass` with a numeric method
  (exact/statistical/brute_force/exact_diag) → `verified`; `pass` with only structural
  checks → `verified_caveats`; `fail`/failed status → `failed`; `inconclusive` →
  `not_verified`.
- Key numbers label the verification distance with its **own** metric name (e.g. TVD),
  never the plan's `primary_metric` (a different quantity).

Result panel order is FIXED (spec §3): verdict banner → key numbers → code → baseline →
export badges → Library link. Each section renders only when its data exists; rail rows
scroll to the matching card via `STAGE_TO_ANCHOR`.

## VerdictBanner (S4)

Full-width strip, never truncated; first element of the result panel. Tones map
verified→ok, verified_caveats/not_verified→warn, failed→err. **Color-minimal treatment:**
the label text stays neutral (`--text-0`) and the tone shows only as a 3-px colored left
edge — not a full-color text/border wash. The word label ("Verified" / "Failed" / …) is
the colorblind-safe cue; color merely reinforces it. Detail line is mono (`--text-1`) and
names the method + parameters with units/tolerances, e.g.
"Verified — statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots".
P1: never say "IR" here — say what was checked.

## AppShell / nav

Top bar: brand, primary nav (labels from `src/nav-config.ts` ONLY — owner-revisable),
right slot for quota meter/identity. `aria-current="page"` on the active surface.

## EmptyState

One sentence + one action (`action` is an all-or-nothing `{label, href}` object).
Every list gets one (e.g. Library: "Nothing verified yet. Your first verified run
will appear here." + [Start a run]).
