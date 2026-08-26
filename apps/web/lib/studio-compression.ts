import type { BuilderStep } from "./studio-builder.ts";

export const CIRCUIT_COMPRESSION_STRATEGIES = [
  "inverse_cancellation",
  "rotation_folding",
  "pattern_rewrite",
  "balanced",
] as const;

export type CircuitCompressionStrategy = (typeof CIRCUIT_COMPRESSION_STRATEGIES)[number];

export type CircuitCompressionMetrics = {
  operations: number;
  depth: number;
  twoQubitOperations: number;
};

export type CircuitCompressionResult = {
  strategy: CircuitCompressionStrategy;
  steps: BuilderStep[];
  before: CircuitCompressionMetrics;
  after: CircuitCompressionMetrics;
  changed: boolean;
  removedOperations: number;
};

const SELF_INVERSE = new Set<BuilderStep["gate"]>(["H", "X", "Y", "Z", "CX", "CZ", "SWAP"]);
const ROTATIONS = new Set<BuilderStep["gate"]>(["RX", "RY", "RZ"]);
const SYMMETRIC_TWO_QUBIT = new Set<BuilderStep["gate"]>(["CZ", "SWAP"]);
const EPSILON = 1e-12;

type ParsedAngle = { kind: "pi" | "radians"; value: number };

/**
 * Compress the editable Studio gate model without crossing opaque operations or
 * measurements. Every rewrite is an exact unitary identity; rotations are never
 * reduced modulo 2π because that would silently change global phase.
 */
export function compressCircuit(
  steps: BuilderStep[],
  strategy: CircuitCompressionStrategy,
): CircuitCompressionResult {
  const before = circuitCompressionMetrics(steps);
  const compressed = (() => {
    switch (strategy) {
      case "inverse_cancellation":
        return cancelInversePairs(steps);
      case "rotation_folding":
        return foldRotations(steps);
      case "pattern_rewrite":
        return fixedPoint(steps, rewritePatterns);
      case "balanced":
        return fixedPoint(steps, (current) => (
          cancelInversePairs(rewritePatterns(foldRotations(cancelInversePairs(current))))
        ));
    }
  })();
  const after = circuitCompressionMetrics(compressed);
  return {
    strategy,
    steps: compressed,
    before,
    after,
    changed: semanticSignature(steps) !== semanticSignature(compressed),
    removedOperations: before.operations - after.operations,
  };
}

export function circuitCompressionMetrics(steps: BuilderStep[]): CircuitCompressionMetrics {
  const reached = new Map<number, number>();
  let depth = 0;
  let twoQubitOperations = 0;
  for (const step of steps) {
    if (step.qubits.length > 1) twoQubitOperations += 1;
    const layer = Math.max(0, ...step.qubits.map((qubit) => reached.get(qubit) ?? 0)) + 1;
    for (const qubit of step.qubits) reached.set(qubit, layer);
    depth = Math.max(depth, layer);
  }
  return { operations: steps.length, depth, twoQubitOperations };
}

export function circuitStepSignature(steps: BuilderStep[]): string {
  return semanticSignature(steps);
}

function cancelInversePairs(steps: BuilderStep[]): BuilderStep[] {
  const output: BuilderStep[] = [];
  for (const step of steps) {
    if (!SELF_INVERSE.has(step.gate)) {
      output.push(step);
      continue;
    }
    const previous = previousTouching(output, output.length, step.qubits);
    if (previous >= 0 && sameInverse(output[previous], step)) {
      output.splice(previous, 1);
    } else {
      output.push(step);
    }
  }
  return output;
}

function foldRotations(steps: BuilderStep[]): BuilderStep[] {
  const output: BuilderStep[] = [];
  for (const step of steps) {
    if (!ROTATIONS.has(step.gate) || step.qubits.length !== 1) {
      output.push(step);
      continue;
    }
    const angle = parseAngle(step.param);
    if (!angle) {
      output.push(step);
      continue;
    }
    if (isZero(angle.value)) continue;
    const previous = previousTouching(output, output.length, step.qubits);
    const priorStep = previous >= 0 ? output[previous] : null;
    const priorAngle = priorStep?.gate === step.gate ? parseAngle(priorStep.param) : null;
    if (!priorStep || !priorAngle || priorAngle.kind !== angle.kind) {
      output.push(step);
      continue;
    }
    const total = priorAngle.value + angle.value;
    if (isZero(total)) {
      output.splice(previous, 1);
    } else {
      output[previous] = { ...priorStep, param: formatAngle({ kind: angle.kind, value: total }) };
    }
  }
  return output;
}

