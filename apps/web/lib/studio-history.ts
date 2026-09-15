import type { BuilderStep, CustomGateDefinition } from "./studio-builder.ts";

/**
 * Studio's undo stack: whole-circuit snapshots, popped one at a time.
 *
 * The canvas used to support only "remove the last placed gate" — a ref of
 * placed step ids, filtered against what is still present, so Undo could pop
 * a specific earlier placement by id. That mechanism cannot represent undoing
 * a block definition edit or an ungroup, since neither is a step placement:
 * editing a definition rewrites `customGates`, not `steps`, and ungrouping
 * replaces one step with several rather than adding one.
 *
 * A snapshot stack generalizes to all three: the caller pushes the state
 * immediately before a mutation, and Undo restores it whole. For the case
 * this replaces — undoing the single gate just placed — the observable
 * result is the same: pop, restore, the last thing you did is gone.
 *
 * Deletions are not pushed by convention here and stay exactly as undoable as
 * they always were (not at all through this mechanism): pressing Undo right
 * after a delete restores the state from before whichever push-worthy action
 * came before it, not the delete itself. See studio-workspace.tsx for which
 * actions push.
 */

export interface StudioHistorySnapshot {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
}

/** Bounds memory on a very long session; the oldest entries drop first. */
export const STUDIO_HISTORY_LIMIT = 100;

export function pushStudioHistory(
  past: readonly StudioHistorySnapshot[],
  snapshot: StudioHistorySnapshot,
  limit: number = STUDIO_HISTORY_LIMIT,
): StudioHistorySnapshot[] {
  const next = [...past, snapshot];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function popStudioHistory(
  past: readonly StudioHistorySnapshot[],
): { snapshot: StudioHistorySnapshot; past: StudioHistorySnapshot[] } | null {
  if (!past.length) return null;
  return { snapshot: past[past.length - 1], past: past.slice(0, -1) };
}
