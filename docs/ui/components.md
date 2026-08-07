# Components (`packages/ts/ui`)

Vendored, owned code: shadcn/ui-style components copied into this package rather than
installed, so there is no component-library lock-in. **No component library other than
this vendored set** — Radix primitives underneath only when a component genuinely needs
one. Components are pure renderers of typed data — no fetching, no run state — so
stored-run replay renders identically and fixtures drive every state.
All states visible at `/dev/ui` (route fixtures; dev/CI only).

**Permitted animations, and nothing else.** The agent-activity running-ring fade
(border-color `--accent`↔transparent @ 1.2 s), stage-rail state transitions
(150 ms ease-out on opacity/color — `--dur-hover` + `--ease-out-ui`), skeleton shimmer,
toast enter/exit, and the owner-requested live prose reveal on `/run` (2026-07-13).
**No parallax. No springs.** The prose reveal is opt-in (`RunView` receives `animateText`),
presentation-only, and `prefers-reduced-motion` shows the complete text immediately.
Static fixtures keep it off so screenshot and a11y stories remain deterministic.

## StageRail (legacy visual reference)

This renderer remains available to compare stored fixtures, but it is not used by
the production conversation route. The production S3 surface is AgentActivity below.
Its historical contract was: 240 px fixed, full height reserved at mount (no CLS).
Row = 16 px dot + stage name +
right-aligned mono elapsed. The user-facing stages are only: Plan → Generate → Verify →
Analysis. The detailed event log remains an internal implementation contract; its
generate/screen/estimate events project into Generate, its compile/final-execute events
project into Verify, and its baseline/save events project into Analysis. The name yields
first: it truncates with an ellipsis (`min-width:0`) so it can never collide with the
elapsed label inside the fixed width; the elapsed label holds its width, and the full name
stays in the row's aria-label.

*(The retired spec listed twelve canonical rail stages — Plan → Generate → Screen →
Resource estimate → Verify → Compilation → Compiled resource estimate → Finalize → Final
simulation/QPU → Baseline → Analysis → Save. That was the pipeline ADR-0023 replaced; the
four-stage projection above is the current contract. Do not restore the twelve.)*

The dot is never a filled disc (owner directive 2026-07-12): each terminal state is a
shape glyph in the state color, framed by a thin (1.5 px) same-color ring. The glyph is
the primary signal — status is not color-only, so it stays colorblind-safe and
disambiguates the two green dots (running vs pass) even in a static screenshot. Glyphs
are plain text, not emoji, centered in the 16 px ring.

| state | ring | glyph | text | extra |
|---|---|---|---|---|
| pending | `--border-0` hollow ring | — | `--text-1` | text-2 on bg-0 is 3.19:1 (< AA); text-1 keeps pending dim but readable |
| running | `--accent` ring, fades to transparent @1.2 s (glyph stays solid) | – `--accent` | `--text-0` | live elapsed |
| pass | `--ok` ring | ✓ `--ok` | `--text-0` | |
| skipped | `--warn` ring | – `--warn` | `--text-1` | reason inline at 12 px — hover-only info is banned (touch devices) |
| fail | `--err` ring | ✕ `--err` | `--text-0` | row stays expanded: error summary + "Retry from here" |

`RailStage` is a discriminated union: `skipped` requires `skipReason`, `fail` requires
`errorSummary`. With `onSelect`, rows are buttons that scroll the content panel to the
stage's card; without it the rail renders non-interactive markup (no focusable no-ops).
Acceptance test: refresh mid-run restores identical state from the event log.

## RunView + `reduceRunEvents` (legacy fixture body)

`RunView` composes `StageRail` + the old result panel for dev fixtures. It holds no state
and reads no wall clock: `reduceRunEvents(events)` is a **pure fold** of the typed
`RunEvent` log into a view model, so the same log always yields identical DOM and a
mid-run refresh just replays a shorter *prefix* of the same log (the replay rule in
`screens-acceptance.md` §UI ↔ backend contract). That purity is the S3 acceptance test —
the `/run/[taskId]` fixtures are built so MID_RUN/QUEUED are strict prefixes of the
VERIFIED log, making prefix-replay demonstrable without a server.

