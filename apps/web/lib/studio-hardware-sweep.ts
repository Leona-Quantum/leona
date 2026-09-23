import { generateBuilderCode } from "./studio-builder.ts";
import { sweepAngleSteps, sweepCircuitIssue, type SweepCircuitIssue } from "./studio-parameter-sweep.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";

/**
 * A Studio parameter sweep submitted to hardware as ONE job (ai-ops 349): every
 * point its own PUB, batched the way `packages/py/qpu/src/majorana_qpu/models.py`
 * (`SWEEP_MIN_BINDINGS`/`SWEEP_MAX_BINDINGS`) and `db/migrations/versions/0075_qpu_run_sweep.py`
 * document server-side. Mirrored here rather than imported (no shared package
 * crosses the Python/TypeScript boundary for this): the server is the real
 * enforcement — a request outside these bounds is refused with 422 regardless
 * of what this file lets a person click — so a drift here costs a worse error
 * message, never a bypass.
 */
export const HARDWARE_SWEEP_MIN_BINDINGS = 2;
export const HARDWARE_SWEEP_MAX_BINDINGS = 20;

export type HardwareSweepBinding = {
  label: string;
  qasm: string;
  angleDegrees: number;
  angleRadians: number;
};

export type HardwareSweepBuildIssue = SweepCircuitIssue | "points";

/**
 * The same points a local ideal sweep would run (`runParameterSweep`), each
 * rendered to real OpenQASM 3 through `generateBuilderCode` — the emitter
 * Studio's own "view as OpenQASM 3" tab already uses for the circuit on
 * screen, reused here rather than a second serializer written for this
 * feature. `customGates` is always `[]`: `sweepCircuitIssue` already refuses
 * a circuit containing one, so a sweep-eligible circuit has none active.
 */
export function buildHardwareSweepBindings(request: {
  circuit: ParsedBuilderCircuit;
  stepId: string;
  startDegrees: number;
  endDegrees: number;
  points: number;
}): HardwareSweepBinding[] | HardwareSweepBuildIssue {
  const { circuit, stepId, startDegrees, endDegrees, points } = request;
  const issue = sweepCircuitIssue(circuit);
  if (issue) return issue;
  const step = sweepAngleSteps(circuit).find((item) => item.id === stepId);
  if (!step) return "invalid";
  if (
    !Number.isInteger(points)
    || points < HARDWARE_SWEEP_MIN_BINDINGS
    || points > HARDWARE_SWEEP_MAX_BINDINGS
  ) {
    return "points";
  }
  const bindings: HardwareSweepBinding[] = [];
  for (let index = 0; index < points; index += 1) {
    const angleDegrees = startDegrees + (endDegrees - startDegrees) * index / (points - 1);
    const angleRadians = angleDegrees * Math.PI / 180;
    const steps = circuit.steps.map((item) => item.id === stepId ? { ...item, param: String(angleRadians) } : item);
    const { openqasm3 } = generateBuilderCode(steps, circuit.qubitCount, []);
    bindings.push({
      label: `${angleDegrees.toFixed(2)}°`,
      qasm: openqasm3,
      angleDegrees,
      angleRadians,
    });
  }
  return bindings;
}
