"use client";

// Route fixtures (spec §5 step 2 — Storybook alternative): every rail state, every
// verdict banner, the designed empty state. Screenshot source for PR review + the
// axe-core / visual-diff checks when Playwright lands.
import { EmptyState, StageRail, VerdictBanner, type RailStage } from "@majorana/ui";

const MID_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "2.1 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "8.4 s" },
  { id: "screen", name: "Screen", state: "pass", elapsed: "180 ms" },
  { id: "resource_estimate", name: "Resource estimate", state: "pass", elapsed: "40 ms" },
  { id: "verify", name: "Verify", state: "pending" },
  { id: "compile", name: "Compilation", state: "pending" },
  { id: "compiled_resource_estimate", name: "Compiled resource estimate", state: "pending" },
  { id: "finalize", name: "Finalize", state: "pending" },
  { id: "final_execute", name: "Final simulation / QPU", state: "pending" },
  { id: "baseline", name: "Baseline", state: "pending" },
  { id: "analyze", name: "Analysis", state: "pending" },
  { id: "save", name: "Save", state: "pending" },
];

const FAILED_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "1.8 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "7.2 s" },
  { id: "screen", name: "Screen", state: "pass", elapsed: "180 ms" },
  { id: "resource_estimate", name: "Resource estimate", state: "pass", elapsed: "40 ms" },
  {
    id: "verify",
    name: "Verify",
    state: "fail",
    elapsed: "1.1 s",
    errorSummary: "Statistical check failed: TVD 0.21 > δ 0.05 (seed 42, 4096 shots)",
  },
  { id: "compile", name: "Compilation", state: "pending" },
  { id: "compiled_resource_estimate", name: "Compiled resource estimate", state: "pending" },
  { id: "finalize", name: "Finalize", state: "pending" },
  { id: "final_execute", name: "Final simulation / QPU", state: "pending" },
  {
    id: "baseline",
    name: "Baseline",
    state: "skipped",
    skipReason: "no classical baseline applies to this task",
  },
  { id: "analyze", name: "Analysis", state: "pending" },
  { id: "save", name: "Save", state: "pending" },
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
    </div>
  );
}
