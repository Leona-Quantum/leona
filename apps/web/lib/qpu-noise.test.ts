import assert from "node:assert/strict";
import test from "node:test";

import {
  PreparedCircuitCache,
  applyReadoutFlip,
  estimateDevice,
  estimateNoisyDistribution,
  finishPreview,
  idealWeight,
  prepareCircuitForPreview,
  preparedCircuitKey,
  previewNoisyRun,
  previewPreparedRun,
  scheduleAfterPaint,
  tallyGates,
  totalVariationDistance,
  type NoisyPreview,
} from "./qpu-noise.ts";
import { parseSubmittedCircuit } from "./qpu-ideal.ts";
import type { QpuPublishedErrorFigure, QpuPublishedNoise, QpuPublishedNoiseProfile } from "./qpu.ts";
import { idealProbabilities } from "./statevector-kernel.ts";
import { TIER_LIMITS } from "./account-tier.ts";

const EPSILON = 1e-12;
const LIMITS = TIER_LIMITS.free;

function qasm(qubits: number, body: string[]): string {
  return [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    `qubit[${qubits}] q;`,
    `bit[${qubits}] c;`,
    ...body,
    "c = measure q;",
  ].join("\n");
}

function figure(value: number): QpuPublishedErrorFigure {
  return { value, statistic: "median", published_as: String(value), source_url: "https://example.invalid/", read_on: "2026-09-22" };
}

function profile(
  machine: string,
  rates: { one?: number | null; two?: number | null; readout?: number | null },
): QpuPublishedNoiseProfile {
  return {
    machine,
    one_qubit_gate_error: rates.one == null ? null : figure(rates.one),
    two_qubit_gate_error: rates.two == null ? null : figure(rates.two),
    readout_error: rates.readout == null ? null : figure(rates.readout),
  };
}

function device(...profiles: QpuPublishedNoiseProfile[]): QpuPublishedNoise {
  return { gate_model: true, machine_chosen_at_submit: profiles.length > 1, profiles };
}

function computed(result: NoisyPreview): Extract<NoisyPreview, { status: "computed" }> {
  assert.equal(result.status, "computed", `expected a computed preview, got ${JSON.stringify(result)}`);
  return result as Extract<NoisyPreview, { status: "computed" }>;
}

function shareOf(result: Extract<NoisyPreview, { status: "computed" }>, bitstring: string): number {
  const row = result.rows.find((candidate) => candidate.bitstring === bitstring);
  assert.ok(row, `no row for ${bitstring}`);
  return row.estimatedShare;
}

function parsed(source: string) {
  const result = parseSubmittedCircuit(source, LIMITS);
  assert.equal(result.status, "parsed", `expected the circuit to parse: ${JSON.stringify(result)}`);
  return (result as Extract<typeof result, { status: "parsed" }>).circuit;
}

const BELL = qasm(2, ["h q[0];", "cx q[0], q[1];"]);

test("zero error returns the ideal distribution exactly", () => {
  const result = computed(previewNoisyRun({
    qasm: BELL,
    noise: device(profile("perfect", { one: 0, two: 0, readout: 0 })),
    shots: 1000,
    limits: LIMITS,
  }));
  assert.equal(result.shown.tvd, 0);
  for (const row of result.rows) assert.equal(row.estimatedShare, row.idealShare);
  assert.equal(result.reading, "ideal_stands_out");
});

test("full depolarisation returns the uniform distribution, from either gate kind", () => {
  const circuit = parsed(BELL);
  const tally = tallyGates(circuit)!;
  const ideal = idealProbabilities(circuit);
  // A one-qubit error of 1/2 and a two-qubit error of 3/4 are each lambda = 1.
  for (const rates of [
    { oneQubitGateError: 0.5, twoQubitGateError: null, readoutError: null },
    { oneQubitGateError: null, twoQubitGateError: 0.75, readoutError: null },
  ]) {
    assert.equal(idealWeight(tally, rates), 0);
    const estimate = estimateNoisyDistribution(ideal, circuit.qubitCount, tally, rates);
    for (const share of estimate) assert.ok(Math.abs(share - 0.25) < EPSILON, `share ${share}`);
  }
});

