// Which Atlas records are allowed to appear on the map, and why most are not.
//
// > *"make sure entries are relevant and actually useful and relevant to be
// > included on the map, separate what is useful and what is not otherwise,
// > would prefer to keep algorithms and paper theory+experimentation in
// > repository."*
// > — owner, session-98 inbox
//
// ## The rule was already being obeyed, by nobody
//
// Measured across the published corpus before this file existed: every record
// the layer graph cross-links is an `algorithm-reference`. Not one benchmark
// circuit, gate or operator has ever been anchored to a node. So the rule below
// breaks nothing — which is exactly the problem it is here to fix. A convention
// that holds because everyone happened to follow it is one PR away from not
// holding, and the PR that breaks it looks like a helpful cross-link.
//
// ## What the roles are, and why four of the five may not anchor
//
// `topics.ts` already carries an **exhaustive** `role` facet — every record has
// exactly one, and a record that resolves to none fails the build. Counted over
// the 283, **measured 2026-08-11** and re-derivable with
// `node scripts/check-layer-graph.mjs --unanchored`:
//
// | role | count | may anchor |
// |---|---|---|
// | `benchmark-circuit` | 120 | no |
// | `algorithm-reference` | 102 | **yes** |
// | `operator` | 62 | no |
// | `gate-primitive` | 27 | no |
// | `state` | 12 | no |
//
// This table read 112/70 when it was written and neither figure was ever
// edited: eight records were later reclassified from `algorithm-reference` to
// `benchmark-circuit`, which moves the eligible denominator — the one number
// the paragraph below is an argument about — without touching a line of this
// file. It then read 62 algorithm records through the Zoo- and Classiq-parity
// intakes that took the real figure to 102. The total is the invariant, not the
// split. Hence the command: the checker prints the census so the table can be
// checked instead of trusted. (Read 2026-08-12, 323 records.)
//
// ## The owner was asked whether this rule is the right one, and said yes
//
// The question put to him was the literal reading of his own earlier remark
// that a method's card and its repository record "may as well be the same
// thing": should **every** record get a map node, or only the ones that match a
// method? Read literally it meant either inventing ~259 nodes in a map already
// pressing its height ceiling, or demoting most of the corpus.
//
// > *"cards in the map are large, and are algorithms in the repository, nothing
// > else yet. including operators/gates/whatever states are would be
// > introducing tons of primitives for no reason, then code implementations
// > would probably include them anyway. […] gates are just primitives, so it is
// > okay for them to be their section. operators are useful for certain
// > algorithms like VQE, QSVT, and others […]"*
// > — owner, github.com/EshMis/ai-ops/issues/14, 2026-08-12
//
// So `MAP_ELIGIBLE_ROLES` stays at one entry, and the three excluded object
// roles stay excluded **by his ruling** and not merely by the argument below
// it. Widening this list is now a question for him, not a judgement call for
// the session that finds the one-line edit convenient. Note what he did *not*
// rule out: gates and operators keep their repository sections — he named a use
// for operators specifically ("build up a solid repository of these"). The one
// thing still open is what the `states` category is for; he said he does not
// see it, and that is asked separately rather than acted on here.
//
// A layer node is a **slot** or a **way of filling one**. The four excluded
// roles are none of those:
//
// - a **benchmark circuit** is a yardstick — a width-scaled RY-CZ ansatz is not
//   a way of solving anything, it is a fixed thing to measure against, and
//   anchoring one to `state-preparation` would answer "what fills this slot" with
//   a fixture;
// - an **operator** and a **state** are *objects a process consumes or
//   produces*. The map already has a place for those and it is not `entries` —
//   it is `states.ts`, whose ids are checked against a closed vocabulary and are
//   deliberately kept disjoint from corpus slugs;
// - a **gate primitive** is below the bottom of this graph on purpose:
//   `gate-synthesis` bottoms out at a gate set, and the gate itself is reference
//   material rather than a competing method.
//
// ## Why this is a hard error and not a warning
//
// The same reason `entries` naming an unknown slug is: a wrong cross-link and a
// missing one look identical to a reader. A gate record hanging off
// `quantum-linear-solve` reads as *"the Atlas documents this layer"* — the one
// sentence the layers surface exists to be able to make honestly, and the one
// whose emptiness is currently the most useful thing on the page.
//
// ## Where this runs
//
// It needs both sides — the graph and the corpus — so it runs in
// `scripts/check-layer-graph.mjs` beside the slug-resolution rule, for the reason
// stated at the top of `repository-layers.test.ts`: `node --test` cannot import
// the corpus. The functions here are pure and are unit-tested against fixtures,
// so the rule itself is pinned even though the corpus it is run against is not
// importable from a test.
import type { TopicId } from "./topics";

