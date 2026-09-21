/**
 * Targeted synthesis (proposal 3): pick a device or a generic connectivity
 * and an objective, run EVERY compiler in the existing trusted compiler lane
 * against it, and show every candidate — including one that failed or
 * cannot represent the target — each carrying an independent equivalence
 * verdict from the verification package rather than the compiler's own
 * claim. A second entry point into the same lane
 * `studio-external-compression.ts` calls; `circuitOperationsFromSteps` is
 * shared so the two cannot validate a circuit differently.
 */
import type { components } from "@majorana/contracts-gen";
import { SYNTHESIS_CONNECTIVITY_VALUES, SYNTHESIS_OBJECTIVE_VALUES } from "@majorana/contracts-gen/enums";
import { createBuilderStepId, type BuilderStep } from "./studio-builder.ts";
import { circuitOperationsFromSteps, isMetrics, isOperation, record } from "./studio-external-compression.ts";

type Schemas = components["schemas"];
export type SynthesisTarget = Schemas["SynthesisTarget"];
export type SynthesisRequest = Schemas["SynthesisRequest"];
export type SynthesisResult = Schemas["SynthesisResult"];
export type SynthesisCandidate = Schemas["SynthesisCandidate"];
export type SynthesisEquivalence = Schemas["SynthesisEquivalence"];
export type SynthesisConnectivity = Schemas["SynthesisConnectivity"];
export type SynthesisObjective = Schemas["SynthesisObjective"];
export type SynthesisCompiler = Schemas["CircuitCompiler"];

export const SYNTHESIS_CONNECTIVITIES = SYNTHESIS_CONNECTIVITY_VALUES;
export const SYNTHESIS_OBJECTIVES = SYNTHESIS_OBJECTIVE_VALUES;

export function synthesisRequest(
  qubitCount: number,
  steps: BuilderStep[],
  target: SynthesisTarget,
  objective: SynthesisObjective,
): SynthesisRequest {
  return {
    qubit_count: qubitCount,
    operations: circuitOperationsFromSteps(qubitCount, steps),
    target,
    objective,
  };
}

/** The metric `objective` ranks candidates by, read off one side (`before`
 * or `after`) of a candidate's resource metrics. `null` when the compiler
 * did not report it (only possible for `t_count` on a wire payload from
 * before it existed — every current path fills it). */
export function objectiveMetric(
  metrics: Schemas["ResourceMetrics"] | null | undefined,
  objective: SynthesisObjective,
): number | null {
  if (!metrics) return null;
  if (objective === "depth") return metrics.depth ?? null;
  if (objective === "two_qubit_count") return metrics.two_qubit_gate_count ?? null;
  return metrics.t_count ?? null;
}

/** A candidate whose result a reader may safely apply: it compiled, and the
 * verification package independently confirmed it is the same circuit.
 * Never true for an unchecked ("too wide") or a failed-equivalence result —
 * "the check is not decoration" applies exactly here. */
export function isApplicable(candidate: SynthesisCandidate): boolean {
  return candidate.status === "succeeded"
    && candidate.equivalence !== null
    && candidate.equivalence.checked
    && candidate.equivalence.equivalent === true;
}

export function builderStepsFromSynthesisCandidate(candidate: SynthesisCandidate): BuilderStep[] {
  return (candidate.operations ?? []).map((operation) => ({
    id: createBuilderStepId("synthesized"),
    gate: operation.gate,
    qubits: operation.qubits,
    ...(operation.angle_radians === null
      ? {}
      : { param: String(Number(operation.angle_radians.toPrecision(12))) }),
  }));
}

export function synthesisResultEventFromEvent(value: unknown): {
  accepted: boolean;
  reason: string | null;
  result: SynthesisResult | null;
} | null {
  if (!record(value) || value.type !== "synthesis.result") return null;
  if (typeof value.accepted !== "boolean") return null;
  if (value.reason !== null && typeof value.reason !== "string") return null;
  const reason = (value.reason ?? null) as string | null;
  if (!value.accepted) return { accepted: false, reason, result: null };
  if (!isSynthesisResult(value.result)) return null;
  return { accepted: true, reason, result: value.result };
}

function isSynthesisResult(value: unknown): value is SynthesisResult {
  if (!record(value)) return false;
  if (!Number.isInteger(value.qubit_count)) return false;
  if (!isTarget(value.target)) return false;
  if (!(SYNTHESIS_CONNECTIVITY_VALUES as readonly string[]).includes(value.resolved_connectivity as string)) {
    return false;
  }
  if (typeof value.resolved_note !== "string") return false;
  if (!(SYNTHESIS_OBJECTIVE_VALUES as readonly string[]).includes(value.objective as string)) return false;
  if (typeof value.input_fingerprint !== "string") return false;
  if (!Array.isArray(value.candidates) || !value.candidates.every(isCandidate)) return false;
  if (value.best_candidate_compiler !== null && typeof value.best_candidate_compiler !== "string") return false;
  return true;
}

function isTarget(value: unknown): value is SynthesisTarget {
  if (!record(value)) return false;
  if (value.device_id !== null && typeof value.device_id !== "string") return false;
  if (
    value.connectivity !== null
    && !(SYNTHESIS_CONNECTIVITY_VALUES as readonly string[]).includes(value.connectivity as string)
  ) {
    return false;
  }
  return (value.device_id === null) !== (value.connectivity === null);
}

function isCandidate(value: unknown): value is SynthesisCandidate {
  if (!record(value)) return false;
  if (typeof value.compiler !== "string") return false;
  if (!["unsupported", "failed", "succeeded"].includes(value.status as string)) return false;
  if (value.status !== "succeeded") {
    return typeof value.reason === "string" && value.reason.length > 0;
  }
  return (
    typeof value.compiler_version === "string"
    && Array.isArray(value.operations)
    && value.operations.every(isOperation)
    && isMetrics(value.before)
    && isMetrics(value.after)
    && isEquivalence(value.equivalence)
  );
}

function isEquivalence(value: unknown): value is SynthesisEquivalence {
  if (!record(value)) return false;
  if (typeof value.checked !== "boolean") return false;
  if (value.checked && typeof value.equivalent !== "boolean") return false;
  if (!value.checked && value.equivalent !== null) return false;
  if (typeof value.detail !== "string") return false;
  return Number.isInteger(value.width_limit);
}
