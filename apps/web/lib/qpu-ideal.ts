import { allCircuitConversionResults, parseCircuitSource } from "./circuit-conversion.ts";
import { bitstringFor, idealProbabilities } from "./statevector-kernel.ts";
import { MAX_PARSABLE_QUBITS, parseBuilderCircuit, type ParsedBuilderCircuit } from "./studio-parse.ts";
import { sourceFingerprint, type CpuSimulationLimits, type CpuSimulationModel } from "./studio-simulation.ts";

/**
 * "Measured against ideal": a comparison, computed entirely in this browser,
 * between a hardware (IBM QPU) job's raw counts and the outcome distribution
 * the exact circuit that was submitted would produce on a perfect, noiseless
 * device.
 *
 * This never asks a server to execute anything. The ideal distribution is a
 * pure, deterministic function of the submitted OpenQASM 3 source — the same
 * bounded parser and statevector kernel Studio's browser CPU lane already
 * uses (`studio-parse.ts`, `statevector-kernel.ts`) reconstruct the circuit
 * and diagonalize it here, in the viewer's own tab. Nothing about a user's
 * circuit is sent anywhere new, and nothing here re-runs or verifies the
 * hardware job: it is a local, best-effort readout, not a verification
 * verdict (see the `otherIdealShare`/provenance note the UI renders beside
 * it).
 *
 * ## The bit-order argument (rule 6 below)
 *
 * `idealProbabilities` indexes its output the same way `statevector-kernel.ts`
 * documents: basis index `i` is qubit 0 at bit 0 of `i`, qubit 1 at bit 1, and
 * so on, and `bitstringFor(i, n)` prints that index with qubit `n-1` as the
 * LEFTMOST character and qubit 0 as the RIGHTMOST. IBM's `SamplerV2.get_counts()`
 * keys follow the same convention Qiskit has always used for a classical
 * register: bit 0 rightmost, highest bit leftmost. Both parse paths below
 * (see `hasCanonicalWholeRegisterMeasurement`'s doc comment for why the
 * decomposition path needs its own check) only ever accept a measurement that
 * assigns qubit `i` to classical bit `i` for every qubit — a whole-register,
 * unpermuted measurement. Under that assignment, reading a counts key as a
 * plain binary number, `parseInt(key, 2)`, lands on exactly the same integer
 * as the basis index `idealProbabilities` used for that outcome. No key needs
 * to be rebuilt or reversed; the two conventions already agree.
 */

export type IdealComparisonUnavailable =
  | "circuit_changed"
  | "no_counts"
  | "unparsable"
  | "qubit_limit"
  | "operation_limit"
  | "register_mismatch"
  /** The simulator worker did not answer within the job's time budget
   * (simulator-client.ts), so it was stopped rather than left to stall the page. */
  | "timed_out";

export type IdealComparisonRow = {
  bitstring: string;
  measuredCount: number;
  measuredShare: number;
  idealShare: number;
};

export type IdealComparison =
  | {
      status: "computed";
      qubitCount: number;
      shots: number;
      model: CpuSimulationModel;
      tvd: number;
      hellingerFidelity: number;
      shotNoiseTvd: number;
      rows: IdealComparisonRow[];
      otherMeasuredShare: number;
      otherIdealShare: number;
    }
  | { status: "unavailable"; reason: IdealComparisonUnavailable };

const DEFAULT_MAX_ROWS = 8;

export type IdealComparisonInput = {
  qasm: string;
  submittedFingerprint: string;
  counts: Record<string, number> | null;
  limits: CpuSimulationLimits;
  maxRows?: number;
};

export function compareMeasuredToIdeal(input: IdealComparisonInput): IdealComparison {
  return compareMeasuredToIdealWithIdeal(input).comparison;
}

/**
 * The comparison, and the ideal distribution it was measured against (null
 * when no comparison was computed).
 *
 * Kept out of `IdealComparison` on purpose. The distribution is 2^n doubles,
 * 8 MB at the 20-qubit tier, and a comparison is a value pages keep: the
 * hardware-runs page holds one per run it lists, and each crosses from the
 * simulator worker by structured clone. Only the mitigated readings need the
 * vector (qpu-mitigation.ts), and they are computed beside the comparison in
 * the same worker job, so the vector never has to leave it.
 */
