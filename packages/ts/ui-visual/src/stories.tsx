// Story list rendered to static HTML by scripts/render.mjs. Each story is a single real
// @majorana/ui component instance in a known state; the a11y test asserts each is free of
// WCAG violations. Coverage target (spec §5 step 2): every StageRail state in both the
// interactive (button rows) and non-interactive (div rows) paths, every VerdictBanner
// verdict, EmptyState with and without an action, and the composed RunView across the
// verified / mid-run / failed / queued fixtures.
import type { ReactNode } from "react";
import {
  EmptyState,
  RunView,
  StageRail,
  VerdictBanner,
  type RailStage,
} from "@majorana/ui";
import { RUN_FIXTURES } from "./run-fixtures";

export interface Story {
  /** Stable slug → dist/<name>.html and the axe test title. */
  name: string;
  /** Human label for the test report. */
  title: string;
  node: ReactNode;
}

const MID_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "2.1 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "8.4 s" },
  { id: "verify", name: "Verify", state: "running", elapsed: "3.0 s" },
  { id: "analyze", name: "Analysis", state: "pending" },
];

const ALL_PASS: RailStage[] = MID_RUN.map((s) => ({
  id: s.id,
  name: s.name,
  state: "pass",
  elapsed: s.elapsed ?? "0.3 s",
}));

const ALL_PENDING: RailStage[] = MID_RUN.map((s) => ({ id: s.id, name: s.name, state: "pending" }));

// One rail exercising every state at once (pass / running / skipped / fail / pending).
const ALL_STATES: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "1.8 s" },
  { id: "generate", name: "Generate", state: "running", elapsed: "2.0 s" },
  {
    id: "verify",
    name: "Verify",
    state: "fail",
    elapsed: "1.1 s",
    errorSummary: "Statistical check failed: TVD 0.21 > δ 0.05 (seed 42, 4096 shots)",
  },
  { id: "analyze", name: "Analysis", state: "skipped", skipReason: "waiting for verification" },
];

export const STORIES: Story[] = [
  // ---- StageRail (6): all states × interactive/non-interactive ----
  {
    name: "rail-mid-run",
    title: "StageRail — mid-run (pass / running / pending), interactive",
    node: <StageRail stages={MID_RUN} onSelect={() => {}} />,
  },
  {
    name: "rail-all-states",
    title: "StageRail — every state (pass / running / skipped / fail / pending) + retry",
    node: <StageRail stages={ALL_STATES} onSelect={() => {}} onRetry={() => {}} />,
  },
  {
    name: "rail-all-pass",
    title: "StageRail — all stages passed",
    node: <StageRail stages={ALL_PASS} onSelect={() => {}} />,
  },
  {
    name: "rail-all-pending",
    title: "StageRail — all stages pending",
    node: <StageRail stages={ALL_PENDING} onSelect={() => {}} />,
  },
  {
    name: "rail-noninteractive",
    title: "StageRail — non-interactive (div rows, no content panel)",
    node: <StageRail stages={ALL_STATES} />,
  },
  {
    name: "rail-single-fail",
    title: "StageRail — isolated fail row with retry",
    node: (
      <StageRail
        stages={[
          {
            id: "verify",
            name: "Verify",
            state: "fail",
            elapsed: "1.1 s",
            errorSummary: "QASM-parse failed: no parseable OpenQASM 2 on stdout",
          },
        ]}
        onSelect={() => {}}
        onRetry={() => {}}
      />
    ),
  },

  // ---- VerdictBanner (4) ----
  {
    name: "verdict-verified",
    title: "VerdictBanner — verified",
    node: (
      <VerdictBanner
        verdict="verified"
        detail="Verified — statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots"
      />
    ),
  },
  {
    name: "verdict-verified-caveats",
    title: "VerdictBanner — verified with caveats",
    node: (
      <VerdictBanner
        verdict="verified_caveats"
        detail="Contract checks passed; statistical check skipped — statevector output"
      />
    ),
  },
  {
    name: "verdict-not-verified",
    title: "VerdictBanner — not verified",
    node: (
      <VerdictBanner
        verdict="not_verified"
        detail="No verification method applies to this task class"
      />
    ),
  },
  {
    name: "verdict-failed",
    title: "VerdictBanner — failed",
    node: (
      <VerdictBanner
        verdict="failed"
        detail="Statistical check failed: TVD 0.21 > δ 0.05 · seed 42 · 4096 shots"
      />
    ),
  },

  // ---- EmptyState (2) ----
  {
    name: "empty-with-action",
    title: "EmptyState — message + action",
    node: (
      <EmptyState
        message="Nothing verified yet. Your first verified run will appear here."
        action={{ label: "Start a run", href: "/run" }}
      />
    ),
  },
  {
    name: "empty-no-action",
    title: "EmptyState — message only",
    node: <EmptyState message="No runs match this filter." />,
  },

  // ---- RunView (4): composed S3+S4 across the fixtures ----
  {
    name: "runview-verified",
    title: "RunView — verified run (full result panel)",
    node: <RunView events={RUN_FIXTURES.verified} />,
  },
  {
    name: "runview-model-activity",
    title: "RunView — live plan output",
    node: <RunView events={RUN_FIXTURES["model-activity"]} />,
  },
  {
    name: "runview-failed",
    title: "RunView — failed verification",
    node: <RunView events={RUN_FIXTURES.failed} />,
  },
  {
    name: "runview-midrun",
    title: "RunView — mid-run (verify)",
    node: <RunView events={RUN_FIXTURES.midrun} />,
  },
  {
    name: "runview-queued",
    title: "RunView — queued (waiting)",
    node: <RunView events={RUN_FIXTURES.queued} />,
  },
];
