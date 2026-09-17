import { flattenBuilderSteps, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { bitstringFor, idealStatevector } from "./statevector-kernel.ts";

/**
 * What one step of a worked example actually DID to the state — computed from
 * the statevector before and after it, never authored.
 *
 * Why this exists. The Atlas worked-example figure already showed outcome
 * probabilities after each step and an author's one-line note. Between them
 * they left the two questions a reader most often has unanswered:
 *
 * 1. **"What changed?"** The bars show a distribution, not a movement. A
 *    reader comparing step 4 to step 3 has to hold eight numbers in their head.
 * 2. **"Why did nothing change?"** Roughly a third of the steps in the corpus's
 *    examples leave the probabilities *identical* — every QFT-basis phase
 *    rotation, every oracle in a phase-kickback algorithm, the whole cost layer
 *    of QAOA. The bars are the same before and after, so the figure's own
 *    evidence says the step did nothing, which is the exact opposite of the
 *    truth: those steps are where the algorithm does its work, and it does it
 *    in a quantity the probability panel cannot show at all.
 *
 * So this module reads the amplitudes, not just their squares. `describe`
 * turns the reading into one sentence naming the movement and its numbers; the
 * figure renders that beside the author's note, and renders the phases
 * themselves when the step moved phase rather than probability.
 *
 * Everything here is derived. There is no content to keep in sync with the
 * examples, a new example gets its account for free, and an example edited to
 * have different physics cannot leave a stale sentence behind — which is what
 * an authored note per step would do, and has done: `vqe-transverse-ising`
 * shipped with four of its five notes reading "RY on qubit N, the Kth
 * variational layer", a restatement of the label directly above them.
 *
 * Bounds and honesty. This runs the same pure kernel the figure's own
 * probability bars run (`statevector-kernel.ts`), on ≤ `MAX_EFFECT_QUBITS`
 * qubits, and declines rather than guesses everywhere that kernel declines —
 * a measurement mid-circuit, an opaque block, an angle outside its syntax. A
 * declined reading renders as nothing at all, not as "no change".
 */

/** The figure's own ceiling, matching studio-playhead.ts's MAX_LIVE_PROBABILITY_QUBITS. */
export const MAX_EFFECT_QUBITS = 12;

/** Below this, an amplitude is treated as absent rather than small. */
const AMPLITUDE_EPSILON = 1e-9;
/** Below this total variation distance, two distributions are the same distribution. */
const PROBABILITY_EPSILON = 1e-9;
/** Below this, a phase difference is rounding, not a rotation. */
const PHASE_EPSILON = 1e-9;

export type StepEffectUnavailable =
  | "too_wide"
  | "opaque_custom"
  | "mid_circuit_measurement"
  | "angle";

/**
 * How the step moved the state. Exactly one applies, and the order below is
 * the order `classify` tests them in.
 *
 * - `none` — neither the probabilities nor the phases moved. A genuinely inert
 *   step (an RY(0) placed to keep an ansatz's shape, for instance).
 * - `phase` — the probabilities are unchanged and the phases are not. The case
 *   the probability panel cannot show.
 * - `move` — every basis state that had probability lost it, and every basis
 *   state that has it now had none: a permutation, not a change of shape. An X
 *   on a basis state, and the Draper adder turning |0101⟩ into |1000⟩, are
 *   both this. It is a separate case from `redistribute` because the support
 *   SIZE does not change and an earlier version of this classifier, which
 *   compared only sizes, printed "probability moves between the same 1
 *   outcomes" for 5 + 3 = 8.
 * - `spread` — basis states gained probability and none lost all of theirs.
 * - `concentrate` — basis states lost all their probability and none were
 *   newly populated.
 * - `redistribute` — anything else: the same basis states with different
 *   weights, or a partial exchange.
 */
export type StepChange = "none" | "phase" | "move" | "spread" | "concentrate" | "redistribute";

/** One basis state whose probability moved, largest movement first. */
export interface ProbabilityMove {
  readonly bitstring: string;
  readonly before: number;
  readonly after: number;
}

/**
 * One basis state's amplitude after the step, as magnitude and phase.
 *
 * `phaseTurns` is measured **relative to the reference amplitude** — the
 * largest-magnitude amplitude, ties broken by basis index — and lies in
 * [0, 1). A global phase is not observable, so reporting absolute phases would
 * print a number that a physically identical state can disagree on; relative
 * to a fixed reference, every number here is a quantity a later interference
 * step can actually turn back into probability.
 */
export interface AmplitudePhase {
  readonly bitstring: string;
  readonly magnitude: number;
  readonly probability: number;
  readonly phaseTurns: number;
}

export interface StepEffectReading {
  readonly kind: "ok";
  readonly change: StepChange;
  /** True when the step left qubits entangled that were not entangled before it. */
  readonly entangles: boolean;
  /** True when a state that was entangled before the step is a product state after it. */
  readonly disentangles: boolean;
  /**
   * How many basis states carry probability, before and after, and how the
   * SET changed — `newlyPopulated` had none before, `emptied` had some and
   * have none now.
   *
   * The two counts are carried rather than left to be inferred from the sizes
   * because they cannot be: a step can populate three states and empty three
   * others with the support size unchanged, and a sentence that read the sizes
   * alone would call that "the same N outcomes" while naming none of the six
   * that changed.
   */
  readonly support: {
    readonly before: number;
    readonly after: number;
    readonly newlyPopulated: number;
    readonly emptied: number;
  };
  /**
   * True when every populated basis state after the step carries the same
   * probability. Worth saying out loud — "an equal superposition of all 16"
   * is a fact about the state a reader can check against the bars, and it is
   * what a Hadamard layer is FOR.
   */
  readonly uniform: boolean;
  /** For `move`: where the whole state went, when exactly one state held it before and one holds it after. */
  readonly moved: { readonly from: string; readonly to: string } | null;
  /** The largest probability movements, biggest first, at most `MOVES_SHOWN`. */
  readonly moves: readonly ProbabilityMove[];
  /** Total variation distance between the two distributions, in [0, 1]. */
  readonly distance: number;
  /** How many distinct relative phases the state carries after the step. */
  readonly distinctPhases: number;
  /** The state after the step, largest amplitude first, at most `PHASES_SHOWN`. */
  readonly phases: readonly AmplitudePhase[];
  /** Basis states beyond `phases`, and the probability they hold between them. */
  readonly otherStates: number;
  readonly otherProbability: number;
}

export type StepEffect = StepEffectReading | { readonly kind: "unavailable"; readonly reason: StepEffectUnavailable };

const MOVES_SHOWN = 3;
const PHASES_SHOWN = 8;

/**
 * Runs the prefix of `steps` up to and including `index`, and the prefix
 * before it, and reports the difference.
 *
 * `index` is 0-based over the example's own top-level steps. Passing an index
 * outside the list is a programming error rather than a reading, and throws —
 * a silently empty reading here would render as "this step did nothing".
 */
export function stepEffect({
  steps,
  customGates,
  qubitCount,
  index,
}: {
  steps: readonly BuilderStep[];
  customGates: readonly CustomGateDefinition[];
  qubitCount: number;
  index: number;
}): StepEffect {
  if (index < 0 || index >= steps.length) {
    throw new RangeError(`stepEffect: index ${index} is outside 0..${steps.length - 1}`);
  }
  if (qubitCount > MAX_EFFECT_QUBITS) return { kind: "unavailable", reason: "too_wide" };

  const definitions = new Map(customGates.map((gate) => [gate.id, gate]));
  const through = steps.slice(0, index + 1);
  const opaque = through.some((step) => {
    if (step.gate !== "CUSTOM") return false;
    const definition = definitions.get(step.customGateId ?? "");
    return !definition || definition.opaque === true;
  });
  if (opaque) return { kind: "unavailable", reason: "opaque_custom" };

  const flatAfter = flattenBuilderSteps([...through], [...customGates]);
  const measured = new Set<number>();
  for (const step of flatAfter) {
    if (step.gate === "M") {
      for (const qubit of step.qubits) measured.add(qubit);
    } else if (step.qubits.some((qubit) => measured.has(qubit))) {
      return { kind: "unavailable", reason: "mid_circuit_measurement" };
    }
  }
  const flatBefore = flattenBuilderSteps([...steps.slice(0, index)], [...customGates]);

  let before: { real: Float64Array; imaginary: Float64Array };
  let after: { real: Float64Array; imaginary: Float64Array };
  try {
    before = idealStatevector({ qubitCount, steps: flatBefore });
    after = idealStatevector({ qubitCount, steps: flatAfter });
  } catch {
    // The kernel's bounded angle syntax is narrower than the editor's; the
    // only other throw, a custom gate, was flattened away above.
    return { kind: "unavailable", reason: "angle" };
  }

  return readEffect(before, after, qubitCount);
}

/** The reading itself, separated from running the circuits so it can be tested against hand-built states. */
export function readEffect(
  before: { real: Float64Array; imaginary: Float64Array },
  after: { real: Float64Array; imaginary: Float64Array },
  qubitCount: number,
): StepEffectReading {
  const dimension = 1 << qubitCount;
  const probabilitiesBefore = probabilities(before, dimension);
  const probabilitiesAfter = probabilities(after, dimension);

  let distance = 0;
  for (let index = 0; index < dimension; index += 1) {
    distance += Math.abs(probabilitiesAfter[index] - probabilitiesBefore[index]);
  }
  distance /= 2;

  const populatedBefore = populatedIndices(probabilitiesBefore);
  const populatedAfter = populatedIndices(probabilitiesAfter);
  const supportBefore = populatedBefore.length;
  const supportAfter = populatedAfter.length;
  const beforeSet = new Set(populatedBefore);
  const afterSet = new Set(populatedAfter);
  const gained = populatedAfter.filter((index) => !beforeSet.has(index));
  const lost = populatedBefore.filter((index) => !afterSet.has(index));
  const kept = populatedAfter.filter((index) => beforeSet.has(index));
  const phasesAfter = relativePhases(after, dimension, qubitCount);
  const phasesBefore = relativePhases(before, dimension, qubitCount);
  const productBefore = isProduct(before, qubitCount);
  const productAfter = isProduct(after, qubitCount);

  const moves: ProbabilityMove[] = [];
  for (let index = 0; index < dimension; index += 1) {
    const from = probabilitiesBefore[index];
    const to = probabilitiesAfter[index];
    if (Math.abs(to - from) <= PROBABILITY_EPSILON) continue;
    moves.push({ bitstring: bitstringFor(index, qubitCount), before: from, after: to });
  }
  moves.sort(
    (left, right) =>
      Math.abs(right.after - right.before) - Math.abs(left.after - left.before) ||
      left.bitstring.localeCompare(right.bitstring),
  );

  const change = classify({
    distance,
    gained: gained.length,
    lost: lost.length,
    kept: kept.length,
    phasesBefore: phasesBefore.all,
    phasesAfter: phasesAfter.all,
  });

  return {
    kind: "ok",
    change,
    entangles: productBefore && !productAfter,
    disentangles: !productBefore && productAfter,
    support: {
      before: supportBefore,
      after: supportAfter,
      newlyPopulated: gained.length,
      emptied: lost.length,
    },
    uniform: isUniform(probabilitiesAfter, populatedAfter),
    moved:
      change === "move" && supportBefore === 1 && supportAfter === 1
        ? {
            from: bitstringFor(populatedBefore[0], qubitCount),
            to: bitstringFor(populatedAfter[0], qubitCount),
          }
        : null,
    moves: moves.slice(0, MOVES_SHOWN),
    distance,
    distinctPhases: distinctPhaseCount(phasesAfter.all),
    phases: phasesAfter.shown,
    otherStates: phasesAfter.otherStates,
    otherProbability: phasesAfter.otherProbability,
  };
}

function probabilities(state: { real: Float64Array; imaginary: Float64Array }, dimension: number): Float64Array {
  const out = new Float64Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    out[index] = state.real[index] ** 2 + state.imaginary[index] ** 2;
  }
  return out;
}

