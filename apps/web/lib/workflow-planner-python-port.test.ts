/**
 * The planner's Python port is held to this code (ai-ops 382, Phase B slice S2).
 *
 * `scripts/write-planner-fixture.ts` writes three files from
 * `workflow-planner/python-port.ts`: the data the port is built from, the parity
 * grid it is tested against, and the MCP tool's catalog. This file is the half of
 * the gate that runs where TypeScript runs: each committed file must be exactly
 * what the planner produces today, and the grid must reach every cost line and
 * every note the planner can print. `packages/py/planner/tests/test_planner_parity.py` is
 * the other half: the Python port must answer every grid point the same way.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { COST_NOTES } from "./workflow-planner/costs.ts";
import { plannerParityGrid, plannerPortData, plannerToolCatalog, serialiseByEntry } from "./workflow-planner/python-port.ts";

const REGENERATE = "regenerate from the repo root with: node --experimental-strip-types scripts/write-planner-fixture.ts";
const ROOT = new URL("../../../", import.meta.url);

const FILES = {
  data: new URL("packages/py/planner/src/leona_planner/planner_data.json", ROOT),
  grid: new URL("packages/py/planner/tests/parity_grid.json", ROOT),
  catalog: new URL("packages/py/mcp/src/leona_mcp/plan_catalog.json", ROOT),
};

const DATA = plannerPortData(LAYER_GRAPH, PAPER_REGISTER) as { lines: Record<string, unknown>; notes: Record<string, unknown> };
const GRID = plannerParityGrid(LAYER_GRAPH) as { points: { answer: { notes: string[] } }[] };

test("each committed port file is what the planner produces today, byte for byte", () => {
  const produced = { data: DATA, grid: GRID, catalog: plannerToolCatalog(LAYER_GRAPH) };
  for (const [name, url] of Object.entries(FILES)) {
    const committed = readFileSync(url, "utf8");
    assert.equal(committed, serialiseByEntry(produced[name as keyof typeof produced]), `${name} is stale; ${REGENERATE}`);
  }
});

test("the grid reaches every cost line costs.ts can print", () => {
  // Read from the source text, not from the grid, so a line the grid never
  // reaches is still counted. A line literal is `id: "…"` followed by `label:`;
  // a suggestion's is followed by `title:` and is not ported.
  const source = readFileSync(new URL("./workflow-planner/costs.ts", import.meta.url), "utf8");
  const declared = new Set([...source.matchAll(/id: "([a-z0-9-]+)",\s*label:/g)].map((match) => match[1]));
  assert.ok(declared.size >= 30, `only ${declared.size} line ids read from costs.ts; the pattern has stopped matching`);
  assert.deepEqual([...declared].sort(), Object.keys(DATA.lines).sort(), "a cost line no grid point reaches has no text in the port's data");
});

test("the grid reaches every note a cost report can carry", () => {
  const reached = new Set(GRID.points.flatMap((point) => point.answer.notes));
  assert.deepEqual([...reached].sort(), Object.keys(COST_NOTES).sort());
});
