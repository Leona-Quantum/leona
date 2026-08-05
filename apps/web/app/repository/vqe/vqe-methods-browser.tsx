"use client";

import { useMemo, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { checkStandardWorkflowSelections } from "../../../lib/atlas-vqe/standard-source";
import type {
  StandardComponentDefinition,
  StandardComponentGroup,
  StandardDefinitionMaturity,
  PrivateMvpCapabilityManifest,
  StandardVqeCatalogBundle,
  StandardWorkflowStatus,
  StandardWorkflowSelection,
} from "../../../lib/atlas-vqe/types";

const GROUP_ORDER: StandardComponentGroup[] = [
  "problems_datasets",
  "representation",
  "states_ansatze",
  "operator_pools",
  "search_growth",
  "optimizers",
  "compression",
  "measurement",
  "evaluation_execution",
];

const ROLE_ORDER = [
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
  "error_mitigation",
  "evaluation_protocol",
  "stopping_protocol",
  "compilation_backend",
];

const COPY = {
  en: {
    title: "VQE Methods",
    subtitle:
      "Compose a VQE workflow candidate from structured standard-component seeds. Execution evidence is shown per implementation.",
    search: "Search components",
    searchPlaceholder: "UCCSD, Jordan–Wigner, optimizer…",
    provider: "Provider",
    allProviders: "All providers",
    status: "Definition maturity",
    allStatuses: "All maturities",
    currentWorkflow: "Current Workflow",
    template: "Workflow template",
    compatibility: "Compatibility",
    compatibleResult: "Compatible",
    incompatibleResult: "Incompatible",
    run: "Run in Studio",
    runBlocked: "Execution is unavailable until every selected component has a qualified binding.",
    swap: "Swap into current workflow",
    add: "Add to current workflow",
    selected: "Selected",
    implementations: "Implementations",
    inputs: "Inputs",
    outputs: "Outputs",
    sources: "Sources & provenance",
    noSource: "Atlas-neutral protocol",
    draft: "Draft",
    structured: "Structured",
    reviewed: "Reviewed",
    workflowDraft: "Draft workflow",
    workflowStructured: "Structured workflow",
    workflowExecutable: "Executable workflow",
    workflowCompatible: "Compatible workflow",
    workflowExecuted: "Executed workflow",
    experimental: "Experimental",
    deferred: "Deferred",
    resultCount: (count: number) => `${count} components`,
    noResults: "No standard-component seed candidates match these filters.",
    controlled: "Comparison specification",
    changed: "Changed component",
    noChange: "No component has been changed.",
    uncontrolled: (count: number) => `${count} components changed — not a controlled comparison.`,
    providerUnavailable: "No implementation binding is recorded",
    saveSwap: "Save controlled swap in Studio",
    swapQualification:
      "The selected optimizer is an owner-waived private qualification candidate. Publication and performance claims remain blocked.",
    saveMigration: "Save private UCCSD migration in Studio",
    migrationQualification:
      "This is a controlled capability migration, not a one-component swap. The ansatz and dependent compilation protocol change, adaptive-only roles become not applicable, and publication and performance claims remain blocked.",
    saveHardwareEfficientMigration:
      "Save private hardware-efficient migration in Studio",
    hardwareEfficientMigrationQualification:
      "This controlled capability migration changes the ansatz and dependent compilation protocol. Its Qiskit and PennyLane Linux/amd64 OCI runtimes are privately qualified; publication and performance claims remain blocked.",
  },
  ja: {
    title: "VQE Methods",
    subtitle:
      "構造化済みの標準component候補からVQE workflowを組み立てます。実行証拠は実装ごとに表示します。",
    search: "部品を検索",
    searchPlaceholder: "UCCSD、Jordan–Wigner、Optimizer…",
    provider: "Provider",
    allProviders: "すべて",
    status: "定義の成熟度",
    allStatuses: "すべて",
    currentWorkflow: "現在のWorkflow",
    template: "Workflow template",
    compatibility: "互換性",
    compatibleResult: "互換",
    incompatibleResult: "非互換",
    run: "Studioで実行",
    runBlocked: "選択した全componentに検証済みbindingが揃うまで実行できません。",
    swap: "現在のWorkflowへ交換",
    add: "現在のWorkflowへ追加",
    selected: "選択済み",
    implementations: "実装",
    inputs: "入力契約",
    outputs: "出力契約",
    sources: "出典・provenance",
    noSource: "Atlas中立protocol",
    draft: "草案",
    structured: "構造化済み",
    reviewed: "レビュー済み",
    workflowDraft: "草案workflow",
    workflowStructured: "構造化済みworkflow",
    workflowExecutable: "実行可能workflow",
    workflowCompatible: "互換workflow",
    workflowExecuted: "実行証拠ありworkflow",
    experimental: "実験的",
    deferred: "後続",
    resultCount: (count: number) => `${count}部品`,
    noResults: "条件に一致する標準component候補はありません。",
    controlled: "比較仕様",
    changed: "変更したcomponent",
    noChange: "componentは変更されていません。",
    uncontrolled: (count: number) => `${count}部品が変更されています（統制比較ではありません）。`,
    providerUnavailable: "実装bindingが記録されていません",
    saveSwap: "統制された交換をStudioへ保存",
    swapQualification:
      "選択したoptimizerはowner-waivedのprivate認定候補です。公開と性能主張は引き続き停止されます。",
    saveMigration: "UCCSD migrationをStudioへprivate保存",
    migrationQualification:
      "これは一部品交換ではなく、統制されたcapability migrationです。Ansatzと従属するcompilation protocolが変わり、adaptive専用roleはnot_applicableになります。公開と性能主張は引き続き停止されます。",
    saveHardwareEfficientMigration:
      "Hardware-Efficient migrationをStudioへprivate保存",
    hardwareEfficientMigrationQualification:
      "これはAnsatzと従属するcompilation protocolを変更する統制されたcapability migrationです。QiskitとPennyLaneのLinux/amd64 OCI runtimeはprivate認定済みですが、公開と性能主張は引き続き停止されます。",
  },
} as const;

const GROUP_LABELS = {
  en: {
    problems_datasets: "Problems & Datasets",
    representation: "Representation",
    states_ansatze: "States & Ansätze",
    operator_pools: "Operator Pools",
    search_growth: "Search & Growth",
    optimizers: "Optimizers",
    compression: "Compression",
    measurement: "Measurement",
    evaluation_execution: "Evaluation & Execution",
  },
  ja: {
    problems_datasets: "Problems & Datasets",
    representation: "Representation",
    states_ansatze: "States & Ansätze",
    operator_pools: "Operator Pools",
    search_growth: "Search & Growth",
    optimizers: "Optimizers",
    compression: "Compression",
    measurement: "Measurement",
    evaluation_execution: "Evaluation & Execution",
  },
} satisfies Record<PublicLocale, Record<StandardComponentGroup, string>>;

function maturityLabel(
  copy: (typeof COPY)[PublicLocale],
  maturity: StandardDefinitionMaturity,
) {
  return copy[maturity];
}

function workflowStatusLabel(
  copy: (typeof COPY)[PublicLocale],
  status: StandardWorkflowStatus,
) {
  const keys = {
    draft: "workflowDraft",
    structured: "workflowStructured",
    executable: "workflowExecutable",
    compatible: "workflowCompatible",
    executed: "workflowExecuted",
  } as const;
  return copy[keys[status]];
}

function sortedSelections(selections: StandardWorkflowSelection[]) {
  return [...selections].sort(
    (left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role),
  );
}

function formatPort(port: { name: string; value: string }) {
  return `${port.name}:${port.value}`;
}

export function VqeMethodsBrowser({
  catalog,
  capabilityManifest,
  locale,
}: {
  catalog: StandardVqeCatalogBundle;
  capabilityManifest: PrivateMvpCapabilityManifest;
  locale: PublicLocale;
}) {
  const copy = COPY[locale];
  const labels = GROUP_LABELS[locale];
  const initialWorkflow =
    catalog.workflows.find(
      (workflow) => workflow.workflow_key === "workflow.h2.fixed_excitation.v1",
    ) ?? catalog.workflows[0];
  const [group, setGroup] = useState<StandardComponentGroup>("problems_datasets");
  const [query, setQuery] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [executionProvider, setExecutionProvider] = useState("qiskit");
  const [maturity, setMaturity] = useState<"" | StandardDefinitionMaturity>("");
  const [templateKey, setTemplateKey] = useState(initialWorkflow.workflow_key);
  const [selections, setSelections] = useState<StandardWorkflowSelection[]>(
    initialWorkflow.selections,
  );

  const componentByKey = useMemo(
    () => new Map(catalog.components.map((component) => [component.semantic_key, component])),
    [catalog.components],
  );
  const providers = useMemo(
    () => Array.from(new Set(catalog.implementations.map((item) => item.provider))).sort(),
    [catalog.implementations],
  );
  const bindingsByComponent = useMemo(() => {
    const result = new Map<string, typeof catalog.implementations>();
    for (const binding of catalog.implementations) {
      result.set(binding.component_semantic_key, [
        ...(result.get(binding.component_semantic_key) ?? []),
        binding,
      ]);
    }
    return result;
  }, [catalog.implementations]);

  const filteredComponents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return catalog.components.filter((component) => {
      const providerBindings = bindingsByComponent.get(component.semantic_key) ?? [];
      return (
        component.group === group &&
        (!normalized ||
          [
            component.display_name,
            component.semantic_definition,
            component.component_type,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalized)) &&
        (!maturity || component.maturity === maturity) &&
        (!filterProvider ||
          providerBindings.some((binding) => binding.provider === filterProvider))
      );
    });
  }, [bindingsByComponent, catalog.components, filterProvider, group, maturity, query]);

  const compatibility = useMemo(
    () => checkStandardWorkflowSelections(sortedSelections(selections), catalog.components),
    [catalog.components, selections],
  );
  const baseline =
    catalog.workflows.find((workflow) => workflow.workflow_key === templateKey) ??
    initialWorkflow;
  const baselineByRole = new Map(
    baseline.selections.map((selection) => [selection.role, selection]),
  );
  const currentByRole = new Map(selections.map((selection) => [selection.role, selection]));
  const changedRoles = Array.from(
    new Set([...baselineByRole.keys(), ...currentByRole.keys()]),
  ).filter(
    (role) =>
      baselineByRole.get(role)?.component_semantic_key !==
      currentByRole.get(role)?.component_semantic_key,
  );
  const executable =
    compatibility.compatible &&
    baseline.status === "executable" &&
    baseline.supported_evaluator_providers.includes(executionProvider) &&
    changedRoles.length === 0 &&
    typeof baseline.registry_semantic_key === "string";
  const fixedExcitationBaseline = catalog.workflows.find(
    (workflow) => workflow.workflow_key === "workflow.h2.fixed_excitation.v1",
  );
  const uccsdMigrationReady =
    compatibility.compatible &&
    baseline.workflow_key === "workflow.h2.uccsd.v1" &&
    new Set(["qiskit", "pennylane"]).has(executionProvider) &&
    typeof fixedExcitationBaseline?.registry_semantic_key === "string";
  const hardwareEfficientMigrationReady =
    compatibility.compatible &&
    baseline.workflow_key === "workflow.h2.hardware_efficient.v1" &&
    new Set(["qiskit", "pennylane"]).has(executionProvider) &&
    typeof fixedExcitationBaseline?.registry_semantic_key === "string";
  const controlledSwapReady =
    compatibility.compatible &&
    baseline.workflow_key === "workflow.h2.fixed_excitation.v1" &&
    typeof baseline.registry_semantic_key === "string" &&
    changedRoles.length === 1 &&
    changedRoles[0] === "parameter_optimizer" &&
    new Set(["optimizer.slsqp.v1", "optimizer.cobyla.v1"]).has(
      currentByRole.get("parameter_optimizer")?.component_semantic_key ?? "",
    );

  function selectTemplate(nextKey: string) {
    const next = catalog.workflows.find((workflow) => workflow.workflow_key === nextKey);
    if (!next) return;
    setTemplateKey(nextKey);
    setSelections(next.selections);
    if (
      next.supported_evaluator_providers.length > 0
      && !next.supported_evaluator_providers.includes(executionProvider)
    ) {
      setExecutionProvider(next.supported_evaluator_providers[0] ?? "");
    }
  }

  function swapComponent(component: StandardComponentDefinition) {
    const index = selections.findIndex(
      (selection) => selection.role === component.component_type,
    );
    if (
      index >= 0 &&
      selections[index]?.component_semantic_key === component.semantic_key
    ) {
      return;
    }
    const nextSelection: StandardWorkflowSelection = {
      role: component.component_type,
      component_semantic_key: component.semantic_key,
      applicability: "required",
      configuration: index >= 0 ? selections[index]?.configuration ?? [] : [],
      bound_contracts: index >= 0 ? selections[index]?.bound_contracts ?? [] : [],
    };
    if (index < 0) {
      setSelections(sortedSelections([...selections, nextSelection]));
      return;
    }
    setSelections(
      selections.map((selection, selectionIndex) =>
        selectionIndex === index ? nextSelection : selection,
      ),
    );
  }

  return (
    <section className="mj-vqe-methods" aria-labelledby="vqe-methods-heading">
      <header className="mj-vqe-methods-heading">
        <div>
          <p className="mj-eyebrow">Component-first catalog</p>
          <h2 id="vqe-methods-heading">{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <a className="mj-primary-button" href="#current-vqe-workflow">
          {locale === "ja" ? "VQEワークフローを組み立てる" : "Build a VQE Workflow"}
        </a>
      </header>

      <div className="mj-studio-empty" role="note">
        <strong>
          {locale === "ja" ? "Private technical MVP — 公開停止中" : "Private technical MVP — publication blocked"}
        </strong>
        <p>{capabilityManifest.claim_boundary.statement}</p>
        <p className="mj-mono-muted">
          Fixed Excitation + SLSQP: {capabilityManifest.golden_journeys.primary_fixed_excitation_slsqp.status}
          {" · "}SLSQP → COBYLA: {capabilityManifest.golden_journeys.controlled_slsqp_to_cobyla.status}
          {" · "}WorkOS reopen: {capabilityManifest.golden_journeys.live_workos_same_account_reopen.status}
        </p>
      </div>

      <div className="mj-vqe-composer">
        <nav className="mj-vqe-component-types" aria-label="Component types">
          {GROUP_ORDER.map((value) => (
            <button
              type="button"
              key={value}
              className={group === value ? "is-active" : ""}
              aria-pressed={group === value}
              onClick={() => setGroup(value)}
            >
              {labels[value]}
              <span>
                {catalog.components.filter((component) => component.group === value).length}
              </span>
            </button>
          ))}
        </nav>

        <div className="mj-vqe-component-catalog">
          <div className="mj-repository-controls">
            <label>
              <span>{copy.search}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                type="search"
              />
            </label>
            <label>
              <span>{copy.provider}</span>
              <select
                value={filterProvider}
                onChange={(event) => setFilterProvider(event.target.value)}
              >
                <option value="">{copy.allProviders}</option>
                {providers.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.status}</span>
              <select
                value={maturity}
                onChange={(event) =>
                  setMaturity(event.target.value as "" | StandardDefinitionMaturity)
                }
              >
                <option value="">{copy.allStatuses}</option>
                {(["draft", "structured", "reviewed"] as const).map(
                  (item) => (
                    <option value={item} key={item}>
                      {maturityLabel(copy, item)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <p className="mj-repository-result-count" aria-live="polite">
            {copy.resultCount(filteredComponents.length)}
          </p>
          <div className="mj-vqe-component-list">
            {filteredComponents.map((component) => {
              const bindings = bindingsByComponent.get(component.semantic_key) ?? [];
              const hasRole = selections.some(
                (selection) => selection.role === component.component_type,
              );
              const isSelected = selections.some(
                (selection) =>
                  selection.role === component.component_type &&
                  selection.component_semantic_key === component.semantic_key,
              );
              return (
                <article className="mj-vqe-component-card" key={component.semantic_key}>
                  <div className="mj-repo-card-top">
                    <span
                      className="mj-vqe-badge"
                      data-tone={component.maturity === "reviewed" ? "ok" : "neutral"}
                    >
                      {maturityLabel(copy, component.maturity)}
                    </span>
                    <span>{component.catalog_state}</span>
                    <span>{component.component_type}</span>
                    <span>Definition {component.definition_version}</span>
                  </div>
                  <h3>{component.display_name}</h3>
                  <p>{component.semantic_definition}</p>
                  <dl className="mj-vqe-contract-list">
                    <div>
                      <dt>{copy.inputs}</dt>
                      <dd>{component.requires.map(formatPort).join(", ") || "—"}</dd>
                    </div>
                    <div>
                      <dt>{copy.outputs}</dt>
                      <dd>{component.provides.map(formatPort).join(", ") || "—"}</dd>
                    </div>
                    <div>
                      <dt>{copy.implementations}</dt>
                      <dd>
                        {bindings.length
                          ? bindings.map((binding) => (
                              <span className="mj-vqe-binding" key={binding.binding_key}>
                                {binding.provider} {binding.package_version} ·{" "}
                                {binding.binding_kind} · {binding.evidence_level}
                              </span>
                            ))
                          : copy.providerUnavailable}
                      </dd>
                    </div>
                  </dl>
                  <details>
                    <summary>{copy.sources}</summary>
                    {component.source_locators.length ? (
                      <ul>
                        {component.source_locators.map((source) => (
                          <li key={source}>
                            <a href={source} target="_blank" rel="noreferrer">
                              {source}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{copy.noSource}</p>
                    )}
                  </details>
                  <button
                    className="mj-secondary-button"
                    type="button"
                    disabled={isSelected}
                    onClick={() => swapComponent(component)}
                  >
                    {isSelected ? copy.selected : hasRole ? copy.swap : copy.add}
                  </button>
                </article>
              );
            })}
          </div>
          {!filteredComponents.length ? (
            <div className="mj-repository-empty">
              <p>{copy.noResults}</p>
            </div>
          ) : null}
        </div>

        <aside className="mj-vqe-workflow-tray" id="current-vqe-workflow">
          <h3>{copy.currentWorkflow}</h3>
          <label>
            <span>{copy.template}</span>
            <select value={templateKey} onChange={(event) => selectTemplate(event.target.value)}>
              {catalog.workflows.map((workflow) => (
                <option key={workflow.workflow_key} value={workflow.workflow_key}>
                  {workflow.display_name} · {workflowStatusLabel(copy, workflow.status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.provider}</span>
            <select
              value={executionProvider}
              onChange={(event) => setExecutionProvider(event.target.value)}
            >
              {baseline.supported_evaluator_providers.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <ol className="mj-vqe-workflow-components">
            {sortedSelections(selections).map((selection) => (
              <li key={selection.role}>
                <span>{selection.role}</span>
                <strong>
                  {selection.component_semantic_key === null
                    ? selection.applicability
                    : componentByKey.get(selection.component_semantic_key)?.display_name ??
                      selection.component_semantic_key}
                </strong>
                {selection.component_semantic_key !== null &&
                !(bindingsByComponent.get(selection.component_semantic_key) ?? []).length ? (
                  <small>{copy.providerUnavailable}</small>
                ) : null}
              </li>
            ))}
          </ol>

          <div
            className="mj-vqe-compatibility"
            data-compatible={compatibility.compatible}
            aria-live="polite"
          >
            <strong>
              {copy.compatibility}:{" "}
              {compatibility.compatible
                ? copy.compatibleResult
                : copy.incompatibleResult}
            </strong>
            {!compatibility.compatible ? (
              <ul>
                {compatibility.issues.map((issue, index) => (
                  <li key={`${issue.component_semantic_key}:${issue.code}:${index}`}>
                    {issue.component_semantic_key}: {issue.code}
                    {issue.missing_contract ? ` (${issue.missing_contract})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mj-vqe-comparison-state">
            <strong>{copy.controlled}</strong>
            {changedRoles.length === 0 ? <p>{copy.noChange}</p> : null}
            {changedRoles.length === 1 ? (
              <p>
                {copy.changed}: {changedRoles[0]}
                <br />
                {baselineByRole.get(changedRoles[0])?.component_semantic_key} →{" "}
                {currentByRole.get(changedRoles[0])?.component_semantic_key}
              </p>
            ) : null}
            {changedRoles.length > 1 ? <p>{copy.uncontrolled(changedRoles.length)}</p> : null}
          </div>

          {hardwareEfficientMigrationReady ? (
            <>
              <a
                className="mj-primary-button"
                href={`/studio?vqe=1&vqeWorkflowKey=${encodeURIComponent(
                  fixedExcitationBaseline?.registry_semantic_key ?? "",
                )}&vqeProvider=${encodeURIComponent(
                  executionProvider,
                )}&vqeMigration=${encodeURIComponent(
                  "h2_uccsd_slsqp_to_hardware_efficient_slsqp",
                )}`}
              >
                {copy.saveHardwareEfficientMigration}
              </a>
              <p className="mj-vqe-run-note">
                {copy.hardwareEfficientMigrationQualification}
              </p>
            </>
          ) : uccsdMigrationReady ? (
            <>
              <a
                className="mj-primary-button"
                href={`/studio?vqe=1&vqeWorkflowKey=${encodeURIComponent(
                  fixedExcitationBaseline?.registry_semantic_key ?? "",
                )}&vqeProvider=${encodeURIComponent(
                  executionProvider,
                )}&vqeMigration=${encodeURIComponent(
                  "h2_fixed_excitation_slsqp_to_uccsd_slsqp",
                )}`}
              >
                {copy.saveMigration}
              </a>
              <p className="mj-vqe-run-note">{copy.migrationQualification}</p>
            </>
          ) : controlledSwapReady ? (
            <>
              <a
                className="mj-primary-button"
                href={`/studio?vqe=1&vqeWorkflowKey=${encodeURIComponent(
                  baseline.registry_semantic_key ?? "",
                )}&vqeProvider=${encodeURIComponent(
                  executionProvider,
                )}&vqeSwap=${encodeURIComponent(
                  currentByRole.get("parameter_optimizer")?.component_semantic_key ?? "",
                )}`}
              >
                {copy.saveSwap}
              </a>
              <p className="mj-vqe-run-note">{copy.swapQualification}</p>
            </>
          ) : executable ? (
            <a
              className="mj-primary-button"
              href={`/studio?vqe=1&vqeWorkflowKey=${encodeURIComponent(
                baseline.registry_semantic_key ?? "",
              )}&vqeProvider=${encodeURIComponent(executionProvider)}`}
            >
              {copy.run}
            </a>
          ) : (
            <>
              <button className="mj-primary-button" type="button" disabled>
                {copy.run}
              </button>
              <p className="mj-vqe-run-note">{copy.runBlocked}</p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
