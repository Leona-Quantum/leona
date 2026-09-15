import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_TEMPLATES,
  blockTemplate,
  instantiateBlock,
  validateBlockParams,
  type BlockParams,
  type BlockTemplate,
  type BuiltBlock,
} from "./circuit-blocks.ts";
import { flattenBuilderSteps, createBuilderStepId, type BuilderStep } from "./studio-builder.ts";
import { idealProbabilities } from "./studio-simulation.ts";

const EPSILON = 1e-9;

/** Mirrors circuit-blocks.ts's own (private) bitAt: character 0 of a
 * bitstring is the highest-numbered qubit, the last character is qubit 0. */
function bitAt(bitstring: string, qubit: number, length: number): "0" | "1" {
  return bitstring[length - 1 - qubit] as "0" | "1";
}

/** Simulate a block's own unitary alone, on |0...0>, with optional extra
 * steps before/after (e.g. to prepare a specific input basis state, or an
 * ancilla in |->). */
function simulateBlock(
  template: BlockTemplate,
  params: BlockParams,
  before: Array<Omit<BuilderStep, "id">> = [],
  after: Array<Omit<BuilderStep, "id">> = [],
): { qubitCount: number; probabilities: Float64Array } {
  const qubitCount = template.qubitCount(params);
  const built = template.build(params);
  const instance = instantiateBlock(built, Array.from({ length: qubitCount }, (_, i) => i), "t");
  const idBefore = before.map((s) => ({ id: createBuilderStepId(), ...s }));
  const idAfter = after.map((s) => ({ id: createBuilderStepId(), ...s }));
  const flat = flattenBuilderSteps([...idBefore, instance.step, ...idAfter], instance.customGates);
  return { qubitCount, probabilities: idealProbabilities({ qubitCount, steps: flat }) };
}

function peakIndex(probabilities: Float64Array): number {
  let best = 0;
  for (let i = 1; i < probabilities.length; i += 1) if (probabilities[i] > probabilities[best]) best = i;
  return best;
}

function basisPrep(qubitCount: number, index: number): Array<Omit<BuilderStep, "id">> {
  return Array.from({ length: qubitCount }, (_, q) => q).filter((q) => (index & (1 << q)) !== 0).map((q) => ({ gate: "X" as const, qubits: [q] }));
}

// ---------------------------------------------------------------------------
// Registry sanity

test("every block template resolves by key, and default params validate", () => {
  for (const template of BLOCK_TEMPLATES) {
    assert.equal(blockTemplate(template.key), template);
    const params: BlockParams = Object.fromEntries(template.params.map((spec) => [spec.key, spec.default]));
    assert.equal(validateBlockParams(template, params), null, `${template.key} defaults should validate`);
    assert.ok(template.summary.length > 0 && /[.]$/.test(template.summary), `${template.key} summary should be one plain sentence`);
    const n = template.qubitCount(params);
    assert.ok(Number.isInteger(n) && n >= 1, `${template.key} qubitCount should be a positive integer`);
  }
});

test("validateBlockParams catches an out-of-range int, a bad angle, a malformed bitstring, and bad edges", () => {
  const ghz = blockTemplate("ghz")!;
  assert.match(validateBlockParams(ghz, { n: 1 }) ?? "", /between/);
  assert.match(validateBlockParams(ghz, { n: 2.5 }) ?? "", /whole number/);

  const qft = blockTemplate("qft")!;
  assert.equal(validateBlockParams(qft, { n: 4 }), null);

  const oracle = blockTemplate("phase_oracle")!;
  assert.match(validateBlockParams(oracle, { bitstring: "102" }) ?? "", /0s and 1s/);
  assert.match(validateBlockParams(oracle, { bitstring: "0000000" }) ?? "", /between/);

  const trotter = blockTemplate("ising_trotter_step")!;
  assert.match(validateBlockParams(trotter, { n: 4, J: "not-an-angle", h: "1", dt: "0.1" }) ?? "", /angle/);

  const qaoa = blockTemplate("qaoa_maxcut_layer")!;
  const edgesWithBadEntry = { edges: [[0, "x"]], gamma: "pi/4", beta: "pi/8" } as unknown as BlockParams;
  assert.match(validateBlockParams(qaoa, edgesWithBadEntry) ?? "", /pairs/);
  assert.equal(validateBlockParams(qaoa, { edges: [[0, 1], [1, 2]], gamma: "pi/4", beta: "pi/8" }), null);
});