test("a one-qubit readout flip gives the analytically known distribution", () => {
  // |1> read with a 10% flip: 0.9 on "1", 0.1 on "0".
  const single = computed(previewNoisyRun({
    qasm: qasm(1, ["x q[0];"]),
    noise: device(profile("readout only", { one: 0, readout: 0.1 })),
    shots: 1000,
    limits: LIMITS,
  }));
  assert.ok(Math.abs(shareOf(single, "1") - 0.9) < EPSILON);
  assert.ok(Math.abs(shareOf(single, "0") - 0.1) < EPSILON);
});

test("readout flips act per qubit and respect the kernel's bit order", () => {
  // Only qubit 0 is flipped, so the ideal outcome is "01" (qubit 0 rightmost).
  // With a 10% flip on each qubit independently: "01" keeps (0.9)^2, each
  // single flip ("00" flips qubit 0, "11" flips qubit 1) gets 0.9 * 0.1, and
  // "10" (both flipped) gets 0.1^2. A reversed bit order would put 0.81 on "10".
  const result = computed(previewNoisyRun({
    qasm: qasm(2, ["x q[0];"]),
    noise: device(profile("readout only", { one: 0, readout: 0.1 })),
    shots: 1000,
    limits: LIMITS,
  }));
  assert.ok(Math.abs(shareOf(result, "01") - 0.81) < EPSILON);
  assert.ok(Math.abs(shareOf(result, "00") - 0.09) < EPSILON);
  assert.ok(Math.abs(shareOf(result, "11") - 0.09) < EPSILON);
  assert.ok(Math.abs(shareOf(result, "10") - 0.01) < EPSILON);
});

test("readout noise leaves the uniform distribution uniform and keeps total probability 1", () => {
  const uniform = new Float64Array(8).fill(1 / 8);
  for (const share of applyReadoutFlip(uniform, 3, 0.2)) assert.ok(Math.abs(share - 1 / 8) < EPSILON);

  const skewed = Float64Array.from([0.5, 0.2, 0.1, 0.05, 0.05, 0.04, 0.03, 0.03]);
  const flipped = applyReadoutFlip(skewed, 3, 0.07);
  assert.ok(Math.abs(flipped.reduce((sum, share) => sum + share, 0) - 1) < EPSILON);
});

test("the gate model matches the closed form: weight is a product of per-gate survivals", () => {
  const tally = { oneQubit: 2, twoQubit: 3, measuredQubits: 2 };
  const weight = idealWeight(tally, { oneQubitGateError: 0.01, twoQubitGateError: 0.03, readoutError: null });
  assert.ok(Math.abs(weight - 0.98 ** 2 * 0.96 ** 3) < EPSILON, `weight ${weight}`);

  // Without readout error, distance from the ideal is exactly (1 - P) times
  // the ideal's own distance from uniform. The Bell state is 0.5 from uniform.
  const circuit = parsed(BELL);
  const ideal = idealProbabilities(circuit);
  const rates = { oneQubitGateError: 0.01, twoQubitGateError: 0.03, readoutError: null };
  const bellWeight = idealWeight(tallyGates(circuit)!, rates);
  const tvd = totalVariationDistance(estimateNoisyDistribution(ideal, 2, tallyGates(circuit)!, rates), ideal);
  assert.ok(Math.abs(tvd - 0.5 * (1 - bellWeight)) < EPSILON, `tvd ${tvd}`);
});

test("expected distance grows strictly with depth when the ideal answer does not change", () => {
  // Each CX pair is the identity, so the ideal stays on "01" while the gate
  // count, and so the noise, grows.
  const distances: number[] = [];
  for (let pairs = 0; pairs <= 6; pairs += 1) {
    const body = ["x q[0];"];
    for (let index = 0; index < pairs; index += 1) body.push("cx q[0], q[1];", "cx q[0], q[1];");
    const result = computed(previewNoisyRun({
      qasm: qasm(2, body),
      noise: device(profile("device", { one: 0.001, two: 0.01, readout: 0.02 })),
      shots: 1000,
      limits: LIMITS,
    }));
    assert.ok(Math.abs(result.rows[0].idealShare - 1) < EPSILON, "the ideal answer must not move");
    distances.push(result.shown.tvd);
  }
  for (let index = 1; index < distances.length; index += 1) {
    assert.ok(distances[index] > distances[index - 1], `not increasing: ${distances.join(", ")}`);
  }
});

