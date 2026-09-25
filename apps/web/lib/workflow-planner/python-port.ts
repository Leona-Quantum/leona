// What the Python port of the planner reads, and what it is held to.
//
// Owner ruling, ai-ops 382 (2026-09-25): "Port only the arithmetic to Python now.
// CI runs both on a grid of inputs and fails if any number differs. Each new
// formula must be written twice, but CI catches any drift." The connector's
// `plan_workflow` tool needs the planner behind `POST /v1/plans`, and the page
// needs it here, on every keystroke, so there are two implementations of the
// ARITHMETIC. Everything that is not arithmetic is written once, here, and handed
// to Python as data:
//
// - `plannerPortData()` — the problems and their parameter specs, the slimmed
//   layer graph assembly walks (both languages), the fixed text of every cost
//   line and note, the sources with their papers, and Gidney 2025's Table 5.
//   The Python package loads it from `leona_planner/planner_data.json`.
// - `plannerParityGrid()` — a deterministic set of inputs across every problem,
//   every choice the default pipeline offers and several sizes, with what THIS
//   code answers for each. `packages/py/planner/tests/test_planner_parity.py` runs the
//   Python port on every point and fails on any difference.
// - `plannerToolCatalog()` — the problems, parameters and choices the MCP
//   `plan_workflow` tool describes to the calling model, so its description is
//   generated rather than written by hand. It ships inside `leona_mcp`, which
//   is installed standalone and never imports the planner.
//
// `scripts/write-planner-fixture.ts` writes all three, and
// `../workflow-planner-python-port.test.ts` fails when a committed copy is not
// what this module produces today.
//
// Nothing here computes a cost. Every number in the grid comes from
// `planWorkflow`, `costReport` and `physicalRequestPoints` as the page calls
// them; this module only chooses inputs and copies outputs.
import type { LayerGraph } from "../repository/layers.ts";
import type { PaperRegister } from "../repository/papers.ts";
import { COMPILE_CAPABILITY, MAX_STAGE_DEPTH, compilesWithoutErrorCorrection, flattenStages, type MethodChoices, type Stage } from "./assemble.ts";
import { COST_NOTES, GIDNEY_2025_TABLE_5 } from "./costs.ts";
import { indexPlannerGraph, slimLayerGraph, type IndexedGraph, type PlannerGraph, type PlannerNode } from "./graph.ts";
import { planWorkflow } from "./index.ts";
import { leanPlannerGraph } from "./lean.ts";
import { PROBLEMS, type ProblemClass } from "./problems.ts";
import { readParams } from "./recognise.ts";
import { physicalRequestPoints, scalingSeries } from "./scaling.ts";
import { PLANNER_SOURCES } from "./sources.ts";
import type { Bilingual, CostLine, LogicalSummary, ParamKey, ParamSpec, ProblemId } from "./types.ts";

/** Bumped when the SHAPE of the data file changes, so the Python loader can refuse a file it does not understand. */
export const PLANNER_PORT_FORMAT = 1;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ---------------------------------------------------------------------------
// The graph, once, in both languages

interface PortNode {
  id: string;
  kind: "capability" | "method";
  label: Bilingual;
  short_label: Bilingual | null;
  realizes: string | null;
  steps: string[];
  via: Record<string, string>;
  repeats: Record<string, { mark: Bilingual; count: Bilingual }>;
  /** Method only: the cost its primary source states, `$…$` math intact. Shown on a stage whose block has no numeric model. */
  cost: Bilingual | null;
}

function both(en: string | null, ja: string | null): Bilingual | null {
  return en === null && ja === null ? null : { en: en ?? "", ja: ja ?? en ?? "" };
}

/**
 * The nodes a walk from any problem can reach (`leanPlannerGraph`), with the
 * labels and stated cost in both languages. The structure is taken from the
 * English graph and REQUIRED to be identical in the Japanese one: the port
 * assembles once for both languages, which is only right if nothing but the
 * words differs.
 */
