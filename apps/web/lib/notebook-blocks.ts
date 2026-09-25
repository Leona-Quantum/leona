/**
 * Pure logic for block cells (ai-ops 382, Phase B slice S1; plan:
 * `~/Developer/ai-ops/desk/leona/plans/platform-vision-20260924/phase-b/PLAN.md`,
 * VISION §5.3 "one algorithm at three sizes"). A `role=block` cell places one Atlas
 * method in a notebook. Its `BlockRef` stores the workflow planner's INPUTS (problem,
 * parameter values, the method chosen at each stage), never a number, so every number
 * the card shows is worked out here, by the planner, at the size on screen.
 *
 * Three things are joined, and each keeps its own provenance:
 *
 * 1. **The cost**, from the planner (`workflow-planner/`): the same `CostLine`s the
 *    planner page prints, with their kind and source. When the method is not a stage of
 *    a planner problem there is no numeric model, and the method's own cost text is shown
 *    as its source states it; when that is missing too, the Atlas's stated reason.
 * 2. **The evidence**, from the report: the notebook's check cells that name this block
 *    (`CheckProperty.block`), with the verdict the worker wrote and the width it judged.
 *    Only checks a person wrote or accepted count (review of PR 1019, B1: an unaccepted
 *    Nala check linked to a block set its boundary). The boundary is the widest passing
 *    counted check, capped by the contract's width ceilings; a counted fail or
 *    inconclusive at or below it cancels it (B2). The link is the author's claim that a
 *    check tests this method; Leona has not checked that, and the card says so. Past the
 *    boundary, the number is the source's claim, and the card names the source.
 * 3. **The formula audit**, from `workflow-planner/block-audit.ts` (PR 1017): where Leona
 *    has counted its own block's gates against this stage's cost formula.
 *
 * Words: "checked" for a check's verdict, "counted" for a gate count, never "verified".
 *
 * No React, no DOM: `components/notebook-block-card.tsx` and
 * `components/notebook-add-block-form.tsx` render this.
 */
import type { components } from "@majorana/contracts-gen";
import { assembleWorkflow, flattenStages, type Stage } from "./workflow-planner/assemble.ts";
import { costReport, type CostReport } from "./workflow-planner/costs.ts";
import { indexPlannerGraph, type IndexedGraph, type PlannerGraph } from "./workflow-planner/graph.ts";
import { planWorkflow } from "./workflow-planner/index.ts";
import { PROBLEMS, problemById, type ProblemClass } from "./workflow-planner/problems.ts";
import { nudge, sweepableParams, sweepValues, withValue } from "./workflow-planner/scaling.ts";
import { validateStudioPlanPayload, type StudioPlanLink } from "./workflow-planner/studio-link.ts";
import type { AuditRow } from "./workflow-planner/block-audit.ts";
import type { SourceKey } from "./workflow-planner/sources.ts";
import type { CostLine, ParamKey, ParamValues, ProblemId } from "./workflow-planner/types.ts";
import type { NotebookCellView } from "./notebook-view";

type Cell = components["schemas"]["Cell"];
export type BlockRef = components["schemas"]["BlockRef"];
export type BlockPlan = components["schemas"]["BlockPlan"];
type CheckProperty = components["schemas"]["CheckProperty"];
type CheckKind = CheckProperty["kind"];

// ------------------------------------------------------------------------- the catalog

/** One Atlas method, as the server hands it to the notebook page
 * (`lib/notebook-block-catalog.ts`). Every string is the layer graph's own field, in
 * the page's language; nothing is paraphrased. */
export interface BlockMethod {
  id: string;
  label: string;
  /** The capability it realises, and that capability's label. */
  realizes: string | null;
  capabilityLabel: string | null;
  /** The cost as the method's primary source states it, `$…$` maths intact. */
  cost: string | null;
  /** Why `cost` is empty, when the Atlas records a reason (`LayerMethod.absences.cost`). */
  costAbsence: string | null;
  citations: BlockCitation[];
}

