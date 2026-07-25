import { createServer } from "node:http";

const port = Number(process.env.MOCK_VQE_API_PORT ?? "18000");
const workflowId = "10000000-0000-4000-8000-000000000001";
let experimentSequence = 0;
let executionSequence = 0;
let authenticatedRequests = 0;
let unauthorizedRequests = 0;
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

function observation(executionId, framework) {
  const succeeded = framework === "qiskit";
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
              two_qubit_gate_count: 48,
              depth: 83,
              gate_count: 152,
              parameter_count: 1,
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
    return json(response, 200, {
      components: [{
        artifact_version_id: workflowId,
        semantic_key: "vqe.workflow.h2_sto3g_actual_vqe_v1",
        machine_validation_state: "valid",
        review_state: "unreviewed",
      }],
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/vqe/experiments") {
    const payload = await body(request);
    if (payload.workflow_artifact_version_id !== workflowId) {
      return json(response, 422, { detail: "unexpected workflow" });
    }
    experimentSequence += 1;
    const id = uuid("1", experimentSequence);
    executionsByExperiment.set(id, []);
    return json(response, 201, { id, workflow_artifact_version_id: workflowId });
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
    executionSequence += 1;
    const id = uuid("2", executionSequence);
    const succeeded = payload.preferred_framework === "qiskit";
    const execution = {
      id,
      experiment_id: experimentId,
      run_id: null,
      framework: payload.preferred_framework,
      runtime_profile_id: `h2-${payload.preferred_framework}-linux-x86_64-candidate-v1`,
      runtime_image_digest: `sha256:${"a".repeat(64)}`,
      status: succeeded ? "succeeded" : "failed",
      production_runtime_status: "unqualified",
      public_execution: "blocked",
      review_state: "owner_waived",
      observations: [observation(id, payload.preferred_framework)],
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
