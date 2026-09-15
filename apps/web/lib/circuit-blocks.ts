import { gateAngleRadians } from "./gate-inspector.ts";
import { isGateAngle } from "./gate-angle.ts";
import type { BuilderGate, BuilderStep, CustomGateDefinition } from "./studio-builder.ts";

/**
 * A library of parameterised, tested circuit blocks — QFT, Grover pieces,
 * arithmetic, Trotter steps — built from the Studio gate set.
 *
 * Qubit-order convention (matches studio-simulation.ts exactly, and Qiskit's
 * own convention, cross-checked in Stage 1): a basis state's amplitude lives
 * at statevector index `sum_i bit_i * 2^i`, i.e. qubit `i` is bit `i` of the
 * index — "qubit 0 is the least significant qubit". Where a block takes a
 * bitstring parameter (phase_oracle, bv_oracle, ...), the string is read the
 * way a ket is conventionally written: character 0 is the MOST significant
 * qubit (the highest-numbered one), the last character is qubit 0 — i.e.
 * `bitstringFor`'s own convention, so a block's bitstring parameter reads
 * identically to how the simulator would print that state.
 */

// ---------------------------------------------------------------------------
// Contract

export type BlockParamSpec =
  | { key: string; label: string; kind: "int"; min: number; max: number; default: number }
  | { key: string; label: string; kind: "angle"; default: string }
  | { key: string; label: string; kind: "bitstring"; minLength: number; maxLength: number; default: string }
  | { key: string; label: string; kind: "edges"; default: [number, number][] };

export type BlockParams = Record<string, number | string | [number, number][]>;

export type BlockCategory = "state-preparation" | "transforms" | "oracles" | "arithmetic" | "simulation" | "variational";

/** root first, then every nested definition exactly once. */
export type BuiltBlock = { root: CustomGateDefinition; definitions: CustomGateDefinition[] };

export type BlockTemplate = {
  key: string;
  name: string;
  category: BlockCategory;
  summary: string;
  params: BlockParamSpec[];
  qubitCount(params: BlockParams): number;
  build(params: BlockParams): BuiltBlock;
};

// ---------------------------------------------------------------------------
// Internal step-building helpers. `GateSpec` is a BuilderStep without an id;
// `withIds` assigns deterministic, positional ids so `build()` never touches
// Date.now/Math.random.

type GateSpec = { gate: BuilderGate; qubits: number[]; param?: string; customGateId?: string };

function withIds(prefix: string, specs: GateSpec[]): BuilderStep[] {
  return specs.map((spec, index) => ({ id: `${prefix}-${index}`, ...spec }));
}

const h = (q: number): GateSpec => ({ gate: "H", qubits: [q] });
const x = (q: number): GateSpec => ({ gate: "X", qubits: [q] });
const z = (q: number): GateSpec => ({ gate: "Z", qubits: [q] });
const cx = (c: number, t: number): GateSpec => ({ gate: "CX", qubits: [c, t] });
const ccx = (a: number, b: number, t: number): GateSpec => ({ gate: "CCX", qubits: [a, b, t] });
const swapGate = (a: number, b: number): GateSpec => ({ gate: "SWAP", qubits: [a, b] });
const rx = (q: number, theta: string): GateSpec => ({ gate: "RX", qubits: [q], param: theta });
const rz = (q: number, theta: string): GateSpec => ({ gate: "RZ", qubits: [q], param: theta });
const ry = (q: number, theta: string): GateSpec => ({ gate: "RY", qubits: [q], param: theta });
const cp = (a: number, b: number, theta: string): GateSpec => ({ gate: "CP", qubits: [a, b], param: theta });
const rzzGate = (a: number, b: number, theta: string): GateSpec => ({ gate: "RZZ", qubits: [a, b], param: theta });
const customStep = (customGateId: string, qubits: number[]): GateSpec => ({ gate: "CUSTOM", qubits, customGateId });

