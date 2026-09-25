// The build-time block audit: for each of Leona's own Studio blocks that the
// planner pairs with an Atlas method (`stage-blocks.ts`), instantiate the
// block at small sizes, count its gates by name, and compare that count with
// the SAME method's cost lines in `costs.ts` — at the same parameters.
//
// This is how Leona finds out whether its own cost formulas describe the
// circuits it actually builds, rather than assuming a paper's formula and a
// Studio block agree just because a person paired them in stage-blocks.ts.
// Plan: `~/Developer/ai-ops/desk/leona/plans/platform-vision-20260924/phase-b/PLAN.md`
// ("S1-part-1"); VISION.md §5.3 and §10 — a small-instance cross-check that
// never finds a gap is not evidence, so this file is written to be ABLE to
// find one (the test breaks the comparison on purpose and checks it goes
// red), and it says so honestly when a line genuinely has nothing to compare.
//
// ## What "countable" means, and why most lines are not
//
// A `CostLine` only gets compared here when `costs.ts` gives it a `counts`
// field — the ONLY place that field is set is where the line's own cited
// source states, in its own words, what it counts (see `types.ts`'s doc
// comment on `CostLine.counts`). A line with no `counts` is reported as a
// hole with a reason (`HOLE_REASON` below); this file never infers a gate
// vocabulary from a formula's shape, because that is exactly the kind of
// guess the plan rules out. As of this PR that is most lines: qubit counts,
// success probabilities, iteration counts and reader-supplied numbers are
// not gate counts at all, and several formulas (Gidney–Ekerå, Roetteler,
// Grover's own Toffoli line) are for a different, larger construction than
// the small demonstration block Studio actually offers. Exactly three lines
// qualify: `cemm-qft` (the day-one gap this file exists to catch — see PLAN.md
// point 4), and `qaoa-two-qubit` / `qaoa-mixer`, where the audit surfaces a
// second, previously unknown one.
//
// ## Why a block is tested alone, never as part of a composite
//
// `qpe_phase` builds `controlled_phase_powers` and `qft_inverse` together,
// plus its own extra Hadamards. Flattening ITS circuit and counting H/CP
// gates against `cemm-qft` would double the true count (the composite's own
// state-prep H's plus `controlled_phase_powers`'s own CP's on top of
// `qft_inverse`'s), which is not a gap — it is an artifact of testing the
// wrong circuit against a line scoped to one of its parts. So each
// `costs.ts` line with `counts` is compared against exactly one block key
// (`LINE_TARGET_BLOCK`), and every OTHER block sharing that method is reported
// not-countable, with the reason named rather than silently skipped.
import { blockTemplate, type BlockParams, type BuiltBlock } from "../circuit-blocks.ts";
import { flattenBuilderSteps, TWO_QUBIT_GATES } from "../studio-builder.ts";
import { costReport } from "./costs.ts";
import type { PlannerNode } from "./graph.ts";
import { STAGE_BLOCKS, stageBlockMethodIds } from "./stage-blocks.ts";
import type { Stage } from "./assemble.ts";
import type { CostLine, ParamKey, ParamValues } from "./types.ts";

export type AuditVerdict = "match" | "gap" | "not-countable";

export interface AuditRow {
  stage: string;
  block: string;
  costLineId: string;
  n: number;
  predicted: number | null;
  counted: number | null;
  countedOps: Readonly<Record<string, number>>;
  verdict: AuditVerdict;
  explanation: string;
}

export interface AuditSummary {
  total: number;
  matches: number;
  gaps: number;
  notCountable: number;
}

