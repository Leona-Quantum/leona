// The part of the planner graph the planner can reach, without its prose.
//
// The Atlas planner page gets the slim layer graph (about 188 KB) because it
// renders every node's summary and cited cost text. The Run composer needs
// the planner for one thing only: to hand Nala the workflow for a prompt the
// planner recognises. Assembly and cost evaluation read ids, labels and the
// route structure (`realizes`, `steps`, `via`, `repeats`) and never the prose,
// so this keeps exactly those, for exactly the nodes a walk from one of the
// planner's problems can reach. About 30 KB, sent as a server prop.
import { COMPILE_CAPABILITY, MAX_STAGE_DEPTH } from "./assemble.ts";
import type { PlannerGraph, PlannerNode } from "./graph.ts";
import { PROBLEMS } from "./problems.ts";

function lean(node: PlannerNode): PlannerNode {
  return { ...node, summary: "", cost: null, ownStretch: null, takes: null, returns: null };
}

/**
 * Every node within `MAX_STAGE_DEPTH` capability levels of a problem's root or
 * of the compile step, and every method realising one of those capabilities —
 * the alternatives a stage offers are part of what a walk reads.
 */
export function leanPlannerGraph(graph: PlannerGraph): PlannerGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const realizers = new Map<string, PlannerNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "method" || !node.realizes) continue;
    realizers.set(node.realizes, [...(realizers.get(node.realizes) ?? []), node]);
  }
  const keep = new Set<string>();
  let frontier = [...new Set([...PROBLEMS.map((problem) => problem.capability), COMPILE_CAPABILITY])];
  for (let level = 0; level <= MAX_STAGE_DEPTH && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const capability of frontier) {
      if (keep.has(capability) || !byId.has(capability)) continue;
      keep.add(capability);
      for (const method of realizers.get(capability) ?? []) {
        keep.add(method.id);
        next.push(...method.steps);
      }
    }
    frontier = next;
  }
  return { locale: graph.locale, nodes: graph.nodes.filter((node) => keep.has(node.id)).map(lean) };
}
