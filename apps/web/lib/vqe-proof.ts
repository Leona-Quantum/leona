export type VqeFramework = "qiskit" | "pennylane";
export type VqeCapability =
  | "h2_sto3g_actual_vqe_v1"
  | "h2_sto3g_uccsd_v1"
  | "h2_sto3g_hardware_efficient_ry_cx_v1";

export type VqeResourceObservation = {
  stage: string;
  two_qubit_gate_count?: number | null;
  depth?: number | null;
  gate_count?: number | null;
  parameter_count?: number | null;
};

export type VqeSuccessResult = {
  status: "succeeded";
  framework: VqeFramework;
  best_energy_ha: number;
  exact_energy_ha: number;
  absolute_error_ha: number;
  final_state_fidelity: number;
  iterations: number;
  resources: VqeResourceObservation[];
};

export type VqeObservation = {
  id: string;
  attempt: number;
  status: string;
  result_contract_json: Record<string, unknown>;
  failure_code: string | null;
};

export type VqeExecution = {
  id: string;
  experiment_id: string;
  run_id: string | null;
  framework: VqeFramework;
  runtime_profile_id: string;
  runtime_image_digest: string;
  status: "planned" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  production_runtime_status: "unqualified" | "qualified";
  public_execution: "blocked";
  review_state: "owner_waived";
  observations: VqeObservation[];
};

const FRAMEWORKS = new Set(["qiskit", "pennylane"]);
const STATUSES = new Set(["planned", "queued", "running", "succeeded", "failed", "cancelled"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function capabilityFromExperiment(value: unknown): VqeCapability {
  const experiment = record(value);
  const scientificSpec = record(experiment?.scientific_spec_json);
  const bindings = scientificSpec?.component_bindings;
  if (!Array.isArray(bindings)) {
    throw new Error("VQE experiment has no frozen component identity");
  }
  const ansatzBindings = bindings.flatMap((candidate) => {
    const item = record(candidate);
    return item?.role === "ansatz" && item.applicability !== "not_applicable"
      ? [item]
      : [];
  });
  if (ansatzBindings.length !== 1) {
    throw new Error("VQE experiment has an ambiguous ansatz identity");
  }
  const semanticKey = ansatzBindings[0]?.component_semantic_key;
  if (semanticKey === "ansatz.uccsd.v1") return "h2_sto3g_uccsd_v1";
  if (semanticKey === "ansatz.hardware_efficient_ry_cx.v1") {
    return "h2_sto3g_hardware_efficient_ry_cx_v1";
  }
  if (semanticKey === "ansatz.h2.fixed_excitation.v1") {
    return "h2_sto3g_actual_vqe_v1";
  }
  throw new Error("VQE experiment ansatz is not executable by this private runtime");
}

export function parseVqeExecutions(value: unknown): VqeExecution[] {
  if (!Array.isArray(value)) throw new Error("VQE execution payload is not a list");
  return value.map((candidate) => {
    const item = record(candidate);
    if (
      !item
      || typeof item.id !== "string"
      || typeof item.experiment_id !== "string"
      || (item.run_id !== null && typeof item.run_id !== "string")
      || typeof item.runtime_profile_id !== "string"
      || typeof item.runtime_image_digest !== "string"
      || typeof item.framework !== "string"
      || !FRAMEWORKS.has(item.framework)
      || typeof item.status !== "string"
      || !STATUSES.has(item.status)
      || !["unqualified", "qualified"].includes(String(item.production_runtime_status))
      || item.public_execution !== "blocked"
      || item.review_state !== "owner_waived"
      || !Array.isArray(item.observations)
    ) {
      throw new Error("VQE execution payload violates the candidate contract");
    }
    const observations = item.observations.map((candidateObservation) => {
      const observation = record(candidateObservation);
      if (
        !observation
        || typeof observation.id !== "string"
        || !finite(observation.attempt)
        || typeof observation.status !== "string"
        || (observation.failure_code !== null && typeof observation.failure_code !== "string")
        || !record(observation.result_contract_json)
      ) {
        throw new Error("VQE observation payload violates the candidate contract");
      }
      return observation as unknown as VqeObservation;
    });
    return { ...item, observations } as unknown as VqeExecution;
  });
}

export function latestSuccess(execution: VqeExecution): VqeSuccessResult | null {
  const observation = [...execution.observations]
    .reverse()
    .find((item) => item.status === "succeeded");
  const result = record(observation?.result_contract_json);
  if (
    !result
    || result.status !== "succeeded"
    || result.framework !== execution.framework
    || !finite(result.best_energy_ha)
    || !finite(result.exact_energy_ha)
    || !finite(result.absolute_error_ha)
    || !finite(result.final_state_fidelity)
    || !finite(result.iterations)
    || !Array.isArray(result.resources)
  ) {
    return null;
  }
  return result as unknown as VqeSuccessResult;
}

export function comparableResources(result: VqeSuccessResult): VqeResourceObservation | null {
  return result.resources.find((item) => item.stage === "common_basis_compiled") ?? null;
}
