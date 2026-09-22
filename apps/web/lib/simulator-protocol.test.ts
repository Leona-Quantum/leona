import assert from "node:assert/strict";
import test from "node:test";

import { TIER_LIMITS } from "./account-tier.ts";
import { compareMeasuredToIdeal, parseSubmittedCircuit } from "./qpu-ideal.ts";
import { compareAndMitigate } from "./qpu-mitigation.ts";
import { estimateDevice, prepareCircuitForPreview } from "./qpu-noise.ts";
import type { QpuPublishedErrorFigure, QpuPublishedNoise } from "./qpu.ts";
import {
  SIMULATOR_PROTOCOL_VERSION,
  createSimulatorContext,
  handleSimulatorRequest,
  isSimulatorRequest,
  isSimulatorResponse,
  runSimulatorJob,
  type SimulatorJob,
  type SimulatorResponse,
} from "./simulator-protocol.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";
import { cpuSimulationRecord, planCpuSimulation, runCpuSimulation, sampleCircuitCounts, sourceFingerprint } from "./studio-simulation.ts";
import { runParameterSweep } from "./studio-parameter-sweep.ts";

/*
 * The worker's promise is "the same numbers": every job the page hands it
 * must come back exactly as the direct call the page used to make would have
 * returned it. These tests hold `runSimulatorJob` to that on several circuits,
 * and then hold the message boundary to it too — the request and the reply
 * both go through a real structured clone, with the reply's buffer
 * transferred, which is what a worker's postMessage does.
 */

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

/** A deterministic mix of every gate family, on `qubits` wires. */
function mixed(qubits: number, gates: number): string {
  const one = ["h", "x", "y", "s", "t", "sdg", "rx(0.3)", "ry(pi/4)", "rz(-1.2)"];
  const body: string[] = [];
  for (let index = 0; body.length < gates; index += 1) {
    const q = index % qubits;
    const next = (q + 1) % qubits;
    if (index % 5 === 3) body.push(`cx q[${q}], q[${next}];`);
    else if (index % 7 === 6) body.push(`cp(pi/3) q[${q}], q[${next}];`);
    else body.push(`${one[index % one.length]} q[${q}];`);
  }
  return qasm(qubits, body);
}

// Several shapes on purpose: a two-qubit entangler, a wider GHZ state with a
// peaked ideal, rotations that leave no outcome at zero, and a circuit only
// the decomposition path can read (`u3`).
const CIRCUITS: { name: string; source: string; counts: Record<string, number> }[] = [
  { name: "Bell", source: qasm(2, ["h q[0];", "cx q[0], q[1];"]), counts: { "00": 480, "11": 505, "01": 9, "10": 6 } },
  {
    name: "GHZ-5",
    source: qasm(5, ["h q[0];", "cx q[0], q[1];", "cx q[1], q[2];", "cx q[2], q[3];", "cx q[3], q[4];"]),
    counts: { "00000": 470, "11111": 490, "00001": 40 },
  },
  { name: "mixed-7", source: mixed(7, 90), counts: { "0000000": 12, "1010101": 30, "1111111": 58 } },
  {
    name: "u3-decomposition",
    source: qasm(1, ["u3(3.14159265358979, 0, 3.14159265358979) q[0];"]),
    counts: { "0": 10, "1": 990 },
  },
];

function figure(value: number): QpuPublishedErrorFigure {
  return { value, statistic: "median", published_as: String(value), source_url: "https://example.invalid/", read_on: "2026-09-22" };
}

const NOISE: QpuPublishedNoise = {
  gate_model: true,
  machine_chosen_at_submit: true,
  profiles: [
    { machine: "device_a", one_qubit_gate_error: figure(0.0004), two_qubit_gate_error: figure(0.008), readout_error: figure(0.02) },
    { machine: "device_b", one_qubit_gate_error: figure(0.0009), two_qubit_gate_error: null, readout_error: figure(0.035) },
  ],
};

function parsedCircuit(source: string): ParsedBuilderCircuit {
  const result = parseSubmittedCircuit(source, LIMITS);
  assert.equal(result.status, "parsed", `expected the circuit to parse: ${JSON.stringify(result)}`);
  return (result as Extract<typeof result, { status: "parsed" }>).circuit;
}

