// What it means for a slot to be **closed**, and the record that says which are.
//
// ## The defect this exists for
//
// `linear-ode-solve` was drawn for two sessions as a two-lane state chain that
// three of its own seven methods refute (`drawsAsStateChain`, session 119). The
// drawing half is fixed and gated. The half that was never gated is the one the
// owner's ask is actually about: **is the population right?** Nothing in this
// repository could answer "are these seven the linear-ODE methods, or seven of
// them", because the graph has no notion of a population at all — a method is a
// node someone authored, and a method nobody authored is indistinguishable from
// a method that does not exist.
//
// A count with no denominator reads as a total. `methodsRealizing(graph, slot)`
// returns seven and says nothing about what seven is out of.
//
// ## The closure criteria — decided before the work, met or reported
//
// A slot is **closed** when all eight hold. Each is checked by
// `auditSlotClosure` or by `repository-slot-closure.test.ts`, and the numbers in
// brackets are the rule numbers in `auditSlotClosure`.
//
// 1. **The population is pinned to a citable enumeration.** Not to a curator's
//    judgement of what mattered. `source` names the paper and `sourceLocus` the
//    place in it, and the pin is a *floor*: the graph may hold members the
//    enumeration does not (Taylor, Krovi and Schrödingerisation are all absent
//    from An, Childs and Lin's Table 1 and all belong), but every member of the
//    enumeration must be dispositioned here. [1]
// 2. **Every method the graph records for the slot appears in the pin.** This is
//    the tripwire the closure rests on: an eighth method added to a closed slot
//    fails until someone writes its row, and writing the row is where the rest
//    of the criteria get asked. [2]
// 3. **Every pinned node resolves** to a method that really realizes the slot,
//    once. [3][4]
// 4. **Every pinned absence is citable and reasoned** — a name, a paper that
//    resolves, and why it is not authored. An absence with no reason is the
//    thing this record exists to stop being invisible. [5]
// 5. **Sourced:** every pinned node carries at least one citation and a
//    `conditions` in both locales. [6]
// 6. **Costed, or silent on the record:** a pinned node has a `cost`, or a
//    `costSilent` row saying which source was read and found to state none.
//    Exactly one of the two — a `costSilent` beside a populated `cost` is a row
//    that has gone stale, and it fails. [7][8]
// 7. **Routed:** every pinned node says how it crosses — at least one step, or
//    an explicit `bypasses`, or `atomic`. [9]
// 8. **Drawn and reachable:** every pinned node is a lane on its own slot's
//    figure, and that lane links to the method. Checked in the test, which is
//    where `layoutConverge` already is; this module stays pure over the graph so
//    that `check-layer-graph.mjs` can call it without the layout engine.
//
// ## Why this generalises, which is the whole point of it
//
// Closing the next family is: add a `SlotClosure`, and make the gate green. The
// gate then tells you, by name, every method missing a citation, a `conditions`,
// a cost or a lane — and it keeps telling you every time someone adds a method.
// Nothing here is specific to differential equations.
import type { LayerGraph } from "./layers.ts";
import { isMethod, layerNode } from "./layers.ts";

/** A paper, in the same shape `LayerCitation` uses, so a row reads like a node. */
export interface ClosureCitation {
  title: string;
  authors: string;
  year: string;
  url: string;
}

/** A member of the population the graph carries as a node. */
export interface ClosureNodeMember {
  node: string;
  /**
   * Set **only** when the node deliberately carries no `cost`, naming the source
   * that was read and found to state none.
   *
   * This is the difference between *nobody stated one* and *nobody looked*, and
   * the two render identically on the card — an absent `cost` prints the same
   * sentence either way. The reader cannot tell them apart; this record can.
   */
  costSilent?: string;
}

/** A member of the population the graph does not carry, and why. */
export interface ClosureAbsentMember {
  /** What the enumeration calls it. Deliberately not an id: there is no node. */
  absent: string;
  citation: ClosureCitation;
  /** Why it is not authored. Empty is a failure, not a default. */
  because: string;
}

export type ClosureMember = ClosureNodeMember | ClosureAbsentMember;

export function isAbsentMember(member: ClosureMember): member is ClosureAbsentMember {
  return "absent" in member;
}

export interface SlotClosure {
  /** The capability id whose population this pins. */
  slot: string;
  source: ClosureCitation;
  /** Where in `source` the enumeration is, so the next reader can check it. */
  sourceLocus: string;
  members: readonly ClosureMember[];
}