/**
 * The roles a layer node's `entries` may name.
 *
 * A tuple and not a `Set` literal, and not inlined at the call site, for the
 * reason `PUBLIC_REPOSITORY_CATEGORY_IDS` is a tuple: this is a vocabulary, and
 * a vocabulary written out once per consumer drifts silently. Widening the map
 * to a second role is a deliberate edit to this line and nowhere else.
 */
export const MAP_ELIGIBLE_ROLES = ["algorithm-reference"] as const satisfies readonly TopicId[];

export type MapEligibleRole = (typeof MAP_ELIGIBLE_ROLES)[number];

export function isMapEligibleRole(role: string | null | undefined): role is MapEligibleRole {
  return typeof role === "string" && (MAP_ELIGIBLE_ROLES as readonly string[]).includes(role);
}

/**
 * The `source.kind`s whose provenance can carry a layer's claim.
 *
 * The role rule above asks *what kind of thing is this record*. This one asks a
 * second question the role facet cannot answer: **where does what it says come
 * from.** They are independent, and the corpus already holds the pair that
 * separates them — `qaoa-maxcut-ring` is an `algorithm-reference` by role and
 * map-eligible today, and its source is
 * `kind: "verified_run", url: "https://github.com/EshMis/majorana"`: our own
 * evaluation harness, citing this repository. That is correct provenance for
 * what the record is — a run we performed — and the one thing a layer anchor
 * must never rest on, because the anchor renders as *"the Atlas documents this
 * layer"* and the document would be us.
 *
 * `community_submission` is excluded for the neighbouring reason: the layers
 * surface makes an editorial claim, and an unreviewed submission has not been
 * through the pass that backs one. No record carries that kind today (measured
 * 2026-08-11 over the built corpus: 281 `curated_reference`, 2 `verified_run`,
 * 0 `community_submission`), so that half of the line is a decision taken in
 * advance rather than a description — which is the point of writing it down
 * while the answer is still cheap.
 *
 * A tuple for the same reason `MAP_ELIGIBLE_ROLES` is one: widening the map to a
 * second provenance kind is a deliberate edit to this line and nowhere else.
 */
export const MAP_CITABLE_SOURCE_KINDS = ["curated_reference"] as const;

export type MapCitableSourceKind = (typeof MAP_CITABLE_SOURCE_KINDS)[number];

/**
 * **Unknown is not citable.** A caller that cannot say where a record's claims
 * come from has not established that they can carry a layer's, and the two
 * states — "this source is our own run" and "nobody told me what this source
 * is" — must not differ in what the map is allowed to do with the record.
 *
 * It also fails the useful way at the wiring: a consumer that forgets to pass
 * `sourceKind` gets every one of its anchors reported at once, which is a
 * five-minute fix, rather than a rule that quietly passes everything, which is
 * a rule that is not there.
 */
export function isMapCitableSourceKind(
  kind: string | null | undefined,
): kind is MapCitableSourceKind {
  return typeof kind === "string" && (MAP_CITABLE_SOURCE_KINDS as readonly string[]).includes(kind);
}

