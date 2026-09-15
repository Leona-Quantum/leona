import assert from "node:assert/strict";
import test from "node:test";

import { WORKED_EXAMPLES, workedExample, expectationValue, type WorkedExample } from "./worked-examples.ts";
import { blockTemplate } from "./circuit-blocks.ts";
import { flattenBuilderSteps } from "./studio-builder.ts";
import { idealProbabilities, idealStatevector } from "./studio-simulation.ts";

/** Same convention as worked-examples.ts itself: character 0 of a bitstring
 * is the highest-numbered qubit, the last character is qubit 0. */
function indexOfBitstring(bitstring: string, qubitCount: number): number {
  assert.equal(bitstring.length, qubitCount, `bitstring "${bitstring}" length must equal qubitCount ${qubitCount}`);
  let index = 0;
  for (let charIndex = 0; charIndex < bitstring.length; charIndex += 1) {
    if (bitstring[charIndex] === "1") index |= 1 << (qubitCount - 1 - charIndex);
  }
  return index;
}

function bitstringFor(index: number, qubitCount: number): string {
  let result = "";
  for (let qubit = qubitCount - 1; qubit >= 0; qubit -= 1) result += (index & (1 << qubit)) === 0 ? "0" : "1";
  return result;
}

function collectCustomGateIds(steps: WorkedExample["steps"]): string[] {
  return steps.filter((step) => step.gate === "CUSTOM").map((step) => step.customGateId!);
}

test("every worked example resolves by id, and the registry has no duplicate ids", () => {
  const ids = WORKED_EXAMPLES.map((example) => example.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const example of WORKED_EXAMPLES) assert.equal(workedExample(example.id), example);
  assert.equal(workedExample("not-a-real-example"), undefined);
});

test("every example's `blocks` key resolves to a real BLOCK_TEMPLATES entry", () => {
  for (const example of WORKED_EXAMPLES) {
    for (const key of example.blocks) {
      assert.ok(blockTemplate(key), `${example.id} names block "${key}", which is not in BLOCK_TEMPLATES`);
    }
  }
});

test("every example carries at least one keyword, and every keyword is lower-case", () => {
  for (const example of WORKED_EXAMPLES) {
    assert.ok(example.keywords.length > 0, `${example.id} has no keywords`);
    for (const keyword of example.keywords) assert.equal(keyword, keyword.toLowerCase(), `${example.id}'s keyword "${keyword}" is not lower-case`);
  }
});

test("the fixed ids the Atlas mapping is written against are exactly the ones present", () => {
  const expected = [
    "bell-pair", "ghz-4", "deutsch-jozsa-3", "bernstein-vazirani-1011", "grover-3q-101",
    "qft-4q-roundtrip", "qpe-3-exact", "qpe-3-inexact", "draper-adder-5-plus-3",
    "ising-trotter-4", "qaoa-maxcut-4-cycle", "swap-test", "teleportation-deferred",
    "vqe-2q-transverse-ising",
  ];
  for (const id of expected) assert.ok(workedExample(id), `missing required id: ${id}`);
});

