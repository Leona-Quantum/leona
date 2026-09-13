import { flattenBuilderSteps, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { bitstringFor, idealProbabilities } from "./studio-simulation.ts";

/**
 * The Visual tab's playhead: ideal outcome probabilities after a chosen moment.
 *
 * It runs the CPU lane's own statevector kernel (`idealProbabilities`) on the
 * operations drawn before the playhead, so the bars and a CPU simulation of the
 * finished circuit can only differ by sampling noise. It is noiseless and local:
 * not a run, not a record, not evidence — the panel says so.
 *
 * It declines rather than guesses. A gate after a measurement on the same wire
 * would need the collapsed branch, which a single statevector does not carry;
 * an opaque custom gate has no steps to apply; a very wide register would make
 * every scrub allocate 2^n amplitudes twice.
 */

export const MAX_LIVE_PROBABILITY_QUBITS = 12;
export const LIVE_PROBABILITY_BARS = 8;

export type PlayheadUnavailable = "too_wide" | "opaque_custom" | "mid_circuit_measurement" | "angle";

export type PlayheadBar = { bitstring: string; probability: number };

export type PlayheadReading =
  | { kind: "ok"; bars: PlayheadBar[]; otherStates: number; otherProbability: number }
  | { kind: "unavailable"; reason: PlayheadUnavailable };

/**
 * Operations drawn strictly left of `moment`, in array order. Operations in one
 * column act on disjoint wires, so their order inside the column cannot change
 * the state.
 */
export function stepsBeforeMoment<T>(steps: readonly T[], columns: readonly number[], moment: number): T[] {
  return steps.filter((_, index) => (columns[index] ?? Number.POSITIVE_INFINITY) < moment);
}

export function playheadReading({
  qubitCount,
  steps,
  customGates,
  columns,
  moment,
}: {
  qubitCount: number;
  steps: readonly BuilderStep[];
  customGates: readonly CustomGateDefinition[];
  columns: readonly number[];
  moment: number;
}): PlayheadReading {
  if (qubitCount > MAX_LIVE_PROBABILITY_QUBITS) return { kind: "unavailable", reason: "too_wide" };
  const prefix = stepsBeforeMoment(steps, columns, moment);
  const definitions = new Map(customGates.map((gate) => [gate.id, gate]));
  const opaque = prefix.some((step) => {
    if (step.gate !== "CUSTOM") return false;
    const definition = definitions.get(step.customGateId ?? "");
    return !definition || definition.opaque === true;
  });
  if (opaque) return { kind: "unavailable", reason: "opaque_custom" };

  const flat = flattenBuilderSteps([...prefix], [...customGates]);
  const measured = new Set<number>();
  for (const step of flat) {
    if (step.gate === "M") {
      for (const qubit of step.qubits) measured.add(qubit);
    } else if (step.qubits.some((qubit) => measured.has(qubit))) {
      return { kind: "unavailable", reason: "mid_circuit_measurement" };
    }
  }

  let probabilities: Float64Array;
  try {
    probabilities = idealProbabilities({ qubitCount, steps: flat });
  } catch {
    // The kernel's bounded angle syntax is narrower than the editor's; the
    // only other throw, a custom gate, was flattened away above.
    return { kind: "unavailable", reason: "angle" };
  }

  const nonzero: Array<{ index: number; probability: number }> = [];
  for (let index = 0; index < probabilities.length; index += 1) {
    if (probabilities[index] > 1e-12) nonzero.push({ index, probability: probabilities[index] });
  }
  nonzero.sort((left, right) => right.probability - left.probability || left.index - right.index);
  const shown = nonzero.slice(0, LIVE_PROBABILITY_BARS);
  const rest = nonzero.slice(LIVE_PROBABILITY_BARS);
  return {
    kind: "ok",
    bars: shown.map(({ index, probability }) => ({ bitstring: bitstringFor(index, qubitCount), probability })),
    otherStates: rest.length,
    otherProbability: rest.reduce((sum, item) => sum + item.probability, 0),
  };
}
