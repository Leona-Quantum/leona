// The population of a closed slot: how many out of how many.
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
// a number and says nothing about what that number is out of, and a count with
// no denominator reads as a total.
//
// The graph has no notion of a population at all, so a method nobody authored
// and a method that does not exist are the same absence — which is the same
// defect `absences` fixed one level down, at the level of a method's fields,
// and it is still open at the level of a slot's methods. When this file was
// written, measuring `linear-ode-solve` against the atlas's own primary source
// for it turned up two members of the recorded literature with no node — and one
// of them was the primary source of a **corpus record the graph already anchored
// to this very slot**. Both are authored now (`berry-multistep` in session 129,
// `childs-liu-spectral` in 130), so this closure records no absence at all
// today. That is a state to be suspicious of rather than proud of: an instrument
// with no live subject is one nobody would notice breaking, which is why rule
// [5] and the absence half of rule [7] are exercised by mutation arms in
// `repository-slot-closure.test.ts` rather than by this list.
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
// [7] the enumeration's own source, and every absent member's citation, resolve
//     to a row of the **paper register** — not merely to an arXiv-shaped string
//
// Closing the next family is: add a `SlotClosure`, make this green, and add the
// slot to the region ratchet. Nothing here is specific to differential equations.
//
// ## Why [7] is here and not somewhere it would already exist
//
// It is the **population-level** form of the owner's ruling that a directory
// entry is not a source (`EshMis/ai-ops` issue #12, 2026-08-12): a record cites
// the paper itself. `check-repository-data.mjs` and `check-layer-graph.mjs`
// already refuse a *citation* the register does not carry, and PR 471's `run.paper`
// guard and issue 18's provenance field bind a *record's fields*. None of them can
// see this file: a `SlotClosure`'s `source` and its absent members' `citation`s
// are not citations of any node, so until now the only thing standing behind
// them was `/^https:\/\/arxiv\.org\/abs\//`, which a typed-out id satisfies as
// happily as a read one. The enumeration a whole population is pinned to, and
// the papers it says are missing, are exactly the claims that should be hardest
// to make up.
//
// **It was made to fail before it was trusted.** Written against the graph as it
// stood, with `linear-ode-solve`'s "Spectral method" row citing arXiv:1901.00961
// and that paper not yet in the register, this rule reported
// `closure(linear-ode-solve): "Spectral method" is recorded absent and its
// citation arxiv:1901.00961 is not in the paper register` — a real red on a real
// row, not a manufactured one. Registering that paper is what greened it, and
// the mutation arms in `repository-slot-closure.test.ts` keep both halves failing
// on demand now that the row itself has been authored away.
import type { LayerGraph } from "./layers.ts";
import { isMethod, layerNode } from "./layers.ts";
import { indexPapers, paperIdFromUrl, type PaperRegister } from "./papers.ts";

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
        // **Was the last absence on this slot, authored in session 130.** The
        // row it replaces is kept in this file's history rather than dropped
        // quietly, because what it recorded is the reusable half.
        //
        // It stood absent for one reason and it was a good one: this paper's
        // **abstract states only `poly(log d, log(1/ε))`** and puts every
        // hypothesis in the body, so `conditions` and `cost` were unwritable
        // from an abstract read — while the obvious substitute, the
        // spectral-method row of An, Childs and Lin's Table 1, is *a later
        // paper's tabulation of it* and quoting that for the original's
        // hypotheses is precisely what the header rule removed.
        // `taylor-all-at-once`'s `cost` still warns off that row and still
        // should: the κ_V-bearing expression now on `childs-liu-spectral` is
        // **Theorem 1 and Eq. (8.2) of 1901.00961 itself**, read in full, and
        // nothing here asserts the two agree.
        //
        // What the full text turned up is the part an abstract read could never
        // have guessed: the load-bearing hypothesis is not the spectral one but
        // **smoothness of the solution**. The headline precision holds for a
        // C^∞ solution; at C^{r+1} the same construction costs n = poly(1/ε)
        // and the result is gone. The paper lists that as an open problem, not
        // a formality.
        node: "childs-liu-spectral",
      },
      {
        // **Was an absence, authored in session 129.** The row is kept in the
        // history of this file rather than deleted quietly, because the way it
        // was found generalises: nothing in the graph knew this method was
        // missing, and what noticed was the population pin — the catalog record
        // `linear-differential-equations` sources this paper, is anchored to
        // this slot, and its own prose distinguishes the construction from the
        // Taylor route. A reader arriving from the catalog reached the slot and
        // found four all-at-once routes, none of them the one their record was
        // about. Authored from the full text: Theorem 9, Eq. (74), Eq. (76) and
        // the constant-coefficient caveat are all on the node, and the
        // discretization it pins, `linear-multistep-discretization`, was
        // authored with it because R13 correctly refused an unpinned twin.
        node: "berry-multistep",
      },
    ],
  },
];

/**
 * Every way this closure and the graph disagree, as sentences.
 *
 * Pure over the graph and the register: the drawing rule needs `layoutConverge`
 * and lives in `repository-slot-closure.test.ts`, which keeps this callable from
 * `check-layer-graph.mjs` without pulling in the layout engine — the same split
 * `validateLayerGraph` already uses.
 *
 * `register` is **required rather than optional**, and that is the whole design
 * of rule [7]. An optional register would make the strongest rule in this file
 * the one a caller skips by forgetting a third argument, and silence is how a
 * check passes for the wrong reason. There are two call sites and both pass it.
 */
export function auditSlotClosure(
  graph: LayerGraph,
  closure: SlotClosure,
  register: PaperRegister,
): string[] {
  const errors: string[] = [];
  const where = `closure(${closure.slot})`;
  const registered = indexPapers(register);

  /**
   * [7], for one URL. Two ways to fail and they are different mistakes: a URL
   * the register could not key on at all, and a well-formed id nobody has
   * written a row for. Both are reported by id so the fix is the next thing a
   * reader types.
   */
  const unregistered = (url: string): string | null => {
    const id = paperIdFromUrl(url);
    if (id === null) return `${url} is not an address the paper register can key on`;
    if (!registered.has(id)) return `${id} is not in the paper register`;
    return null;
  };

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
  // [7] on the enumeration itself. A whole population is pinned to this paper,
  // so it is the last citation in the corpus that should be allowed to be a
  // string somebody typed.
  const sourceGap = unregistered(closure.source.url);
  if (sourceGap !== null) {
    errors.push(
      `${where}: the enumeration is pinned to a paper the register does not carry — ${sourceGap}. ` +
        "A population's own source resolves to a register row or the pin cites a URL rather than " +
        "a paper",
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
    // [7] on the absence. An absent member is a claim that a specific paper
    // belongs on this slot and has no node, which is a claim about the
    // literature — so the paper has to be one somebody has actually written a
    // register row for, exactly as a citation on a node must be. Without this,
    // a gap could be recorded against a plausible-looking id that resolves to
    // nothing, and the row would read as a measurement forever.
    const absenceGap = unregistered(member.citation.url);
    if (absenceGap !== null) {
      errors.push(
        `${where}: "${member.absent}" is recorded absent and ${absenceGap} — an absence names a ` +
          "paper the register carries, or the gap it records is itself unsourced",
      );
    }
  }

  return errors;
}

/** Every disagreement across every closed slot. */
export function auditSlotClosures(graph: LayerGraph, register: PaperRegister): string[] {
  return SLOT_CLOSURES.flatMap((closure) => auditSlotClosure(graph, closure, register));
}
