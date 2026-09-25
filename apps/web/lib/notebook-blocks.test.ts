import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { components } from "@majorana/contracts-gen";
import {
  applyBlockAccept,
  blockAudit,
  blockCellOptions,
  blockCostAt,
  blockEvidence,
  blockPlanLink,
  CHECK_QUBIT_CEILING,
  checkedBoundary,
  claimSources,
  insertBlockCellAfter,
  resolveBlockPlan,
  searchMethods,
  sizeStanding,
  stagePositions,
  type BlockRef,
} from "./notebook-blocks.ts";
import { buildBlockCatalog } from "./notebook-block-catalog.ts";
import type { CheckProperty } from "./notebook-checks.ts";
import type { NotebookCellView } from "./notebook-view.ts";
import { costReport } from "./workflow-planner/costs.ts";
import { planWorkflow } from "./workflow-planner/index.ts";
import { PROBLEMS } from "./workflow-planner/problems.ts";
import type { ProblemId } from "./workflow-planner/types.ts";

// Block cells (ai-ops 382, Phase B S1). The card's numbers are the planner's, worked out
// from the block's stored inputs; its evidence is the report's; its audit line is
// `block-audit.ts`'s. These tests hold each of those joins, and the two places this
// module restates the Python contract.

const CATALOG = buildBlockCatalog("en");
const CONTRACT = readFileSync(new URL("../../../packages/py/contracts/src/majorana_contracts/notebooks.py", import.meta.url), "utf8");

// The generated `BlockPlan.problem` union and the planner's `ProblemId` are the same
// set: each is assignable to the other, or this file does not typecheck.
type SchemaProblem = components["schemas"]["BlockPlan"]["problem"];
const toSchema = (id: ProblemId): SchemaProblem => id;
const fromSchema = (id: SchemaProblem): ProblemId => id;
void toSchema;
void fromSchema;

const GROVER: BlockRef = {
  method: "grover-fixed-iteration-search",
  plan: { problem: "search", params: { domainSize: 1024, markedCount: 1 }, choices: {} },
  size_param: "domainSize",
  author: "user",
  citation: "",
  accepted: true,
};

function checkView(
  id: string,
  kind: CheckProperty["kind"],
  block: string | null,
  verdict: { status: "pass" | "fail" | "inconclusive"; qubits: number | null } | null,
  extra: Partial<CheckProperty> = {},
): NotebookCellView {
  return {
    id,
    kind: "code",
    role: "check",
    source: `# check: ${id}`,
    execute: true,
    status: verdict ? "ok" : "not_run",
    stdout: "",
    stderr: "",
    outputs: [],
    error: null,
    truncated: false,
    durationMs: null,
    cachedFromSeq: null,
    graded: false,
    answerPrompt: null,
    hardwareRequests: [],
    checkProperty: {
      kind,
      subject: "qc",
      amplitudes: null,
      probabilities: null,
      reference: null,
      reference_qasm: null,
      hamiltonian: null,
      target: null,
      value: kind === "value" ? 1 : null,
      tolerance: 1e-6,
      statement: `${id} statement`,
      author: "user",
      citation: "",
      accepted: true,
      block,
      ...extra,
    },
    checkVerdict: verdict
      ? {
          status: verdict.status,
          basis: kind === "value" ? "value" : "circuit",
          checked_against: "",
          measure: "",
          detail: "",
          qubits: verdict.qubits,
          subject_fingerprint: null,
          subject_qasm: null,
          teeth: null,
        }
      : null,
    block: null,
  };
}

// ------------------------------------------------------------------------- contract mirrors

test("PLANNER_PROBLEM_PARAMS in the Python contract names exactly the planner's problems and parameters", () => {
  const start = CONTRACT.indexOf("PLANNER_PROBLEM_PARAMS: dict[str, tuple[str, ...]] = {");
  assert.ok(start >= 0, "the table is where this test expects it");
  const body = CONTRACT.slice(start, CONTRACT.indexOf("\n}\n", start));
  const table = new Map<string, string[]>();
  for (const match of body.matchAll(/^\s+"([a-z-]+)": \(([^)]*)\),$/gm)) {
    table.set(match[1], [...match[2].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));
  }
  assert.equal(table.size, PROBLEMS.length, "one row per planner problem");
  for (const problem of PROBLEMS) {
    assert.deepEqual(table.get(problem.id), problem.params.map((spec) => spec.key), problem.id);
  }
});