/** One record, reduced to the facts these rules read. */
export interface EligibilityRecord {
  slug: string;
  /** The `role`-facet topic, or `null` where the record resolves to none. */
  role: string | null;
  /**
   * `source.kind`, or `null`/absent where the caller did not supply one — which
   * `isMapCitableSourceKind` treats as not citable. See its comment.
   */
  sourceKind?: string | null;
  /**
   * `source.url`, read only to group the reading list by shared provenance. A
   * record without one is grouped under nothing and never reported as shared.
   */
  sourceUrl?: string | null;
}

export interface AnchorAudit {
  /**
   * Anchors naming a record whose role is not on the list. **The error.**
   *
   * A slug the corpus does not carry at all is *not* reported here — that is
   * `entries names a slug the corpus does not carry`, a different failure with a
   * different fix, and reporting one as the other sends the reader to the wrong
   * file.
   */
  ineligible: Array<{ nodeId: string; slug: string; role: string | null }>;
  /**
   * Anchors naming a record the map may not *cite*, whatever its role.
   * **Also an error**, and deliberately a separate one from `ineligible`.
   *
   * The two have different fixes and reporting them together would hide that:
   * an ineligible role means *this record does not belong on the map* and the
   * fix is to drop the cross-link; an uncitable source means *this record may
   * well belong, but not on the strength of that document*, and the fix is
   * usually to source it properly.
   */
  uncitable: Array<{ nodeId: string; slug: string; sourceKind: string | null }>;
  /** Distinct eligible records the graph anchors. */
  anchored: number;
  /** Eligible records in the corpus — the denominator `anchored` is part of. */
  eligible: number;
  /**
   * Eligible records nothing on the map anchors, by slug.
   *
   * Not an error and never will be: it is the reading list, and the most
   * concrete statement this repository can make about what the map does not yet
   * cover.
   *
   * **Read the number, do not read it here.** This comment said "61 of the 70
   * algorithm records have no node" until 2026-08-11, by which point the real
   * figure was 53 of 62 — the denominator had moved under a sentence nobody had
   * a reason to re-run. A count written into prose is a measurement taken once
   * and quoted forever. The live figure, with the list itself:
   *
   * ```
   * node scripts/check-layer-graph.mjs --unanchored
   * ```
   */
  unanchored: string[];
  /**
   * The subset of `unanchored` that **cannot be anchored as it stands**, because
   * its provenance could not carry the claim — see `MAP_CITABLE_SOURCE_KINDS`.
   *
   * A caveat on the reading list, not a subtraction from it: `unanchored` keeps
   * its full length so the coverage number nobody has to recompute stays the
   * number it has always been. But a reading list is an instruction to go and
   * anchor these, and one of them is our own evaluation run — a session that
   * works the list top to bottom should be told that before it writes the
   * cross-link, not after a reviewer catches it.
   */
  unanchorableProvenance: string[];
  /**
   * Unanchored records grouped by a source URL more than one of them cites,
   * commonest first.
   *
   * Also a caveat rather than an error, and the one that changes how much work
   * the list actually is: 25 of the 53 currently cite the same VQE survey — not
   * because anyone chose it 25 times, but because `vqeEntry`'s first line is
   * `const source = concept.source ?? VQE_SURVEY`. A survey is a fine catalogue
   * citation and cannot support a *per-method* map claim, so those records need
   * their own primary papers before they can be anchored. That is a different
   * and much larger job than adding cross-links, and the only way to see it
   * coming is to count how many records lean on one document.
   */
  sharedSources: Array<{ url: string; slugs: string[] }>;
}

