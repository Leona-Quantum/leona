import { parseGateAngle } from "./gate-angle.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";

/**
 * The pure statevector kernel behind Studio's bounded browser simulator —
 * extracted from studio-simulation.ts (Atlas worked-example figure lane,
 * 2026-09-15) so a PUBLIC, unauthenticated component can compute a small
 * worked example's probabilities without pulling in that file's other
 * imports: `./user-storage.ts` (per-account `localStorage`, WorkOS-scoped)
 * and `./account-tier.ts` (reads `LEONA_TEAM_EMAILS` / `LEONA_DEVELOPER_EMAILS`
 * from the environment). Neither belongs in a bundle a signed-out visitor to
 * `/repository/<slug>` downloads, and importing anything from
 * studio-simulation.ts — even one re-exported binding — pulls the whole
 * module's evaluation along with it (the same failure `client-catalog-leak.test.ts`
 * guards for `public-repository.ts`).
 *
 * This file has no side effects at module scope and touches no browser or
 * account API — every export here is a pure function of its arguments.
 *
 * studio-simulation.ts re-exports `idealStatevector`, `idealProbabilities`,
 * `singleQubitUnitary`, `bitstringFor`, `ComplexMatrix` and
 * `SingleQubitUnitaryGate` from here unchanged, and imports `executeCircuit`
 * back for its own (impure) `runCpuSimulation` — so existing callers of
 * studio-simulation.ts (gate-inspector.ts, studio-playhead.ts, its own test
 * file) see no behavior change. A caller that must not risk studio-simulation.ts's
 * other imports — this file's own reason for existing — imports directly from
 * here instead.
 *
 * Qubit-order convention (unchanged from studio-simulation.ts): a basis
 * state's amplitude lives at statevector index `sum_i bit_i * 2^i` — qubit
 * `i` is bit `i` of the index. `bitstringFor` prints character 0 as the
 * highest-numbered qubit.
 */

export type ComplexMatrix = readonly [number, number, number, number, number, number, number, number];

export type SingleQubitUnitaryGate = "H" | "X" | "Y" | "Z" | "S" | "T" | "SDG" | "TDG" | "RX" | "RY" | "RZ" | "P";

/**
 * The 2×2 unitary this kernel applies for a one-qubit gate, as
 * [re00, im00, re01, im01, re10, im10, re11, im11]. Exported so Studio's gate
 * inspector prints the matrix that actually runs, not a second copy of it.
 */
export function singleQubitUnitary(gate: SingleQubitUnitaryGate, theta = 0): ComplexMatrix {
  switch (gate) {
    case "H": return HADAMARD;
    case "X": return PAULI_X;
    case "Y": return PAULI_Y;
    case "Z": return PAULI_Z;
    case "S": return PHASE_S;
    case "T": return PHASE_T;
    case "SDG": return PHASE_SDG;
    case "TDG": return PHASE_TDG;
    case "RX": return rotationX(theta);
    case "RY": return rotationY(theta);
    case "RZ": return rotationZ(theta);
    case "P": return phaseGate(theta);
  }
}

/**
 * The ideal statevector itself, from the same kernel the CPU lane samples —
 * real and imaginary parts, one entry per basis index. Exported for callers
 * that need genuine amplitude information and not just |amplitude|² —
 * worked-examples.ts's `expectationValue`, for an observable with an X or Y
 * term, is the reason this exists: those are off-diagonal, so a probability
 * distribution alone cannot recover ⟨psi|H|psi⟩. Throws where the kernel
 * does: custom gates, and angles outside its syntax.
 */
export function idealStatevector(circuit: ParsedBuilderCircuit): { real: Float64Array; imaginary: Float64Array } {
  return executeCircuit(circuit);
}

/**
 * Ideal outcome probabilities, |amplitude|² per basis index, from the same kernel
 * the CPU lane samples. Measurements are terminal here exactly as they are there.
 * Throws where the kernel does: custom gates, and angles outside its syntax.
 */
export function idealProbabilities(circuit: ParsedBuilderCircuit): Float64Array {
  const state = executeCircuit(circuit);
  const probabilities = new Float64Array(state.real.length);
  for (let index = 0; index < probabilities.length; index += 1) {
    probabilities[index] = state.real[index] ** 2 + state.imaginary[index] ** 2;
  }
  return probabilities;
}

/** Runs a parsed circuit through the statevector kernel. Exported so
 * studio-simulation.ts's (impure) `runCpuSimulation` can reuse it without a
 * second implementation. */
