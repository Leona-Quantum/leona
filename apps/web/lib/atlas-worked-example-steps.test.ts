import assert from "node:assert/strict";
import test from "node:test";

import type { BuilderStep, CustomGateDefinition } from "./studio-builder.ts";
import {
  formatSignificant,
  hamiltonianFormula,
  observableLabel,
  openedStepGates,
  pauliTermSymbol,
  stepLabel,
  workedExampleDrawing,
  workedExampleReading,
} from "./atlas-worked-example-steps.ts";

// A tiny 3-qubit fixture: H on q0, a placed 2-qubit "block" on q1/q2 (X then
// CX, so its own inner qubit 0 maps to the outer q1 and inner qubit 1 to the
// outer q2), then RY(pi/3) on q0. Hand-built rather than placed with
// circuit-blocks.ts — this file owns the view model, not the block library.
const BLOCK: CustomGateDefinition = {
  id: "block-1",
  name: "Demo block(2)",
  qubitCount: 2,
  steps: [
    { id: "inner-0", gate: "X", qubits: [0] },
    { id: "inner-1", gate: "CX", qubits: [0, 1] },
  ],
};

const STEPS: BuilderStep[] = [
  { id: "step-0", gate: "H", qubits: [0] },
  { id: "step-1", gate: "CUSTOM", qubits: [1, 2], customGateId: "block-1" },
  { id: "step-2", gate: "RY", qubits: [0], param: "pi/3" },
];

test("workedExampleDrawing: one box per top-level step, block name from its own definition", () => {
  const drawing = workedExampleDrawing(STEPS, [BLOCK], 3);
  assert.deepEqual(drawing.wires, ["q0", "q1", "q2"]);
  assert.equal(drawing.operations.length, 3);
  assert.deepEqual(drawing.operations[0], { label: "H", qubits: [0], tone: "neutral" });
  assert.deepEqual(drawing.operations[1], { label: "Demo block(2)", qubits: [1, 2], tone: "accent" });
  assert.deepEqual(drawing.operations[2], { label: "RY(pi/3)", qubits: [0], tone: "neutral" });
});

test("stepLabel: a raw gate's mnemonic (with its angle), a block's own name, and a safe fallback", () => {
  assert.equal(stepLabel(STEPS[0], [BLOCK]), "H");
  assert.equal(stepLabel(STEPS[1], [BLOCK]), "Demo block(2)");
  assert.equal(stepLabel(STEPS[2], [BLOCK]), "RY(pi/3)");
  // A CUSTOM step whose definition is not in the list passed — degrades to a
  // safe placeholder instead of throwing.
  assert.equal(stepLabel(STEPS[1], []), "Block");
});

test("openedStepGates: nothing for a raw gate, flattenBuilderSteps's own remapped gates for a block", () => {
  assert.deepEqual(openedStepGates(STEPS[0], [BLOCK]), []);
  const opened = openedStepGates(STEPS[1], [BLOCK]);
  assert.equal(opened.length, 2);
  // flattenBuilderSteps remaps the block's own qubits (0, 1) through its
  // placement (qubits [1, 2]) — this file does not re-derive that mapping,
  // only reads it off.
  assert.deepEqual(opened.map((gate) => [gate.label, [...gate.qubits]]), [
    ["X", [1]],
    ["CX", [1, 2]],
  ]);
});

test("workedExampleReading: probability bars after a chosen step, from the real simulator", () => {
  // After step 0 only (H on q0, q1/q2 untouched): an equal split between
  // 000 and 001 (bitstringFor prints the highest qubit first, so q0 is the
  // last character) and nothing else.
  const reading = workedExampleReading(STEPS, [BLOCK], 3, 0);
  assert.equal(reading.kind, "probabilities");
  if (reading.kind !== "probabilities") throw new Error("unreachable");
  assert.equal(reading.reading.kind, "ok");
  if (reading.reading.kind !== "ok") throw new Error("unreachable");
  const byBitstring = Object.fromEntries(reading.reading.bars.map((bar) => [bar.bitstring, bar.probability]));
  assert.equal(Object.keys(byBitstring).length, 2);
  assert.ok(Math.abs((byBitstring["000"] ?? 0) - 0.5) < 1e-9);
  assert.ok(Math.abs((byBitstring["001"] ?? 0) - 0.5) < 1e-9);
});

test("workedExampleReading: an observable switches to expectation-value mode", () => {
  // <Z> on q0 right after H|0> on q0 (q1/q2 untouched) is exactly 0 — the
  // whole point of superposition. Pauli string reads highest-qubit-first, so
  // "IIZ" puts Z on q0.
  const reading = workedExampleReading(STEPS, [BLOCK], 3, 0, [{ coefficient: 1, pauli: "IIZ" }]);
  assert.equal(reading.kind, "expectation");
  if (reading.kind !== "expectation") throw new Error("unreachable");
  assert.ok(Math.abs(reading.value) < 1e-9, `expected ~0, got ${reading.value}`);
});

