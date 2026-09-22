import { expectedShotNoiseTvd, parseSubmittedCircuit, type ParseLimits } from "./qpu-ideal.ts";
import { bitstringFor, idealProbabilities } from "./statevector-kernel.ts";
import type { QpuPublishedErrorFigure, QpuPublishedNoise, QpuPublishedNoiseProfile } from "./qpu.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";

/**
 * "Before you pay": what a device's published error figures predict for a
 * circuit, computed in this browser before the circuit is submitted.
 *
 * It is an estimate from vendor summaries (a median, a mean, or one headline
 * figure per device, recorded with its source in majorana_qpu's
 * noise_figures.py), never a prediction of a particular run. Nothing is sent
 * anywhere and nothing is executed on a server: the ideal distribution comes
 * from the same bounded parser and statevector kernel as the measured-against-
 * ideal panel (qpu-ideal.ts), and the noise is arithmetic on top of it.
 *
 * ## The model, and why this one
 *
 * Gate errors use a GLOBAL depolarising approximation. A randomized-
 * benchmarking error rate r on a d-dimensional gate corresponds to a
 * depolarising channel that replaces the state with the maximally mixed one
 * with probability lambda = d r / (d - 1): 2r for one-qubit gates, 4r/3 for
 * two-qubit gates. That is the definition RB fits, so the conversion takes the
 * published number at its word. The approximation is to let each such event
 * scramble the whole register, so the distribution before readout is
 *
 *   P * ideal + (1 - P) * uniform,   P = product over gates of (1 - lambda_g),
 *
 * which is the usual first-order estimate of circuit fidelity from per-gate
 * error rates. Readout error is then applied exactly, as an independent
 * symmetric bit flip on each measured qubit (a 2x2 confusion matrix per
 * qubit, applied as a tensor product).
 *
 * A per-gate density-matrix simulation would get the SHAPE of the noise right,
 * and was rejected on cost: it holds 4^n amplitudes where the statevector holds
 * 2^n. At the browser tiers' 8 to 20 qubit ceilings (account-tier.ts) that is
 * 1 MB at 8 qubits, 268 MB at 12, and 17.6 TB at 20. Sampling noisy statevector
 * trajectories instead costs one full simulation per trajectory, 1.2 s each
 * at 20 qubits and about 1,000 gates by the sweep studio-simulation.ts cites,
 * and would itself be noisy. The global model costs one ideal simulation plus
 * O(n 2^n) arithmetic per device, which fits every tier.
 *
 * What the approximation gets wrong, in the direction that matters: real
 * errors are local and partly coherent, so the distribution's shape differs;
 * gates are counted as written, while a device with limited wiring adds swap
 * gates to route the circuit; idle qubits decay; and a figure the vendor did
 * not publish is left out rather than guessed. All of those except the shape
 * make a real run noisier than this, and the UI says so.
 */

/** Physical gates implied by a parsed circuit, counted as written. */
export type GateTally = {
  oneQubit: number;
  twoQubit: number;
  /** Qubits read out at the end. The parse path only accepts a whole-register
   * measurement, so this is every qubit. */
  measuredQubits: number;
};

/**
 * How many one- and two-qubit gates each builder gate stands for. Gates no
 * device runs as one native two-qubit operation use their textbook
 * decompositions: SWAP is three CX; CP(theta) and RZZ(theta) are two CX with
 * three and one phase rotations; CCX is Qiskit's six-CX definition with nine
 * one-qubit gates. Some devices do better (trapped ions and IBM's fractional
 * gates can run RZZ as one operation), so these counts lean high for them,
 * and phase gates that superconducting devices apply in software are counted
 * as real gates. Both effects are small next to what the tally leaves out
 * (routing swaps), which is why the tally stays device-independent.
 */