/**
 * Every source URL that more than one unanchored record may cite, with the
 * exact set of records allowed to cite it.
 *
 * **The thing this guards is a factory default, not a typo.** Until W21-B, 25 of
 * the 53 unanchored records cited one VQE survey — not because anyone chose it
 * 25 times, but because `vqeEntry`'s first line is
 * `const source = concept.source ?? VQE_SURVEY`. A default that manufactures a
 * citation is invisible in every diff: the record reads as sourced, the checker
 * counted it as sourced, and no file recorded a decision. So a share is legal
 * only when it is *written down here with its reason*, and the slug set has to
 * match exactly.
 *
 * Exactly, in both directions, and the second one is the point: give one of the
 * residue records below its own paper and this check fails until the slug is
 * removed from the list. That is the failure that stops a stale allowance from
 * quietly re-permitting a share nobody re-examined.
 */
export const DECLARED_SHARED_SOURCES: Readonly<Record<string, readonly string[]>> = {
  // Peruzzo et al. 2013 is the paper that introduced VQE. Both records are about
  // the algorithm as a whole rather than one of its parts, so one primary paper
  // standing behind both is the literature agreeing, not a default filling in.
  "https://arxiv.org/abs/1304.3061": ["vqe-ground-state-energy", "vqe-objective-loop"],
  // Lee et al. 2018 introduces generalized UCC *and* its k-UpCCGSD truncation in
  // one paper. Two records, one genuine origin — the case W21-B's check exists to
  // permit rather than to punish.
  "https://arxiv.org/abs/1810.02327": ["vqe-generalized-excitations", "vqe-k-upccgsd"],
  // W21-B residue. These kept the survey because a search for a specific primary
  // paper came back empty, which is a different fact from "nobody looked" and is
  // why they are named one by one:
  //   vqe-spin-adapted    — searches returned 2026 papers on spin-adapted
  //                         variants, none of them the origin of the idea.
  //   vqe-active-space    — active-space selection is classical quantum chemistry
  //                         predating VQE; no VQE-specific primary paper found.
  //   vqe-warm-start      — the warm-start literature found is QAOA/optimization,
  //                         not the chemistry parameter-initialisation this
  //                         record describes.
  //
  // **`vqe-batched-adapt` was a fourth and is gone from this list, which is worth
  // recording because it says something about the other three.** The empty result
  // was not a real absence: the batching is introduced in Sapova and Fedorov's
  // carbon-monoxide-oxidation paper (arXiv:2108.11167), whose abstract states it
  // in as many words — *"the measurement overhead can be significantly reduced via
  // adding multiple operators at each step while keeping the ansatz compact"*. It
  // did not surface earlier because the paper is named for the chemistry it
  // simulates rather than for the method it introduces, so a method-name search
  // never reaches it. **A negative from a title-shaped search is weaker evidence
  // than this list was treating it as** — the remaining three are worth re-running
  // against what a paper DOES rather than what it is called.
  "https://arxiv.org/abs/2103.08505": [
    "vqe-active-space",
    "vqe-spin-adapted",
    "vqe-warm-start",
  ],
  // Zoo-parity intake. Shor 1995 is one paper with two algorithms in its own
  // title — "Prime Factorization **and** Discrete Logarithms" — and the Quantum
  // Algorithm Zoo files them as two entries, Factoring and Discrete-log, citing
  // this same paper for both. Two records sharing it is the literature's own
  // shape, not a default filling in for a search nobody ran.
  "https://arxiv.org/abs/quant-ph/9508027": ["discrete-logarithm", "shor-period-finding"],
  // Zoo-parity intake, W22. Two more of the literature's own shape, and the same
  // shape as the Shor row above: one paper, two problems, and the Quantum
  // Algorithm Zoo files each pair as two entries citing that one paper for both.
  //
  // Hallgren's J. ACM paper names both problems in its own title — "Pell's
  // Equation **and** the Principal Ideal Problem" — and proves them as separate
  // theorems (Theorem 2 for the regulator, Theorem 3 for the principal ideal
  // problem) with different guarantees: Theorem 3 additionally needs the regulator
  // to exceed an absolute constant and succeeds only with probability Ω(1/log Δ)
  // per trial. Two records rather than one because those are two different claims.
  "https://doi.org/10.1145/1206035.1206039": ["pell-equation-regulator", "principal-ideal-problem"],
  // The STOC 2005 paper likewise does the unit group and the class group in one
  // document, and splitting them is not bookkeeping: the unit-group theorem is
  // unconditional and the class-group theorem assumes the GRH. A single record
  // would have to state one condition for both and would be wrong about one of them.
  "https://doi.org/10.1145/1060590.1060660": ["class-group-of-a-number-field", "unit-group-of-a-number-field"],
};