function populatedIndices(values: Float64Array): number[] {
  const indices: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > AMPLITUDE_EPSILON) indices.push(index);
  }
  return indices;
}

/** Whether every populated basis state carries the same probability. */
function isUniform(values: Float64Array, populated: readonly number[]): boolean {
  if (populated.length <= 1) return true;
  const first = values[populated[0]];
  return populated.every((index) => Math.abs(values[index] - first) <= 1e-9);
}

/**
 * Which of the six changes this step made.
 *
 * Keyed on how the SET of populated basis states changed, not on how its size
 * changed — the two differ exactly where a permutation is involved, and that
 * is where a size-only test produces nonsense ("moves between the same 1
 * outcomes" for a Draper adder that computed 5 + 3 = 8).
 */
function classify({
  distance,
  gained,
  lost,
  kept,
  phasesBefore,
  phasesAfter,
}: {
  distance: number;
  gained: number;
  lost: number;
  kept: number;
  phasesBefore: readonly number[];
  phasesAfter: readonly number[];
}): StepChange {
  if (distance <= PROBABILITY_EPSILON) {
    return samePhases(phasesBefore, phasesAfter) ? "none" : "phase";
  }
  if (kept === 0 && gained > 0 && lost > 0) return "move";
  if (lost === 0 && gained > 0) return "spread";
  if (gained === 0 && lost > 0) return "concentrate";
  return "redistribute";
}