function rewritePatterns(steps: BuilderStep[]): BuilderStep[] {
  const output: BuilderStep[] = [];
  for (const step of steps) {
    if ((step.gate === "S" || step.gate === "T") && step.qubits.length === 1) {
      const previous = previousTouching(output, output.length, step.qubits);
      const prior = previous >= 0 ? output[previous] : null;
      if (prior?.gate === step.gate && sameQubits(prior, step)) {
        output[previous] = { ...prior, gate: step.gate === "T" ? "S" : "Z" };
        continue;
      }
    }

    if (step.gate === "H" && step.qubits.length === 1) {
      const middleIndex = previousTouching(output, output.length, step.qubits);
      const middle = middleIndex >= 0 ? output[middleIndex] : null;
      const firstIndex = middle ? previousTouching(output, middleIndex, step.qubits) : -1;
      const first = firstIndex >= 0 ? output[firstIndex] : null;
      if (first?.gate === "H" && (middle?.gate === "X" || middle?.gate === "Z")) {
        output[firstIndex] = { ...first, gate: middle.gate === "X" ? "Z" : "X" };
        output.splice(middleIndex, 1);
        continue;
      }
    }

    if (step.gate === "CX" && step.qubits.length === 2) {
      const middleIndex = previousTouching(output, output.length, step.qubits);
      const middle = middleIndex >= 0 ? output[middleIndex] : null;
      const firstIndex = middle ? previousTouching(output, middleIndex, step.qubits) : -1;
      const first = firstIndex >= 0 ? output[firstIndex] : null;
      if (
        first?.gate === "CX"
        && middle?.gate === "CX"
        && sameOrderedQubits(first.qubits, step.qubits)
        && sameOrderedQubits(middle.qubits, [step.qubits[1], step.qubits[0]])
      ) {
        output[firstIndex] = { ...first, gate: "SWAP" };
        output.splice(middleIndex, 1);
        continue;
      }
    }

    output.push(step);
  }
  return output;
}

function fixedPoint(steps: BuilderStep[], pass: (current: BuilderStep[]) => BuilderStep[]): BuilderStep[] {
  let current = [...steps];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const next = pass(current);
    if (semanticSignature(current) === semanticSignature(next)) return next;
    current = next;
  }
  return current;
}

function previousTouching(steps: BuilderStep[], before: number, qubits: number[]): number {
  const touched = new Set(qubits);
  for (let index = before - 1; index >= 0; index -= 1) {
    if (steps[index].qubits.some((qubit) => touched.has(qubit))) return index;
  }
  return -1;
}

function sameInverse(left: BuilderStep, right: BuilderStep): boolean {
  if (left.gate !== right.gate || left.gate === "CUSTOM" || left.gate === "M") return false;
  if (SYMMETRIC_TWO_QUBIT.has(left.gate)) {
    return [...left.qubits].sort((a, b) => a - b).join(",") === [...right.qubits].sort((a, b) => a - b).join(",");
  }
  return sameQubits(left, right);
}

function sameQubits(left: BuilderStep, right: BuilderStep): boolean {
  return sameOrderedQubits(left.qubits, right.qubits);
}

function sameOrderedQubits(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((qubit, index) => qubit === right[index]);
}

function parseAngle(value: string | undefined): ParsedAngle | null {
  if (!value) return null;
  const cleaned = value.trim().replaceAll(/\s+/g, "").toLowerCase();
  if (!cleaned.includes("pi")) {
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? { kind: "radians", value: numeric } : null;
  }
  const match = /^(-?)(?:(\d+(?:\.\d+)?)\*)?pi(?:\/(\d+(?:\.\d+)?))?$/.exec(cleaned);
  if (!match) return null;
  const denominator = match[3] ? Number(match[3]) : 1;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const coefficient = match[2] ? Number(match[2]) : 1;
  const sign = match[1] === "-" ? -1 : 1;
  return { kind: "pi", value: sign * coefficient / denominator };
}

function formatAngle(angle: ParsedAngle): string {
  const value = rounded(angle.value);
  if (angle.kind === "radians") return String(value);
  if (value === 1) return "pi";
  if (value === -1) return "-pi";
  return `${value}*pi`;
}

function rounded(value: number): number {
  return Number(value.toPrecision(12));
}

function isZero(value: number): boolean {
  return Math.abs(value) < EPSILON;
}

function semanticSignature(steps: BuilderStep[]): string {
  return JSON.stringify(steps.map(({ gate, qubits, param, customGateId }) => ({
    gate,
    qubits,
    param: param ?? null,
    customGateId: customGateId ?? null,
  })));
}
