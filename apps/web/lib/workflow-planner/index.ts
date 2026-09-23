// The workflow planner: a sentence in, a costed pipeline of Atlas blocks out.
//
// Owner directive, 2026-09-22: "studio and atlas and nala could perhaps be
// improved through the block components of quantum circuits and algorithms and
// suggestions for full workflows (with complexity and other hardware estimates
// and optimization) when natural language input/task/problem given." Plan and
// the decisions taken without him: `~/Developer/ai-ops/desk/leona/plans/
// workflow-planner-20260922/PLAN.md`.
//
// Four steps, each its own module and each honest about what it cannot do:
//
// 1. `recognise.ts` reads the problem and its numbers from the sentence, and
//    keeps the words each came from. No model, so nothing is invented.
// 2. `assemble.ts` walks the Atlas layer graph from the problem's capability
//    down through the methods that realise it, so every block on screen is an
//    Atlas node with its own cited cost, and any block can be swapped for
//    another that fills the same slot.
// 3. `costs.ts` evaluates the formulas a paper states for the chosen
//    construction, and labels each number exact, a bound, leading-order, a
//    paper's numerical estimate, or a scaling with no constant.
// 4. The suggestions in the same report name what would change the cost —
//    another block, a parameter, a small instance to try first in Studio.
//
// Pure and synchronous: the page runs it on every keystroke.
import { assembleWorkflow, compileStage, type MethodChoices, type Stage } from "./assemble.ts";
import { costReport, type CostReport } from "./costs.ts";
import { indexPlannerGraph, type IndexedGraph, type PlannerGraph } from "./graph.ts";
import { problemById, type ProblemClass } from "./problems.ts";
import { readParams, recogniseProblems, withinSpec, type Recognition } from "./recognise.ts";
import type { ParamKey, ParamValues, ProblemId } from "./types.ts";

export interface PlanOverrides {
  /** The problem the reader picked, overriding the recognised one. */
  problem?: ProblemId | null;
  /**
   * Values the reader typed. `null` clears a value the text or an assumption
   * supplied; `NaN` is typed text that is not a number, and is refused like any
   * other value the parameter cannot take.
   */
  params?: Partial<Record<ParamKey, number | null>>;
  choices?: MethodChoices;
}

export interface WorkflowPlan {
  recognitions: Recognition[];
  problem: ProblemClass | null;
  /** True when the problem came from the reader's pick rather than the sentence. */
  problemPicked: boolean;
  params: ParamValues;
  root: Stage | null;
  compile: Stage | null;
  costs: CostReport | null;
}

/**
 * A typed value is held to the same spec the sentence is (`withinSpec`): the
 * range the parameter can take and, where it counts something, a whole number.
 * Anything else becomes `invalid` with no value — a κ of −1 or a layer count of
 * 1.5 would otherwise reach the formulas and print a negative step count beside
 * a paper's name.
 */
function applyReaderValues(problem: ProblemClass, params: ParamValues, overrides: PlanOverrides["params"]): ParamValues {
  if (!overrides) return params;
  return Object.fromEntries(
    problem.params.map((spec) => {
      const typed = overrides[spec.key];
      const current = params[spec.key] ?? { key: spec.key, value: null, origin: "unset" as const };
      if (typed === undefined) return [spec.key, current];
      if (typed === null) return [spec.key, { key: spec.key, value: null, origin: "unset" as const }];
      if (!withinSpec(spec, typed)) return [spec.key, { key: spec.key, value: null, origin: "invalid" as const }];
      return [spec.key, { key: spec.key, value: typed, origin: "reader" as const }];
    }),
  ) as ParamValues;
}

export function planWorkflow(graph: PlannerGraph | IndexedGraph, text: string, overrides: PlanOverrides = {}): WorkflowPlan {
  const index = "byId" in graph ? graph : indexPlannerGraph(graph);
  const recognitions = recogniseProblems(text);
  const picked = overrides.problem ? problemById(overrides.problem) ?? null : null;
  const problem = picked ?? (recognitions[0] ? problemById(recognitions[0].problem) ?? null : null);
  if (!problem) {
    return { recognitions, problem: null, problemPicked: false, params: {}, root: null, compile: null, costs: null };
  }
  const params = applyReaderValues(problem, readParams(problem, text), overrides.params);
  const root = assembleWorkflow(index, problem, overrides.choices);
  const compile = compileStage(index, root, overrides.choices);
  return {
    recognitions,
    problem,
    problemPicked: picked !== null,
    params,
    root,
    compile,
    costs: costReport(problem.id, params, root),
  };
}

export { PROBLEMS, problemById } from "./problems.ts";
export { formatPlain } from "./costs.ts";
export type { CostReport } from "./costs.ts";
export type { Stage, MethodChoices } from "./assemble.ts";
export type { PlannerGraph } from "./graph.ts";
