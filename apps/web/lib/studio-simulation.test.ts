import assert from "node:assert/strict";
import test from "node:test";
import { cpuSimulationEligibility, idealProbabilities, runCpuSimulation, sourceFingerprint } from "./studio-simulation.ts";
import { TIER_LIMITS } from "./account-tier.ts";
import { createBuilderStepId, type BuilderStep } from "./studio-builder.ts";
import { parseGateAngle } from "./gate-angle.ts";

/** `idealProbabilities` on a hand-built circuit — the matrix-action tests
 * below don't need a source string, so they build steps directly. */
function probabilitiesOf(qubitCount: number, steps: Array<Omit<BuilderStep, "id">>): Float64Array {
  return idealProbabilities({ qubitCount, steps: steps.map((step) => ({ id: createBuilderStepId(), ...step })) });
}

const EPSILON = 1e-9;

function peak(probabilities: Float64Array): { index: number; probability: number } {
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[best]) best = index;
  }
  return { index: best, probability: probabilities[best] };
}

/** A deterministic outcome, within the kernel's own floating-point noise —
 * `deepEqual` against a clean {index, probability: 1} is a coin flip on trig
 * rounding (observed: 1.0000000000000004), so index and probability are
 * asserted separately with an explicit tolerance on the latter. */
function assertPeak(probabilities: Float64Array, expectedIndex: number, message: string) {
  const found = peak(probabilities);
  assert.equal(found.index, expectedIndex, message);
  assert.ok(Math.abs(found.probability - 1) < EPSILON, `${message}: expected probability ~1, got ${found.probability}`);
}

test("SDG.S = I: S then SDG returns |+> to |0> exactly", () => {
  const probabilities = probabilitiesOf(1, [
    { gate: "H", qubits: [0] },
    { gate: "S", qubits: [0] },
    { gate: "SDG", qubits: [0] },
    { gate: "H", qubits: [0] },
  ]);
  assert.ok(Math.abs(probabilities[0] - 1) < EPSILON, `expected |0> with probability 1, got ${probabilities[0]}`);
  assert.ok(Math.abs(probabilities[1]) < EPSILON);
});

test("TDG.T = I: T then TDG returns |+> to |0> exactly", () => {
  const probabilities = probabilitiesOf(1, [
    { gate: "H", qubits: [0] },
    { gate: "T", qubits: [0] },
    { gate: "TDG", qubits: [0] },
    { gate: "H", qubits: [0] },
  ]);
  assert.ok(Math.abs(probabilities[0] - 1) < EPSILON, `expected |0> with probability 1, got ${probabilities[0]}`);
});

test("P(theta) kicks back onto a superposed control the standard way: P(pi/2)|+> -> H gives 1/2, P(pi)|+> -> H gives 1", () => {
  // H, P(theta), H is the textbook phase-kickback sandwich: the resulting
  // P(measure=1) is (1 - cos(theta)) / 2. Checked at two angles rather than
  // one so a sign error in the phase (cos(-theta) = cos(theta) would hide at
  // theta = pi but not elsewhere) cannot pass by accident.
  const half = probabilitiesOf(1, [{ gate: "H", qubits: [0] }, { gate: "P", qubits: [0], param: "pi/2" }, { gate: "H", qubits: [0] }]);
  assert.ok(Math.abs(half[1] - 0.5) < EPSILON, `expected P(1)=0.5 at theta=pi/2, got ${half[1]}`);
  const full = probabilitiesOf(1, [{ gate: "H", qubits: [0] }, { gate: "P", qubits: [0], param: "pi" }, { gate: "H", qubits: [0] }]);
  assert.ok(Math.abs(full[1] - 1) < EPSILON, `expected P(1)=1 at theta=pi, got ${full[1]}`);
});

test("CP applies its phase only when the control is |1>, never when it is |0>", () => {
  // With the control at |1>, CP(pi) on a |+> target is exactly CZ: H,X,CP(pi),H
  // deterministically flips the target to |1>. With the control left at |0>,
  // the same sequence must leave the target at |0> — CP(pi) does nothing.
  const controlOn = probabilitiesOf(2, [
    { gate: "X", qubits: [0] },
    { gate: "H", qubits: [1] },
    { gate: "CP", qubits: [0, 1], param: "pi" },
    { gate: "H", qubits: [1] },
  ]);
  assertPeak(controlOn, 0b11, "control=1: target must flip to |1>");

  const controlOff = probabilitiesOf(2, [
    { gate: "H", qubits: [1] },
    { gate: "CP", qubits: [0, 1], param: "pi" },
    { gate: "H", qubits: [1] },
  ]);
  assertPeak(controlOff, 0b00, "control=0: CP must be inert");
});

