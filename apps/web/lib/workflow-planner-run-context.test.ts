/**
 * The planner's reading of a Run prompt, as sent to Nala.
 *
 * The lean graph must plan exactly as the full one does (it only drops prose),
 * the context must stay inside the API model's bounds whatever the reader
 * types, and the committed wire fixture must be what this code produces today:
 * `services/api/tests/test_run_workflow_context_fixture.py` validates the same file
 * against the Python model, so the two definitions cannot drift apart silently.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { planWorkflow } from "./workflow-planner/index.ts";
import { indexPlannerGraph, slimLayerGraph } from "./workflow-planner/graph.ts";
import { flattenStages } from "./workflow-planner/assemble.ts";
import { leanPlannerGraph } from "./workflow-planner/lean.ts";
import { PROBLEMS } from "./workflow-planner/problems.ts";
import { CONTEXT_LIMITS, type WorkflowContext } from "./workflow-planner/digest.ts";
import { contextForPrompt } from "./workflow-planner/run-context.ts";

const FULL = { en: slimLayerGraph(LAYER_GRAPH, "en"), ja: slimLayerGraph(LAYER_GRAPH, "ja") };
const LEAN = { en: leanPlannerGraph(FULL.en), ja: leanPlannerGraph(FULL.ja) };
const FULL_INDEX = { en: indexPlannerGraph(FULL.en), ja: indexPlannerGraph(FULL.ja) };
const LEAN_INDEX = { en: indexPlannerGraph(LEAN.en), ja: indexPlannerGraph(LEAN.ja) };
const FIXTURE_PATH = new URL("./workflow-planner/workflow-context-fixture.json", import.meta.url);
const FIXTURE_PROMPTS = { en: "Factor a 2048-bit RSA modulus.", ja: "分子の基底状態エネルギーを化学精度で求めたい。スピン軌道は 100 個、λ は 500 ハートリー。" } as const;

test("the lean graph plans every problem exactly as the full graph does, in both languages", () => {
  for (const locale of ["en", "ja"] as const) {
    for (const problem of PROBLEMS) {
      const sentence = locale === "ja" ? problem.example.ja : problem.example.en;
      const full = planWorkflow(FULL_INDEX[locale], sentence, { problem: problem.id });
      const lean = planWorkflow(LEAN_INDEX[locale], sentence, { problem: problem.id });
      const shape = (plan: typeof full) =>
        [...flattenStages(plan.root), ...flattenStages(plan.compile)].map((s) => [s.path, s.method?.id ?? null, s.choice, s.stop]);
      assert.deepEqual(shape(lean), shape(full), `${problem.id} (${locale}) stages`);
      const values = (plan: typeof full) => (plan.costs?.lines ?? []).map((line) => [line.id, line.value, line.kind, line.source]);
      assert.deepEqual(values(lean), values(full), `${problem.id} (${locale}) costs`);
    }
  }
});

test("the lean graph drops prose and most of the size", () => {
  assert.ok(LEAN.en.nodes.every((n) => n.summary === "" && n.cost === null && n.takes === null && n.returns === null));
  const size = JSON.stringify(LEAN.en).length;
  assert.ok(size < 45_000, `lean graph is ${size} bytes`);
  assert.ok(size < JSON.stringify(FULL.en).length / 4);
});

test("a recognised prompt becomes the planner's reading, cost lines with their kind and source", () => {
  const context = contextForPrompt(LEAN_INDEX.en, "Factor a 2048-bit RSA modulus.", "en", { "shor-order-finding-15": "Shor finds the order of 7 mod 15" });
  assert.ok(context);
  assert.equal(context.problem, "factoring");
  const bits = context.params.find((p) => p.key === "bits");
  assert.deepEqual(bits && [bits.value, bits.origin, bits.evidence], [2048, "text", "2048-bit"]);
  const qubits = context.costs.find((c) => c.id === "ge2021-qubits");
  assert.ok(qubits);
  assert.equal(qubits.kind, "leading-order");
  assert.equal(qubits.source, "arxiv:1905.09749, abstract");
  assert.equal(context.costs[0].id, "ge2021-qubits", "the logical summary leads");
  assert.deepEqual(context.small_instance, { id: "shor-order-finding-15", title: "Shor finds the order of 7 mod 15" });
  assert.equal(context.planner_path, `/repository/plan#q=${encodeURIComponent("Factor a 2048-bit RSA modulus.")}`);
});

test("a prompt the planner does not recognise, or one too short to be a problem, sends nothing", () => {
  assert.equal(contextForPrompt(LEAN_INDEX.en, "Make me a Bell pair and measure it.", "en"), null);
  assert.equal(contextForPrompt(LEAN_INDEX.en, "grover", "en"), null);
});

function assertWithinBounds(context: WorkflowContext) {
  assert.ok(context.reading.length <= CONTEXT_LIMITS.reading && context.reading.every((r) => r.length <= 120));
  assert.ok(context.params.length <= CONTEXT_LIMITS.params);
  assert.ok(context.params.every((p) => p.label.length <= 120 && (p.evidence ?? "").length <= 200 && /^[A-Za-z]+$/.test(p.key)));
  assert.ok(context.stages.length <= CONTEXT_LIMITS.stages && context.stages.every((s) => s.depth <= 6 && s.capability.length <= 200));
  assert.ok(context.costs.length <= CONTEXT_LIMITS.costs);
  assert.ok(context.costs.every((c) => c.id.length <= 80 && c.label.length <= 200 && c.formula.length <= 200 && c.unit.length <= 80));
  assert.ok(context.costs.every((c) => c.value === null || Number.isFinite(c.value)));
  assert.ok(context.suggestions.length <= CONTEXT_LIMITS.suggestions && context.suggestions.every((s) => s.body.length <= 800));
  assert.ok(context.planner_path.startsWith("/repository/plan") && context.planner_path.length <= CONTEXT_LIMITS.plannerPath);
  assert.match(context.problem, /^[a-z-]+$/);
}

test("every problem's context stays inside the API's bounds, and a long Japanese prompt does too", () => {
  for (const locale of ["en", "ja"] as const) {
    for (const problem of PROBLEMS) {
      const sentence = locale === "ja" ? problem.example.ja : problem.example.en;
      const context = contextForPrompt(LEAN_INDEX[locale], sentence, locale);
      assert.ok(context, `${problem.id} (${locale}) example is recognised`);
      assertWithinBounds(context);
    }
  }
  // 2000 characters of Japanese percent-encode to about 18 KB, past the path
  // cap: the path falls back to the bare planner rather than failing the run.
  const long = `${FIXTURE_PROMPTS.ja}${"とても大きな分子です。".repeat(200)}`;
  const context = contextForPrompt(LEAN_INDEX.ja, long, "ja");
  assert.ok(context);
  assertWithinBounds(context);
  assert.equal(context.planner_path, "/repository/plan");
});

test("the committed wire fixture is what this code produces today", () => {
  const produced = {
    en: contextForPrompt(LEAN_INDEX.en, FIXTURE_PROMPTS.en, "en", { "shor-order-finding-15": "Shor finds the order of 7 mod 15" }),
    ja: contextForPrompt(LEAN_INDEX.ja, FIXTURE_PROMPTS.ja, "ja"),
  };
  const committed = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  assert.deepEqual(
    committed,
    JSON.parse(JSON.stringify(produced)),
    "regenerate from the repo root with: node --experimental-strip-types scripts/write-workflow-context-fixture.ts",
  );
});
