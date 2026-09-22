import assert from "node:assert/strict";
import test from "node:test";

import { parameterSweepCsv, runParameterSweep, sweepCircuitIssue } from "./studio-parameter-sweep.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";

const ry: ParsedBuilderCircuit = { qubitCount: 1, steps: [{ id: "turn", gate: "RY", qubits: [0], param: "pi/4" }] };

test("a RY sweep follows sin squared and leaves the source circuit untouched", () => {
  const result = runParameterSweep({ circuit: ry, stepId: "turn", measuredQubit: 0, startDegrees: 0, endDegrees: 360, points: 5 });
  assert.deepEqual(result.rows.map((row) => Math.round(row.pOne * 1e8) / 1e8), [0, 0.5, 1, 0.5, 0]);
  result.rows.forEach((row, index) => assert.ok(Math.abs(row.zExpectation - [1, 0, -1, 0, 1][index]) < 1e-8));
  assert.equal(result.rows[1].zExpectation, 0);
  assert.equal(result.rows[3].zExpectation, 0);
  assert.equal(ry.steps[0].param, "pi/4");
  assert.equal(result.originalAngle, "pi/4");
  assert.equal(result.rows[4].angleDegrees, 360);
});

test("the measured qubit is a marginal, not a full-register bitstring", () => {
  const bell: ParsedBuilderCircuit = { qubitCount: 2, steps: [
    { id: "turn", gate: "RY", qubits: [0], param: "0" },
    { id: "entangle", gate: "CX", qubits: [0, 1] },
    { id: "m0", gate: "M", qubits: [0] },
    { id: "m1", gate: "M", qubits: [1] },
  ] };
  const result = runParameterSweep({ circuit: bell, stepId: "turn", measuredQubit: 1, startDegrees: 0, endDegrees: 180, points: 3 });
  assert.deepEqual(result.rows.map((row) => Math.round(row.pOne * 1e8) / 1e8), [0, 0.5, 1]);
});

test("phase interference is measured from amplitudes, not from a gate label", () => {
  const circuit: ParsedBuilderCircuit = { qubitCount: 1, steps: [
    { id: "before", gate: "H", qubits: [0] },
    { id: "phase", gate: "RZ", qubits: [0], param: "pi/2" },
    { id: "after", gate: "H", qubits: [0] },
  ] };
  const result = runParameterSweep({ circuit, stepId: "phase", measuredQubit: 0, startDegrees: 0, endDegrees: 180, points: 3 });
  assert.deepEqual(result.rows.map((row) => Math.round(row.pOne * 1e8) / 1e8), [0, 0.5, 1]);
});

test("refuses mid-circuit measurement, custom gates, invalid angles, and excessive total work", () => {
  assert.equal(sweepCircuitIssue({ qubitCount: 1, steps: [
    { id: "measure", gate: "M", qubits: [0] }, { id: "turn", gate: "RY", qubits: [0], param: "pi" },
  ] }), "measurement");
  assert.equal(sweepCircuitIssue({ qubitCount: 1, steps: [{ id: "custom", gate: "CUSTOM", qubits: [0], customGateId: "x" }] }), "custom");
  assert.equal(sweepCircuitIssue({ qubitCount: 1, steps: [{ id: "turn", gate: "RY", qubits: [0], param: "variable" }] }), "angle");
  assert.throws(() => runParameterSweep({ circuit: ry, stepId: "turn", measuredQubit: 0, startDegrees: 0, endDegrees: 360, points: 42 }), /3–41/);
  assert.throws(() => runParameterSweep({ circuit: ry, stepId: "turn", measuredQubit: 0, startDegrees: 360, endDegrees: 0, points: 5 }), /end after the start/);
  const large: ParsedBuilderCircuit = { qubitCount: 12, steps: Array.from({ length: 512 }, (_, index) => ({ id: String(index), gate: "RY" as const, qubits: [0], param: "0" })) };
  assert.throws(() => runParameterSweep({ circuit: large, stepId: "0", measuredQubit: 0, startDegrees: 0, endDegrees: 360, points: 41 }), /too large/);
});

test("CSV preserves each experimental parameter and escapes source labels", () => {
  const result = runParameterSweep({ circuit: ry, stepId: "turn", measuredQubit: 0, startDegrees: 0, endDegrees: 180, points: 3 });
  const csv = parameterSweepCsv(result, 'sha,"example"');
  assert.equal(csv.split("\n").length, 5);
  assert.match(csv, /"sha,""example"""/);
  assert.match(csv, /"turn",RY/);
});