const GATE_COST: Record<string, { oneQubit: number; twoQubit: number }> = {
  H: { oneQubit: 1, twoQubit: 0 },
  X: { oneQubit: 1, twoQubit: 0 },
  Y: { oneQubit: 1, twoQubit: 0 },
  Z: { oneQubit: 1, twoQubit: 0 },
  S: { oneQubit: 1, twoQubit: 0 },
  T: { oneQubit: 1, twoQubit: 0 },
  SDG: { oneQubit: 1, twoQubit: 0 },
  TDG: { oneQubit: 1, twoQubit: 0 },
  RX: { oneQubit: 1, twoQubit: 0 },
  RY: { oneQubit: 1, twoQubit: 0 },
  RZ: { oneQubit: 1, twoQubit: 0 },
  P: { oneQubit: 1, twoQubit: 0 },
  CX: { oneQubit: 0, twoQubit: 1 },
  CZ: { oneQubit: 0, twoQubit: 1 },
  SWAP: { oneQubit: 0, twoQubit: 3 },
  CP: { oneQubit: 3, twoQubit: 2 },
  RZZ: { oneQubit: 1, twoQubit: 2 },
  CCX: { oneQubit: 9, twoQubit: 6 },
  M: { oneQubit: 0, twoQubit: 0 },
};

/** Null when the circuit holds a gate this table has no cost for (a custom
 * gate), because a tally that skipped it would understate the noise silently. */
export function tallyGates(circuit: ParsedBuilderCircuit): GateTally | null {
  let oneQubit = 0;
  let twoQubit = 0;
  for (const step of circuit.steps) {
    const cost = GATE_COST[step.gate];
    if (!cost) return null;
    oneQubit += cost.oneQubit;
    twoQubit += cost.twoQubit;
  }
  return { oneQubit, twoQubit, measuredQubits: circuit.qubitCount };
}

/** Per-operation error probabilities. Null means not published: left out. */
export type NoiseRates = {
  oneQubitGateError: number | null;
  twoQubitGateError: number | null;
  readoutError: number | null;
};

/**
 * The weight left on the ideal distribution after every gate's depolarising
 * event, P in the module comment. A rate so high that lambda reaches 1 (a
 * one-qubit error of 1/2, a two-qubit error of 3/4) means full
 * depolarisation, and P is 0.
 */
export function idealWeight(tally: GateTally, rates: NoiseRates): number {
  const oneQubitSurvival = clamp01(1 - 2 * (rates.oneQubitGateError ?? 0));
  const twoQubitSurvival = clamp01(1 - (4 / 3) * (rates.twoQubitGateError ?? 0));
  return oneQubitSurvival ** tally.oneQubit * twoQubitSurvival ** tally.twoQubit;
}

/** weight * distribution + (1 - weight) * uniform. */
export function mixWithUniform(distribution: Float64Array, weight: number): Float64Array {
  const uniformShare = (1 - weight) / distribution.length;
  const mixed = new Float64Array(distribution.length);
  for (let index = 0; index < distribution.length; index += 1) {
    mixed[index] = weight * distribution[index] + uniformShare;
  }
  return mixed;
}

/**
 * Applies an independent, symmetric readout flip with probability `flip` to
 * each of the first `qubitCount` qubits. Basis index i has qubit j at bit j,
 * the statevector kernel's convention, so the confusion matrix for qubit j
 * mixes each index with its partner i ^ (1 << j).
 *
 * Symmetric because each vendor publishes one readout number per device. IBM's
 * is the mean of P(read 0 | prepared 1) and P(read 1 | prepared 0), and the two
 * are not equal in practice: the example qubit in IBM's backend-details guide
 * (quantum.cloud.ibm.com/docs/en/guides/qpu-information) misreads a prepared 1
 * 8.7% of the time and a prepared 0 2.0%. One figure cannot express that.
 */