export interface BlockCitation {
  title: string;
  authors: string;
  year: string;
  url: string;
}

/** A paper-register row the planner cites (`workflow-planner/sources.ts`). */
export interface BlockPaper {
  id: string;
  title: string;
  authors: string;
  year: string;
  url: string;
}

export interface BlockCatalog {
  locale: "en" | "ja";
  /** The planner's lean graph (ids, labels and route structure, no prose). */
  graph: PlannerGraph;
  methods: BlockMethod[];
  papers: BlockPaper[];
  /** `auditBlocks()`'s rows, computed once on the server. */
  audit: AuditRow[];
}

// ------------------------------------------------------------------------- contract mirrors

/**
 * The widest circuit a check of each kind judges: `CHECK_STATE_MAX_QUBITS`,
 * `CHECK_DISTRIBUTION_MAX_QUBITS`, `CHECK_UNITARY_MAX_QUBITS` and
 * `MAX_CHECK_HAMILTONIAN_QUBITS` in `packages/py/contracts/src/majorana_contracts/
 * notebooks.py`. Not in the OpenAPI schema (they are module constants), so restated;
 * `notebook-blocks.test.ts` reads them back from that file and fails if they drift. A
 * `value` check judges a number, not a circuit, and has no width.
 */
export const CHECK_QUBIT_CEILING: Readonly<Record<Exclude<CheckKind, "value">, number>> = {
  state: 18,
  distribution: 14,
  unitary: 8,
  energy: 10,
};

// ------------------------------------------------------------------------- the plan

export type ResolvedPlan =
  | {
      kind: "placed";
      problem: ProblemClass;
      link: StudioPlanLink;
      /** The stage in the planner's tree whose chosen method is this block's method. */
      stage: Stage;
      /** Whether that stage is the problem's root: then the cost lines are this method's own. */
      isRoot: boolean;
      /** The problem-size parameter the control moves, or null when none moves a number. */
      sizeParam: ParamKey | null;
      /** The sizes the control steps through, and which one the plan itself names. */
      sizes: number[];
      planSizeIndex: number;
    }
  /** The plan reads, but the planner no longer puts this method anywhere in that problem. */
  | { kind: "unplaced"; problem: ProblemClass }
  /** The stored plan does not describe any planner input the planner accepts today. */
  | { kind: "invalid" }
  | { kind: "none" };

/** The planner's own validator for a Studio plan link, applied to a block's plan: the
 * same rule, so "a plan" means one thing everywhere it is carried. */
export function blockPlanLink(plan: BlockPlan | null | undefined): StudioPlanLink | null {
  if (!plan) return null;
  return validateStudioPlanPayload({
    v: 1,
    text: "",
    problem: plan.problem,
    params: plan.params ?? {},
    choices: plan.choices ?? {},
  });
}

function asIndex(graph: PlannerGraph | IndexedGraph): IndexedGraph {
  return "byId" in graph ? graph : indexPlannerGraph(graph);
}

/** Where the block sits in its problem's workflow, and the sizes the control offers. */
export function resolveBlockPlan(graph: PlannerGraph | IndexedGraph, ref: BlockRef): ResolvedPlan {
  if (!ref.plan) return { kind: "none" };
  const link = blockPlanLink(ref.plan);
  const problem = link ? problemById(link.problem) : undefined;
  if (!link || !problem) return { kind: "invalid" };
  const index = asIndex(graph);
  const plan = planWorkflow(index, "", { problem: link.problem, params: link.params, choices: link.choices });
  const stage = flattenStages(plan.root).find((candidate) => candidate.method?.id === ref.method);
  if (!stage || !plan.root) return { kind: "unplaced", problem };
  const choices = sizeParamChoices(problem, plan.params, plan.root);
  const stored = ref.size_param && choices.includes(ref.size_param as ParamKey) ? (ref.size_param as ParamKey) : null;
  const sizeParam = stored ?? choices[0] ?? null;
  const spec = sizeParam ? problem.params.find((p) => p.key === sizeParam) : undefined;
  const current = sizeParam ? plan.params[sizeParam]?.value ?? null : null;
  const sizes = spec && current !== null ? sweepValues(spec, current) : [];
  return {
    kind: "placed",
    problem,
    link,
    stage,
    isRoot: stage.path === plan.root.path,
    sizeParam: sizes.length > 0 ? sizeParam : null,
    sizes,
    planSizeIndex: current !== null ? Math.max(0, sizes.indexOf(current)) : 0,
  };
}

