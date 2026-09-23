import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { AtlasWorkflowNote } from "../../components/atlas-workflow-note.tsx";
import { LAYER_GRAPH } from "../../lib/repository/layer-graph.ts";
import { slimLayerGraph } from "../../lib/workflow-planner/graph.ts";
import { leanPlannerGraph } from "../../lib/workflow-planner/lean.ts";

const GRAPH = leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, "en"));
const GRAPH_JA = leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, "ja"));

test("under a prompt the planner recognises: the problem, the pipeline and cost lines with kind and paper, and a link to the plan", () => {
  const view = render(<AtlasWorkflowNote prompt="Factor a 2048-bit RSA modulus." graph={GRAPH} locale="en" />);
  const note = view.container.querySelector("details.mj-run-atlas-note");
  assert.ok(note, "the card renders");
  assert.equal(note.hasAttribute("open"), false, "collapsed by default");
  const text = note.textContent ?? "";
  assert.match(text, /The Atlas workflow for this problem: Factor an integer \(RSA\)/);
  assert.match(text, /Logical qubits \(Gidney–Ekerå 2019\): 6,190/);
  assert.match(text, /Leading order; arxiv:1905\.09749, abstract/);
  const link = note.querySelector("a");
  assert.equal(link?.getAttribute("href"), `/repository/plan#q=${encodeURIComponent("Factor a 2048-bit RSA modulus.")}`);
});

test("a prompt with nothing to plan shows nothing", () => {
  const view = render(<AtlasWorkflowNote prompt="Prepare a Bell state and measure both qubits." graph={GRAPH} locale="en" />);
  assert.equal(view.container.textContent, "");
});

test("a Japanese prompt reads in Japanese, numbers joined by particles included", () => {
  const view = render(<AtlasWorkflowNote prompt="分子の基底状態エネルギーを化学精度で求めたい。スピン軌道は 100 個、λ は 500 ハートリー。" graph={GRAPH_JA} locale="ja" />);
  const text = view.container.textContent ?? "";
  assert.match(text, /この問題のアトラスのワークフロー：分子・物質の基底状態エネルギー/);
  assert.doesNotMatch(text, /記載なし.*記載なし.*記載なし.*記載なし/, "with λ and the orbitals read, not every line is blank");
});
