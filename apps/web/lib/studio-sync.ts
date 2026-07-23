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
 * A canonical string for a circuit's meaning: qubit width and the ordered
 * sequence of operations, with one normalization.
 *
 * A *trailing* run of measurements collapses to a single `MEASURE` token,
 * whatever wires it covers. `generateBuilderCode` emits one whole-register
 * `measure_all()` for any measured circuit, so a canvas that measures only q0
 * round-trips back as measurement on every wire. That widening is a limitation
 * of the generator, not a stale canvas, and letting it drive the warning would
 * fire on circuits nobody edited.
 *
 * Measurements anywhere *else* keep their position and their wire. Collapsing
 * those too would call `M(q0) → X(q0)` and `X(q0) → M(q0)` identical, and they
 * are not — measuring before a gate and after it give different results. The
 * builder cannot express mid-circuit measurement at all (generateBuilderCode
 * strips every M and appends measure_all), so a diagram containing one really
 * does disagree with any code generated from it, and saying so is the honest
 * outcome rather than a false positive.
 */
export function circuitSignature(circuit: ComparableCircuit): string {
  const flattened = flattenBuilderSteps(circuit.steps, circuit.customGates ?? []);
  let end = flattened.length;
  while (end > 0 && flattened[end - 1].gate === "M") end -= 1;
  const body = flattened
    .slice(0, end)
    .map((step) => `${step.gate}(${step.qubits.join(",")}${step.param ? `;${normalizeAngle(step.param)}` : ""})`)
    .join(" ");
  const trailingMeasure = end < flattened.length ? " MEASURE" : "";
  return `q${circuit.qubitCount}|${body}${trailingMeasure}`;
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
