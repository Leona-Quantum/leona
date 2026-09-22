import assert from "node:assert/strict";
import test from "node:test";

import { compareMeasuredToIdeal, type IdealComparison } from "./qpu-ideal.ts";
import { sourceFingerprint, type CpuSimulationLimits } from "./studio-simulation.ts";
import { TIER_LIMITS } from "./account-tier.ts";

const EPSILON = 1e-9;
const LIMITS: CpuSimulationLimits = TIER_LIMITS.free;

const BELL_QASM = [
  "OPENQASM 3.0;",
  'include "stdgates.inc";',
  "qubit[2] q;",
  "bit[2] c;",
  "h q[0];",
  "cx q[0], q[1];",
  "c = measure q;",
].join("\n");

function computed(result: IdealComparison): Extract<IdealComparison, { status: "computed" }> {
  assert.equal(result.status, "computed", `expected a computed result, got ${JSON.stringify(result)}`);
  return result as Extract<IdealComparison, { status: "computed" }>;
}

function unavailable(result: IdealComparison): Extract<IdealComparison, { status: "unavailable" }> {
  assert.equal(result.status, "unavailable", `expected an unavailable result, got ${JSON.stringify(result)}`);
  return result as Extract<IdealComparison, { status: "unavailable" }>;
}

test("Bell state, counts match the ideal exactly: tvd 0, fidelity 1", () => {
  const result = computed(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 500, "11": 500 },
    limits: LIMITS,
  }));
  assert.equal(result.model, "direct_source");
  assert.equal(result.qubitCount, 2);
  assert.equal(result.shots, 1000);
  assert.ok(Math.abs(result.tvd - 0) < EPSILON, `tvd: ${result.tvd}`);
  assert.ok(Math.abs(result.hellingerFidelity - 1) < EPSILON, `fidelity: ${result.hellingerFidelity}`);
});

test("Bell state, counts spread uniformly over all 4 outcomes: tvd 0.5, fidelity 0.5", () => {
  const result = computed(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 250, "01": 250, "10": 250, "11": 250 },
    limits: LIMITS,
  }));
  assert.ok(Math.abs(result.tvd - 0.5) < EPSILON, `tvd: ${result.tvd}`);
  assert.ok(Math.abs(result.hellingerFidelity - 0.5) < EPSILON, `fidelity: ${result.hellingerFidelity}`);
});

// Bit-order pin: qubit 0 is flipped and nothing else. `bitstringFor` (and IBM's
// own SamplerV2 convention) prints qubit 1 leftmost and qubit 0 rightmost, so
// the ideal outcome is "01", not "10". If the key/index convention this file
// relies on were ever reversed, this is the test that would catch it — every
// symmetric circuit above (Bell) would keep passing regardless, since 00/11
// and the uniform spread are unchanged by a bit-order flip.
const BIT_ORDER_QASM = [
  "OPENQASM 3.0;",
  'include "stdgates.inc";',
  "qubit[2] q;",
  "bit[2] c;",
  "x q[0];",
  "c = measure q;",
].join("\n");

test("bit-order pin: only qubit 0 is flipped, so the ideal outcome is '01' not '10'", () => {
  const matching = computed(compareMeasuredToIdeal({
    qasm: BIT_ORDER_QASM,
    submittedFingerprint: sourceFingerprint(BIT_ORDER_QASM),
    counts: { "01": 1000 },
    limits: LIMITS,
  }));
  assert.ok(Math.abs(matching.tvd - 0) < EPSILON, `expected tvd 0 for the correct bit order, got ${matching.tvd}`);

  const reversed = computed(compareMeasuredToIdeal({
    qasm: BIT_ORDER_QASM,
    submittedFingerprint: sourceFingerprint(BIT_ORDER_QASM),
    counts: { "10": 1000 },
    limits: LIMITS,
  }));
  assert.ok(Math.abs(reversed.tvd - 1) < EPSILON, `expected tvd 1 for the reversed bit order, got ${reversed.tvd}`);
});

test("circuit_changed: a circuit edited after submission does not compare against its own stale fingerprint", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: "fnv1a-00000000",
    counts: { "00": 500, "11": 500 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "circuit_changed");
});

test("register_mismatch: a counts key of the wrong length is refused, not padded or truncated", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "000": 1000 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "register_mismatch");
});

test("register_mismatch: a counts key with a non-binary character is refused", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "02": 500, "11": 500 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "register_mismatch");
});

test("register_mismatch: a negative count is refused rather than summed away", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 5, "11": -5 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "register_mismatch");
});

test("no_counts: null counts", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: null,
    limits: LIMITS,
  }));
  assert.equal(result.reason, "no_counts");
});

test("no_counts: empty counts object", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: {},
    limits: LIMITS,
  }));
  assert.equal(result.reason, "no_counts");
});

test("no_counts: counts summing to zero", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 0, "11": 0 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "no_counts");
});

