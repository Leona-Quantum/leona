import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAmplitude, gateAngleRadians, gateFamily, gateUnitary, type Amplitude } from "./gate-inspector.ts";
import { singleQubitUnitary } from "./studio-simulation.ts";

test("gateAngleRadians reads exactly what parseGateAngle accepts", () => {
  assert.equal(gateAngleRadians("pi/4"), Math.PI / 4);
  assert.equal(gateAngleRadians("-pi/2"), -Math.PI / 2);
  assert.equal(gateAngleRadians("2*pi"), 2 * Math.PI);
  assert.equal(gateAngleRadians("0.5"), 0.5);
  assert.equal(gateAngleRadians("1e-3"), 0.001);
  assert.equal(gateAngleRadians("pi/0"), null);
  assert.equal(gateAngleRadians("tau"), null);
  assert.equal(gateAngleRadians(undefined), null);
});

test("formatAmplitude names exact values and rounds the rest", () => {
  assert.equal(formatAmplitude({ re: 0, im: 0 }), "0");
  assert.equal(formatAmplitude({ re: 1e-17, im: 0 }), "0");
  assert.equal(formatAmplitude({ re: 1, im: 0 }), "1");
  assert.equal(formatAmplitude({ re: -1, im: 0 }), "−1");
  assert.equal(formatAmplitude({ re: 0, im: 1 }), "i");
  assert.equal(formatAmplitude({ re: 0, im: -1 }), "−i");
  assert.equal(formatAmplitude({ re: Math.SQRT1_2, im: 0 }), "1/√2");
  assert.equal(formatAmplitude({ re: -Math.SQRT1_2, im: 0 }), "−1/√2");
  assert.equal(formatAmplitude({ re: Math.SQRT1_2, im: Math.SQRT1_2 }), "1/√2 + i/√2");
  assert.equal(formatAmplitude({ re: Math.cos(Math.PI / 8), im: -Math.sin(Math.PI / 8) }), "0.924 − 0.383i");
});

test("the inspector shows the simulator's own one-qubit matrices", () => {
  const flat = (rows: Amplitude[][]) => rows.flat().flatMap(({ re, im }) => [re, im]);
  assert.deepEqual(flat(gateUnitary({ gate: "H" })!.rows), [...singleQubitUnitary("H")]);
  assert.deepEqual(flat(gateUnitary({ gate: "RZ", param: "pi/4" })!.rows), [...singleQubitUnitary("RZ", Math.PI / 4)]);
});

test("every matrix the inspector prints is unitary", () => {
  const steps = [
    { gate: "H" }, { gate: "X" }, { gate: "Y" }, { gate: "Z" }, { gate: "S" }, { gate: "T" },
    { gate: "RX", param: "pi/3" }, { gate: "RY", param: "-pi/5" }, { gate: "RZ", param: "0.7" },
    { gate: "CX" }, { gate: "CZ" }, { gate: "SWAP" },
  ] as const;
  for (const step of steps) {
    const unitary = gateUnitary(step);
    assert.ok(unitary, `${step.gate} has a matrix`);
    const { rows, size } = unitary;
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        // (U U†)_ij = Σ_k U_ik conj(U_jk)
        let re = 0;
        let im = 0;
        for (let k = 0; k < size; k += 1) {
          re += rows[i][k].re * rows[j][k].re + rows[i][k].im * rows[j][k].im;
          im += rows[i][k].im * rows[j][k].re - rows[i][k].re * rows[j][k].im;
        }
        assert.ok(Math.abs(re - (i === j ? 1 : 0)) < 1e-12 && Math.abs(im) < 1e-12, `${step.gate} U U† at ${i},${j}`);
      }
    }
  }
});

test("two-qubit matrices are written in the |control target⟩ basis", () => {
  const cx = gateUnitary({ gate: "CX" })!;
  assert.deepEqual(cx.rows[2].map((cell) => cell.re), [0, 0, 0, 1]);
  assert.deepEqual(cx.rows[3].map((cell) => cell.re), [0, 0, 1, 0]);
  assert.equal(gateUnitary({ gate: "CZ" })!.rows[3][3].re, -1);
  assert.deepEqual(gateUnitary({ gate: "SWAP" })!.rows[1].map((cell) => cell.re), [0, 0, 1, 0]);
});

test("measurement, custom gates and unreadable angles have no matrix", () => {
  assert.equal(gateUnitary({ gate: "M" }), null);
  assert.equal(gateUnitary({ gate: "CUSTOM" }), null);
  assert.equal(gateUnitary({ gate: "RX", param: "theta" }), null);
  assert.equal(gateUnitary({ gate: "RY" }), null);
});

test("gate families", () => {
  assert.equal(gateFamily("H"), "clifford");
  assert.equal(gateFamily("T"), "clifford");
  assert.equal(gateFamily("RY"), "rotation");
  assert.equal(gateFamily("SWAP"), "entangler");
  assert.equal(gateFamily("M"), "measure");
  assert.equal(gateFamily("CUSTOM"), "custom");
});
