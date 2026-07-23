import assert from "node:assert/strict";
import test from "node:test";
import { cpuSimulationEligibility, runCpuSimulation, sourceFingerprint } from "./studio-simulation.ts";
import { TIER_LIMITS } from "./account-tier.ts";

const BELL_SOURCE = [
  "from qiskit import QuantumCircuit",
  "",
  "qc = QuantumCircuit(2)",
  "qc.h(0)",
  "qc.cx(0, 1)",
  "qc.measure_all()",
].join("\n");

test("bounded CPU simulation samples only Bell-state outcomes and records provenance", () => {
  const request = {
    artifactId: "artifact-bell",
    artifactVersionId: "version-bell",
    code: BELL_SOURCE,
    framework: "qiskit" as const,
    shots: 128,
    seed: 1729,
    now: new Date("2026-07-23T00:00:00.000Z"),
    id: "sim-bell",
  };
  const record = runCpuSimulation(request);

  assert.deepEqual(Object.keys(record.counts).sort(), ["00", "11"]);
  assert.equal(Object.values(record.counts).reduce((sum, count) => sum + count, 0), 128);
  assert.equal(record.sourceFingerprint, sourceFingerprint(BELL_SOURCE));
  assert.equal(record.artifactVersionId, "version-bell");
  assert.equal(record.measured, true);
  assert.equal(record.simulator, "Leona bounded browser statevector");
  assert.deepEqual(runCpuSimulation(request).counts, record.counts);
});

test("a basis-state circuit yields the exact deterministic outcome", () => {
  const record = runCpuSimulation({
    artifactId: "artifact-x",
    code: [
      "from qiskit import QuantumCircuit",
      "qc = QuantumCircuit(1)",
      "qc.x(0)",
      "qc.measure_all()",
    ].join("\n"),
    framework: "qiskit",
    shots: 32,
    seed: 0,
    now: new Date("2026-07-23T00:00:00.000Z"),
    id: "sim-x",
  });

  assert.deepEqual(record.counts, { "1": 32 });
});

test("stored OpenQASM can supply an explicit standard-gate model for otherwise unsupported source", () => {
  const source = [
    "from qiskit import QuantumCircuit",
    "import numpy as np",
    "qc = QuantumCircuit(1)",
    "qc.p(np.pi / 4, 0)",
    "qc.measure_all()",
  ].join("\n");
  const qasm = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit _qubit0;",
    "bit _bit0;",
    "p(pi/4) _qubit0;",
    "_bit0 = measure _qubit0;",
  ].join("\n");
  const record = runCpuSimulation({
    artifactId: "artifact-p",
    code: source,
    framework: "qiskit",
    qasm,
    shots: 24,
    seed: 9,
    now: new Date("2026-07-23T00:00:00.000Z"),
    id: "sim-p",
  });

  assert.equal(record.model, "openqasm_standard_decomposition");
  assert.equal(record.interchangeFingerprint, sourceFingerprint(qasm));
  assert.equal(record.measured, true);
  assert.deepEqual(record.counts, { "0": 24 });
});

test("generated scalar OpenQASM provenance keeps a saved P-phase artifact CPU-simulable", () => {
  const source = [
    "from qiskit import QuantumCircuit",
    "import numpy as np",
    "qc = QuantumCircuit(1)",
    "qc.p(np.pi / 4, 0)",
  ].join("\n");
  const qasm = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit _qubit0;",
    "p(pi/4) _qubit0;",
  ].join("\n");
  const record = runCpuSimulation({
    artifactId: "artifact-p-scalar",
    code: source,
    framework: "qiskit",
    qasm,
    shots: 24,
    seed: 9,
    now: new Date("2026-07-23T00:00:00.000Z"),
    id: "sim-p-scalar",
  });

  assert.equal(record.model, "openqasm_standard_decomposition");
  assert.equal(record.interchangeFingerprint, sourceFingerprint(qasm));
  assert.deepEqual(record.counts, { "0": 24 });
});

test("eligibility fails closed for an unsaved artifact, export-only source, and unsupported code", () => {
  assert.deepEqual(cpuSimulationEligibility({ artifactId: "", code: BELL_SOURCE, framework: "qiskit" }), {
    eligible: false,
    reason: "artifact_required",
    sourceFingerprint: sourceFingerprint(BELL_SOURCE),
  });
  const exportOnly = cpuSimulationEligibility({ artifactId: "artifact", code: BELL_SOURCE, framework: "openqasm3" });
  const unsupported = cpuSimulationEligibility({ artifactId: "artifact", code: "print('not a circuit')", framework: "qiskit" });
  assert.equal(exportOnly.eligible, false);
  assert.equal(unsupported.eligible, false);
  if (!exportOnly.eligible) assert.equal(exportOnly.reason, "framework_unavailable");
  if (!unsupported.eligible) assert.equal(unsupported.reason, "source_unavailable");
});

test("simulation refuses out-of-range input instead of silently changing it", () => {
  assert.throws(() => runCpuSimulation({
    artifactId: "artifact",
    code: BELL_SOURCE,
    framework: "qiskit",
    shots: 0,
    seed: 1,
  }), /Shots must be a whole number/);
});

const ghzSource = (n: number) => [
  "from qiskit import QuantumCircuit",
  "",
  `qc = QuantumCircuit(${n})`,
  "qc.h(0)",
  ...Array.from({ length: n - 1 }, (_, i) => `qc.cx(${i}, ${i + 1})`),
  "qc.measure_all()",
].join("\n");

test("a circuit too wide for the canvas still simulates — drawing and executing are different limits", () => {
  // Regression for a defect this lane hid: cpuSimulationEligibility reuses the
  // canvas parser, whose six-wire grid limit silently became the *simulation*
  // limit. Raising the simulation ceiling alone changed nothing, because a
  // 10-qubit circuit never got past the parser.
  const record = runCpuSimulation(
    { artifactId: "artifact", code: ghzSource(10), framework: "qiskit", shots: 512, seed: 5 },
    TIER_LIMITS.free,
  );
  assert.equal(record.qubitCount, 10);
  // A GHZ state has exactly two outcomes. Anything else means the wider path
  // reconstructed a different circuit rather than the same one.
  assert.deepEqual(Object.keys(record.counts).sort(), ["0".repeat(10), "1".repeat(10)]);
});

test("an over-width circuit is refused as a plan limit, not as unreadable source", () => {
  // 18 qubits parses fine; the free tier just does not cover it. Reporting
  // `source_unavailable` there would blame the user's code for a plan boundary.
  const free = cpuSimulationEligibility(
    { artifactId: "artifact", code: ghzSource(18), framework: "qiskit" },
    TIER_LIMITS.free,
  );
  assert.equal(free.eligible, false);
  if (!free.eligible) assert.equal(free.reason, "qubit_limit");

  const developer = cpuSimulationEligibility(
    { artifactId: "artifact", code: ghzSource(18), framework: "qiskit" },
    TIER_LIMITS.developer,
  );
  assert.equal(developer.eligible, true);
});