test("gate tally uses the documented decompositions", () => {
  const circuit = parsed(qasm(3, [
    "h q[0];",
    "cx q[0], q[1];",
    "cz q[1], q[2];",
    "swap q[0], q[2];",
    "cp(pi/4) q[0], q[1];",
    "rzz(pi/4) q[1], q[2];",
    "ccx q[0], q[1], q[2];",
  ]));
  assert.deepEqual(tallyGates(circuit), {
    // h 1 + cp 3 + rzz 1 + ccx 9
    oneQubit: 14,
    // cx 1 + cz 1 + swap 3 + cp 2 + rzz 2 + ccx 6
    twoQubit: 15,
    measuredQubits: 3,
  });
});

test("the halfway threshold falls exactly where the ideal weight crosses one half", () => {
  // x q[0] then one CX pair: two two-qubit gates, ideal a point mass on "01".
  // P = (1 - 4r/3)^2, so r = 0.225 gives P = 0.49 and r = 0.2175 gives 0.5041.
  const circuit = qasm(2, ["x q[0];", "cx q[0], q[1];", "cx q[0], q[1];"]);
  const past = computed(previewNoisyRun({ qasm: circuit, noise: device(profile("d", { one: 0, two: 0.225 })), shots: 1000, limits: LIMITS }));
  const before = computed(previewNoisyRun({ qasm: circuit, noise: device(profile("d", { one: 0, two: 0.2175 })), shots: 1000, limits: LIMITS }));
  assert.equal(past.reading, "closer_to_noise");
  assert.equal(before.reading, "ideal_stands_out");
  // 0.75 is this ideal's distance from uniform; the share is 1 - P.
  assert.ok(Math.abs(past.uniformTvd - 0.75) < EPSILON);
  assert.ok(Math.abs((past.shareTowardNoise ?? -1) - 0.51) < 1e-9);
  assert.ok(Math.abs((before.shareTowardNoise ?? -1) - (1 - 0.71 ** 2)) < 1e-9);
});

test("an ideal that is already uniform says so instead of claiming a signal", () => {
  const result = computed(previewNoisyRun({
    qasm: qasm(3, ["h q[0];", "h q[1];", "h q[2];"]),
    noise: device(profile("device", { one: 0.001, two: 0.01, readout: 0.02 })),
    shots: 1000,
    limits: LIMITS,
  }));
  assert.equal(result.reading, "ideal_near_uniform");
  assert.ok(result.uniformTvd < 1e-9);
  assert.equal(result.shareTowardNoise, null);
});

test("a submit-time choice of machine shows the least favourable one and the full range", () => {
  const result = computed(previewNoisyRun({
    qasm: BELL,
    noise: {
      gate_model: true,
      machine_chosen_at_submit: true,
      profiles: [
        profile("good", { two: 0.002, readout: 0.004 }),
        profile("worse", { two: 0.003, readout: 0.02 }),
        profile("middle", { two: 0.0025, readout: 0.01 }),
      ],
    },
    shots: 1000,
    limits: LIMITS,
  }));
  assert.equal(result.machineChosenAtSubmit, true);
  assert.equal(result.shown.machine, "worse");
  assert.equal(result.machines.length, 3);
  const tvds = result.machines.map((machine) => machine.tvd);
  assert.equal(result.tvdRange.max, Math.max(...tvds));
  assert.equal(result.tvdRange.min, Math.min(...tvds));
  assert.ok(result.tvdRange.min < result.tvdRange.max);
  assert.deepEqual(result.shown.missing, ["one_qubit"]);
});