// ---------------------------------------------------------------------------
// bell / ghz / hadamard_layer

test("bell prepares the Bell pair", () => {
  const { probabilities } = simulateBlock(blockTemplate("bell")!, {});
  assert.ok(Math.abs(probabilities[0b00] - 0.5) < EPSILON);
  assert.ok(Math.abs(probabilities[0b11] - 0.5) < EPSILON);
  assert.ok(Math.abs(probabilities[0b01]) < EPSILON);
  assert.ok(Math.abs(probabilities[0b10]) < EPSILON);
});

test("ghz spreads equally over |0...0> and |1...1> only, for several n", () => {
  for (const n of [2, 3, 5]) {
    const { probabilities } = simulateBlock(blockTemplate("ghz")!, { n });
    assert.ok(Math.abs(probabilities[0] - 0.5) < EPSILON, `n=${n}`);
    assert.ok(Math.abs(probabilities[(1 << n) - 1] - 0.5) < EPSILON, `n=${n}`);
    const total = probabilities.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < EPSILON, `n=${n}`);
  }
});

test("hadamard_layer gives a flat distribution over every basis state", () => {
  const n = 4;
  const { probabilities } = simulateBlock(blockTemplate("hadamard_layer")!, { n });
  for (let i = 0; i < probabilities.length; i += 1) assert.ok(Math.abs(probabilities[i] - 1 / 16) < EPSILON, `index ${i}`);
});

// ---------------------------------------------------------------------------
// QFT / QFT inverse

test("QFT on a basis state gives every outcome equal magnitude 1/N, and qft_inverse . qft = identity on several basis states", () => {
  const qft = blockTemplate("qft")!;
  const qftInverse = blockTemplate("qft_inverse")!;
  const n = 3;
  const N = 1 << n;
  for (const x of [0, 1, 3, 5, 7]) {
    const { probabilities } = simulateBlock(qft, { n }, basisPrep(n, x));
    for (let y = 0; y < N; y += 1) assert.ok(Math.abs(probabilities[y] - 1 / N) < EPSILON, `x=${x} y=${y}`);
  }

  // qft_inverse(qft(|x>)) = |x> exactly, for several basis states.
  for (const x of [0, 2, 4, 6]) {
    const builtQft = qft.build({ n });
    const builtInverse = qftInverse.build({ n });
    const qubits = Array.from({ length: n }, (_, i) => i);
    const first = instantiateBlock(builtQft, qubits, "a");
    const second = instantiateBlock(builtInverse, qubits, "b");
    const prep = basisPrep(n, x).map((s) => ({ id: createBuilderStepId(), ...s }));
    const flat = flattenBuilderSteps([...prep, first.step, second.step], [...first.customGates, ...second.customGates]);
    const probabilities = idealProbabilities({ qubitCount: n, steps: flat });
    assert.ok(Math.abs(probabilities[x] - 1) < EPSILON, `x=${x}: expected identity, peak at ${peakIndex(probabilities)}`);
  }
});

// ---------------------------------------------------------------------------
// mcz / phase_oracle / grover_diffuser / grover_iteration

test("mcz flips only |1...1>, for every n from 1 to 6", () => {
  // Diagonal-ness: from every basis state, mcz must leave probabilities
  // exactly where they started (a phase-only gate never moves population).
  for (let n = 1; n <= 6; n += 1) {
    for (const x of [0, 1, (1 << n) - 1]) {
      const { probabilities } = simulateBlock(blockTemplate("mcz")!, { n }, basisPrep(n, x));
      assert.ok(Math.abs(probabilities[x] - 1) < EPSILON, `n=${n} x=${x}`);
    }
  }
  // Phase test: |1...1> picks up -1 relative to |0...1>, revealed by
  // superposing exactly those two states (via H on the top qubit only, with
  // the rest prepared at |1>) and checking which way the interference goes
  // after a second H.
  for (let n = 2; n <= 6; n += 1) {
    const top = n - 1;
    const restOnes = Array.from({ length: n - 1 }, (_, q) => ({ gate: "X" as const, qubits: [q] }));
    const { probabilities } = simulateBlock(
      blockTemplate("mcz")!,
      { n },
      [...restOnes, { gate: "H", qubits: [top] }],
      [{ gate: "H", qubits: [top] }],
    );
    // Before mcz: (|0,1^(n-1)> + |1,1^(n-1)>)/sqrt2. mcz phases only
    // |1,1^(n-1)> (all ones) by -1. After the second H on `top`, that sign
    // flip must send the top qubit deterministically to |1>.
    const expectedIndex = (1 << top) | ((1 << top) - 1);
    assert.ok(Math.abs(probabilities[expectedIndex] - 1) < EPSILON, `n=${n}: expected peak at ${expectedIndex}, got peak ${peakIndex(probabilities)}`);
  }
});