/**
 * The parameters the size control may move, best first. A "size" is what the evidence
 * boundary is measured in, so the parameters whose change moves the plan's logical-qubit
 * count come first, and only they are offered when there are any (review of PR 1019, S4:
 * a block saved with `size_param="markedCount"` moved a slider that never changed the
 * width). A problem whose plan states no width at all falls back to the parameters that
 * move any logical figure, and the card then says a size cannot be placed against the
 * checks.
 */
export function sizeParamChoices(problem: ProblemClass, params: ParamValues, root: Stage | null): ParamKey[] {
  const width = (values: ParamValues) => costReport(problem.id, values, root).logical.logicalQubits?.value ?? null;
  const base = width(params);
  const movesWidth = problem.params
    .filter((spec) => {
      const value = params[spec.key]?.value;
      if (value === null || value === undefined) return false;
      const moved = nudge(spec, value);
      return moved !== null && width(withValue(params, spec.key, moved)) !== base;
    })
    .map((spec) => spec.key);
  return movesWidth.length > 0 ? movesWidth : sweepableParams(problem.id, params, root);
}

/** `sizeParamChoices` for a plan being typed into the "Add a block" form. */
export function sizeParamChoicesFor(
  graph: PlannerGraph | IndexedGraph,
  problem: ProblemId,
  params: Partial<Record<ParamKey, number | null>>,
  choices: Record<string, string>,
): ParamKey[] {
  const plan = planWorkflow(asIndex(graph), "", { problem, params, choices });
  return plan.problem ? sizeParamChoices(plan.problem, plan.params, plan.root) : [];
}

export interface BlockCostAtSize {
  report: CostReport;
  params: ParamValues;
  /** The workflow the numbers were worked out for, for the scaling view. */
  root: Stage | null;
  /** The circuit's width at this size, where the plan states one (its logical-qubit line). */
  width: number | null;
}

/** The planner's cost report for the block's plan with the size parameter at `size`. */
export function blockCostAt(
  graph: PlannerGraph | IndexedGraph,
  placed: Extract<ResolvedPlan, { kind: "placed" }>,
  size: number | null,
): BlockCostAtSize {
  const params = { ...placed.link.params };
  if (placed.sizeParam && size !== null) params[placed.sizeParam] = size;
  const plan = planWorkflow(asIndex(graph), "", { problem: placed.link.problem, params, choices: placed.link.choices });
  const report = plan.costs as CostReport;
  const qubits = report.logical.logicalQubits;
  const width =
    qubits && qubits.kind !== "scaling" && qubits.value !== null && Number.isFinite(qubits.value) ? qubits.value : null;
  return { report, params: plan.params, root: plan.root, width };
}

/** The distinct sources of the numbers on screen, for "beyond this size the number is
 * [source]'s claim". Lines with no value (a missing input) claim nothing. */
export function claimSources(lines: readonly CostLine[]): SourceKey[] {
  const seen: SourceKey[] = [];
  for (const line of lines) {
    if (line.value === null || !line.source) continue;
    if (!seen.includes(line.source)) seen.push(line.source);
  }
  return seen;
}

// ------------------------------------------------------------------------- the evidence

export type EvidenceStatus = "pass" | "fail" | "inconclusive" | "not_run";

export interface BlockEvidence {
  cellId: string;
  statement: string;
  kind: CheckKind;
  status: EvidenceStatus;
  /** The width the worker judged, from the verdict. `null` before a run and for a `value` check. */
  qubits: number | null;
  author: CheckProperty["author"];
  accepted: boolean;
  citation: string;
  /** Whether a person wrote or accepted this check, so it counts toward the boundary: a
   * `user` or `source` check, or a Nala check someone accepted. An unaccepted Nala
   * proposal is listed and never counted. */
  counted: boolean;
}