The unframed `Live output` surface renders bounded `llm.delta` fragments while plan or
generation is streaming. Plan reasoning is secondary/faint text; the plan itself is
primary natural-language output. On the live route, prose is revealed incrementally so
it reads like an assistant composing the answer; the reducer still stores and returns the
complete target string, and provider JSON/internal schemas are never rendered.
The terminal evidence surface keeps fixed groups: Generate → Code, Code Quality, Resource
Estimation; Verify → Verification Results, Compilation Results, Final Code, Final Simulation
Results; Analysis → Answer, Sources, comparison values, and residual risks.

Reducer rules worth knowing (all deterministic):
- Stage rail derives from `stage.started`/`stage.finished`; a `baseline` that reports
  `not_applicable_reason` renders **skipped-with-reason**, not pass. `code.generated`
  keeps the highest `revision` (repairs supersede).
- Verdict comes from `run.finished`: `pass` with `evidence_strength: physical` →
  `verified`; `pass` with `evidence_strength: structural` → `structural_only`
  ("Structurally verified"); `fail`/failed status → `failed`; `inconclusive` →
  `not_verified`. The worker grades the strength from the checks the *published*
  candidate passed — physical means at least one of exact/statistical/brute_force/
  exact_diag, never `statistical_reproducibility`, which only proves a program agrees
  with itself. Runs finished before 2026-07-20 carry no grade, and the reducer falls
  back to scanning `verification.result` methods in the stream.
- Key numbers label the verification distance with its **own** metric name (e.g. TVD),
  never the plan's `primary_metric` (a different quantity).

Result panel order is FIXED (`screens.md` §S4): verdict banner → Generate evidence → Verify
evidence → Analysis answer and sources → baseline/comparison → export badges → artifact link.
Answer is the natural-language interpretation from `run.analysis`, including comparison values
and any residual-risk caveat. Plan reasoning and rationale stay in the live output surface
rather than becoming a second schema-heavy card. Sources lists bounded public references from
`research.completed`, including the query and short excerpts; failed or empty research is shown
honestly. Verification lists each method that actually ran with its measured evidence, so the
user can see what was checked rather than only seeing a verdict. Each section renders only when
its data exists; rail rows scroll to the matching card via `STAGE_TO_ANCHOR`. The code block scrolls
horizontally, so its `<pre>` is keyboard-focusable (`tabIndex=0`, `role="region"`,
`aria-label`) — a scrollable region with no keyboard access is a WCAG 2.1.1 failure.

## AgentActivity (live chat route)

The production conversation route projects durable circuit events into at most seven
semantic disclosures: Plan → Generated code → Code quality and resources → Sandbox
execution → Verification → Compilation → Finalize result. Future work is not rendered
as numbered placeholders. The current operation and terminal error open by default;
completed operations collapse to a single row. Verification methods are one checklist,
not one card per low-level check.

`apps/web/lib/run-activity.ts` owns the pure event reduction and
`packages/ts/ui/src/agent-activity.tsx` remains a fetch-free renderer. Repeated candidate
revisions appear as Attempt history inside Generated code, so repair autonomy remains
visible without producing unexplained "Candidate revision N" cards. Ordinary chat events
return no activity model. Code, measured values, verification evidence, stdout/stderr,
and compilation metrics live in their owning disclosure. Generated code lets the user
switch among retained revisions and copy the selected source without exposing raw event
payloads. A compact segmented overview mirrors the same disclosure states; it is a visual
summary, not a second source of pipeline truth. The normal RUN surface does not expose the
raw durable event log.

Structured sandbox `RESULT` data is projected by `apps/web/lib/result-visualization.ts`.
Bitstring-valued mappings are visualized by shape rather than a framework-specific key, so
counts, histograms, probabilities, and JSON-safe statevector amplitudes share one bounded
distribution grammar. Numeric arrays with iteration semantics (`history`, `trace`, `curve`,
`loss`, and equivalent terms) render as bounded convergence plots with explicit start,
latest, range, point count, and accessible text. Parameter vectors do not become plots.
The same projection and renderer own both Sandbox execution and Final Output, so replay and
the completed result cannot disagree. Raw stdout/stderr remain logs and are never promoted
to measured values.

`artifact.saved` means the run materialized a private result package. It must never claim
that the user kept it; only the explicit Keep action establishes that state.
The success, mid-run, failed, exhausted, skipped, inconclusive, and provider-error
states are replayable through the local `/run/demo-*` fixtures.

