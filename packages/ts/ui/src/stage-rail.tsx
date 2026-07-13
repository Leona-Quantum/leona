"use client";

// Pipeline stage rail (S3) — the brand. Spec: plans/roadmap/04-ui-specifications.md §2
// + docs/ui/components.md. Pure renderer: state comes from the replayed event log
// (07-ui-product.md §6); this component holds no run state of its own.
import type { ReactNode } from "react";

export type StageState = "pending" | "running" | "pass" | "skipped" | "fail";

interface RailStageBase {
  id: string;
  name: string;
  /** Elapsed label, e.g. "3.2 s" — caller formats (units always shown). */
  elapsed?: string;
}

// Discriminated so the type enforces the explanatory copy each state requires.
export type RailStage =
  | (RailStageBase & { state: "pending" | "running" | "pass" })
  // Shown inline — hover-only info is banned (touch devices).
  | (RailStageBase & { state: "skipped"; skipReason: string })
  // Row stays expanded with the summary.
  | (RailStageBase & { state: "fail"; errorSummary: string });

// The rail is intentionally a product-level projection, not a dump of internal
// orchestration. Detailed evidence remains in the content surface.
export const PIPELINE_STAGE_NAMES = [
  "Plan",
  "Generate",
  "Verify",
  "Analysis",
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
      {stages.map((stage) => {
        const rowContent = (
          <>
            <span className="mj-rail-row-line">
              <span className="mj-rail-dot" aria-hidden="true" />
              <span className="mj-rail-name">{stage.name}</span>
              {stage.elapsed ? <span className="mj-rail-elapsed">{stage.elapsed}</span> : null}
            </span>
            {stage.state === "skipped" ? (
              <span className="mj-rail-note">Skipped — {stage.skipReason}</span>
            ) : null}
            {stage.state === "fail" ? (
              <span className="mj-rail-note mj-rail-note--err">{stage.errorSummary}</span>
            ) : null}
          </>
        );
        return (
          <li key={stage.id}>
            {onSelect ? (
              <button
                type="button"
                className="mj-rail-row"
                data-state={stage.state}
                onClick={() => onSelect(stage.id)}
                aria-label={`${stage.name}: ${stageStateLabel(stage)}`}
              >
                {rowContent}
              </button>
            ) : (
              // Non-interactive rail (no content panel) — don't render focusable no-ops.
              <div
                className="mj-rail-row"
                data-state={stage.state}
                aria-label={`${stage.name}: ${stageStateLabel(stage)}`}
              >
                {rowContent}
              </div>
            )}
            {stage.state === "fail" && onRetry ? (
              <button
                type="button"
                className="mj-rail-retry"
                aria-label={`Retry from ${stage.name}`}
                onClick={() => onRetry(stage.id)}
              >
                Retry from here
              </button>
            ) : null}
          </li>
        );
      })}
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
      return `skipped — ${stage.skipReason}`;
    case "fail":
      return `failed — ${stage.errorSummary}`;
  }
}
