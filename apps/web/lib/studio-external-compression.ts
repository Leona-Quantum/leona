import type { components } from "@majorana/contracts-gen";
import { CIRCUIT_COMPILER_VALUES } from "@majorana/contracts-gen/enums";
import { createBuilderStepId, type BuilderStep } from "./studio-builder.ts";

type Schemas = components["schemas"];
export type ExternalCircuitCompiler = Schemas["CircuitCompiler"];
export type CircuitOptimizationRequest = Schemas["CircuitOptimizationRequest"];
export type CircuitOptimizationResult = Schemas["CircuitOptimizationResult"];

export const EXTERNAL_CIRCUIT_COMPILERS = CIRCUIT_COMPILER_VALUES;
export const EXTERNAL_COMPILER_MAX_QUBITS = 64;
export const EXTERNAL_COMPILER_MAX_OPERATIONS = 1024;

export class ExternalCompressionInputError extends Error {
  readonly code: "empty" | "custom_gate" | "angle" | "budget";

  constructor(code: "empty" | "custom_gate" | "angle" | "budget", message: string) {
    super(message);
    this.code = code;
  }
}

export function circuitOptimizationRequest(
  compiler: ExternalCircuitCompiler,
  qubitCount: number,
  steps: BuilderStep[],
  optimizationLevel: number = 2,
): CircuitOptimizationRequest {
  if (!steps.length) throw new ExternalCompressionInputError("empty", "The circuit is empty.");
  if (qubitCount > EXTERNAL_COMPILER_MAX_QUBITS || steps.length > EXTERNAL_COMPILER_MAX_OPERATIONS) {
    throw new ExternalCompressionInputError(
      "budget",
      `External compilation is limited to ${EXTERNAL_COMPILER_MAX_QUBITS} qubits and ${EXTERNAL_COMPILER_MAX_OPERATIONS} operations.`,
    );
  }
  return {
    compiler,
    qubit_count: qubitCount,
    optimization_level: optimizationLevel,
    operations: steps.map((step) => {
      if (step.gate === "CUSTOM") {
        throw new ExternalCompressionInputError(
          "custom_gate",
          "External compilers cannot accept Studio custom gates until they are expanded.",
        );
      }
      const rotation = step.gate === "RX" || step.gate === "RY" || step.gate === "RZ";
      const angle = rotation ? angleRadians(step.param) : null;
      if (rotation && angle === null) {
        throw new ExternalCompressionInputError(
          "angle",
          `External compilers require a bound numeric angle for ${step.gate}.`,
        );
      }
      return { gate: step.gate, qubits: step.qubits, angle_radians: angle };
    }),
  };
}

export function externalOptimizationResultFromEvent(value: unknown): CircuitOptimizationResult | null {
  if (!record(value) || value.type !== "compilation.result" || value.accepted !== true) return null;
  if (!record(value.compatibility)) return null;
  const result = value.compatibility.circuit_optimization;
  if (!record(result)) return null;
  if (!isCompiler(result.compiler) || typeof result.compiler_version !== "string") return null;
  if (!Number.isInteger(result.optimization_level)) return null;
  if (!Array.isArray(result.operations) || !result.operations.every(isOperation)) return null;
  if (!isMetrics(result.before) || !isMetrics(result.after)) return null;
  if (typeof result.input_fingerprint !== "string" || typeof result.output_fingerprint !== "string") return null;
  if (result.equivalence !== "unitary_up_to_global_phase") return null;
  if (!Array.isArray(result.warnings) || !result.warnings.every((warning) => typeof warning === "string")) return null;
  return result as unknown as CircuitOptimizationResult;
}

export function builderStepsFromExternalResult(result: CircuitOptimizationResult): BuilderStep[] {
  return (result.operations ?? []).map((operation) => ({
    id: createBuilderStepId("compiled"),
    gate: operation.gate,
    qubits: operation.qubits,
    ...(operation.angle_radians === null
      ? {}
      : { param: String(Number(operation.angle_radians.toPrecision(12))) }),
  }));
}

export function angleRadians(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().replaceAll(/\s+/g, "").toLowerCase();
  if (!value.includes("pi")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const match = /^(-?)(?:(\d+(?:\.\d+)?)\*)?pi(?:\/(\d+(?:\.\d+)?))?$/.exec(value);
  if (!match) return null;
  const denominator = match[3] ? Number(match[3]) : 1;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const coefficient = match[2] ? Number(match[2]) : 1;
  const sign = match[1] === "-" ? -1 : 1;
  const angle = sign * coefficient * Math.PI / denominator;
  return Number.isFinite(angle) ? angle : null;
}

function isCompiler(value: unknown): value is ExternalCircuitCompiler {
  return typeof value === "string" && (EXTERNAL_CIRCUIT_COMPILERS as readonly string[]).includes(value);
}

function isOperation(value: unknown): boolean {
  return record(value)
    && typeof value.gate === "string"
    && Array.isArray(value.qubits)
    && value.qubits.every((qubit) => Number.isInteger(qubit) && qubit >= 0)
    && (value.angle_radians === null || (typeof value.angle_radians === "number" && Number.isFinite(value.angle_radians)));
}

function isMetrics(value: unknown): boolean {
  return record(value)
    && Number.isInteger(value.qubits)
    && nullableNonNegativeInteger(value.depth)
    && nullableNonNegativeInteger(value.gate_count)
    && nullableNonNegativeInteger(value.two_qubit_gate_count)
    && nullableNonNegativeInteger(value.measurement_count);
}

function nullableNonNegativeInteger(value: unknown): boolean {
  return value === null || (Number.isInteger(value) && (value as number) >= 0);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
