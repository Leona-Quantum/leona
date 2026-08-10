# Screen acceptance criteria, quality bar, and the UI ↔ backend contract

Folded in 2026-08-05 from the external product doc that `docs/ui/screens.md` and
`apps/web/AGENTS.md` both used to cite as binding, and which lived outside this repository
where none of the code it governed could reach it. That doc is archived. Only the parts
that survive the shipped product are carried here; §5 lists what was dropped and why, so
nobody restores it from the archive. Live route map and build status: `screens.md`.

## 1. Acceptance criteria per screen

**Numbering.** These are the original S1–S9 labels. When Studio was inserted as S7 the tail
shifted by one, so S7/S8/S9 below are `screens.md`'s **S8/S9/S10**. The criteria did not
change; only the labels did.

| # | Screen | Acceptance criteria |
|---|---|---|
| S1 | Landing | States the one-sentence thesis; live demo artifact embedded; CTA to `/run`. Lighthouse perf ≥ 90 mobile. |
| S2 | Run home | Mode switch, example prompts, quota meter. Keyboard: `⌘K` new task, `Enter` submit. |
| S3 | Pipeline / activity view | Streaming updates < 500 ms after the server event; survives refresh mid-run; cancel works at every stage. *(The original said "rail with the 12 canonical stages"; the shipped surface projects the event log into four user-facing stages — see `components.md`. The streaming, refresh and cancel criteria are unchanged.)* |
| S4 | Result panel | Code block with copy + syntax highlight; verification verdict never truncated; export badge always present (the PRD requires a non-empty export status). |
| S5 | Artifact list | Paginated server-side, filterable, < 1 s TTFB at 10k artifacts. |
| S6 | Artifact detail | Five tabs; provenance chain rendered; "Open in Run" works. |
| S7 | Public artifact page | No auth, no app shell weight; OG image with verification badge. *(Route is `/repository/[slug]`.)* |
| S8 | Auth screens | Sign-in/up per the auth decision (WorkOS AuthKit); error states written, not default. |
| S9 | Account / usage | Plan, meters, danger zone (delete account — GDPR-shaped from day one). |

**Explicitly deferred at the time, and still not built:** API-key management, an export-matrix
configurator, artifact comments/social. *(Team workspaces and QPU shipped after this list was
written; a dark-mode toggle also shipped — the header stores an explicit selection and falls
back to the OS preference.)*

## 2. Core acceptance flows

- **F1 — First verified run (the wedge; must be flawless).** Land on `/run`, type a
  constrained problem or click a curated example prompt drawn from the eval corpus. Activity
  disclosures appear and stream results as they complete — the user never stares at a blank
  spinner. The plan renders first (framework, algorithm, parameters, expected outputs) so the
  user can cancel before compute spends. On completion the result panel gives final code
  (copyable), key numbers, the verification verdict with method, a baseline comparison when
  applicable, an export status badge (`lossless` / `lossy_with_reason` / `download_only` /
  `unsupported`), and a link to the saved artifact. **The failure path is first-class:** a
  failed stage shows the error, what the repair loop tried, and a one-click retry.
- **F2 — Save → reopen loop.** Run completes → the result is saved → the user opens the
  artifact → "Open in Run" pre-loads context → a modification request starts a new run that
  records a provenance edge to the parent artifact. *(The destination is Studio, not a
  separate Library surface.)*
- **F3 — Browse & trust check.** Filter by algorithm family → artifact detail → the
  Verification tab shows the full evidence: verification record, fingerprint, seed/shots,
  the run record JSON (collapsible), residual risks. **A skeptical grad student must be able
  to audit everything.**
- **F4 — Sign-in & quota.** Auth-gated at first run submission, not at landing. The meter is
  visible in the header near the submit button, not buried in Account. Hitting the limit
  shows exactly when it resets and what upgrading changes.

## 3. Design system & quality bar

- **Approach:** Tailwind v4 + shadcn/ui-style components vendored into `packages/ts/ui`
  (owned code, no component-library lock-in) + Radix primitives underneath. One `tokens.css`
  for color/type/spacing. **No second styling system, ever.**