test("phase_oracle flips only |s>, for several bitstrings", () => {
  for (const s of ["0", "1", "101", "0110", "111111"]) {
    const n = s.length;
    for (const x of Array.from({ length: 1 << n }, (_, i) => i)) {
      const { probabilities } = simulateBlock(blockTemplate("phase_oracle")!, { bitstring: s }, basisPrep(n, x));
      assert.ok(Math.abs(probabilities[x] - 1) < EPSILON, `s=${s} x=${x}: phase_oracle must be diagonal`);
    }
  }

  // The diagonal check above proves phase_oracle never moves population, but
  // a single qubit's own H-sandwich cannot tell WHICH of two basis states
  // carried the -1 — flipping either component of (|0>+|1>)/sqrt2 sends H to
  // the same output up to an unobservable global phase. So the sign is read
  // out with a genuinely separate ancilla instead, via proper phase kickback:
  // entangle the ancilla with the data register as
  // (|anc=0>|0...0> + |anc=1>|target>)/sqrt2 (H on the ancilla, then
  // CX(ancilla, q) for every qubit q that is 1 in the target). Apply
  // phase_oracle. Then — this is the step a first attempt at this test
  // skipped, and it matters: un-entangle the ancilla from the data by
  // applying the SAME CX(ancilla, q) gates again (self-inverse), which
  // brings data back to |0...0> in BOTH branches, leaving the ancilla alone
  // in |-> if (and only if) phase_oracle fired on exactly the |target>
  // branch. Only then does a final H read out a deterministic |1>; reading
  // the ancilla before un-entangling just measures a genuinely mixed
  // marginal of a 2-qubit entangled state, which is what a first version of
  // this test did, and it always came back exactly 0.5 regardless of
  // correctness — a broken instrument, not a finding.
  for (const s of ["1", "101", "0110", "111111"]) {
    const n = s.length;
    const ancilla = n;
    const onesInTarget = Array.from({ length: n }, (_, q) => q).filter((q) => bitAt(s, q, n) === "1");
    const oracle = blockTemplate("phase_oracle")!;
    const built = oracle.build({ bitstring: s });
    const instance = instantiateBlock(built, Array.from({ length: n }, (_, q) => q), "po");
    const entangle = [
      { id: createBuilderStepId(), gate: "H" as const, qubits: [ancilla] },
      ...onesInTarget.map((q) => ({ id: createBuilderStepId(), gate: "CX" as const, qubits: [ancilla, q] })),
    ];
    const unentangle = onesInTarget.map((q) => ({ id: createBuilderStepId(), gate: "CX" as const, qubits: [ancilla, q] }));
    const post = [{ id: createBuilderStepId(), gate: "H" as const, qubits: [ancilla] }];
    const flat = flattenBuilderSteps([...entangle, instance.step, ...unentangle, ...post], instance.customGates);
    const probabilities = idealProbabilities({ qubitCount: n + 1, steps: flat });
    let ancillaOne = 0;
    for (let index = 0; index < probabilities.length; index += 1) if ((index & (1 << ancilla)) !== 0) ancillaOne += probabilities[index];
    assert.ok(Math.abs(ancillaOne - 1) < EPSILON, `s=${s}: expected the |target> branch to be the one phase_oracle flips, ancilla=1 probability was ${ancillaOne}`);
  }

  // Bit for bit (`onesInTarget` from an empty bitstring), the |0...0> branch
  // is a legitimate "not the target" witness only when the target itself
  // isn't 0...0 — covered by skipping "0" above.
});

