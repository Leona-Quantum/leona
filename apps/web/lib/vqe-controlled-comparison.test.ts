import assert from "node:assert/strict";
import test from "node:test";
import {
  buildControlledComparisonRequest,
  parseComparisonExperiment,
  parseControlledComparison,
  resolveOptimizerSwapRootWorkflowId,
} from "./vqe-controlled-comparison.ts";

const ID_A = "00000000-0000-4000-8000-000000000001";
const ID_B = "00000000-0000-4000-8000-000000000002";
const ID_C = "00000000-0000-4000-8000-000000000003";

function experiment(id: string, workflow: string, optimizer: string, digest: string) {
  return {
    id,
    workflow_artifact_version_id: workflow,
    scientific_spec_json: {
      component_bindings: [
        {
          role: "ansatz",
          applicability: "required",
          component_semantic_key: "ansatz.h2.fixed_excitation.v1",
          component_spec_sha256: "a".repeat(64),
        },
        {
          role: "evaluation_protocol",
          applicability: "required",
          component_semantic_key: "evaluation.exact_reference.v1",
          component_spec_sha256: "e".repeat(64),
        },
        {
          role: "stopping_protocol",
          applicability: "required",
          component_semantic_key: "stopping.optimizer_convergence.v1",
          component_spec_sha256: "f".repeat(64),
        },
        {
          role: "parameter_optimizer",
          applicability: "required",
          component_semantic_key: optimizer,
          component_spec_sha256: digest,
        },
      ],
    },
  };
}

function metricSummary(executionId: string) {
  const resource = (stage: string) => ({
    stage,
    metric_protocol_sha256: "e".repeat(64),
    qubits: 4,
    depth: 83,
    gate_count: 152,
    two_qubit_gate_count: 48,
    parameter_count: 1,
  });
  return {
    execution_id: executionId,
    result_contract_sha256: "d".repeat(64),
    optimization: {
      best_energy_ha: -1.137306035753,
      absolute_error_ha: 0,
      converged: true,
      iterations: 8,
      optimizer_work: {
        iterations: 8,
        energy_evaluations: 13,
        gradient_evaluations: 8,
        hessian_evaluations: 0,
      },
      final_parameters: [{ slot_id: "theta_0", float64_hex: "0x1.0p+0" }],
      final_state_fidelity: 1,
      trajectory_sha256: "f".repeat(64),
    },
    resources: {
      canonical_logical: resource("canonical_logical"),
      common_basis_compiled: resource("common_basis_compiled"),
    },
    wall_time_s: null,
  };
}

function comparisonPayload() {
  return {
    id: ID_C,
    workspace_id: "00000000-0000-4000-8000-000000000009",
    baseline_workflow_artifact_version_id: ID_A,
    candidate_workflow_artifact_version_id: ID_B,
    changed_role: "parameter_optimizer",
    scientific_review: "owner_waived",
    visibility: "private",
    publication: "blocked",
    spec_sha256: "9".repeat(64),
    spec_json: {
      baseline_workflow_artifact_version_id: ID_A,
      candidate_workflow_artifact_version_id: ID_B,
      changed_role: "parameter_optimizer",
      fixed_component_digests: {
        ansatz: "a".repeat(64),
        evaluation_protocol: "e".repeat(64),
        stopping_protocol: "f".repeat(64),
      },
      baseline_configuration: { algorithm: "scipy_slsqp" },
      candidate_configuration: { algorithm: "scipy_cobyla" },
      metric_protocol_sha256: "e".repeat(64),
      budget_protocol_sha256: "f".repeat(64),
    },
    runs: [{
      id: "00000000-0000-4000-8000-000000000004",
      comparison_spec_id: ID_C,
      baseline_execution_id: "00000000-0000-4000-8000-000000000005",
      candidate_execution_id: "00000000-0000-4000-8000-000000000006",
      status: "comparable",
      run_json: {
        invariant_audit: {
          only_declared_role_changed: true,
          same_canonical_input: true,
        },
        metric_observations: {
          framework: "qiskit",
          baseline: metricSummary("00000000-0000-4000-8000-000000000005"),
          candidate: metricSummary("00000000-0000-4000-8000-000000000006"),
        },
        terminal_reason: null,
      },
      run_sha256: "8".repeat(64),
    }],
  };
}

