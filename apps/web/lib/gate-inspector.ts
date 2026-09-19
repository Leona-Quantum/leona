import type { BuilderStep } from "./studio-builder.ts";
import { parseGateAngle } from "./gate-angle.ts";
import { singleQubitUnitary } from "./studio-simulation.ts";

/**
 * What the Studio gate inspector shows about one placed operation.
 *
 * The one-qubit matrices come from `singleQubitUnitary`, the table the browser
 * CPU lane actually applies, rather than from a second hand-typed copy here: an
 * inspector that disagreed with the simulator would be a wrong answer with a
 * confident layout.
 */

export type GateFamily = "clifford" | "rotation" | "entangler" | "measure" | "custom";

export function gateFamily(gate: BuilderStep["gate"]): GateFamily {
  if (gate === "RX" || gate === "RY" || gate === "RZ" || gate === "P") return "rotation";
  if (gate === "CX" || gate === "CZ" || gate === "SWAP" || gate === "CP" || gate === "RZZ" || gate === "CCX") return "entangler";
  if (gate === "M") return "measure";
  if (gate === "CUSTOM") return "custom";
  return "clifford"; // H, X, Y, Z, S, T, SDG, TDG
}

/** Radians for any angle `parseGateAngle` accepts; null for anything it rejects. */
export function gateAngleRadians(value: unknown): number | null {
  const cleaned = parseGateAngle(value);
  if (cleaned === null) return null;
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  const pi = /^(?:(\d+(?:\.\d+)?)\*)?pi(?:\/(\d+(?:\.\d+)?))?$/i.exec(body);
  const magnitude = pi
    ? ((pi[1] ? Number(pi[1]) : 1) * Math.PI) / (pi[2] ? Number(pi[2]) : 1)
    : Number(body);
  if (!Number.isFinite(magnitude)) return null;
  return negative ? -magnitude : magnitude;
}

export type Amplitude = { re: number; im: number };
export type GateUnitary = { size: 2 | 4 | 8; rows: Amplitude[][] };

const real = (value: number): Amplitude => ({ re: value, im: 0 });
const permutation = (rows: number[][]): Amplitude[][] => rows.map((row) => row.map(real));

/**
 * The operation's unitary, or null where there is none to show: a measurement is
 * not unitary, a custom gate's matrix is its steps, and an angle nobody can read
 * has no honest number.
 *
 * Two-qubit matrices are written in the basis |a b⟩ = 00, 01, 10, 11, where `a`
 * is the operation's first qubit (the control, for CX, CZ, CP and RZZ). The
 * three-qubit CCX matrix follows the same convention, |a b c⟩ ascending from
 * 000 to 111 with `a` the first control.
 */
export function gateUnitary(step: Pick<BuilderStep, "gate" | "param">): GateUnitary | null {
  switch (step.gate) {
    case "H":
    case "X":
    case "Y":
    case "Z":
    case "S":
    case "T":
    case "SDG":
    case "TDG":
      return twoByTwo(singleQubitUnitary(step.gate));
    case "RX":
    case "RY":
    case "RZ":
    case "P": {
      const theta = gateAngleRadians(step.param);
      return theta === null ? null : twoByTwo(singleQubitUnitary(step.gate, theta));
    }
    case "CX":
      return { size: 4, rows: permutation([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]]) };
    case "CZ":
      return { size: 4, rows: permutation([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, -1]]) };
    case "SWAP":
      return { size: 4, rows: permutation([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]) };
    case "CP": {
      const theta = gateAngleRadians(step.param);
      if (theta === null) return null;
      const rows = permutation([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]]);
      rows[3][3] = { re: Math.cos(theta), im: Math.sin(theta) };
      return { size: 4, rows };
    }
    case "RZZ": {
      const theta = gateAngleRadians(step.param);
      if (theta === null) return null;
      const agree: Amplitude = { re: Math.cos(theta / 2), im: -Math.sin(theta / 2) };
      const disagree: Amplitude = { re: Math.cos(theta / 2), im: Math.sin(theta / 2) };
      // |00⟩ and |11⟩ agree (Z⊗Z eigenvalue +1); |01⟩ and |10⟩ disagree (-1).
      const diagonal = [agree, disagree, disagree, agree];
      return { size: 4, rows: diagonal.map((entry, index) => diagonal.map((_, column) => (column === index ? entry : { re: 0, im: 0 }))) };
    }
    case "CCX":
      return {
        size: 8,
        rows: permutation([
          [1, 0, 0, 0, 0, 0, 0, 0],
          [0, 1, 0, 0, 0, 0, 0, 0],
          [0, 0, 1, 0, 0, 0, 0, 0],
          [0, 0, 0, 1, 0, 0, 0, 0],
          [0, 0, 0, 0, 1, 0, 0, 0],
          [0, 0, 0, 0, 0, 1, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 1],
          [0, 0, 0, 0, 0, 0, 1, 0],
        ]),
      };
    default:
      return null;
  }
}

function twoByTwo(matrix: readonly number[]): GateUnitary {
  return {
    size: 2,
    rows: [
      [{ re: matrix[0], im: matrix[1] }, { re: matrix[2], im: matrix[3] }],
      [{ re: matrix[4], im: matrix[5] }, { re: matrix[6], im: matrix[7] }],
    ],
  };
}

const EPSILON = 1e-9;
const MINUS = "−";

/** One real magnitude: exact 0, 1 and 1/√2 by name, anything else to three decimals. */
function magnitude(value: number): string {
  const size = Math.abs(value);
  if (Math.abs(size - 1) < EPSILON) return "1";
  if (Math.abs(size - Math.SQRT1_2) < EPSILON) return "1/√2";
  return size.toFixed(3);
}

/** A matrix entry the way an instrument prints it. */
export function formatAmplitude({ re, im }: Amplitude): string {
  const hasRe = Math.abs(re) >= EPSILON;
  const hasIm = Math.abs(im) >= EPSILON;
  if (!hasRe && !hasIm) return "0";
  const imaginary = (value: number) => {
    const text = magnitude(value);
    return text === "1" ? "i" : text === "1/√2" ? "i/√2" : `${text}i`;
  };
  if (!hasIm) return `${re < 0 ? MINUS : ""}${magnitude(re)}`;
  if (!hasRe) return `${im < 0 ? MINUS : ""}${imaginary(im)}`;
  return `${re < 0 ? MINUS : ""}${magnitude(re)} ${im < 0 ? MINUS : "+"} ${imaginary(im)}`;
}