test("grover_diffuser equals 2|s><s| - I up to a global phase, on several random-ish states", () => {
  const n = 3;
  const N = 1 << n;
  const diffuser = blockTemplate("grover_diffuser")!;
  // A handful of non-uniform test vectors (as prep circuits), including the
  // uniform state itself, so the reflection is checked away from its own axis.
  const preps: Array<Array<Omit<BuilderStep, "id">>> = [
    [{ gate: "H", qubits: [0] }, { gate: "H", qubits: [1] }, { gate: "H", qubits: [2] }],
    [{ gate: "X", qubits: [0] }, { gate: "H", qubits: [1] }],
    [{ gate: "H", qubits: [0] }, { gate: "X", qubits: [1] }, { gate: "H", qubits: [2] }],
  ];
  for (const prep of preps) {
    // Reference amplitudes for |psi> (before the diffuser).
    const prepIds = prep.map((s) => ({ id: createBuilderStepId(), ...s }));
    const psiState = idealProbabilities({ qubitCount: n, steps: prepIds });
    const uniform = 1 / N;
    // 2|s><s| - I applied to |psi>: <s|psi> is real+nonnegative here (H/X
    // only), so work directly with probabilities via sqrt.
    const overlap = psiState.reduce((sum, prob) => sum + Math.sqrt(prob) * Math.sqrt(uniform), 0);
    const expected = new Float64Array(N);
    for (let y = 0; y < N; y += 1) {
      const amp = 2 * overlap * Math.sqrt(uniform) - Math.sqrt(psiState[y]);
      expected[y] = amp * amp;
    }
    const { probabilities } = simulateBlock(diffuser, { n }, prep);
    for (let y = 0; y < N; y += 1) assert.ok(Math.abs(probabilities[y] - expected[y]) < 1e-6, `prep=${JSON.stringify(prep)} y=${y}`);
  }
});

test("grover_iteration finds |101> in 3 qubits: after 2 iterations the target dominates", () => {
  const n = 3;
  const target = 0b101;
  const iteration = blockTemplate("grover_iteration")!;
  const built = iteration.build({ bitstring: "101" });
  const qubits = [0, 1, 2];
  const prepH = Array.from({ length: n }, (_, q) => ({ id: createBuilderStepId(), gate: "H" as const, qubits: [q] }));
  const first = instantiateBlock(built, qubits, "g1");
  const second = instantiateBlock(built, qubits, "g2");
  const flat = flattenBuilderSteps([...prepH, first.step, second.step], [...first.customGates, ...second.customGates]);
  const probabilities = idealProbabilities({ qubitCount: n, steps: flat });
  assert.equal(peakIndex(probabilities), target);
  assert.ok(probabilities[target] > 0.9, `expected the target to dominate after 2 iterations, got ${probabilities[target]}`);
});

// ---------------------------------------------------------------------------
// bv_oracle / dj_balanced_oracle

test("Bernstein-Vazirani returns the secret with probability 1", () => {
  for (const secret of ["1011", "0", "1", "111", "10010"]) {
    const n = secret.length;
    const oracle = blockTemplate("bv_oracle")!;
    const built = oracle.build({ secret });
    const ancilla = n;
    const qubits = Array.from({ length: n + 1 }, (_, i) => i);
    const instance = instantiateBlock(built, qubits, "bv");
    const prep = [
      ...Array.from({ length: n }, (_, q) => ({ id: createBuilderStepId(), gate: "H" as const, qubits: [q] })),
      { id: createBuilderStepId(), gate: "X" as const, qubits: [ancilla] },
      { id: createBuilderStepId(), gate: "H" as const, qubits: [ancilla] },
    ];
    const post = Array.from({ length: n }, (_, q) => ({ id: createBuilderStepId(), gate: "H" as const, qubits: [q] }));
    const flat = flattenBuilderSteps([...prep, instance.step, ...post], instance.customGates);
    const probabilities = idealProbabilities({ qubitCount: n + 1, steps: flat });
    const expectedSecret = Number.parseInt(secret, 2);
    // The input register's peak, ignoring the ancilla (which stays |->,
    // i.e. split across ancilla=0/1) — sum over both ancilla values.
    const marginal = new Float64Array(1 << n);
    for (let index = 0; index < probabilities.length; index += 1) marginal[index & ((1 << n) - 1)] += probabilities[index];
    assert.ok(Math.abs(marginal[expectedSecret] - 1) < EPSILON, `secret=${secret}: got marginal peak ${peakIndex(marginal)}`);
  }
});

test("Deutsch-Jozsa balanced oracle is genuinely balanced: half the inputs flip the ancilla, half don't", () => {
  const n = 3;
  const oracle = blockTemplate("dj_balanced_oracle")!;
  const built = oracle.build({ n });
  const ancilla = n;
  const qubits = Array.from({ length: n + 1 }, (_, i) => i);
  let flips = 0;
  for (let x = 0; x < 1 << n; x += 1) {
    const instance = instantiateBlock(built, qubits, `dj-${x}`);
    const prep = basisPrep(n + 1, x).map((s) => ({ id: createBuilderStepId(), ...s }));
    const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
    const probabilities = idealProbabilities({ qubitCount: n + 1, steps: flat });
    const outIndex = peakIndex(probabilities);
    const ancillaFlipped = ((outIndex >> ancilla) & 1) !== 0;
    if (ancillaFlipped) flips += 1;
  }
  assert.equal(flips, (1 << n) / 2, "a balanced function must flip the ancilla for exactly half of all inputs");
});