/** The notebook's check cells that name `blockId`, with what the worker's report says of
 * each. Only the report's verdicts count: a check that has not run is listed, never
 * counted. */
export function blockEvidence(blockId: string, cells: readonly NotebookCellView[]): BlockEvidence[] {
  const rows: BlockEvidence[] = [];
  for (const cell of cells) {
    const property = cell.checkProperty;
    if (cell.role !== "check" || !property || property.block !== blockId) continue;
    const verdict = cell.checkVerdict;
    rows.push({
      cellId: cell.id,
      statement: property.statement || cell.source.replace(/^# check:\s*/, "").trim(),
      kind: property.kind,
      status: verdict?.status ?? "not_run",
      qubits: property.kind === "value" ? null : (verdict?.qubits ?? null),
      author: property.author,
      accepted: property.accepted,
      citation: property.citation,
      counted: property.author !== "nala" || property.accepted,
    });
  }
  return rows;
}

export interface EvidenceBoundary {
  /** How many linked checks count (a person wrote or accepted them), and how many of
   * those pass. The card states both, so a lone pass among fails reads as one. */
  counted: number;
  passing: number;
  /** The widest circuit a passing counted check judged, capped at the width its kind can
   * judge at all. `null` when no counted check with a circuit has passed. */
  widest: number | null;
  /** Counted checks that fail or could not judge at or below `widest` (or with no width
   * to compare, such as a failing `value` check). Any one of them means the linked checks
   * disagree about this method at sizes they all reached, so there is no boundary. */
  conflicts: number;
}

export function evidenceBoundary(rows: readonly BlockEvidence[]): EvidenceBoundary {
  const counted = rows.filter((row) => row.counted);
  let widest: number | null = null;
  for (const row of counted) {
    if (row.status !== "pass" || row.qubits === null || row.kind === "value") continue;
    const capped = Math.min(row.qubits, CHECK_QUBIT_CEILING[row.kind]);
    widest = widest === null ? capped : Math.max(widest, capped);
  }
  const conflicts =
    widest === null
      ? 0
      : counted.filter(
          (row) => (row.status === "fail" || row.status === "inconclusive") && (row.qubits === null || row.qubits <= widest!),
        ).length;
  return { counted: counted.length, passing: counted.filter((row) => row.status === "pass").length, widest, conflicts };
}

/** Where a width sits against the evidence. `unchecked`: no counted check with a circuit
 * passed. `contradicted`: a counted check fails where a counted one passes. `unplaced`:
 * the plan states no width at this size, so the card cannot say which side it is on. */
export type SizeStanding = "within" | "beyond" | "unplaced" | "unchecked" | "contradicted";

export function sizeStanding(width: number | null, boundary: EvidenceBoundary): SizeStanding {
  if (boundary.widest === null) return "unchecked";
  if (boundary.conflicts > 0) return "contradicted";
  if (width === null) return "unplaced";
  return width <= boundary.widest ? "within" : "beyond";
}

// ------------------------------------------------------------------------- the formula audit

export interface BlockAuditSummary {
  /** Rows where Leona counted a block's gates against a cost line: matches and gaps only. */
  counted: AuditRow[];
  matches: number;
  gaps: AuditRow[];
}

/** The audit rows for this stage that actually compared a count, or `null` when the
 * audit found nothing countable here (it then says nothing rather than "no gaps"). */
export function blockAudit(rows: readonly AuditRow[], methodId: string): BlockAuditSummary | null {
  const counted = rows.filter((row) => row.stage === methodId && row.verdict !== "not-countable");
  if (counted.length === 0) return null;
  const gaps = counted.filter((row) => row.verdict === "gap");
  return { counted, matches: counted.length - gaps.length, gaps };
}

// ------------------------------------------------------------------------- cells

/** The prose a new block cell starts with. The server re-renders it from the block
 * (`leona_notebooks.blocks.block_comment`), which is authoritative; this only has to read
 * sensibly for the moment before the saved version comes back. */
export function blockCellSource(ref: BlockRef): string {
  return `**Leona block: \`${ref.method}\`**, a method from Leona's Atlas.\n`;
}

/** A new block cell, `author="user"`, `accepted=true`: a reader who places a block has,
 * by placing it, accepted it. The server's authorship stamp re-derives both anyway. */
export function buildBlockCell(id: string, ref: BlockRef): Cell {
  const block: BlockRef = { ...ref, author: "user", accepted: true };
  return {
    id,
    kind: "markdown",
    role: "block",
    source: blockCellSource(block),
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

function nextId(cells: readonly Cell[]): string {
  const used = new Set(cells.map((cell) => cell.id));
  let index = 1;
  while (used.has(`c${String(index).padStart(2, "0")}`)) index += 1;
  return `c${String(index).padStart(2, "0")}`;
}

export function insertBlockCellAfter(
  cells: readonly Cell[],
  afterId: string | null,
  ref: BlockRef,
): { cells: Cell[]; id: string } {
  const id = nextId(cells);
  const created = buildBlockCell(id, ref);
  const index = afterId === null ? -1 : cells.findIndex((cell) => cell.id === afterId);
  const at = index === -1 && afterId !== null ? cells.length : index + 1;
  return { cells: [...cells.slice(0, at), created, ...cells.slice(at)], id };
}

/** Accept = `block.accepted = true` on one cell and nothing else. The author is left for
 * the server to decide. */
export function applyBlockAccept(cells: readonly Cell[], cellId: string): Cell[] {
  return cells.map((cell) => {
    if (cell.id !== cellId || !cell.block) return cell;
    return { ...cell, block: { ...cell.block, accepted: true } };
  });
}

/** The notebook's block cells, for the "Add a check" form's "evidence for" select. */
export function blockCellOptions(
  cells: readonly Pick<NotebookCellView, "id" | "role" | "block">[],
  methods: readonly BlockMethod[] | null,
): { id: string; label: string }[] {
  const byId = new Map((methods ?? []).map((method) => [method.id, method.label]));
  return cells
    .filter((cell) => cell.role === "block" && cell.block)
    .map((cell) => ({ id: cell.id, label: byId.get(cell.block!.method) ?? cell.block!.method }));
}

// ------------------------------------------------------------------------- adding a block

/** Methods whose label or id contains every word of `query`, labels first. */
export function searchMethods(methods: readonly BlockMethod[], query: string, limit = 8): BlockMethod[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = methods.filter((method) => {
    const text = `${method.label} ${method.id} ${method.capabilityLabel ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const starts = (method: BlockMethod) => (method.label.toLowerCase().startsWith(words[0]) ? 0 : 1);
  return [...hits].sort((a, b) => starts(a) - starts(b) || a.label.localeCompare(b.label)).slice(0, limit);
}

export interface StagePosition {
  problem: ProblemId;
  problemLabel: { en: string; ja: string };
  path: string;
  capabilityLabel: string;
  /** The choices a plan needs so that this method, not the planner's default, fills the stage. */
  choices: Record<string, string>;
}

/** Every place in a planner problem's default workflow where `methodId` can fill the
 * stage: the positions a block of this method can take its numbers from. */
export function stagePositions(graph: PlannerGraph | IndexedGraph, methodId: string): StagePosition[] {
  const index = asIndex(graph);
  const out: StagePosition[] = [];
  for (const problem of PROBLEMS) {
    for (const stage of flattenStages(assembleWorkflow(index, problem))) {
      if (!stage.alternatives.some((alternative) => alternative.id === methodId)) continue;
      out.push({
        problem: problem.id,
        problemLabel: problem.label,
        path: stage.path,
        capabilityLabel: stage.capability.label,
        choices: stage.method?.id === methodId ? {} : { [stage.path]: methodId },
      });
    }
  }
  return out;
}
