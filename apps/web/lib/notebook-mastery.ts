/**
 * Learner-facing progress on ONE notebook version: how many checkpoints
 * passed, how many exercises the notebook set, how many cells errored.
 * Derived the same way `lib/notebook-view.ts` derives per-cell views — the
 * spec's cells joined against the run's `ExecutionReport` by cell id — but
 * this module reduces to counts for the workspace header's "Your progress"
 * strip, not a per-cell render model.
 *
 * NOT `lib/notebook-progress.ts`: that file tracks a live run's own SSE
 * stage events (outline/draft/execute/…, "is the generation still going").
 * This one is a static read of the pinned version's stored `report` — "how
 * did the LESSON go", independent of whether anything is running right now.
 */
import type { components } from "@majorana/contracts-gen";

type Cell = components["schemas"]["Cell"];
type ExecutionReport = components["schemas"]["ExecutionReport"];

export interface NotebookMastery {
  checkpointsTotal: number;
  checkpointsPassed: number;
  exercisesTotal: number;
  /** Code cells whose result status is `"error"` — any role, not just checkpoints. */
  cellsErrored: number;
}

const EMPTY: NotebookMastery = {
  checkpointsTotal: 0,
  checkpointsPassed: 0,
  exercisesTotal: 0,
  cellsErrored: 0,
};

/** Whether there is anything worth showing a strip for — a notebook with no
 * checkpoints, no exercises and nothing that errored has no progress story. */
export function hasMasteryToShow(mastery: NotebookMastery): boolean {
  return mastery.checkpointsTotal > 0 || mastery.exercisesTotal > 0 || mastery.cellsErrored > 0;
}

export function notebookMastery(
  cells: readonly Cell[] | null | undefined,
  report: ExecutionReport | null | undefined,
): NotebookMastery {
  if (!cells || cells.length === 0) return EMPTY;
  const results = new Map((report?.cells ?? []).map((result) => [result.id, result]));

  let checkpointsTotal = 0;
  let checkpointsPassed = 0;
  let exercisesTotal = 0;
  let cellsErrored = 0;

  for (const cell of cells) {
    const result = results.get(cell.id);
    if (cell.role === "checkpoint") {
      checkpointsTotal += 1;
      if (result?.status === "ok") checkpointsPassed += 1;
    }
    if (cell.role === "exercise") exercisesTotal += 1;
    if (result?.status === "error") cellsErrored += 1;
  }

  return { checkpointsTotal, checkpointsPassed, exercisesTotal, cellsErrored };
}
