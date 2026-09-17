import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EFFECT_QUBITS,
  isProduct,
  readEffect,
  reducedPurity,
  stepEffect,
  type StepEffectReading,
} from "./atlas-step-effect.ts";
import { describeStepEffect, formatPhase, shouldShowPhases } from "./atlas-step-effect-copy.ts";
import { WORKED_EXAMPLES } from "./worked-examples.ts";
import type { BuilderStep } from "./studio-builder.ts";

/**
 * A statevector written out by hand, so a reading can be tested against a
 * state whose physics is obvious rather than against whatever the kernel
 * happens to produce — the only way a test of "does this classifier say
 * `phase`" can fail for the reason it names.
 */
function state(amplitudes: ReadonlyArray<readonly [number, number]>): {
  real: Float64Array;
  imaginary: Float64Array;
} {
  const real = new Float64Array(amplitudes.length);
  const imaginary = new Float64Array(amplitudes.length);
  amplitudes.forEach(([re, im], index) => {
    real[index] = re;
    imaginary[index] = im;
  });
  return { real, imaginary };
}

const ROOT_HALF = Math.SQRT1_2;
const KET_00 = state([[1, 0], [0, 0], [0, 0], [0, 0]]);
const KET_11 = state([[0, 0], [0, 0], [0, 0], [1, 0]]);
const PLUS_PLUS = state([[0.5, 0], [0.5, 0], [0.5, 0], [0.5, 0]]);
/** (|00⟩ + |01⟩ + |10⟩ − |11⟩)/2 — same probabilities as PLUS_PLUS, one sign flipped. */
const PHASE_MARKED = state([[0.5, 0], [0.5, 0], [0.5, 0], [-0.5, 0]]);
/** (|00⟩ + |11⟩)/√2 — a Bell pair, the standard entangled two-qubit state. */
const BELL = state([[ROOT_HALF, 0], [0, 0], [0, 0], [ROOT_HALF, 0]]);

function ok(reading: ReturnType<typeof readEffect>): StepEffectReading {
  assert.equal(reading.kind, "ok");
  return reading;
}

test("a step that leaves probabilities alone and flips a sign reads as a phase change, not as no change", () => {
  const reading = ok(readEffect(PLUS_PLUS, PHASE_MARKED, 2));
  assert.equal(reading.change, "phase");
  assert.equal(reading.distance, 0);
  assert.equal(reading.distinctPhases, 2);
  // The whole point of the case: the probability panel sees nothing here.
  assert.deepEqual(reading.support, { before: 4, after: 4, newlyPopulated: 0, emptied: 0 });
  const text = describeStepEffect(reading, "en");
  assert.match(text ?? "", /probabilities do not move/);
  assert.match(text ?? "", /phase/);
  assert.ok(shouldShowPhases(reading), "a phase-only step must show the phase table");
});

test("an identical state before and after reads as no change at all", () => {
  const reading = ok(readEffect(PLUS_PLUS, PLUS_PLUS, 2));
  assert.equal(reading.change, "none");
  assert.equal(reading.distinctPhases, 1);
  assert.match(describeStepEffect(reading, "en") ?? "", /Nothing about the state changes/);
  assert.equal(shouldShowPhases(reading), false, "one phase across the state means the bars already tell the story");
});

test("a permutation of basis states reads as a move, naming both ends", () => {
  const reading = ok(readEffect(KET_00, KET_11, 2));
  assert.equal(reading.change, "move");
  assert.deepEqual(reading.moved, { from: "00", to: "11" });
  const text = describeStepEffect(reading, "en") ?? "";
  assert.match(text, /whole state moves from 00 to 11/);
  // The bug this case exists for: comparing support SIZES alone calls this
  // "moves between the same 1 outcomes".
  assert.doesNotMatch(text, /the same 1 outcome/);
});

test("spreading into an equal superposition says so, with the count", () => {
  const reading = ok(readEffect(KET_00, PLUS_PLUS, 2));
  assert.equal(reading.change, "spread");
  assert.equal(reading.uniform, true);
  assert.deepEqual(reading.support, { before: 1, after: 4, newlyPopulated: 3, emptied: 0 });
  assert.match(describeStepEffect(reading, "en") ?? "", /spreads from 1 outcome to 4\. All 4 are equally likely\./);
});

test("gathering probability onto fewer outcomes reads as concentrate and quotes the winner", () => {
  const reading = ok(readEffect(PLUS_PLUS, KET_11, 2));
  assert.equal(reading.change, "concentrate");
  assert.deepEqual(reading.support, { before: 4, after: 1, newlyPopulated: 0, emptied: 3 });
  assert.match(describeStepEffect(reading, "en") ?? "", /11 goes from 25\.0% to 100\.0%/);
});

test("a step that both populates and empties outcomes does not claim the same outcomes", () => {
  const before = state([[ROOT_HALF, 0], [ROOT_HALF, 0], [0, 0], [0, 0]]);
  const after = state([[ROOT_HALF, 0], [0, 0], [ROOT_HALF, 0], [0, 0]]);
  const reading = ok(readEffect(before, after, 2));
  assert.equal(reading.change, "redistribute");
  assert.deepEqual(reading.support, { before: 2, after: 2, newlyPopulated: 1, emptied: 1 });
  const text = describeStepEffect(reading, "en") ?? "";
  assert.doesNotMatch(text, /the same 2 outcomes/);
  assert.match(text, /1 outcome appears that had none, 1 drops to zero/);
});

