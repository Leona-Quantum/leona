import assert from "node:assert/strict";
import test from "node:test";
import {
  checkStandardWorkflowSelections,
  getStandardVqeCatalog,
} from "./standard-source.ts";

test("component-first catalog meets the owner-approved bounded MVP seed", () => {
  const bundle = getStandardVqeCatalog();
  assert.ok(bundle.components.length >= 18);
  assert.ok(bundle.implementations.length >= 12);
  assert.ok(bundle.workflows.length >= 4);
  assert.ok(bundle.controlled_comparisons.length >= 3);
});

test("browser layer recomputes executable workflow compatibility", () => {
  const bundle = getStandardVqeCatalog();
  const workflow = bundle.workflows.find(
    (item) => item.workflow_key === "workflow.h2.fixed_excitation.v1",
  );
  assert.ok(workflow);
  assert.equal(checkStandardWorkflowSelections(workflow.selections).compatible, true);
  assert.equal(
    workflow.registry_semantic_key,
    "h2.sto3g.actual_vqe.workflow.v0_2",
  );
});

test("component swap fails when a required contract is absent", () => {
  const bundle = getStandardVqeCatalog();
  const workflow = bundle.workflows.find(
    (item) => item.workflow_key === "workflow.h2.fixed_excitation.v1",
  );
  assert.ok(workflow);
  const incompatible = workflow.selections.map((selection) =>
    selection.role === "problem"
      ? { ...selection, component_semantic_key: "problem.lih.sto3g.v1" }
      : selection,
  );
  const result = checkStandardWorkflowSelections(incompatible);
  assert.equal(result.compatible, false);
  assert.ok(result.issues.some((issue) => issue.missing_contract === "electrons:2"));
});
