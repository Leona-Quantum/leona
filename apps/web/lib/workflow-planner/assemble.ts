// From a problem to a workflow: a walk down the layer graph's containment.
//
// A capability is realised by one of its methods; a method needs a list of
// smaller capabilities (`steps`); each of those is realised by one of ITS
// methods; and so on. A workflow is one choice at every capability on that
// walk. The planner makes a default choice and says why, and the reader can
// replace any choice with any other method that realises the same capability —
// the "lego" the owner asked the Atlas to be (block-repository roadmap §0.1).
//
// ## How a default is chosen, in order, and what the page says about it
//
// 1. `reader` — the reader picked it.
// 2. `published` — the parent method's own `via` names the method its source
//    used for this step. This is the only choice with a paper behind it.
// 3. `preferred` — the problem's `preferredMethods` (root only), a planner
//    ordering stated in `./problems.ts`.
// 4. `first` — the first realiser in the graph's authored order. Arbitrary,
//    and the page says so rather than dressing it as a recommendation.
//
// ## What this module will not do
//
// - **Walk forever.** The containment has loops (`fixed-point-amplification`
//   needs `state-preparation`, and a state-preparation method can need
//   amplification), so a capability already on the current path is not
//   expanded again, and depth is capped. Both stops are reported on the stage,
//   never silent — a quietly shortened tree reads like a simpler workflow.
// - **Claim two blocks compose.** A path the graph admits is a fact about the
//   contracts; whether the physics lines up is a different claim (roadmap §6).
//   The page shows the walk; it never prints a green "compatible".
import { indexPlannerGraph, type IndexedGraph, type PlannerGraph, type PlannerNode, type PlannerRepeat } from "./graph.ts";
import type { ProblemClass } from "./problems.ts";
import type { Bilingual } from "./types.ts";

export const MAX_STAGE_DEPTH = 3;

export type StageChoice = "reader" | "published" | "preferred" | "first" | "none";

export interface Stage {
  /** Stable address of this position in the tree, e.g. `quantum-linear-solve/state-preparation`. */
  path: string;
  depth: number;
  capability: PlannerNode;
  method: PlannerNode | null;
  choice: StageChoice;
  /** Why the planner started here, when the choice is "preferred" below the root. */
  reason: Bilingual | null;
  /** Every method realising this capability, the chosen one included. */
  alternatives: PlannerNode[];
  /** How often the parent's route runs this step, where the source says. */
  repeat: PlannerRepeat | null;
  children: Stage[];
  stop: "cycle" | "depth" | null;
}

/** Path → method id, for the positions the reader has changed. */
export type MethodChoices = Readonly<Record<string, string>>;

function chooseMethod(
  index: IndexedGraph,
  capabilityId: string,
  path: string,
  choices: MethodChoices,
  parent: PlannerNode | null,
  preferred: readonly string[],
  stepDefault: { method: string; reason: Bilingual } | undefined,
): { method: PlannerNode | null; choice: StageChoice; reason: Bilingual | null } {
  const realisers = index.realisers.get(capabilityId) ?? [];
  const byId = (id: string | undefined) => realisers.find((node) => node.id === id) ?? null;
  const reader = byId(choices[path]);
  if (reader) return { method: reader, choice: "reader", reason: null };
  const published = byId(parent?.via[capabilityId]);
  if (published) return { method: published, choice: "published", reason: null };
  const defaulted = byId(stepDefault?.method);
  if (defaulted && stepDefault) return { method: defaulted, choice: "preferred", reason: stepDefault.reason };
  for (const id of preferred) {
    const node = byId(id);
    if (node) return { method: node, choice: "preferred", reason: null };
  }
  const first = realisers[0] ?? null;
  return { method: first, choice: first ? "first" : "none", reason: null };
}