export function applyReadoutFlip(distribution: Float64Array, qubitCount: number, flip: number): Float64Array {
  const result = Float64Array.from(distribution);
  if (flip <= 0) return result;
  const keep = 1 - flip;
  for (let qubit = 0; qubit < qubitCount; qubit += 1) {
    const mask = 1 << qubit;
    for (let index = 0; index < result.length; index += 1) {
      if (index & mask) continue;
      const zero = result[index];
      const one = result[index | mask];
      result[index] = keep * zero + flip * one;
      result[index | mask] = flip * zero + keep * one;
    }
  }
  return result;
}

/** The estimated outcome distribution under the model in the module comment. */
export function estimateNoisyDistribution(
  ideal: Float64Array,
  qubitCount: number,
  tally: GateTally,
  rates: NoiseRates,
): Float64Array {
  const afterGates = mixWithUniform(ideal, idealWeight(tally, rates));
  return applyReadoutFlip(afterGates, Math.min(tally.measuredQubits, qubitCount), rates.readoutError ?? 0);
}

export function totalVariationDistance(left: Float64Array, right: Float64Array): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += Math.abs(left[index] - right[index]);
  return clamp01(sum / 2);
}

export type MissingFigure = "one_qubit" | "two_qubit" | "readout";

export type NoisyPreviewRow = { bitstring: string; idealShare: number; estimatedShare: number };

export type NoisyPreviewMachine = {
  machine: string;
  profile: QpuPublishedNoiseProfile;
  /** Total variation distance between the estimate and the ideal. */
  tvd: number;
  /** Total variation distance between the estimate and uniform random bits. */
  tvdToUniform: number;
  missing: MissingFigure[];
};

/**
 * - `ideal_near_uniform`: the ideal distribution is no farther from random bits
 *   than sampling alone would put a perfect device's result at this shot count,
 *   so no device could show much here.
 * - `closer_to_noise`: the estimate is at least as close to uniform random bits
 *   as to the ideal. Under the gate model alone this is exactly P <= 1/2; it is
 *   the point past which the result looks more like noise than like the answer.
 * - `ideal_stands_out`: otherwise.
 */
export type NoisyPreviewReading = "ideal_near_uniform" | "closer_to_noise" | "ideal_stands_out";

export type NoisyPreviewUnavailable =
  | "not_gate_model"
  | "no_figures"
  | "unparsable"
  | "qubit_limit"
  | "operation_limit";

export type NoisyPreview =
  | {
      status: "computed";
      qubitCount: number;
      shots: number;
      tally: GateTally;
      machineChosenAtSubmit: boolean;
      /** The machine with the largest expected distance. With one profile it
       * is that profile; with IBM's submit-time choice it is the least
       * favourable candidate, so the preview errs toward caution. */
      shown: NoisyPreviewMachine;
      machines: NoisyPreviewMachine[];
      tvdRange: { min: number; max: number };
      /** Distance of uniform random bits from the ideal. */
      uniformTvd: number;
      /** Expected distance of a perfect device's sample from the ideal at `shots`. */
      shotNoiseTvd: number;
      /** `shown.tvd / uniformTvd`: how far the estimate sits from the ideal
       * toward random bits, 0 at the ideal and 1 at uniform. Null when the
       * ideal is itself uniform and the ratio has no meaning. */
      shareTowardNoise: number | null;
      reading: NoisyPreviewReading;
      rows: NoisyPreviewRow[];
      otherIdealShare: number;
      otherEstimatedShare: number;
    }
  | { status: "unavailable"; reason: NoisyPreviewUnavailable };

const DEFAULT_MAX_ROWS = 6;
const UNIFORM_TOLERANCE = 1e-12;

/**
 * The half of a preview that depends only on the circuit: parse, gate tally,
 * and the ideal distribution. It is the expensive half (a full statevector
 * simulation, 870 ms for 20 qubits and ~400 gates measured in Node, against
 * 380 ms for all seven IBM profiles), while the device and the shot count
 * change far more often than the circuit, so a caller computes this once per
 * circuit and passes it to `previewPreparedRun` for each device.
 */