export function compareMeasuredToIdealWithIdeal(input: IdealComparisonInput): {
  comparison: IdealComparison;
  ideal: Float64Array | null;
} {
  const { qasm, submittedFingerprint, counts, limits, maxRows = DEFAULT_MAX_ROWS } = input;
  const unavailable = (comparison: IdealComparison) => ({ comparison, ideal: null });

  // Rule 1: the circuit shown must be the circuit that was submitted. A
  // circuit edited in the Studio after submission is a different source, and
  // comparing against ITS ideal distribution would silently mislabel a
  // hardware result that has nothing to do with what is now on screen.
  if (sourceFingerprint(qasm) !== submittedFingerprint) {
    return unavailable({ status: "unavailable", reason: "circuit_changed" });
  }

  // Rule 2.
  if (!counts) return unavailable({ status: "unavailable", reason: "no_counts" });
  const entries = Object.entries(counts);
  if (entries.length === 0) return unavailable({ status: "unavailable", reason: "no_counts" });
  if (entries.some(([, count]) => !Number.isInteger(count) || count < 0)) {
    return unavailable({ status: "unavailable", reason: "register_mismatch" });
  }
  const shots = entries.reduce((sum, [, count]) => sum + count, 0);
  if (shots <= 0) return unavailable({ status: "unavailable", reason: "no_counts" });

  // Rules 3 and 4, shared with the pre-submit noise estimate (qpu-noise.ts)
  // so both panels read a circuit through exactly one parse path.
  const parsed = parseSubmittedCircuit(qasm, limits);
  if (parsed.status === "unavailable") return unavailable(parsed);
  const { circuit, model } = parsed;

  // Rule 5: fail closed rather than pad or truncate a malformed key.
  const registerShape = new RegExp(`^[01]{${circuit.qubitCount}}$`);
  if (!entries.every(([bitstring]) => registerShape.test(bitstring))) {
    return unavailable({ status: "unavailable", reason: "register_mismatch" });
  }

  // Rule 6.
  const ideal = idealProbabilities(circuit);

  // Rule 7.
  let observedIdealMass = 0;
  let absoluteDifferenceSum = 0;
  let hellingerSum = 0;
  for (const [bitstring, count] of entries) {
    const index = Number.parseInt(bitstring, 2);
    const idealShare = ideal[index] ?? 0;
    const measuredShare = count / shots;
    observedIdealMass += idealShare;
    absoluteDifferenceSum += Math.abs(measuredShare - idealShare);
    hellingerSum += Math.sqrt(measuredShare * idealShare);
  }
  const tvd = clamp01(0.5 * (absoluteDifferenceSum + (1 - observedIdealMass)));
  const hellingerFidelity = clamp01(hellingerSum ** 2);

  // Rule 8.
  const shotNoiseTvd = expectedShotNoiseTvd(ideal, shots);

  // Rule 9.
  const { rows, otherMeasuredShare, otherIdealShare } = buildRows(ideal, entries, circuit.qubitCount, shots, maxRows);

  return {
    comparison: {
      status: "computed",
      qubitCount: circuit.qubitCount,
      shots,
      model,
      tvd,
      hellingerFidelity,
      shotNoiseTvd,
      rows,
      otherMeasuredShare,
      otherIdealShare,
    },
    ideal,
  };
}

export type ParsedSubmission =
  | { status: "parsed"; circuit: ParsedBuilderCircuit; model: CpuSimulationModel }
  | { status: "unavailable"; reason: "unparsable" | "qubit_limit" | "operation_limit" };

/**
 * Rules 3 and 4 of `compareMeasuredToIdeal`: reconstruct the submitted
 * OpenQASM 3 circuit through the same parse path the browser CPU lane uses,
 * require a canonical whole-register measurement, and hold it to the viewer's
 * tier limits. Exported so the pre-submit noise estimate (qpu-noise.ts) reads
 * a circuit exactly the way this comparison later will, and a circuit the one
 * refuses is never one the other accepts.
 */
/** The two tier limits the parse step enforces. Narrower than
 * `CpuSimulationLimits` so a caller can key a cache on exactly what the
 * result depends on (qpu-noise.ts's `preparedCircuitKey`). */
export type ParseLimits = Pick<CpuSimulationLimits, "cpuSimQubits" | "cpuSimOperations">;

