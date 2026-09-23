/**
 * The workflow planner: a sentence to a costed pipeline of Atlas blocks.
 *
 * Three kinds of assertion, and the third is the one that matters:
 *
 * 1. Wiring — every capability, method, worked example and paper the planner
 *    names exists, so a rename elsewhere fails here and not on the page.
 * 2. Reading — each problem's own example sentence, in both languages, reads
 *    back as that problem with the numbers it states.
 * 3. Arithmetic against the SOURCE — where a paper prints a number of its own
 *    (Boyer et al.'s 804 iterations for N = 2^20, Costa et al.'s 834κ), the
 *    formula here must reproduce it. A test that only re-evaluated the
 *    formula this module wrote would pass on a transcription error.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { WORKED_EXAMPLES } from "./worked-examples.ts";
import { blockTemplate } from "./circuit-blocks.ts";
import { planWorkflow } from "./workflow-planner/index.ts";
import { PROBLEMS, problemById } from "./workflow-planner/problems.ts";
import { PLANNER_SOURCES, plannerPaperIds, type SourceKey } from "./workflow-planner/sources.ts";
import { indexPlannerGraph, slimLayerGraph } from "./workflow-planner/graph.ts";
import { assembleWorkflow, flattenStages, MAX_STAGE_DEPTH } from "./workflow-planner/assemble.ts";
import { parseNumber, readParams, recogniseProblem } from "./workflow-planner/recognise.ts";
import {
  amplitudeEstimationEvaluations,
  chebyshevSamples,
  costReport,
  formatPlain,
  GIDNEY_2025_TABLE_5,
} from "./workflow-planner/costs.ts";
import type { CostLine, ParamValues, ProblemId } from "./workflow-planner/types.ts";

const GRAPH_EN = indexPlannerGraph(slimLayerGraph(LAYER_GRAPH, "en"));
const GRAPH_JA = indexPlannerGraph(slimLayerGraph(LAYER_GRAPH, "ja"));

function plan(text: string, overrides: Parameters<typeof planWorkflow>[2] = {}) {
  return planWorkflow(GRAPH_EN, text, overrides);
}

function lineById(lines: readonly CostLine[], id: string): CostLine {
  const found = lines.find((line) => line.id === id);
  assert.ok(found, `no cost line ${id}; have ${lines.map((l) => l.id).join(", ")}`);
  return found;
}

function params(values: Partial<Record<string, number>>): ParamValues {
  const out: ParamValues = {};
  for (const [key, value] of Object.entries(values)) {
    out[key as keyof ParamValues] = { key: key as never, value: value ?? null, origin: "reader" };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Wiring

test("every problem starts on a real capability, and its named methods realise it", () => {
  for (const problem of PROBLEMS) {
    const capability = GRAPH_EN.byId.get(problem.capability);
    assert.equal(capability?.kind, "capability", `${problem.id}: ${problem.capability}`);
    const realisers = (GRAPH_EN.realisers.get(problem.capability) ?? []).map((node) => node.id);
    assert.ok(realisers.length > 0, `${problem.id}: nothing realises ${problem.capability}`);
    for (const method of problem.preferredMethods) {
      assert.ok(realisers.includes(method), `${problem.id}: ${method} does not realise ${problem.capability}`);
    }
    for (const [capabilityId, { method }] of Object.entries(problem.stepDefaults ?? {})) {
      const ids = (GRAPH_EN.realisers.get(capabilityId) ?? []).map((node) => node.id);
      assert.ok(ids.includes(method), `${problem.id}: step default ${method} does not realise ${capabilityId}`);
    }
  }
});

test("every worked example a problem points to exists, and its blocks are real Studio blocks", () => {
  const ids = new Set(WORKED_EXAMPLES.map((example) => example.id));
  for (const problem of PROBLEMS) {
    if (problem.workedExample === null) continue;
    assert.ok(ids.has(problem.workedExample), `${problem.id}: ${problem.workedExample}`);
    const example = WORKED_EXAMPLES.find((e) => e.id === problem.workedExample)!;
    for (const key of example.blocks) assert.ok(blockTemplate(key), `${problem.workedExample}: block ${key}`);
  }
});

test("every source is a registered paper, and every source is cited by some cost line or assumption", () => {
  const registered = new Set(PAPER_REGISTER.papers.map((paper) => paper.id));
  for (const id of plannerPaperIds()) assert.ok(registered.has(id), `not in the paper register: ${id}`);
  const code = ["costs.ts", "problems.ts"]
    .map((file) => readFileSync(new URL(`./workflow-planner/${file}`, import.meta.url), "utf8"))
    .join("\n");
  for (const key of Object.keys(PLANNER_SOURCES) as SourceKey[]) {
    assert.ok(code.includes(`"${key}"`), `source ${key} is declared but nothing cites it`);
  }
});

// ---------------------------------------------------------------------------
// 2. Reading

test("numbers read the way people write them", () => {
  assert.equal(parseNumber("1,000,000"), 1e6);
  assert.equal(parseNumber("1e-3"), 0.001);
  assert.equal(parseNumber("2^30"), 2 ** 30);
  assert.equal(parseNumber("10^-9"), 1e-9);
  assert.ok(Math.abs((parseNumber("1.6 × 10^-3") ?? 0) - 0.0016) < 1e-15);
  assert.equal(parseNumber("one million"), 1e6);
  assert.equal(parseNumber("100 万"), 1e6);
  assert.equal(parseNumber("3 billion"), 3e9);
  assert.equal(parseNumber("banana"), null);
});

test("each problem's own example sentence reads back as that problem, in both languages", () => {
  for (const problem of PROBLEMS) {
    for (const locale of ["en", "ja"] as const) {
      const found = recogniseProblem(problem.example[locale]);
      assert.equal(found?.problem, problem.id, `${problem.id} (${locale}): "${problem.example[locale]}" read as ${found?.problem}`);
    }
  }
});

test("the example sentences carry their numbers into the parameters, with the words they came from", () => {
  const cases: [ProblemId, "en" | "ja", Record<string, number>][] = [
    ["search", "en", { domainSize: 1e6, markedCount: 1 }],
    ["search", "ja", { domainSize: 1e6, markedCount: 1 }],
    ["factoring", "en", { bits: 2048 }],
    ["factoring", "ja", { bits: 2048 }],
    ["ecdlp", "en", { bits: 256 }],
    ["ground-state", "en", { lambda: 500, deltaE: 0.0016, orbitals: 100 }],
    ["ground-state", "ja", { lambda: 500, deltaE: 0.0016, orbitals: 100 }],
    ["hamiltonian-simulation", "en", { time: 100 }],
    ["linear-system", "en", { kappa: 1000, epsilon: 0.001, dimension: 2 ** 30 }],
    ["linear-system", "ja", { kappa: 1000, epsilon: 0.001, dimension: 2 ** 30 }],
    ["maxcut", "en", { nodes: 50, edges: 75, layers: 3 }],
    ["maxcut", "ja", { nodes: 50, edges: 75, layers: 3 }],
    ["amplitude-estimation", "en", { epsilon: 0.001 }],
    ["amplitude-estimation", "ja", { epsilon: 0.001 }],
    ["phase-estimation", "en", { precisionBits: 10 }],
  ];
  for (const [id, locale, expected] of cases) {
    const problem = problemById(id)!;
    const read = readParams(problem, problem.example[locale]);
    for (const [key, value] of Object.entries(expected)) {
      const got = read[key as keyof ParamValues];
      assert.ok(got?.value !== null && got !== undefined, `${id} ${locale}: ${key} not read`);
      assert.ok(Math.abs((got.value ?? 0) - value) <= 1e-9 * Math.max(1, value), `${id} ${locale}: ${key} = ${got.value}, want ${value}`);
      if (got.origin === "text") assert.ok(got.evidence && got.evidence.length > 0, `${id} ${locale}: ${key} has no evidence`);
    }
  }
});

test("a value the sentence does not state is an assumption with a reason, or empty — never silent", () => {
  const factoring = readParams(problemById("factoring")!, "Break RSA with Shor's algorithm.");
  assert.equal(factoring.bits?.origin, "assumed");
  assert.equal(factoring.bits?.value, 2048);
  assert.ok(factoring.bits?.assumedReason?.en);
  const linear = readParams(problemById("linear-system")!, "Solve a linear system of equations.");
  assert.equal(linear.kappa?.origin, "unset");
  assert.equal(linear.kappa?.value, null);
});

test("an out-of-range reading is discarded, not clamped", () => {
  // "2048-bit keys" would name a domain of 2^2048, far past what the spec allows.
  const read = readParams(problemById("search")!, "Brute-force search over 2048-bit keys.");
  assert.equal(read.domainSize?.origin, "unset");
});

test("a sentence with no keyword recognises as nothing, and the plan says so rather than guessing", () => {
  const result = plan("Make my code faster please.");
  assert.equal(result.problem, null);
  assert.equal(result.root, null);
  assert.equal(result.costs, null);
});

test("the reader can override the problem and any parameter", () => {
  const result = plan("Factor a 2048-bit RSA modulus.", { problem: "ecdlp", params: { bits: 384 } });
  assert.equal(result.problem?.id, "ecdlp");
  assert.equal(result.problemPicked, true);
  assert.equal(result.params.bits?.origin, "reader");
  assert.equal(result.params.bits?.value, 384);
});

// ---------------------------------------------------------------------------
// The walk down the graph

test("every stage's method realises its capability, paths are unique, and the walk is bounded", () => {
  for (const problem of PROBLEMS) {
    for (const graph of [GRAPH_EN, GRAPH_JA]) {
      const stages = flattenStages(assembleWorkflow(graph, problem));
      assert.ok(stages.length > 0, problem.id);
      const paths = new Set<string>();
      for (const stage of stages) {
        assert.ok(!paths.has(stage.path), `${problem.id}: duplicate path ${stage.path}`);
        paths.add(stage.path);
        assert.ok(stage.depth <= MAX_STAGE_DEPTH + 1, `${problem.id}: ${stage.path} deeper than the cap`);
        if (stage.method) assert.equal(stage.method.realizes, stage.capability.id, stage.path);
        if (stage.stop === "cycle") assert.equal(stage.method, null, `${stage.path}: a cycle stop is not expanded`);
      }
    }
  }
});

test("a step the parent's source names is taken as published, and the reader can swap any block", () => {
  const linear = problemById("linear-system")!;
  const root = assembleWorkflow(GRAPH_EN, linear);
  assert.equal(root?.method?.id, "discrete-adiabatic-inversion");
  const matrixFunction = root?.children.find((child) => child.capability.id === "matrix-function");
  assert.equal(matrixFunction?.method?.id, "lcu-chebyshev-transform", "the route's own `via`");
  assert.equal(matrixFunction?.choice, "published");
  const swapped = assembleWorkflow(GRAPH_EN, linear, { [matrixFunction!.path]: "qsvt-transform" });
  const after = swapped?.children.find((child) => child.capability.id === "matrix-function");
  assert.equal(after?.method?.id, "qsvt-transform");
  assert.equal(after?.choice, "reader");
});

test("a variational root starts compilation on NISQ transpilation, everything else on fault-tolerant", () => {
  const vqe = plan("Estimate a molecule's ground state energy with VQE.", {
    choices: { "ground-state-energy": "variational-ground-state" },
  });
  assert.equal(vqe.compile?.method?.id, "nisq-transpilation");
  const shor = plan("Factor a 2048-bit RSA modulus.");
  assert.equal(shor.compile?.method?.id, "fault-tolerant-compilation");
});

// ---------------------------------------------------------------------------
// 3. Arithmetic against the source

test("Grover: N = 2^20 with one marked item takes 804 iterations — Boyer et al.'s own worked number", () => {
  const report = costReport("search", params({ domainSize: 2 ** 20, markedCount: 1 }), assembleWorkflow(GRAPH_EN, problemById("search")!));
  assert.equal(lineById(report.lines, "grover-iterations").value, 804);
  const success = lineById(report.lines, "grover-success").value ?? 0;
  assert.ok(success >= 1 - 2 ** -20, `success ${success} must be at least 1 − M/N`);
  assert.equal(lineById(report.classical, "classical-search").value, 2 ** 20);
  assert.ok(report.suggestions.some((s) => s.id === "quadratic-caution"));
});

test("Gidney–Ekerå at 2048 bits: about 3n logical qubits and ~2.6 billion Toffolis, matching the 2025 paper's summary of it", () => {
  const report = costReport("factoring", params({ bits: 2048 }), assembleWorkflow(GRAPH_EN, problemById("factoring")!));
  assert.equal(lineById(report.lines, "ge2021-qubits").value, Math.ceil(3 * 2048 + 0.002 * 2048 * 11));
  const toffolis = lineById(report.lines, "ge2021-toffolis").value ?? 0;
  assert.equal(Math.round(toffolis), Math.round(2048 ** 3 * 0.3055));
  // Gidney 2025, Introduction: "[GE21] ... 3 billion Toffoli gates and a bit more than 3n logical qubits".
  assert.ok(toffolis > 2.5e9 && toffolis < 3.5e9);
  assert.equal(lineById(report.lines, "g2025-qubits").value, 1399);
  assert.equal(lineById(report.lines, "g2025-toffolis").value, 6.5e9);
  assert.equal(report.published.length, 2, "the headline machines are printed at 2048 bits only");
  const at3000 = costReport("factoring", params({ bits: 3000 }), assembleWorkflow(GRAPH_EN, problemById("factoring")!));
  assert.equal(at3000.lines.some((line) => line.id === "g2025-qubits"), false, "no interpolation between Table 5 rows");
  assert.equal(at3000.published.length, 0);
  assert.deepEqual(Object.keys(GIDNEY_2025_TABLE_5).map(Number), [1024, 1536, 2048, 3072, 4096, 6144, 8192]);
});

test("Roetteler et al. at 256 bits: 2330 qubits and 448·n³·8 + 4090·n³ Toffolis", () => {
  const report = costReport("ecdlp", params({ bits: 256 }), assembleWorkflow(GRAPH_EN, problemById("ecdlp")!));
  assert.equal(lineById(report.lines, "roetteler-qubits").value, 2330);
  assert.equal(lineById(report.lines, "roetteler-toffolis").value, 256 ** 3 * (448 * 8 + 4090));
});

test("Babbush et al.: 2^m sits between √2πλ/2ΔE and √2πλ/ΔE, as Eqs. (24) and (26) require", () => {
  const root = assembleWorkflow(GRAPH_EN, problemById("ground-state")!);
  for (const [lambda, dE] of [[500, 0.0016], [30, 0.001], [4000, 0.0016]]) {
    const report = costReport("ground-state", params({ lambda, deltaE: dE, orbitals: 100 }), root);
    const queries = lineById(report.lines, "babbush-queries").value ?? 0;
    const bound = (Math.SQRT2 * Math.PI * lambda) / dE;
    assert.ok(queries >= bound / 2 && queries < bound, `λ=${lambda}: ${queries} vs ${bound}`);
  }
});

test("Babbush et al.'s count is withdrawn when the simulation block is no longer qubitization", () => {
  const problem = problemById("ground-state")!;
  const root = assembleWorkflow(GRAPH_EN, problem);
  const simulation = flattenStages(root).find((stage) => stage.capability.id === "hamiltonian-simulation");
  assert.equal(simulation?.method?.id, "qubitization-simulation", "the step default");
  assert.equal(simulation?.choice, "preferred");
  const swapped = assembleWorkflow(GRAPH_EN, problem, { [simulation!.path]: "product-formula-simulation" });
  const report = costReport("ground-state", params({ lambda: 500, deltaE: 0.0016, orbitals: 100 }), swapped);
  assert.equal(report.lines.length, 0);
  assert.ok(report.notes.length > 0, "the page says why the numbers went away");
});

test("VQE's measurement count is (λ/ΔE)², Wecker et al. Eq. (15)", () => {
  const root = assembleWorkflow(GRAPH_EN, problemById("ground-state")!, { "ground-state-energy": "variational-ground-state" });
  const report = costReport("ground-state", params({ lambda: 500, deltaE: 0.0016, orbitals: 100 }), root);
  assert.ok(Math.abs((lineById(report.lines, "wecker-measurements").value ?? 0) - (500 / 0.0016) ** 2) < 1);
});

test("amplitude estimation: the smallest M satisfying Theorem 12's worst case, and Chebyshev's K at the same confidence", () => {
  for (const eps of [0.1, 0.01, 0.001, 1e-5]) {
    const M = amplitudeEstimationEvaluations(eps);
    assert.ok(Math.PI / M + Math.PI ** 2 / M ** 2 <= eps, `M=${M} misses ε=${eps}`);
    assert.ok(Math.PI / (M - 1) + Math.PI ** 2 / (M - 1) ** 2 > eps, `M=${M} is not the smallest for ε=${eps}`);
    const K = chebyshevSamples(eps);
    assert.ok(1 / (4 * K * eps ** 2) <= 1 - 8 / Math.PI ** 2);
    assert.ok(1 / (4 * (K - 1) * eps ** 2) > 1 - 8 / Math.PI ** 2);
  }
});

test("phase estimation: Cleve et al.'s register for 10 bits at ε = 0.01 is 16 qubits", () => {
  const report = costReport("phase-estimation", params({ precisionBits: 10, failureProbability: 0.01 }), assembleWorkflow(GRAPH_EN, problemById("phase-estimation")!));
  assert.equal(lineById(report.lines, "cemm-register").value, 10 + Math.ceil(Math.log2(50.5)));
  assert.equal(lineById(report.lines, "cemm-register").value, 16);
});

test("QAOA on a 3-regular 50-node graph at p = 3: 225 two-qubit phases", () => {
  const result = plan("MaxCut on a 3-regular graph with 50 nodes using QAOA with p = 3.");
  assert.equal(lineById(result.costs!.lines, "qaoa-two-qubit").value, 225);
  assert.equal(lineById(result.costs!.lines, "qaoa-mixer").value, 200);
});

test("Costa et al.: 834κ adiabatic steps, and ln(2/ε) ≈ 20 at ε = 10⁻⁹ as the paper says", () => {
  const root = assembleWorkflow(GRAPH_EN, problemById("linear-system")!);
  const report = costReport("linear-system", params({ kappa: 1000, epsilon: 1e-9 }), root);
  assert.equal(lineById(report.lines, "costa-steps").value, 834000);
  const filter = lineById(report.lines, "costa-filter").value ?? 0;
  assert.ok(filter > 19.5 && filter < 22, `ln(2/ε) = ${filter}`);
});

test("a line missing a parameter has no value and names what it needs", () => {
  const report = costReport("linear-system", {}, assembleWorkflow(GRAPH_EN, problemById("linear-system")!));
  const steps = lineById(report.lines, "costa-steps");
  assert.equal(steps.value, null);
  assert.deepEqual(steps.missing, ["kappa"]);
});

test("a scaling line never enters the logical summary, and every sourced line names a registered paper", () => {
  for (const problem of PROBLEMS) {
    const result = plan(problem.example.en);
    const report = result.costs!;
    for (const entry of Object.values(report.logical)) {
      if (entry) assert.notEqual(entry.kind, "scaling", `${problem.id}: ${entry.id}`);
    }
    for (const line of [...report.lines, ...report.classical, ...report.published]) {
      if (line.source) assert.ok(PLANNER_SOURCES[line.source], `${problem.id}: ${line.id}`);
      if (line.kind === "published" || line.kind === "leading-order" || line.kind === "upper-bound" || line.kind === "numerical-estimate") {
        assert.ok(line.source, `${problem.id}: ${line.id} is a ${line.kind} with no source`);
      }
    }
  }
});

test("numbers print the same in a sentence and in the table", () => {
  assert.equal(formatPlain(1048576), "1,048,576");
  assert.equal(formatPlain(2624224898), "2.62 × 10⁹");
  assert.equal(formatPlain(0.0016), "0.0016");
  assert.equal(formatPlain(1e-9), "1 × 10⁻⁹");
  assert.equal(formatPlain(6.5e9), "6.5 × 10⁹");
});
