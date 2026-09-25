import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@majorana/contracts-gen";
import { fireEvent, render } from "@testing-library/react";
import { NotebookView } from "../../components/notebook-view.tsx";
import { NotebookAddBlockForm } from "../../components/notebook-add-block-form.tsx";
import { NotebookAddCheckForm } from "../../components/notebook-add-check-form.tsx";
import { buildBlockCatalog } from "../../lib/notebook-block-catalog.ts";
import { blockCostAt, CHECK_QUBIT_CEILING, resolveBlockPlan, type BlockRef } from "../../lib/notebook-blocks.ts";
import type { CheckProperty } from "../../lib/notebook-checks.ts";
import { notebookCellViews } from "../../lib/notebook-view.ts";
import { formatPlain } from "../../lib/workflow-planner/costs.ts";
import { formatCostValue } from "../../lib/workflow-planner/plan-copy.ts";
import { problemById } from "../../lib/workflow-planner/problems.ts";
import { PLANNER_SOURCES } from "../../lib/workflow-planner/sources.ts";
import { NOTEBOOK_BLOCK_COPY, NOTEBOOK_CHECK_COPY } from "../../lib/workspace-locale.ts";

// Block cells (ai-ops 382, Phase B S1; VISION §5.3): the card in every state (a planner
// stage with numbers, a method with only its source's words, a hole, evidence inside and
// beyond what the checks ran, the formula audit line), the size control, and the two
// forms. Rendered against the REAL Atlas slice the page is served
// (`buildBlockCatalog`), so every number on screen is the planner's own.

type Cell = components["schemas"]["Cell"];
type CellResult = components["schemas"]["CellResult"];

const CATALOG = buildBlockCatalog("en");
const READY = { status: "ready" as const, catalog: CATALOG };
const COPY = NOTEBOOK_BLOCK_COPY.en;

const GROVER_LABEL = CATALOG.methods.find((method) => method.id === "grover-fixed-iteration-search")!.label;

const GROVER: BlockRef = {
  method: "grover-fixed-iteration-search",
  plan: { problem: "search", params: { domainSize: 1024, markedCount: 1 }, choices: {} },
  size_param: "domainSize",
  author: "user",
  citation: "",
  accepted: true,
};

function blockCell(id: string, block: BlockRef): Cell {
  return {
    id,
    kind: "markdown",
    role: "block",
    source: `**Leona block: \`${block.method}\`**`,
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer: null,
    answer_prompt: null,
    timeout_s: null,
    property: null,
    block,
  };
}

function checkCell(id: string, block: string | null, kind: CheckProperty["kind"] = "state"): Cell {
  const property: CheckProperty = {
    kind,
    subject: "qc",
    amplitudes: null,
    probabilities: null,
    reference: kind === "state" ? "ghz(3)" : null,
    reference_qasm: null,
    hamiltonian: null,
    target: null,
    value: kind === "value" ? 0.5 : null,
    tolerance: 1e-6,
    statement: `${id} holds`,
    author: "user",
    citation: "",
    accepted: true,
    block,
  };
  return {
    id,
    kind: "code",
    role: "check",
    source: `# check: ${id} holds`,
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer: null,
    answer_prompt: null,
    timeout_s: null,
    property,
    block: null,
  };
}

function verdict(id: string, status: "pass" | "fail" | "inconclusive", qubits: number | null): CellResult {
  return {
    id,
    status: "ok",
    stdout: "",
    stderr: "",
    outputs: [],
    error: null,
    duration_ms: 5,
    execution_count: 1,
    note: "",
    check: {
      status,
      basis: qubits === null ? "value" : "circuit",
      checked_against: "",
      measure: "",
      detail: "",
      qubits,
      subject_fingerprint: null,
      subject_qasm: null,
      teeth: null,
    },
    cache_key: null,
    cached_from_seq: null,
  };
}

function renderNotebook(cells: Cell[], results: CellResult[] = [], extra: Record<string, unknown> = {}) {
  const views = notebookCellViews(cells, {
    notebook_slug: "s",
    ok: true,
    runner: "sandbox",
    duration_ms: 0,
    environment: {},
    dropped_bytes: 0,
    note: "",
    cells: results,
  });
  return render(<NotebookView cells={views} locale="en" framework="qiskit" blockCatalog={READY} {...extra} />);
}

function text(view: ReturnType<typeof render>): string {
  return view.container.textContent ?? "";
}

function slider(view: ReturnType<typeof render>): HTMLInputElement {
  const input = view.container.querySelector<HTMLInputElement>(".mj-notebook-block-size input[type=range]");
  assert.ok(input, "no size control on screen");
  return input!;
}