test("RZZ phases every basis state by parity, not just |11>: it acts even with the first qubit at |0>", () => {
  // Unlike CP above, RZZ(theta) = exp(-i*theta/2 Z#Z) phases |00>/|11> by
  // e^{-i theta/2} and |01>/|10> by e^{+i theta/2} regardless of whether
  // either qubit is a "control" — so the same H,RZZ(pi),H sandwich flips the
  // second qubit with the FIRST qubit left at |0>, which CP never does.
  const probabilities = probabilitiesOf(2, [
    { gate: "H", qubits: [1] },
    { gate: "RZZ", qubits: [0, 1], param: "pi" },
    { gate: "H", qubits: [1] },
  ]);
  // Basis index = q0 + 2*q1 (bit `n` of the index is qubit n's state — see
  // `bitstringFor`). q0 stays |0>, q1 flips to |1>: index = 0 + 2*1 = 2.
  assertPeak(probabilities, 2, "RZZ(pi) must flip q1 even though q0 is |0>");
});

test("CCX truth table: the target flips iff both controls are |1>, and only then", () => {
  // Prepare every one of the 8 three-qubit basis states via X gates, apply
  // CCX(0,1,2), and check the output lands EXACTLY on the Toffoli truth
  // table's prediction with probability 1 — not merely "something changed".
  for (let input = 0; input < 8; input += 1) {
    const [q0, q1, q2] = [input & 1, (input >> 1) & 1, (input >> 2) & 1];
    const prep: Array<Omit<BuilderStep, "id">> = [q0, q1, q2]
      .flatMap((bit, qubit) => (bit ? [{ gate: "X" as const, qubits: [qubit] }] : []));
    const probabilities = probabilitiesOf(3, [...prep, { gate: "CCX", qubits: [0, 1, 2] }]);
    const expectedQ2 = (q0 === 1 && q1 === 1) ? 1 - q2 : q2;
    const expectedIndex = q0 | (q1 << 1) | (expectedQ2 << 2);
    assertPeak(probabilities, expectedIndex, `CCX on input ${input.toString(2).padStart(3, "0")}`);
  }
});

/**
 * Binds the kernel's private `angle()` (exercised indirectly through an RX
 * step — it has no export of its own) to `parseGateAngle`, the single source
 * of truth for this grammar, instead of to a handful of hand-picked examples.
 * The Stage 2 bug this guards against: `angle()`'s own decimal regex lacked
 * the leading-dot alternative (".5", "-.25", ".5e-3") that GATE_ANGLE (and so
 * parseGateAngle) has always accepted, so those inputs fell into the pi
 * branch and threw a TypeError on a null match instead of computing a
 * number. Iterating the grammar's own shapes — not just the fix's own
 * example — is what would have caught it.
 */
test("angle() accepts a string iff parseGateAngle does, for every shape GATE_ANGLE describes", () => {
  const cases = [
    "0", "1", "42", "3.5", ".5", "-.25", "1.5e3", ".5e-3", "-2.25e2",
    "pi", "-pi", "pi/2", "-pi/2", "3*pi/2", "-3*pi/2", "3*pi", "1.5*pi/4",
    "pi/0", // explicitly rejected: zero denominator
    ".5*pi", // rejected: coefficient must start with a digit, not a dot
    "abc", "", "2pi", "pi/2/3", "++1",
  ];
  for (const raw of cases) {
    const accepted = parseGateAngle(raw) !== null;
    const probeCircuit = { qubitCount: 1, steps: [{ id: createBuilderStepId(), gate: "RX" as const, qubits: [0], param: raw }] };
    if (accepted) {
      const probabilities = idealProbabilities(probeCircuit);
      assert.ok(probabilities.every((p) => Number.isFinite(p)), `angle() should compute a finite number for ${JSON.stringify(raw)}`);
    } else {
      assert.throws(() => idealProbabilities(probeCircuit), /outside the bounded simulation syntax|missing its angle/, `angle() should throw for ${JSON.stringify(raw)}`);
    }
  }
});

test("angle() computes the exact value for a leading-dot decimal and a negative pi-fraction", () => {
  const valueOf = (param: string) => {
    const probabilities = idealProbabilities({ qubitCount: 1, steps: [{ id: createBuilderStepId(), gate: "RX", qubits: [0], param }] });
    // RX(theta)|0> has P(1) = sin^2(theta/2); invert (theta in [0, 2*pi)) to
    // recover theta and confirm angle() read the exact value, not just "some"
    // finite number.
    return probabilities[1];
  };
  assert.ok(Math.abs(valueOf(".5") - Math.sin(0.25) ** 2) < 1e-12);
  assert.ok(Math.abs(valueOf("-.25") - Math.sin(-0.125) ** 2) < 1e-12);
  assert.ok(Math.abs(valueOf(".5e-3") - Math.sin(0.00025) ** 2) < 1e-12);
  assert.ok(Math.abs(valueOf("-pi/4") - Math.sin(-Math.PI / 8) ** 2) < 1e-12);
});

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
    "qubit _qubit0;",
    "bit _bit0;",
    "p(pi/4) _qubit0;",
    "_bit0 = measure _qubit0;",
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
  assert.equal(record.measured, true);
  assert.deepEqual(record.counts, { "0": 24 });
});