export function executeCircuit(circuit: ParsedBuilderCircuit): { real: Float64Array; imaginary: Float64Array } {
  const dimension = 1 << circuit.qubitCount;
  const real = new Float64Array(dimension);
  const imaginary = new Float64Array(dimension);
  real[0] = 1;

  for (const step of circuit.steps) {
    const [first, second, third] = step.qubits;
    switch (step.gate) {
      case "H": applySingleQubit(real, imaginary, first, HADAMARD); break;
      case "X": applySingleQubit(real, imaginary, first, PAULI_X); break;
      case "Y": applySingleQubit(real, imaginary, first, PAULI_Y); break;
      case "Z": applySingleQubit(real, imaginary, first, PAULI_Z); break;
      case "S": applySingleQubit(real, imaginary, first, PHASE_S); break;
      case "T": applySingleQubit(real, imaginary, first, PHASE_T); break;
      case "SDG": applySingleQubit(real, imaginary, first, PHASE_SDG); break;
      case "TDG": applySingleQubit(real, imaginary, first, PHASE_TDG); break;
      case "RX": applySingleQubit(real, imaginary, first, rotationX(angle(step.param))); break;
      case "RY": applySingleQubit(real, imaginary, first, rotationY(angle(step.param))); break;
      case "RZ": applySingleQubit(real, imaginary, first, rotationZ(angle(step.param))); break;
      case "P": applySingleQubit(real, imaginary, first, phaseGate(angle(step.param))); break;
      case "CX": applyControlledX(real, imaginary, first, second); break;
      case "CZ": applyControlledZ(real, imaginary, first, second); break;
      case "SWAP": applySwap(real, imaginary, first, second); break;
      case "CP": applyControlledPhase(real, imaginary, first, second, angle(step.param)); break;
      case "RZZ": applyRzz(real, imaginary, first, second, angle(step.param)); break;
      case "CCX": applyToffoli(real, imaginary, first, second, third); break;
      // Builder parsers only emit terminal measurements. Sampling happens after
      // the unitary evolution, so measurement is represented in the record.
      case "M": break;
      case "CUSTOM": throw new Error("Custom gates are not eligible for the bounded CPU simulator.");
    }
  }
  return { real, imaginary };
}

function applySingleQubit(real: Float64Array, imaginary: Float64Array, qubit: number, matrix: ComplexMatrix) {
  const mask = 1 << qubit;
  for (let low = 0; low < real.length; low += mask << 1) {
    for (let offset = 0; offset < mask; offset += 1) {
      const zero = low + offset;
      const one = zero + mask;
      const zeroReal = real[zero];
      const zeroImaginary = imaginary[zero];
      const oneReal = real[one];
      const oneImaginary = imaginary[one];
      real[zero] = matrix[0] * zeroReal - matrix[1] * zeroImaginary + matrix[2] * oneReal - matrix[3] * oneImaginary;
      imaginary[zero] = matrix[0] * zeroImaginary + matrix[1] * zeroReal + matrix[2] * oneImaginary + matrix[3] * oneReal;
      real[one] = matrix[4] * zeroReal - matrix[5] * zeroImaginary + matrix[6] * oneReal - matrix[7] * oneImaginary;
      imaginary[one] = matrix[4] * zeroImaginary + matrix[5] * zeroReal + matrix[6] * oneImaginary + matrix[7] * oneReal;
    }
  }
}

function applyControlledX(real: Float64Array, imaginary: Float64Array, control: number, target: number) {
  const controlMask = 1 << control;
  const targetMask = 1 << target;
  for (let index = 0; index < real.length; index += 1) {
    if ((index & controlMask) === 0 || (index & targetMask) !== 0) continue;
    const paired = index | targetMask;
    swapAmplitude(real, imaginary, index, paired);
  }
}

function applyControlledZ(real: Float64Array, imaginary: Float64Array, control: number, target: number) {
  const mask = (1 << control) | (1 << target);
  for (let index = 0; index < real.length; index += 1) {
    if ((index & mask) === mask) {
      real[index] = -real[index];
      imaginary[index] = -imaginary[index];
    }
  }
}

/** CP(θ)|11⟩ = e^{iθ}|11⟩; every other basis amplitude is untouched. */
function applyControlledPhase(real: Float64Array, imaginary: Float64Array, control: number, target: number, theta: number) {
  const mask = (1 << control) | (1 << target);
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  for (let index = 0; index < real.length; index += 1) {
    if ((index & mask) !== mask) continue;
    const re = real[index];
    const im = imaginary[index];
    real[index] = re * cosine - im * sine;
    imaginary[index] = re * sine + im * cosine;
  }
}

/**
 * RZZ(θ) = exp(-iθ/2 Z⊗Z). Z⊗Z's eigenvalue on a basis state is +1 when the
 * two wires' bits agree (00 or 11) and -1 when they differ (01 or 10), so the
 * phase applied is e^{-iθ/2} or e^{+iθ/2} respectively — every amplitude gets
 * a phase, unlike CP above, which touches only |11⟩.
 */
function applyRzz(real: Float64Array, imaginary: Float64Array, first: number, second: number, theta: number) {
  const firstMask = 1 << first;
  const secondMask = 1 << second;
  const halfTheta = theta / 2;
  const agreeCosine = Math.cos(halfTheta);
  const agreeSine = -Math.sin(halfTheta);
  const disagreeCosine = Math.cos(halfTheta);
  const disagreeSine = Math.sin(halfTheta);
  for (let index = 0; index < real.length; index += 1) {
    const agree = Boolean(index & firstMask) === Boolean(index & secondMask);
    const cosine = agree ? agreeCosine : disagreeCosine;
    const sine = agree ? agreeSine : disagreeSine;
    const re = real[index];
    const im = imaginary[index];
    real[index] = re * cosine - im * sine;
    imaginary[index] = re * sine + im * cosine;
  }
}

