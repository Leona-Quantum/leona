// Writes apps/web/lib/workflow-planner/workflow-context-fixture.json: the
// `workflow_context` the Run composer sends for two fixed prompts. The web test
// (`lib/workflow-planner-run-context.test.ts`) asserts the file is what the
// code produces today, and the API test (`services/api/tests/
// test_run_workflow_context_fixture.py`) validates the same file against the Python
// request model, so the two definitions cannot drift apart unnoticed.
//
// Run from the repo root: node --experimental-strip-types scripts/write-workflow-context-fixture.ts
import { writeFileSync } from "node:fs";
import { LAYER_GRAPH } from "../apps/web/lib/repository/layer-graph.ts";
import { indexPlannerGraph, slimLayerGraph } from "../apps/web/lib/workflow-planner/graph.ts";
import { leanPlannerGraph } from "../apps/web/lib/workflow-planner/lean.ts";
import { contextForPrompt } from "../apps/web/lib/workflow-planner/run-context.ts";

const PROMPTS = {
  en: "Factor a 2048-bit RSA modulus.",
  ja: "分子の基底状態エネルギーを化学精度で求めたい。スピン軌道は 100 個、λ は 500 ハートリー。",
} as const;

const en = indexPlannerGraph(leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, "en")));
const ja = indexPlannerGraph(leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, "ja")));
const fixture = {
  en: contextForPrompt(en, PROMPTS.en, "en", { "shor-order-finding-15": "Shor finds the order of 7 mod 15" }),
  ja: contextForPrompt(ja, PROMPTS.ja, "ja"),
};
const out = new URL("../apps/web/lib/workflow-planner/workflow-context-fixture.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${out.pathname}`);
