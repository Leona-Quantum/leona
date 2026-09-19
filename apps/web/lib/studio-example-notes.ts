import type { BuilderStep } from "./studio-builder.ts";

/**
 * Which top-level step's note is "current" at a given playhead moment, for
 * the worked-examples gallery's "watch the circuit build" notes panel.
 *
 * Every worked example's `notes` covers each top-level step exactly once
 * (enforced by worked-examples.test.ts), so the current note is simply the
 * note for the most recently completed step — the one with the largest
 * column strictly before the playhead moment. Ties (parallel steps sharing a
 * column) resolve to the last one in array order. Before anything has run
 * (moment 0) nothing is current yet.
 */
export function activeExampleNoteStepId(
  steps: readonly Pick<BuilderStep, "id">[],
  columns: readonly number[],
  moment: number,
): string | null {
  let bestId: string | null = null;
  let bestColumn = -1;
  for (let index = 0; index < steps.length; index += 1) {
    const column = columns[index] ?? 0;
    if (column < moment && column >= bestColumn) {
      bestColumn = column;
      bestId = steps[index].id;
    }
  }
  return bestId;
}