// ---------------------------------------------------------------------------
// QPE

test("QPE with t=3, angle=2*pi*3/8 returns 011 with probability 1", () => {
  const t = 3;
  const angle = `3*pi/4`; // 2*pi*3/8 simplified into this file's "(coeff*)pi/denom" grammar
  const qpe = blockTemplate("qpe_phase")!;
  const { probabilities } = simulateBlock(qpe, { t, angle });
  // Bit-order convention (stated here since the test is the contract): the
  // counting register's peak index, read as this file's own qubit-index
  // convention (qubit i = bit i), corresponds to the *reversed* bit string —
  // qubit 0 carries the MOST significant estimated bit. angle/(2*pi) = 3/8 =
  // 0.011 in binary (3 bits), i.e. the counting register should read out the
  // integer 3 when its bits are taken MSB-first as qubit (t-1)...qubit 0.
  const countingMask = (1 << t) - 1;
  const marginal = new Float64Array(1 << t);
  for (let index = 0; index < probabilities.length; index += 1) marginal[index & countingMask] += probabilities[index];
  const peak = peakIndex(marginal);
  assert.ok(marginal[peak] > 1 - EPSILON, `expected a deterministic peak, got ${marginal[peak]}`);
  // peak, read qubit-0-is-LSB, should equal 3 when angle/(2pi) = 3/8 exactly.
  assert.equal(peak, 3, `expected QPE to read out 3 (011), got index ${peak}`);
});

// ---------------------------------------------------------------------------
// Draper adder

test("draper_add_constant: 5+3 on 4 qubits gives 8, and 13+7 gives 4 (mod 16)", () => {
  const adder = blockTemplate("draper_add_constant")!;
  for (const [x, a, expected] of [[5, 3, 8], [13, 7, 4]] as const) {
    const built = adder.build({ n: 4, a });
    const instance = instantiateBlock(built, [0, 1, 2, 3], "add");
    const prep = basisPrep(4, x).map((s) => ({ id: createBuilderStepId(), ...s }));
    const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
    const probabilities = idealProbabilities({ qubitCount: 4, steps: flat });
    assert.ok(Math.abs(probabilities[expected] - 1) < EPSILON, `${x}+${a}: expected ${expected}, got peak ${peakIndex(probabilities)} (p=${probabilities[peakIndex(probabilities)]})`);
  }
});

// ---------------------------------------------------------------------------
// swap_test

test("swap test on identical states gives ancilla 0 with probability 1", () => {
  const swapTest = blockTemplate("swap_test")!;
  const built = swapTest.build({ n: 1 });
  // qubits: 0 = ancilla, 1 = register A, 2 = register B. Put both A and B in
  // the SAME state |+> (identical states => ancilla must read 0 always).
  const instance = instantiateBlock(built, [0, 1, 2], "st");
  const prep = [{ id: createBuilderStepId(), gate: "H" as const, qubits: [1] }, { id: createBuilderStepId(), gate: "H" as const, qubits: [2] }];
  const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
  const probabilities = idealProbabilities({ qubitCount: 3, steps: flat });
  let ancillaZero = 0;
  for (let index = 0; index < probabilities.length; index += 1) if ((index & 1) === 0) ancillaZero += probabilities[index];
  assert.ok(Math.abs(ancillaZero - 1) < EPSILON, `expected ancilla=0 with probability 1, got ${ancillaZero}`);
});

test("swap test on |+> vs |0> gives ancilla 0 with probability 0.75", () => {
  const swapTest = blockTemplate("swap_test")!;
  const built = swapTest.build({ n: 1 });
  const instance = instantiateBlock(built, [0, 1, 2], "st");
  // register A (qubit 1) = |+>, register B (qubit 2) = |0> (left unprepared).
  const prep = [{ id: createBuilderStepId(), gate: "H" as const, qubits: [1] }];
  const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
  const probabilities = idealProbabilities({ qubitCount: 3, steps: flat });
  let ancillaZero = 0;
  for (let index = 0; index < probabilities.length; index += 1) if ((index & 1) === 0) ancillaZero += probabilities[index];
  assert.ok(Math.abs(ancillaZero - 0.75) < 1e-9, `expected 0.75, got ${ancillaZero}`);
});