/** One trip across a worker boundary: clone the request in, handle it, clone
 * the reply out with its buffers transferred. */
function throughTheBoundary(job: SimulatorJob, context = createSimulatorContext()): SimulatorResponse {
  const request = structuredClone({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 7, job });
  const handled = handleSimulatorRequest(request, context);
  assert.ok(handled, "a well-formed request is handled");
  return structuredClone(handled.response, { transfer: handled.transfer });
}

function resultOf(response: SimulatorResponse, id = 7): unknown {
  assert.equal(response.ok, true, `expected an ok reply, got ${JSON.stringify(response)}`);
  assert.equal(response.id, id);
  return (response as Extract<SimulatorResponse, { ok: true }>).result;
}

test("parameter sweep crosses the worker boundary with the same ideal readings", () => {
  const circuit: ParsedBuilderCircuit = { qubitCount: 2, steps: [
    { id: "turn", gate: "RY", qubits: [0], param: "pi/4" },
    { id: "entangle", gate: "CX", qubits: [0, 1] },
  ] };
  const request = { circuit, stepId: "turn", measuredQubit: 1, startDegrees: 0, endDegrees: 180, points: 7 };
  const job: SimulatorJob = { kind: "parameter_sweep", request };
  const direct = runParameterSweep(request);
  assert.deepEqual(runSimulatorJob(job, createSimulatorContext()), direct);
  assert.deepEqual(resultOf(throughTheBoundary(job)), direct);
});

for (const { name, source, counts } of CIRCUITS) {
  test(`compare_ideal returns exactly the direct comparison: ${name}`, () => {
    const direct = compareMeasuredToIdeal({ qasm: source, submittedFingerprint: sourceFingerprint(source), counts, limits: LIMITS });
    assert.equal(direct.status, "computed", `the ${name} fixture must be a computed comparison to test anything`);
    const job: SimulatorJob = { kind: "compare_ideal", qasm: source, submittedFingerprint: sourceFingerprint(source), counts, limits: LIMITS };
    assert.deepEqual(runSimulatorJob(job, createSimulatorContext()), direct);
    assert.deepEqual(resultOf(throughTheBoundary(job)), direct);
  });

  test(`compare_mitigated returns exactly the direct comparison and readings: ${name}`, () => {
    const input = { qasm: source, submittedFingerprint: sourceFingerprint(source), counts, limits: LIMITS };
    const plain = compareMeasuredToIdeal(input);
    assert.equal(plain.status, "computed");
    const width = plain.status === "computed" ? plain.qubitCount : 0;
    // A calibration for every counted bit, so the correction really runs and
    // its readings cross the boundary, not only a refusal.
    const bits = Array.from({ length: width }, (_, clbit) => ({ clbit, qubit: clbit, prob_meas1_prep0: 0.02, prob_meas0_prep1: 0.04, source: "backend_properties" }));
    const mitigation = { version: 1, readout: { register: "c", calibrated_at: null, bits } };
    const direct = compareAndMitigate({ ...input, mitigation });
    assert.equal(direct.readings?.readout.status, "computed");
    // The comparison half is the plain comparison, field for field.
    assert.deepEqual(direct.comparison, compareMeasuredToIdeal(input));
    const job: SimulatorJob = { kind: "compare_mitigated", ...input, mitigation };
    assert.deepEqual(runSimulatorJob(job, createSimulatorContext()), direct);
    assert.deepEqual(resultOf(throughTheBoundary(job)), direct);
    assert.ok(isSimulatorRequest({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, job }));
  });

  test(`noise_estimate returns exactly the direct estimate, ideal distribution included: ${name}`, () => {
    const direct = estimateDevice({ prepared: prepareCircuitForPreview(source, LIMITS), noise: NOISE });
    assert.equal(direct.status, "computed", `the ${name} fixture must be a computed estimate to test anything`);
    const job: SimulatorJob = { kind: "noise_estimate", qasm: source, limits: LIMITS, noise: NOISE };
    assert.deepEqual(runSimulatorJob(job, createSimulatorContext()), direct);
    // deepEqual compares a Float64Array element by element, so this pins
    // every one of the 2^n ideal probabilities, not just the summary figures.
    assert.deepEqual(resultOf(throughTheBoundary(job)), direct);
  });

  test(`cpu_counts returns exactly the direct seeded sample: ${name}`, () => {
    const circuit = parsedCircuit(source);
    const direct = sampleCircuitCounts(circuit, 500, 424242);
    const job: SimulatorJob = { kind: "cpu_counts", circuit, shots: 500, seed: 424242 };
    assert.deepEqual(runSimulatorJob(job, createSimulatorContext()), direct);
    assert.deepEqual(resultOf(throughTheBoundary(job)), direct);
  });
}

