import { ANGLE_GATES, BUILDER_GATES, builderGateArity, type BuilderStep } from "./studio-builder.ts";
import { parseGateAngle } from "./gate-angle.ts";
import { idealProbabilities } from "./statevector-kernel.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";

/** A local ideal-state experiment. These caps bound the whole sweep, not just one point. */
export const SWEEP_MAX_QUBITS = 12;
export const SWEEP_MAX_OPERATIONS = 512;
export const SWEEP_MAX_POINTS = 41;
export const SWEEP_MIN_POINTS = 3;
export const SWEEP_MAX_WORK = 25_000_000;

export type SweepCircuitIssue = "width" | "operations" | "custom" | "measurement" | "angle" | "invalid";

export type ParameterSweepRequest = {
  circuit: ParsedBuilderCircuit;
  stepId: string;
  measuredQubit: number;
  startDegrees: number;
  endDegrees: number;
  points: number;
};

export type ParameterSweepRow = {
  angleDegrees: number;
  angleRadians: number;
  pOne: number;
  zExpectation: number;
};

export type ParameterSweepResult = {
  circuit: ParsedBuilderCircuit;
  stepId: string;
  gate: BuilderStep["gate"];
  originalAngle: string;
  measuredQubit: number;
  startDegrees: number;
  endDegrees: number;
  rows: ParameterSweepRow[];
};

/** Refuse circuits the statevector kernel would misrepresent or overrun. */
export function sweepCircuitIssue(circuit: ParsedBuilderCircuit): SweepCircuitIssue | null {
  if (!Number.isInteger(circuit.qubitCount) || circuit.qubitCount < 1) return "invalid";
  if (circuit.qubitCount > SWEEP_MAX_QUBITS) return "width";
  if (circuit.steps.length > SWEEP_MAX_OPERATIONS) return "operations";
  let measured = false;
  for (const step of circuit.steps) {
    if (step.gate === "CUSTOM") return "custom";
    if (!BUILDER_GATES.includes(step.gate)) return "invalid";
    if (step.qubits.length !== builderGateArity(step.gate)
      || new Set(step.qubits).size !== step.qubits.length
      || step.qubits.some((qubit) => !Number.isInteger(qubit) || qubit < 0 || qubit >= circuit.qubitCount)) return "invalid";
    if (step.gate === "M") measured = true;
    else if (measured) return "measurement";
    if (ANGLE_GATES.includes(step.gate) && parseGateAngle(step.param) === null) return "angle";
  }
  return null;
}

export function sweepAngleSteps(circuit: ParsedBuilderCircuit): BuilderStep[] {
  return circuit.steps.filter((step) => step.gate !== "CUSTOM" && ANGLE_GATES.includes(step.gate));
}

/** Exact ideal probabilities for one marginal, with no shots, noise, or hardware. */
export function runParameterSweep(request: ParameterSweepRequest): ParameterSweepResult {
  const { circuit, stepId, measuredQubit, startDegrees, endDegrees, points } = request;
  const issue = sweepCircuitIssue(circuit);
  if (issue) throw new Error(`Parameter sweep cannot use this circuit: ${issue}.`);
  const step = sweepAngleSteps(circuit).find((item) => item.id === stepId);
  if (!step || !step.param) throw new Error("Select an angle gate in the current circuit.");
  if (!Number.isInteger(measuredQubit) || measuredQubit < 0 || measuredQubit >= circuit.qubitCount) {
    throw new Error("Select a qubit in the current circuit.");
  }
  if (!Number.isFinite(startDegrees) || !Number.isFinite(endDegrees)
    || Math.abs(startDegrees) > 3600 || Math.abs(endDegrees) > 3600 || startDegrees >= endDegrees) {
    throw new Error("Use a finite angle range from -3600° to 3600°, with the end after the start.");
  }
  if (!Number.isInteger(points) || points < SWEEP_MIN_POINTS || points > SWEEP_MAX_POINTS) {
    throw new Error(`Use ${SWEEP_MIN_POINTS}–${SWEEP_MAX_POINTS} sweep points.`);
  }
  if (2 ** circuit.qubitCount * Math.max(circuit.steps.length, 1) * points > SWEEP_MAX_WORK) {
    throw new Error("This sweep is too large. Use fewer points or a shorter circuit.");
  }

  const rows: ParameterSweepRow[] = [];
  for (let index = 0; index < points; index += 1) {
    const angleDegrees = startDegrees + (endDegrees - startDegrees) * index / (points - 1);
    const angleRadians = angleDegrees * Math.PI / 180;
    const steps = circuit.steps.map((item) => item.id === stepId ? { ...item, param: String(angleRadians) } : item);
    const probabilities = idealProbabilities({ qubitCount: circuit.qubitCount, steps });
    let pOne = 0;
    for (let basis = 0; basis < probabilities.length; basis += 1) {
      if ((basis & (1 << measuredQubit)) !== 0) pOne += probabilities[basis];
    }
    pOne = Math.max(0, Math.min(1, pOne));
    const z = 1 - 2 * pOne;
    rows.push({ angleDegrees, angleRadians, pOne, zExpectation: Math.abs(z) < 1e-12 ? 0 : z });
  }
  return {
    circuit: { qubitCount: circuit.qubitCount, steps: circuit.steps.map((item) => ({ ...item, qubits: [...item.qubits] })) },
    stepId,
    gate: step.gate,
    originalAngle: step.param,
    measuredQubit,
    startDegrees,
    endDegrees,
    rows,
  };
}

export function parameterSweepCsv(result: ParameterSweepResult, sourceFingerprint: string): string {
  const header = "source_fingerprint,step_id,gate,original_angle,measured_qubit,angle_degrees,angle_radians,p_one,z_expectation";
  const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [header, ...result.rows.map((row) => [
    quoted(sourceFingerprint), quoted(result.stepId), result.gate, quoted(result.originalAngle),
    result.measuredQubit, row.angleDegrees, row.angleRadians, row.pOne, row.zExpectation,
  ].join(","))].join("\n") + "\n";
}