// ---------------------------------------------------------------------------
// quantum_walk_step_cycle4

test("quantum_walk_step_cycle4: the shift is exactly +1/-1 mod 4 for a classical coin, tested on the raw gates the block wraps", () => {
  // The block's own first gate is H(coin), so testing "a classical, fixed
  // coin" against the block's public build() is impossible without bypassing
  // that H — this test instead pins the shift sub-circuit directly (the same
  // 6 gates build() emits after its H), which is what the block-level
  // Hadamard-coin tests below build on top of.
  const coin = 0;
  const b0 = 1;
  const b1 = 2;
  const shiftGates: BuilderStep["gate"][] = ["CCX", "CX", "X", "CX", "CCX", "X"];
  const shiftQubits = [[coin, b0, b1], [coin, b0], [coin], [coin, b0], [coin, b0, b1], [coin]];
  function shiftSteps(): BuilderStep[] {
    return shiftGates.map((gate, i) => ({ id: createBuilderStepId(), gate, qubits: shiftQubits[i] }));
  }

  // Coin fixed at |1>: each application increments position by 1 mod 4.
  for (const repeats of [1, 2, 3, 4]) {
    const prep: BuilderStep[] = [{ id: createBuilderStepId(), gate: "X", qubits: [coin] }];
    const steps = [...prep, ...Array.from({ length: repeats }, shiftSteps).flat()];
    const probabilities = idealProbabilities({ qubitCount: 3, steps });
    const peak = peakIndex(probabilities);
    assert.ok(Math.abs(probabilities[peak] - 1) < EPSILON, `repeats=${repeats}: expected a deterministic outcome`);
    assert.equal(peak >> 1, repeats % 4, `repeats=${repeats}: expected position ${repeats % 4}, got ${peak >> 1}`);
  }

  // Coin fixed at |0>: each application decrements position by 1 mod 4.
  for (const repeats of [1, 2, 3, 4]) {
    const steps = Array.from({ length: repeats }, shiftSteps).flat();
    const probabilities = idealProbabilities({ qubitCount: 3, steps });
    const peak = peakIndex(probabilities);
    assert.ok(Math.abs(probabilities[peak] - 1) < EPSILON, `repeats=${repeats}: expected a deterministic outcome`);
    assert.equal(peak >> 1, (4 - (repeats % 4)) % 4, `repeats=${repeats}: expected position ${(4 - (repeats % 4)) % 4}, got ${peak >> 1}`);
  }
});

test("quantum_walk_step_cycle4: the actual Hadamard-coin walk matches the simulator's own output at 1 and 3 steps", () => {
  const template = blockTemplate("quantum_walk_step_cycle4")!;
  const built = template.build({});

  function runSteps(repeats: number): Float64Array {
    const steps = Array.from({ length: repeats }, (_, i) => instantiateBlock(built, [0, 1, 2], `w${i}`));
    const flat = flattenBuilderSteps(steps.map((s) => s.step), steps.flatMap((s) => s.customGates));
    return idealProbabilities({ qubitCount: 3, steps: flat });
  }

  // 1 step from |000>: the coin's Hadamard, then a shift, spreads position
  // to +1 and -1 (=3) with equal probability, entangled with the coin.
  const one = runSteps(1);
  assert.ok(Math.abs(one[0b011] - 0.5) < EPSILON, `expected 0.5 at position 1 / coin 1, got ${one[0b011]}`);
  assert.ok(Math.abs(one[0b110] - 0.5) < EPSILON, `expected 0.5 at position 3 / coin 0, got ${one[0b110]}`);

  // 3 steps: constructive interference on this small cycle collapses the
  // position to a single value (3) with probability 1, split evenly across
  // the two coin outcomes — a real, checked feature of this exact walk, not
  // an approximation.
  const three = runSteps(3);
  assert.ok(Math.abs(three[0b110] - 0.5) < EPSILON, `expected 0.5 at "110", got ${three[0b110]}`);
  assert.ok(Math.abs(three[0b111] - 0.5) < EPSILON, `expected 0.5 at "111", got ${three[0b111]}`);
  let total = 0;
  for (const p of three) total += p;
  assert.ok(Math.abs(total - 1) < EPSILON);
});

// ---------------------------------------------------------------------------
// controlled_mult_7_mod_15 / controlled_mult_4_mod_15

