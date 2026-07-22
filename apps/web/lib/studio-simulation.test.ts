import assert from "node:assert/strict";
import test from "node:test";
import { cpuSimulationEligibility, runCpuSimulation, sourceFingerprint } from "./studio-simulation.ts";

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
    "qubit[1] q;",
    "bit[1] c;",
    "p(pi/4) q[0];",
    "c = measure q;",
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
