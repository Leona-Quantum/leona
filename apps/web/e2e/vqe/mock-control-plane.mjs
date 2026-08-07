import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.MOCK_VQE_API_PORT ?? "18000");
const workflowId = "10000000-0000-4000-8000-000000000001";
const slsqpWorkflowId = "10000000-0000-4000-8000-000000000002";
const uccsdWorkflowId = "10000000-0000-4000-8000-000000000003";
const hardwareEfficientWorkflowId = "10000000-0000-4000-8000-000000000004";
const cobylaWorkflowId = "10000000-0000-4000-8000-000000000005";
const blockedWorkflowId = "10000000-0000-4000-8000-000000000006";
const slsqpDigest = "b".repeat(64);
const cobylaDigest = "c".repeat(64);
let experimentSequence = 0;
let executionSequence = 0;
let comparisonSequence = 0;
let authenticatedRequests = 0;
let unauthorizedRequests = 0;
const experimentsById = new Map();
const executionsByExperiment = new Map();
const comparisonsById = new Map();

const fixedRoles = [
  "problem",
  "problem_preparation",
  "representation",
  "reference_state",
  "ansatz",
  "operator_pool",
  "search_selection",
  "growth_batching",
  "parameter_optimizer",
  "compression",
  "measurement",
  "compilation_backend",
  "evaluation_protocol",
  "stopping_protocol",
];

