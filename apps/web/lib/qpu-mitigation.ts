import { compareMeasuredToIdealWithIdeal, type IdealComparison, type IdealComparisonInput } from "./qpu-ideal.ts";

/**
 * Readout correction and zero-noise extrapolation of a hardware run, computed in
 * this browser from what the run record stores (proposal 5, increment 4).
 *
 * The owner's ruling on ai-ops 361: write both techniques directly, and use
 * Mitiq only in tests. So nothing here imports Mitiq; the numbers are held
 * to Mitiq's by `qpu-mitigation.test.ts`, which reads the fixture
 * `packages/py/qpu/tests/fixtures/mitigation-parity.json` that
 * `scripts/mitiq_parity.py` generated from Mitiq 1.1.0, and to the Python twin
 * in `majorana_qpu.mitigation` through the same file.
 *
 * Both are post-processing. They never replace `raw_counts`: the panel shows the
 * raw reading, and these beside it, so a reader can always see what the device
 * actually returned.
 *
 * ## Bit order
 *
 * Counts keys follow Qiskit: classical bit 0 is the RIGHTMOST character, so
 * `parseInt(key, 2)` puts bit `i` at bit `i` of the index. That is the same
 * index `qpu-ideal.ts` uses for the ideal distribution (see its bit-order note),
 * and every dense vector below is indexed that way.
 */

/** The `qpu_runs.mitigation` version this reader understands (migration 0066). */
export const MITIGATION_RECORD_VERSION = 1;

/**
 * The noise scale factors a zero-noise-extrapolation run is sent at, in PUB
 * order: the circuit, then copies folded to 3x and 5x its gates. Mirrors
 * `majorana_qpu.mitigation.ZNE_SCALE_FACTORS`; the cost disclosure is computed
 * from it before the user opts in, so it must say what the worker will send.
 */
export const ZNE_SCALE_FACTORS = [1, 3, 5] as const;

/** One measured bit's readout errors, as the worker stored them. */
export type ReadoutBit = {
  clbit: number;
  /** The physical qubit the bit was read from; null if the document omitted it. */
  qubit: number | null;
  /** P(read 1 | prepared 0). */
  prob_meas1_prep0: number;
  /** P(read 0 | prepared 1). */
  prob_meas0_prep1: number;
  /** `backend_properties` (asymmetric) or `target_measure_error` (one figure for both). */
  source: string | null;
};