/** Toffoli: flips `target` when both `controlA` and `controlB` are set. */
function applyToffoli(real: Float64Array, imaginary: Float64Array, controlA: number, controlB: number, target: number) {
  const controlMask = (1 << controlA) | (1 << controlB);
  const targetMask = 1 << target;
  for (let index = 0; index < real.length; index += 1) {
    if ((index & controlMask) !== controlMask || (index & targetMask) !== 0) continue;
    const paired = index | targetMask;
    swapAmplitude(real, imaginary, index, paired);
  }
}

function applySwap(real: Float64Array, imaginary: Float64Array, first: number, second: number) {
  const firstMask = 1 << first;
  const secondMask = 1 << second;
  for (let index = 0; index < real.length; index += 1) {
    const firstBit = index & firstMask;
    const secondBit = index & secondMask;
    if (Boolean(firstBit) === Boolean(secondBit)) continue;
    const paired = index ^ firstMask ^ secondMask;
    if (index < paired) swapAmplitude(real, imaginary, index, paired);
  }
}

function swapAmplitude(real: Float64Array, imaginary: Float64Array, first: number, second: number) {
  [real[first], real[second]] = [real[second], real[first]];
  [imaginary[first], imaginary[second]] = [imaginary[second], imaginary[first]];
}

/** Basis index → bitstring, highest qubit first (q(n-1) … q0), as every record prints it. */
export function bitstringFor(index: number, qubitCount: number): string {
  let result = "";
  for (let qubit = qubitCount - 1; qubit >= 0; qubit -= 1) result += (index & (1 << qubit)) === 0 ? "0" : "1";
  return result;
}

/**
 * Delegates the *validation* to `parseGateAngle` — the single source of truth
 * for this grammar — and only computes the radian value here.
 */
function angle(raw: string | undefined): number {
  if (!raw) throw new Error("Rotation gate is missing its angle.");
  const cleaned = parseGateAngle(raw);
  if (cleaned === null) throw new Error("Rotation angle is outside the bounded simulation syntax.");
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  // Mirrors GATE_ANGLE's own decimal alternative exactly (gate-angle.ts):
  // `\d+(?:\.\d+)?|\.\d+`, so a leading-dot decimal like ".5" or ".5e-3" —
  // which parseGateAngle already accepts — takes this branch too, rather
  // than falling into the pi-branch below and hitting a non-null assertion
  // on a regex that was never going to match it.
  if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(body)) {
    const magnitude = Number(body);
    return negative ? -magnitude : magnitude;
  }
  const match = /^(?:(\d+(?:\.\d+)?)\*)?pi(?:\/(\d+(?:\.\d+)?))?$/i.exec(body);
  // Reachable only if parseGateAngle's grammar and this function's ever
  // drift apart — fails with the same bounded-syntax error a caller already
  // handles, rather than crashing on a null match.
  if (!match) throw new Error("Rotation angle is outside the bounded simulation syntax.");
  const magnitude = (match[1] ? Number(match[1]) : 1) * Math.PI / (match[2] ? Number(match[2]) : 1);
  return negative ? -magnitude : magnitude;
}

function rotationX(theta: number): ComplexMatrix {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [cosine, 0, 0, -sine, 0, -sine, cosine, 0];
}

function rotationY(theta: number): ComplexMatrix {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [cosine, 0, -sine, 0, sine, 0, cosine, 0];
}

function rotationZ(theta: number): ComplexMatrix {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [cosine, -sine, 0, 0, 0, 0, cosine, sine];
}

/** P(θ) = diag(1, e^{iθ}) — a fixed diagonal phase, not a Pauli-axis rotation. */
function phaseGate(theta: number): ComplexMatrix {
  return [1, 0, 0, 0, 0, 0, Math.cos(theta), Math.sin(theta)];
}

const HADAMARD: ComplexMatrix = [Math.SQRT1_2, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, -Math.SQRT1_2, 0];
const PAULI_X: ComplexMatrix = [0, 0, 1, 0, 1, 0, 0, 0];
const PAULI_Y: ComplexMatrix = [0, 0, 0, -1, 0, 1, 0, 0];
const PAULI_Z: ComplexMatrix = [1, 0, 0, 0, 0, 0, -1, 0];
const PHASE_S: ComplexMatrix = [1, 0, 0, 0, 0, 0, 0, 1];
const PHASE_T: ComplexMatrix = [1, 0, 0, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2];
const PHASE_SDG: ComplexMatrix = [1, 0, 0, 0, 0, 0, 0, -1];
const PHASE_TDG: ComplexMatrix = [1, 0, 0, 0, 0, 0, Math.SQRT1_2, -Math.SQRT1_2];
