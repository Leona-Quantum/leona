import { circuitMoments, type CircuitMoments } from "./circuit-moments.ts";
import type { BuilderStep, CustomGateDefinition } from "./studio-builder.ts";

/**
 * Opening a custom-gate block in place: layout math only, no state change.
 *
 * "Open" is a set of step ids the *view* has chosen to look inside — never an
 * edit to `steps` or `customGates`. A closed block still draws as the sealed
 * box `circuit-diagram.tsx` has always drawn; an open one draws its child
 * steps inline on the parent's wires, remapped through the step's own qubit
 * mapping, inside a labelled bracket. Opening a block one level down does not
 * open any block nested inside it — that child stays sealed until its own id
 * is opened too, which is what "nested blocks open one level at a time" means
 * here: each level is toggled independently, not that nesting is capped.
 *
 * Every id in `openStepIds` is a *path*, not a bare step or gate id, so
 * opening one occurrence of a block never opens another occurrence of the
 * same definition drawn elsewhere on the canvas: a top-level step is keyed by
 * its own `BuilderStep.id`; a step drawn because an ancestor is open is keyed
 * by `${enclosingViewId}::${definitionStepId}`, exactly the composition
 * `flattenBuilderSteps` already uses for its own synthesized ids
 * (`${step.id}-${definitionStep.id}`), just with a separator that cannot
 * collide with a hyphen inside either half.
 */

export interface BlockViewStep {
  /** Path-unique key for React lists and click targets. */
  viewId: string;
  /** The step to draw, with `qubits` already remapped into top-level (global) indices. */
  step: BuilderStep;
  /** 0 for a top-level step; N for a step drawn N open-block levels deep. */
  depth: number;
  /** The top-level `BuilderStep.id` this display step rolls up to — what
   * clicking it should select, and what the playhead moment mapping keys on. */
  topLevelStepId: string;
  /** The `viewId` of the innermost open bracket this step is drawn inside, if any. */
  bracketId?: string;
}

export interface OpenBlockBracket {
  /** Equal to the `viewId` of the CUSTOM step this bracket opens. */
  bracketId: string;
  /** The `viewId` of the enclosing bracket, if this one is nested inside another open block. */
  parentBracketId?: string;
  topLevelStepId: string;
  name: string;
  /** Global qubits the block instance touches, ascending. */
  qubits: number[];
  /** 0 for a block opened directly on the canvas; N for one opened N levels deep. */
  depth: number;
}

export interface BlockView {
  displaySteps: BlockViewStep[];
  brackets: OpenBlockBracket[];
}

/**
 * Expand every top-level step whose id (or path-id, for a nested occurrence)
 * is in `openStepIds` into its definition's steps, recursively but gated at
 * each level by that level's own id. An opaque block, a missing definition, an
 * empty definition, or a definition that would recurse into its own ancestors
 * (a cycle should never reach a saved definition — see the cycle guard in
 * studio-block-edit.ts — but a stale draft predating that guard could) all
 * fall back to drawing that one step sealed, never a fabricated expansion.
 */
