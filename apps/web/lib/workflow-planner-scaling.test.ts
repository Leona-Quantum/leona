/**
 * The planner's scaling curves and the physical estimate they feed.
 *
 * A curve is the single-point cost model called at several sizes, so the
 * load-bearing assertions are (1) each point equals `costReport` at that size,
 * (2) a figure a paper tabulates only at some sizes appears at exactly those
 * sizes and nowhere between, and (3) what is sent to the estimator is the
 * logical cost and never a zero standing in for an unstated count.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { planWorkflow } from "./workflow-planner/index.ts";
import { indexPlannerGraph, slimLayerGraph } from "./workflow-planner/graph.ts";
import { costReport, GIDNEY_2025_TABLE_5 } from "./workflow-planner/costs.ts";
import { problemById } from "./workflow-planner/problems.ts";
import {
  MAX_GATE_COUNT,
  physicalRequestPoints,
  scalingSeries,
  sweepableParams,
  sweepValues,
  type Scaling,
} from "./workflow-planner/scaling.ts";
import { fetchPhysicalEstimate, parsePhysicalEstimate } from "./workflow-planner/physical.ts";
import type { ParamSpec, ParamValues } from "./workflow-planner/types.ts";

const GRAPH = indexPlannerGraph(slimLayerGraph(LAYER_GRAPH, "en"));
const FIXTURE: unknown = JSON.parse(readFileSync(new URL("./workflow-planner/physical-fixture.json", import.meta.url), "utf8"));

function plan(text: string) {
  const result = planWorkflow(GRAPH, text);
  assert.ok(result.problem, `"${text}" should read as a problem`);
  return result;
}

function withValue(params: ParamValues, key: keyof ParamValues, value: number): ParamValues {
  return { ...params, [key]: { key, value, origin: "reader" } };
}

const BITS: ParamSpec = problemById("factoring")!.params.find((p) => p.key === "bits")!;

test("an integer parameter steps by powers of two and keeps the reader's own value", () => {
  assert.deepEqual(sweepValues(BITS, 2048), [128, 256, 512, 1024, 2048, 4096, 8192, 16384]);
  // A value that is not a power of two is kept, between its neighbours.
  const around = sweepValues(BITS, 3072);
  assert.ok(around.includes(3072));
  assert.deepEqual(around, [...around].sort((a, b) => a - b));
  assert.equal(new Set(around).size, around.length);
  // Clipped to the parameter's range: nothing under `min`.
  assert.ok(sweepValues(BITS, 16).every((v) => v >= BITS.min));
});

test("a real-valued parameter steps geometrically to three figures, within range", () => {
  const spec: ParamSpec = { key: "epsilon", label: { en: "", ja: "" }, hint: { en: "", ja: "" }, min: 1e-15, max: 0.5, integer: false };
  const values = sweepValues(spec, 1e-3);
  assert.ok(values.includes(1e-3));
  assert.ok(values.length >= 8);
  assert.ok(values.every((v) => v >= spec.min && v <= spec.max && Number(v.toPrecision(3)) === v));
  assert.ok(values.at(-1)! <= 1.6e-2 + 1e-12 && values[0] >= 6.25e-5 - 1e-12);
});

test("every point on a curve is the single-point cost model at that size", () => {
  const p = plan("Factor a 2048-bit RSA modulus.");
  const scaling = scalingSeries("factoring", p.params, p.root, "bits");
  assert.ok(scaling);
  assert.equal(scaling.xs[scaling.current], 2048);
  const keys = scaling.series.map((s) => s.key);
  assert.deepEqual(keys, ["logicalQubits", "toffolis", "serialDepth"]);
  for (const series of scaling.series) {
    series.points.forEach((point) => {
      const direct = costReport("factoring", withValue(p.params, "bits", point.x), p.root).logical[series.key];
      assert.equal(point.y, direct?.value ?? null, `${series.key} at ${point.x}`);
      assert.equal(point.kind, direct?.kind ?? null);
      assert.equal(point.source, direct?.source ?? null);
    });
  }
});

test("a tabulated figure appears at the sizes its table states and nowhere between", () => {
  const p = plan("Factor a 2048-bit RSA modulus.");
  const scaling = scalingSeries("factoring", p.params, p.root, "bits")!;
  const qubitMarks = scaling.published.filter((m) => m.id === "g2025-qubits");
  const tabulated = Object.keys(GIDNEY_2025_TABLE_5).map(Number);
  assert.deepEqual(
    qubitMarks.map((m) => m.x),
    scaling.xs.filter((x) => tabulated.includes(x)),
  );
  for (const mark of qubitMarks) assert.equal(mark.y, GIDNEY_2025_TABLE_5[mark.x][1]);
  // 128…512 and 16384 are on the curve and not in Table 5: no mark there.
  for (const x of [128, 256, 512, 16384]) assert.ok(!qubitMarks.some((m) => m.x === x));
});

test("only a parameter that moves a logical figure is offered as an axis", () => {
  const factoring = plan("Factor a 2048-bit RSA modulus.");
  assert.deepEqual(sweepableParams("factoring", factoring.params, factoring.root), ["bits"]);
  const solve = plan("Solve a sparse linear system with condition number 1000 to precision 1e-6.");
  const axes = sweepableParams(solve.problem!.id, solve.params, solve.root);
  assert.ok(axes.includes("kappa"), `axes: ${axes.join(", ")}`);
  for (const key of axes) {
    const value = solve.params[key]!.value!;
    const moved = costReport(solve.problem!.id, withValue(solve.params, key, value * 2), solve.root).logical;
    const base = costReport(solve.problem!.id, solve.params, solve.root).logical;
    assert.notDeepEqual(
      [moved.logicalQubits?.value, moved.toffolis?.value, moved.tGates?.value, moved.queries?.value],
      [base.logicalQubits?.value, base.toffolis?.value, base.tGates?.value, base.queries?.value],
      `${key} was offered but moves nothing`,
    );
  }
});

test("the estimator is sent logical counts with the serial depth, never a zero for an unstated count", () => {
  const p = plan("Factor a 2048-bit RSA modulus.");
  const scaling = scalingSeries("factoring", p.params, p.root, "bits")!;
  const body = physicalRequestPoints(scaling, (x) => `bits = ${x}`);
  assert.equal(body.length, scaling.xs.length);
  const at2048 = body.find((b) => b.parameter_value === 2048)!;
  const direct = costReport("factoring", p.params, p.root).logical;
  assert.equal(at2048.logical_qubits, direct.logicalQubits!.value);
  assert.equal(at2048.toffoli_count, Math.round(direct.toffolis!.value!));
  assert.equal(at2048.non_clifford_depth, Math.round(direct.serialDepth!.value!));
  assert.equal(at2048.t_count, 0);
  assert.ok(body.every((b) => Number.isInteger(b.logical_qubits) && Number.isInteger(b.toffoli_count)));

  // A curve with queries but no gate count sends nothing at all.
  const queriesOnly: Scaling = {
    param: "domainSize",
    xs: [16, 32],
    current: 0,
    published: [],
    series: [
      { key: "logicalQubits", points: [16, 32].map((x) => ({ x, y: 4, kind: "exact", source: null, label: null })) },
      { key: "queries", points: [16, 32].map((x) => ({ x, y: x, kind: "exact", source: null, label: null })) },
    ],
  };
  assert.deepEqual(physicalRequestPoints(queriesOnly, String), []);

  // A point past the route's bounds is left out, not sent to be refused whole.
  const huge: Scaling = {
    ...queriesOnly,
    series: [
      queriesOnly.series[0],
      { key: "toffolis", points: [{ x: 16, y: 10, kind: "exact", source: null, label: null }, { x: 32, y: MAX_GATE_COUNT * 10, kind: "exact", source: null, label: null }] },
    ],
  };
  assert.deepEqual(physicalRequestPoints(huge, String).map((b) => b.parameter_value), [16]);
});

test("the route's real response parses, costed and refused points alike", () => {
  const parsed = parsePhysicalEstimate(FIXTURE);
  assert.ok(parsed);
  assert.equal(parsed.assumptionSet, "gidney-2025@v2");
  const [rsa, noDepth, queries] = parsed.points;
  assert.equal(rsa.fastest?.bindingTerm, "reaction");
  assert.ok(rsa.smallest && rsa.fastest && rsa.smallest.totalPhysicalQubits < rsa.fastest.totalPhysicalQubits);
  assert.ok(rsa.frontier.length > 0 && rsa.frontier.every((f) => f.assumptionSet in parsed.citations));
  assert.equal(noDepth.fastest?.factoryCount, 1);
  assert.equal(noDepth.fastest?.bindingTerm, "throughput");
  assert.equal(noDepth.smallest, null);
  assert.equal(queries.fastest, null);
  assert.match(queries.refused ?? "", /Toffoli or T/);
});

test("a payload that does not match is refused whole, not half-rendered", () => {
  const base = JSON.parse(JSON.stringify(FIXTURE)) as { points: Record<string, unknown>[]; citations: Record<string, string> };
  const cases: [string, (p: typeof base) => void][] = [
    ["no footprint", (p) => delete (p.points[0].fastest as Record<string, unknown>).footprint],
    ["neither refused nor costed", (p) => {
      p.points[2].refused = null;
    }],
    ["unknown binding term", (p) => {
      ((p.points[0].fastest as Record<string, Record<string, unknown>>).runtime).binding_term = "magic";
    }],
    ["frontier names an uncited set", (p) => {
      p.citations = {};
    }],
    ["frontier set named like a prototype key", (p) => {
      p.citations = {};
      (p.points[0].frontier as Record<string, unknown>[])[0].assumption_set = "constructor";
    }],
  ];
  for (const [name, mutate] of cases) {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    assert.equal(parsePhysicalEstimate(copy), null, name);
  }
});

test("the fetch names a lapsed session instead of failing as a network error", async () => {
  const redirect = async () => ({ type: "opaqueredirect", status: 0, ok: false }) as unknown as Response;
  assert.deepEqual(await fetchPhysicalEstimate([], "gidney-2025@v2", redirect as typeof fetch), { status: "signed-out" });
  const broken = async () => ({ type: "basic", status: 502, ok: false }) as unknown as Response;
  assert.deepEqual(await fetchPhysicalEstimate([], "gidney-2025@v2", broken as typeof fetch), { status: "error", httpStatus: 502 });
  const ok = async () => ({ type: "basic", status: 200, ok: true, json: async () => FIXTURE }) as unknown as Response;
  const outcome = await fetchPhysicalEstimate([], "gidney-2025@v2", ok as typeof fetch);
  assert.equal(outcome.status, "ok");
});