## RunOutcome (live chat route)

Terminal circuit runs render one structured result card instead of assembling a
markdown answer and a second verification card. The card has a stable hierarchy:
status/title and trust badges in one header, non-duplicated Plan facts, one actionable
callout, consistent collapsed evidence/code rows, and the keep action.

`apps/web/lib/run-outcome.ts` is the only event-to-outcome projection. It distinguishes
successful legacy records from fresh failures: only a successful run without a typed
summary is legacy. Failed or cancelled runs without a summary state that verification
did not complete. Provider errors are normalized for the primary UI while their raw
messages remain in Technical details. `packages/ts/ui/src/run-outcome.tsx` is the pure
renderer and never derives trust from absent data.

When a failed or inconclusive run still preserved an executable candidate, the result is
presented as **Best available result** with an explicit not-verified badge and a compact
reason notice. "No accepted result" is reserved for runs that genuinely produced no
deliverable. This preserves useful work without overstating verification.

When the current run becomes terminal, a reader who was already following the live
tail is moved to the Final Output heading. A reader who scrolled upward keeps their
position, and later result hydration does not pull the heading down to the bottom.

## RunComposer (live chat route)

The idle composer is compact and expands its text area on focus. While a request is in
flight, the send action becomes Stop and the form exposes `aria-busy`; a polite live
status announces the current state without duplicating visible text. Keyboard guidance
is adjacent metadata rather than button-label content, so assistive technology receives
a stable action name. Width is bounded by `--composer-max` (720 px).

## VerdictBanner (S4)

Full-width strip, never truncated; first element of the result panel. Tones map
verified→ok, verified_caveats/not_verified→warn, failed→err. **Color-minimal treatment:**
the label text stays neutral (`--text-0`) and the tone shows only as a 3-px colored left
edge — not a full-color text/border wash. The word label ("Verified" / "Failed" / …) is
the colorblind-safe cue; color merely reinforces it. Detail line is mono (`--text-1`) and
names the method + parameters with units/tolerances, e.g.
"Verified — statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots".
P1: name the OpenQASM or verification operation that was actually checked.

## AppShell / nav

`AppShell` stays a server-compatible, domain-agnostic renderer: it accepts the top bar,
right slot, and an optional sidebar slot. In workspace mode the sidebar toggle is owned by
the app wrapper, while `AppShell` supplies the landmark and accessible expanded state.
`apps/web/components/shell.tsx` composes the product-specific sidebar: new chat, recent
chat links, Run/Studio navigation, Settings, and the local workspace identity. Chat
summaries are persisted in `apps/web/lib/chat-history.ts`, so starting a new chat never
removes older run links. Labels from `src/nav-config.ts` remain the only source for the
shared primary surfaces; `aria-current="page"` is applied to active workspace links.

The run and artifact routes deliberately keep data ownership outside shared UI components:
`RunComposer` is a presentational bottom dock, `/run` and `/run/[taskId]` own submission and
SSE state, and the artifact list owns filtering/detail tabs while Studio owns editing. This keeps later UI/UX work
localized to the route shell and tokenized CSS rather than coupling data fetching to the
renderers.

## Accessibility harness (`packages/ts/ui-visual`)

`packages/ts/ui-visual` renders the real components to static HTML from source (esbuild +
`renderToStaticMarkup`, tokens/styles inlined) and asserts **zero WCAG A/AA violations**
per story via `@axe-core/playwright`. It runs as its own CI job (`ui-visual`) — separate
from the required `ts` job, since it needs a chromium download. Its `a11y` script is
deliberately not named `test` so `turbo run … test` in the `ts` job never triggers the
browser install. First real catches (both fixed in `@majorana/ui`): pending rail-name
contrast (text-2 → text-1) and the code-block keyboard-focus gap. When axe flags a real
issue, fix the component — do not relax the rule set.

This is slice **a** of the two-part visual gate the UI spec called for: axe over rendered
stories. **Slice b — screenshot visual-diff (Playwright, ≤ 0.1% tolerance) — is still
open**, and reuses the same `dist/*.html`. It is the last unbuilt item from that spec.

## EmptyState

One sentence + one action (`action` is an all-or-nothing `{label, href}` object).
Every list gets one (e.g. the artifact list: "Nothing verified yet. Your first verified run
will appear here." + [Start a run]).
