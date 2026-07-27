import standardCatalogJson from "./standard-catalog.generated.json" with { type: "json" };
import type {
  StandardComponentDefinition,
  StandardVqeCatalogBundle,
  StandardWorkflowSelection,
} from "./types";

const GROUPS = new Set([
  "problems_datasets",
  "representation",
  "states_ansatze",
  "operator_pools",
  "search_growth",
  "optimizers",
  "compression",
  "measurement",
  "evaluation_execution",
]);

function fail(message: string): never {
  throw new Error(`[atlas-vqe/standard-source] ${message}`);
}

function validateBundle(raw: unknown): StandardVqeCatalogBundle {
  if (!raw || typeof raw !== "object") fail("bundle must be an object");
  const bundle = raw as Partial<StandardVqeCatalogBundle>;
  if (bundle.schema_version !== "1.1.0") fail("unsupported schema version");
  if (
    !Array.isArray(bundle.components) ||
    !Array.isArray(bundle.implementations) ||
    !Array.isArray(bundle.workflows) ||
    !Array.isArray(bundle.comparison_specs)
  ) {
    fail("bundle collections are missing");
  }
  if (
    bundle.components.length === 0 ||
    bundle.implementations.length === 0 ||
    bundle.workflows.length === 0
  ) {
    fail("component-first seed must contain components, bindings, and workflows");
  }
  const componentKeys = new Set<string>();
  for (const component of bundle.components) {
    if (
      !component ||
      typeof component.semantic_key !== "string" ||
      typeof component.component_type !== "string" ||
      !GROUPS.has(component.group)
    ) {
      fail("invalid standard-component seed candidate");
    }
    if (componentKeys.has(component.semantic_key)) fail("duplicate component identity");
    componentKeys.add(component.semantic_key);
  }
  for (const implementation of bundle.implementations) {
    if (!componentKeys.has(implementation.component_semantic_key)) {
      fail("implementation references an unknown component");
    }
  }
  for (const workflow of bundle.workflows) {
    if (
      workflow.status === "executable" &&
      typeof workflow.registry_semantic_key !== "string"
    ) {
      fail("executable workflow is missing its Registry semantic identity");
    }
    if (
      workflow.status !== "executable" &&
      workflow.registry_semantic_key !== null
    ) {
      fail("non-executable workflow cannot claim a Registry execution identity");
    }
    for (const selection of workflow.selections) {
      if (
        selection.component_semantic_key !== null &&
        !componentKeys.has(selection.component_semantic_key)
      ) {
        fail("workflow references an unknown component");
      }
    }
  }
  const workflowKeys = new Set(bundle.workflows.map((workflow) => workflow.workflow_key));
  for (const comparison of bundle.comparison_specs) {
    if (
      !workflowKeys.has(comparison.baseline_workflow_key) ||
      !workflowKeys.has(comparison.candidate_workflow_key)
    ) {
      fail("comparison specification references an unknown workflow");
    }
  }
  return bundle as StandardVqeCatalogBundle;
}

const BUNDLE = validateBundle(standardCatalogJson);

export function getStandardVqeCatalog(): StandardVqeCatalogBundle {
  return BUNDLE;
}

export function checkStandardWorkflowSelections(
  selections: StandardWorkflowSelection[],
  components: StandardComponentDefinition[] = BUNDLE.components,
) {
  const byKey = new Map(components.map((component) => [component.semantic_key, component]));
  const available = new Set<string>();
  const roles = new Set<string>();
  const issues: Array<{
    code: string;
    component_semantic_key: string;
    missing_contract: string | null;
  }> = [];
  for (const selection of selections) {
    if (roles.has(selection.role)) {
      issues.push({
        code: "duplicate_role",
        component_semantic_key: selection.component_semantic_key,
        missing_contract: null,
      });
      continue;
    }
    roles.add(selection.role);
    if (
      selection.applicability === "not_applicable" ||
      selection.applicability === "forbidden"
    ) {
      if (selection.component_semantic_key !== null) {
        issues.push({
          code: "component_present_for_inapplicable_role",
          component_semantic_key: selection.component_semantic_key,
          missing_contract: null,
        });
      }
      continue;
    }
    if (selection.component_semantic_key === null) {
      if (selection.applicability === "required") {
        issues.push({
          code: "missing_required_role",
          component_semantic_key: `role:${selection.role}`,
          missing_contract: null,
        });
      }
      continue;
    }
    const component = byKey.get(selection.component_semantic_key);
    if (!component) {
      issues.push({
        code: "unknown_component",
        component_semantic_key: selection.component_semantic_key,
        missing_contract: null,
      });
      continue;
    }
    if (component.component_type !== selection.role) {
      issues.push({
        code: "role_type_mismatch",
        component_semantic_key: component.semantic_key,
        missing_contract: null,
      });
    }
    for (const requirement of component.requires) {
      const token = `${requirement.name}:${requirement.value}`;
      if (!available.has(token)) {
        issues.push({
          code: "missing_contract",
          component_semantic_key: component.semantic_key,
          missing_contract: token,
        });
      }
    }
    component.provides.forEach((contract) =>
      available.add(`${contract.name}:${contract.value}`),
    );
    selection.bound_contracts.forEach((contract) =>
      available.add(`${contract.name}:${contract.value}`),
    );
  }
  return {
    compatible: issues.length === 0,
    contract_version: "2.0.0",
    issues,
    accumulated_contracts: Array.from(available).sort(),
  };
}