export const SLOT_CLOSURES: readonly SlotClosure[] = [
  {
    slot: "linear-ode-solve",
    source: {
      title: "Quantum algorithm for linear non-unitary dynamics with near-optimal dependence on all parameters",
      authors: "Dong An, Andrew M. Childs, Lin Lin",
      year: "2023",
      url: "https://arxiv.org/abs/2312.03916",
    },
    // Table 1 rather than the paper's related-work sentence, and the reason is a
    // failed check rather than a preference. The sentence "Prior to LCHS,
    // substantial efforts have been made in addressing general ODEs" carries
    // seven citation numbers, and resolving numbers to references through a
    // fetched HTML render produced two mutually contradictory answers on two
    // passes — one of them naming authors who do not exist. The table names its
    // methods in words, and two independent reads agree on the caption and on
    // all six rows. A pin is only worth having if the next reader can check it
    // the same way and get the same answer.
    //
    // Its six rows are: spectral method, truncated Dyson, time-marching,
    // original LCHS, improved LCHS (time-dependent), improved LCHS
    // (time-independent) — the last two being one method of this graph.
    sourceLocus:
      "Table 1, \"Comparison among improved LCHS and previous methods for homogeneous ODEs\"",
    members: [
      { node: "taylor-all-at-once" },
      { node: "krovi-linear-ode" },
      { node: "dyson-all-at-once" },
      { node: "time-marching-usva" },
      { node: "lchs-route" },
      { node: "lchs-improved-kernel" },
      {
        node: "schrodingerisation",
        // Read against both primary papers' abstracts (2212.13969 and
        // 2212.14703): neither states a query-complexity theorem, and the
        // node's `conditions` says so to the reader in the paper's own terms.
        // The absence is the measurement, not a hole.
        costSilent:
          "arXiv:2212.13969 and arXiv:2212.14703 present the transformation and worked examples; neither abstract states a query-complexity theorem, so no like-for-like count against the LCHS figures exists to quote.",
      },
      {
        absent: "Spectral method",
        citation: {
          title: "Quantum spectral methods for differential equations",
          authors: "Andrew M. Childs, Jin-Peng Liu",
          year: "2019",
          url: "https://arxiv.org/abs/1901.00961",
        },
        // The one row of the pinned table with no node, and the graph already
        // knows the paper exists: `taylor-all-at-once`'s `cost` warns that a
        // κ_V-dependent expression often attached to Taylor "belongs to the
        // spectral-method row of a later comparison table". That row. So the
        // graph cites this method's complexity in order to disown it, and does
        // not draw the method.
        //
        // **Not authored here because it does not fit, and the number is
        // measured rather than argued.** It is a third all-at-once route —
        // discretise globally, then solve one linear system — and on this
        // corpus an all-at-once route costs the saturated figure 3,913px:
        // 22,982 → 26,895, against a 24,000px ceiling with 1,018px of headroom,
        // and 99 → 123 open addresses against `CONVERGE_OPEN_MAX` of 128.
        // (Probe: a synthetic method realizing this slot with
        // `steps: ["time-discretization", "quantum-linear-solve"]`.) The
        // ceiling's own note says a trip is a decision and "bumping the
        // constant is the one response that is always wrong", and names the fix
        // — the shared-sub-method dedup that draws `time-discretization`'s five
        // methods once per branch instead of once per route.
        because:
          "Authoring it trips the figure-size ceiling: measured at +3,913px on the saturated fan (22,982 → 26,895 against 24,000) and +24 open addresses (99 → 123 against CONVERGE_OPEN_MAX 128). Unblocked by the shared-sub-method dedup the ceiling's own note names, not by raising the ceiling.",
      },
      {
        absent: "High-order (linear multistep) method",
        citation: {
          title: "High-order quantum algorithm for solving linear differential equations",
          authors: "Dominic W. Berry",
          year: "2010",
          url: "https://arxiv.org/abs/1010.2745",
        },
        // Not a row of Table 1 — pinned on its own abstract, which states this
        // contract outright: "we extend quantum simulation algorithms to
        // general inhomogeneous sparse linear differential equations". It is
        // the ancestor of the all-at-once family the first four members are,
        // and a population that holds four descendants and not the original is
        // a population with a hole in it that no table would show.
        because:
          "Same measured ceiling trip as the spectral method — a fourth all-at-once route at +3,913px. Recorded here rather than authored so that the absence is one row of a gated record instead of nothing at all.",
      },
    ],
  },
];

/**
 * Every way this closure and the graph disagree, as sentences.
 *
 * Pure over the graph on purpose: `check-layer-graph.mjs` runs the same rules
 * against the real corpus, and the drawing rule — which needs `layoutConverge`
 * — lives in the test rather than being pulled in here. One writer, two callers,
 * which is the split `validateLayerGraph` already uses.
 */
