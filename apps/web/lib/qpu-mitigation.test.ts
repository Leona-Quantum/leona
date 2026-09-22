import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  closestProbabilityDistribution,
  extrapolateDistribution,
  linearZeroNoise,
  mitigatedReadings,
  readMitigation,
  readoutCorrectedQuasi,
  richardsonZeroNoise,
  zneRequested,
} from "./qpu-mitigation.ts";
import { compareMeasuredToIdeal } from "./qpu-ideal.ts";
import { sourceFingerprint } from "./studio-simulation.ts";
import { TIER_LIMITS } from "./account-tier.ts";

/**
 * The shared fixture. `scripts/mitiq_parity.py --write` put Mitiq 1.1.0's numbers
 * under `mitiq` and our Python twin's under `leona`, for the same inputs. The
 * browser is held to BOTH: to `leona` at rounding level, which is what makes the
 * two languages one implementation, and to `mitiq` at the tolerances the script
 * records and explains.
 */
type Fixture = {
  mitiq_version: string;
  tolerances: { algebra: number; projection: number; twin: number };
  readout: {
    name: string;
    counts: Record<string, number>;
    bits: { clbit: number; prob_meas1_prep0: number; prob_meas0_prep1: number }[];
    mitiq: { quasi: number[]; projected: number[] };
    leona: { quasi: number[]; projected: number[] };
  }[];
  extrapolation: {
    scales: number[];
    values: number[];
    mitiq: { richardson: number; linear: number };
    leona: { richardson: number; linear: number };
  }[];
  distribution: {
    name: string;
    counts_by_scale: [number, Record<string, number>][];
    mitiq: Record<"richardson" | "linear", { distribution: Record<string, number>; clipped_mass: number }>;
    leona: Record<"richardson" | "linear", { distribution: Record<string, number>; clipped_mass: number }>;
  }[];
};

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../../packages/py/qpu/tests/fixtures/mitigation-parity.json", import.meta.url), "utf8"),
) as Fixture;
const TOL = FIXTURE.tolerances;

function maxDiff(left: ArrayLike<number>, right: ArrayLike<number>): number {
  assert.equal(left.length, right.length);
  let worst = 0;
  for (let i = 0; i < left.length; i += 1) worst = Math.max(worst, Math.abs(left[i] - right[i]));
  return worst;
}

function distance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += (left[i] - right[i]) ** 2;
  return Math.sqrt(sum);
}

test("the fixture came from Mitiq and has cases in every section", () => {
  assert.equal(FIXTURE.mitiq_version, "1.1.0");
  assert.ok(FIXTURE.readout.length && FIXTURE.extrapolation.length && FIXTURE.distribution.length);
  // A case that needs the projection, so the projection test below is not
  // passing with the projection replaced by the identity.
  assert.ok(FIXTURE.readout.some((item) => Math.min(...item.mitiq.quasi) < 0));
});