function negateAngle(angle: string): string {
  return angle.startsWith("-") ? angle.slice(1) : `-${angle}`;
}

/** The adjoint of a single step, for gates this file actually emits (H, X, Z,
 * S/T/SDG/TDG, RX/RY/RZ/P/CP/RZZ, CX/CCX, SWAP). Used to build an exact
 * inverse by reversing a step list and adjointing each step, rather than
 * re-deriving the inverse circuit by hand. */
function adjointStep(step: GateSpec): GateSpec {
  switch (step.gate) {
    case "S": return { ...step, gate: "SDG" };
    case "SDG": return { ...step, gate: "S" };
    case "T": return { ...step, gate: "TDG" };
    case "TDG": return { ...step, gate: "T" };
    case "RX": case "RY": case "RZ": case "P": case "CP": case "RZZ":
      return { ...step, param: negateAngle(step.param!) };
    default:
      // H, X, Y, Z, CX, CZ, SWAP, CCX are their own inverse.
      return step;
  }
}

function adjointSteps(steps: GateSpec[]): GateSpec[] {
  return [...steps].reverse().map(adjointStep);
}

/**
 * exp(-i * rzAngle/2 * Z_{qubits[0]} (x) ... (x) Z_{qubits[k-1]}), the
 * standard CNOT-staircase generalisation of RZ to a multi-qubit "ZZ...Z"
 * rotation — ancilla-free, exact. Qubit order within the list doesn't matter
 * mathematically (Z-parity is symmetric); it only fixes which qubit carries
 * the mid-staircase RZ.
 */
function zParityRotation(qubits: number[], rzAngle: string): GateSpec[] {
  if (qubits.length === 1) return [rz(qubits[0], rzAngle)];
  const ladder = qubits.slice(0, -1).map((q, i) => cx(q, qubits[i + 1]));
  const last = qubits[qubits.length - 1];
  return [...ladder, rz(last, rzAngle), ...[...ladder].reverse()];
}

/**
 * Multi-controlled Z: phase -1 exactly on |1...1>, +1 on every other basis
 * state, up to a global phase. No ancilla — used by `mcz`, `phase_oracle`
 * (X-conjugated) and `grover_diffuser` (X-conjugated).
 *
 * Decomposition, via the standard multilinear/Mobius expansion: writing
 * z_i = 1-2*b_i for each bit b_i,
 *   b_1...b_n = (1/2^n) * sum_{S subset of {1..n}} (-1)^|S| * prod_{i in S} z_i.
 * So exp(i*pi*b_1...b_n) = exp(i*pi/2^n) * prod over NONEMPTY S of
 * exp(i*theta_S*Z_S), theta_S = (pi/2^n)*(-1)^|S|. The leading exp(i*pi/2^n)
 * factor does not depend on any qubit — it is a genuine global phase — and is
 * dropped; every other factor is implemented via `zParityRotation`, which
 * needs rzAngle = -2*theta_S = (-1)^(|S|+1) * pi/2^(n-1).
 *
 * O(2^n) gates: appropriate for the n<=6 this block (and its callers) are
 * bounded to. A linear-ancilla construction would be needed to scale a
 * multi-controlled phase further; that tradeoff is exactly why the bound
 * exists.
 */
function mczSteps(qubits: number[]): GateSpec[] {
  const n = qubits.length;
  if (n === 0) return [];
  if (n === 1) return [z(qubits[0])];
  const steps: GateSpec[] = [];
  const subsetCount = 1 << n;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const subset = qubits.filter((_, i) => (mask & (1 << i)) !== 0);
    const rzAngle = subset.length % 2 === 0 ? `-pi/${1 << (n - 1)}` : `pi/${1 << (n - 1)}`;
    steps.push(...zParityRotation(subset, rzAngle));
  }
  return steps;
}