test("workedExampleReading: the reading changes as the chosen step moves forward", () => {
  // After every step (H, the block, RY): q0 is no longer a fixed observable
  // value — just confirm the reading actually depends on `currentStep`
  // rather than always reading the full circuit.
  const afterFirst = workedExampleReading(STEPS, [BLOCK], 3, 0, [{ coefficient: 1, pauli: "IIZ" }]);
  const afterLast = workedExampleReading(STEPS, [BLOCK], 3, STEPS.length - 1, [{ coefficient: 1, pauli: "IIZ" }]);
  assert.equal(afterFirst.kind, "expectation");
  assert.equal(afterLast.kind, "expectation");
  if (afterFirst.kind !== "expectation" || afterLast.kind !== "expectation") throw new Error("unreachable");
  assert.notEqual(afterFirst.value, afterLast.value);
});

// ---------------------------------------------------------------------------
// Observable labelling — fixed after a live screenshot showed
// quantum-teleportation's own Z-on-the-target-qubit reading mislabelled as
// an energy, "⟨H⟩". These are exactly the coordinator-specified cases: a
// single term, several terms, a coefficient other than 1, and an
// all-identity term.

test("pauliTermSymbol: identity factors omitted, subscripted by qubit index", () => {
  // "ZII" over 3 qubits: character 0 (highest) is qubit 2, so this is Z on
  // qubit 2 — quantum-teleportation's actual observable.
  assert.equal(pauliTermSymbol("ZII"), "Z₂");
  // "ZZ" over 2 qubits: char0 -> qubit1, char1 -> qubit0; sorted ascending.
  assert.equal(pauliTermSymbol("ZZ"), "Z₀Z₁");
  assert.equal(pauliTermSymbol("XI"), "X₁");
  assert.equal(pauliTermSymbol("IX"), "X₀");
});

test("pauliTermSymbol: an all-identity string has nothing to omit down to but I itself", () => {
  assert.equal(pauliTermSymbol("III"), "I");
  assert.equal(pauliTermSymbol(""), "I");
});

test("observableLabel: a single unit-coefficient term is the observable itself, not an energy", () => {
  const label = observableLabel([{ coefficient: 1, pauli: "ZII" }]);
  assert.deepEqual(label, { kind: "term", symbol: "Z₂" });
});

test("observableLabel: several terms is a genuine Hamiltonian", () => {
  const label = observableLabel([
    { coefficient: 1, pauli: "ZZ" },
    { coefficient: 0.5, pauli: "XI" },
    { coefficient: 0.5, pauli: "IX" },
  ]);
  assert.equal(label.kind, "hamiltonian");
  if (label.kind !== "hamiltonian") throw new Error("unreachable");
  assert.equal(label.formula, "H = Z₀Z₁ + 0.5 X₁ + 0.5 X₀");
});

test("observableLabel: a single term with a coefficient other than 1 is also a Hamiltonian", () => {
  // <0.5 Z> is not the same reading as <Z> - a bare "Z" label would silently
  // drop the factor of 0.5, so this is not the clean single-term case either.
  const label = observableLabel([{ coefficient: 0.5, pauli: "Z" }]);
  assert.equal(label.kind, "hamiltonian");
  if (label.kind !== "hamiltonian") throw new Error("unreachable");
  assert.equal(label.formula, "H = 0.5 Z₀");
});

test("observableLabel: an all-identity single term still degrades to a readable symbol", () => {
  const label = observableLabel([{ coefficient: 1, pauli: "III" }]);
  assert.deepEqual(label, { kind: "term", symbol: "I" });
});

test("hamiltonianFormula: a negative coefficient prints with the proper minus sign, not a hyphen", () => {
  assert.equal(
    hamiltonianFormula([
      { coefficient: 1, pauli: "Z" },
      { coefficient: -0.5, pauli: "X" },
    ]),
    "H = Z₀ − 0.5 X₀",
  );
  // A negative first term too.
  assert.equal(hamiltonianFormula([{ coefficient: -1, pauli: "Z" }]), "H = −Z₀");
});

test("formatSignificant: 3 significant figures with the proper minus sign, matching the specified examples", () => {
  assert.equal(formatSignificant(1), "1.00");
  assert.equal(formatSignificant(-Math.sqrt(2)), "−1.41");
  assert.equal(formatSignificant(1 / Math.sqrt(2)), "0.707");
  assert.equal(formatSignificant(0), "0.00");
  assert.equal(formatSignificant(-0), "0.00", "negative zero must not print as -0.00");
});
