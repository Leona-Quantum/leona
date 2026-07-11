"use client";

// Pipeline stage rail (S3) — the brand. Spec: plans/roadmap/04-ui-specifications.md §2
// + docs/ui/components.md. Pure renderer: state comes from the replayed event log
// (07-ui-product.md §6); this component holds no run state of its own.
import type { ReactNode } from "react";

export type StageState = "pending" | "running" | "pass" | "skipped" | "fail";

export interface RailStage {
  id: string;
  name: string;
  state: StageState;
  /** Elapsed label, e.g. "3.2 s" — caller formats (units always shown). */
  elapsed?: string;
  /** Required for skipped (shown inline — hover-only info is banned). */
  skipReason?: string;
  /** Required for fail; row stays expanded. */
  errorSummary?: string;
}

// Convert is folded into Export per the current pipeline (spec §2).
export const PIPELINE_STAGE_NAMES = [
  "Plan",
  "Generate",
  "Simulate",
  "Verify",
  "Baseline",
  "Export",
  "Save",
] as const;

export function StageRail({
  stages,
  onSelect,
  onRetry,
}: {
  stages: RailStage[];
  /** Scrolls the content panel to the stage's card. */
  onSelect?: (id: string) => void;
  onRetry?: (id: string) => void;
}): ReactNode {
  return (
    <ol className="mj-rail" aria-label="Pipeline stages">
      {stages.map((stage) => (
        <li key={stage.id}>
          <button
            type="button"
            className="mj-rail-row"
            data-state={stage.state}
            onClick={() => onSelect?.(stage.id)}
            aria-label={`${stage.name}: ${stageStateLabel(stage)}`}
          >
            <span className="mj-rail-row-line">
              <span className="mj-rail-dot" aria-hidden="true" />
              <span className="mj-rail-name">{stage.name}</span>
              {stage.elapsed ? <span className="mj-rail-elapsed">{stage.elapsed}</span> : null}
            </span>
            {stage.state === "skipped" && stage.skipReason ? (
              <span className="mj-rail-note">Skipped — {stage.skipReason}</span>
            ) : null}
            {stage.state === "fail" && stage.errorSummary ? (
              <span className="mj-rail-note mj-rail-note--err">{stage.errorSummary}</span>
            ) : null}
          </button>
          {stage.state === "fail" && onRetry ? (
            <button type="button" className="mj-rail-retry" onClick={() => onRetry(stage.id)}>
              Retry from here
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function stageStateLabel(stage: RailStage): string {
  switch (stage.state) {
    case "pending":
      return "pending";
    case "running":
      return stage.elapsed ? `running, ${stage.elapsed} elapsed` : "running";
    case "pass":
      return stage.elapsed ? `passed in ${stage.elapsed}` : "passed";
    case "skipped":
      return stage.skipReason ? `skipped — ${stage.skipReason}` : "skipped";
    case "fail":
      return stage.errorSummary ? `failed — ${stage.errorSummary}` : "failed";
  }
}
