import { flattenBuilderSteps, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";

/**
 * Is the circuit on the canvas still a faithful picture of the code in the
 * editor? The canvas is seeded from the source once, when an artifact opens;
 * every later keystroke in the Code tab moves the source out from under a
 * diagram that keeps calling itself "Built circuit". This module supplies the
 * comparison that lets the canvas say so.
 *
 * The comparison is structural, not textual. Generated code and hand-written
 * code differ in imports, spacing and comments while describing the same
 * circuit, so comparing strings would report divergence constantly and teach
 * users to ignore the warning.
 */

export type CircuitSyncState =
  /** The code parses and matches the diagram. */
  | { kind: "in_sync" }
  /** The code parses into a different circuit than the one drawn. */
  | { kind: "diverged" }
  /** The code is outside the builder's subset, so no diagram can represent it. */
  | { kind: "unrepresentable" };

export interface ComparableCircuit {
  qubitCount: number;
  steps: BuilderStep[];
  customGates?: CustomGateDefinition[];
}

/**
 * A canonical string for a circuit's meaning: qubit width, the ordered
 * sequence of non-measurement operations, and whether the circuit measures.
 *
 * Measurement is reduced to a single flag on purpose. `generateBuilderCode`
 * emits one whole-register `measure_all()` for any measured circuit, so a
 * canvas that measures only q0 and the code it generates genuinely disagree
 * about which wires are read. That is a limitation of the generator, not a
 * stale canvas, and folding it into this signal would fire the divergence
 * warning on circuits the user never edited.
 */
export function circuitSignature(circuit: ComparableCircuit): string {
  const flattened = flattenBuilderSteps(circuit.steps, circuit.customGates ?? []);
  const operations = flattened.filter((step) => step.gate !== "M");
  const measured = flattened.some((step) => step.gate === "M");
  const body = operations
    .map((step) => `${step.gate}(${step.qubits.join(",")}${step.param ? `;${normalizeAngle(step.param)}` : ""})`)
    .join(" ");
  return `q${circuit.qubitCount}|${measured ? "m" : "-"}|${body}`;
}

/** `pi/2`, `1*pi/2` and `PI / 2` all describe the same rotation. */
function normalizeAngle(param: string): string {
  return param.trim().toLowerCase().replaceAll(/\s+/g, "").replace(/^1\*/, "");
}

/**
 * @param parsedFromCode the circuit the editor's source parses into, or null
 *   when the source falls outside the builder's subset.
 * @param onCanvas the circuit currently drawn.
 */
export function circuitSyncState(
  parsedFromCode: ComparableCircuit | null,
  onCanvas: ComparableCircuit,
): CircuitSyncState {
  if (!parsedFromCode) return { kind: "unrepresentable" };
  return circuitSignature(parsedFromCode) === circuitSignature(onCanvas)
    ? { kind: "in_sync" }
    : { kind: "diverged" };
}
