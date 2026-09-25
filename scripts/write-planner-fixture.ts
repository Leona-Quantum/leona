// Writes the three files the Python port of the workflow planner is built from
// and held to (ai-ops 382, Phase B slice S2). What each one is, and why the port
// reads text and structure from data instead of re-typing them, is the module
// comment of apps/web/lib/workflow-planner/python-port.ts.
//
//   packages/py/planner/src/leona_planner/planner_data.json   problems, graph, line and note text, sources
//   packages/py/planner/tests/parity_grid.json                 inputs and what the TS planner answers
//   packages/py/mcp/src/leona_mcp/plan_catalog.json           what the plan_workflow tool describes
//
// `apps/web/lib/workflow-planner-python-port.test.ts` fails when a committed copy
// is not what the TS planner produces today; re-run this script and commit.
//
// Run from the repo root: node --experimental-strip-types scripts/write-planner-fixture.ts
import { writeFileSync } from "node:fs";
import { LAYER_GRAPH } from "../apps/web/lib/repository/layer-graph.ts";
import { PAPER_REGISTER } from "../apps/web/lib/repository/paper-register.ts";
import { plannerParityGrid, plannerPortData, plannerToolCatalog, serialiseByEntry } from "../apps/web/lib/workflow-planner/python-port.ts";

const outputs: [string, unknown][] = [
  ["../packages/py/planner/src/leona_planner/planner_data.json", plannerPortData(LAYER_GRAPH, PAPER_REGISTER)],
  ["../packages/py/planner/tests/parity_grid.json", plannerParityGrid(LAYER_GRAPH)],
  ["../packages/py/mcp/src/leona_mcp/plan_catalog.json", plannerToolCatalog(LAYER_GRAPH)],
];
for (const [path, value] of outputs) {
  const out = new URL(path, import.meta.url);
  writeFileSync(out, serialiseByEntry(value));
  console.log(`wrote ${out.pathname}`);
}
