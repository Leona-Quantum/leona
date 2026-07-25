import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comparableResources, latestSuccess, parseVqeExecutions } from "./vqe-proof.ts";

const candidate = {
  id: "00000000-0000-0000-0000-000000000001",
  experiment_id: "00000000-0000-0000-0000-000000000002",
  run_id: null,
  framework: "qiskit",
  runtime_profile_id: "candidate",
  runtime_image_digest: `sha256:${"1".repeat(64)}`,
  status: "succeeded",
  production_runtime_status: "unqualified",
  public_execution: "blocked",
  review_state: "owner_waived",
  observations: [{
    id: "o1",
    attempt: 1,
    status: "succeeded",
    failure_code: null,
    result_contract_json: {
      status: "succeeded",
      framework: "qiskit",
      best_energy_ha: -1.137,
      exact_energy_ha: -1.137,
      absolute_error_ha: 1e-14,
      final_state_fidelity: 0.999999999999,
      iterations: 13,
      resources: [{
        stage: "common_basis_compiled",
        two_qubit_gate_count: 48,
        depth: 83,
        parameter_count: 1,
      }],
    },
  }],
};

describe("VQE proof parsing", () => {
  it("shows only comparison-protocol resources from an honest candidate", () => {
    const execution = parseVqeExecutions([candidate])[0]!;
    const result = latestSuccess(execution);
    assert.notEqual(result, null);
    assert.equal(comparableResources(result!)?.two_qubit_gate_count, 48);
  });

  it("fails closed if the API fabricates a completed human review", () => {
    assert.throws(
      () => parseVqeExecutions([{ ...candidate, review_state: "human_reviewed" }]),
      /candidate contract/,
    );
  });

  it("fails closed on a malformed observation instead of hiding it", () => {
    assert.throws(
      () => parseVqeExecutions([{ ...candidate, observations: [null] }]),
      /observation payload/,
    );
  });
});