- **Aesthetic direction:** dense, technical, calm — closer to a Linear/Vercel dashboard than
  a chatbot toy. Monospace for code, numbers and IDs everywhere.
- **Non-negotiables (CI-checkable where possible):**
  - WCAG 2.1 AA: keyboard-complete, visible focus, contrast ≥ 4.5:1, `prefers-reduced-motion`
    honored. **Any requirement that conflicts with WCAG AA loses to WCAG AA.**
  - Every async surface has designed loading + empty + error states, reviewed through route
    fixtures (`/dev/ui`) or stories.
  - No layout shift on stream updates (CLS < 0.1); the rail reserves its space.
  - Route TTI < 2.5 s on a mid-tier laptop; first-load JS < 250 KB gz on `/run`.
    `apps/web/AGENTS.md` restates this as a Lighthouse budget (perf ≥ 90 on landing and
    studio, LCP < 2.5 s, CLS < 0.1, JS < 250 KB gz on `/run`).
  - All numbers shown with units and tolerances; never render an unlabeled float.
- **What actually enforces this today**, so the bar is not mistaken for a gate:

  | Rule | Enforced by | Status |
  |---|---|---|
  | No raw hex outside `tokens.css` | `scripts/check-raw-hex.mjs` (runs as `lint`) | live |
  | Every `var(--token)` resolves | `scripts/check-token-vars.mjs` | live |
  | No invisible hit targets | `scripts/check-invisible-hit-targets.mjs` | live |
  | Test-file list stays complete | `scripts/check-test-list.mjs` | live |
  | Zero WCAG A/AA violations per story | `packages/ts/ui-visual` (axe + Playwright), CI job `ui-visual` | live |
  | An opened Atlas line's name is occluded rather than overdrawn | `packages/ts/ui-visual/tests/converge-plate.spec.ts`, same CI job | live for presence, opacity, fill, paint order, the baseline band and width against the click target. **Ink coverage is measured and printed, not gated** — the app's font arrives through `next/font/google` at build time and is Latin-only, so Japanese names already fall back in production to the reader's own face. Which face draws them is not a property of this repository. |
  | Screenshot visual diff ≤ 0.1% | — | **not built** |
  | Perf / LCP / CLS / JS budgets | — | **not measured.** `bench/lighthouse/` holds only a `.gitkeep` and no workflow runs Lighthouse. These are targets, not gates. |

- **Review mechanism:** each screen ships with a screenshot in the PR; owner taste-check
  happens on S3+S4 first, then S6.

## 4. UI ↔ backend contract (the replay rule)

The run view consumes a **typed event stream** (`RunEvent`: stage transitions, tokens,
artifacts, errors) defined in the shared contracts package — the same event log that is
persisted for run records. **The UI is a pure renderer of that log; replaying a stored run
re-renders identically.** That is what makes the UI testable with fixtures, and it is the
S3 acceptance test: a mid-run refresh replays a strict *prefix* of the same log and must
restore identical state.

This is the rule `components.md` and `README.md` point back here for. `reduceRunEvents` and
`runActivityFromEvents` are both pure folds for exactly this reason, and the `/run/[taskId]`
fixtures are built so MID_RUN and QUEUED are strict prefixes of the VERIFIED log.

## 5. Dropped from the source, deliberately

| From the archived product doc | Why |
|---|---|
| §1 surface map "Run (was Nameko) / Library (was Quepo Studio) / Account" | The names are retired and the Library surface is gone; the shipped surfaces are Run, Studio, Atlas (public), Account |
| §2 route block: `/library` list, `/library/[artifactId]`, `/a/[artifactSlug]`, `/account/workspace`, `/ops/...` | `/library/*` are redirects into Studio; the other three never shipped. Live map is in `screens.md` |
| §4 "rail with the 12 canonical stages" | ADR-0023 replaced that pipeline; four user-facing stages project from the event log |
| §5 "pipeline rail is the brand" | The rail is a legacy visual reference; AgentActivity is the production S3 surface |
| §4 deferred list: team workspaces, QPU, dark-mode toggle | All three shipped |
