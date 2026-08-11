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
// | `algorithm-reference` | 62 | **yes** |
// | `operator` | 62 | no |
// | `gate-primitive` | 27 | no |
// | `state` | 12 | no |
//
// This table read 112/70 when it was written and neither figure was ever
// edited: eight records were later reclassified from `algorithm-reference` to
// `benchmark-circuit`, which moves the eligible denominator — the one number
// the paragraph below is an argument about — without touching a line of this
// file. The total is the invariant, not the split. Hence the command: the
// checker prints the census so the table can be checked instead of trusted.
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

/** One record, reduced to the two facts this rule reads. */
export interface EligibilityRecord {
  slug: string;
  /** The `role`-facet topic, or `null` where the record resolves to none. */
  role: string | null;
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
  const anchoredEligible = new Set<string>();
  for (const { nodeId, slug } of anchors) {
    const record = byslug.get(slug);
    // Unknown slug: not this rule's business. See `ineligible`'s doc comment.
    if (!record) continue;
    if (isMapEligibleRole(record.role)) {
      anchoredEligible.add(slug);
      continue;
    }
    ineligible.push({ nodeId, slug, role: record.role });
  }
  return {
    ineligible,
    anchored: anchoredEligible.size,
    eligible: eligibleSlugs.size,
    unanchored: [...eligibleSlugs].filter((slug) => !anchoredEligible.has(slug)).sort(),
  };
}
