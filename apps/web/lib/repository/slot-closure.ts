// The population of a closed slot: seven out of how many.
//
// ## What this is not
//
// It is **not** a second closure gauge. `regionClosure` measures the *fields* of
// the methods a region holds — summary, conditions, cost, citations, pseudocode,
// worked runs — and `absences` lets a method declare, in both locales, why one of
// those is empty. The linear-ODE region reads `closed 7/7 fields` on that
// instrument today, and the ratchet in `repository-layers.test.ts` ("the
// linear-ODE region does not go backwards on the half that is closed") holds it
// there. None of that is repeated here, deliberately: a rule written twice is a
// rule that will disagree with itself.
//
// ## The question those instruments cannot ask
//
// Both of them measure the methods that **exist**. Neither can say whether the
// set is the right set. `methodsRealizing(graph, "linear-ode-solve")` returns
// seven and says nothing about what seven is out of, and a count with no
// denominator reads as a total.
//
// The graph has no notion of a population at all, so a method nobody authored
// and a method that does not exist are the same absence — which is the same
// defect `absences` fixed one level down, at the level of a method's fields,
// and it is still open at the level of a slot's methods. Measured against the
// atlas's own primary source for this slot, two members of the recorded
// literature have no node, and one of them is the primary source of a **corpus
// record the graph already anchors to this very slot**.
//
// ## The rules, and which one is load-bearing
//
// [1] the enumeration is a paper and a place in it, both resolvable
// [2] **every method the graph records for the slot appears here** — the
//     tripwire: an eighth method fails until somebody writes its row
// [3] every pinned id is a method that really realizes this slot
// [4] no id pinned twice
// [5] every absence names a paper, gives a reason, and is really absent — its
//     paper must not already be cited by a method of this slot, so the row
//     cannot outlive the gap it records
// [6] (in the test) every pinned method is drawn on its own slot's figure and
//     that lane links to it
//
// Closing the next family is: add a `SlotClosure`, make this green, and add the
// slot to the region ratchet. Nothing here is specific to differential equations.
import type { LayerGraph } from "./layers.ts";
import { isMethod, layerNode } from "./layers.ts";

/** A paper, in the shape `LayerCitation` uses, so a row reads like a node. */
export interface ClosureCitation {
  title: string;
  authors: string;
  year: string;
  url: string;
}

/** A member of the population the graph carries as a node. */
export interface ClosureNodeMember {
  node: string;
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
    // Table 1 rather than the same paper's related-work sentence, and that is a
    // failed check rather than a preference. "Prior to LCHS, substantial efforts
    // have been made in addressing general ODEs" carries seven citation numbers,
    // and resolving numbers to references through a fetched render gave two
    // contradictory answers on two passes — one of them naming authors who do not
    // exist. The table names its methods in words, and two independent reads agree
    // on the caption and on all six rows. A pin is only worth having if the next
    // reader can check it the same way and get the same answer.
    //
    // Its rows: spectral method, truncated Dyson, time-marching, original LCHS,
    // improved LCHS (time-dependent), improved LCHS (time-independent) — the last
    // two being one method of this graph.
    //
    // **A floor, not a ceiling.** Taylor, Krovi and Schrödingerisation are absent
    // from this table and all three belong, which is why rule [2] runs from the
    // graph to the pin and never the other way. What the enumeration is for is
    // the opposite direction: a member the curator did not think of.
    sourceLocus:
      "Table 1, \"Comparison among improved LCHS and previous methods for homogeneous ODEs\"",
    members: [
      { node: "taylor-all-at-once" },
      { node: "krovi-linear-ode" },
      { node: "dyson-all-at-once" },
      { node: "time-marching-usva" },
      { node: "lchs-route" },
      { node: "lchs-improved-kernel" },
      { node: "schrodingerisation" },
      {
        absent: "Spectral method",
        citation: {
          title: "Quantum spectral methods for differential equations",
          authors: "Andrew M. Childs, Jin-Peng Liu",
          year: "2019",
          url: "https://arxiv.org/abs/1901.00961",
        },
        // The one row of the pinned table with no node — and the graph already
        // cites this method's complexity **in order to disown it**:
        // `taylor-all-at-once`'s `cost` warns that a κ_V-dependent expression
        // often attached to Taylor "belongs to the spectral-method row of a later
        // comparison table". That row.
        //
        // Not the figure-size ceiling: measured on this commit, an added
        // all-at-once route costs this slot's saturated figure 84px (3,199 →
        // 3,283 against 5,500) and 15 open addresses (54 → 69 against
        // CONVERGE_OPEN_MAX 256). There is room. What is missing is the reading.
        because:
          "Not authored: the paper's abstract states only complexity poly(log d, log(1/ε)) and its own hypotheses are in the body, so conditions and cost cannot be written from an abstract read — and quoting An, Childs and Lin's Table 1 row for them would attribute a later paper's tabulation to the original, which is the class of claim this graph's header rule removed. It is also not yet in the paper register. Needs a full-text read, not a slot. Room is not the constraint: an added all-at-once route measures at +84px against 5,500 (3,199 → 3,283).",
      },
      {
        absent: "High-order (linear multistep) method",
        citation: {
          title: "High-order quantum algorithm for solving linear differential equations",
          authors: "Dominic W. Berry",
          year: "2010",
          url: "https://arxiv.org/abs/1010.2745",
        },
        // **This one is a corpus/map divergence, not only a literature gap, and
        // it is the sharper of the two.** The catalog carries
        // `linear-differential-equations`, whose `source` is this paper, and
        // whose `idea` describes this construction and distinguishes it from the
        // Taylor route in as many words: "Berry discretizes the evolution with a
        // high-order finite difference method… The later Berry, Childs, Ostrander
        // and Wang algorithm replaces the difference stencil with a Taylor series
        // approximation." That record is anchored to this slot
        // (`linear-ode-solve.entries`), and the paper is already in the register.
        // So a reader arriving from the catalog reaches the slot and finds seven
        // methods, none of them the one their record is about.
        // **The full-text read is done; the authoring is not.** Left here rather
        // than in a session note so the next reader starts from the paper rather
        // than from a search. Read off the v2 PDF directly, section VII and the
        // Conclusions:
        //
        // - Eq. (76), the Conclusions' own summary: "By encoding the differential
        //   equation as a linear system, and using the algorithm of Ref. [12] for
        //   solving linear systems, the complexity is (including only scaling in
        //   ‖A‖ and Δt), Õ((‖A‖Δt)²)." Ref. [12] is Harrow, Hassidim and Lloyd —
        //   so `steps: ["time-discretization", "quantum-linear-solve"]`, and the
        //   `via` hop has no pin, because none of the five recorded
        //   discretizations is an A(α)-stable multistep method of order p.
        // - Eq. (74), the sharper bound: "Õ(log(N_x) s^{9/2} (‖A‖Δt)^{2+2/p}
        //   κ_V^{2+4/p} (‖x_in‖ + ‖b‖/‖A‖)^{1/p} / ε^{1+2/p})", stated under
        //   "If we assume that this error is negligible" — the error in *starting*
        //   the multistep method, which Eq. (71)'s more conservative figure keeps.
        //   A quotation of (74) has to carry that condition with it.
        // - The hypothesis that bounds the whole thing, Conclusions: "These
        //   results are for constant coefficients, because that enables an
        //   analytic error analysis. This approach can also be used to solve
        //   linear differential equations with time-dependent coefficients,
        //   though the error analysis will be more difficult." So this route does
        //   **not** meet the slot's `A(t)` contract in the way LCHS and Dyson do,
        //   and that difference is the interesting thing about having it drawn.
        // - Section VII: the Δt² scaling "is likely suboptimal, because the lower
        //   bound is linear scaling" — from the no-fast-forwarding theorem.
        //
        // What is still missing is the middle of the paper: this slot's siblings
        // carry an `implementations` entry that writes the matrix family out row
        // by row in both locales (see `truncated-taylor-propagator`), and a node
        // authored from the tail alone would be the one thin record in a region
        // whose whole point is that it is the template.
        because:
          "Not authored: the corpus already holds this route as the record `linear-differential-equations` and the map draws no method for it, so the gap is a divergence rather than a discovery. The complexity and the hypotheses are read and quoted in the comment above — Eq. (76), Eq. (74) and the constant-coefficient caveat — so what remains is the paper's middle sections, which is what this slot's siblings carry as an `implementations` entry in both locales. Authoring it from the tail alone would put the region's one thin record in the region that is meant to be the template.",
      },
    ],
  },
];