test("controlled_mult_7_mod_15 maps the order-4 orbit {1,7,4,13} exactly, when the control is |1>", () => {
  const template = blockTemplate("controlled_mult_7_mod_15")!;
  const built = template.build({});
  const expected: Record<number, number> = { 1: 7, 7: 4, 4: 13, 13: 1 };
  for (const [from, to] of Object.entries(expected)) {
    const x = Number(from);
    const instance = instantiateBlock(built, [0, 1, 2, 3, 4], `m${x}`);
    const prep: BuilderStep[] = [{ id: createBuilderStepId(), gate: "X", qubits: [0] }]; // control = 1
    for (let bit = 0; bit < 4; bit += 1) if (x & (1 << bit)) prep.push({ id: createBuilderStepId(), gate: "X", qubits: [1 + bit] });
    const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
    const probabilities = idealProbabilities({ qubitCount: 5, steps: flat });
    const peak = peakIndex(probabilities);
    const outputRegister = (peak >> 1) & 0b1111; // bits 1-4
    assert.ok(Math.abs(probabilities[peak] - 1) < EPSILON, `x=${x}: expected a deterministic outcome`);
    assert.equal(outputRegister, to, `x=${x}: expected x7 mod 15 = ${to}, got ${outputRegister}`);
    assert.equal(peak & 1, 1, `x=${x}: control qubit must be unchanged`);
  }
});

test("controlled_mult_7_mod_15 does nothing when the control is |0>", () => {
  const template = blockTemplate("controlled_mult_7_mod_15")!;
  const built = template.build({});
  const instance = instantiateBlock(built, [0, 1, 2, 3, 4], "m");
  const prep: BuilderStep[] = [{ id: createBuilderStepId(), gate: "X", qubits: [1] }]; // register = 1, control = 0
  const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
  const probabilities = idealProbabilities({ qubitCount: 5, steps: flat });
  assert.ok(Math.abs(probabilities[0b00010] - 1) < EPSILON, "register must be untouched when the control is |0>");
});

test("controlled_mult_4_mod_15 maps the order-4 orbit exactly, matching x7 applied twice", () => {
  const template = blockTemplate("controlled_mult_4_mod_15")!;
  const built = template.build({});
  const expected: Record<number, number> = { 1: 4, 7: 13, 4: 1, 13: 7 };
  for (const [from, to] of Object.entries(expected)) {
    const x = Number(from);
    const instance = instantiateBlock(built, [0, 1, 2, 3, 4], `m${x}`);
    const prep: BuilderStep[] = [{ id: createBuilderStepId(), gate: "X", qubits: [0] }];
    for (let bit = 0; bit < 4; bit += 1) if (x & (1 << bit)) prep.push({ id: createBuilderStepId(), gate: "X", qubits: [1 + bit] });
    const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
    const probabilities = idealProbabilities({ qubitCount: 5, steps: flat });
    const peak = peakIndex(probabilities);
    const outputRegister = (peak >> 1) & 0b1111;
    assert.ok(Math.abs(probabilities[peak] - 1) < EPSILON, `x=${x}: expected a deterministic outcome`);
    assert.equal(outputRegister, to, `x=${x}: expected x4 mod 15 = ${to}, got ${outputRegister}`);
  }
});

// ---------------------------------------------------------------------------
// amplitude_estimation_powers

test("amplitude_estimation_powers: a=0 (theta=0) leaves the target at |0>, deterministically", () => {
  const template = blockTemplate("amplitude_estimation_powers")!;
  const built = template.build({ t: 2, theta: "0" });
  const instance = instantiateBlock(built, [0, 1, 2], "qae");
  const prep = [{ id: createBuilderStepId(), gate: "H" as const, qubits: [0] }, { id: createBuilderStepId(), gate: "H" as const, qubits: [1] }];
  const flat = flattenBuilderSteps([...prep, instance.step], instance.customGates);
  const probabilities = idealProbabilities({ qubitCount: 3, steps: flat });
  let targetOne = 0;
  for (let index = 0; index < probabilities.length; index += 1) if ((index & 0b100) !== 0) targetOne += probabilities[index];
  assert.ok(targetOne < EPSILON, `expected the target to stay |0> when theta=0, got P(target=1)=${targetOne}`);
});

