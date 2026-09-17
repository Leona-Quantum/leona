import assert from "node:assert/strict";
import { test } from "node:test";

import { circuitMoments } from "./circuit-moments.ts";
import type { BuilderStep, CustomGateDefinition } from "./studio-builder.ts";
import { MAX_LIVE_PROBABILITY_QUBITS, playheadReading, stepsBeforeMoment } from "./studio-playhead.ts";
import { WORKED_EXAMPLES } from "./worked-examples.ts";

const BELL: BuilderStep[] = [
  { id: "h", gate: "H", qubits: [0] },
  { id: "cx", gate: "CX", qubits: [0, 1] },
  { id: "m0", gate: "M", qubits: [0] },
  { id: "m1", gate: "M", qubits: [1] },
];

function read(qubitCount: number, steps: BuilderStep[], moment: number, customGates: CustomGateDefinition[] = []) {
  const { columns } = circuitMoments(qubitCount, steps);
  return playheadReading({ qubitCount, steps, customGates, columns, moment });
}

function shares(reading: ReturnType<typeof read>): Record<string, number> {
  assert.equal(reading.kind, "ok");
  if (reading.kind !== "ok") return {};
  return Object.fromEntries(reading.bars.map((bar) => [bar.bitstring, Math.round(bar.probability * 1e6) / 1e6]));
}

test("before any gate the register is |0…0⟩", () => {
  assert.deepEqual(shares(read(2, BELL, 0)), { "00": 1 });
});

test("the playhead applies only the moments to its left", () => {
  // Bitstrings read q1 q0, the CPU lane's own order: H on q0 sets the low bit.
  assert.deepEqual(shares(read(2, BELL, 1)), { "00": 0.5, "01": 0.5 });
  assert.deepEqual(shares(read(2, BELL, 2)), { "00": 0.5, "11": 0.5 });
});

test("terminal measurements leave the outcome probabilities unchanged", () => {
  assert.deepEqual(shares(read(2, BELL, 3)), shares(read(2, BELL, 2)));
});

test("a gate after a measurement on the same wire switches the view off, but only past it", () => {
  const steps: BuilderStep[] = [...BELL, { id: "x", gate: "X", qubits: [0] }];
  const end = circuitMoments(2, steps).count;
  assert.deepEqual(read(2, steps, end), { kind: "unavailable", reason: "mid_circuit_measurement" });
  assert.equal(read(2, steps, 2).kind, "ok");
});

test("a register wider than the live limit is declined", () => {
  const wide = MAX_LIVE_PROBABILITY_QUBITS + 1;
  assert.deepEqual(read(wide, [{ id: "h", gate: "H", qubits: [0] }], 1), { kind: "unavailable", reason: "too_wide" });
});

test("custom gates run through their steps; opaque ones are declined", () => {
  const prep: CustomGateDefinition = { id: "prep", name: "Prep", qubitCount: 1, steps: [{ id: "inner", gate: "H", qubits: [0] }] };
  const grouped: BuilderStep[] = [{ id: "g", gate: "CUSTOM", customGateId: "prep", qubits: [1] }];
  assert.deepEqual(shares(read(2, grouped, 1, [prep])), { "00": 0.5, "10": 0.5 });
  assert.deepEqual(read(2, grouped, 1, [{ ...prep, opaque: true }]), { kind: "unavailable", reason: "opaque_custom" });
  assert.deepEqual(read(2, grouped, 1, []), { kind: "unavailable", reason: "opaque_custom" });
});

test("bars keep the most likely states and total the rest", () => {
  const steps: BuilderStep[] = [0, 1, 2, 3].map((qubit) => ({ id: `h${qubit}`, gate: "H", qubits: [qubit] }));
  const reading = read(4, steps, 1);
  assert.equal(reading.kind, "ok");
  if (reading.kind !== "ok") return;
  assert.equal(reading.bars.length, 8);
  assert.equal(reading.otherStates, 8);
  assert.ok(Math.abs(reading.otherProbability - 0.5) < 1e-12);
  // Ties break by basis index, so the list is stable between renders.
  assert.deepEqual(reading.bars.map((bar) => bar.bitstring).slice(0, 3), ["0000", "0001", "0010"]);
});

test("an angle outside the kernel's syntax is declined, not guessed", () => {
  // "pi/0" is explicitly invalid per parseGateAngle's own zero-denominator
  // check (gate-angle.ts) — genuinely outside the grammar, unlike the case
  // below.
  assert.deepEqual(read(1, [{ id: "r", gate: "RX", qubits: [0], param: "pi/0" }], 1), { kind: "unavailable", reason: "angle" });
});

test("a negative angle is read, not declined — studio-simulation.ts's angle() bug fix (block-library stage)", () => {
  // Previously this file's `angle()` had no `-?` at all, not even for a plain
  // decimal, so `-pi/2` — a value `BuilderStep.param`'s own grammar
  // (parseGateAngle) always accepted — was wrongly reported as unparseable.
  // This is the regression test for that fix, not for a change in what this
  // panel promises: still noiseless, still local, never a run or a record.
  const reading = read(1, [{ id: "r", gate: "RX", qubits: [0], param: "-pi/2" }], 1);
  assert.equal(reading.kind, "ok");
});

test("stepsBeforeMoment keeps array order", () => {
  assert.deepEqual(stepsBeforeMoment(["a", "b", "c"], [1, 0, 2], 2), ["a", "b"]);
});

test("equal probabilities list in counting order, not in float order", () => {
  // The real case, not a constructed one: three Hadamards alone reach exactly
  // equal amplitudes, so they cannot show this bug. It takes a gate whose
  // decomposition carries rounding — the Grover example's phase oracle, whose
  // multi-controlled Z leaves the eight amplitudes differing at the 17th
  // significant figure. Sorted by a bare subtraction the live figure listed
  // them 100, 111, 011, 101, 000, 001, 110, 010: an order with no meaning,
  // which a reader looking for one bitstring has to search rather than index
  // into. The states stay equally likely, so only the ordering is at issue.
  const grover = WORKED_EXAMPLES.find((example) => example.id === "grover-3q-101");
  assert.ok(grover, "grover-3q-101 is missing from WORKED_EXAMPLES");
  const throughOracle = grover.steps.slice(0, 2);
  const reading = playheadReading({
    qubitCount: grover.qubitCount,
    steps: throughOracle,
    customGates: grover.customGates,
    columns: throughOracle.map((_, index) => index),
    moment: throughOracle.length,
  });
  assert.equal(reading.kind, "ok");
  if (reading.kind !== "ok") return;
  assert.deepEqual(
    reading.bars.map((bar) => bar.bitstring),
    ["000", "001", "010", "011", "100", "101", "110", "111"],
  );
  // The premise: they really are all the same probability, so ordering them by
  // probability is meaningless and the tie-break is the whole answer.
  for (const bar of reading.bars) assert.ok(Math.abs(bar.probability - 0.125) < 1e-12);
});