test("qubit_limit: a circuit within the parser's own width but over the viewer's tier limit", () => {
  const narrowLimits: CpuSimulationLimits = { cpuSimQubits: 1, cpuSimOperations: 100, cpuSimShots: 10_000, cpuSimRunsPer10Min: 10 };
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 500, "11": 500 },
    limits: narrowLimits,
  }));
  assert.equal(result.reason, "qubit_limit");
});

test("operation_limit: a circuit over the viewer's tier operation ceiling", () => {
  // The Bell circuit above compiles to 4 steps (H, CX, and 2 measurement
  // steps) — see rule 4's use of `circuit.steps.length`, the same field
  // `cpuSimulationEligibility` compares against this limit.
  const tightLimits: CpuSimulationLimits = { cpuSimQubits: 4, cpuSimOperations: 3, cpuSimShots: 10_000, cpuSimRunsPer10Min: 10 };
  const result = unavailable(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 500, "11": 500 },
    limits: tightLimits,
  }));
  assert.equal(result.reason, "operation_limit");
});

const UNMEASURED_QASM = [
  "OPENQASM 3.0;",
  'include "stdgates.inc";',
  "qubit[1] q;",
  "h q[0];",
].join("\n");

test("unparsable: a circuit with no measurement step", () => {
  const result = unavailable(compareMeasuredToIdeal({
    qasm: UNMEASURED_QASM,
    submittedFingerprint: sourceFingerprint(UNMEASURED_QASM),
    counts: { "0": 500, "1": 500 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "unparsable");
});

test("unparsable: a partial measurement reached only through the decomposition path is refused, not silently widened to a full measurement", () => {
  // `u3` is outside the strict OpenQASM 3 grammar (studio-parse.ts), so the
  // direct parser fails and this is read through the permissive interchange
  // reader (circuit-conversion.ts's `parseOpenQasm3StandardGates`), which
  // documents accepting per-qubit measurement. Only qubit 0 of 2 is measured
  // here — `hasCanonicalWholeRegisterMeasurement` must catch that the
  // decomposition path's own `generateBuilderCode` round trip would otherwise
  // silently turn into a full two-qubit `measure_all()`.
  const partial = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit[2] q;",
    "bit[2] meas;",
    "u3(0.1, 0.2, 0.3) q[0];",
    "meas[0] = measure q[0];",
  ].join("\n");
  const result = unavailable(compareMeasuredToIdeal({
    qasm: partial,
    submittedFingerprint: sourceFingerprint(partial),
    counts: { "0": 500, "1": 500 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "unparsable");
});

test("unparsable: a permuted-but-fully-measured circuit reached through the decomposition path is refused, not silently reindexed", () => {
  const permuted = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit[2] q;",
    "bit[2] meas;",
    "u3(0.1, 0.2, 0.3) q[0];",
    "meas[0] = measure q[1];",
    "meas[1] = measure q[0];",
  ].join("\n");
  const result = unavailable(compareMeasuredToIdeal({
    qasm: permuted,
    submittedFingerprint: sourceFingerprint(permuted),
    counts: { "00": 500, "11": 500 },
    limits: LIMITS,
  }));
  assert.equal(result.reason, "unparsable");
});

test("decomposition path: a circuit outside the strict grammar but with a canonical whole-register measurement is still accepted", () => {
  // `u3` forces the decomposition path; `c = measure q;` (the builder's own
  // literal register names) is unambiguously canonical.
  const canonical = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit[1] q;",
    "bit[1] c;",
    "u3(3.14159265358979, 0, 3.14159265358979) q[0];",
    "c = measure q;",
  ].join("\n");
  const result = computed(compareMeasuredToIdeal({
    qasm: canonical,
    submittedFingerprint: sourceFingerprint(canonical),
    counts: { "0": 10, "1": 990 },
    limits: LIMITS,
  }));
  assert.equal(result.model, "openqasm_standard_decomposition");
  // u3(pi, 0, pi) is an X gate up to global phase: the ideal outcome is |1>.
  assert.ok(result.tvd < 0.05, `expected the decomposed X-like gate near |1>, tvd was ${result.tvd}`);
});

test("decomposition path, Qiskit exporter shape: per-qubit indexed measurement keeps the bit order", () => {
  // What `qiskit.qasm3.dumps` writes for a measured circuit: the bit register
  // declared first and one indexed measurement per qubit. The strict grammar
  // refuses indexed measurement, so this is the path production artifacts take,
  // and the one where a reversed key convention would go unnoticed.
  const exported = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "bit[2] c;",
    "qubit[2] q;",
    "x q[0];",
    "c[0] = measure q[0];",
    "c[1] = measure q[1];",
  ].join("\n");
  const base = { qasm: exported, submittedFingerprint: sourceFingerprint(exported), limits: LIMITS };
  const right = computed(compareMeasuredToIdeal({ ...base, counts: { "01": 1000 } }));
  assert.equal(right.model, "openqasm_standard_decomposition");
  assert.ok(right.tvd < 1e-9, `qubit 0 flipped reads as "01" (bit 0 rightmost), tvd was ${right.tvd}`);
  const reversed = computed(compareMeasuredToIdeal({ ...base, counts: { "10": 1000 } }));
  assert.ok(reversed.tvd > 1 - 1e-9, `"10" is the reversed convention, tvd was ${reversed.tvd}`);
});

// --- shot-noise closed form -------------------------------------------------

const P_03_QASM = [
  "OPENQASM 3.0;",
  'include "stdgates.inc";',
  "qubit[1] q;",
  "bit[1] c;",
  // theta = 2*asin(sqrt(0.3)) => P(measure 1) = sin^2(theta/2) = 0.3 exactly
  // (to double precision — see the brute-force comparison below).
  "ry(1.1592794807274085) q[0];",
  "c = measure q;",
].join("\n");

function combinations(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
}

function binomialPmf(n: number, x: number, p: number): number {
  return combinations(n, x) * p ** x * (1 - p) ** (n - x);
}

/** Brute-force oracle for `(1/(2N)) * sum_i E|X_i - N p_i|` — independent of
 * this module's own closed-form implementation, for the two-outcome case. */
function bruteForceShotNoiseTvd(n: number, p: number): number {
  let expectedAbsoluteDeviation = 0;
  for (let x = 0; x <= n; x += 1) expectedAbsoluteDeviation += Math.abs(x - n * p) * binomialPmf(n, x, p);
  // Two outcomes (p, 1-p): |X_1 - Np_1| = |X_0 - Np_0| always, so the sum over
  // both outcomes is exactly double the single-outcome expectation.
  return (2 * expectedAbsoluteDeviation) / (2 * n);
}

test("shotNoiseTvd matches brute-force binomial enumeration to ~1e-12 (N=5, p=0.3)", () => {
  const result = computed(compareMeasuredToIdeal({
    qasm: P_03_QASM,
    submittedFingerprint: sourceFingerprint(P_03_QASM),
    counts: { "0": 4, "1": 1 },
    limits: LIMITS,
  }));
  const expected = bruteForceShotNoiseTvd(5, 0.3);
  assert.ok(
    Math.abs(result.shotNoiseTvd - expected) < 1e-12,
    `shotNoiseTvd ${result.shotNoiseTvd} vs brute force ${expected}`,
  );
});

test("shotNoiseTvd shrinks as shots grow", () => {
  const small = computed(compareMeasuredToIdeal({
    qasm: P_03_QASM,
    submittedFingerprint: sourceFingerprint(P_03_QASM),
    counts: { "0": 70, "1": 30 },
    limits: LIMITS,
  }));
  const large = computed(compareMeasuredToIdeal({
    qasm: P_03_QASM,
    submittedFingerprint: sourceFingerprint(P_03_QASM),
    counts: { "0": 7000, "1": 3000 },
    limits: LIMITS,
  }));
  assert.ok(small.shotNoiseTvd > large.shotNoiseTvd, `expected N=100 (${small.shotNoiseTvd}) > N=10000 (${large.shotNoiseTvd})`);
});

test("shotNoiseTvd is exactly 0 for a deterministic circuit", () => {
  const deterministic = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit[1] q;",
    "bit[1] c;",
    "x q[0];",
    "c = measure q;",
  ].join("\n");
  const result = computed(compareMeasuredToIdeal({
    qasm: deterministic,
    submittedFingerprint: sourceFingerprint(deterministic),
    counts: { "1": 1000 },
    limits: LIMITS,
  }));
  assert.equal(result.shotNoiseTvd, 0);
});

// --- rows --------------------------------------------------------------

test("rows plus the 'other' bucket sum to 1 on both the measured and ideal side", () => {
  const result = computed(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 250, "01": 250, "10": 250, "11": 250 },
    limits: LIMITS,
    maxRows: 2,
  }));
  const measuredSum = result.rows.reduce((sum, row) => sum + row.measuredShare, 0) + result.otherMeasuredShare;
  const idealSum = result.rows.reduce((sum, row) => sum + row.idealShare, 0) + result.otherIdealShare;
  assert.ok(Math.abs(measuredSum - 1) < EPSILON, `measured sum: ${measuredSum}`);
  assert.ok(Math.abs(idealSum - 1) < EPSILON, `ideal sum: ${idealSum}`);
  assert.ok(result.rows.length <= 2, `expected at most 2 rows, got ${result.rows.length}`);
});

test("rows are ranked by max(measuredShare, idealShare) descending, ties broken by bitstring ascending", () => {
  const result = computed(compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts: { "00": 500, "11": 500 },
    limits: LIMITS,
    maxRows: 8,
  }));
  // "00" and "11" tie at max share 0.5 each; ascending bitstring order breaks it.
  const topTwo = result.rows.slice(0, 2).map((row) => row.bitstring);
  assert.deepEqual(topTwo, ["00", "11"]);
});
