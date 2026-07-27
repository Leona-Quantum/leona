import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVqeFramework,
  resolveInitialWorkflowId,
} from "./vqe-workflow-launch.ts";

const WORKFLOWS = [
  {
    artifact_version_id: "019f-workflow-h2",
    semantic_key: "h2.sto3g.actual_vqe.workflow.v0_2",
  },
];

test("component catalog semantic identity resolves to a Registry UUID", () => {
  assert.equal(
    resolveInitialWorkflowId(WORKFLOWS, {
      semanticKey: "h2.sto3g.actual_vqe.workflow.v0_2",
    }),
    "019f-workflow-h2",
  );
});

test("unknown and ambiguous workflow requests fail closed", () => {
  assert.equal(
    resolveInitialWorkflowId(WORKFLOWS, { semanticKey: "unknown.workflow" }),
    null,
  );
  assert.equal(
    resolveInitialWorkflowId(WORKFLOWS, {
      artifactVersionId: "019f-workflow-h2",
      semanticKey: "h2.sto3g.actual_vqe.workflow.v0_2",
    }),
    null,
  );
});

test("only qualified VQE framework query values are accepted", () => {
  assert.equal(parseVqeFramework("pennylane"), "pennylane");
  assert.equal(parseVqeFramework("qiskit"), "qiskit");
  assert.equal(parseVqeFramework("forged-provider"), "qiskit");
});