for (const example of WORKED_EXAMPLES) {
  test(`${example.id}: structure — notes cover every top-level step once, every CUSTOM step resolves, qubitCount is enough`, () => {
    const stepIds = example.steps.map((step) => step.id);
    assert.equal(new Set(stepIds).size, stepIds.length, "top-level step ids must be unique");
    assert.deepEqual(example.notes.map((n) => n.stepId), stepIds, "notes must cover every top-level step exactly once, in order");
    for (const noteEntry of example.notes) {
      assert.ok(noteEntry.text.en.length > 0, `empty English note for ${noteEntry.stepId}`);
      assert.ok(noteEntry.text.ja.length > 0, `empty Japanese note for ${noteEntry.stepId}`);
    }

    const definedIds = new Set(example.customGates.map((gate) => gate.id));
    // Every definition id is unique — a collision would mean instantiateBlock
    // failed to give two instances disjoint ids.
    assert.equal(definedIds.size, example.customGates.length, "customGates must have unique ids");
    for (const id of collectCustomGateIds(example.steps)) {
      assert.ok(definedIds.has(id), `top-level CUSTOM step references undefined gate ${id}`);
    }
    for (const gate of example.customGates) {
      for (const id of collectCustomGateIds(gate.steps)) {
        assert.ok(definedIds.has(id), `${gate.id}'s steps reference undefined gate ${id}`);
      }
    }

    const maxQubit = Math.max(-1, ...example.steps.flatMap((step) => step.qubits));
    assert.ok(maxQubit < example.qubitCount, `qubitCount ${example.qubitCount} is too small for qubit ${maxQubit}`);
    assert.ok(example.qubitCount <= 8, `example must use at most 8 qubits, has ${example.qubitCount}`);

    if (example.check.kind === "peak") assert.equal(example.check.bitstring.length, example.qubitCount);
    if (example.check.kind === "support") for (const b of example.check.bitstrings) assert.equal(b.length, example.qubitCount);
    if (example.check.kind === "distribution") for (const b of Object.keys(example.check.probabilities)) assert.equal(b.length, example.qubitCount);
    if (example.check.kind === "expectation") assert.ok(example.observable && example.observable.length > 0, `expectation check needs an observable`);
    if (example.observable) for (const term of example.observable) assert.equal(term.pauli.length, example.qubitCount);
  });

  test(`${example.id}: passes its own check`, () => {
    if (example.check.kind === "expectation") {
      const value = expectationValue(example.steps, example.customGates, example.qubitCount, example.observable!);
      assert.ok(
        Math.abs(value - example.check.value) < example.check.tolerance,
        `expected <H> ~= ${example.check.value} within ${example.check.tolerance}, got ${value}`,
      );
      return;
    }

    const flat = flattenBuilderSteps(example.steps, example.customGates);
    const probabilities = idealProbabilities({ qubitCount: example.qubitCount, steps: flat });
    const total = probabilities.reduce((sum, p) => sum + p, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `probabilities must sum to 1, got ${total}`);

    if (example.check.kind === "peak") {
      const index = indexOfBitstring(example.check.bitstring, example.qubitCount);
      assert.ok(
        probabilities[index] >= example.check.minProbability,
        `expected P(${example.check.bitstring}) >= ${example.check.minProbability}, got ${probabilities[index]}`,
      );
    } else if (example.check.kind === "support") {
      const allowed = new Set(example.check.bitstrings.map((b) => indexOfBitstring(b, example.qubitCount)));
      for (let index = 0; index < probabilities.length; index += 1) {
        if (allowed.has(index)) continue;
        assert.ok(probabilities[index] < 1e-9, `unexpected probability ${probabilities[index]} at ${bitstringFor(index, example.qubitCount)}`);
      }
    } else if (example.check.kind === "distribution") {
      for (const [bitstring, expected] of Object.entries(example.check.probabilities)) {
        const index = indexOfBitstring(bitstring, example.qubitCount);
        assert.ok(
          Math.abs(probabilities[index] - expected) < example.check.tolerance,
          `expected P(${bitstring}) ~= ${expected} within ${example.check.tolerance}, got ${probabilities[index]}`,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// VQE: independently re-derive both the angles and the ground energy in the
// test, rather than trusting the example's own recorded numbers.

function pauliExpectationLocal(state: { real: Float64Array; imaginary: Float64Array }, qubitCount: number, pauli: string): number {
  const dim = state.real.length;
  const outReal = Float64Array.from(state.real);
  const outImaginary = Float64Array.from(state.imaginary);
  for (let charIndex = 0; charIndex < pauli.length; charIndex += 1) {
    const letter = pauli[charIndex];
    if (letter === "I") continue;
    const qubit = qubitCount - 1 - charIndex;
    const mask = 1 << qubit;
    for (let index = 0; index < dim; index += 1) {
      if ((index & mask) !== 0) continue;
      const paired = index | mask;
      if (letter === "Z") {
        outReal[paired] = -outReal[paired];
        outImaginary[paired] = -outImaginary[paired];
      } else if (letter === "X") {
        const re0 = outReal[index], im0 = outImaginary[index], re1 = outReal[paired], im1 = outImaginary[paired];
        outReal[index] = re1; outImaginary[index] = im1;
        outReal[paired] = re0; outImaginary[paired] = im0;
      }
    }
  }
  let expectation = 0;
  for (let index = 0; index < dim; index += 1) expectation += state.real[index] * outReal[index] + state.imaginary[index] * outImaginary[index];
  return expectation;
}

function vqeEnergy(angles: readonly number[]): number {
  const steps = [
    { id: "a", gate: "RY" as const, qubits: [0], param: String(angles[0]) },
    { id: "b", gate: "RY" as const, qubits: [1], param: String(angles[1]) },
    { id: "c", gate: "CX" as const, qubits: [0, 1] },
    { id: "d", gate: "RY" as const, qubits: [0], param: String(angles[2]) },
    { id: "e", gate: "RY" as const, qubits: [1], param: String(angles[3]) },
  ];
  const state = idealStatevector({ qubitCount: 2, steps });
  return pauliExpectationLocal(state, 2, "ZZ") + 0.5 * pauliExpectationLocal(state, 2, "XI") + 0.5 * pauliExpectationLocal(state, 2, "IX");
}

/** Exact eigenvalues of H = Z@Z + 0.5*(X@I + I@X) as a 4x4 real symmetric
 * matrix, via Jacobi rotations — deterministic, no randomness, bounded
 * iteration count. Basis index = q0 + 2*q1 (this file's own convention). */
function groundEnergyByDiagonalization(): number {
  const zz = (index: number) => {
    const z0 = (index & 1) === 0 ? 1 : -1;
    const z1 = (index & 2) === 0 ? 1 : -1;
    return z0 * z1;
  };
  const H = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i += 1) {
    H[i][i] += zz(i);
    H[i ^ 1][i] += 0.5;
    H[i ^ 2][i] += 0.5;
  }
  const A = H.map((row) => row.slice());
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let offDiagonal = 0;
    for (let p = 0; p < 4; p += 1) for (let q = p + 1; q < 4; q += 1) offDiagonal += A[p][q] * A[p][q];
    if (offDiagonal < 1e-24) break;
    for (let p = 0; p < 4; p += 1) {
      for (let q = p + 1; q < 4; q += 1) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const app = A[p][p], aqq = A[q][q], apq = A[p][q];
        A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        A[p][q] = 0; A[q][p] = 0;
        for (let k = 0; k < 4; k += 1) {
          if (k === p || k === q) continue;
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[p][k] = A[k][p];
          A[k][q] = s * akp + c * akq; A[q][k] = A[k][q];
        }
      }
    }
  }
  return Math.min(A[0][0], A[1][1], A[2][2], A[3][3]);
}

test("VQE: a deterministic coarse grid search over this file's own simulator finds an ansatz reaching the exact ground energy", () => {
  const e0 = groundEnergyByDiagonalization();
  assert.ok(Math.abs(e0 - -Math.sqrt(2)) < 1e-9, `expected E0 = -sqrt(2), got ${e0}`);

  // Deterministic grid, multiples of pi/4 in each of the 4 angles (8^4 = 4096
  // evaluations of a 2-qubit circuit — bounded and fast).
  const grid = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
  let best = { angles: [0, 0, 0, 0], energy: Number.POSITIVE_INFINITY };
  for (const a0 of grid) for (const a1 of grid) for (const a2 of grid) for (const a3 of grid) {
    const energy = vqeEnergy([a0, a1, a2, a3]);
    if (energy < best.energy) best = { angles: [a0, a1, a2, a3], energy };
  }
  assert.ok(Math.abs(best.energy - e0) < 1e-6, `grid search should reach E0 exactly at this resolution, got ${best.energy} vs E0=${e0}`);

  // The worked example's own recorded angles (pi/2, 5*pi/4, 0, 0) must also
  // reach the same energy.
  const recorded = vqeEnergy([Math.PI / 2, (5 * Math.PI) / 4, 0, 0]);
  assert.ok(Math.abs(recorded - e0) < 1e-9, `recorded VQE angles should reach E0, got ${recorded}`);
});