/**
 * QFT with the final swaps, so qubit `i` of the output is bit `i` of the
 * transformed index (matching this file's own qubit-order convention).
 * |x> -> (1/sqrt(N)) * sum_y e^{2*pi*i*x*y/N} |y>.
 *
 * Processes qubits from the MOST significant (n-1) down to the LEAST (0):
 * qubit i's own H gives it the coarsest correction (from x_i alone), and the
 * CP cascade from every not-yet-processed j<i adds finer corrections while
 * qubit j is still in its definite input value. Processing low-to-high
 * instead (0 first) computes QFT of the BIT-REVERSED input — verified
 * empirically against e^{2*pi*i*x*y/N} the direct way (raw amplitudes, not
 * just magnitudes) before fixing this from an earlier, wrong loop direction.
 */
function qftSteps(qubits: number[]): GateSpec[] {
  const n = qubits.length;
  const steps: GateSpec[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    steps.push(h(qubits[i]));
    for (let j = i - 1; j >= 0; j -= 1) {
      steps.push(cp(qubits[j], qubits[i], `pi/${1 << (i - j)}`));
    }
  }
  for (let i = 0; i < Math.floor(n / 2); i += 1) {
    steps.push(swapGate(qubits[i], qubits[n - 1 - i]));
  }
  return steps;
}

function qftInverseSteps(qubits: number[]): GateSpec[] {
  return adjointSteps(qftSteps(qubits));
}

/** A numeric angle string — always valid, at the cost of losing any symbolic
 * (pi-multiple) form the inputs had. Used where a block multiplies a
 * caller-supplied angle by an integer factor that isn't expressible by
 * appending to the "(coefficient*)pi(/denominator)" grammar alone (e.g. the
 * caller's own angle is already a general expression, not a bare pi-fraction). */
function numericAngle(...factors: Array<string | number>): string {
  const value = factors.reduce((acc: number, factor) => {
    const radians = typeof factor === "number" ? factor : gateAngleRadians(factor);
    if (radians === null) throw new Error(`invalid angle expression: ${String(factor)}`);
    return acc * radians;
  }, 1);
  if (!Number.isFinite(value)) throw new Error("angle expression did not evaluate to a finite number");
  return String(value);
}

function controlledPhasePowersSteps(t: number, angle: string): GateSpec[] {
  const steps: GateSpec[] = [];
  for (let k = 0; k < t; k += 1) steps.push(cp(k, t, numericAngle(angle, 1 << k)));
  return steps;
}

function qpePhaseSteps(t: number, angle: string): GateSpec[] {
  const steps: GateSpec[] = [x(t)];
  for (let k = 0; k < t; k += 1) steps.push(h(k));
  steps.push(...controlledPhasePowersSteps(t, angle));
  steps.push(...qftInverseSteps(Array.from({ length: t }, (_, i) => i)));
  return steps;
}

/** Bitstring -> qubit assignment matching this file's documented convention:
 * character 0 is the highest-numbered qubit, the last character is qubit 0. */
function bitAt(bitstring: string, qubit: number, length: number): "0" | "1" {
  return bitstring[length - 1 - qubit] as "0" | "1";
}

// ---------------------------------------------------------------------------
// Block definitions

function intParam(key: string, label: string, min: number, max: number, def: number): BlockParamSpec {
  return { key, label, kind: "int", min, max, default: def };
}
function angleParam(key: string, label: string, def: string): BlockParamSpec {
  return { key, label, kind: "angle", default: def };
}
function bitstringParam(key: string, label: string, minLength: number, maxLength: number, def: string): BlockParamSpec {
  return { key, label, kind: "bitstring", minLength, maxLength, default: def };
}