// ------------------------------------------------------------------------- a planner stage

test("a planner stage shows the planner's lines at the plan's size, with kind and source", () => {
  const view = renderNotebook([blockCell("b01", GROVER)]);
  const shown = text(view);
  assert.ok(shown.includes(GROVER_LABEL));
  const link = view.container.querySelector<HTMLAnchorElement>(".mj-notebook-block-link");
  assert.equal(link?.getAttribute("href"), "/repository/layers/grover-fixed-iteration-search");
  const resolved = resolveBlockPlan(CATALOG.graph, GROVER);
  assert.equal(resolved.kind, "placed");
  if (resolved.kind !== "placed") return;
  const cost = blockCostAt(CATALOG.graph, resolved, 1024);
  for (const line of cost.report.lines) {
    assert.ok(shown.includes(line.label.en), line.id);
    assert.ok(shown.includes(line.formula), line.id);
    assert.ok(shown.includes(formatCostValue(line)), line.id);
  }
  assert.match(shown, /Exact/);
  assert.match(shown, /domainSize|Items to search|items/i);
  assert.ok(shown.includes(COPY.widthAtSize(formatPlain(cost.width!))));
  // No pill: a block never runs.
  assert.ok(view.container.querySelector(".mj-notebook-block-cell .mj-notebook-cell-pill") === null);
});

test("the size control recomputes every line with the planner at the new size", () => {
  const view = renderNotebook([blockCell("b01", GROVER)]);
  const resolved = resolveBlockPlan(CATALOG.graph, GROVER);
  if (resolved.kind !== "placed") throw new Error("not placed");
  const at = resolved.sizes.indexOf(16384);
  fireEvent.change(slider(view), { target: { value: String(at) } });
  const cost = blockCostAt(CATALOG.graph, resolved, 16384);
  const shown = text(view);
  for (const line of cost.report.lines) assert.ok(shown.includes(formatCostValue(line)), line.id);
  assert.ok(shown.includes(formatPlain(16384)));
  assert.ok(shown.includes(COPY.widthAtSize(formatPlain(cost.width!))));
  assert.ok(!shown.includes(COPY.planSize));
});

test("a stage below the root says its numbers are the whole workflow's", () => {
  const ref: BlockRef = { ...GROVER, method: "register-phase-estimation", plan: { problem: "ground-state", params: {}, choices: {} }, size_param: null };
  const view = renderNotebook([blockCell("b01", ref)]);
  assert.ok(text(view).includes(COPY.wholeWorkflow));
});

// ------------------------------------------------------------------------- prose and holes

test("a method with no planner numbers shows its source's cost text and citations", () => {
  const view = renderNotebook(
    [blockCell("b01", { ...GROVER, method: "product-formula-simulation", plan: null, size_param: null }), checkCell("k01", "b01")],
    [verdict("k01", "pass", 4)],
  );
  const shown = text(view);
  // No size to place, so the boundary says past what width the source's words are all there is.
  const cited = CATALOG.methods.find((candidate) => candidate.id === "product-formula-simulation")!.citations[0];
  assert.ok(shown.includes(COPY.proseBeyond("4", `${cited.authors.split(",")[0].trim().split(/\s+/).pop()} et al. ${cited.year}`)));
  assert.ok(shown.includes(COPY.proseHeading));
  const method = CATALOG.methods.find((candidate) => candidate.id === "product-formula-simulation")!;
  assert.ok(method.citations.length > 0);
  const cite = view.container.querySelector<HTMLAnchorElement>(".mj-notebook-block-citations a");
  assert.equal(cite?.getAttribute("href"), method.citations[0].url);
  assert.ok(view.container.querySelector(".mj-notebook-block-size") === null);
});