test("the check width ceilings are the contract's", () => {
  const read = (name: string) => Number(new RegExp(`^${name} = (\\d+)$`, "m").exec(CONTRACT)?.[1]);
  assert.deepEqual(CHECK_QUBIT_CEILING, {
    state: read("CHECK_STATE_MAX_QUBITS"),
    distribution: read("CHECK_DISTRIBUTION_MAX_QUBITS"),
    unitary: read("CHECK_UNITARY_MAX_QUBITS"),
    energy: read("MAX_CHECK_HAMILTONIAN_QUBITS"),
  });
});

// ------------------------------------------------------------------------- the plan

test("a block's plan is read by the planner's own Studio-link validator", () => {
  assert.ok(blockPlanLink(GROVER.plan));
  assert.equal(blockPlanLink({ problem: "search", params: { bits: 8 }, choices: {} }), null);
  assert.equal(blockPlanLink(null), null);
});

test("a Grover block is the search problem's root stage, and its size steps by powers of two", () => {
  const resolved = resolveBlockPlan(CATALOG.graph, GROVER);
  assert.equal(resolved.kind, "placed");
  if (resolved.kind !== "placed") return;
  assert.equal(resolved.isRoot, true);
  assert.equal(resolved.sizeParam, "domainSize");
  assert.deepEqual(resolved.sizes, [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]);
  assert.equal(resolved.sizes[resolved.planSizeIndex], 1024);
});

test("the cost at a size is exactly the planner's cost report at those inputs", () => {
  const resolved = resolveBlockPlan(CATALOG.graph, GROVER);
  assert.equal(resolved.kind, "placed");
  if (resolved.kind !== "placed") return;
  for (const size of [64, 1024, 16384]) {
    const cost = blockCostAt(CATALOG.graph, resolved, size);
    const direct = planWorkflow(CATALOG.graph, "", { problem: "search", params: { domainSize: size, markedCount: 1 } });
    assert.deepEqual(cost.report, direct.costs);
    assert.deepEqual(cost.report, costReport("search", direct.params, direct.root));
    assert.equal(cost.width, direct.costs?.logical.logicalQubits?.value);
  }
  assert.equal(blockCostAt(CATALOG.graph, resolved, 2048).width, 11);
});

test("a method below the root is placed at its stage, and its lines are the whole workflow's", () => {
  const ref: BlockRef = { ...GROVER, method: "register-phase-estimation", plan: { problem: "ground-state", params: {}, choices: {} }, size_param: null };
  const resolved = resolveBlockPlan(CATALOG.graph, ref);
  assert.equal(resolved.kind, "placed");
  if (resolved.kind !== "placed") return;
  assert.equal(resolved.isRoot, false);
  assert.equal(resolved.stage.path, "ground-state-energy/phase-estimation");
});

test("a plan the planner cannot read, or one that no longer holds the method, says so", () => {
  assert.equal(resolveBlockPlan(CATALOG.graph, { ...GROVER, plan: { problem: "search", params: { bits: 8 }, choices: {} } }).kind, "invalid");
  assert.equal(resolveBlockPlan(CATALOG.graph, { ...GROVER, method: "koopman-linearization" }).kind, "unplaced");
  assert.equal(resolveBlockPlan(CATALOG.graph, { ...GROVER, plan: null, size_param: null }).kind, "none");
});

test("claimSources names each source of a number on screen once, and none for a missing input", () => {
  const cost = planWorkflow(CATALOG.graph, "", { problem: "search", params: { domainSize: 1024, markedCount: 1 } }).costs!;
  assert.deepEqual(claimSources(cost.lines), ["bbht-iterations"]);
  const missing = planWorkflow(CATALOG.graph, "", { problem: "search", params: { domainSize: null } }).costs!;
  assert.deepEqual(claimSources(missing.lines), []);
});

// ------------------------------------------------------------------------- the evidence

test("evidence is the checks that name the block, with the width the worker judged", () => {
  const cells = [
    checkView("k1", "state", "b1", { status: "pass", qubits: 10 }),
    checkView("k2", "state", "b1", { status: "fail", qubits: 12 }),
    checkView("k3", "value", "b1", { status: "pass", qubits: null }),
    checkView("k4", "state", "b1", null),
    checkView("k5", "state", "other", { status: "pass", qubits: 16 }),
    checkView("k6", "state", null, { status: "pass", qubits: 17 }),
  ];
  const rows = blockEvidence("b1", cells);
  assert.deepEqual(
    rows.map((row) => [row.cellId, row.status, row.qubits]),
    [
      ["k1", "pass", 10],
      ["k2", "fail", 12],
      ["k3", "pass", null],
      ["k4", "not_run", null],
    ],
  );
  // Only a PASSING check with a circuit moves the boundary: the failing 12 does not.
  assert.equal(checkedBoundary(rows), 10);
  assert.equal(checkedBoundary(rows.filter((row) => row.cellId !== "k1")), null);
});

