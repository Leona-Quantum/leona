import { createBuilderStepId, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import type { WorkedExample } from "./worked-examples.ts";

/**
 * A worked example, cloned into a fresh editable draft.
 *
 * `WORKED_EXAMPLES` carries deterministic ids (`withIds`/`leafBlock` in
 * circuit-blocks.ts build them positionally, e.g. `"bell-0"`), which is
 * exactly right for a static registry checked once at build time — two
 * requests for `workedExample("bell-pair")` must return steps that compare
 * equal. It is exactly wrong for a live Studio draft: opening the SAME
 * example twice (two tabs, or the gallery clicked twice) would then produce
 * two drafts whose steps share ids, and the builder's own invariants
 * (`selectedStepIds`, the undo stack, `insertBeforeTrailingMeasurements`)
 * assume a step's id is unique to its draft. This regenerates every id with
 * `createBuilderStepId`, keeping only the structure — gate, qubits, param,
 * and which definition each CUSTOM step calls.
 */
export interface WorkedExampleDraft {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  /** Same order and count as the source example's `notes`, with `stepId`
   * pointing at the corresponding CLONED top-level step. */
  notes: WorkedExample["notes"];
}

export function cloneWorkedExampleDraft(example: WorkedExample): WorkedExampleDraft {
  const stepIdMap = new Map<string, string>();
  const defIdMap = new Map<string, string>();

  const freshStepId = (oldId: string): string => {
    const existing = stepIdMap.get(oldId);
    if (existing) return existing;
    const fresh = createBuilderStepId("example-step");
    stepIdMap.set(oldId, fresh);
    return fresh;
  };
  const freshDefId = (oldId: string): string => {
    const existing = defIdMap.get(oldId);
    if (existing) return existing;
    const fresh = createBuilderStepId("example-def");
    defIdMap.set(oldId, fresh);
    return fresh;
  };
  const remapCustomGateId = (step: BuilderStep): Pick<BuilderStep, "customGateId"> =>
    step.gate === "CUSTOM" && step.customGateId ? { customGateId: freshDefId(step.customGateId) } : {};

  const steps = example.steps.map((step) => ({
    ...step,
    id: freshStepId(step.id),
    ...remapCustomGateId(step),
  }));

  const customGates = example.customGates.map((definition) => ({
    ...definition,
    id: freshDefId(definition.id),
    // A definition's own steps are never referenced by id from outside it
    // (not by notes, not by another definition), so they only need a fresh,
    // collision-free id each — no map to keep them stable across calls.
    steps: definition.steps.map((step) => ({
      ...step,
      id: createBuilderStepId("example-inner"),
      ...remapCustomGateId(step),
    })),
  }));

  const notes = example.notes.map((entry) => ({
    ...entry,
    stepId: stepIdMap.get(entry.stepId) ?? entry.stepId,
  }));

  return { qubitCount: example.qubitCount, steps, customGates, notes };
}