test("generated scalar OpenQASM provenance keeps a saved P-phase artifact CPU-simulable", () => {
  const source = [
    "from qiskit import QuantumCircuit",
    "import numpy as np",
    "qc = QuantumCircuit(1)",
    "qc.p(np.pi / 4, 0)",
  ].join("\n");
  const qasm = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    "qubit _qubit0;",
    "p(pi/4) _qubit0;",
  ].join("\n");
  const record = runCpuSimulation({
    artifactId: "artifact-p-scalar",
    code: source,
    framework: "qiskit",
    qasm,
    shots: 24,
    seed: 9,
    now: new Date("2026-07-23T00:00:00.000Z"),
    id: "sim-p-scalar",
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

const ghzSource = (n: number) => [
  "from qiskit import QuantumCircuit",
  "",
  `qc = QuantumCircuit(${n})`,
  "qc.h(0)",
  ...Array.from({ length: n - 1 }, (_, i) => `qc.cx(${i}, ${i + 1})`),
  "qc.measure_all()",
].join("\n");

test("a circuit at the tier ceiling still simulates", () => {
  // Regression for a defect this lane hid: cpuSimulationEligibility reuses the
  // editor parser, whose former six-wire limit silently became the *simulation*
  // limit. Raising the simulation ceiling alone changed nothing, because a
  // 10-qubit circuit never got past the parser.
  //
  // Sized off the tier rather than hardcoded, because hardcoding is what broke
  // it: the fixture asked for 10 qubits against free's ceiling of 16, and when
  // free dropped to 8 the test failed for a reason that had nothing to do with
  // the parser. What has to hold is that NOTHING caps below the tier — so ask
  // for exactly the tier's ceiling, whatever it is.
  const width = TIER_LIMITS.free.cpuSimQubits;
  assert.ok(width > 6, "must stay above the former six-wire editor limit to test anything");
  const record = runCpuSimulation(
    { artifactId: "artifact", code: ghzSource(width), framework: "qiskit", shots: 512, seed: 5 },
    TIER_LIMITS.free,
  );
  assert.equal(record.qubitCount, width);
  // A GHZ state has exactly two outcomes. Anything else means the wider path
  // reconstructed a different circuit rather than the same one.
  assert.deepEqual(
    Object.keys(record.counts).sort(),
    ["0".repeat(width), "1".repeat(width)],
  );
});

test("an over-width circuit is refused as a plan limit, not as unreadable source", () => {
  // 18 qubits parses fine; the free tier just does not cover it. Reporting
  // `source_unavailable` there would blame the user's code for a plan boundary.
  const free = cpuSimulationEligibility(
    { artifactId: "artifact", code: ghzSource(18), framework: "qiskit" },
    TIER_LIMITS.free,
  );
  assert.equal(free.eligible, false);
  if (!free.eligible) assert.equal(free.reason, "qubit_limit");

  const developer = cpuSimulationEligibility(
    { artifactId: "artifact", code: ghzSource(18), framework: "qiskit" },
    TIER_LIMITS.developer,
  );
  assert.equal(developer.eligible, true);
});

test("browser simulation is paced per tier across the trailing ten minutes", () => {
  const now = new Date("2026-07-23T00:00:00.000Z");
  const recent = Array.from({ length: TIER_LIMITS.free.cpuSimRunsPer10Min }, (_, index) => ({
    id: `sim-pace-${index}`,
    artifactId: "artifact-pace",
    artifactVersionId: null,
    createdAt: new Date(now.getTime() - (index + 1) * 30_000).toISOString(),
    sourceFingerprint: "f".repeat(16),
    interchangeFingerprint: null,
    framework: "qiskit",
    model: "direct_source",
    simulator: "Leona bounded browser statevector",
    qubitCount: 2,
    operationCount: 2,
    measured: true,
    shots: 128,
    seed: 1,
    counts: { "00": 128 },
  }));
  const stored = new Map<string, string>([
    ["majorana.studio-simulations.v1", JSON.stringify({ "artifact-pace": recent })],
  ]);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  };
  try {
    assert.throws(
      () =>
        runCpuSimulation({
          artifactId: "artifact-pace",
          artifactVersionId: null,
          code: BELL_SOURCE,
          framework: "qiskit",
          shots: 128,
          seed: 1729,
          now,
          id: "sim-pace-blocked",
        }),
      /paces browser simulation/,
    );
    // Ten records but a 30-per-10-min ceiling: the developer tier still runs.
    const record = runCpuSimulation(
      {
        artifactId: "artifact-pace",
        artifactVersionId: null,
        code: BELL_SOURCE,
        framework: "qiskit",
        shots: 128,
        seed: 1729,
        now,
        id: "sim-pace-developer",
      },
      TIER_LIMITS.developer,
    );
    assert.equal(record.id, "sim-pace-developer");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