test("the boundary is capped at the width a check of that kind can judge", () => {
  const rows = blockEvidence("b1", [checkView("k1", "unitary", "b1", { status: "pass", qubits: 12 })]);
  assert.equal(checkedBoundary(rows), CHECK_QUBIT_CEILING.unitary);
});

test("a width sits within, beyond, or unplaced against the boundary", () => {
  assert.equal(sizeStanding(10, 10), "within");
  assert.equal(sizeStanding(11, 10), "beyond");
  assert.equal(sizeStanding(null, 10), "unplaced");
  assert.equal(sizeStanding(4, null), "unchecked");
});

// ------------------------------------------------------------------------- the audit

test("the audit line reports only rows where Leona counted a gate", () => {
  const qaoa = blockAudit(CATALOG.audit, "qaoa-cost-mixer-alternation");
  assert.ok(qaoa);
  assert.ok(qaoa.counted.every((row) => row.verdict !== "not-countable"));
  assert.equal(qaoa.gaps.length, CATALOG.audit.filter((row) => row.stage === "qaoa-cost-mixer-alternation" && row.verdict === "gap").length);
  assert.ok(qaoa.gaps.length > 0 && qaoa.matches > 0);
  // Grover's lines are all not-countable, so there is no audit line at all, not "no gaps".
  assert.equal(blockAudit(CATALOG.audit, "grover-fixed-iteration-search"), null);
});

// ------------------------------------------------------------------------- cells and the form

test("a new block cell is markdown, the reader's, accepted, and goes after the cell it was added below", () => {
  const cells = [
    { id: "c01", kind: "code" as const, role: null, source: "x = 1", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null, block: null },
    { id: "c02", kind: "code" as const, role: null, source: "y = 2", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null, block: null },
  ];
  const { cells: next, id } = insertBlockCellAfter(cells, "c01", { ...GROVER, author: "nala", accepted: false });
  assert.deepEqual(next.map((cell) => cell.id), ["c01", id, "c02"]);
  const created = next[1];
  assert.equal(created.kind, "markdown");
  assert.equal(created.role, "block");
  assert.equal(created.block?.author, "user");
  assert.equal(created.block?.accepted, true);
  assert.equal(created.property, null);
  const nala = [{ ...created, block: { ...created.block!, author: "nala" as const, accepted: false } }];
  const accepted = applyBlockAccept(nala, created.id);
  assert.equal(accepted[0].block?.accepted, true);
  assert.equal(accepted[0].block?.author, "nala");
});

test("the check form lists the notebook's blocks by their Atlas name", () => {
  const options = blockCellOptions(
    [
      { id: "b1", role: "block", block: GROVER },
      { id: "c1", role: "run", block: null },
    ],
    CATALOG.methods,
  );
  assert.deepEqual(options, [{ id: "b1", label: CATALOG.methods.find((m) => m.id === GROVER.method)!.label }]);
});

test("search finds a method by any word of its name", () => {
  const hits = searchMethods(CATALOG.methods, "grover");
  assert.ok(hits.some((method) => method.id === "grover-fixed-iteration-search"));
  assert.deepEqual(searchMethods(CATALOG.methods, "   "), []);
});

test("stage positions name every problem a method can take its numbers from", () => {
  const grover = stagePositions(CATALOG.graph, "grover-fixed-iteration-search");
  assert.ok(grover.some((position) => position.problem === "search" && Object.keys(position.choices).length === 0));
  // Not the planner's default at that stage, so the plan carries the choice.
  const trotter = stagePositions(CATALOG.graph, "product-formula-simulation");
  const chosen = trotter.find((position) => position.problem === "hamiltonian-simulation");
  assert.deepEqual(chosen?.choices, { "hamiltonian-simulation": "product-formula-simulation" });
  assert.deepEqual(stagePositions(CATALOG.graph, "no-such-method"), []);
});

// ------------------------------------------------------------------------- the catalog

test("the catalog carries every Atlas method with its own cost text or the reason it has none", () => {
  const methods = new Map(CATALOG.methods.map((method) => [method.id, method]));
  assert.ok(methods.get("product-formula-simulation")?.cost);
  const koopman = methods.get("koopman-linearization");
  assert.equal(koopman?.cost, null);
  assert.ok(koopman?.costAbsence && koopman.costAbsence.length > 0);
  assert.ok(CATALOG.papers.length > 0);
  assert.ok(CATALOG.audit.length > 0);
  // The lean graph: route structure without prose.
  assert.ok(CATALOG.graph.nodes.every((node) => node.cost === null && node.summary === ""));
});