export type MitigationDocument = {
  readout: { calibratedAt: string | null; bits: ReadoutBit[] } | null;
  zne: {
    scaleFactors: number[];
    twoQubitGates: number[] | null;
    /** Folded circuits' counts by scale factor; scale 1 is the run's `raw_counts`. */
    counts: Record<string, Record<string, number>> | null;
    error: string | null;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function probability(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function countsOf(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([, count]) => !Number.isInteger(count) || (count as number) < 0)) return null;
  return value as Record<string, number>;
}

/**
 * The stored document, read defensively, or null if there is none or it is a
 * version this code does not know. An unknown version is refused rather than
 * read as the one it resembles: a field that changed meaning would otherwise
 * produce a confident, wrong correction.
 */
export function readMitigation(value: unknown): MitigationDocument | null {
  if (!isRecord(value) || value.version !== MITIGATION_RECORD_VERSION) return null;
  let readout: MitigationDocument["readout"] = null;
  if (isRecord(value.readout) && Array.isArray(value.readout.bits)) {
    const bits: ReadoutBit[] = [];
    let usable = true;
    for (const bit of value.readout.bits) {
      const p10 = isRecord(bit) ? probability(bit.prob_meas1_prep0) : null;
      const p01 = isRecord(bit) ? probability(bit.prob_meas0_prep1) : null;
      if (!isRecord(bit) || !Number.isInteger(bit.clbit) || p10 === null || p01 === null) {
        usable = false;
        break;
      }
      bits.push({
        clbit: bit.clbit as number,
        qubit: Number.isInteger(bit.qubit) ? (bit.qubit as number) : null,
        prob_meas1_prep0: p10,
        prob_meas0_prep1: p01,
        source: typeof bit.source === "string" ? bit.source : null,
      });
    }
    if (usable) {
      readout = {
        calibratedAt: typeof value.readout.calibrated_at === "string" ? value.readout.calibrated_at : null,
        bits,
      };
    }
  }
  let zne: MitigationDocument["zne"] = null;
  if (isRecord(value.zne)) {
    const scaleFactors = Array.isArray(value.zne.scale_factors)
      ? value.zne.scale_factors.filter((scale): scale is number => typeof scale === "number")
      : [];
    const twoQubitGates = Array.isArray(value.zne.two_qubit_gates)
      && value.zne.two_qubit_gates.every((count) => Number.isInteger(count))
      ? (value.zne.two_qubit_gates as number[])
      : null;
    let counts: Record<string, Record<string, number>> | null = null;
    if (isRecord(value.zne.counts)) {
      const parsed: Record<string, Record<string, number>> = {};
      for (const [scale, scaleCounts] of Object.entries(value.zne.counts)) {
        const valid = countsOf(scaleCounts);
        if (valid) parsed[scale] = valid;
      }
      counts = parsed;
    }
    zne = {
      scaleFactors,
      twoQubitGates,
      counts,
      error: typeof value.zne.error === "string" ? value.zne.error : null,
    };
  }
  return { readout, zne };
}

// ---------------------------------------------------------------------------
// The arithmetic (the same, in the same order, as majorana_qpu.mitigation)
// ---------------------------------------------------------------------------

function denseDistribution(counts: Record<string, number>, width: number): Float64Array {
  const shots = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (shots <= 0) throw new RangeError("counts are empty");
  const shape = new RegExp(`^[01]{${width}}$`);
  const vector = new Float64Array(2 ** width);
  for (const [key, count] of Object.entries(counts)) {
    if (!shape.test(key)) throw new RangeError(`counts key ${key} is not a ${width}-bit string`);
    vector[Number.parseInt(key, 2)] += count / shots;
  }
  return vector;
}

/**
 * The measured distribution with the tensor product of per-qubit inverse
 * confusion matrices applied: a quasi-distribution that can have negative
 * entries and still sums to 1.
 *
 * Applied one bit at a time. The inverse of a tensor product is the tensor
 * product of the inverses, so this is the same map as inverting the full
 * 2^n x 2^n matrix, at n * 2^n cost instead of 4^n.
 *
 * Each qubit's confusion matrix is A = [[1 - p(1|0), p(0|1)], [p(1|0), 1 - p(0|1)]]
 * (columns prepared, rows read). Refuses error rates of 0.5 or more: a qubit
 * that reads wrong as often as right has no correction worth making.
 */
export function readoutCorrectedQuasi(
  counts: Record<string, number>,
  bits: readonly Pick<ReadoutBit, "clbit" | "prob_meas1_prep0" | "prob_meas0_prep1">[],
): Float64Array {
  const width = bits.length;
  const vector = denseDistribution(counts, width);
  for (const bit of bits) {
    const p10 = bit.prob_meas1_prep0;
    const p01 = bit.prob_meas0_prep1;
    if (!(p10 >= 0 && p10 < 0.5 && p01 >= 0 && p01 < 0.5)) throw new RangeError("readout error rates must be in [0, 0.5)");
    const det = 1 - p10 - p01;
    const m00 = (1 - p01) / det;
    const m01 = -p01 / det;
    const m10 = -p10 / det;
    const m11 = (1 - p10) / det;
    const stride = 2 ** bit.clbit;
    for (let index = 0; index < vector.length; index += 1) {
      if (Math.floor(index / stride) % 2 === 1) continue;
      const zero = vector[index];
      const one = vector[index + stride];
      vector[index] = m00 * zero + m01 * one;
      vector[index + stride] = m10 * zero + m11 * one;
    }
  }
  return vector;
}

/**
 * The probability distribution closest to `quasi` in Euclidean distance.
 *
 * Smolin, Gambetta and Smith, "Efficient method for computing the
 * maximum-likelihood quantum state from measurements with additive Gaussian
 * noise", Phys. Rev. Lett. 108, 070502 (2012), Fig. 1: sort descending, walk up
 * from the smallest entry zeroing each one whose value plus its share of the
 * mass removed so far is still negative, then spread the removed mass equally
 * over what is left. For an input summing to 1 it is the exact projection onto
 * the probability simplex. Mitiq's `closest_positive_distribution` minimises the
 * same distance numerically, and the test measures how far apart they land.
 */
export function closestProbabilityDistribution(quasi: ArrayLike<number>): Float64Array {
  const size = quasi.length;
  // Stable descending sort by value, ties by index, matching Python's sorted().
  const order = Array.from({ length: size }, (_, index) => index).sort(
    (left, right) => quasi[right] - quasi[left] || left - right,
  );
  const result = new Float64Array(size);
  let removed = 0;
  let remaining = size;
  while (remaining > 0 && quasi[order[remaining - 1]] + removed / remaining < 0) {
    removed += quasi[order[remaining - 1]];
    remaining -= 1;
  }
  for (let position = 0; position < remaining; position += 1) {
    result[order[position]] = quasi[order[position]] + removed / remaining;
  }
  return result;
}

/**
 * Richardson extrapolation to zero noise: the polynomial through every point,
 * evaluated at 0 (Lagrange form). For scales 1, 3, 5 the weights are 15/8, -5/4
 * and 3/8, which is why it can overshoot: noise in the scale-1 value is
 * multiplied by nearly two.
 */
export function richardsonZeroNoise(scales: readonly number[], values: readonly number[]): number {
  if (scales.length !== values.length || scales.length < 2) throw new RangeError("richardson needs matching scales and values");
  let total = 0;
  for (let i = 0; i < scales.length; i += 1) {
    let weight = 1;
    for (let j = 0; j < scales.length; j += 1) {
      if (j !== i) weight *= scales[j] / (scales[j] - scales[i]);
    }
    total += weight * values[i];
  }
  return total;
}

/** The intercept of the least-squares straight line through the points. */
export function linearZeroNoise(scales: readonly number[], values: readonly number[]): number {
  if (scales.length !== values.length || scales.length < 2) throw new RangeError("a linear fit needs matching scales and values");
  const count = scales.length;
  const meanScale = scales.reduce((sum, scale) => sum + scale, 0) / count;
  const meanValue = values.reduce((sum, value) => sum + value, 0) / count;
  let spread = 0;
  let covariance = 0;
  for (let i = 0; i < count; i += 1) {
    spread += (scales[i] - meanScale) ** 2;
    covariance += (scales[i] - meanScale) * (values[i] - meanValue);
  }
  return meanValue - (covariance / spread) * meanScale;
}

export type ExtrapolationMethod = "richardson" | "linear";

/**
 * Each outcome's probability extrapolated to zero noise, clipped at 0 and
 * renormalised. `clippedMass` is the probability the fit put below zero before
 * clipping: nonzero means the extrapolation overshot, and the panel says so.
 */
export function extrapolateDistribution(
  countsByScale: readonly (readonly [number, Record<string, number>])[],
  method: ExtrapolationMethod,
): { distribution: Record<string, number>; clippedMass: number } {
  const extrapolate = method === "richardson" ? richardsonZeroNoise : linearZeroNoise;
  const scales = countsByScale.map(([scale]) => scale);
  const shares = countsByScale.map(([, counts]) => {
    const shots = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (shots <= 0) throw new RangeError("a scale has no counts");
    return new Map(Object.entries(counts).map(([key, count]) => [key, count / shots]));
  });
  const outcomes = [...new Set(shares.flatMap((share) => [...share.keys()]))].sort();
  const raw = new Map(outcomes.map((key) => [key, extrapolate(scales, shares.map((share) => share.get(key) ?? 0))]));
  let clippedMass = 0;
  let total = 0;
  for (const value of raw.values()) {
    if (value < 0) clippedMass -= value;
    else total += value;
  }
  if (total <= 0) throw new RangeError("the extrapolation left no probability to renormalise");
  const distribution: Record<string, number> = {};
  for (const [key, value] of raw) distribution[key] = Math.max(value, 0) / total;
  return { distribution, clippedMass };
}

// ---------------------------------------------------------------------------
// Readings for the panel
// ---------------------------------------------------------------------------

export type MitigationUnavailable =
  /** Recorded before calibration snapshots existed, or the backend reported none. */
  | "no_calibration"
  /** The snapshot does not cover exactly the bits the counts have. */
  | "calibration_mismatch"
  /** A reported error rate of 0.5 or more on some qubit. */
  | "calibration_unusable"
  /** ZNE was requested but the folded circuits' counts did not come back. */
  | "zne_no_counts";

export type DistanceReading = {
  tvd: number;
  hellingerFidelity: number;
  /**
   * The mitigated share of each outcome the comparison table shows, keyed by
   * bitstring, and the share of everything else. Only these, never the dense
   * distribution: that is 2^n doubles (8 MB at 20 qubits), the table needs a
   * handful of them, and a reading is a value the hardware-runs page keeps one
   * of per run after it crosses from the simulator worker.
   */
  shares: Record<string, number>;
  otherShare: number;
};

export type ZneReading = {
  richardson: DistanceReading & { clippedMass: number };
  linear: DistanceReading & { clippedMass: number };
  twoQubitGates: number[] | null;
};

export type MitigatedReadings = {
  readout: { status: "computed"; reading: DistanceReading; calibratedAt: string | null; symmetric: boolean } | { status: "unavailable"; reason: MitigationUnavailable };
  /** Null when the run did not ask for ZNE. */
  zne: { status: "computed"; reading: ZneReading } | { status: "unavailable"; reason: MitigationUnavailable } | null;
};

function distanceTo(ideal: Float64Array, distribution: ArrayLike<number>, rows: readonly string[]): DistanceReading {
  let absolute = 0;
  let overlap = 0;
  for (let index = 0; index < ideal.length; index += 1) {
    absolute += Math.abs(distribution[index] - ideal[index]);
    overlap += Math.sqrt(Math.max(distribution[index], 0) * ideal[index]);
  }
  const shares: Record<string, number> = {};
  let shown = 0;
  for (const bitstring of rows) {
    const share = distribution[Number.parseInt(bitstring, 2)] ?? 0;
    shares[bitstring] = share;
    shown += share;
  }
  return { tvd: clamp01(0.5 * absolute), hellingerFidelity: clamp01(overlap ** 2), shares, otherShare: clamp01(1 - shown) };
}

function denseFromShares(shares: Record<string, number>, width: number): Float64Array {
  const vector = new Float64Array(2 ** width);
  for (const [key, share] of Object.entries(shares)) vector[Number.parseInt(key, 2)] = share;
  return vector;
}

/**
 * The mitigated readings for one finished run, measured against the ideal that
 * the comparison was measured against (so the circuit is only simulated once,
 * and every refusal the comparison makes still applies). Run it through
 * `compareAndMitigate`, which is how both pages get it: in the simulator
 * worker, in the same job as the comparison.
 *
 * Not cheap at the tier ceiling. Measured in Node on the Mac the simulator's
 * budgets were fitted on, 3 runs at 20 qubits: 430 to 499 ms per call, of which
 * the readout correction (about 55 ms) and its projection's sort (about 176 ms)
 * are most. That is why it runs in the worker and not in a page callback.
 *
 * `qubitCount` is the width of the counted register, which the comparison has
 * checked every counts key against; `rows` are the bitstrings its table shows.
 */
export function mitigatedReadings(input: {
  ideal: Float64Array;
  qubitCount: number;
  rawCounts: Record<string, number>;
  mitigation: unknown;
  rows: readonly string[];
}): MitigatedReadings {
  const { ideal, qubitCount, rawCounts, rows } = input;
  const document = readMitigation(input.mitigation);
  const shape = new RegExp(`^[01]{${qubitCount}}$`);

  let readout: MitigatedReadings["readout"];
  const bits = document?.readout?.bits ?? null;
  if (!bits) {
    readout = { status: "unavailable", reason: "no_calibration" };
  } else if (
    bits.length !== qubitCount
    || [...bits].map((bit) => bit.clbit).sort((a, b) => a - b).some((clbit, index) => clbit !== index)
  ) {
    readout = { status: "unavailable", reason: "calibration_mismatch" };
  } else if (bits.some((bit) => bit.prob_meas1_prep0 >= 0.5 || bit.prob_meas0_prep1 >= 0.5)) {
    readout = { status: "unavailable", reason: "calibration_unusable" };
  } else {
    const corrected = closestProbabilityDistribution(readoutCorrectedQuasi(rawCounts, bits));
    readout = {
      status: "computed",
      reading: distanceTo(ideal, corrected, rows),
      calibratedAt: document?.readout?.calibratedAt ?? null,
      symmetric: bits.some((bit) => bit.source === "target_measure_error"),
    };
  }

  let zne: MitigatedReadings["zne"] = null;
  if (document?.zne) {
    const three = document.zne.counts?.["3"];
    const five = document.zne.counts?.["5"];
    const widthMatches = (counts: Record<string, number> | undefined) => Boolean(counts && Object.keys(counts).every((key) => shape.test(key)));
    if (!widthMatches(three) || !widthMatches(five)) {
      zne = { status: "unavailable", reason: "zne_no_counts" };
    } else {
      const byScale = [[1, rawCounts], [3, three!], [5, five!]] as const;
      const richardson = extrapolateDistribution(byScale, "richardson");
      const linear = extrapolateDistribution(byScale, "linear");
      zne = {
        status: "computed",
        reading: {
          richardson: { ...distanceTo(ideal, denseFromShares(richardson.distribution, qubitCount), rows), clippedMass: richardson.clippedMass },
          linear: { ...distanceTo(ideal, denseFromShares(linear.distribution, qubitCount), rows), clippedMass: linear.clippedMass },
          twoQubitGates: document.zne.twoQubitGates,
        },
      };
    }
  }
  return { readout, zne };
}

/**
 * The measured-against-ideal comparison and, when it was computed, the
 * mitigated readings beside it, from one simulation. This is the simulator
 * worker's `compare_mitigated` job (simulator-protocol.ts).
 *
 * `readings` is null exactly when the comparison is unavailable: a correction
 * has nothing to be measured against without the ideal, and the panel says why
 * the comparison is missing instead.
 */
export function compareAndMitigate(input: IdealComparisonInput & { mitigation: unknown }): {
  comparison: IdealComparison;
  readings: MitigatedReadings | null;
} {
  const { mitigation, ...compare } = input;
  const { comparison, ideal } = compareMeasuredToIdealWithIdeal(compare);
  if (comparison.status !== "computed" || !ideal || !compare.counts) return { comparison, readings: null };
  const readings = mitigatedReadings({
    ideal,
    qubitCount: comparison.qubitCount,
    rawCounts: compare.counts,
    mitigation,
    rows: comparison.rows.map((row) => row.bitstring),
  });
  return { comparison, readings };
}

/** Whether the run asked for zero-noise extrapolation. */
export function zneRequested(mitigation: unknown): boolean {
  return readMitigation(mitigation)?.zne != null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
