import { createServer } from "node:http";

const port = Number(process.env.MOCK_VQE_API_PORT ?? "18000");
const workflowId = "10000000-0000-4000-8000-000000000001";
const slsqpWorkflowId = "10000000-0000-4000-8000-000000000002";
const uccsdWorkflowId = "10000000-0000-4000-8000-000000000003";
const hardwareEfficientWorkflowId = "10000000-0000-4000-8000-000000000004";
const slsqpDigest = "b".repeat(64);
let experimentSequence = 0;
let executionSequence = 0;
let authenticatedRequests = 0;
let unauthorizedRequests = 0;
const experimentsById = new Map();
const executionsByExperiment = new Map();

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
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
        spec_json: { execution_status: "private_qualification_candidate" },
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
      components: [{
        artifact_version_id: "50000000-0000-4000-8000-000000000001",
        component_type: "parameter_optimizer",
        semantic_key: "optimizer.slsqp.v1",
        normalized_spec_sha256: slsqpDigest,
      }],
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/atlas/workflows/swaps") {
    const payload = await body(request);
    if (
      payload.baseline_workflow_artifact_version_id !== workflowId
      || payload.candidate_component_semantic_key !== "optimizer.slsqp.v1"
      || payload.candidate_component_spec_sha256 !== slsqpDigest
    ) {
      return json(response, 422, { detail: "unexpected SLSQP prerequisite" });
    }
    experimentsById.set("slsqp-state", { slsqpSaved: true });
    return json(response, 201, {
      artifact_id: "60000000-0000-4000-8000-000000000001",
      workflow_artifact_version_id: slsqpWorkflowId,
      workflow_semantic_key: "workflow.instance.mock.slsqp",
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
    if (![workflowId, uccsdWorkflowId, hardwareEfficientWorkflowId].includes(
      payload.workflow_artifact_version_id,
    )) {
      return json(response, 422, { detail: "unexpected workflow" });
    }
    const uccsd = payload.workflow_artifact_version_id === uccsdWorkflowId;
    const hardwareEfficient =
      payload.workflow_artifact_version_id === hardwareEfficientWorkflowId;
    experimentSequence += 1;
    const id = uuid("1", experimentSequence);
    const experiment = {
      id,
      workflow_artifact_version_id: payload.workflow_artifact_version_id,
      scientific_spec_json: {
        component_bindings: [{
          role: "ansatz",
          applicability: "required",
          component_semantic_key: hardwareEfficient
            ? "ansatz.hardware_efficient_ry_cx.v1"
            : uccsd
              ? "ansatz.uccsd.v1"
              : "ansatz.h2.fixed_excitation.v1",
        }],
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
    const ansatzKey =
      experiment?.scientific_spec_json?.component_bindings?.[0]?.component_semantic_key;
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
      review_state: "owner_waived",
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

  return json(response, 404, { detail: "unexpected mock route" });
});

server.listen(port, "127.0.0.1");
