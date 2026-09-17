import assert from "node:assert/strict";
import test from "node:test";
import { GATE_PARAM_MAX_CHARS, formatGateParam } from "./gate-param-label.ts";

test("a QASM-length angle is shortened to something that fits a column", () => {
  // The real case: Qiskit's qasm3 exporter prints pi/4 at full double precision,
  // and the diagram drew all 22 characters over the neighbouring gates.
  //
  // This asserted "0.785" until the pi-multiple path was added. The value is
  // pi/4 exactly, so "π/4" serves this test's own purpose strictly better: it is
  // shorter than the decimal AND it is not an approximation. Changed on purpose.
  const label = formatGateParam("0.78539816339744830961");
  assert.equal(label, "π/4");
  assert.ok(label.length <= GATE_PARAM_MAX_CHARS);
});

test("a numeric angle that is an exact multiple of pi is drawn as that multiple", () => {
  // The QPE controlled-power ladder, which computes its angles in radians. As
  // decimals these read 2.356, 4.712, 9.425 and the doubling — the entire point
  // of the block — is invisible.
  assert.equal(formatGateParam(String((3 * Math.PI) / 4)), "3π/4");
  assert.equal(formatGateParam(String((3 * Math.PI) / 2)), "3π/2");
  assert.equal(formatGateParam(String(3 * Math.PI)), "3π");
  assert.equal(formatGateParam(String(Math.PI)), "π");
  assert.equal(formatGateParam(String(-Math.PI / 4)), "-π/4");
});

test("a numeric angle that is NOT a multiple of pi stays a decimal", () => {
  // A wrong-looking fraction is worse than an honest decimal: once printed as
  // an exact multiple, a reader has no way to tell it was an approximation.
  assert.equal(formatGateParam("1.23456789"), "1.235");
  assert.equal(formatGateParam(String(Math.PI / 5)), "0.628");
  assert.equal(formatGateParam("0.5"), "0.5");
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

test("a huge but finite angle returns a label instead of overflowing the stack", () => {
  // (1e308 / pi) * 16 is Infinity, and every comparison below it degrades to
  // NaN: `NaN > tolerance` is false, so a naive reject branch does not fire and
  // the gcd recurses on NaN forever. Reported by Sourcery on PR 919 and
  // confirmed: a user typing this into Studio's angle field crashed the render.
  assert.doesNotThrow(() => formatGateParam("1e308"));
  assert.doesNotThrow(() => formatGateParam("-1e308"));
  assert.equal(formatGateParam("1e308"), "1e+308");
});

test("an angle NEAR a multiple of pi is not printed as that multiple", () => {
  // pi/16 + 1e-11 is not pi/16, and printing it as "π/16" makes an
  // approximation indistinguishable from an exact value. The old 1e-9
  // tolerance absorbed a gap of 5.09e-11 and did exactly that.
  const near = Math.PI / 16 + 1e-11;
  assert.notEqual(formatGateParam(String(near)), "π/16");
  // The tolerance still has to absorb a real string round trip, which is how
  // every generated angle actually arrives — measured gap: exactly zero.
  for (const exact of [(3 * Math.PI) / 4, (3 * Math.PI) / 2, 3 * Math.PI, Math.PI, -Math.PI / 4]) {
    const label = formatGateParam(String(exact));
    assert.ok(label.includes("π"), `${exact} round-tripped through a string must still read as a multiple of pi, got ${label}`);
  }
});