function portGraph(graph: LayerGraph): PortNode[] {
  const en = slimLayerGraph(graph, "en");
  const ja = slimLayerGraph(graph, "ja");
  const keep = new Set(leanPlannerGraph(en).nodes.map((node) => node.id));
  const jaById = new Map(ja.nodes.map((node) => [node.id, node]));
  const out: PortNode[] = [];
  for (const node of en.nodes) {
    if (!keep.has(node.id)) continue;
    const other = jaById.get(node.id);
    if (!other) throw new Error(`${node.id} is in the English planner graph and not the Japanese one`);
    const structure = (n: PlannerNode) => JSON.stringify([n.kind, n.realizes, n.steps, n.via, Object.keys(n.repeats)]);
    if (structure(node) !== structure(other)) throw new Error(`${node.id} has a different route in Japanese than in English`);
    const repeats: PortNode["repeats"] = {};
    for (const [step, repeat] of Object.entries(node.repeats)) {
      repeats[step] = { mark: { en: repeat.mark, ja: other.repeats[step].mark }, count: { en: repeat.count, ja: other.repeats[step].count } };
    }
    out.push({
      id: node.id,
      kind: node.kind,
      label: { en: node.label, ja: other.label },
      short_label: both(node.shortLabel, other.shortLabel),
      realizes: node.realizes,
      steps: [...node.steps],
      via: { ...node.via },
      repeats,
      cost: node.kind === "method" ? both(node.cost, other.cost) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The grid

export interface GridPoint {
  /** Stable, human-readable, unique: what a failing parity assertion names. */
  id: string;
  problem: ProblemId;
  /** Values the caller typed, as `PlanOverrides.params` takes them. */
  params: Partial<Record<ParamKey, number | null>>;
  choices: Record<string, string>;
}

/** Values across a parameter's range: both ends, the geometric middle, and a value a reader would type. */
function spread(spec: ParamSpec): number[] {
  const out = new Set<number>([spec.min, spec.max]);
  const lo = Math.max(spec.min, spec.integer ? 1 : Number.MIN_VALUE);
  const mid = Math.sqrt(lo * spec.max);
  out.add(spec.integer ? Math.round(mid) : Number(mid.toPrecision(3)));
  if (spec.assumed) out.add(spec.assumed.value);
  return [...out].sort((a, b) => a - b);
}

/** Readers' values, per problem: what the example sentences and the tests use. */
const TYPICAL: Partial<Record<ProblemId, Partial<Record<ParamKey, number>>[]>> = {
  search: [
    { domainSize: 2 ** 20, markedCount: 1 },
    { domainSize: 1e6, markedCount: 3, oracleToffolis: 40 },
    { domainSize: 2, markedCount: 1 },
    { domainSize: 4, markedCount: 1 },
    { domainSize: 1000, markedCount: 750 },
    { domainSize: 1000, markedCount: 751 },
    { domainSize: 10, markedCount: 10 },
    { domainSize: 10, markedCount: 11, oracleToffolis: 0 },
    { domainSize: 1e30, markedCount: 1, oracleToffolis: 1e15 },
  ],
  factoring: [{ bits: 1024 }, { bits: 1536 }, { bits: 2048 }, { bits: 3072 }, { bits: 4096 }, { bits: 6144 }, { bits: 8192 }, { bits: 3000 }, { bits: 15 }],
  ecdlp: [{ bits: 256 }, { bits: 384 }, { bits: 521 }, { bits: 9 }],
  "ground-state": [
    { lambda: 500, deltaE: 0.0016, orbitals: 100 },
    { lambda: 1, deltaE: 1, orbitals: 2 },
    { lambda: 1e-6, deltaE: 10, orbitals: 4 },
    { lambda: 4000, deltaE: 0.0016, orbitals: 108 },
  ],
  "hamiltonian-simulation": [{ lambda: 100, time: 100, epsilon: 1e-3 }, { lambda: 1e12, time: 1e12 }],
  "linear-system": [
    { kappa: 1000, epsilon: 1e-9 },
    { kappa: 1000, epsilon: 1e-3, dimension: 2 ** 30, stepToffolis: 5000 },
    { kappa: 1, epsilon: 0.5, stepToffolis: 0 },
  ],
  maxcut: [{ nodes: 50, edges: 75, layers: 3 }, { nodes: 4, edges: 4, layers: 1 }, { nodes: 1e6, edges: 1e12, layers: 1000 }],
  "amplitude-estimation": [{ epsilon: 1e-3 }, { epsilon: 0.01 }, { epsilon: 1e-12 }, { epsilon: 0.5 }, { epsilon: 0.3 }],
  "phase-estimation": [{ precisionBits: 10, failureProbability: 0.01 }, { precisionBits: 1, failureProbability: 0.5 }, { precisionBits: 64, failureProbability: 1e-15 }, { precisionBits: 3, failureProbability: 0.25 }],
};

/**
 * Parameter vectors for one problem: none typed (assumptions only); every
 * parameter at each point of its spread; each parameter cleared, and each set
 * out of its range or to a fraction where it counts something (both refused as
 * `invalid`); and the readers' values above.
 */
function sizesFor(problem: ProblemClass): { tag: string; params: GridPoint["params"] }[] {
  const out: { tag: string; params: GridPoint["params"] }[] = [{ tag: "typed-none", params: {} }];
  const spreads = problem.params.map((spec) => spread(spec));
  const depth = Math.max(0, ...spreads.map((values) => values.length));
  for (let level = 0; level < depth; level += 1) {
    const params: GridPoint["params"] = {};
    problem.params.forEach((spec, i) => {
      const values = spreads[i];
      params[spec.key] = values[Math.min(level, values.length - 1)];
    });
    out.push({ tag: `spread-${level}`, params });
  }
  const base = out[out.length - 1]?.params ?? {};
  for (const spec of problem.params) {
    out.push({ tag: `cleared-${spec.key}`, params: { ...base, [spec.key]: null } });
    out.push({ tag: `above-${spec.key}`, params: { ...base, [spec.key]: spec.max * 2 } });
    out.push({ tag: `below-${spec.key}`, params: { ...base, [spec.key]: spec.min - 1 } });
    if (spec.integer) out.push({ tag: `fraction-${spec.key}`, params: { ...base, [spec.key]: spec.min + 0.5 } });
  }
  (TYPICAL[problem.id] ?? []).forEach((params, i) => out.push({ tag: `typical-${i}`, params }));
  return out;
}

function stageKey(path: string, method: string): string {
  return `${path}=${method}`;
}

/**
 * Choice sets for one problem: none; every alternative at every position of the
 * default pipeline and its compile step; for each alternative at the root, every
 * alternative one level below it too; and three a caller can get wrong (a path
 * no stage has, a method that does not exist, and a method that realises a
 * different capability), which assembly must ignore rather than follow.
 */
function choicesFor(index: IndexedGraph, problem: ProblemClass): { tag: string; choices: MethodChoices; costs: boolean }[] {
  const out: { tag: string; choices: MethodChoices; costs: boolean }[] = [{ tag: "default", choices: {}, costs: true }];
  const seen = new Set<string>([""]);
  const add = (choices: MethodChoices, costs: boolean) => {
    const key = Object.entries(choices).map(([path, method]) => stageKey(path, method)).sort().join("&");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ tag: key, choices, costs });
  };
  const base = planWorkflow(index, "", { problem: problem.id });
  const positions = [...flattenStages(base.root), ...flattenStages(base.compile)];
  for (const stage of positions) {
    for (const alternative of stage.alternatives) {
      if (alternative.id === stage.method?.id) continue;
      // The root's alternatives decide which cost model applies, so they are
      // costed at every size; a change further down is assembled and costed once.
      add({ [stage.path]: alternative.id }, stage.depth === 0 && stage.path === problem.capability);
    }
  }
  for (const alternative of base.root?.alternatives ?? []) {
    const swapped = planWorkflow(index, "", { problem: problem.id, choices: { [problem.capability]: alternative.id } });
    for (const child of swapped.root?.children ?? []) {
      for (const deeper of child.alternatives) {
        if (deeper.id === child.method?.id) continue;
        // Below the root the only choice a cost model reads is the ground-state
        // problem's simulation block (`chosenMethodFor(root, "hamiltonian-simulation")`).
        add({ [problem.capability]: alternative.id, [child.path]: deeper.id }, child.capability.id === "hamiltonian-simulation");
      }
    }
  }
  add({ [`${problem.capability}/no-such-step`]: base.root?.method?.id ?? "x" }, false);
  add({ [problem.capability]: "no-such-method" }, false);
  const foreign = [...index.byId.values()].find((node) => node.kind === "method" && node.realizes !== problem.capability);
  if (foreign) add({ [problem.capability]: foreign.id }, false);
  return out;
}

export function plannerGridPoints(graph: LayerGraph): GridPoint[] {
  const index = indexPlannerGraph(leanPlannerGraph(slimLayerGraph(graph, "en")));
  const points: GridPoint[] = [];
  for (const problem of PROBLEMS) {
    const sizes = sizesFor(problem);
    for (const choice of choicesFor(index, problem)) {
      const wanted = choice.costs ? sizes : sizes.slice(0, 1);
      for (const size of wanted) {
        points.push({ id: `${problem.id}|${choice.tag}|${size.tag}`, problem: problem.id, params: size.params, choices: { ...choice.choices } });
      }
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// What the TS planner answers at a point, in the shape the Python port returns

function stageRows(stage: Stage | null): Json[] {
  return flattenStages(stage).map((s) => ({
    path: s.path,
    depth: s.depth,
    capability: s.capability.id,
    method: s.method?.id ?? null,
    choice: s.choice,
    reason: s.reason ? { en: s.reason.en, ja: s.reason.ja } : null,
    repeat: s.repeat ? s.repeat.mark : null,
    stop: s.stop,
  }));
}

function lineRow(line: CostLine): Json {
  return {
    id: line.id,
    value: line.value,
    missing: line.missing ? [...line.missing] : [],
    formula: line.formula,
    kind: line.kind,
    source: line.source,
  };
}

const LOGICAL_KEYS = ["logicalQubits", "toffolis", "tGates", "queries", "serialDepth"] as const;
const LOGICAL_JSON: Record<(typeof LOGICAL_KEYS)[number], string> = {
  logicalQubits: "logical_qubits",
  toffolis: "toffolis",
  tGates: "t_gates",
  queries: "queries",
  serialDepth: "serial_depth",
};

function logicalRow(logical: LogicalSummary): Json {
  const out: Record<string, Json> = {};
  for (const key of LOGICAL_KEYS) out[LOGICAL_JSON[key]] = logical[key]?.id ?? null;
  return out;
}

/** The label the port gives the point it hands `POST /v1/estimates/logical`. */
export function estimatePointLabel(problem: ProblemId): string {
  return `${problem} (Leona planner)`;
}

/** How the TS planner assembles one choice set: the pipeline and its compile step, parents first. */
export function treeAt(index: IndexedGraph, problem: ProblemId, choices: MethodChoices): Json {
  const plan = planWorkflow(index, "", { problem, choices });
  return { stages: stageRows(plan.root), compile_stages: stageRows(plan.compile) };
}

/** What the TS planner answers at a point, less the stages (`treeAt`, which parameters never change). */
export function answerAt(index: IndexedGraph, point: GridPoint): Json {
  const plan = planWorkflow(index, "", { problem: point.problem, params: point.params, choices: point.choices });
  if (!plan.problem || !plan.costs) throw new Error(`${point.id}: the planner answered no plan`);
  const params: Record<string, Json> = {};
  for (const spec of plan.problem.params) {
    const value = plan.params[spec.key];
    params[spec.key] = { value: value?.value ?? null, origin: value?.origin ?? "unset" };
  }
  // The single point the page's physical estimate would send for these values:
  // `physicalRequestPoints` over a one-point series at the first parameter that
  // has a value (any parameter gives the same report at its own value).
  const first = plan.problem.params.find((spec) => typeof plan.params[spec.key]?.value === "number");
  let estimate: Json = null;
  if (first) {
    const x = plan.params[first.key]!.value as number;
    const scaling = scalingSeries(point.problem, plan.params, plan.root, first.key, [x]);
    const bodies = scaling ? physicalRequestPoints(scaling, () => estimatePointLabel(point.problem)) : [];
    estimate = bodies[0] ? { ...bodies[0] } : null;
  }
  return {
    params,
    lines: plan.costs.lines.map(lineRow),
    classical: plan.costs.classical.map(lineRow),
    published: plan.costs.published.map(lineRow),
    logical: logicalRow(plan.costs.logical),
    notes: plan.costs.notes.map(noteId),
    estimate_point: estimate,
  };
}

/**
 * A note's id in `COST_NOTES`. A report that carries a note the table does not
 * hold is refused here: the port could not say it, so the grid cannot ask it to.
 */
function noteId(note: Bilingual): string {
  const found = Object.entries(COST_NOTES).find(([, text]) => text.en === note.en && text.ja === note.ja);
  if (!found) throw new Error(`a cost report carries a note that is not in COST_NOTES: ${note.en}`);
  return found[0];
}

function choiceKey(problem: ProblemId, choices: Record<string, string>): string {
  return [problem, ...Object.entries(choices).map(([path, method]) => stageKey(path, method)).sort()].join("|");
}

/**
 * Stages are stored once per choice set (`trees`) and every costed point names
 * its tree: parameters never change how a pipeline is assembled, and storing
 * the tree at each of the ~900 points made this file 3.6 MB, three quarters of
 * it repeated stages. A stage's `alternatives` are always every method realising
 * its capability, in the graph's order (`assemble.ts`), so they are checked once
 * per capability (`realisers`) rather than once per stage.
 */
export function plannerParityGrid(graph: LayerGraph): Json {
  const index = indexPlannerGraph(leanPlannerGraph(slimLayerGraph(graph, "en")));
  const trees: Record<string, Json> = {};
  const points: Json[] = [];
  for (const point of plannerGridPoints(graph)) {
    const tree = choiceKey(point.problem, point.choices);
    trees[tree] ??= { problem: point.problem, choices: point.choices, ...(treeAt(index, point.problem, point.choices) as object) };
    points.push({ id: point.id, tree, problem: point.problem, params: point.params as unknown as Json, choices: point.choices, answer: answerAt(index, point) });
  }
  const realisers: Record<string, string[]> = {};
  for (const [capability, methods] of [...index.realisers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    realisers[capability] = methods.map((node) => node.id);
  }
  return { generated_by: "scripts/write-planner-fixture.ts", format: PLANNER_PORT_FORMAT, realisers, trees, points };
}

// ---------------------------------------------------------------------------
// Fixed text, read off what the planner itself emits

interface LineText {
  label: Bilingual;
  unit: Bilingual;
  /** Literal formula text, or `null` when `formula_template` carries it. */
  formula: string | null;
  /** `{param}` placeholders filled with the parameter's value as JavaScript prints it. */
  formula_template: string | null;
  kind: CostLine["kind"];
  source: CostLine["source"];
  qualifier: string | null;
  note: Bilingual | null;
  counts: Json;
}

/**
 * Every cost line's words, keyed by id, taken from the lines `costReport`
 * actually returns across the grid — so the port cannot hold a line text the
 * planner no longer prints. A field that differs between two appearances of
 * one id is refused, except a formula that differs only by a parameter's value
 * (Gidney 2025's `Table 5, n = 2048`), which becomes a template.
 */
function lineTexts(graph: LayerGraph): Record<string, LineText> {
  const index = indexPlannerGraph(leanPlannerGraph(slimLayerGraph(graph, "en")));
  const seen = new Map<string, { line: CostLine; params: Record<string, number | null> }[]>();
  for (const point of plannerGridPoints(graph)) {
    const plan = planWorkflow(index, "", { problem: point.problem, params: point.params, choices: point.choices });
    const values: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(plan.params)) values[key] = value?.value ?? null;
    for (const line of [...(plan.costs?.lines ?? []), ...(plan.costs?.classical ?? []), ...(plan.costs?.published ?? [])]) {
      const list = seen.get(line.id) ?? [];
      list.push({ line, params: values });
      seen.set(line.id, list);
    }
  }
  const out: Record<string, LineText> = {};
  for (const id of [...seen.keys()].sort()) {
    const appearances = seen.get(id) ?? [];
    const first = appearances[0]!.line;
    const fixed = (line: CostLine) =>
      JSON.stringify([line.label, line.unit, line.kind, line.source, line.qualifier ?? null, line.note ?? null, line.counts ?? null]);
    for (const { line } of appearances) {
      if (fixed(line) !== fixed(first)) throw new Error(`cost line ${id} does not print the same words every time; the port cannot copy it`);
    }
    let formula: string | null = first.formula;
    let template: string | null = null;
    if (appearances.some(({ line }) => line.formula !== first.formula)) {
      formula = null;
      for (const key of Object.keys(appearances[0]!.params)) {
        const templates = new Set(
          appearances.map(({ line, params }) => (params[key] === null ? "\u0000" : line.formula.split(String(params[key])).join(`{${key}}`))),
        );
        const only = [...templates][0] ?? "";
        if (templates.size === 1 && only.includes(`{${key}}`)) template = only;
      }
      if (template === null) throw new Error(`cost line ${id}'s formula varies in a way no single parameter explains`);
    }
    out[id] = {
      label: first.label,
      unit: first.unit,
      formula,
      formula_template: template,
      kind: first.kind,
      source: first.source,
      qualifier: first.qualifier ?? null,
      note: first.note ?? null,
      counts: (first.counts ?? null) as unknown as Json,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The data file

function paramSpecRow(spec: ParamSpec): Json {
  return {
    key: spec.key,
    label: spec.label,
    hint: spec.hint,
    unit: spec.unit ?? null,
    min: spec.min,
    max: spec.max,
    integer: spec.integer,
    assumed: spec.assumed ? { value: spec.assumed.value, reason: spec.assumed.reason, source: spec.assumed.source ?? null } : null,
  } as unknown as Json;
}

export function plannerPortData(graph: LayerGraph, register: PaperRegister): Json {
  for (const problem of PROBLEMS) {
    for (const [key, value] of Object.entries(readParams(problem, ""))) {
      // The port has no sentence reader (the connector's caller is a model and
      // sends numbers), so it starts every parameter where an empty sentence
      // leaves it. Checked, not assumed: a rule that matched the empty string
      // would put a "text" value here the port would never reproduce.
      if (value && value.origin !== "assumed" && value.origin !== "unset") throw new Error(`${problem.id}.${key} reads a value from an empty sentence`);
    }
  }
  const nodes = portGraph(graph);
  const methodIds = nodes.filter((node) => node.kind === "method").map((node) => node.id);
  const papers = new Map(register.papers.map((paper) => [paper.id, paper]));
  const sources: Record<string, Json> = {};
  for (const [key, source] of Object.entries(PLANNER_SOURCES)) {
    const paper = papers.get(source.paperId);
    if (!paper) throw new Error(`planner source ${key} cites ${source.paperId}, which the register does not carry`);
    sources[key] = {
      paper_id: source.paperId,
      locator: { en: source.locator, ja: source.locatorJa },
      quote: source.quote,
      paper: { title: paper.title, authors: paper.authors, year: paper.year, url: paper.url ?? null },
    };
  }
  return {
    generated_by: "scripts/write-planner-fixture.ts",
    format: PLANNER_PORT_FORMAT,
    max_stage_depth: MAX_STAGE_DEPTH,
    compile_capability: COMPILE_CAPABILITY,
    // Read off `compilesWithoutErrorCorrection` rather than copied from the set
    // it consults, so the answer is the function's.
    runs_without_error_correction: methodIds.filter((id) => compilesWithoutErrorCorrection({ method: { id } } as Stage)).sort(),
    problems: PROBLEMS.map((problem) => ({
      id: problem.id,
      label: problem.label,
      capability: problem.capability,
      preferred_methods: [...problem.preferredMethods],
      step_defaults: Object.fromEntries(
        Object.entries(problem.stepDefaults ?? {}).map(([capability, step]) => [capability, { method: step.method, reason: step.reason }]),
      ),
      params: problem.params.map(paramSpecRow),
      example: problem.example,
    })) as unknown as Json,
    graph: nodes as unknown as Json,
    lines: lineTexts(graph) as unknown as Json,
    notes: COST_NOTES as unknown as Json,
    sources,
    gidney_2025_table_5: Object.fromEntries(Object.entries(GIDNEY_2025_TABLE_5).map(([bits, row]) => [bits, [...row]])),
  };
}

// ---------------------------------------------------------------------------
// The MCP tool's catalog

/**
 * What `plan_workflow`'s description teaches the calling model: each problem,
 * its parameters with their ranges and assumptions, and the choice at its root
 * (every method that can realise the problem, the default first). English only:
 * it is text for a model to read. Deeper choices are not listed — every stage in
 * the tool's answer carries its own `path` and `alternatives`, which is where a
 * caller learns them.
 */
export function plannerToolCatalog(graph: LayerGraph): Json {
  const index = indexPlannerGraph(leanPlannerGraph(slimLayerGraph(graph, "en")));
  return {
    generated_by: "scripts/write-planner-fixture.ts",
    format: PLANNER_PORT_FORMAT,
    problems: PROBLEMS.map((problem) => {
      const plan = planWorkflow(index, "", { problem: problem.id });
      const root = plan.root;
      return {
        id: problem.id,
        label: problem.label.en,
        example: problem.example.en,
        params: problem.params.map((spec) => ({
          key: spec.key,
          label: spec.label.en,
          min: spec.min,
          max: spec.max,
          integer: spec.integer,
          assumed: spec.assumed ? { value: spec.assumed.value, reason: spec.assumed.reason.en } : null,
        })),
        root: root
          ? {
              path: root.path,
              default: root.method?.id ?? null,
              methods: root.alternatives.map((node) => ({ id: node.id, label: node.label })),
            }
          : null,
      };
    }) as unknown as Json,
  };
}

export type { PlannerGraph };

/**
 * JSON with one line per entry of each top-level collection: small enough to
 * commit (the grid indented is about three times the size), and a changed
 * formula still shows in a diff as the handful of points it moved.
 */
export function serialiseByEntry(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return `${JSON.stringify(value)}\n`;
  const fields = Object.entries(value as Record<string, unknown>).map(([key, field]) => {
    const name = JSON.stringify(key);
    if (Array.isArray(field)) {
      return field.length === 0 ? `${name}: []` : `${name}: [\n${field.map((item) => `  ${JSON.stringify(item)}`).join(",\n")}\n ]`;
    }
    if (typeof field === "object" && field !== null) {
      const entries = Object.entries(field as Record<string, unknown>);
      return entries.length === 0
        ? `${name}: {}`
        : `${name}: {\n${entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n }`;
    }
    return `${name}: ${JSON.stringify(field)}`;
  });
  return `{\n ${fields.join(",\n ")}\n}\n`;
}