export type PreparedCircuit =
  | { status: "prepared"; qubitCount: number; tally: GateTally; ideal: Float64Array }
  | { status: "unavailable"; reason: "unparsable" | "qubit_limit" | "operation_limit" };

export function prepareCircuitForPreview(qasm: string, limits: ParseLimits): PreparedCircuit {
  const parsed = parseSubmittedCircuit(qasm, limits);
  if (parsed.status === "unavailable") return parsed;
  const { circuit } = parsed;
  const tally = tallyGates(circuit);
  if (!tally) return { status: "unavailable", reason: "unparsable" };
  try {
    return { status: "prepared", qubitCount: circuit.qubitCount, tally, ideal: idealProbabilities(circuit) };
  } catch {
    // The kernel throws on custom gates and angles outside its syntax. That
    // is "cannot estimate", never an estimate from a partial circuit.
    return { status: "unavailable", reason: "unparsable" };
  }
}

/**
 * The cache key for `prepareCircuitForPreview`: the program text and the two
 * limits the result depends on, by value. By value, not by object identity,
 * so a caller that rebuilds an equal limits object on every render still hits
 * the cache instead of simulating the circuit again.
 */
export function preparedCircuitKey(qasm: string, limits: ParseLimits): string {
  return `${limits.cpuSimQubits}:${limits.cpuSimOperations}:${qasm}`;
}

/**
 * A small least-recently-used cache of prepared circuits, so remounting the
 * hardware panel, or switching away from a gate device and back, does not
 * repeat the simulation. Bounded because each entry holds the whole ideal
 * distribution: 2^n doubles, 8 MB at the 20-qubit tier.
 */
export class PreparedCircuitCache {
  readonly #entries = new Map<string, PreparedCircuit>();
  readonly #maxEntries: number;
  readonly #prepare: (qasm: string, limits: ParseLimits) => PreparedCircuit;

  constructor(maxEntries: number, prepare: (qasm: string, limits: ParseLimits) => PreparedCircuit = prepareCircuitForPreview) {
    this.#maxEntries = Math.max(1, maxEntries);
    this.#prepare = prepare;
  }

  /** The cached result, or undefined. Cheap enough to call during render. */
  peek(qasm: string, limits: ParseLimits): PreparedCircuit | undefined {
    const key = preparedCircuitKey(qasm, limits);
    const hit = this.#entries.get(key);
    if (hit) {
      // Refresh recency: delete and re-insert moves the key to the end.
      this.#entries.delete(key);
      this.#entries.set(key, hit);
    }
    return hit;
  }

  /** The cached result, computing and storing it on a miss. The miss is the
   * expensive path, so callers keep it off the render path. */
  getOrPrepare(qasm: string, limits: ParseLimits): PreparedCircuit {
    const hit = this.peek(qasm, limits);
    if (hit) return hit;
    const prepared = this.#prepare(qasm, limits);
    this.#entries.set(preparedCircuitKey(qasm, limits), prepared);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return prepared;
  }
}

type PaintHost = {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: never) => void;
};

/**
 * Runs `task` in a macrotask after the next paint, and returns a function that
 * cancels it if it has not started. A requestAnimationFrame callback runs just
 * BEFORE the frame paints, so the timeout scheduled from inside it runs just
 * after. A bare setTimeout(0) can run before the browser paints at all, which
 * would put a placeholder on screen only after the work it was covering. Where
 * there is no requestAnimationFrame (a test runner), it falls back to the
 * timeout alone.
 *
 * A hidden tab does not fire animation frames, so the task waits until the tab
 * is shown. Nobody is looking at the placeholder in the meantime.
 */
