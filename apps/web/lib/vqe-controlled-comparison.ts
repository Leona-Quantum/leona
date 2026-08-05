import { parseVqeExecutions, type VqeExecution, type VqeFramework } from "./vqe-proof.ts";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRAMEWORKS = new Set<VqeFramework>(["qiskit", "pennylane"]);
const OPTIMIZER_ALGORITHMS = new Map([
  ["optimizer.slsqp.v1", "scipy_slsqp"],
  ["optimizer.cobyla.v1", "scipy_cobyla"],
]);

type ComponentBinding = {
  role: string;
  component_semantic_key: string;
  component_spec_sha256: string;
};

export type ComparisonExperiment = {
  id: string;
  workflow_artifact_version_id: string;
  component_bindings: ComponentBinding[];
};

export type ControlledComparisonRequest = {
  baseline_workflow_artifact_version_id: string;
  candidate_workflow_artifact_version_id: string;
  changed_role: "parameter_optimizer";
  fixed_component_digests: Record<string, string>;
  baseline_configuration: { algorithm: string };
  candidate_configuration: { algorithm: string };
  metric_protocol_sha256: string;
  budget_protocol_sha256: string;
};

export type ControlledComparisonRun = {
  id: string;
  comparison_spec_id: string;
  baseline_execution_id: string;
  candidate_execution_id: string;
  status: "comparable" | "comparability_failed" | "inconclusive" | "failed";
  invariant_audit: Record<string, boolean>;
  metric_observations: ComparisonMetricObservations;
  terminal_reason: string | null;
  run_sha256: string;
};

export type ControlledComparison = {
  id: string;
  baseline_workflow_artifact_version_id: string;
  candidate_workflow_artifact_version_id: string;
  changed_role: "parameter_optimizer";
  baseline_algorithm: "scipy_slsqp";
  candidate_algorithm: "scipy_cobyla";
  scientific_review: "owner_waived";
  publication: "blocked";
  visibility: "private";
  runs: ControlledComparisonRun[];
};

export type ComparisonOptimizerWork = {
  iterations: number;
  energy_evaluations: number;
  gradient_evaluations: number;
  hessian_evaluations: number;
};

export type ComparisonMetricSummary = {
  execution_id: string;
  result_contract_sha256: string;
  optimization: {
    best_energy_ha: number;
    absolute_error_ha: number;
    converged: boolean;
    iterations: number;
    optimizer_work: ComparisonOptimizerWork;
    final_state_fidelity: number;
    trajectory_sha256: string;
  };
  resources: Record<string, Record<string, unknown>>;
  wall_time_s: number | null;
};

