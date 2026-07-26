import assert from "node:assert/strict";
import test from "node:test";
import { GATE_PARAM_MAX_CHARS, formatGateParam } from "./gate-param-label.ts";

test("a QASM-length angle is shortened to something that fits a column", () => {
  // The real case: Qiskit's qasm3 exporter prints pi/4 at full double precision,
  // and the diagram drew all 22 characters over the neighbouring gates.
  assert.equal(formatGateParam("0.78539816339744830961"), "0.785");
});

test("an already-short decimal is left as it is", () => {
  assert.equal(formatGateParam("0.5"), "0.5");
  assert.equal(formatGateParam("-1.25"), "-1.25");
});

test("a symbolic angle keeps its meaning rather than becoming a decimal", () => {
  // pi/2 is exact, short, and what the user typed. 1.571 is none of those.
  assert.equal(formatGateParam("pi/2"), "π/2");
  assert.equal(formatGateParam("2*pi"), "2π");
});

test("a tiny angle is not rounded into a zero it is not", () => {
  // "0.000" reads as no rotation at all, which is a different circuit.
  assert.equal(formatGateParam("0.0000001"), "≈0⁺");
  assert.equal(formatGateParam("-0.0000001"), "≈0⁻");
  assert.equal(formatGateParam("0"), "0");
});

test("a long symbolic expression is truncated visibly", () => {
  const label = formatGateParam("pi/2 + theta_0/3 - alpha");
  assert.ok(label.length <= GATE_PARAM_MAX_CHARS);
  assert.ok(label.endsWith("…"));
});

test("scientific notation is still read as a number", () => {
  assert.equal(formatGateParam("1.5e-2"), "0.015");
});

test("an empty or blank param draws nothing", () => {
  assert.equal(formatGateParam(""), "");
  assert.equal(formatGateParam("   "), "");
});