export function scheduleAfterPaint(task: () => void, host: PaintHost = globalThis as unknown as PaintHost): () => void {
  let cancelled = false;
  let frame: number | null = null;
  let timer: unknown = null;
  const run = () => {
    if (!cancelled) task();
  };
  const queue = () => {
    frame = null;
    if (!cancelled) timer = host.setTimeout(run, 0);
  };
  if (typeof host.requestAnimationFrame === "function") frame = host.requestAnimationFrame(queue);
  else queue();
  return () => {
    cancelled = true;
    if (frame !== null) host.cancelAnimationFrame?.(frame);
    if (timer !== null) host.clearTimeout(timer as never);
  };
}

export function previewNoisyRun(input: {
  qasm: string;
  noise: QpuPublishedNoise;
  shots: number;
  limits: ParseLimits;
  maxRows?: number;
}): NoisyPreview {
  const { qasm, noise, shots, limits, maxRows } = input;
  if (!noise.gate_model) return { status: "unavailable", reason: "not_gate_model" };
  return previewPreparedRun({ prepared: prepareCircuitForPreview(qasm, limits), noise, shots, maxRows });
}

export function previewPreparedRun(input: {
  prepared: PreparedCircuit;
  noise: QpuPublishedNoise;
  shots: number;
  maxRows?: number;
}): NoisyPreview {
  const { prepared, noise, shots, maxRows } = input;
  return finishPreview(estimateDevice({ prepared, noise, maxRows }), shots);
}

/**
 * Everything in a preview except the shot count: each machine's estimate,
 * the range, and the rows. Split from `finishPreview` because it is the
 * device half's heavy part (a readout pass of n x 2^n per machine, about
 * 27 ms per machine at 20 qubits), and typing a shot count should not
 * repeat it.
 */
export type DeviceEstimate =
  | (Omit<Extract<NoisyPreview, { status: "computed" }>, "shots" | "shotNoiseTvd" | "reading"> & {
      status: "computed";
      ideal: Float64Array;
    })
  | { status: "unavailable"; reason: NoisyPreviewUnavailable };

export function estimateDevice(input: {
  prepared: PreparedCircuit;
  noise: QpuPublishedNoise;
  maxRows?: number;
}): DeviceEstimate {
  const { prepared, noise, maxRows = DEFAULT_MAX_ROWS } = input;
  if (!noise.gate_model) return { status: "unavailable", reason: "not_gate_model" };
  const profiles = noise.profiles.filter(hasAnyFigure);
  if (profiles.length === 0) return { status: "unavailable", reason: "no_figures" };
  if (prepared.status === "unavailable") return prepared;
  const { qubitCount, tally, ideal } = prepared;

  const uniform = new Float64Array(ideal.length).fill(1 / ideal.length);
  const uniformTvd = totalVariationDistance(ideal, uniform);
  const estimates = new Map<NoisyPreviewMachine, Float64Array>();
  const machines = profiles.map((profile) => {
    const estimate = estimateNoisyDistribution(ideal, qubitCount, tally, ratesOf(profile));
    const machine: NoisyPreviewMachine = {
      machine: profile.machine,
      profile,
      tvd: totalVariationDistance(estimate, ideal),
      tvdToUniform: totalVariationDistance(estimate, uniform),
      missing: missingFigures(profile),
    };
    estimates.set(machine, estimate);
    return machine;
  });

  const shown = machines.reduce((worst, machine) => (machine.tvd > worst.tvd ? machine : worst), machines[0]);
  const tvds = machines.map((machine) => machine.tvd);
  const { rows, otherIdealShare, otherEstimatedShare } = topRows(ideal, estimates.get(shown)!, qubitCount, maxRows);

  return {
    status: "computed",
    ideal,
    qubitCount,
    tally,
    machineChosenAtSubmit: noise.machine_chosen_at_submit,
    shown,
    machines,
    tvdRange: { min: Math.min(...tvds), max: Math.max(...tvds) },
    uniformTvd,
    // Not `> 0`: a uniform ideal comes out of the kernel as 1/2^n plus rounding,
    // and dividing by that rounding would report "all the way to noise".
    shareTowardNoise: uniformTvd > UNIFORM_TOLERANCE ? clamp01(shown.tvd / uniformTvd) : null,
    rows,
    otherIdealShare,
    otherEstimatedShare,
  };
}