test("entanglement is read from the state, not from which gate was used", () => {
  const entangling = ok(readEffect(PLUS_PLUS, BELL, 2));
  assert.equal(entangling.entangles, true);
  assert.equal(entangling.disentangles, false);
  assert.match(describeStepEffect(entangling, "en") ?? "", /entangles the qubits/);

  const undoing = ok(readEffect(BELL, PLUS_PLUS, 2));
  assert.equal(undoing.entangles, false);
  assert.equal(undoing.disentangles, true);
  assert.match(describeStepEffect(undoing, "en") ?? "", /entanglement comes apart/);

  // A CX applied to |00⟩ entangles nothing, and a structural test ("this step
  // has a CX in it") would say the opposite. This is the discriminating case.
  const inert = ok(readEffect(KET_00, KET_00, 2));
  assert.equal(inert.entangles, false);
});

test("reducedPurity separates a Bell pair from a product state", () => {
  assert.ok(Math.abs(reducedPurity(BELL, 2, 0) - 0.5) < 1e-12, "a maximally entangled qubit has purity 1/2");
  assert.ok(Math.abs(reducedPurity(PLUS_PLUS, 2, 0) - 1) < 1e-12, "a separable qubit has purity 1");
  assert.equal(isProduct(BELL, 2), false);
  assert.equal(isProduct(PLUS_PLUS, 2), true);
});

test("phases print as the multiple of pi a reader recognises, and only when they are one", () => {
  assert.equal(formatPhase(0), "0");
  assert.equal(formatPhase(0.5), "π");
  assert.equal(formatPhase(0.25), "π/2");
  assert.equal(formatPhase(0.125), "π/4");
  assert.equal(formatPhase(0.75), "3π/2");
  // 1/3 of a turn is not an eighth of pi and must not be rounded into one.
  assert.equal(formatPhase(1 / 3), "0.667π");
});

test("a reading declines rather than guessing past the kernel's own limits", () => {
  const steps: BuilderStep[] = [{ id: "a", gate: "H", qubits: [0] }];
  const tooWide = stepEffect({ steps, customGates: [], qubitCount: MAX_EFFECT_QUBITS + 1, index: 0 });
  assert.equal(tooWide.kind, "unavailable");
  assert.equal(tooWide.kind === "unavailable" ? tooWide.reason : null, "too_wide");
  assert.equal(describeStepEffect(tooWide, "en"), null, "a declined reading must print nothing, not 'no change'");

  const opaque = stepEffect({
    steps: [{ id: "b", gate: "CUSTOM", qubits: [0], customGateId: "nope" }],
    customGates: [],
    qubitCount: 1,
    index: 0,
  });
  assert.equal(opaque.kind, "unavailable");

  const measured = stepEffect({
    steps: [
      { id: "m", gate: "M", qubits: [0] },
      { id: "h", gate: "H", qubits: [0] },
    ],
    customGates: [],
    qubitCount: 1,
    index: 1,
  });
  assert.equal(measured.kind === "unavailable" ? measured.reason : null, "mid_circuit_measurement");
});

test("an index outside the example's own steps throws instead of reading as an empty change", () => {
  const steps: BuilderStep[] = [{ id: "a", gate: "H", qubits: [0] }];
  assert.throws(() => stepEffect({ steps, customGates: [], qubitCount: 1, index: 1 }), RangeError);
  assert.throws(() => stepEffect({ steps, customGates: [], qubitCount: 1, index: -1 }), RangeError);
});

test("every step of every worked example produces a reading and a sentence in both locales", () => {
  assert.ok(WORKED_EXAMPLES.length > 0);
  for (const example of WORKED_EXAMPLES) {
    for (let index = 0; index < example.steps.length; index += 1) {
      const effect = stepEffect({
        steps: example.steps,
        customGates: example.customGates,
        qubitCount: example.qubitCount,
        index,
      });
      assert.equal(
        effect.kind,
        "ok",
        `${example.id} step ${index + 1} did not read: ${effect.kind === "unavailable" ? effect.reason : ""}`,
      );
      for (const locale of ["en", "ja"] as const) {
        const text = describeStepEffect(effect, locale);
        assert.ok(text && text.length > 0, `${example.id} step ${index + 1} has no ${locale} sentence`);
      }
    }
  }
});

test("the corpus's own phase-kickback steps are read as phase changes", () => {
  // These are the steps whose whole content is invisible to the probability
  // bars: if the classifier stopped reading amplitudes, every one of them
  // would read as `none` and this test would go red.
  const cases: ReadonlyArray<readonly [string, number]> = [
    ["deutsch-jozsa-3", 2],
    ["bernstein-vazirani-1011", 2],
  ];
  for (const [id, index] of cases) {
    const example = WORKED_EXAMPLES.find((candidate) => candidate.id === id);
    assert.ok(example, `${id} is missing from WORKED_EXAMPLES`);
    const effect = stepEffect({
      steps: example.steps,
      customGates: example.customGates,
      qubitCount: example.qubitCount,
      index,
    });
    assert.equal(effect.kind, "ok");
    assert.equal(effect.kind === "ok" ? effect.change : null, "phase", `${id} step ${index + 1}`);
    assert.ok(effect.kind === "ok" && effect.distinctPhases === 2, `${id} should carry two relative phases`);
  }
});