test("amplitude_estimation_powers feeding a QPE-style readout gives the exact theta/pi peaks for theta=pi/8", () => {
  // Full worked-example-shaped circuit: RY(2*theta) state prep, Hadamard the
  // counting register, this block's controlled powers, inverse QFT. The
  // counting register must read theta/pi = 1/8 and its mirror 1 - 1/8 = 7/8
  // (i.e. 001 and 111 for t=3), each with probability 1/2 — the module
  // comment on AMPLITUDE_ESTIMATION_POWERS documents how the S_0 sign was
  // resolved empirically against exactly this check.
  const t = 3;
  const target = t;
  const template = blockTemplate("amplitude_estimation_powers")!;
  const built = template.build({ t, theta: "pi/8" });
  const instance = instantiateBlock(built, [0, 1, 2, target], "qae");
  const iqftBuilt = blockTemplate("qft_inverse")!.build({ n: t });
  const iqft = instantiateBlock(iqftBuilt, [0, 1, 2], "iqft");
  const prep = [
    { id: createBuilderStepId(), gate: "RY" as const, qubits: [target], param: "pi/4" },
    ...[0, 1, 2].map((q) => ({ id: createBuilderStepId(), gate: "H" as const, qubits: [q] })),
  ];
  const flat = flattenBuilderSteps([...prep, instance.step, iqft.step], [...instance.customGates, ...iqft.customGates]);
  const probabilities = idealProbabilities({ qubitCount: t + 1, steps: flat });
  const marginal = new Float64Array(1 << t);
  for (let index = 0; index < probabilities.length; index += 1) marginal[index & ((1 << t) - 1)] += probabilities[index];
  assert.ok(Math.abs(marginal[0b001] - 0.5) < EPSILON, `expected P(counting=001)=0.5, got ${marginal[0b001]}`);
  assert.ok(Math.abs(marginal[0b111] - 0.5) < EPSILON, `expected P(counting=111)=0.5, got ${marginal[0b111]}`);
});

// ---------------------------------------------------------------------------
// ising_trotter_step / hardware_efficient_layer / qaoa_maxcut_layer: smoke +
// exact small-case checks

test("ising_trotter_step at dt=0 is the identity", () => {
  const { probabilities } = simulateBlock(blockTemplate("ising_trotter_step")!, { n: 4, J: "1", h: "1", dt: "0" }, basisPrep(4, 0b0101));
  assert.ok(Math.abs(probabilities[0b0101] - 1) < EPSILON);
});

test("hardware_efficient_layer at theta=0 is the identity (RY(0) then a CX ladder on |0...0>)", () => {
  const { probabilities } = simulateBlock(blockTemplate("hardware_efficient_layer")!, { n: 3, theta: "0" });
  assert.ok(Math.abs(probabilities[0] - 1) < EPSILON);
});

test("qaoa_maxcut_layer: the 4-cycle at gamma=0 leaves the mixer as plain X rotations", () => {
  const { probabilities } = simulateBlock(blockTemplate("qaoa_maxcut_layer")!, { edges: [[0, 1], [1, 2], [2, 3], [3, 0]], gamma: "0", beta: "pi/2" });
  // RX(pi) on every qubit from |0000> gives |1111> exactly (up to phase).
  assert.ok(Math.abs(probabilities[0b1111] - 1) < EPSILON, `got peak ${peakIndex(probabilities)}`);
});

// ---------------------------------------------------------------------------
// instantiateBlock: fresh ids, no collision between two instances

test("instantiateBlock gives two instances of the same block disjoint ids", () => {
  const built = blockTemplate("ghz")!.build({ n: 3 });
  const first = instantiateBlock(built, [0, 1, 2], "one");
  const second = instantiateBlock(built, [3, 4, 5], "two");
  assert.notEqual(first.step.customGateId, second.step.customGateId);
  const firstIds = new Set(first.customGates.map((g) => g.id));
  const secondIds = new Set(second.customGates.map((g) => g.id));
  for (const id of firstIds) assert.ok(!secondIds.has(id), `id ${id} collided`);
});

test("instantiateBlock remaps nested customGateId references, not just definition ids", () => {
  const built = blockTemplate("grover_iteration")!.build({ bitstring: "10" });
  const instance = instantiateBlock(built, [0, 1], "gi");
  const rootId = instance.step.customGateId;
  const root = instance.customGates.find((g) => g.id === rootId);
  assert.ok(root, "root definition must be present");
  const definedIds = new Set(instance.customGates.map((g) => g.id));
  for (const gate of instance.customGates) {
    for (const step of gate.steps) {
      if (step.gate === "CUSTOM") assert.ok(definedIds.has(step.customGateId!), `dangling reference ${step.customGateId}`);
    }
  }
});
