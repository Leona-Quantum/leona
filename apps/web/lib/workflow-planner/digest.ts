// The planner's reading of a prompt, in the shape `POST /v1/runs` takes as
// `workflow_context`, so Nala plans with it.
//
// What goes to the model is what the planner page shows: the problem it read,
// each number with the words it came from, the pipeline of Atlas blocks, and
// every cost line with its kind and source. Nothing is summarised into prose
// here; the worker's directive tells the model to quote a cost line exactly
// or not at all, and it can only quote what it is given.
//
// Every string is cut to the length the API model allows
// (`services/api/.../routes/runs.py`, `WorkflowContext`), and a list to its
// cap, so a long sentence or a deep pipeline can never turn into a 422 that
// fails the run the reader asked for.
import { flattenStages } from "./assemble.ts";
import type { WorkflowPlan } from "./index.ts";
import { PLANNER_SOURCES } from "./sources.ts";
import type { Bilingual, CostKind, CostLine, ParamOrigin } from "./types.ts";
import type { StageChoice } from "./assemble.ts";
import type { PlannerLocale } from "./graph.ts";

export interface WorkflowContextParam {
  key: string;
  label: string;
  value: number | null;
  origin: ParamOrigin;
  evidence: string | null;
}

export interface WorkflowContextStage {
  depth: number;
  capability: string;
  method: string | null;
  why: StageChoice;
  repeat: string | null;
}

export interface WorkflowContextCost {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  kind: CostKind;
  source: string | null;
  missing: string[];
}

export interface WorkflowContext {
  version: 1;
  problem: string;
  problem_label: string;
  reading: string[];
  params: WorkflowContextParam[];
  stages: WorkflowContextStage[];
  costs: WorkflowContextCost[];
  suggestions: { title: string; body: string }[];
  small_instance: { id: string; title: string } | null;
  planner_path: string;
}

/** The API's own caps. Kept beside the builder so a change there is one grep away. */
export const CONTEXT_LIMITS = {
  reading: 8,
  params: 16,
  stages: 32,
  costs: 32,
  suggestions: 6,
  plannerPath: 2600,
} as const;

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function pick(text: Bilingual, locale: PlannerLocale): string {
  return locale === "ja" ? text.ja : text.en;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceText(source: CostLine["source"]): string | null {
  if (!source) return null;
  const entry = PLANNER_SOURCES[source];
  return cut(`${entry.paperId}, ${entry.locator}`, 200);
}

function cost(line: CostLine, locale: PlannerLocale): WorkflowContextCost {
  return {
    id: cut(line.id, 80),
    label: cut(pick(line.label, locale), 200),
    value: finite(line.value),
    unit: cut(pick(line.unit, locale), 80),
    formula: cut(line.formula, 200),
    kind: line.kind,
    source: sourceText(line.source),
    missing: (line.missing ?? []).slice(0, 12),
  };
}

/** Where the planner page shows the same plan. The sentence rides in the fragment, as everywhere else. */
export function plannerPath(text: string): string {
  const path = `/repository/plan#q=${encodeURIComponent(text.trim())}`;
  return path.length <= CONTEXT_LIMITS.plannerPath ? path : "/repository/plan";
}

export function workflowContext(
  plan: WorkflowPlan,
  text: string,
  locale: PlannerLocale,
  exampleTitles: Readonly<Record<string, string>> = {},
): WorkflowContext | null {
  const { problem, costs } = plan;
  if (!problem || !costs) return null;

  const params = problem.params.slice(0, CONTEXT_LIMITS.params).map((spec): WorkflowContextParam => {
    const value = plan.params[spec.key];
    return {
      key: spec.key,
      label: cut(pick(spec.label, locale), 120),
      value: finite(value?.value),
      origin: value?.origin ?? "unset",
      evidence: value?.evidence ? cut(value.evidence, 200) : null,
    };
  });

  const stages = [...flattenStages(plan.root), ...flattenStages(plan.compile)]
    .slice(0, CONTEXT_LIMITS.stages)
    .map((stage): WorkflowContextStage => ({
      depth: Math.min(stage.depth, 6),
      capability: cut(stage.capability.label, 200),
      method: stage.method ? cut(stage.method.label, 200) : null,
      why: stage.choice,
      repeat: stage.repeat ? cut(`${stage.repeat.mark}: ${stage.repeat.count}`, 200) : null,
    }));

  // The logical summary first (it is what the machine is sized from), then
  // every other line once, in the order the planner's table shows them.
  const seen = new Set<string>();
  const lines: CostLine[] = [];
  const logical = costs.logical;
  for (const line of [logical.logicalQubits, logical.toffolis, logical.tGates, logical.queries]) {
    if (line && !seen.has(line.id)) {
      seen.add(line.id);
      lines.push(line);
    }
  }
  for (const line of [...costs.lines, ...costs.classical, ...costs.published]) {
    if (!seen.has(line.id)) {
      seen.add(line.id);
      lines.push(line);
    }
  }

  const example = problem.workedExample;
  return {
    version: 1,
    problem: problem.id,
    problem_label: cut(pick(problem.label, locale), 200),
    reading: (plan.recognitions[0]?.problem === problem.id ? plan.recognitions[0].evidence : [])
      .slice(0, CONTEXT_LIMITS.reading)
      .map((words) => cut(words, 120)),
    params,
    stages,
    costs: lines.slice(0, CONTEXT_LIMITS.costs).map((line) => cost(line, locale)),
    suggestions: costs.suggestions.slice(0, CONTEXT_LIMITS.suggestions).map((s) => ({
      title: cut(pick(s.title, locale), 200),
      body: cut(pick(s.body, locale), 800),
    })),
    small_instance: example ? { id: example, title: cut(exampleTitles[example] ?? example, 200) } : null,
    planner_path: plannerPath(text),
  };
}