export function expandOpenBlocks(
  steps: readonly BuilderStep[],
  customGates: readonly CustomGateDefinition[],
  openStepIds: ReadonlySet<string>,
): BlockView {
  const byId = new Map(customGates.map((gate) => [gate.id, gate]));
  const displaySteps: BlockViewStep[] = [];
  const brackets: OpenBlockBracket[] = [];

  function expand(
    step: BuilderStep,
    viewId: string,
    depth: number,
    topLevelStepId: string,
    bracketId: string | undefined,
    ancestors: ReadonlySet<string>,
  ) {
    const definition = step.gate === "CUSTOM" && step.customGateId ? byId.get(step.customGateId) : undefined;
    const canOpen = Boolean(
      step.gate === "CUSTOM"
      && definition
      && !definition.opaque
      && definition.steps.length > 0
      && !ancestors.has(definition.id),
    );
    if (!canOpen || !openStepIds.has(viewId)) {
      displaySteps.push({ viewId, step, depth, topLevelStepId, bracketId });
      return;
    }
    const nextAncestors = new Set(ancestors).add(definition!.id);
    brackets.push({
      bracketId: viewId,
      parentBracketId: bracketId,
      topLevelStepId,
      name: definition!.name,
      qubits: [...step.qubits].sort((a, b) => a - b),
      depth,
    });
    for (const child of definition!.steps) {
      const remapped: BuilderStep = { ...child, qubits: child.qubits.map((qubit) => step.qubits[qubit]) };
      expand(remapped, `${viewId}::${child.id}`, depth + 1, topLevelStepId, viewId, nextAncestors);
    }
  }

  for (const step of steps) expand(step, step.id, 0, step.id, undefined, new Set());
  return { displaySteps, brackets };
}

/** Moments over the expanded view, plus each bracket's column extent — the
 * span an open block's label and border must cover. A bracket with no display
 * steps (should not happen; `expandOpenBlocks` only ever records one after
 * confirming its definition has steps) is dropped rather than drawn at a
 * fabricated column. */
export function blockViewMoments(
  qubitCount: number,
  view: BlockView,
): { moments: CircuitMoments; brackets: Array<OpenBlockBracket & { columnStart: number; columnEnd: number }> } {
  const moments = circuitMoments(qubitCount, view.displaySteps.map((display) => display.step));
  const extent = new Map<string, { start: number; end: number }>();
  view.displaySteps.forEach((display, index) => {
    const column = moments.columns[index] ?? 0;
    for (let id: string | undefined = display.bracketId; id; ) {
      const current = extent.get(id);
      extent.set(id, current ? { start: Math.min(current.start, column), end: Math.max(current.end, column) } : { start: column, end: column });
      id = view.brackets.find((bracket) => bracket.bracketId === id)?.parentBracketId;
    }
  });
  const brackets = view.brackets.flatMap((bracket) => {
    const found = extent.get(bracket.bracketId);
    return found ? [{ ...bracket, columnStart: found.start, columnEnd: found.end }] : [];
  });
  return { moments, brackets };
}

/**
 * Where the playhead line belongs in the *view's* column space.
 *
 * Simulation stays keyed to top-level moments regardless of what is open —
 * `studio-playhead.ts` only ever sees the top-level `steps`/`columns`, exactly
 * as before opening a block existed. What can go wrong when a block is open is
 * purely visual: the vertical line and each gate's "future" dimming are drawn
 * at a *view* column, and opening an earlier block shifts every view column
 * after it to the right.
 *
 * The boundary "before top-level moment N" is mapped to the view column of the
 * earliest display step belonging to the first top-level step at or after
 * column N. When parallel branches at the same top-level moment expand to
 * different widths, this places the line at the leftmost of them — an
 * accepted approximation, since a single vertical line cannot honestly mark
 * two different widths of "simultaneous" at once.
 */
export function viewColumnForTopLevelMoment(
  topLevelSteps: readonly BuilderStep[],
  topLevelColumns: readonly number[],
  view: BlockView,
  viewColumns: readonly number[],
  topLevelMoment: number,
): number {
  const viewStartByTopLevelId = new Map<string, number>();
  view.displaySteps.forEach((display, index) => {
    const column = viewColumns[index] ?? 0;
    const current = viewStartByTopLevelId.get(display.topLevelStepId);
    if (current === undefined || column < current) viewStartByTopLevelId.set(display.topLevelStepId, column);
  });
  for (let index = 0; index < topLevelSteps.length; index += 1) {
    if ((topLevelColumns[index] ?? 0) >= topLevelMoment) {
      const start = viewStartByTopLevelId.get(topLevelSteps[index].id);
      if (start !== undefined) return start;
    }
  }
  return viewColumns.reduce((max, column) => Math.max(max, column + 1), 0);
}