function asInt(params: BlockParams, key: string): number {
  const value = params[key];
  if (typeof value !== "number") throw new Error(`${key} must be a number`);
  return value;
}
function asAngle(params: BlockParams, key: string): string {
  const value = params[key];
  if (typeof value !== "string") throw new Error(`${key} must be an angle string`);
  return value;
}
function asBitstring(params: BlockParams, key: string): string {
  const value = params[key];
  if (typeof value !== "string") throw new Error(`${key} must be a bitstring`);
  return value;
}
function asEdges(params: BlockParams, key: string): [number, number][] {
  const value = params[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be a list of edges`);
  return value as [number, number][];
}

/** A BuiltBlock with no nested sub-blocks: root only, empty definitions. */
function leafBlock(id: string, name: string, qubitCount: number, steps: GateSpec[]): BuiltBlock {
  return { root: { id, name, qubitCount, steps: withIds(id, steps) }, definitions: [] };
}

const BELL: BlockTemplate = {
  key: "bell",
  name: "Bell pair",
  category: "state-preparation",
  summary: "Prepares the two-qubit maximally entangled state (|00> + |11>) / sqrt(2).",
  params: [],
  qubitCount: () => 2,
  build: () => leafBlock("bell", "Bell pair", 2, [h(0), cx(0, 1)]),
};

const GHZ: BlockTemplate = {
  key: "ghz",
  name: "GHZ state",
  category: "state-preparation",
  summary: "Prepares the n-qubit GHZ state (|0...0> + |1...1>) / sqrt(2) with a Hadamard and a CX chain.",
  params: [intParam("n", "Qubits", 2, 20, 3)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    const steps: GateSpec[] = [h(0), ...Array.from({ length: n - 1 }, (_, i) => cx(i, i + 1))];
    return leafBlock(`ghz-${n}`, `GHZ(${n})`, n, steps);
  },
};

const HADAMARD_LAYER: BlockTemplate = {
  key: "hadamard_layer",
  name: "Hadamard layer",
  category: "state-preparation",
  summary: "Applies a Hadamard to every qubit, preparing the uniform superposition over all n-bit strings.",
  params: [intParam("n", "Qubits", 1, 20, 3)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    return leafBlock(`hadamard-layer-${n}`, `Hadamard layer(${n})`, n, Array.from({ length: n }, (_, i) => h(i)));
  },
};

const QFT: BlockTemplate = {
  key: "qft",
  name: "Quantum Fourier Transform",
  category: "transforms",
  summary: "Maps |x> to the equal-magnitude superposition sum_y e^(2*pi*i*x*y/N)|y>, including the final swaps.",
  params: [intParam("n", "Qubits", 1, 16, 4)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    return leafBlock(`qft-${n}`, `QFT(${n})`, n, qftSteps(Array.from({ length: n }, (_, i) => i)));
  },
};

const QFT_INVERSE: BlockTemplate = {
  key: "qft_inverse",
  name: "Inverse Quantum Fourier Transform",
  category: "transforms",
  summary: "The exact adjoint of the QFT block: final swaps first, then reversed, angle-negated rotations.",
  params: [intParam("n", "Qubits", 1, 16, 4)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    return leafBlock(`qft-inverse-${n}`, `QFT inverse(${n})`, n, qftInverseSteps(Array.from({ length: n }, (_, i) => i)));
  },
};

const MCZ: BlockTemplate = {
  key: "mcz",
  name: "Multi-controlled Z",
  category: "oracles",
  summary: "Flips the phase of exactly |1...1>, ancilla-free, from CP/CX (see the module comment for the decomposition).",
  params: [intParam("n", "Qubits", 1, 6, 3)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    return leafBlock(`mcz-${n}`, `MCZ(${n})`, n, mczSteps(Array.from({ length: n }, (_, i) => i)));
  },
};

const PHASE_ORACLE: BlockTemplate = {
  key: "phase_oracle",
  name: "Phase oracle",
  category: "oracles",
  summary: "Flips the sign of exactly the basis state named by the bitstring, leaving every other state unchanged.",
  params: [bitstringParam("bitstring", "Target bitstring", 1, 6, "101")],
  qubitCount: (p) => asBitstring(p, "bitstring").length,
  build: (p) => {
    const s = asBitstring(p, "bitstring");
    const n = s.length;
    const qubits = Array.from({ length: n }, (_, i) => i);
    const zeroBits = qubits.filter((q) => bitAt(s, q, n) === "0");
    const steps: GateSpec[] = [...zeroBits.map((q) => x(q)), ...mczSteps(qubits), ...zeroBits.map((q) => x(q))];
    return leafBlock(`phase-oracle-${s}`, `Phase oracle(${s})`, n, steps);
  },
};

const GROVER_DIFFUSER: BlockTemplate = {
  key: "grover_diffuser",
  name: "Grover diffuser",
  category: "oracles",
  summary: "Reflects about the uniform superposition: 2|s><s| - I, up to a global phase.",
  params: [intParam("n", "Qubits", 1, 6, 3)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    const qubits = Array.from({ length: n }, (_, i) => i);
    const steps: GateSpec[] = [
      ...qubits.map((q) => h(q)),
      ...qubits.map((q) => x(q)),
      ...mczSteps(qubits),
      ...qubits.map((q) => x(q)),
      ...qubits.map((q) => h(q)),
    ];
    return leafBlock(`grover-diffuser-${n}`, `Grover diffuser(${n})`, n, steps);
  },
};

const GROVER_ITERATION: BlockTemplate = {
  key: "grover_iteration",
  name: "Grover iteration",
  category: "oracles",
  summary: "One Grover iteration for the given target: the phase oracle followed by the diffuser, each its own expandable block.",
  params: [bitstringParam("bitstring", "Target bitstring", 1, 6, "101")],
  qubitCount: (p) => asBitstring(p, "bitstring").length,
  build: (p) => {
    const s = asBitstring(p, "bitstring");
    const n = s.length;
    const qubits = Array.from({ length: n }, (_, i) => i);
    const oracleBuilt = PHASE_ORACLE.build({ bitstring: s });
    const diffuserBuilt = GROVER_DIFFUSER.build({ n });
    const oracle = instantiateBlock(oracleBuilt, qubits, "oracle");
    const diffuser = instantiateBlock(diffuserBuilt, qubits, "diffuser");
    return {
      root: {
        id: `grover-iteration-${s}`,
        name: `Grover iteration(${s})`,
        qubitCount: n,
        steps: [oracle.step, diffuser.step],
      },
      definitions: [...oracle.customGates, ...diffuser.customGates],
    };
  },
};

const BV_ORACLE: BlockTemplate = {
  key: "bv_oracle",
  name: "Bernstein-Vazirani oracle",
  category: "oracles",
  summary: "Kicks the secret string's dot product onto one ancilla qubit via CX, for phase kickback against an ancilla in |->.",
  params: [bitstringParam("secret", "Secret string", 1, 10, "1011")],
  qubitCount: (p) => asBitstring(p, "secret").length + 1,
  build: (p) => {
    const secret = asBitstring(p, "secret");
    const n = secret.length;
    const ancilla = n;
    const steps: GateSpec[] = Array.from({ length: n }, (_, q) => q)
      .filter((q) => bitAt(secret, q, n) === "1")
      .map((q) => cx(q, ancilla));
    return leafBlock(`bv-oracle-${secret}`, `BV oracle(${secret})`, n + 1, steps);
  },
};

const DJ_BALANCED_ORACLE: BlockTemplate = {
  key: "dj_balanced_oracle",
  name: "Deutsch-Jozsa balanced oracle",
  category: "oracles",
  summary: "A specific balanced function f(x) = x_0 XOR x_1 XOR ... XOR x_(n-1) (the full parity), via CX onto one ancilla.",
  params: [intParam("n", "Input qubits", 1, 10, 3)],
  qubitCount: (p) => asInt(p, "n") + 1,
  build: (p) => {
    const n = asInt(p, "n");
    const ancilla = n;
    const steps: GateSpec[] = Array.from({ length: n }, (_, q) => cx(q, ancilla));
    return leafBlock(`dj-balanced-oracle-${n}`, `DJ balanced oracle(${n})`, n + 1, steps);
  },
};

const CONTROLLED_PHASE_POWERS: BlockTemplate = {
  key: "controlled_phase_powers",
  name: "Controlled phase powers",
  category: "oracles",
  summary: "Applies P(angle) to the target, controlled by counting qubit k with power 2^k — the QPE control ladder.",
  params: [intParam("t", "Counting qubits", 1, 8, 3), angleParam("angle", "Phase angle", "pi/4")],
  qubitCount: (p) => asInt(p, "t") + 1,
  build: (p) => {
    const t = asInt(p, "t");
    const angle = asAngle(p, "angle");
    return leafBlock(`controlled-phase-powers-${t}`, `Controlled phase powers(${t})`, t + 1, controlledPhasePowersSteps(t, angle));
  },
};

const QPE_PHASE: BlockTemplate = {
  key: "qpe_phase",
  name: "Phase estimation of P(angle)",
  category: "oracles",
  summary: "Estimates angle/(2*pi) into t counting qubits, using the P(angle) eigenstate |1> prepared on the target.",
  params: [intParam("t", "Counting qubits", 1, 8, 3), angleParam("angle", "Phase angle", "pi/4")],
  qubitCount: (p) => asInt(p, "t") + 1,
  build: (p) => {
    const t = asInt(p, "t");
    const angle = asAngle(p, "angle");
    const target = t;
    const counting = Array.from({ length: t }, (_, i) => i);
    const controlledBuilt = CONTROLLED_PHASE_POWERS.build({ t, angle });
    const inverseQftBuilt = QFT_INVERSE.build({ n: t });
    const controlled = instantiateBlock(controlledBuilt, [...counting, target], "cpp");
    const inverseQft = instantiateBlock(inverseQftBuilt, counting, "iqft");
    return {
      root: {
        id: `qpe-phase-${t}`,
        name: `QPE phase(${t})`,
        qubitCount: t + 1,
        steps: [{ id: "prep-eigenstate", gate: "X", qubits: [target] }, ...counting.map((q, i) => ({ id: `h-${i}`, gate: "H" as const, qubits: [q] })), controlled.step, inverseQft.step],
      },
      definitions: [...controlled.customGates, ...inverseQft.customGates],
    };
  },
};

const DRAPER_ADD_CONSTANT: BlockTemplate = {
  key: "draper_add_constant",
  name: "Draper adder (constant)",
  category: "arithmetic",
  summary: "Adds the constant a modulo 2^n using QFT, per-qubit phase rotations, then inverse QFT — no ancilla.",
  params: [intParam("n", "Qubits", 2, 12, 4), intParam("a", "Constant to add", 0, 4095, 3)],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    const a = asInt(p, "a");
    const qubits = Array.from({ length: n }, (_, i) => i);
    // D(y) = exp(2*pi*i*a*y/2^n) applied to the QFT'd state adds `a` (see the
    // module's derivation in the code review — briefly: QFT|x> carries phase
    // e^{2*pi*i*x*y/N}, and multiplying every amplitude by e^{2*pi*i*a*y/N}
    // turns that into QFT|x+a mod N>). D(y) factors per qubit k as
    // P(2*pi*a/2^(n-k)) since qubit k is bit k of y.
    const rotations = qubits.map((k) => cp0(k, n, a));
    const steps: GateSpec[] = [...qftSteps(qubits), ...rotations, ...qftInverseSteps(qubits)];
    return leafBlock(`draper-add-${n}-${a}`, `Draper add ${a} (mod ${1 << n})`, n, steps);
  },
};

function cp0(qubit: number, n: number, a: number): GateSpec {
  // P, not CP: this is D(y)'s per-qubit factor, a single-qubit phase gate.
  return { gate: "P", qubits: [qubit], param: `${2 * a}*pi/${1 << (n - qubit)}` };
}

const ISING_TROTTER_STEP: BlockTemplate = {
  key: "ising_trotter_step",
  name: "Ising Trotter step",
  category: "simulation",
  summary: "One first-order Trotter step of a transverse-field Ising chain: RZZ(2*J*dt) on neighbouring pairs, then RX(2*h*dt).",
  params: [intParam("n", "Qubits", 2, 12, 4), angleParam("J", "Coupling J", "1"), angleParam("h", "Field h", "1"), angleParam("dt", "Time step dt", "0.1")],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    const J = asAngle(p, "J");
    const hField = asAngle(p, "h");
    const dt = asAngle(p, "dt");
    const zz = numericAngle(2, J, dt);
    const xAngle = numericAngle(2, hField, dt);
    const steps: GateSpec[] = [
      ...Array.from({ length: n - 1 }, (_, i) => rzzGate(i, i + 1, zz)),
      ...Array.from({ length: n }, (_, i) => rx(i, xAngle)),
    ];
    return leafBlock(`ising-trotter-step-${n}`, `Ising Trotter step(${n})`, n, steps);
  },
};

const HARDWARE_EFFICIENT_LAYER: BlockTemplate = {
  key: "hardware_efficient_layer",
  name: "Hardware-efficient layer",
  category: "variational",
  summary: "A single variational layer: RY(theta) on every qubit, then a CX ladder along the line.",
  params: [intParam("n", "Qubits", 1, 12, 3), angleParam("theta", "Rotation angle", "pi/4")],
  qubitCount: (p) => asInt(p, "n"),
  build: (p) => {
    const n = asInt(p, "n");
    const theta = asAngle(p, "theta");
    const steps: GateSpec[] = [...Array.from({ length: n }, (_, i) => ry(i, theta)), ...Array.from({ length: n - 1 }, (_, i) => cx(i, i + 1))];
    return leafBlock(`hardware-efficient-layer-${n}`, `Hardware-efficient layer(${n})`, n, steps);
  },
};

const QAOA_MAXCUT_LAYER: BlockTemplate = {
  key: "qaoa_maxcut_layer",
  name: "QAOA MaxCut layer",
  category: "variational",
  summary: "One QAOA MaxCut layer: RZZ(2*gamma) per edge (the cost unitary), then RX(2*beta) on every qubit (the mixer).",
  params: [
    { key: "edges", label: "Graph edges", kind: "edges", default: [[0, 1], [1, 2], [2, 3], [3, 0]] },
    angleParam("gamma", "Cost angle (gamma)", "pi/4"),
    angleParam("beta", "Mixer angle (beta)", "pi/8"),
  ],
  qubitCount: (p) => {
    const edges = asEdges(p, "edges");
    return edges.length === 0 ? 1 : Math.max(...edges.flat()) + 1;
  },
  build: (p) => {
    const edges = asEdges(p, "edges");
    const gamma = asAngle(p, "gamma");
    const beta = asAngle(p, "beta");
    const n = edges.length === 0 ? 1 : Math.max(...edges.flat()) + 1;
    const zzAngle = numericAngle(2, gamma);
    const xAngle = numericAngle(2, beta);
    const steps: GateSpec[] = [
      ...edges.map(([a, b]) => rzzGate(a, b, zzAngle)),
      ...Array.from({ length: n }, (_, i) => rx(i, xAngle)),
    ];
    return leafBlock(`qaoa-maxcut-layer-${edges.map(([a, b]) => `${a}-${b}`).join("_")}`, "QAOA MaxCut layer", n, steps);
  },
};

const SWAP_TEST: BlockTemplate = {
  key: "swap_test",
  name: "Swap test",
  category: "simulation",
  summary: "Compares two n-qubit registers via one ancilla and controlled swaps: the ancilla reads |0> with probability (1+|<a|b>|^2)/2.",
  params: [intParam("n", "Register width", 1, 6, 1)],
  qubitCount: (p) => 2 * asInt(p, "n") + 1,
  build: (p) => {
    const n = asInt(p, "n");
    const ancilla = 0;
    const steps: GateSpec[] = [h(ancilla)];
    for (let i = 1; i <= n; i += 1) {
      const a = i;
      const b = n + i;
      // CSWAP(control, t1, t2) = CX(t1,t2); CCX(control,t2,t1); CX(t1,t2) —
      // the same Fredkin-via-Toffoli identity circuit-conversion.ts already
      // uses for its own cswap interchange decomposition.
      steps.push(cx(a, b), ccx(ancilla, b, a), cx(a, b));
    }
    steps.push(h(ancilla));
    return leafBlock(`swap-test-${n}`, `Swap test(${n})`, 2 * n + 1, steps);
  },
};

export const BLOCK_TEMPLATES: readonly BlockTemplate[] = [
  BELL,
  GHZ,
  HADAMARD_LAYER,
  QFT,
  QFT_INVERSE,
  MCZ,
  PHASE_ORACLE,
  GROVER_DIFFUSER,
  GROVER_ITERATION,
  BV_ORACLE,
  DJ_BALANCED_ORACLE,
  CONTROLLED_PHASE_POWERS,
  QPE_PHASE,
  DRAPER_ADD_CONSTANT,
  ISING_TROTTER_STEP,
  HARDWARE_EFFICIENT_LAYER,
  QAOA_MAXCUT_LAYER,
  SWAP_TEST,
];

export function blockTemplate(key: string): BlockTemplate | undefined {
  return BLOCK_TEMPLATES.find((t) => t.key === key);
}

export function validateBlockParams(template: BlockTemplate, params: BlockParams): string | null {
  for (const spec of template.params) {
    const value = params[spec.key];
    if (spec.kind === "int") {
      if (typeof value !== "number" || !Number.isInteger(value)) return `${spec.label} must be a whole number.`;
      if (value < spec.min || value > spec.max) return `${spec.label} must be between ${spec.min} and ${spec.max}.`;
    } else if (spec.kind === "angle") {
      if (typeof value !== "string" || !isGateAngle(value)) return `${spec.label} must be a valid angle expression, like "pi/4".`;
    } else if (spec.kind === "bitstring") {
      if (typeof value !== "string" || !/^[01]+$/.test(value)) return `${spec.label} must be a string of 0s and 1s.`;
      if (value.length < spec.minLength || value.length > spec.maxLength) {
        return `${spec.label} must be between ${spec.minLength} and ${spec.maxLength} characters.`;
      }
    } else {
      if (
        !Array.isArray(value)
        || !value.every((edge) => Array.isArray(edge) && edge.length === 2 && edge.every((q) => Number.isInteger(q) && q >= 0))
      ) return `${spec.label} must be a list of qubit-index pairs.`;
    }
  }
  return null;
}

/**
 * Place a built block onto specific qubits in a live circuit: a fresh CUSTOM
 * step referencing the block's root, and every definition it needs (root
 * included) with ids remapped so two instances of the same — or different —
 * blocks in one circuit never collide. Qubit numbering inside every
 * CustomGateDefinition's own `steps` stays local (0..qubitCount-1); only the
 * returned top-level `step.qubits` names the actual circuit wires, exactly
 * how every other CUSTOM step in this codebase already works.
 */
export function instantiateBlock(built: BuiltBlock, qubits: number[], idPrefix: string): { step: BuilderStep; customGates: CustomGateDefinition[] } {
  const remapped = new Map<string, string>();
  const remapId = (id: string): string => {
    const existing = remapped.get(id);
    if (existing) return existing;
    const next = `${idPrefix}-${id}`;
    remapped.set(id, next);
    return next;
  };
  const allDefs = [built.root, ...built.definitions];
  const customGates = allDefs.map((def) => ({
    ...def,
    id: remapId(def.id),
    steps: def.steps.map((step) => ({
      ...step,
      id: `${idPrefix}-${def.id}-${step.id}`,
      ...(step.gate === "CUSTOM" && step.customGateId ? { customGateId: remapId(step.customGateId) } : {}),
    })),
  }));
  return {
    step: { id: `${idPrefix}-root`, gate: "CUSTOM", customGateId: remapId(built.root.id), qubits },
    customGates,
  };
}