test("a method whose cost the Atlas does not record is a hole with the Atlas's reason", () => {
  const view = renderNotebook([blockCell("b01", { ...GROVER, method: "koopman-linearization", plan: null, size_param: null })]);
  const shown = text(view);
  assert.ok(shown.includes(COPY.holeHeading));
  assert.ok(shown.includes(COPY.holeReason));
  assert.match(shown, /Katz/);
  // Nothing is shown as a cost, so nothing is called anyone's claim.
  assert.doesNotMatch(shown, /'s claim/);
});

test("an id the Atlas does not have is a hole that says so", () => {
  const view = renderNotebook([blockCell("b01", { ...GROVER, method: "no-such-method", plan: null, size_param: null })]);
  assert.ok(text(view).includes(COPY.unknownMethod("no-such-method")));
});

test("a plan that no longer places the method says so and falls back to the source's words", () => {
  const view = renderNotebook([blockCell("b01", { ...GROVER, method: "koopman-linearization" })]);
  assert.ok(text(view).includes(COPY.unplaced(problemById("search")!.label.en)));
  assert.ok(text(view).includes(COPY.holeHeading)); // koopman's own cost is an absence
});

test("loading, failed and unavailable Atlas slices each say what is happening", () => {
  const loading = renderNotebook([blockCell("b01", GROVER)], [], { blockCatalog: { status: "loading" } });
  assert.ok(text(loading).includes(COPY.loading));
  loading.unmount();
  const failed = renderNotebook([blockCell("b01", GROVER)], [], { blockCatalog: { status: "error" } });
  assert.ok(text(failed).includes(COPY.loadFailed));
  failed.unmount();
  const shared = renderNotebook([blockCell("b01", GROVER)], [], { blockCatalog: { status: "unavailable" } });
  assert.ok(text(shared).includes(COPY.unavailable));
});

// ------------------------------------------------------------------------- the evidence

test("evidence inside the checked range, then beyond it with the source named", () => {
  const view = renderNotebook(
    [blockCell("b01", GROVER), checkCell("k01", "b01"), checkCell("k02", "b01"), checkCell("k03", "b01", "value")],
    [verdict("k01", "pass", 10), verdict("k02", "fail", 12), verdict("k03", "pass", null)],
  );
  let shown = text(view);
  assert.ok(shown.includes(COPY.boundary("10")));
  // The plan's size (N = 1,024) needs 10 qubits: inside what the checks ran.
  assert.ok(shown.includes(COPY.within("10")));
  assert.ok(shown.includes(COPY.evidenceChecked("10")));
  assert.ok(shown.includes(COPY.evidenceChecked("12"))); // listed, but a fail moves nothing
  assert.ok(shown.includes(COPY.evidenceValue));
  // One step right: 2,048 items need 11 qubits, past the widest passing check.
  const resolved = resolveBlockPlan(CATALOG.graph, GROVER);
  if (resolved.kind !== "placed") throw new Error("not placed");
  fireEvent.change(slider(view), { target: { value: String(resolved.sizes.indexOf(2048)) } });
  shown = text(view);
  const paper = CATALOG.papers.find((candidate) => candidate.id === PLANNER_SOURCES["bbht-iterations"].paperId)!;
  assert.ok(paper);
  const source = `${paper.authors.split(",")[0].trim().split(/\s+/).pop()} et al. ${paper.year}`;
  assert.ok(shown.includes(COPY.beyond("10", "11", source)), `expected the beyond sentence naming ${source}`);
  assert.ok(shown.includes(COPY.ceilings("18", "14", "8", "10")));
  assert.doesNotMatch(shown, /verified/i);
});

test("with no passing check, every size is the source's claim", () => {
  const view = renderNotebook([blockCell("b01", GROVER), checkCell("k01", "b01")], []);
  const shown = text(view);
  assert.ok(shown.includes(COPY.noBoundary));
  assert.match(shown, /the cost above is .+'s claim/);
});

test("a block with no linked check says how to add one", () => {
  const view = renderNotebook([blockCell("b01", GROVER), checkCell("k01", null)], [verdict("k01", "pass", 3)]);
  assert.ok(text(view).includes(COPY.evidenceEmpty));
});

// ------------------------------------------------------------------------- the audit line

test("a stage Leona audited shows the cost formula audit, gaps first-class", () => {
  const qaoa: BlockRef = {
    ...GROVER,
    method: "qaoa-cost-mixer-alternation",
    plan: { problem: "maxcut", params: { nodes: 6, edges: 9, layers: 1 }, choices: {} },
    size_param: "nodes",
  };
  const view = renderNotebook([blockCell("b01", qaoa)]);
  const shown = text(view);
  assert.ok(shown.includes(COPY.auditHeading));
  const gaps = CATALOG.audit.filter((row) => row.stage === "qaoa-cost-mixer-alternation" && row.verdict === "gap");
  assert.ok(gaps.length > 0);
  assert.match(shown, /counts differ/);
  assert.match(shown, /counts match/);
  view.unmount();
  const grover = renderNotebook([blockCell("b02", GROVER)]);
  assert.ok(!text(grover).includes(COPY.auditHeading));
});

// ------------------------------------------------------------------------- where numbers come from

test("every number on the card comes from the planner, the report, the audit or the contract's ceilings", () => {
  const cells = [blockCell("b01", GROVER), checkCell("k01", "b01"), checkCell("k02", "b01", "value")];
  const results = [verdict("k01", "pass", 10), verdict("k02", "pass", null)];
  const view = renderNotebook(cells, results);
  const resolved = resolveBlockPlan(CATALOG.graph, GROVER);
  if (resolved.kind !== "placed") throw new Error("not placed");
  const allowedFor = (size: number): Set<string> => {
    const cost = blockCostAt(CATALOG.graph, resolved, size);
    // Exactly what the planner, the report and the contract hand the card, and nothing
    // broader: a corpus that swallowed whole source tables would absorb a stray number.
    const lineText = cost.report.lines.flatMap((line) => [line.label.en, line.note?.en ?? "", line.formula, line.unit.en, formatCostValue(line)]);
    const sourceText = cost.report.lines.flatMap((line) => {
      if (!line.source) return [];
      const entry = PLANNER_SOURCES[line.source];
      const paper = CATALOG.papers.find((candidate) => candidate.id === entry.paperId);
      return [entry.locator, paper?.year ?? ""];
    });
    const corpus = [
      ...lineText,
      ...sourceText,
      ...cost.report.notes.map((note) => note.en),
      ...Object.values(cost.params).map((value) => (value?.value === null || value?.value === undefined ? "" : formatPlain(value.value))),
      ...resolved.sizes.map((x) => formatPlain(x)),
      cost.width === null ? "" : formatPlain(cost.width),
      ...results.map((result) => (result.check?.qubits === null || result.check?.qubits === undefined ? "" : formatPlain(result.check.qubits))),
      ...Object.values(CHECK_QUBIT_CEILING).map((n) => formatPlain(n)),
      "k01 k02", // the evidence statements name their cells
    ].join(" ");
    return new Set(corpus.match(/\d+(?:[.,]\d+)*/g) ?? []);
  };
  const check = (size: number) => {
    const allowed = allowedFor(size);
    // The chart's axis ticks are a scale (1, 10, 100), not a claim, so the SVG is left out.
    const card = view.container.querySelector(".mj-notebook-block")!.cloneNode(true) as HTMLElement;
    for (const svg of card.querySelectorAll("svg")) svg.remove();
    const shown = card.textContent ?? "";
    const stray = (shown.match(/\d+(?:[.,]\d+)*/g) ?? []).filter((token) => !allowed.has(token));
    assert.deepEqual(stray, [], `numbers on the card with no source at size ${size}`);
  };
  check(1024);
  fireEvent.change(slider(view), { target: { value: String(resolved.sizes.indexOf(4096)) } });
  check(4096);
});

// ------------------------------------------------------------------------- accept

test("a Nala block offers Accept only where editing is allowed", () => {
  const nala = { ...GROVER, author: "nala" as const, accepted: false };
  const accepted: string[] = [];
  const editable = renderNotebook([blockCell("b01", nala)], [], { onAcceptBlock: (id: string) => accepted.push(id) });
  const button = [...editable.container.querySelectorAll("button")].find((b) => b.textContent === NOTEBOOK_CHECK_COPY.en.accept);
  assert.ok(button);
  fireEvent.click(button!);
  assert.deepEqual(accepted, ["b01"]);
  editable.unmount();
  const readOnly = renderNotebook([blockCell("b01", nala)]);
  assert.ok(
    [...readOnly.container.querySelectorAll("button")].find((b) => b.textContent === NOTEBOOK_CHECK_COPY.en.accept) === undefined,
  );
  assert.match(text(readOnly), /Proposed by Nala/);
});

// ------------------------------------------------------------------------- the forms

test("the add-block form searches the Atlas, attaches a planner stage and saves the inputs only", () => {
  const saved: BlockRef[] = [];
  const view = render(
    <NotebookAddBlockForm afterId="c01" catalog={CATALOG} locale="en" copy={COPY} onCancel={() => {}} onSubmit={(ref) => saved.push(ref)} />,
  );
  fireEvent.change(view.getByLabelText(COPY.searchLabel), { target: { value: "grover" } });
  // "grover" matches the method by its id; its Atlas name does not say Grover.
  const pick = [...view.container.querySelectorAll(".mj-notebook-add-block-results button")].find(
    (b) => b.textContent === GROVER_LABEL,
  );
  assert.ok(pick, "the search lists the Grover method");
  fireEvent.click(pick!);
  const numbers = view.getByLabelText(COPY.numbersLabel) as HTMLSelectElement;
  const searchLabel = problemById("search")!.label.en;
  const option = [...numbers.options].find((o) => o.textContent?.startsWith(searchLabel));
  assert.ok(option, "the search problem is offered");
  fireEvent.change(numbers, { target: { value: option!.value } });
  const inputs = view.container.querySelectorAll<HTMLInputElement>("fieldset input");
  fireEvent.change(inputs[0], { target: { value: "4096" } });
  fireEvent.change(view.getByLabelText(COPY.sizeParamLabel), { target: { value: "domainSize" } });
  fireEvent.click(view.getByText(COPY.submit));
  assert.equal(saved.length, 1);
  const ref = saved[0];
  assert.equal(ref.method, "grover-fixed-iteration-search");
  assert.deepEqual(ref.plan, { problem: "search", params: { domainSize: 4096 }, choices: {} });
  assert.equal(ref.size_param, "domainSize");
  assert.equal(ref.author, "user");
  // Inputs only: nothing the planner computes is in what is saved.
  assert.ok(!JSON.stringify(ref).includes("iterations"));
});

test("the add-block form refuses a value the planner cannot use, and saves a prose-only block", () => {
  const saved: BlockRef[] = [];
  const view = render(
    <NotebookAddBlockForm afterId="c01" catalog={CATALOG} locale="en" copy={COPY} onCancel={() => {}} onSubmit={(ref) => saved.push(ref)} />,
  );
  fireEvent.click(view.getByText(COPY.submit));
  assert.ok(text(view).includes(COPY.pickMethodFirst));
  fireEvent.change(view.getByLabelText(COPY.searchLabel), { target: { value: "grover" } });
  fireEvent.click([...view.container.querySelectorAll(".mj-notebook-add-block-results button")].find((b) => b.textContent === GROVER_LABEL)!);
  const numbers = view.getByLabelText(COPY.numbersLabel) as HTMLSelectElement;
  fireEvent.change(numbers, {
    target: { value: [...numbers.options].find((o) => o.textContent?.startsWith(problemById("search")!.label.en))!.value },
  });
  fireEvent.change(view.container.querySelectorAll<HTMLInputElement>("fieldset input")[0], { target: { value: "-3" } });
  fireEvent.click(view.getByText(COPY.submit));
  assert.equal(saved.length, 0);
  assert.match(text(view), /is not a number the planner can use/);
  fireEvent.change(numbers, { target: { value: "-1" } });
  fireEvent.click(view.getByText(COPY.submit));
  assert.deepEqual(saved[0], { method: "grover-fixed-iteration-search", plan: null, size_param: null, author: "user", citation: "", accepted: true });
});

test("the add-block form waits for the Atlas", () => {
  const view = render(<NotebookAddBlockForm afterId="c01" catalog={null} locale="en" copy={COPY} onCancel={() => {}} onSubmit={() => {}} />);
  assert.ok(text(view).includes(COPY.loading));
});

test("the add-check form can mark a check as evidence for one of the notebook's blocks", () => {
  const saved: CheckProperty[] = [];
  const view = render(
    <NotebookAddCheckForm
      afterId="c01"
      subjectHint="qc"
      copy={NOTEBOOK_CHECK_COPY.en}
      onCancel={() => {}}
      onSubmit={(property) => saved.push(property)}
      blockOptions={[{ id: "b01", label: GROVER_LABEL }]}
    />,
  );
  fireEvent.change(view.getByLabelText(NOTEBOOK_CHECK_COPY.en.evidenceForLabel), { target: { value: "b01" } });
  fireEvent.click(view.getByText(NOTEBOOK_CHECK_COPY.en.submit));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].block, "b01");
  view.unmount();
  // Queries are bound to document.body, so the first form must be gone before asking
  // whether the second has the select (and a DOM node is never handed to assert.equal,
  // whose failure message would try to print the whole jsdom window).
  const none = render(
    <NotebookAddCheckForm afterId="c01" subjectHint="qc" copy={NOTEBOOK_CHECK_COPY.en} onCancel={() => {}} onSubmit={() => {}} />,
  );
  assert.ok(none.queryByLabelText(NOTEBOOK_CHECK_COPY.en.evidenceForLabel) === null);
});

test("a code cell offers Add a block where editing is allowed", () => {
  const started: string[] = [];
  const code: Cell = { ...checkCell("c01", null), role: "run", property: null, source: "qc = 1" };
  const view = renderNotebook([code], [], { onStartAddBlock: (id: string) => started.push(id) });
  fireEvent.click(view.getByText(COPY.addBlock));
  assert.deepEqual(started, ["c01"]);
});
