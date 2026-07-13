"use client";

// Route fixtures (spec §5 step 2 — Storybook alternative): every rail state, every
// verdict banner, the designed empty state. Screenshot source for PR review + the
// axe-core / visual-diff checks when Playwright lands.
import { EmptyState, RunView, StageRail, VerdictBanner, type RailStage } from "@majorana/ui";
import { RUN_FIXTURES } from "../../(app)/run/[taskId]/fixtures";

const MID_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "2.1 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "8.4 s" },
  { id: "verify", name: "Verify", state: "pending" },
  { id: "analyze", name: "Analysis", state: "pending" },
];

const FAILED_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "1.8 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "7.2 s" },
  {
    id: "verify",
    name: "Verify",
    state: "fail",
    elapsed: "1.1 s",
    errorSummary: "Statistical check failed: TVD 0.21 > δ 0.05 (seed 42, 4096 shots)",
  },
  { id: "analyze", name: "Analysis", state: "pending" },
];

export function UiFixtures() {
  return (
    <div style={{ display: "grid", gap: "var(--sp-8)" }}>
      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Stage rail — mid-run (pass / running / pending)
        </h2>
        <div style={{ display: "flex", minHeight: "320px" }}>
          <StageRail stages={MID_RUN} onSelect={() => {}} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Stage rail — failed run (fail + retry / skipped-with-reason)
        </h2>
        <div style={{ display: "flex", minHeight: "320px" }}>
          <StageRail stages={FAILED_RUN} onSelect={() => {}} onRetry={() => {}} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Verdict banners</h2>
        <div style={{ display: "grid", gap: "var(--sp-3)" }}>
          <VerdictBanner
            verdict="verified"
            detail="Verified — statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots"
          />
          <VerdictBanner
            verdict="verified_caveats"
            detail="Contract checks passed; statistical check skipped — statevector output"
          />
          <VerdictBanner
            verdict="not_verified"
            detail="No verification method applies to this task class"
          />
          <VerdictBanner
            verdict="failed"
            detail="Statistical check failed: TVD 0.21 > δ 0.05 · seed 42 · 4096 shots"
          />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Empty state</h2>
        <EmptyState
          message="Nothing verified yet. Your first verified run will appear here."
          action={{ label: "Start a run", href: "/run" }}
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Live prose — typed reveal
        </h2>
        <RunView
          events={RUN_FIXTURES["demo-verified"]}
          animateText
          emptyMessage="Waiting for the pipeline…"
        />
      </section>
    </div>
  );
}