test("a figure left out lowers the estimate, and is reported as missing", () => {
  const withReadout = computed(previewNoisyRun({ qasm: BELL, noise: device(profile("d", { one: 0.001, two: 0.01, readout: 0.02 })), shots: 1000, limits: LIMITS }));
  const withoutReadout = computed(previewNoisyRun({ qasm: BELL, noise: device(profile("d", { one: 0.001, two: 0.01 })), shots: 1000, limits: LIMITS }));
  assert.ok(withoutReadout.shown.tvd < withReadout.shown.tvd);
  assert.deepEqual(withoutReadout.shown.missing, ["readout"]);
  assert.deepEqual(withReadout.shown.missing, []);
});

test("refuses rather than estimates: analog device, no figures, no measurement, over the tier", () => {
  assert.deepEqual(
    previewNoisyRun({ qasm: BELL, noise: { gate_model: false, machine_chosen_at_submit: false, profiles: [] }, shots: 1000, limits: LIMITS }),
    { status: "unavailable", reason: "not_gate_model" },
  );
  assert.deepEqual(
    previewNoisyRun({ qasm: BELL, noise: device(profile("nothing published", {})), shots: 1000, limits: LIMITS }),
    { status: "unavailable", reason: "no_figures" },
  );
  const unmeasured = ["OPENQASM 3.0;", 'include "stdgates.inc";', "qubit[2] q;", "h q[0];"].join("\n");
  assert.deepEqual(
    previewNoisyRun({ qasm: unmeasured, noise: device(profile("d", { two: 0.01 })), shots: 1000, limits: LIMITS }),
    { status: "unavailable", reason: "unparsable" },
  );
  const wide = qasm(LIMITS.cpuSimQubits + 1, ["h q[0];"]);
  assert.deepEqual(
    previewNoisyRun({ qasm: wide, noise: device(profile("d", { two: 0.01 })), shots: 1000, limits: LIMITS }),
    { status: "unavailable", reason: "qubit_limit" },
  );
});

test("rows hold the largest outcomes of both distributions, largest first", () => {
  const result = computed(previewNoisyRun({
    qasm: qasm(3, ["h q[0];", "cx q[0], q[1];", "cx q[1], q[2];"]),
    noise: device(profile("d", { one: 0.001, two: 0.02, readout: 0.03 })),
    shots: 1000,
    limits: LIMITS,
    maxRows: 4,
  }));
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows.slice(0, 2).map((row) => row.bitstring).sort(), ["000", "111"]);
  for (let index = 1; index < result.rows.length; index += 1) {
    const previous = Math.max(result.rows[index - 1].idealShare, result.rows[index - 1].estimatedShare);
    const current = Math.max(result.rows[index].idealShare, result.rows[index].estimatedShare);
    assert.ok(previous >= current);
  }
  const shownEstimate = result.rows.reduce((sum, row) => sum + row.estimatedShare, 0);
  assert.ok(Math.abs(shownEstimate + result.otherEstimatedShare - 1) < 1e-9);
});

test("a circuit prepared once gives the same preview on every device as preparing it each time", () => {
  const prepared = prepareCircuitForPreview(BELL, LIMITS);
  for (const noise of [
    device(profile("a", { one: 0.001, two: 0.01, readout: 0.02 })),
    device(profile("b", { two: 0.004 }), profile("c", { two: 0.009, readout: 0.03 })),
    { gate_model: false, machine_chosen_at_submit: false, profiles: [] },
  ]) {
    assert.deepEqual(previewPreparedRun({ prepared, noise, shots: 500 }), previewNoisyRun({ qasm: BELL, noise, shots: 500, limits: LIMITS }));
  }
});

test("the device estimate and the shot step compose to the same preview at every shot count", () => {
  const prepared = prepareCircuitForPreview(qasm(3, ["h q[0];", "cx q[0], q[1];", "cx q[1], q[2];"]), LIMITS);
  const noise = device(profile("a", { two: 0.004, readout: 0.01 }), profile("b", { two: 0.009, readout: 0.03 }));
  const estimate = estimateDevice({ prepared, noise });
  for (const shots of [1, 100, 4096]) {
    assert.deepEqual(finishPreview(estimate, shots), previewPreparedRun({ prepared, noise, shots }));
  }
  // The shot count reaches the result, so a finishPreview that ignored it would fail here.
  const few = finishPreview(estimate, 10);
  const many = finishPreview(estimate, 10_000);
  assert.ok(few.status === "computed" && many.status === "computed" && few.shotNoiseTvd > many.shotNoiseTvd);
});