export function parseSubmittedCircuit(qasm: string, limits: ParseLimits): ParsedSubmission {
  // Rule 3: parse like `cpuSimulationEligibility` (studio-simulation.ts) does
  // — strict direct parse first, then the decomposition path.
  const direct = parseBuilderCircuit(qasm, "openqasm3", MAX_PARSABLE_QUBITS);
  let circuit: ParsedBuilderCircuit | null;
  let model: CpuSimulationModel;
  if (direct) {
    // The strict OpenQASM 3 grammar (`parseOpenQasm3` in studio-parse.ts)
    // only ever recognizes a literal `c = measure q;` whole-register
    // statement, with `bit[n] c;` required to match `qubit[n] q;` exactly —
    // there is no indexed or partial form in its grammar at all. A circuit
    // that parses here is canonical by construction; no extra check needed.
    circuit = direct;
    model = "direct_source";
  } else {
    const decomposed = allCircuitConversionResults(qasm, "openqasm3", qasm).qiskit;
    const viaDecomposition = decomposed ? parseCircuitSource(decomposed.code, "qiskit", MAX_PARSABLE_QUBITS) : null;
    circuit = viaDecomposition && hasCanonicalWholeRegisterMeasurement(qasm, viaDecomposition.qubitCount)
      ? viaDecomposition
      : null;
    model = "openqasm_standard_decomposition";
  }
  if (!circuit || !circuit.steps.some((step) => step.gate === "M")) {
    return { status: "unavailable", reason: "unparsable" };
  }

  // Rule 4.
  if (circuit.qubitCount > limits.cpuSimQubits) return { status: "unavailable", reason: "qubit_limit" };
  if (circuit.steps.length > limits.cpuSimOperations) return { status: "unavailable", reason: "operation_limit" };

  return { status: "parsed", circuit, model };
}

/**
 * Whether `qasm`'s own measurement statement(s) assign qubit `i` to classical
 * bit `i` for every qubit, covering the whole register exactly once — read
 * directly from the source text, before the decomposition path below
 * (`allCircuitConversionResults` → `generateBuilderCode` → re-parse) can
 * collapse the question away.
 *
 * That round trip's Qiskit target can only emit two shapes: nothing (no
 * measurement) or `qc.measure_all()` (every qubit, ascending) — see
 * `generateBuilderCode`'s `measured = steps.some((step) => step.gate === "M")`
 * flag in studio-builder.ts, which does not look at WHICH qubits carried an
 * `M` step, only whether at least one did. So a partial measurement
 * (`meas[0] = measure q[0];` alone, on a two-qubit circuit) or a permuted one
 * (`meas[0] = measure q[1]; meas[1] = measure q[0];`) comes back out of
 * `parseCircuitSource(decomposed.code, "qiskit", …)` looking identical to a
 * genuine whole-register measurement — silently. This is not a hypothetical:
 * circuit-conversion.ts's own comment on `parseOpenQasm3StandardGates`
 * documents that Qiskit's real qasm3 exporter writes exactly this per-qubit,
 * occasionally-permuted shape for an actually-imported circuit. A permuted
 * source that is fully measured would otherwise compare every observed count
 * against the wrong basis state without any downstream check catching it
 * (the register-width check in rule 5 above only catches a PARTIAL one, when
 * the hardware's own counts happen to be narrower than the full register).
 *
 * Refuses (returns false) on anything not positively recognized as this exact
 * canonical shape, including a measurement form this function does not
 * parse — failing closed rather than assuming an unrecognized shape is safe.
 */
function hasCanonicalWholeRegisterMeasurement(qasm: string, qubitCount: number): boolean {
  const lines = qasm
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
  const assign = /^([A-Za-z_]\w*)(?:\[(\d+)\])?\s*=\s*measure\s+([A-Za-z_]\w*)(?:\[(\d+)\])?\s*;$/i;
  const arrow = /^measure\s+([A-Za-z_]\w*)(?:\[(\d+)\])?\s*->\s*([A-Za-z_]\w*)(?:\[(\d+)\])?\s*;$/i;

  let qubitRegister: string | null = null;
  let bitRegister: string | null = null;
  let sawWhole = false;
  const indexed: { qubitIndex: number; bitIndex: number }[] = [];

  for (const line of lines) {
    const assignMatch = assign.exec(line);
    const arrowMatch = assignMatch ? null : arrow.exec(line);
    if (!assignMatch && !arrowMatch) continue;

    let bit: string;
    let bitIndexRaw: string | undefined;
    let qubit: string;
    let qubitIndexRaw: string | undefined;
    if (assignMatch) {
      [, bit, bitIndexRaw, qubit, qubitIndexRaw] = assignMatch;
    } else {
      [, qubit, qubitIndexRaw, bit, bitIndexRaw] = arrowMatch!;
    }

    if (qubitRegister === null) qubitRegister = qubit;
    if (bitRegister === null) bitRegister = bit;
    if (qubit !== qubitRegister || bit !== bitRegister) return false;

    if (bitIndexRaw === undefined && qubitIndexRaw === undefined) {
      // Whole-register form. Only valid alone — a mix with any indexed
      // statement is a shape this function does not vouch for.
      if (sawWhole || indexed.length > 0) return false;
      sawWhole = true;
      continue;
    }
    if (bitIndexRaw === undefined || qubitIndexRaw === undefined || sawWhole) return false;
    indexed.push({ qubitIndex: Number(qubitIndexRaw), bitIndex: Number(bitIndexRaw) });
  }

  if (sawWhole) return true;
  if (indexed.length !== qubitCount) return false;
  const seenQubits = new Set<number>();
  for (const { qubitIndex, bitIndex } of indexed) {
    if (qubitIndex !== bitIndex) return false;
    if (qubitIndex < 0 || qubitIndex >= qubitCount || seenQubits.has(qubitIndex)) return false;
    seenQubits.add(qubitIndex);
  }
  return true;
}