/**
 * Whether two phase arrays agree entry for entry.
 *
 * `relativePhases` writes 0 for an amplitude that is not populated, so on its
 * own this cannot tell "phase 0" from "absent". That is safe only because of
 * where it is called from: `classify` reaches it only once the two probability
 * distributions have been found identical to within PROBABILITY_EPSILON, which
 * already means the two states populate exactly the same basis indices. Moving
 * this call anywhere else needs a real sentinel first.
 */
function samePhases(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]) <= PHASE_EPSILON);
}

/**
 * The phase of each populated amplitude relative to the largest one, in turns
 * (so 0.5 is a sign flip and 0.25 is a factor of i), together with the
 * `PHASES_SHOWN` largest for display.
 */
function relativePhases(
  state: { real: Float64Array; imaginary: Float64Array },
  dimension: number,
  qubitCount: number,
): { all: number[]; shown: AmplitudePhase[]; otherStates: number; otherProbability: number } {
  let referenceIndex = -1;
  let referenceMagnitude = -1;
  for (let index = 0; index < dimension; index += 1) {
    const magnitude = Math.hypot(state.real[index], state.imaginary[index]);
    if (magnitude > referenceMagnitude + AMPLITUDE_EPSILON) {
      referenceMagnitude = magnitude;
      referenceIndex = index;
    }
  }
  const referenceAngle =
    referenceIndex < 0 ? 0 : Math.atan2(state.imaginary[referenceIndex], state.real[referenceIndex]);

  const populated: AmplitudePhase[] = [];
  const all: number[] = [];
  for (let index = 0; index < dimension; index += 1) {
    const magnitude = Math.hypot(state.real[index], state.imaginary[index]);
    if (magnitude * magnitude <= AMPLITUDE_EPSILON) {
      all.push(0);
      continue;
    }
    const turns = normalizeTurns((Math.atan2(state.imaginary[index], state.real[index]) - referenceAngle) / (2 * Math.PI));
    all.push(turns);
    populated.push({
      bitstring: bitstringFor(index, qubitCount),
      magnitude,
      probability: magnitude * magnitude,
      phaseTurns: turns,
    });
  }
  populated.sort(
    (left, right) => right.probability - left.probability || left.bitstring.localeCompare(right.bitstring),
  );
  const shown = populated.slice(0, PHASES_SHOWN);
  const rest = populated.slice(PHASES_SHOWN);
  return {
    all,
    shown,
    otherStates: rest.length,
    otherProbability: rest.reduce((sum, item) => sum + item.probability, 0),
  };
}

