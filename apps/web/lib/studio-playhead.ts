import { flattenBuilderSteps, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
// From the pure kernel directly, not from studio-simulation.ts: this module
// is reachable from the public Atlas worked-example figure
// (atlas-worked-example.tsx) as well as Studio's own (authenticated) Visual
// tab, and studio-simulation.ts's other imports (account-tier.ts,
// user-storage.ts) must not reach the public bundle. Same functions, same
// behavior — studio-simulation.ts re-exports both unchanged. See
// statevector-kernel.ts's doc comment.
import { bitstringFor, idealProbabilities, idealStatevector } from "./statevector-kernel.ts";
import { readEffect, type StepEffectReading } from "./atlas-step-effect.ts";

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

/**
 * What the gates at `moment` did to the state — the same reading the Atlas
 * worked-example figure prints under each step (`atlas-step-effect.ts`),
 * keyed to a Studio moment instead of an example step.
 *
 * Studio's bars answer "what is the state now". They cannot answer "what did
 * that gate just do", and for a whole class of gates they actively mislead: a
 * phase gate, a CZ, a controlled-phase, the oracle half of a Grover iteration
 * all leave the bars pixel-identical, so scrubbing across one shows a builder
 * nothing and reads as a gate that did nothing. That is the same blindness the
 * Atlas figure had, and the fix is the same instrument.
 *
 * Returns null where the bars themselves are unavailable — the panel already
 * says why in that case, and a second message repeating it, or worse a
 * "nothing changed" over a state that could not be read, would be noise on top
 * of a warning.
 *
 * `moment` is the playhead's own position: 0 is before the first gate, where
 * there is no preceding gate to report on, so that returns null too.
 */
export function momentEffect({
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
}): StepEffectReading | null {
  if (moment <= 0) return null;
  if (qubitCount > MAX_LIVE_PROBABILITY_QUBITS) return null;
  const definitions = new Map(customGates.map((gate) => [gate.id, gate]));
  const through = stepsBeforeMoment(steps, columns, moment);
  if (through.some((step) => step.gate === "CUSTOM" && !definitions.get(step.customGateId ?? "")?.steps)) return null;
  if (through.some((step) => step.gate === "CUSTOM" && definitions.get(step.customGateId ?? "")?.opaque === true)) {
    return null;
  }
  const before = stepsBeforeMoment(steps, columns, moment - 1);
  // Nothing is drawn at this moment — the playhead is between columns that
  // hold no gate. Reporting "nothing changed" would be true and useless.
  if (through.length === before.length) return null;
  // A moment that is only measurements has nothing this reading can honestly
  // say. `executeCircuit` treats M as a no-op on the statevector (it is
  // terminal), so before and after are identical and the sentence would come
  // out as "Nothing about the state changes here" — true of the vector, and
  // exactly the wrong thing to tell a reader about the step that produces the
  // outcome they are looking at. Seen on the GHZ fixture, where the last
  // moment is the measurement layer.
  const added = through.slice(before.length);
  if (added.length > 0 && added.every((step) => step.gate === "M")) return null;

  const flatAfter = flattenBuilderSteps([...through], [...customGates]);
  const flatBefore = flattenBuilderSteps([...before], [...customGates]);
  const measured = new Set<number>();
  for (const step of flatAfter) {
    if (step.gate === "M") {
      for (const qubit of step.qubits) measured.add(qubit);
    } else if (step.qubits.some((qubit) => measured.has(qubit))) {
      return null;
    }
  }
  try {
    return readEffect(
      idealStatevector({ qubitCount, steps: flatBefore }),
      idealStatevector({ qubitCount, steps: flatAfter }),
      qubitCount,
    );
  } catch {
    return null;
  }
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
  // Probability first, compared with a tolerance, then basis index. A bare
  // subtraction orders the equal amplitudes of a uniform superposition by
  // their last float bits: on the Grover example's oracle step the eight
  // identical 12.5% bars read 100, 111, 011, 101, 000, 001, 110, 010 — an
  // order with no meaning, which a reader scanning for one bitstring has to
  // search rather than index into. Within the tolerance the basis index is
  // the tie-break, so equal outcomes list in counting order.
  nonzero.sort((left, right) => {
    const gap = right.probability - left.probability;
    if (Math.abs(gap) > 1e-12) return gap;
    return left.index - right.index;
  });
  const shown = nonzero.slice(0, LIVE_PROBABILITY_BARS);
  const rest = nonzero.slice(LIVE_PROBABILITY_BARS);
  return {
    kind: "ok",
    bars: shown.map(({ index, probability }) => ({ bitstring: bitstringFor(index, qubitCount), probability })),
    otherStates: rest.length,
    otherProbability: rest.reduce((sum, item) => sum + item.probability, 0),
  };
}