/**
 * Every way this closure and the graph disagree, as sentences.
 *
 * Pure over the graph: the drawing rule needs `layoutConverge` and lives in
 * `repository-slot-closure.test.ts`, which keeps this callable from
 * `check-layer-graph.mjs` without pulling in the layout engine — the same split
 * `validateLayerGraph` already uses.
 */
export function auditSlotClosure(graph: LayerGraph, closure: SlotClosure): string[] {
  const errors: string[] = [];
  const where = `closure(${closure.slot})`;

  // [1] The slot is real and is a capability. A closure pinned to a method or to
  // a typo passes everything below it vacuously: nothing realizes that name, so
  // the tripwire has an empty set to check.
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

  const pinned = new Set<string>();
  for (const member of closure.members) {
    if (isAbsentMember(member)) continue;
    // [4] Twice-pinned is a population that counts one method as two.
    if (pinned.has(member.node)) errors.push(`${where}: ${member.node} is pinned twice`);
    pinned.add(member.node);
  }

  const realizing = graph.nodes.filter((node) => isMethod(node) && node.realizes === closure.slot);

  // [2] **The tripwire.** Every method the graph records for this slot is in the
  // pin. An eighth method fails here, by name, until somebody writes its row —
  // which is the moment to ask whether the enumeration still describes the
  // population, and that question has no other occasion to be asked.
  for (const method of realizing) {
    if (!pinned.has(method.id)) {
      errors.push(
        `${where}: ${method.id} realizes this slot and is not in its closure — a closed slot's ` +
          "population is a written record, so a new method needs a row, and writing one is where " +
          "the enumeration gets re-read",
      );
    }
  }

  // [3] A pinned id that is not a method of this slot.
  const realizingIds = new Set(realizing.map((method) => method.id));
  for (const id of pinned) {
    if (realizingIds.has(id)) continue;
    errors.push(
      layerNode(graph, id)
        ? `${where}: pins ${id}, which does not realize ${closure.slot}`
        : `${where}: pins ${id}, which is not in the graph`,
    );
  }

  // Every paper any method of this slot already cites. An "absent" member whose
  // paper is in here is not absent — it was authored, under some other name, and
  // the row is stale.
  const cited = new Set(
    realizing.flatMap((method) => (method.citations ?? []).map((citation) => citation.url)),
  );

  // [5] Every absence is named, reasoned, citable, and really absent.
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
    if (cited.has(member.citation.url)) {
      errors.push(
        `${where}: "${member.absent}" is recorded absent, but a method of this slot already ` +
          `cites ${member.citation.url} — the row outlived the gap it records`,
      );
    }
  }

  return errors;
}

/** Every disagreement across every closed slot. */
export function auditSlotClosures(graph: LayerGraph): string[] {
  return SLOT_CLOSURES.flatMap((closure) => auditSlotClosure(graph, closure));
}