/**
 * The shared sources that are **not** covered by an exact declaration above.
 *
 * Separate from `auditAnchors` because the audit answers "what is the state of
 * the map" and this answers "is that state one somebody signed off on" — and a
 * caller that wants the census without the refusal (the `--unanchored` reading
 * list) must be able to have it.
 */
export function undeclaredSharedSources(
  shared: readonly { url: string; slugs: string[] }[],
): Array<{ url: string; slugs: readonly string[]; declared: readonly string[] | null }> {
  const undeclared: Array<{ url: string; slugs: readonly string[]; declared: readonly string[] | null }> = [];
  for (const { url, slugs } of shared) {
    const declared = DECLARED_SHARED_SOURCES[url] ?? null;
    if (declared && [...declared].sort().join(" ") === [...slugs].sort().join(" ")) continue;
    undeclared.push({ url, slugs, declared });
  }
  return undeclared;
}

/**
 * Audit a graph's cross-links against the corpus's roles.
 *
 * Takes the anchors as `(nodeId, slug)` pairs rather than a `LayerGraph`, so this
 * module does not import the graph types and the layers module does not import
 * the topic vocabulary — the two halves stay independently testable, and neither
 * gains a reason to reach for the other's internals.
 */
export function auditAnchors(
  anchors: readonly { nodeId: string; slug: string }[],
  corpus: readonly EligibilityRecord[],
): AnchorAudit {
  const byslug = new Map(corpus.map((record) => [record.slug, record]));
  const eligibleSlugs = new Set(
    corpus.filter((record) => isMapEligibleRole(record.role)).map((record) => record.slug),
  );
  const ineligible: AnchorAudit["ineligible"] = [];
  const uncitable: AnchorAudit["uncitable"] = [];
  const anchoredEligible = new Set<string>();
  for (const { nodeId, slug } of anchors) {
    const record = byslug.get(slug);
    // Unknown slug: not this rule's business. See `ineligible`'s doc comment.
    if (!record) continue;
    if (isMapEligibleRole(record.role)) {
      anchoredEligible.add(slug);
      // Reported, and still counted as anchored: the cross-link exists and the
      // record is on the map whatever we think of its provenance. Dropping it
      // from `anchored` would make a provenance error read as a coverage loss
      // and move a number two other files quote.
      if (!isMapCitableSourceKind(record.sourceKind)) {
        uncitable.push({ nodeId, slug, sourceKind: record.sourceKind ?? null });
      }
      continue;
    }
    ineligible.push({ nodeId, slug, role: record.role });
  }
  const unanchored = [...eligibleSlugs].filter((slug) => !anchoredEligible.has(slug)).sort();
  const byUrl = new Map<string, string[]>();
  for (const slug of unanchored) {
    const url = byslug.get(slug)?.sourceUrl;
    if (!url) continue;
    byUrl.set(url, [...(byUrl.get(url) ?? []), slug]);
  }
  return {
    ineligible,
    uncitable,
    anchored: anchoredEligible.size,
    eligible: eligibleSlugs.size,
    unanchored,
    unanchorableProvenance: unanchored.filter(
      (slug) => !isMapCitableSourceKind(byslug.get(slug)?.sourceKind),
    ),
    sharedSources: [...byUrl.entries()]
      .filter(([, slugs]) => slugs.length > 1)
      // Commonest first, then by url, so the output is stable across runs and a
      // diff of two runs is a change in the corpus rather than in Map order.
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([url, slugs]) => ({ url, slugs })),
  };
}
