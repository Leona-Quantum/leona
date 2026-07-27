import assert from "node:assert/strict";
import test from "node:test";
import {
  checkStandardWorkflowSelections,
  getStandardVqeCatalog,
} from "./standard-source.ts";

test("component-first catalog has linked seed records without count-based claims", () => {
  const bundle = getStandardVqeCatalog();
  assert.ok(bundle.components.length > 0);
  assert.ok(bundle.implementations.length > 0);
  assert.ok(bundle.workflows.length > 0);
  assert.ok(bundle.comparison_specs.length > 0);
  assert.ok(
    bundle.implementations.every((binding) =>
      bundle.components.some(
        (component) => component.semantic_key === binding.component_semantic_key,
      ),
    ),
  );
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