for (const item of FIXTURE.readout) {
  test(`readout correction matches Mitiq and the Python twin: ${item.name}`, () => {
    const quasi = readoutCorrectedQuasi(item.counts, item.bits);
    assert.ok(maxDiff(quasi, item.mitiq.quasi) <= TOL.algebra, `vs Mitiq: ${maxDiff(quasi, item.mitiq.quasi)}`);
    assert.ok(maxDiff(quasi, item.leona.quasi) <= TOL.twin, `vs Python: ${maxDiff(quasi, item.leona.quasi)}`);
  });

  test(`projection matches the Python twin, is within Mitiq's tolerance, and is no farther: ${item.name}`, () => {
    const projected = closestProbabilityDistribution(item.leona.quasi);
    assert.ok(maxDiff(projected, item.leona.projected) <= TOL.twin);
    assert.ok(maxDiff(projected, item.mitiq.projected) <= TOL.projection);
    assert.ok(distance(projected, item.leona.quasi) <= distance(item.mitiq.projected, item.leona.quasi) + 1e-12);
    assert.ok(Math.abs(projected.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    assert.ok(projected.every((value) => value >= 0));
  });
}

for (const item of FIXTURE.extrapolation) {
  test(`Richardson and linear fits match Mitiq's factories: ${item.values.join(", ")}`, () => {
    const richardson = richardsonZeroNoise(item.scales, item.values);
    const linear = linearZeroNoise(item.scales, item.values);
    assert.ok(Math.abs(richardson - item.mitiq.richardson) <= TOL.algebra);
    assert.ok(Math.abs(linear - item.mitiq.linear) <= TOL.algebra);
    assert.ok(Math.abs(richardson - item.leona.richardson) <= TOL.twin);
    assert.ok(Math.abs(linear - item.leona.linear) <= TOL.twin);
  });
}

for (const item of FIXTURE.distribution) {
  for (const method of ["richardson", "linear"] as const) {
    test(`${method} distribution matches Mitiq and the Python twin: ${item.name}`, () => {
      const result = extrapolateDistribution(item.counts_by_scale, method);
      for (const [key, expected] of Object.entries(item.mitiq[method].distribution)) {
        assert.ok(Math.abs(result.distribution[key] - expected) <= TOL.algebra, key);
        assert.ok(Math.abs(result.distribution[key] - item.leona[method].distribution[key]) <= TOL.twin, key);
      }
      assert.ok(Math.abs(result.clippedMass - item.mitiq[method].clipped_mass) <= TOL.algebra);
    });
  }
}

test("the overshoot case clips probability Richardson put below zero", () => {
  const overshoot = FIXTURE.distribution.find((item) => item.name.includes("overshoot"))!;
  const result = extrapolateDistribution(overshoot.counts_by_scale, "richardson");
  assert.ok(result.clippedMass > 0);
  assert.ok(Object.values(result.distribution).every((share) => share >= 0));
});

// ---------------------------------------------------------------------------
// Reading the stored document
// ---------------------------------------------------------------------------

const BELL_QASM = [
  "OPENQASM 3.0;",
  'include "stdgates.inc";',
  "qubit[2] q;",
  "bit[2] c;",
  "h q[0];",
  "cx q[0], q[1];",
  "c = measure q;",
].join("\n");

const READOUT = {
  register: "c",
  calibrated_at: "2026-09-22T03:00:00+00:00",
  bits: [
    { clbit: 0, qubit: 4, prob_meas1_prep0: 0.02, prob_meas0_prep1: 0.06, source: "backend_properties" },
    { clbit: 1, qubit: 3, prob_meas1_prep0: 0.03, prob_meas0_prep1: 0.05, source: "backend_properties" },
  ],
};

function bellIdeal(counts: Record<string, number>) {
  const comparison = compareMeasuredToIdeal({
    qasm: BELL_QASM,
    submittedFingerprint: sourceFingerprint(BELL_QASM),
    counts,
    limits: TIER_LIMITS.free,
  });
  assert.equal(comparison.status, "computed");
  return comparison as Extract<typeof comparison, { status: "computed" }>;
}

test("an unknown document version is refused rather than read as the one it resembles", () => {
  assert.equal(readMitigation({ version: 2, readout: READOUT }), null);
  assert.equal(readMitigation(null), null);
  assert.equal(readMitigation([1]), null);
  assert.ok(readMitigation({ version: 1, readout: READOUT })?.readout);
});

test("readout correction moves a noisy Bell run closer to its ideal", () => {
  // Readout errors only: a perfect Bell state read through the READOUT qubits.
  const raw = { "00": 460, "01": 30, "10": 38, "11": 496 };
  const comparison = bellIdeal(raw);
  const readings = mitigatedReadings({
    ideal: comparison.ideal,
    qubitCount: comparison.qubitCount,
    rawCounts: raw,
    mitigation: { version: 1, readout: READOUT },
  });
  assert.equal(readings.readout.status, "computed");
  if (readings.readout.status !== "computed") return;
  assert.ok(readings.readout.reading.tvd < comparison.tvd, `${readings.readout.reading.tvd} vs raw ${comparison.tvd}`);
  assert.ok(readings.readout.reading.hellingerFidelity > comparison.hellingerFidelity);
  assert.equal(readings.readout.calibratedAt, READOUT.calibrated_at);
  assert.equal(readings.readout.symmetric, false);
  assert.equal(readings.zne, null, "no ZNE reading for a run that did not ask for it");
});

test("a run recorded before calibration snapshots existed says so", () => {
  const raw = { "00": 500, "11": 524 };
  const comparison = bellIdeal(raw);
  for (const mitigation of [null, undefined, { version: 1 }]) {
    const readings = mitigatedReadings({ ideal: comparison.ideal, qubitCount: 2, rawCounts: raw, mitigation });
    assert.deepEqual(readings.readout, { status: "unavailable", reason: "no_calibration" });
  }
});

test("a snapshot that does not cover exactly the counted bits is not used", () => {
  const raw = { "00": 500, "11": 524 };
  const comparison = bellIdeal(raw);
  const oneBit = { ...READOUT, bits: [READOUT.bits[0]] };
  const wrongBits = { ...READOUT, bits: [READOUT.bits[0], { ...READOUT.bits[1], clbit: 2 }] };
  for (const readout of [oneBit, wrongBits]) {
    const readings = mitigatedReadings({ ideal: comparison.ideal, qubitCount: 2, rawCounts: raw, mitigation: { version: 1, readout } });
    assert.deepEqual(readings.readout, { status: "unavailable", reason: "calibration_mismatch" });
  }
  const useless = { ...READOUT, bits: [READOUT.bits[0], { ...READOUT.bits[1], prob_meas0_prep1: 0.5 }] };
  assert.deepEqual(
    mitigatedReadings({ ideal: comparison.ideal, qubitCount: 2, rawCounts: raw, mitigation: { version: 1, readout: useless } }).readout,
    { status: "unavailable", reason: "calibration_unusable" },
  );
});

test("ZNE extrapolates a decaying Bell run back toward its ideal and reports the fit it used", () => {
  const raw = { "00": 460, "01": 40, "10": 44, "11": 480 };
  const comparison = bellIdeal(raw);
  const mitigation = {
    version: 1,
    zne: {
      scale_factors: [1, 3, 5],
      folding: "global",
      two_qubit_gates: [2, 6, 10],
      counts: {
        "3": { "00": 390, "01": 118, "10": 121, "11": 395 },
        "5": { "00": 340, "01": 170, "10": 176, "11": 338 },
      },
    },
  };
  assert.ok(zneRequested(mitigation));
  const readings = mitigatedReadings({ ideal: comparison.ideal, qubitCount: 2, rawCounts: raw, mitigation });
  assert.equal(readings.zne?.status, "computed");
  if (readings.zne?.status !== "computed") return;
  assert.ok(readings.zne.reading.richardson.tvd < comparison.tvd);
  assert.ok(readings.zne.reading.linear.tvd < comparison.tvd);
  assert.deepEqual(readings.zne.reading.twoQubitGates, [2, 6, 10]);
  // Readout was not recorded here, and that is said separately.
  assert.deepEqual(readings.readout, { status: "unavailable", reason: "no_calibration" });
});

test("a ZNE run whose folded counts never came back says so instead of extrapolating", () => {
  const raw = { "00": 500, "11": 524 };
  const comparison = bellIdeal(raw);
  for (const zne of [
    { scale_factors: [1, 3, 5], error: "the provider returned no counts for the folded circuits" },
    { scale_factors: [1, 3, 5], counts: { "3": { "00": 1 } } },
    // Keys of the wrong width: counts from some other register.
    { scale_factors: [1, 3, 5], counts: { "3": { "0": 1 }, "5": { "1": 1 } } },
  ]) {
    const readings = mitigatedReadings({ ideal: comparison.ideal, qubitCount: 2, rawCounts: raw, mitigation: { version: 1, zne } });
    assert.deepEqual(readings.zne, { status: "unavailable", reason: "zne_no_counts" });
  }
});
