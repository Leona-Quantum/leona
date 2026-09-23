// What a Run page hands its client so a recognised prompt can be read by the
// Atlas planner: the lean graph (prose stripped, ~30 KB) and the worked
// examples' titles. Server-side only in practice — it imports the full layer
// graph — and shared by the Run home (which sends the reading to Nala) and a
// run's own page (which shows it under the prompt), so both read the same.
import { LAYER_GRAPH } from "../repository/layer-graph.ts";
import { workedExample } from "../worked-examples.ts";
import { slimLayerGraph, type PlannerGraph, type PlannerLocale } from "./graph.ts";
import { leanPlannerGraph } from "./lean.ts";
import { PROBLEMS } from "./problems.ts";

export interface RunPlanner {
  graph: PlannerGraph;
  exampleTitles: Record<string, string>;
}

export function runPlanner(locale: PlannerLocale): RunPlanner {
  const exampleTitles: Record<string, string> = Object.fromEntries(
    PROBLEMS.flatMap((problem) => {
      const example = problem.workedExample ? workedExample(problem.workedExample) : undefined;
      return example ? [[example.id, locale === "ja" ? example.title.ja : example.title.en]] : [];
    }),
  );
  return { graph: leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, locale)), exampleTitles };
}