test("prepared-circuit cache: keyed by limit values, computes once per key, evicts least recently used", () => {
  const calls: string[] = [];
  const cache = new PreparedCircuitCache(2, (source, limits) => {
    calls.push(preparedCircuitKey(source, limits));
    return prepareCircuitForPreview(source, limits);
  });
  const limitsA = { cpuSimQubits: 8, cpuSimOperations: 2000 };
  const sameValues = { cpuSimQubits: 8, cpuSimOperations: 2000 };
  const first = cache.getOrPrepare(BELL, limitsA);
  // A different object with equal values is a hit, not a second simulation.
  assert.equal(cache.getOrPrepare(BELL, sameValues), first);
  assert.equal(cache.peek(BELL, sameValues), first);
  assert.equal(calls.length, 1);
  // A different limit value is a different result (it can flip qubit_limit).
  cache.getOrPrepare(BELL, { cpuSimQubits: 1, cpuSimOperations: 2000 });
  assert.equal(calls.length, 2);
  // Two entries now, oldest first: BELL at 8 qubits, BELL at 1. Touching the
  // older one makes the 1-qubit entry the least recently used, so adding a
  // third key must evict that one and keep the touched one.
  cache.peek(BELL, limitsA);
  const other = qasm(1, ["x q[0];"]);
  cache.getOrPrepare(other, limitsA);
  assert.equal(calls.length, 3);
  assert.ok(cache.peek(BELL, limitsA), "the recently used entry must survive");
  assert.equal(cache.peek(BELL, { cpuSimQubits: 1, cpuSimOperations: 2000 }), undefined);
  assert.equal(cache.peek(qasm(2, ["h q[1];"]), limitsA), undefined, "peek never computes");
  assert.equal(calls.length, 3);
});

function fakePaintHost() {
  const frames: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  return {
    frames,
    timers,
    host: {
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: (handle: number) => { frames[handle - 1] = () => undefined; },
      setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id; },
      clearTimeout: (handle: never) => { timers.delete(handle as unknown as number); },
    },
    paint() { for (const frame of frames.splice(0)) frame(); },
    runTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer(); } },
  };
}

test("scheduleAfterPaint runs the task only after the frame and then a macrotask", () => {
  const fake = fakePaintHost();
  let ran = 0;
  scheduleAfterPaint(() => { ran += 1; }, fake.host);
  assert.equal(ran, 0, "not synchronously");
  fake.runTimers();
  assert.equal(ran, 0, "not before the frame has painted");
  fake.paint();
  assert.equal(ran, 0, "not inside the frame callback, which runs before paint");
  fake.runTimers();
  assert.equal(ran, 1);
});

test("scheduleAfterPaint's cancel stops the task before the frame and between frame and timer", () => {
  for (const cancelAt of ["before_frame", "after_frame", "before_frame_no_cancel_api"] as const) {
    const fake = fakePaintHost();
    // A host with no cancelAnimationFrame: the frame still fires, and the
    // cancelled flag alone has to stop the task.
    const host = cancelAt === "before_frame_no_cancel_api" ? { ...fake.host, cancelAnimationFrame: undefined } : fake.host;
    let ran = 0;
    const cancel = scheduleAfterPaint(() => { ran += 1; }, host);
    if (cancelAt === "after_frame") fake.paint();
    cancel();
    fake.paint();
    fake.runTimers();
    assert.equal(ran, 0, cancelAt);
  }
});

test("scheduleAfterPaint falls back to a plain timeout where there is no animation frame", async () => {
  let ran = 0;
  scheduleAfterPaint(() => { ran += 1; }, { setTimeout, clearTimeout } as never);
  assert.equal(ran, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ran, 1);
  const cancel = scheduleAfterPaint(() => { ran += 1; }, { setTimeout, clearTimeout } as never);
  cancel();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ran, 1);
});