test("builds the sole admitted optimizer comparison from frozen experiment identities", () => {
  const request = buildControlledComparisonRequest(
    parseComparisonExperiment(experiment(ID_A, ID_A, "optimizer.slsqp.v1", "b".repeat(64))),
    parseComparisonExperiment(experiment(ID_B, ID_B, "optimizer.cobyla.v1", "c".repeat(64))),
  );
  assert.deepEqual(request.baseline_configuration, { algorithm: "scipy_slsqp" });
  assert.deepEqual(request.candidate_configuration, { algorithm: "scipy_cobyla" });
  assert.deepEqual(Object.keys(request.fixed_component_digests).sort(), [
    "ansatz",
    "evaluation_protocol",
    "stopping_protocol",
  ]);
  assert.equal(request.metric_protocol_sha256, "e".repeat(64));
  assert.equal(request.budget_protocol_sha256, "f".repeat(64));
});

test("rejects hidden changes outside parameter_optimizer", () => {
  const baseline = parseComparisonExperiment(
    experiment(ID_A, ID_A, "optimizer.slsqp.v1", "b".repeat(64)),
  );
  const candidatePayload = experiment(ID_B, ID_B, "optimizer.cobyla.v1", "c".repeat(64));
  candidatePayload.scientific_spec_json.component_bindings[0].component_spec_sha256 = "d".repeat(64);
  assert.throws(
    () => buildControlledComparisonRequest(baseline, parseComparisonExperiment(candidatePayload)),
    /exactly parameter_optimizer/,
  );
});

test("fails closed when a comparison is not explicitly private and blocked", () => {
  assert.throws(
    () => parseControlledComparison({
      id: ID_A,
      changed_role: "parameter_optimizer",
      publication: "approved",
      visibility: "private",
      runs: [],
    }),
    /private MVP contract/,
  );
});

test("parses production-shaped server-recomputed comparison evidence", () => {
  const comparison = parseControlledComparison(comparisonPayload());
  assert.equal(comparison.baseline_algorithm, "scipy_slsqp");
  assert.equal(comparison.candidate_algorithm, "scipy_cobyla");
  assert.equal(
    comparison.runs[0]?.metric_observations.baseline.optimization.optimizer_work
      .energy_evaluations,
    13,
  );
  assert.equal(comparison.runs[0]?.metric_observations.framework, "qiskit");
});

test("rejects the obsolete flat comparison metric mock", () => {
  const payload = comparisonPayload();
  payload.runs[0].run_json.metric_observations = {
    baseline_energy_ha: -1.137306035753,
    candidate_energy_ha: -1.137306035753,
  } as never;
  assert.throws(
    () => parseControlledComparison(payload),
    /observations violate the evidence contract/,
  );
});

test("rejects a comparable status when a server invariant failed", () => {
  const payload = comparisonPayload();
  payload.runs[0].run_json.invariant_audit.same_canonical_input = false;
  assert.throws(
    () => parseControlledComparison(payload),
    /run violates the evidence contract/,
  );
});

test("rejects metric evidence attached to the wrong execution", () => {
  const payload = comparisonPayload();
  payload.runs[0].run_json.metric_observations.baseline.execution_id
    = "00000000-0000-4000-8000-000000000007";
  assert.throws(
    () => parseControlledComparison(payload),
    /metrics violate the evidence contract/,
  );
});

test("rejects resource evidence from a different metric protocol", () => {
  const payload = comparisonPayload();
  payload.runs[0].run_json.metric_observations.candidate.resources
    .canonical_logical.metric_protocol_sha256 = "1".repeat(64);
  assert.throws(
    () => parseControlledComparison(payload),
    /resources violate the evidence contract/,
  );
});

test("resolves the immutable root workflow only from a validated optimizer swap", () => {
  assert.equal(resolveOptimizerSwapRootWorkflowId({ components: [{
    artifact_version_id: ID_B,
    spec_json: {
      kind: "component_swap_workflow_draft",
      baseline_workflow_artifact_version_id: ID_A,
    },
  }] }, ID_B), ID_A);
  assert.equal(resolveOptimizerSwapRootWorkflowId({ components: [{
    artifact_version_id: ID_B,
    spec_json: { baseline_workflow_artifact_version_id: ID_A },
  }] }, ID_B), null);
});