function buildStage(
  index: IndexedGraph,
  capabilityId: string,
  path: string,
  depth: number,
  onPath: ReadonlySet<string>,
  choices: MethodChoices,
  parent: PlannerNode | null,
  preferred: readonly string[],
  stepDefaults: ProblemClass["stepDefaults"],
): Stage | null {
  const capability = index.byId.get(capabilityId);
  if (!capability || capability.kind !== "capability") return null;
  const stepDefault = depth > 0 ? stepDefaults?.[capabilityId] : undefined;
  const { method, choice, reason } = chooseMethod(index, capabilityId, path, choices, parent, preferred, stepDefault);
  const stage: Stage = {
    path,
    depth,
    capability,
    method,
    choice,
    reason,
    alternatives: index.realisers.get(capabilityId) ?? [],
    repeat: parent?.repeats[capabilityId] ?? null,
    children: [],
    stop: null,
  };
  if (!method || method.steps.length === 0) return stage;
  if (depth >= MAX_STAGE_DEPTH) {
    stage.stop = "depth";
    return stage;
  }
  const nextPath = new Set(onPath).add(capabilityId);
  for (const step of method.steps) {
    if (nextPath.has(step)) {
      // The step is a capability already being expanded above this one. Shown
      // as a stage that stops, so the loop is visible rather than elided.
      const looped = index.byId.get(step);
      if (looped && looped.kind === "capability") {
        stage.children.push({
          path: `${path}/${step}`,
          depth: depth + 1,
          capability: looped,
          method: null,
          choice: "none",
          reason: null,
          alternatives: index.realisers.get(step) ?? [],
          repeat: method.repeats[step] ?? null,
          children: [],
          stop: "cycle",
        });
      }
      continue;
    }
    const child = buildStage(index, step, `${path}/${step}`, depth + 1, nextPath, choices, method, [], stepDefaults);
    if (child) stage.children.push(child);
  }
  return stage;
}

export function assembleWorkflow(graph: PlannerGraph | IndexedGraph, problem: ProblemClass, choices: MethodChoices = {}): Stage | null {
  const index = "byId" in graph ? graph : indexPlannerGraph(graph);
  return buildStage(index, problem.capability, problem.capability, 0, new Set(), choices, null, problem.preferredMethods, problem.stepDefaults);
}

/** Every stage in the tree, parents before children — for lookups and counts. */
export function flattenStages(root: Stage | null): Stage[] {
  if (!root) return [];
  const out: Stage[] = [];
  const walk = (stage: Stage) => {
    out.push(stage);
    for (const child of stage.children) walk(child);
  };
  walk(root);
  return out;
}

/** The method chosen at the first stage realising this capability, if any. */
export function chosenMethodFor(root: Stage | null, capabilityId: string): string | null {
  return flattenStages(root).find((stage) => stage.capability.id === capabilityId)?.method?.id ?? null;
}

// ---------------------------------------------------------------------------
// Compilation: the last block of every workflow

/**
 * Methods built to run without error correction. For these the planner starts
 * the compile stage on NISQ transpilation; for everything else, on
 * fault-tolerant compilation, because their cost lines are counted in Toffoli
 * and T gates, which already assumes an error-corrected machine. The reader can
 * switch either way — this only picks the first choice, and the page says why.
 */
const RUNS_WITHOUT_ERROR_CORRECTION = new Set([
  "variational-ground-state",
  "variational-imaginary-time",
  "qaoa-cost-mixer-alternation",
]);

export const COMPILE_CAPABILITY = "compile-to-device";

export function compileStage(graph: PlannerGraph | IndexedGraph, root: Stage | null, choices: MethodChoices = {}): Stage | null {
  const index = "byId" in graph ? graph : indexPlannerGraph(graph);
  const nisqFirst = root?.method ? RUNS_WITHOUT_ERROR_CORRECTION.has(root.method.id) : false;
  const preferred = nisqFirst ? ["nisq-transpilation"] : ["fault-tolerant-compilation"];
  return buildStage(index, COMPILE_CAPABILITY, COMPILE_CAPABILITY, 0, new Set(), choices, null, preferred, undefined);
}

export function compilesWithoutErrorCorrection(root: Stage | null): boolean {
  return root?.method ? RUNS_WITHOUT_ERROR_CORRECTION.has(root.method.id) : false;
}