/** The shot-dependent rest: sampling noise alone at `shots`, and the reading
 * it decides. One pass over the ideal distribution. */
export function finishPreview(device: DeviceEstimate, shots: number): NoisyPreview {
  if (device.status === "unavailable") return device;
  const { ideal, ...rest } = device;
  const shotNoiseTvd = expectedShotNoiseTvd(ideal, shots);
  const reading: NoisyPreviewReading = device.uniformTvd <= shotNoiseTvd
    ? "ideal_near_uniform"
    : device.shown.tvdToUniform <= device.shown.tvd
      ? "closer_to_noise"
      : "ideal_stands_out";
  return { ...rest, status: "computed", shots, shotNoiseTvd, reading };
}

function hasAnyFigure(profile: QpuPublishedNoiseProfile): boolean {
  return Boolean(profile.one_qubit_gate_error || profile.two_qubit_gate_error || profile.readout_error);
}

function valueOf(figure: QpuPublishedErrorFigure | null | undefined): number | null {
  return figure && Number.isFinite(figure.value) ? figure.value : null;
}

function ratesOf(profile: QpuPublishedNoiseProfile): NoiseRates {
  return {
    oneQubitGateError: valueOf(profile.one_qubit_gate_error),
    twoQubitGateError: valueOf(profile.two_qubit_gate_error),
    readoutError: valueOf(profile.readout_error),
  };
}

function missingFigures(profile: QpuPublishedNoiseProfile): MissingFigure[] {
  const missing: MissingFigure[] = [];
  if (valueOf(profile.one_qubit_gate_error) === null) missing.push("one_qubit");
  if (valueOf(profile.two_qubit_gate_error) === null) missing.push("two_qubit");
  if (valueOf(profile.readout_error) === null) missing.push("readout");
  return missing;
}

/**
 * The outcomes that matter in either distribution: the top `maxRows` of the
 * ideal and of the estimate, merged and ordered by the larger of the two
 * shares. Selected in one pass rather than by sorting all 2^n entries, since
 * at the 20-qubit tier that sort is a million elements for six rows.
 */
function topRows(
  ideal: Float64Array,
  estimate: Float64Array,
  qubitCount: number,
  maxRows: number,
): { rows: NoisyPreviewRow[]; otherIdealShare: number; otherEstimatedShare: number } {
  const candidates = new Set<number>([...topIndices(ideal, maxRows), ...topIndices(estimate, maxRows)]);
  const rows = Array.from(candidates, (index) => ({
    index,
    bitstring: bitstringFor(index, qubitCount),
    idealShare: ideal[index],
    estimatedShare: estimate[index],
  }))
    .sort((left, right) =>
      Math.max(right.idealShare, right.estimatedShare) - Math.max(left.idealShare, left.estimatedShare)
      || left.index - right.index)
    .slice(0, maxRows)
    .map(({ bitstring, idealShare, estimatedShare }) => ({ bitstring, idealShare, estimatedShare }));
  const shownIdeal = rows.reduce((sum, row) => sum + row.idealShare, 0);
  const shownEstimate = rows.reduce((sum, row) => sum + row.estimatedShare, 0);
  return { rows, otherIdealShare: clamp01(1 - shownIdeal), otherEstimatedShare: clamp01(1 - shownEstimate) };
}

function topIndices(distribution: Float64Array, count: number): number[] {
  const top: number[] = [];
  for (let index = 0; index < distribution.length; index += 1) {
    const value = distribution[index];
    if (top.length === count && value <= distribution[top[top.length - 1]]) continue;
    let position = top.length;
    while (position > 0 && distribution[top[position - 1]] < value) position -= 1;
    top.splice(position, 0, index);
    if (top.length > count) top.pop();
  }
  return top;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
