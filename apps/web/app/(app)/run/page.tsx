import { RunWorkspace, type RunPlanner } from "./run-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { LAYER_GRAPH } from "../../../lib/repository/layer-graph.ts";
import { slimLayerGraph } from "../../../lib/workflow-planner/graph.ts";
import { leanPlannerGraph } from "../../../lib/workflow-planner/lean.ts";
import { PROBLEMS } from "../../../lib/workflow-planner/problems.ts";
import { workedExample } from "../../../lib/worked-examples.ts";

export const metadata = { title: "Run" };

export default async function RunHome() {
  const locale = await getPublicLocale();
  // The planner Nala plans with when a prompt reads as a known problem. Built
  // here, on the server, so the client receives the ~30 KB lean graph rather
  // than importing the whole layer graph.
  const exampleTitles: Record<string, string> = Object.fromEntries(
    PROBLEMS.flatMap((problem) => {
      const example = problem.workedExample ? workedExample(problem.workedExample) : undefined;
      return example ? [[example.id, locale === "ja" ? example.title.ja : example.title.en]] : [];
    }),
  );
  const planner: RunPlanner = { graph: leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, locale)), exampleTitles };
  return <RunWorkspace locale={locale} planner={planner} />;
}