/** Maps a turn count into [0, 1), snapping a value within PHASE_EPSILON of 1 back to 0. */
function normalizeTurns(turns: number): number {
  let value = turns % 1;
  if (value < 0) value += 1;
  if (value >= 1 - PHASE_EPSILON || value <= PHASE_EPSILON) return 0;
  return value;
}

function distinctPhaseCount(all: readonly number[]): number {
  const seen: number[] = [];
  for (const value of all) {
    if (value === 0 && seen.includes(0)) continue;
    if (!seen.some((existing) => Math.abs(existing - value) <= 1e-6)) seen.push(value);
  }
  return seen.length;
}

/**
 * Whether the state is a product state — every qubit separable from the rest.
 *
 * Tested one qubit at a time by the purity of its reduced density matrix:
 * Tr(ρ²) = 1 exactly when that qubit is in a pure state of its own, and less
 * than 1 exactly when it is entangled with the others. A state is a product
 * state when this holds for every qubit. That is the standard criterion, and
 * unlike a structural guess ("it has a CX in it") it is a property of the
 * state rather than of how the state was written — a CX on |00⟩ entangles
 * nothing, and this correctly says so.
 */
export function isProduct(
  state: { real: Float64Array; imaginary: Float64Array },
  qubitCount: number,
): boolean {
  for (let qubit = 0; qubit < qubitCount; qubit += 1) {
    if (reducedPurity(state, qubitCount, qubit) < 1 - 1e-7) return false;
  }
  return true;
}

/**
 * Tr(ρ²) for the single-qubit reduced state of `qubit`, in [0.5, 1].
 *
 * ρ is the 2×2 matrix obtained by tracing out every other qubit:
 * ρ_ab = Σ_rest ψ*(a, rest) ψ(b, rest). Its purity is ρ00² + ρ11² + 2|ρ01|².
 */
export function reducedPurity(
  state: { real: Float64Array; imaginary: Float64Array },
  qubitCount: number,
  qubit: number,
): number {
  const dimension = 1 << qubitCount;
  const bit = 1 << qubit;
  let rho00 = 0;
  let rho11 = 0;
  let rho01Real = 0;
  let rho01Imaginary = 0;
  for (let index = 0; index < dimension; index += 1) {
    if (index & bit) continue;
    const zeroReal = state.real[index];
    const zeroImaginary = state.imaginary[index];
    const oneReal = state.real[index | bit];
    const oneImaginary = state.imaginary[index | bit];
    rho00 += zeroReal * zeroReal + zeroImaginary * zeroImaginary;
    rho11 += oneReal * oneReal + oneImaginary * oneImaginary;
    // conj(psi_0) * psi_1
    rho01Real += zeroReal * oneReal + zeroImaginary * oneImaginary;
    rho01Imaginary += zeroReal * oneImaginary - zeroImaginary * oneReal;
  }
  return rho00 * rho00 + rho11 * rho11 + 2 * (rho01Real * rho01Real + rho01Imaginary * rho01Imaginary);
}