export type ComparisonMetricObservations = {
  framework: VqeFramework;
  baseline: ComparisonMetricSummary;
  candidate: ComparisonMetricSummary;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function parseOptimizerWork(value: unknown): ComparisonOptimizerWork {
  const work = record(value);
  if (
    !work
    || !nonNegativeInteger(work.iterations)
    || !nonNegativeInteger(work.energy_evaluations)
    || !nonNegativeInteger(work.gradient_evaluations)
    || !nonNegativeInteger(work.hessian_evaluations)
  ) {
    throw new Error("Controlled comparison optimizer work violates the evidence contract");
  }
  return work as ComparisonOptimizerWork;
}

function parseComparableResources(
  value: unknown,
  expectedMetricProtocolSha256: string,
): Record<string, Record<string, unknown>> {
  const resources = record(value);
  if (!resources) {
    throw new Error("Controlled comparison resources violate the evidence contract");
  }
  for (const requiredStage of ["canonical_logical", "common_basis_compiled"]) {
    const resource = record(resources[requiredStage]);
    if (
      !resource
      || resource.stage !== requiredStage
      || resource.metric_protocol_sha256 !== expectedMetricProtocolSha256
      || !nonNegativeInteger(resource.qubits)
      || !nonNegativeInteger(resource.parameter_count)
    ) {
      throw new Error("Controlled comparison resources violate the evidence contract");
    }
    for (const metric of ["depth", "gate_count", "two_qubit_gate_count"] as const) {
      if (resource[metric] !== null && !nonNegativeInteger(resource[metric])) {
        throw new Error("Controlled comparison resources violate the evidence contract");
      }
    }
  }
  return resources as Record<string, Record<string, unknown>>;
}

function parseMetricSummary(
  value: unknown,
  expectedExecutionId: string,
  expectedMetricProtocolSha256: string,
): ComparisonMetricSummary {
  const summary = record(value);
  const optimization = record(summary?.optimization);
  const optimizerWork = parseOptimizerWork(optimization?.optimizer_work);
  const finalParameters = optimization?.final_parameters;
  if (
    !summary
    || summary.execution_id !== expectedExecutionId
    || typeof summary.result_contract_sha256 !== "string"
    || !SHA256.test(summary.result_contract_sha256)
    || !optimization
    || !finite(optimization.best_energy_ha)
    || !finite(optimization.absolute_error_ha)
    || optimization.absolute_error_ha < 0
    || typeof optimization.converged !== "boolean"
    || !nonNegativeInteger(optimization.iterations)
    || optimization.iterations !== optimizerWork.iterations
    || !Array.isArray(finalParameters)
    || finalParameters.length === 0
    || finalParameters.some((candidate) => {
      const parameter = record(candidate);
      return !parameter
        || typeof parameter.slot_id !== "string"
        || parameter.slot_id.length === 0
        || typeof parameter.float64_hex !== "string"
        || parameter.float64_hex.length === 0;
    })
    || !finite(optimization.final_state_fidelity)
    || optimization.final_state_fidelity < 0
    || optimization.final_state_fidelity > 1
    || typeof optimization.trajectory_sha256 !== "string"
    || !SHA256.test(optimization.trajectory_sha256)
    || (summary.wall_time_s !== null
      && (!finite(summary.wall_time_s) || summary.wall_time_s < 0))
  ) {
    throw new Error("Controlled comparison metrics violate the evidence contract");
  }
  return {
    execution_id: summary.execution_id,
    result_contract_sha256: summary.result_contract_sha256,
    optimization: {
      best_energy_ha: optimization.best_energy_ha,
      absolute_error_ha: optimization.absolute_error_ha,
      converged: optimization.converged,
      iterations: optimization.iterations,
      optimizer_work: optimizerWork,
      final_state_fidelity: optimization.final_state_fidelity,
      trajectory_sha256: optimization.trajectory_sha256,
    },
    resources: parseComparableResources(summary.resources, expectedMetricProtocolSha256),
    wall_time_s: summary.wall_time_s,
  };
}

function parseMetricObservations(
  value: unknown,
  baselineExecutionId: string,
  candidateExecutionId: string,
  expectedMetricProtocolSha256: string,
): ComparisonMetricObservations {
  const observations = record(value);
  if (
    !observations
    || typeof observations.framework !== "string"
    || !FRAMEWORKS.has(observations.framework as VqeFramework)
  ) {
    throw new Error("Controlled comparison observations violate the evidence contract");
  }
  return {
    framework: observations.framework as VqeFramework,
    baseline: parseMetricSummary(
      observations.baseline,
      baselineExecutionId,
      expectedMetricProtocolSha256,
    ),
    candidate: parseMetricSummary(
      observations.candidate,
      candidateExecutionId,
      expectedMetricProtocolSha256,
    ),
  };
}

export function parseComparisonExperiment(value: unknown): ComparisonExperiment {
  const experiment = record(value);
  const scientificSpec = record(experiment?.scientific_spec_json);
  const bindings = scientificSpec?.component_bindings;
  if (
    !experiment
    || typeof experiment.id !== "string"
    || !UUID.test(experiment.id)
    || typeof experiment.workflow_artifact_version_id !== "string"
    || !UUID.test(experiment.workflow_artifact_version_id)
    || !Array.isArray(bindings)
  ) {
    throw new Error("VQE experiment identity cannot support a controlled comparison");
  }
  const parsed = bindings.flatMap((candidate) => {
    const binding = record(candidate);
    if (binding?.applicability === "not_applicable") return [];
    if (
      !binding
      || typeof binding.role !== "string"
      || typeof binding.component_semantic_key !== "string"
      || typeof binding.component_spec_sha256 !== "string"
      || !SHA256.test(binding.component_spec_sha256)
    ) {
      throw new Error("VQE component binding violates the comparison contract");
    }
    return [{
      role: binding.role,
      component_semantic_key: binding.component_semantic_key,
      component_spec_sha256: binding.component_spec_sha256,
    }];
  });
  if (new Set(parsed.map((binding) => binding.role)).size !== parsed.length) {
    throw new Error("VQE comparison contains duplicate component roles");
  }
  return {
    id: experiment.id,
    workflow_artifact_version_id: experiment.workflow_artifact_version_id,
    component_bindings: parsed,
  };
}

export function optimizerSemanticKey(experiment: ComparisonExperiment): string | null {
  return experiment.component_bindings.find(
    (binding) => binding.role === "parameter_optimizer",
  )?.component_semantic_key ?? null;
}

export function resolveOptimizerSwapRootWorkflowId(
  value: unknown,
  workflowArtifactVersionId: string,
): string | null {
  const payload = record(value);
  const components = payload?.components;
  if (!Array.isArray(components)) return null;
  const workflow = components
    .map(record)
    .find((candidate) => candidate?.artifact_version_id === workflowArtifactVersionId);
  const spec = record(workflow?.spec_json);
  const baselineId = spec?.baseline_workflow_artifact_version_id;
  return spec?.kind === "component_swap_workflow_draft"
    && typeof baselineId === "string"
    && UUID.test(baselineId)
    ? baselineId
    : null;
}

function byRole(experiment: ComparisonExperiment): Map<string, ComponentBinding> {
  return new Map(experiment.component_bindings.map((binding) => [binding.role, binding]));
}

export function buildControlledComparisonRequest(
  baseline: ComparisonExperiment,
  candidate: ComparisonExperiment,
): ControlledComparisonRequest {
  const baselineByRole = byRole(baseline);
  const candidateByRole = byRole(candidate);
  if (
    baseline.workflow_artifact_version_id === candidate.workflow_artifact_version_id
    || baselineByRole.size !== candidateByRole.size
    || [...baselineByRole].some(([role]) => !candidateByRole.has(role))
  ) {
    throw new Error("Controlled comparison requires distinct workflows with identical role sets");
  }
  const changedRoles = [...baselineByRole].flatMap(([role, binding]) => {
    const other = candidateByRole.get(role);
    return other?.component_spec_sha256 === binding.component_spec_sha256 ? [] : [role];
  });
  if (changedRoles.length !== 1 || changedRoles[0] !== "parameter_optimizer") {
    throw new Error("Controlled comparison must change exactly parameter_optimizer");
  }
  const baselineOptimizer = baselineByRole.get("parameter_optimizer");
  const candidateOptimizer = candidateByRole.get("parameter_optimizer");
  const baselineAlgorithm = baselineOptimizer
    ? OPTIMIZER_ALGORITHMS.get(baselineOptimizer.component_semantic_key)
    : undefined;
  const candidateAlgorithm = candidateOptimizer
    ? OPTIMIZER_ALGORITHMS.get(candidateOptimizer.component_semantic_key)
    : undefined;
  if (baselineAlgorithm !== "scipy_slsqp" || candidateAlgorithm !== "scipy_cobyla") {
    throw new Error("Private MVP comparison is restricted to SLSQP → COBYLA");
  }
  const fixedComponentDigests = Object.fromEntries(
    [...baselineByRole]
      .filter(([role]) => role !== "parameter_optimizer")
      .map(([role, binding]) => [role, binding.component_spec_sha256]),
  );
  const metricProtocol = fixedComponentDigests.evaluation_protocol;
  const budgetProtocol = fixedComponentDigests.stopping_protocol;
  if (!metricProtocol || !budgetProtocol) {
    throw new Error("Controlled comparison lacks fixed evaluation or stopping protocol identity");
  }
  return {
    baseline_workflow_artifact_version_id: baseline.workflow_artifact_version_id,
    candidate_workflow_artifact_version_id: candidate.workflow_artifact_version_id,
    changed_role: "parameter_optimizer",
    fixed_component_digests: fixedComponentDigests,
    baseline_configuration: { algorithm: baselineAlgorithm },
    candidate_configuration: { algorithm: candidateAlgorithm },
    metric_protocol_sha256: metricProtocol,
    budget_protocol_sha256: budgetProtocol,
  };
}

export function succeededExecution(
  value: unknown,
  framework: VqeFramework,
): VqeExecution {
  const execution = [...parseVqeExecutions(value)]
    .reverse()
    .find((candidate) => candidate.framework === framework && candidate.status === "succeeded");
  if (!execution) {
    throw new Error(`A succeeded ${framework} execution is required on both sides`);
  }
  return execution;
}

export function parseControlledComparison(value: unknown): ControlledComparison {
  const comparison = record(value);
  const spec = record(comparison?.spec_json);
  const baselineConfiguration = record(spec?.baseline_configuration);
  const candidateConfiguration = record(spec?.candidate_configuration);
  const fixedComponentDigests = record(spec?.fixed_component_digests);
  if (
    !comparison
    || typeof comparison.id !== "string"
    || !UUID.test(comparison.id)
    || typeof comparison.workspace_id !== "string"
    || !UUID.test(comparison.workspace_id)
    || typeof comparison.baseline_workflow_artifact_version_id !== "string"
    || !UUID.test(comparison.baseline_workflow_artifact_version_id)
    || typeof comparison.candidate_workflow_artifact_version_id !== "string"
    || !UUID.test(comparison.candidate_workflow_artifact_version_id)
    || comparison.changed_role !== "parameter_optimizer"
    || comparison.scientific_review !== "owner_waived"
    || comparison.publication !== "blocked"
    || comparison.visibility !== "private"
    || typeof comparison.spec_sha256 !== "string"
    || !SHA256.test(comparison.spec_sha256)
    || !spec
    || spec.changed_role !== "parameter_optimizer"
    || spec.baseline_workflow_artifact_version_id
      !== comparison.baseline_workflow_artifact_version_id
    || spec.candidate_workflow_artifact_version_id
      !== comparison.candidate_workflow_artifact_version_id
    || baselineConfiguration?.algorithm !== "scipy_slsqp"
    || candidateConfiguration?.algorithm !== "scipy_cobyla"
    || !fixedComponentDigests
    || Object.keys(fixedComponentDigests).length === 0
    || Object.values(fixedComponentDigests).some(
      (digest) => typeof digest !== "string" || !SHA256.test(digest),
    )
    || typeof spec.metric_protocol_sha256 !== "string"
    || !SHA256.test(spec.metric_protocol_sha256)
    || typeof spec.budget_protocol_sha256 !== "string"
    || !SHA256.test(spec.budget_protocol_sha256)
    || !Array.isArray(comparison.runs)
  ) {
    throw new Error("Controlled comparison response violates the private MVP contract");
  }
  const metricProtocolSha256 = spec.metric_protocol_sha256 as string;
  const runs = comparison.runs.map((candidate) => {
    const run = record(candidate);
    const runJson = record(run?.run_json);
    const audit = record(runJson?.invariant_audit);
    const status = String(run?.status);
    const terminalReason = runJson?.terminal_reason;
    const allInvariantsHold = audit ? Object.values(audit).every(Boolean) : false;
    if (
      !run
      || !runJson
      || typeof run.id !== "string"
      || !UUID.test(run.id)
      || run.comparison_spec_id !== comparison.id
      || typeof run.baseline_execution_id !== "string"
      || !UUID.test(run.baseline_execution_id)
      || typeof run.candidate_execution_id !== "string"
      || !UUID.test(run.candidate_execution_id)
      || run.baseline_execution_id === run.candidate_execution_id
      || typeof run.run_sha256 !== "string"
      || !SHA256.test(run.run_sha256)
      || !["comparable", "comparability_failed", "inconclusive", "failed"].includes(status)
      || !audit
      || Object.keys(audit).length === 0
      || Object.values(audit).some((item) => typeof item !== "boolean")
      || (terminalReason !== null && typeof terminalReason !== "string")
      || (status === "comparable" && (!allInvariantsHold || terminalReason !== null))
      || (status === "comparability_failed"
        && (allInvariantsHold || typeof terminalReason !== "string" || !terminalReason))
    ) {
      throw new Error("Controlled comparison run violates the evidence contract");
    }
    const observations = parseMetricObservations(
      runJson.metric_observations,
      run.baseline_execution_id,
      run.candidate_execution_id,
      metricProtocolSha256,
    );
    return {
      id: run.id,
      comparison_spec_id: run.comparison_spec_id,
      baseline_execution_id: run.baseline_execution_id,
      candidate_execution_id: run.candidate_execution_id,
      status: run.status,
      invariant_audit: audit,
      metric_observations: observations,
      terminal_reason: terminalReason,
      run_sha256: run.run_sha256,
    } as ControlledComparisonRun;
  });
  return {
    id: comparison.id,
    baseline_workflow_artifact_version_id: comparison.baseline_workflow_artifact_version_id,
    candidate_workflow_artifact_version_id: comparison.candidate_workflow_artifact_version_id,
    changed_role: "parameter_optimizer",
    baseline_algorithm: "scipy_slsqp",
    candidate_algorithm: "scipy_cobyla",
    scientific_review: "owner_waived",
    publication: "blocked",
    visibility: "private",
    runs,
  };
}