test("Studio's split run (plan here, counts in the worker, record here) records exactly what runCpuSimulation does", () => {
  for (const code of [
    ["from qiskit import QuantumCircuit", "qc = QuantumCircuit(2)", "qc.h(0)", "qc.cx(0, 1)", "qc.measure_all()"].join("\n"),
    ["from qiskit import QuantumCircuit", "qc = QuantumCircuit(3)", "qc.ry(0.7, 0)", "qc.rx(1.9, 1)", "qc.cx(0, 2)", "qc.h(1)", "qc.measure_all()"].join("\n"),
  ]) {
    const request = {
      artifactId: "artifact-split",
      code,
      framework: "qiskit" as const,
      shots: 2_000,
      seed: 99,
      now: new Date("2026-09-22T00:00:00.000Z"),
      id: "sim-split",
    };
    const whole = runCpuSimulation(request, LIMITS);
    const plan = planCpuSimulation(request, LIMITS);
    const reply = resultOf(throughTheBoundary({ kind: "cpu_counts", circuit: plan.circuit, shots: plan.shots, seed: plan.seed }));
    assert.deepEqual(cpuSimulationRecord(plan, reply as Record<string, number>), whole);
  }
});

test("the plan refuses exactly what runCpuSimulation refuses, before anything is simulated", () => {
  const base = { artifactId: "artifact-refused", code: "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\nqc.measure_all()", framework: "qiskit" as const };
  for (const request of [{ ...base, shots: 0 }, { ...base, shots: 10, seed: -1 }, { ...base, artifactId: " ", shots: 10 }]) {
    assert.throws(() => runCpuSimulation(request, LIMITS), (whole: Error) => {
      assert.throws(() => planCpuSimulation(request, LIMITS), { message: whole.message });
      return true;
    });
  }
});

test("a noise estimate's buffer is transferred as a copy, so the worker's own cached circuit survives the reply", () => {
  const source = CIRCUITS[2].source;
  const context = createSimulatorContext();
  const job: SimulatorJob = { kind: "noise_estimate", qasm: source, limits: LIMITS, noise: NOISE };
  const request = { protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, job };
  const handled = handleSimulatorRequest(request, context);
  assert.ok(handled);
  assert.equal(handled.transfer.length, 1, "the ideal distribution's buffer is moved, not cloned");
  const received = structuredClone(handled.response, { transfer: handled.transfer });
  // The transferred buffer is detached on the sending side...
  assert.equal(handled.transfer[0].byteLength, 0);
  // ...but it was the copy's: the prepared circuit the worker keeps for the
  // next device is intact, and still equal to what the page received.
  const cached = context.prepared.peek(source, LIMITS);
  assert.ok(cached && cached.status === "prepared");
  assert.equal(cached.ideal.length, 1 << 7);
  const estimate = resultOf(received, 1) as { ideal: Float64Array };
  assert.deepEqual(estimate.ideal, cached.ideal);
});

test("a second device for the same circuit reuses the worker's prepared circuit instead of simulating again", () => {
  const source = CIRCUITS[1].source;
  const context = createSimulatorContext();
  runSimulatorJob({ kind: "noise_estimate", qasm: source, limits: LIMITS, noise: NOISE }, context);
  const first = context.prepared.peek(source, LIMITS);
  const other: QpuPublishedNoise = { ...NOISE, machine_chosen_at_submit: false, profiles: [NOISE.profiles[1]] };
  runSimulatorJob({ kind: "noise_estimate", qasm: source, limits: LIMITS, noise: other }, context);
  assert.equal(context.prepared.peek(source, LIMITS), first, "the same prepared object, so no second simulation");
});