export interface StageCoverage {
  stage: string;
  status: "audited" | "not-countable";
  /** Set when status is "not-countable": why, taken from one of its rows. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// A fake planner Stage, just enough for `costReport` to read `root.method.id`.
// Real Stages come from walking the 5.2 MB Atlas layer graph (`assemble.ts`),
// which this audit has no reason to load: every cost function it exercises
// reads only `root?.method?.id`, never `chosenMethodFor` or the tree beneath.

function fakeStage(methodId: string): Stage {
  const node: PlannerNode = {
    id: methodId,
    kind: "method",
    label: methodId,
    shortLabel: null,
    summary: "",
    realizes: null,
    steps: [],
    via: {},
    repeats: {},
    cost: null,
    ownStretch: null,
    takes: null,
    returns: null,
  };
  return { path: methodId, depth: 0, capability: node, method: node, choice: "reader", reason: null, alternatives: [node], repeat: null, children: [], stop: null };
}

function withParams(values: Partial<Record<ParamKey, number>>): ParamValues {
  const out: ParamValues = {};
  for (const key of Object.keys(values) as ParamKey[]) out[key] = { key, value: values[key]!, origin: "reader" };
  return out;
}

// ---------------------------------------------------------------------------
// Building a block at a given size, and counting its gates by name.

function pathEdges(n: number): [number, number][] {
  return Array.from({ length: Math.max(n - 1, 0) }, (_, i) => [i, i + 1]);
}

/** All-ones: for phase_oracle/grover_diffuser's ancilla-free MCZ (`mczSteps`
 * in circuit-blocks.ts), a marked bitstring's own value doesn't change the
 * gate COUNT for a fixed length — 0-bits add an X-conjugation pair per zero,
 * so a canonical, deterministic choice matters for reproducibility, not for
 * fairness. Neither of these blocks has a countable line to compare against
 * here (see HOLE_REASON), so the choice is informational only. */
function onesBitstring(n: number): string {
  return "1".repeat(n);
}

/** Block key -> how to size it at "n". Covers every block key any
 * STAGE_BLOCKS entry names. controlled_mult_7/4_mod_15 take no parameters
 * (they are a fixed, hardcoded modulus-15 demonstration; see HOLE_REASON). */
const BLOCK_PARAMS_AT: Readonly<Record<string, (n: number) => BlockParams>> = {
  phase_oracle: (n) => ({ bitstring: onesBitstring(n) }),
  grover_diffuser: (n) => ({ n }),
  grover_iteration: (n) => ({ bitstring: onesBitstring(n) }),
  controlled_phase_powers: (n) => ({ t: n, angle: "pi/4" }),
  qft_inverse: (n) => ({ n }),
  qpe_phase: (n) => ({ t: n, angle: "pi/4" }),
  amplitude_estimation_powers: (n) => ({ t: n, theta: "pi/8" }),
  ising_trotter_step: (n) => ({ n, J: "1", h: "1", dt: "0.1" }),
  qaoa_maxcut_layer: (n) => ({ edges: pathEdges(n), gamma: "pi/4", beta: "pi/8" }),
  controlled_mult_7_mod_15: () => ({}),
  controlled_mult_4_mod_15: () => ({}),
};

/** The block's own fixed size, for keys `BLOCK_PARAMS_AT` ignores `n` for. */
function fixedSize(key: string): number | null {
  return key === "controlled_mult_7_mod_15" || key === "controlled_mult_4_mod_15" ? 5 : null;
}

function buildAt(key: string, n: number): BuiltBlock {
  const template = blockTemplate(key);
  if (!template) throw new Error(`block-audit: unknown block key "${key}" (check STAGE_BLOCKS against BLOCK_TEMPLATES)`);
  const paramsFor = BLOCK_PARAMS_AT[key];
  if (!paramsFor) throw new Error(`block-audit: no size-parameter mapping in BLOCK_PARAMS_AT for block key "${key}"`);
  return template.build(paramsFor(n));
}

/** The circuit Leona actually builds: `flattenBuilderSteps` is the same
 * expansion every framework converter (`studio-builder.ts`) and the
 * simulator use — never a re-derivation of "what a CUSTOM step means". */
function countGates(built: BuiltBlock): Record<string, number> {
  const flat = flattenBuilderSteps(built.root.steps, built.definitions);
  const counts: Record<string, number> = {};
  for (const step of flat) counts[step.gate] = (counts[step.gate] ?? 0) + 1;
  return counts;
}

function opsTotal(ops: string[] | "all", counted: Readonly<Record<string, number>>): number {
  const names = ops === "all" ? TWO_QUBIT_GATES : ops;
  return names.reduce((sum, g) => sum + (counted[g] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Which block a countable line is scoped to (see the module comment), and why
// every other line is a hole.

const LINE_TARGET_BLOCK: Readonly<Record<string, string>> = {
  "cemm-qft": "qft_inverse",
  "qaoa-two-qubit": "qaoa_maxcut_layer",
  "qaoa-mixer": "qaoa_maxcut_layer",
};

const HOLE_REASON: Readonly<Record<string, string>> = {
  "grover-iterations": "counts how many times the whole grover_iteration block repeats, not a gate name inside one instance.",
  "grover-success": "a success probability, not a gate count.",
  "grover-register": "an index-register qubit count, not a gate count.",
  "grover-toffolis":
    'the per-check Toffoli count is a number the reader types in for their own check circuit (source: null — no paper states it), not something derived from Leona\'s own phase_oracle/grover_diffuser blocks. Those blocks build zero CCX gates at any size: their multi-controlled-Z ("mczSteps" in circuit-blocks.ts) is an ancilla-free CP/RZ/CX decomposition, not a Toffoli-based one.',
  "cemm-register": "a counting-register qubit count, not a gate count.",
  "cemm-uses":
    "counts abstract \"applications of U\", on the convention that a controlled power U^(2^k) is built from 2^k repeated calls to U. Leona's controlled_phase_powers block instead computes each power analytically as one CP(angle·2^k) gate, so there is no single gate name in the built circuit this count corresponds to.",
  "brassard-evaluations":
    "counts \"evaluations of the state-preparation circuit A\" as an abstract oracle call, and amplitudeEstimationCosts has no counting-qubit parameter at all — only epsilon. There is no size at which to evaluate this line and count amplitude_estimation_powers's gates without inventing a t <-> epsilon correspondence the source does not state.",
  "brassard-register": "a counting-register qubit count, not a gate count.",
  "ge2021-qubits": "a logical-qubit count (not gates) for Gidney–Ekerå's general n-bit factoring construction.",
  "ge2021-toffolis":
    "a Toffoli-gate count for Gidney–Ekerå's general n-bit factoring circuit. Leona's controlled_mult_7_mod_15/controlled_mult_4_mod_15 blocks are a fixed, non-parameterised demonstration hardcoded to modulus 15 (5 qubits, no \"bits\" parameter) — a different, much smaller construction this formula does not describe.",
  "ge2021-depth": "a measurement-depth figure, not a gate count.",
  "roetteler-qubits": "a qubit count for Roetteler et al.'s general n-bit ECDLP circuit, not this audit's fixed modulus-15 demonstration blocks.",
  "roetteler-toffolis": "a Toffoli-gate count for Roetteler et al.'s general n-bit ECDLP circuit — the same construction mismatch as ge2021-toffolis.",
  "qaoa-qubits": "a qubit count, not a gate count.",
};

const QFT_NOT_SCOPED_IN_PERIOD_FINDING =
  "factoringCosts/ecdlpCosts give whole-construction Toffoli/qubit totals for Gidney–Ekerå/Roetteler; neither breaks out a cost line for the QFT read-out step on its own, so qft_inverse's gates — the one STAGE_BLOCKS-listed block here this audit CAN count — have no line under cyclic-period-finding to compare against. (Its gates do have a line: cemm-qft, under register-phase-estimation, a different method.)";

/** Per-(line, block) overrides, for when the generic per-line `HOLE_REASON`
 * would name the wrong block. */
const HOLE_REASON_FOR_BLOCK: Readonly<Record<string, string>> = {
  "ge2021-qubits|qft_inverse": QFT_NOT_SCOPED_IN_PERIOD_FINDING,
  "ge2021-toffolis|qft_inverse": QFT_NOT_SCOPED_IN_PERIOD_FINDING,
  "ge2021-depth|qft_inverse": QFT_NOT_SCOPED_IN_PERIOD_FINDING,
  "roetteler-qubits|qft_inverse": QFT_NOT_SCOPED_IN_PERIOD_FINDING,
  "roetteler-toffolis|qft_inverse": QFT_NOT_SCOPED_IN_PERIOD_FINDING,
};

function rowForLine(stage: string, block: string, n: number, countedOps: Readonly<Record<string, number>>, line: CostLine): AuditRow {
  if (!line.counts) {
    return {
      stage,
      block,
      costLineId: line.id,
      n,
      predicted: null,
      counted: null,
      countedOps,
      verdict: "not-countable",
      explanation: HOLE_REASON_FOR_BLOCK[`${line.id}|${block}`] ?? HOLE_REASON[line.id] ?? `no "counts" declared on this cost line in costs.ts: its source does not state a gate-by-gate breakdown, so the audit will not guess one.`,
    };
  }
  const target = LINE_TARGET_BLOCK[line.id];
  if (target && target !== block) {
    return {
      stage,
      block,
      costLineId: line.id,
      n,
      predicted: null,
      counted: null,
      countedOps,
      verdict: "not-countable",
      explanation: `counts ${target}'s gates (see costs.ts); ${block} builds a different part of the circuit and is not compared against it — see this file's module comment on composite blocks.`,
    };
  }
  const predicted = line.value;
  const counted = opsTotal(line.counts.ops, countedOps);
  const opsSet = new Set(line.counts.ops === "all" ? TWO_QUBIT_GATES : line.counts.ops);
  const extra = Object.entries(countedOps).filter(([gate, count]) => count > 0 && !opsSet.has(gate));
  const extraText = extra.length ? ` Extra gates this line does not count: ${extra.map(([gate, count]) => `${count} ${gate}`).join(", ")}.` : "";
  if (predicted === null) {
    return {
      stage,
      block,
      costLineId: line.id,
      n,
      predicted: null,
      counted,
      countedOps,
      verdict: "not-countable",
      explanation: `the cost line has no value at n=${n} (a required parameter is missing).`,
    };
  }
  const verdict: AuditVerdict = predicted === counted ? "match" : "gap";
  const base = verdict === "match" ? "exact match on the counted ops." : `predicted ${predicted}, counted ${counted}.`;
  return { stage, block, costLineId: line.id, n, predicted, counted, countedOps, verdict, explanation: `${base}${extraText} ${line.counts.note ?? ""}`.trim() };
}

function rowsForBlockAtSize(stage: string, block: string, n: number, lines: readonly CostLine[]): AuditRow[] {
  const countedOps = countGates(buildAt(block, n));
  return lines.map((line) => rowForLine(stage, block, n, countedOps, line));
}

/**
 * Audit one cost line against one real Studio block at size n — the same
 * primitive `rowsForBlockAtSize` calls once per line in a stage's cost
 * report. Exported so a test can feed a synthetic `CostLine` (a deliberately
 * wrong formula, or a deliberately right one) against a real block without
 * fabricating a whole `CostReport` — see
 * `workflow-planner-block-audit.test.ts`'s "the audit can fail" case, which
 * this function is what makes that possible to test at all without editing
 * costs.ts's real formulas.
 */
export function auditCostLine(stage: string, block: string, n: number, line: CostLine): AuditRow {
  return rowForLine(stage, block, n, countGates(buildAt(block, n)), line);
}

// ---------------------------------------------------------------------------
// One function per STAGE_BLOCKS method: which parameters to sweep, and which
// problem's costReport to call. Search, amplitude estimation and cyclic
// period finding sweep a single representative size, because none of their
// lines are countable (HOLE_REASON) regardless of n — a size sweep would only
// repeat the same hole. Phase estimation and MaxCut sweep several sizes,
// because they are where a real comparison happens.

function searchStage(): AuditRow[] {
  const method = "grover-fixed-iteration-search";
  const blocks = STAGE_BLOCKS[method];
  const n = 3;
  const report = costReport("search", withParams({ domainSize: 2 ** n, markedCount: 1, oracleToffolis: 5 }), fakeStage(method));
  return blocks.flatMap((block) => rowsForBlockAtSize(method, block, n, report.lines));
}

function phaseEstimationStage(): AuditRow[] {
  const method = "register-phase-estimation";
  const blocks = STAGE_BLOCKS[method];
  // failureProbability pinned at its allowed maximum (0.5, problems.ts) so the
  // formula's own ceil(log2(...)) term stays at its minimum, 1 — keeping the
  // resulting counting-register size m = precisionBits + 1 small.
  const rows: AuditRow[] = [];
  for (const precisionBits of [2, 3, 4, 5, 6]) {
    const report = costReport("phase-estimation", withParams({ precisionBits, failureProbability: 0.5 }), fakeStage(method));
    const m = report.lines.find((line) => line.id === "cemm-register")?.value;
    if (m === null || m === undefined) continue;
    for (const block of blocks) rows.push(...rowsForBlockAtSize(method, block, m, report.lines));
  }
  return rows;
}

function amplitudeEstimationStage(): AuditRow[] {
  const method = "amplitude-estimation-readout";
  const blocks = STAGE_BLOCKS[method];
  const n = 3;
  const report = costReport("amplitude-estimation", withParams({ epsilon: 0.01 }), fakeStage(method));
  return blocks.flatMap((block) => rowsForBlockAtSize(method, block, n, report.lines));
}

function hamiltonianSimulationStage(): AuditRow[] {
  const method = "product-formula-simulation";
  const blocks = STAGE_BLOCKS[method];
  const n = 4;
  const report = costReport("hamiltonian-simulation", withParams({ lambda: 4, time: 1 }), fakeStage(method));
  if (report.lines.length > 0) return blocks.flatMap((block) => rowsForBlockAtSize(method, block, n, report.lines));
  // hamiltonianSimulationCosts models only qubitization-simulation; for this
  // method it emits no line at all (not even one with a null value), so
  // there is no costLineId to attach a row to beyond a sentinel.
  return blocks.map((block) => ({
    stage: method,
    block,
    costLineId: "no-cost-model",
    n,
    predicted: null,
    counted: null,
    countedOps: countGates(buildAt(block, n)),
    verdict: "not-countable",
    explanation:
      "hamiltonianSimulationCosts only emits a cost line when the chosen method is qubitization-simulation (Low–Chuang's query bound). For product-formula-simulation it emits none at all — report.lines is empty — so there is nothing here to compare this block's gate counts against.",
  }));
}

function maxcutStage(): AuditRow[] {
  const method = "qaoa-cost-mixer-alternation";
  const blocks = STAGE_BLOCKS[method];
  const rows: AuditRow[] = [];
  for (const n of [2, 3, 4, 5, 6]) {
    const edges = pathEdges(n).length;
    const report = costReport("maxcut", withParams({ nodes: n, edges, layers: 1 }), fakeStage(method));
    for (const block of blocks) rows.push(...rowsForBlockAtSize(method, block, n, report.lines));
  }
  return rows;
}

function cyclicPeriodFindingStage(): AuditRow[] {
  const method = "cyclic-period-finding";
  const blocks = STAGE_BLOCKS[method];
  const bits = 8; // the smallest value both factoring's and ecdlp's own ParamSpec allow.
  const factoring = costReport("factoring", withParams({ bits }), fakeStage(method));
  const ecdlp = costReport("ecdlp", withParams({ bits }), fakeStage(method));
  const lines = [...factoring.lines, ...ecdlp.lines];
  return blocks.flatMap((block) => rowsForBlockAtSize(method, block, fixedSize(block) ?? 4, lines));
}

/** Every STAGE_BLOCKS method, audited. */
export function auditBlocks(): AuditRow[] {
  return [...searchStage(), ...phaseEstimationStage(), ...amplitudeEstimationStage(), ...hamiltonianSimulationStage(), ...maxcutStage(), ...cyclicPeriodFindingStage()];
}

export function summarize(rows: readonly AuditRow[]): AuditSummary {
  return {
    total: rows.length,
    matches: rows.filter((row) => row.verdict === "match").length,
    gaps: rows.filter((row) => row.verdict === "gap").length,
    notCountable: rows.filter((row) => row.verdict === "not-countable").length,
  };
}

/** Every method stage-blocks.ts names, either genuinely audited (at least one
 * match or gap somewhere in its rows) or not-countable with a reason —
 * VISION.md §10's kill criterion is "the small-instance cross-check finds
 * nothing", so this function is what a reader checks to see that every stage
 * got a real look, not a silent skip. */
export function stageCoverage(rows: readonly AuditRow[]): StageCoverage[] {
  return stageBlockMethodIds().map((stage) => {
    const stageRows = rows.filter((row) => row.stage === stage);
    if (stageRows.some((row) => row.verdict === "match" || row.verdict === "gap")) return { stage, status: "audited" };
    return { stage, status: "not-countable", reason: stageRows[0]?.explanation ?? "no rows were produced for this stage." };
  });
}

// ---------------------------------------------------------------------------
// Worked examples (stage-blocks.ts's OWN evidence for its pairings, per its
// module comment) as a completeness check on block keys, not a second row
// generator. A worked example's `steps` is one composite CUSTOM tree per
// example (state prep, oracle, diffuser, ... already flattened together by
// the time it is built); isolating one block's own gates back out of that
// tree without an explicit per-example map would be exactly the guessed
// pairing this file's module comment rules out for qpe_phase. So this checks
// only that every block key a worked example actually places is accounted
// for: either it is one of STAGE_BLOCKS's own pairings (and so audited
// above), or it is honestly outside the planner's scope.

export interface WorkedExampleCoverageRow {
  blockKey: string;
  coveredByStage: string | null;
}

export function workedExampleBlockCoverage(examples: readonly { blocks: readonly string[] }[]): WorkedExampleCoverageRow[] {
  const byBlock = new Map<string, string>();
  for (const [stage, blocks] of Object.entries(STAGE_BLOCKS)) for (const block of blocks) if (!byBlock.has(block)) byBlock.set(block, stage);
  const allKeys = [...new Set(examples.flatMap((example) => example.blocks))].sort();
  return allKeys.map((blockKey) => ({ blockKey, coveredByStage: byBlock.get(blockKey) ?? null }));
}
