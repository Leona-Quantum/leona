import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilityFromExperiment,
  comparableResources,
  latestSuccess,
  parseVqeExecutions,
} from "./vqe-proof.ts";

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
  review_state: "unreviewed",
  scientific_review: "unreviewed",
  execution_policy: "owner_waived_private",
  runtime_qualification: "unqualified",
  publication: "blocked",
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
  it("derives UCCSD capability only from the frozen ansatz identity", () => {
    assert.equal(
      capabilityFromExperiment({
        scientific_spec_json: {
          component_bindings: [{
            role: "ansatz",
            applicability: "required",
            component_semantic_key: "ansatz.uccsd.v1",
          }],
        },
      }),
      "h2_sto3g_uccsd_v1",
    );
  });

  it("recognizes the frozen hardware-efficient ansatz identity", () => {
    assert.equal(
      capabilityFromExperiment({
        scientific_spec_json: {
          component_bindings: [{
            role: "ansatz",
            applicability: "required",
            component_semantic_key: "ansatz.hardware_efficient_ry_cx.v1",
          }],
        },
      }),
      "h2_sto3g_hardware_efficient_ry_cx_v1",
    );
  });

  it("recognizes the provisioned H2 v0.2 ansatz identity", () => {
    assert.equal(
      capabilityFromExperiment({
        scientific_spec_json: {
          component_bindings: [{
            role: "ansatz",
            applicability: "required",
            component_semantic_key: "h2.sto3g.actual_vqe.v0_2.ansatz",
          }],
        },
      }),
      "h2_sto3g_actual_vqe_v1",
    );
  });

  it("fails closed on an unknown executable ansatz identity", () => {
    assert.throws(
      () => capabilityFromExperiment({
        scientific_spec_json: {
          component_bindings: [{
            role: "ansatz",
            applicability: "required",
            component_semantic_key: "ansatz.unreviewed.v1",
          }],
        },
      }),
      /not executable/,
    );
  });

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

  it("fails closed if legacy and canonical runtime qualification disagree", () => {
    assert.throws(
      () => parseVqeExecutions([{ ...candidate, runtime_qualification: "qualified_private" }]),
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