test("results that are not a noise estimate move nothing", () => {
  const source = CIRCUITS[0].source;
  const handled = handleSimulatorRequest(
    { protocol: SIMULATOR_PROTOCOL_VERSION, id: 3, job: { kind: "compare_ideal", qasm: source, submittedFingerprint: sourceFingerprint(source), counts: CIRCUITS[0].counts, limits: LIMITS } },
    createSimulatorContext(),
  );
  assert.ok(handled);
  assert.deepEqual(handled.transfer, []);
  const unavailable = handleSimulatorRequest(
    { protocol: SIMULATOR_PROTOCOL_VERSION, id: 4, job: { kind: "noise_estimate", qasm: "not a circuit", limits: LIMITS, noise: NOISE } },
    createSimulatorContext(),
  );
  assert.ok(unavailable);
  assert.deepEqual(unavailable.transfer, [], "an unavailable estimate carries no distribution to move");
});

test("compare_mitigated answers with the raw comparison even when the folded counts total zero", () => {
  // Greptile P2 on PR 970, at the boundary the page actually uses: the job must
  // be an ok reply carrying the comparison, not an ok:false that costs it.
  const { source, counts } = CIRCUITS[0];
  const input = { qasm: source, submittedFingerprint: sourceFingerprint(source), counts, limits: LIMITS };
  const zero = Object.fromEntries(Object.keys(counts ?? {}).map((key) => [key, 0]));
  const job: SimulatorJob = {
    kind: "compare_mitigated",
    ...input,
    mitigation: { version: 1, zne: { scale_factors: [1, 3, 5], counts: { "3": zero, "5": zero } } },
  };
  const result = resultOf(throughTheBoundary(job)) as { comparison: unknown; readings: { zne: unknown } };
  assert.deepEqual(result.comparison, compareMeasuredToIdeal(input));
  assert.deepEqual(result.readings.zne, { status: "unavailable", reason: "zne_no_counts" });
});

test("a job that throws becomes an ok:false reply with the thrown message, never an uncaught error", () => {
  const custom: ParsedBuilderCircuit = { qubitCount: 1, steps: [{ id: "g", gate: "CUSTOM", qubits: [0], customGateId: "x" }] };
  const handled = handleSimulatorRequest(
    { protocol: SIMULATOR_PROTOCOL_VERSION, id: 9, job: { kind: "cpu_counts", circuit: custom, shots: 10, seed: 1 } },
    createSimulatorContext(),
  );
  assert.ok(handled);
  assert.deepEqual(handled.response, {
    protocol: SIMULATOR_PROTOCOL_VERSION,
    id: 9,
    ok: false,
    error: "Custom gates are not eligible for the bounded CPU simulator.",
  });
});

test("messages that are not requests are ignored rather than answered", () => {
  const context = createSimulatorContext();
  for (const message of [
    null,
    "compare",
    { id: 1, job: { kind: "cpu_counts" } },
    { protocol: 2, id: 1, job: { kind: "cpu_counts" } },
    { protocol: SIMULATOR_PROTOCOL_VERSION, id: "1", job: { kind: "cpu_counts" } },
    { protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, job: { kind: "delete_everything" } },
  ]) {
    assert.equal(isSimulatorRequest(message), false, JSON.stringify(message));
    assert.equal(handleSimulatorRequest(message, context), null, JSON.stringify(message));
  }
});

test("replies are recognised only in the protocol's own shape", () => {
  assert.equal(isSimulatorResponse({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, ok: true, result: {} }), true);
  assert.equal(isSimulatorResponse({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, ok: false, error: "no" }), true);
  assert.equal(isSimulatorResponse({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, ok: true }), false, "ok without a result");
  assert.equal(isSimulatorResponse({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 1, ok: false }), false, "failure without a message");
  assert.equal(isSimulatorResponse({ protocol: 0, id: 1, ok: true, result: {} }), false, "another protocol version");
  assert.equal(isSimulatorResponse({ protocol: SIMULATOR_PROTOCOL_VERSION, id: 1.5, ok: true, result: {} }), false);
});