function buildRows(
  ideal: Float64Array,
  entries: [string, number][],
  qubitCount: number,
  shots: number,
  maxRows: number,
): { rows: IdealComparisonRow[]; otherMeasuredShare: number; otherIdealShare: number } {
  const measuredByBitstring = new Map(entries);
  const idealTop = Array.from(ideal, (probability, index) => ({ index, probability }))
    .sort((left, right) => right.probability - left.probability || left.index - right.index)
    .slice(0, maxRows)
    .map(({ index }) => bitstringFor(index, qubitCount));
  const candidates = new Set<string>([...measuredByBitstring.keys(), ...idealTop]);

  const scored: IdealComparisonRow[] = Array.from(candidates, (bitstring) => {
    const measuredCount = measuredByBitstring.get(bitstring) ?? 0;
    const index = Number.parseInt(bitstring, 2);
    return {
      bitstring,
      measuredCount,
      measuredShare: shots > 0 ? measuredCount / shots : 0,
      idealShare: ideal[index] ?? 0,
    };
  });
  scored.sort((left, right) => {
    const byShare = Math.max(right.measuredShare, right.idealShare) - Math.max(left.measuredShare, left.idealShare);
    if (byShare !== 0) return byShare;
    return left.bitstring < right.bitstring ? -1 : left.bitstring > right.bitstring ? 1 : 0;
  });

  const rows = scored.slice(0, maxRows);
  const shownMeasured = rows.reduce((sum, row) => sum + row.measuredShare, 0);
  const shownIdeal = rows.reduce((sum, row) => sum + row.idealShare, 0);
  return {
    rows,
    otherMeasuredShare: clamp01(1 - shownMeasured),
    otherIdealShare: clamp01(1 - shownIdeal),
  };
}

/**
 * The exact expected total-variation distance between the ideal distribution
 * and an N-shot sample drawn from it — sampling noise alone, with no hardware
 * involved. `(1/(2N)) * sum_i E|X_i - N p_i|`, X_i ~ Binomial(N, p_i).
 */
export function expectedShotNoiseTvd(ideal: Float64Array, shots: number): number {
  let sum = 0;
  for (let index = 0; index < ideal.length; index += 1) {
    sum += expectedAbsoluteDeviation(shots, ideal[index]);
  }
  return clamp01(sum / (2 * shots));
}

/**
 * De Moivre's closed form for E|X - Np|, X ~ Binomial(N, p): with
 * k = floor(N p), E|X - Np| = 2 (1-p)^(N-k) p^(k+1) (k+1) C(N, k+1).
 * Computed in log space (Lanczos lgamma below) so it stays accurate for the
 * shot counts this product actually runs — the coefficient C(N, k+1) alone
 * overflows a double well under N = 10,000.
 */
function expectedAbsoluteDeviation(shots: number, probability: number): number {
  if (probability <= 0 || probability >= 1) return 0;
  const k = Math.min(Math.floor(shots * probability), shots - 1);
  const logTerm =
    Math.log(2)
    + (shots - k) * Math.log1p(-probability)
    + (k + 1) * Math.log(probability)
    + Math.log(k + 1)
    + logBinomialCoefficient(shots, k + 1);
  return Math.exp(logTerm);
}

function logBinomialCoefficient(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// Lanczos approximation (g = 7, n = 9 coefficients), a standard numerical
// recipe for the log-gamma function — accurate to well beyond double
// precision's useful range, which is what the ~1e-12 comparison against a
// brute-force binomial enumeration in this file's test needs.
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.999_999_999_999_809_93,
  676.520_368_121_885_1,
  -1259.139_216_722_402_8,
  771.323_428_777_653_13,
  -176.615_029_162_140_59,
  12.507_343_278_686_905,
  -0.138_571_095_265_720_12,
  9.984_369_578_019_571_6e-6,
  1.505_632_735_149_311_6e-7,
];

function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula: keeps the small-argument case (never hit by this
    // file's own callers, since k+1 >= 1 and n-k, n+1 stay well above 0.5,
    // but kept so this is a correct log-gamma rather than one valid only for
    // the inputs it happens to be called with today) accurate too.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const shifted = x - 1;
  let sum = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    sum += LANCZOS_COEFFICIENTS[i] / (shifted + i);
  }
  const t = shifted + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
