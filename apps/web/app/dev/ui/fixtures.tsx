"use client";

// Route fixtures (spec §5 step 2 — Storybook alternative): every rail state, every
// verdict banner, the designed empty state. Screenshot source for PR review + the
// axe-core / visual-diff checks when Playwright lands.
import { EmptyState, RunView, StageRail, VerdictBanner, type RailStage } from "@majorana/ui";
import { RUN_FIXTURES } from "../../(app)/run/[taskId]/fixtures";
import {
  getVqeComparisonListEntries,
  getVqeComponentListEntries,
  getVqePaperListEntries,
  getVqeRepositoryListEntries,
} from "../../../lib/atlas-vqe/source";
import { VqeMethodsBrowser } from "../../repository/vqe/vqe-methods-browser";

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
            verdict="structural_only"
            detail="return_contract only — no check compared this circuit against the expected physics"
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
          Budget exhausted — best effort, unverified
        </h2>
        <RunView
          events={RUN_FIXTURES["demo-exhausted"]}
          emptyMessage="Waiting for the pipeline…"
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Statistical check skipped — structural pass
        </h2>
        <RunView
          events={RUN_FIXTURES["demo-skipped"]}
          emptyMessage="Waiting for the pipeline…"
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

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Atlas VQE — real corpus data (26 papers / 15 repositories / 3 comparisons)
        </h2>
        <VqeMethodsBrowser
          papers={getVqePaperListEntries()}
          components={getVqeComponentListEntries()}
          repositories={getVqeRepositoryListEntries()}
          comparisons={getVqeComparisonListEntries()}
          locale="en"
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Atlas VQE — empty (all filters excluded)</h2>
        <VqeMethodsBrowser
          papers={[]}
          components={[]}
          repositories={[]}
          comparisons={[]}
          locale="en"
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Atlas VQE — loading skeleton</h2>
        <main className="mj-loading-screen" aria-busy="true" aria-label="Atlas VQE" style={{ minHeight: "220px" }}>
          <span className="sr-only" role="status" aria-live="polite">Loading…</span>
          <span className="mj-skeleton mj-skeleton--eyebrow" />
          <span className="mj-skeleton mj-skeleton--title" />
          <span className="mj-skeleton mj-skeleton--copy" />
          <span className="mj-skeleton mj-skeleton--panel" />
        </main>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Atlas VQE — failure (mirrors app/repository/error.tsx)</h2>
        <section className="mj-public-page-hero" role="alert" style={{ padding: "var(--sp-4)" }}>
          <p className="mj-section-label">Atlas</p>
          <h1>The public evidence set is unavailable right now.</h1>
          <p>Nothing was saved or changed. Try the catalog again, or return to the Leona Quantum home page.</p>
        </section>
      </section>
    </div>
  );
}