export function auditSlotClosure(graph: LayerGraph, closure: SlotClosure): string[] {
  const errors: string[] = [];
  const where = `closure(${closure.slot})`;

  // [1] The slot is real, and it is a capability. A closure pinned to a method
  // or to a typo would pass every rule below it vacuously: `methodsRealizing`
  // of a name nothing realizes is empty, so rule 2 has nothing to check.
  const slot = layerNode(graph, closure.slot);
  if (!slot) {
    errors.push(`${where}: pins a slot that is not in the graph`);
    return errors;
  }
  if (slot.kind !== "capability") {
    errors.push(`${where}: pins ${closure.slot}, which is a ${slot.kind} and not a slot`);
    return errors;
  }
  if (!/^https:\/\/arxiv\.org\/abs\//u.test(closure.source.url)) {
    errors.push(`${where}: the enumeration's own citation does not resolve to an arXiv abstract`);
  }
  if (closure.sourceLocus.trim() === "") {
    errors.push(
      `${where}: names a source and not a place in it — "somewhere in this paper" is not a pin`,
    );
  }

  const pinned = new Map<string, ClosureNodeMember>();
  for (const member of closure.members) {
    if (isAbsentMember(member)) continue;
    // [4] Twice-pinned is a population that counts one method as two.
    if (pinned.has(member.node)) errors.push(`${where}: ${member.node} is pinned twice`);
    pinned.set(member.node, member);
  }

  // [2] **The tripwire.** Every method the graph records for this slot is in the
  // pin. A method added to a closed slot without a row fails here, by name.
  const realizing = graph.nodes.filter((node) => isMethod(node) && node.realizes === closure.slot);
  for (const method of realizing) {
    if (!pinned.has(method.id)) {
      errors.push(
        `${where}: ${method.id} realizes this slot and is not in its closure — a closed slot's ` +
          "population is the record, so a new method needs a row (node, citations, conditions, " +
          "and a cost or a costSilent saying which source states none)",
      );
    }
  }

  const realizingIds = new Set(realizing.map((method) => method.id));
  for (const [id, member] of pinned) {
    // [3] A pinned id that is not a method of this slot.
    if (!realizingIds.has(id)) {
      const node = layerNode(graph, id);
      errors.push(
        node
          ? `${where}: pins ${id}, which does not realize ${closure.slot}`
          : `${where}: pins ${id}, which is not in the graph`,
      );
      continue;
    }
    const node = layerNode(graph, id);
    if (!node || !isMethod(node)) continue;

    // [6] Sourced. A method on a closed slot with no paper behind it is the
    // thing the whole graph's header rule is about.
    if ((node.citations ?? []).length === 0) {
      errors.push(`${where}: ${id} is pinned as closed and cites no paper`);
    }
    for (const field of ["conditions", "conditionsJa"] as const) {
      if (typeof node[field] !== "string" || node[field].trim() === "") {
        errors.push(`${where}: ${id} is pinned as closed and has no ${field}`);
      }
    }

    // [7] Costed, or silent on the record — exactly one.
    const hasCost = typeof node.cost === "string" && node.cost.trim() !== "";
    const silent = typeof member.costSilent === "string" && member.costSilent.trim() !== "";
    if (!hasCost && !silent) {
      errors.push(
        `${where}: ${id} carries no cost and no costSilent — an absent complexity renders as ` +
          "\"nobody stated one\", which is only honest once somebody has read the source and said so",
      );
    }
    // [8] And the row cannot go stale in the other direction: a costSilent left
    // behind after somebody populated the cost is a record asserting the source
    // is silent about a figure the card is printing.
    if (hasCost && silent) {
      errors.push(
        `${where}: ${id} has both a cost and a costSilent saying its source states none`,
      );
    }
    if (hasCost && (typeof node.costJa !== "string" || node.costJa.trim() === "")) {
      errors.push(`${where}: ${id} has a cost in one locale only`);
    }

    // [9] **A route, not just a name.** `steps` is required by the type, so a
    // method with no `steps` key cannot be authored — but `steps: []` can, and
    // it is a legitimate shape elsewhere in the graph (`stepsOutlook`'s
    // *undecomposed*: nobody has taken this apart yet). On a **closed** slot it
    // is not: a lane claiming a whole way across `linear-ivp → solution-answer`
    // with nothing inside it and nothing said about what it skips is a claim
    // the record cannot support. Either it goes through something, or it
    // declares what it goes around, or it says it is atomic.
    if ((node.steps ?? []).length === 0 && (node.bypasses ?? []).length === 0 && !node.atomic) {
      errors.push(
        `${where}: ${id} fills a closed slot and declares no route — no steps, no bypasses, ` +
          "and not atomic, so the figure draws a whole way across with nothing behind it",
      );
    }
  }

  // [5] Every absence is citable and reasoned, and is really absent.
  for (const member of closure.members) {
    if (!isAbsentMember(member)) continue;
    if (member.absent.trim() === "") errors.push(`${where}: an absent member with no name`);
    if (member.because.trim() === "") {
      errors.push(`${where}: "${member.absent}" is recorded absent with no reason`);
    }
    if (!/^https:\/\/arxiv\.org\/abs\//u.test(member.citation.url)) {
      errors.push(
        `${where}: "${member.absent}" is recorded absent and its citation does not resolve ` +
          "to an arXiv abstract — an absence nobody can check is not a measurement",
      );
    }
  }

  return errors;
}

/** Every disagreement across every closed slot. */
export function auditSlotClosures(graph: LayerGraph): string[] {
  return SLOT_CLOSURES.flatMap((closure) => auditSlotClosure(graph, closure));
}
