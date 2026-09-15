import { flattenBuilderSteps, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { expectationValue, type PauliTerm } from "./statevector-kernel.ts";
import { playheadReading, type PlayheadReading } from "./studio-playhead.ts";
import type { AtlasCircuitOperation, AtlasCircuitSource } from "./repository/atlas-circuit-layout.ts";

/**
 * The pure view model behind the Atlas worked-example figure
 * (components/atlas-worked-example.tsx) — turning one `WorkedExample`
 * (apps/web/lib/worked-examples.ts) into a drawing and, per step, either
 * probability bars or ⟨H⟩. Nothing here re-implements the simulator or the
 * circuit-box geometry: `playheadReading`/`idealStatevector` do the physics
 * (via statevector-kernel.ts), `layoutAtlasCircuit` does the geometry, and
 * `flattenBuilderSteps` does block expansion — all imported, none rewritten.
 */

/** One top-level step, drawn as a labelled box — "opened" reveals its flattened gates. */
export function workedExampleDrawing(
  steps: readonly BuilderStep[],
  customGates: readonly CustomGateDefinition[],
  qubitCount: number,
): AtlasCircuitSource {
  const wires = Array.from({ length: qubitCount }, (_, index) => `q${index}`);
  const operations: AtlasCircuitOperation[] = steps.map((step) => ({
    label: stepLabel(step, customGates),
    qubits: step.qubits,
    tone: step.gate === "CUSTOM" ? "accent" : "neutral",
  }));
  return { wires, operations };
}

/**
 * A step's own label — a block's name (from its `CustomGateDefinition`, e.g.
 * "GHZ(4)", "QFT(4)") for a placed block, or the gate mnemonic plus its angle
 * for a raw gate (e.g. "RY(pi/3)"). `customGates` is searched by id; pass the
 * example's own list.
 */
export function stepLabel(step: BuilderStep, customGates: readonly CustomGateDefinition[]): string {
  if (step.gate === "CUSTOM") {
    const definition = customGates.find((gate) => gate.id === step.customGateId);
    return definition?.name ?? "Block";
  }
  return step.param ? `${step.gate}(${step.param})` : step.gate;
}

/**
 * A block box "opened one level": its own flattened gates, each with the
 * label a reader would recognize and the OUTER circuit's wire numbering
 * (flattenBuilderSteps already remaps qubits through the block's placement,
 * so no second remapping happens here). A raw-gate step has nothing to open
 * and returns an empty list.
 */
export function openedStepGates(
  step: BuilderStep,
  customGates: readonly CustomGateDefinition[],
): Array<{ id: string; label: string; qubits: readonly number[] }> {
  if (step.gate !== "CUSTOM") return [];
  const flat = flattenBuilderSteps([step], [...customGates]);
  return flat.map((gate) => ({ id: gate.id, label: stepLabel(gate, []), qubits: gate.qubits }));
}

export type WorkedExampleReading =
  | { kind: "probabilities"; reading: PlayheadReading }
  | { kind: "expectation"; value: number };

/**
 * The state after `currentStep` (0-indexed, inclusive) top-level steps —
 * probability bars from `playheadReading`, or, for an example with an
 * `observable`, ⟨H⟩ from `expectationValue` over the same prefix.
 */
export function workedExampleReading(
  steps: readonly BuilderStep[],
  customGates: readonly CustomGateDefinition[],
  qubitCount: number,
  currentStep: number,
  observable?: readonly PauliTerm[],
): WorkedExampleReading {
  if (observable && observable.length > 0) {
    const prefix = steps.slice(0, currentStep + 1);
    const value = expectationValue([...prefix], [...customGates], qubitCount, [...observable] as PauliTerm[]);
    return { kind: "expectation", value };
  }
  const columns = steps.map((_, index) => index);
  const reading = playheadReading({
    qubitCount,
    steps,
    customGates,
    columns,
    moment: currentStep + 1,
  });
  return { kind: "probabilities", reading };
}