function componentBindings({
  ansatzKey = "ansatz.h2.fixed_excitation.v1",
  optimizerKey = "optimizer.slsqp.v1",
  optimizerDigest = slsqpDigest,
} = {}) {
  return fixedRoles.map((role, index) => ({
    role,
    applicability:
      ansatzKey !== "ansatz.h2.fixed_excitation.v1"
      && ["operator_pool", "search_selection", "growth_batching"].includes(role)
        ? "not_applicable"
        : "required",
    component_semantic_key: role === "ansatz"
      ? ansatzKey
      : role === "parameter_optimizer"
        ? optimizerKey
        : `${role}.mock.fixed.v1`,
    component_spec_sha256: role === "parameter_optimizer"
      ? optimizerDigest
      : String((index % 9) + 1).repeat(64),
  }));
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

function problem(response, status, title, reasonCode) {
  return json(response, status, {
    type: "about:blank",
    title,
    status,
    code: reasonCode,
    reason_code: reasonCode,
    request_id: "mock-request-id",
    trace_id: "mock-request-id",
  });
}

function workflowSemanticKey(artifactVersionId) {
  return new Map([
    [workflowId, "vqe.workflow.h2_sto3g_actual_vqe_v1"],
    [slsqpWorkflowId, "workflow.instance.mock.slsqp"],
    [cobylaWorkflowId, "workflow.instance.mock.cobyla"],
    [uccsdWorkflowId, "workflow.instance.mock.uccsd"],
    [hardwareEfficientWorkflowId, "workflow.instance.mock.hardware-efficient"],
    [blockedWorkflowId, "workflow.mock.blocked.v1"],
  ]).get(artifactVersionId);
}

function projection(artifactVersionId) {
  const blocked = artifactVersionId === blockedWorkflowId;
  const semanticKey = workflowSemanticKey(artifactVersionId);
  if (!semanticKey) return null;
  const projectionSha256 = createHash("sha256")
    .update(`mock-launch-projection:${artifactVersionId}:${blocked ? "blocked" : "eligible"}`)
    .digest("hex");
  const blocker = {
    reason_code: "vqe_composition_unvalidated",
    field: "composition_state",
    retryable: false,
  };
  return {
    workflow_artifact_version_id: artifactVersionId,
    workflow_semantic_key: semanticKey,
    registry_semantic_key:
      artifactVersionId === workflowId ? "h2.sto3g.actual_vqe.workflow.v0_2" : semanticKey,
    machine_validation_state: blocked ? "unvalidated" : "machine_validated",
    review_state: "unreviewed",
    definition_state: "available",
    composition_state: blocked ? "unvalidated" : "machine_validated",
    execution_policy_state: "owner_waived_private",
    validated_draft_supported: false,
    experiment_creation: {
      decision: blocked ? "blocked" : "eligible",
      launch_mode: blocked ? "blocked" : "direct",
      primary_reason_code: blocked ? blocker.reason_code : null,
      blockers: blocked ? [blocker] : [],
    },
    frameworks: ["qiskit", "pennylane"].map((framework) => ({
      framework,
      runtime_profile_id: `mock-${framework}-runtime-v1`,
      implementation_resolution: "resolved",
      runtime_qualification: "qualified",
      live_readiness: "ready",
      readiness_generation: "90000000-0000-4000-8000-000000000001",
      readiness_expires_at: "2099-01-01T00:00:00Z",
      decision: blocked ? "blocked" : "eligible",
      primary_reason_code: blocked ? blocker.reason_code : null,
      blockers: blocked ? [blocker] : [],
    })),
    projection_sha256: projectionSha256,
    registry_snapshot_sha256: createHash("sha256")
      .update(`mock-registry-snapshot:${artifactVersionId}`)
      .digest("hex"),
    evaluated_at: "2026-01-01T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
  };
}

function visibleWorkflowIds() {
  const ids = [workflowId, blockedWorkflowId];
  if ([...experimentsById.values()].some((item) => item.slsqpSaved)) ids.push(slsqpWorkflowId);
  if ([...experimentsById.values()].some((item) => item.cobylaSaved)) ids.push(cobylaWorkflowId);
  if ([...experimentsById.values()].some((item) => item.uccsdSaved)) ids.push(uccsdWorkflowId);
  if ([...experimentsById.values()].some((item) => item.hardwareEfficientSaved)) {
    ids.push(hardwareEfficientWorkflowId);
  }
  return ids;
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function uuid(prefix, sequence) {
  return `${prefix}0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function observation(executionId, framework, capability) {
  const succeeded = framework === "qiskit";
  const uccsd = capability === "h2_sto3g_uccsd_v1";
  const hardwareEfficient =
    capability === "h2_sto3g_hardware_efficient_ry_cx_v1";
  return {
    id: uuid("3", executionSequence),
    execution_id: executionId,
    attempt: 1,
    status: succeeded ? "succeeded" : "failed",
    result_contract_json: succeeded
      ? {
          status: "succeeded",
          framework,
          best_energy_ha: -1.137306035753,
          exact_energy_ha: -1.137306035753,
          absolute_error_ha: 0,
          final_state_fidelity: 1,
          iterations: 8,
          resources: [
            {
              stage: "common_basis_compiled",
              two_qubit_gate_count: hardwareEfficient ? 6 : uccsd ? 56 : 48,
              depth: hardwareEfficient ? 7 : uccsd ? 96 : 83,
              gate_count: hardwareEfficient ? 14 : uccsd ? 188 : 152,
              parameter_count: hardwareEfficient ? 8 : uccsd ? 3 : 1,
            },
          ],
        }
      : {},
    failure_code: succeeded ? null : "runtime_failure",
  };
}

function comparisonMetricSummary({ executionId, algorithm, metricProtocolSha256 }) {
  const evaluations = algorithm === "scipy_slsqp" ? 13 : 11;
  const resource = (stage) => ({
    stage,
    metric_protocol_sha256: metricProtocolSha256,
    qubits: 4,
    depth: 83,
    gate_count: 152,
    two_qubit_gate_count: 48,
    parameter_count: 1,
  });
  return {
    execution_id: executionId,
    result_contract_sha256: "f".repeat(64),
    optimization: {
      best_energy_ha: -1.137306035753,
      absolute_error_ha: 0,
      converged: true,
      iterations: 8,
      optimizer_work: {
        iterations: 8,
        energy_evaluations: evaluations,
        gradient_evaluations: algorithm === "scipy_slsqp" ? 8 : 0,
        hessian_evaluations: 0,
      },
      final_parameters: [{ slot_id: "theta_0", float64_hex: "0x1.0p+0" }],
      final_state_fidelity: 1,
      trajectory_sha256: "a".repeat(64),
    },
    resources: {
      canonical_logical: resource("canonical_logical"),
      common_basis_compiled: resource("common_basis_compiled"),
    },
    wall_time_s: null,
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/__health") return json(response, 200, { ok: true });
  if (url.pathname === "/__state") {
    return json(response, 200, { authenticatedRequests, unauthorizedRequests });
  }

  if (request.headers.authorization !== "Bearer majorana-local-dev") {
    unauthorizedRequests += 1;
    return json(response, 401, { detail: "missing local development identity" });
  }
  authenticatedRequests += 1;

  if (
    request.method === "GET"
    && url.pathname === "/v1/vqe/workflow-launch-projections"
  ) {
    return json(response, 200, {
      workflows: visibleWorkflowIds().map((id) => projection(id)),
      next_cursor: null,
    });
  }

  const projectionDetail = url.pathname.match(
    /^\/v1\/vqe\/workflow-launch-projections\/([0-9a-f-]+)$/,
  );
  if (projectionDetail && request.method === "GET") {
    const value = projection(projectionDetail[1]);
    return value
      ? json(response, 200, value)
      : problem(response, 404, "workflow launch projection not found", "not_found");
  }

  if (request.method === "GET" && url.pathname === "/v1/atlas/workflows") {
    const components = [{
      artifact_version_id: workflowId,
      semantic_key: "vqe.workflow.h2_sto3g_actual_vqe_v1",
      machine_validation_state: "valid",
      review_state: "unreviewed",
    }];
    if ([...experimentsById.values()].some((item) => item.slsqpSaved)) {
      components.push({
        artifact_version_id: slsqpWorkflowId,
        semantic_key: "workflow.instance.mock.slsqp",
        machine_validation_state: "machine_validated",
        review_state: "unreviewed",
        spec_json: {
          kind: "component_swap_workflow_draft",
          baseline_workflow_artifact_version_id: workflowId,
          execution_status: "private_qualification_candidate",
        },
      });
    }
    if ([...experimentsById.values()].some((item) => item.cobylaSaved)) {
      components.push({
        artifact_version_id: cobylaWorkflowId,
        semantic_key: "workflow.instance.mock.cobyla",
        machine_validation_state: "machine_validated",
        review_state: "unreviewed",
        spec_json: {
          kind: "component_swap_workflow_draft",
          baseline_workflow_artifact_version_id: workflowId,
          execution_status: "private_qualification_candidate",
        },
      });
    }
    if ([...experimentsById.values()].some((item) => item.uccsdSaved)) {
      components.push({
        artifact_version_id: uccsdWorkflowId,
        semantic_key: "workflow.instance.mock.uccsd",
        machine_validation_state: "machine_validated",
        review_state: "unreviewed",
        spec_json: { execution_status: "private_qualification_candidate" },
      });
    }
    if ([...experimentsById.values()].some((item) => item.hardwareEfficientSaved)) {
      components.push({
        artifact_version_id: hardwareEfficientWorkflowId,
        semantic_key: "workflow.instance.mock.hardware-efficient",
        machine_validation_state: "machine_validated",
        review_state: "unreviewed",
        spec_json: { execution_status: "private_qualification_candidate" },
      });
    }
    return json(response, 200, {
      components,
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/atlas/components") {
    if (url.searchParams.get("component_type") !== "parameter_optimizer") {
      return json(response, 422, { detail: "unexpected component type" });
    }
    return json(response, 200, {
      components: [
        {
          artifact_version_id: "50000000-0000-4000-8000-000000000001",
          component_type: "parameter_optimizer",
          semantic_key: "optimizer.slsqp.v1",
          normalized_spec_sha256: slsqpDigest,
        },
        {
          artifact_version_id: "50000000-0000-4000-8000-000000000002",
          component_type: "parameter_optimizer",
          semantic_key: "optimizer.cobyla.v1",
          normalized_spec_sha256: cobylaDigest,
        },
      ],
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/atlas/workflows/swaps") {
    const payload = await body(request);
    if (payload.baseline_workflow_artifact_version_id !== workflowId) {
      return json(response, 422, { detail: "unexpected swap baseline" });
    }
    const slsqp =
      payload.candidate_component_semantic_key === "optimizer.slsqp.v1"
      && payload.candidate_component_spec_sha256 === slsqpDigest;
    const cobyla =
      payload.candidate_component_semantic_key === "optimizer.cobyla.v1"
      && payload.candidate_component_spec_sha256 === cobylaDigest;
    if (!slsqp && !cobyla) {
      return json(response, 422, { detail: "unexpected optimizer component" });
    }
    experimentsById.set(`${slsqp ? "slsqp" : "cobyla"}-state`, {
      ...(slsqp ? { slsqpSaved: true } : { cobylaSaved: true }),
    });
    return json(response, 201, {
      artifact_id: slsqp
        ? "60000000-0000-4000-8000-000000000001"
        : "60000000-0000-4000-8000-000000000004",
      workflow_artifact_version_id: slsqp ? slsqpWorkflowId : cobylaWorkflowId,
      workflow_semantic_key: slsqp
        ? "workflow.instance.mock.slsqp"
        : "workflow.instance.mock.cobyla",
      request_sha256: "c".repeat(64),
      replayed: false,
      execution_status: "private_qualification_candidate",
      visibility: "private",
    });
  }

  if (
    request.method === "POST"
    && url.pathname === "/v1/atlas/workflows/ansatz-migrations"
  ) {
    const payload = await body(request);
    if (
      payload.baseline_workflow_artifact_version_id === uccsdWorkflowId
      && payload.migration
        === "h2_uccsd_slsqp_to_hardware_efficient_slsqp"
    ) {
      experimentsById.set("hardware-efficient-state", {
        hardwareEfficientSaved: true,
      });
      return json(response, 201, {
        artifact_id: "60000000-0000-4000-8000-000000000003",
        workflow_artifact_version_id: hardwareEfficientWorkflowId,
        workflow_semantic_key: "workflow.instance.mock.hardware-efficient",
        request_sha256: "e".repeat(64),
        replayed: false,
        execution_status: "private_qualification_candidate",
        visibility: "private",
      });
    }
    if (
      payload.baseline_workflow_artifact_version_id !== slsqpWorkflowId
      || payload.migration !== "h2_fixed_excitation_slsqp_to_uccsd_slsqp"
    ) {
      return json(response, 422, { detail: "unexpected ansatz migration" });
    }
    experimentsById.set("uccsd-state", { uccsdSaved: true });
    return json(response, 201, {
      artifact_id: "60000000-0000-4000-8000-000000000002",
      workflow_artifact_version_id: uccsdWorkflowId,
      workflow_semantic_key: "workflow.instance.mock.uccsd",
      request_sha256: "d".repeat(64),
      replayed: false,
      execution_status: "private_qualification_candidate",
      visibility: "private",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/vqe/experiments") {
    const payload = await body(request);
    if (![workflowId, slsqpWorkflowId, cobylaWorkflowId, uccsdWorkflowId, hardwareEfficientWorkflowId].includes(
      payload.workflow_artifact_version_id,
    )) {
      return json(response, 422, { detail: "unexpected workflow" });
    }
    const currentProjection = projection(payload.workflow_artifact_version_id);
    if (payload.expected_projection_sha256 !== currentProjection?.projection_sha256) {
      return problem(
        response,
        412,
        "workflow launch state changed; refresh before creating an experiment",
        "vqe_launch_projection_stale",
      );
    }
    const uccsd = payload.workflow_artifact_version_id === uccsdWorkflowId;
    const hardwareEfficient =
      payload.workflow_artifact_version_id === hardwareEfficientWorkflowId;
    const cobyla = payload.workflow_artifact_version_id === cobylaWorkflowId;
    const slsqp = payload.workflow_artifact_version_id === slsqpWorkflowId;
    experimentSequence += 1;
    const id = uuid("1", experimentSequence);
    const experiment = {
      id,
      workflow_artifact_version_id: payload.workflow_artifact_version_id,
      scientific_spec_json: {
        component_bindings: componentBindings({
          ansatzKey: hardwareEfficient
            ? "ansatz.hardware_efficient_ry_cx.v1"
            : uccsd
              ? "ansatz.uccsd.v1"
              : "ansatz.h2.fixed_excitation.v1",
          optimizerKey: cobyla
            ? "optimizer.cobyla.v1"
            : slsqp || uccsd || hardwareEfficient
              ? "optimizer.slsqp.v1"
              : "optimizer.bounded_scalar.v1",
          optimizerDigest: cobyla ? cobylaDigest : slsqpDigest,
        }),
      },
    };
    experimentsById.set(id, experiment);
    executionsByExperiment.set(id, []);
    return json(response, 201, experiment);
  }

  const experimentDetail = url.pathname.match(
    /^\/v1\/vqe\/experiments\/([0-9a-f-]+)$/,
  );
  if (experimentDetail && request.method === "GET") {
    const experiment = experimentsById.get(experimentDetail[1]);
    return experiment
      ? json(response, 200, experiment)
      : json(response, 404, { detail: "experiment not found" });
  }

  const executionList = url.pathname.match(
    /^\/v1\/vqe\/experiments\/([0-9a-f-]+)\/executions$/,
  );
  if (executionList && request.method === "GET") {
    return json(response, 200, executionsByExperiment.get(executionList[1]) ?? []);
  }
  if (executionList && request.method === "POST") {
    const experimentId = executionList[1];
    const payload = await body(request);
    if (!["qiskit", "pennylane"].includes(payload.preferred_framework)) {
      return json(response, 422, { detail: "unexpected framework" });
    }
    const experiment = experimentsById.get(experimentId);
    const currentProjection = projection(experiment?.workflow_artifact_version_id);
    if (payload.expected_projection_sha256 !== currentProjection?.projection_sha256) {
      return problem(
        response,
        412,
        "workflow launch state changed; refresh before starting execution",
        "vqe_launch_projection_stale",
      );
    }
    const ansatzKey = experiment?.scientific_spec_json?.component_bindings?.find(
      (binding) => binding.role === "ansatz" && binding.applicability !== "not_applicable",
    )?.component_semantic_key;
    const expectedCapability = ansatzKey === "ansatz.hardware_efficient_ry_cx.v1"
      ? "h2_sto3g_hardware_efficient_ry_cx_v1"
      : ansatzKey === "ansatz.uccsd.v1"
        ? "h2_sto3g_uccsd_v1"
        : "h2_sto3g_actual_vqe_v1";
    if (payload.requested_capability !== expectedCapability) {
      return json(response, 422, { detail: "unexpected capability" });
    }
    executionSequence += 1;
    const id = uuid("2", executionSequence);
    const succeeded = payload.preferred_framework === "qiskit";
    const execution = {
      id,
      experiment_id: experimentId,
      run_id: null,
      framework: payload.preferred_framework,
      runtime_profile_id:
        expectedCapability === "h2_sto3g_hardware_efficient_ry_cx_v1"
          ? `h2-hardware-efficient-${payload.preferred_framework}-linux-x86_64-production-v1`
          : expectedCapability === "h2_sto3g_uccsd_v1"
            ? `h2-uccsd-${payload.preferred_framework}-linux-x86_64-production-v1`
            : `h2-${payload.preferred_framework}-linux-x86_64-candidate-v1`,
      runtime_image_digest: `sha256:${"a".repeat(64)}`,
      status: succeeded ? "succeeded" : "failed",
      production_runtime_status: expectedCapability === "h2_sto3g_actual_vqe_v1"
        ? "unqualified"
        : "qualified",
      public_execution: "blocked",
      review_state: "unreviewed",
      scientific_review: "unreviewed",
      execution_policy: "owner_waived_private",
      runtime_qualification: expectedCapability === "h2_sto3g_actual_vqe_v1"
        ? "unqualified"
        : "qualified_private",
      publication: "blocked",
      observations: [observation(id, payload.preferred_framework, expectedCapability)],
    };
    executionsByExperiment.set(experimentId, [
      ...(executionsByExperiment.get(experimentId) ?? []),
      execution,
    ]);
    return json(response, 201, execution);
  }

  const materialize = url.pathname.match(
    /^\/v1\/vqe\/executions\/([0-9a-f-]+)\/materialize$/,
  );
  if (materialize && request.method === "POST") {
    const execution = [...executionsByExperiment.values()]
      .flat()
      .find((candidate) => candidate.id === materialize[1]);
    if (!execution || execution.status !== "succeeded") {
      return json(response, 409, { detail: "only a succeeded execution can be materialized" });
    }
    return json(response, 201, {
      artifact_version_id: "40000000-0000-4000-8000-000000000001",
      execution_id: execution.id,
      visibility: "private",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/vqe/controlled-comparisons") {
    const payload = await body(request);
    const baselineExperiment = [...experimentsById.values()].find(
      (item) => item.workflow_artifact_version_id
        === payload.baseline_workflow_artifact_version_id,
    );
    const candidateExperiment = [...experimentsById.values()].find(
      (item) => item.workflow_artifact_version_id
        === payload.candidate_workflow_artifact_version_id,
    );
    if (
      !baselineExperiment
      || !candidateExperiment
      || payload.baseline_workflow_artifact_version_id !== slsqpWorkflowId
      || payload.candidate_workflow_artifact_version_id !== cobylaWorkflowId
      || payload.changed_role !== "parameter_optimizer"
      || payload.baseline_configuration?.algorithm !== "scipy_slsqp"
      || payload.candidate_configuration?.algorithm !== "scipy_cobyla"
    ) {
      return json(response, 422, { detail: "comparison identity mismatch" });
    }
    comparisonSequence += 1;
    const id = uuid("7", comparisonSequence);
    const comparison = {
      id,
      workspace_id: "90000000-0000-4000-8000-000000000001",
      baseline_workflow_artifact_version_id: payload.baseline_workflow_artifact_version_id,
      candidate_workflow_artifact_version_id: payload.candidate_workflow_artifact_version_id,
      changed_role: "parameter_optimizer",
      spec_json: payload,
      spec_sha256: "9".repeat(64),
      scientific_review: "unreviewed",
      execution_policy: "owner_waived_private",
      visibility: "private",
      publication: "blocked",
      runs: [],
    };
    comparisonsById.set(id, comparison);
    return json(response, 201, comparison);
  }

  const comparisonDetail = url.pathname.match(
    /^\/v1\/vqe\/controlled-comparisons\/([0-9a-f-]+)$/,
  );
  if (comparisonDetail && request.method === "GET") {
    const comparison = comparisonsById.get(comparisonDetail[1]);
    return comparison
      ? json(response, 200, comparison)
      : json(response, 404, { detail: "comparison not found" });
  }

  const comparisonRuns = url.pathname.match(
    /^\/v1\/vqe\/controlled-comparisons\/([0-9a-f-]+)\/runs$/,
  );
  if (comparisonRuns && request.method === "POST") {
    const comparison = comparisonsById.get(comparisonRuns[1]);
    const payload = await body(request);
    const executions = [...executionsByExperiment.values()].flat();
    const baseline = executions.find((item) => item.id === payload.baseline_execution_id);
    const candidate = executions.find((item) => item.id === payload.candidate_execution_id);
    if (
      !comparison
      || !baseline
      || !candidate
      || baseline.status !== "succeeded"
      || candidate.status !== "succeeded"
      || baseline.framework !== candidate.framework
    ) {
      return json(response, 422, { detail: "comparison execution mismatch" });
    }
    const run = {
      id: uuid("8", comparison.runs.length + 1),
      comparison_spec_id: comparison.id,
      baseline_execution_id: baseline.id,
      candidate_execution_id: candidate.id,
      status: "comparable",
      run_json: {
        invariant_audit: {
          fixed_component_digests_match: true,
          dataset_snapshot_matches: true,
          parameter_count_matches: true,
          seed_matches: true,
          provider_matches: true,
          runtime_profile_matches: true,
          runtime_image_matches: true,
          adapter_release_matches: true,
          canonical_input_matches: true,
          canonical_circuit_metrics_match: true,
        },
        metric_observations: {
          framework: baseline.framework,
          baseline: comparisonMetricSummary({
            executionId: baseline.id,
            algorithm: "scipy_slsqp",
            metricProtocolSha256: comparison.spec_json.metric_protocol_sha256,
          }),
          candidate: comparisonMetricSummary({
            executionId: candidate.id,
            algorithm: "scipy_cobyla",
            metricProtocolSha256: comparison.spec_json.metric_protocol_sha256,
          }),
        },
        terminal_reason: null,
      },
      run_sha256: "d".repeat(64),
      created_at: new Date().toISOString(),
    };
    comparison.runs.push(run);
    return json(response, 201, run);
  }

  return json(response, 404, { detail: "unexpected mock route" });
});

server.listen(port, "127.0.0.1");
