// Width families: the 15 things this catalogue publishes twice each (R2.6).
//
// `benchmark-ghz-chain` exists as `-3q` and `-16q` — two slugs, two records, one
// browse card. It existed eight times until 2026-08-16 (`-2q` through `-16q`),
// which was 120 of the then-283 published entries and 42% of the corpus when
// R2.6 measured it in 2026-07. The owner then ruled (ai-ops issue 116) that a
// family needs only the narrowest width that demonstrates its function and one
// high one, so the six interpolated widths were deleted: 120 records became 30.
//
// This module is unchanged by that and was never edited for it — it is the rule
// that reads a family back as one row, and it does that for two members exactly
// as it did for eight. The browse-row count did not move (262 either way), which
// is the clearest statement of what the deletion did and did not change.
//
// **Derived, not authored**, for the reason `topics.ts` gives and R1 and R2.5
// both followed: the owner may repopulate this corpus wholesale, and 15
// hand-written family records would be discarded with it while a rule
// reclassifies whatever the corpus becomes. There is a hand-curated group list
// in the browser (`VARIANT_GROUPS`, two clusters, four slugs) and this does not
// replace it — a curated cluster names two records that are the *same
// algorithm in different forms*, which no rule can see. A width family is a
// different claim and is entirely visible in the data.
//
// **What makes the claim falsifiable.** "These eight records are one thing at
// eight widths" is a statement about the eight records, so it is checked rather
// than assumed: every member must agree on every facet the browse list filters
// or renders from a folded card, and the eight titles must reduce to one label
// once each width is struck from its own. A candidate that fails either test is
// **refused, and the refusal is returned** rather than dropped — a grouping
// that silently declines to group looks exactly like a corpus that has no
// families, and `scripts/check-repository-data.mjs` asserts on the refusals for
// that reason.
//
// Measured over the published corpus before any of this was built: 15 stems ×
// 8 widths, exactly 15 records at each of the eight widths, zero slugs matching
// the width pattern outside a family, and zero facet disagreements inside one.
// Every `-Nq` slug's N also equals its own `portableCircuit.qubitCount`, so the
// suffix is not a naming convention that could drift from the circuit.

/** A member record of a width family, and the width its slug declares. */
export interface FamilyMember {
  slug: string;
  width: number;
}

/** One published circuit that the corpus stores once per width. */
export interface WidthFamily {
  /** The shared slug stem, e.g. `benchmark-ghz-chain`. Stable row key. */
  key: string;
  /** The shared title with each member's own width struck out. */
  label: string;
  labelJa: string;
  /** Members ascending by width. */
  members: FamilyMember[];
}

/** A candidate that shares a stem but is not one thing, and why. */
export interface FamilyRefusal {
  key: string;
  slugs: string[];
  reason: "facets-disagree" | "titles-disagree";
  /** The distinct values that made it a refusal, for the audit's message. */
  detail: string[];
}

export interface FamilyDerivation {
  families: WidthFamily[];
  refused: FamilyRefusal[];
}

/**
 * The facets a folded card and the browse filters read off a member.
 *
 * `PublicRepositoryListEntry` is structurally assignable to this; the subset is
 * spelled out so a test can build a member without the twenty fields a folded
 * card never touches, and so that adding a *filter* to the browse list is a
 * type error here until its field is added to the invariant.
 */
export interface FamilyFacetSource {
  category: string;
  categoryLabel: string;
  categoryLabelJa: string;
  algorithmFamily: string;
  framework: string;
  status: string;
  description: string;
  descriptionJa: string;
  exportStatus: string;
  provenance: string;
  updatedAt: string;
  topics?: readonly string[];
  verificationMethods?: readonly string[];
  codeVariants: ReadonlyArray<{ framework: string; status: string }>;
}

export interface FamilyCandidate extends FamilyFacetSource {
  slug: string;
  title: string;
  titleJa: string;
}

/**
 * `<stem>-<N>q`, and nothing else.
 *
 * Anchored, and the width must be canonical decimal with no leading zero: a
 * corpus that ever published both `-4q` and `-04q` would otherwise fold two
 * different records onto one width and the switcher would show "4 q" twice.
 * A zero width is not a circuit, so `-0q` is not a member either.
 */
const WIDTH_SLUG = /^(.+)-([1-9]\d*)q$/;

export function parseWidthSlug(slug: string): { stem: string; width: number } | null {
  const match = WIDTH_SLUG.exec(slug);
  if (!match) return null;
  return { stem: match[1], width: Number(match[2]) };
}

/**
 * Everything about a member that must be identical for the family to be one
 * thing, as one comparable string.
 *
 * The list is "what a folded card shows, plus what every browse control filters
 * on" — because those are the two ways a reader can be misled by a fold. If the
 * eight records disagreed on `category`, a category filter would keep the group
 * on screen while the card showed a member the filter excluded; if they
 * disagreed on `description`, the card's body would be true of one member and
 * asserted of eight.
 *
 * `stance` is passed in rather than derived here: R2.5 derives it from the
 * `portableCircuit`, which is the one heavy field on the list projection and is
 * exactly the field that legitimately differs between widths. All 120 published
 * benchmark circuits end in a measurement and so all resolve to `program`, but
 * that is a fact about today's corpus rather than a property of width scaling —
 * a family whose 2-qubit member measured and whose 16-qubit member did not
 * would take two different stance filters, and must not fold.
 */
export function familyInvariant(entry: FamilyFacetSource, stance?: string): string {
  return JSON.stringify([
    entry.category,
    entry.categoryLabel,
    entry.categoryLabelJa,
    entry.algorithmFamily,
    entry.framework,
    entry.status,
    entry.description,
    entry.descriptionJa,
    entry.exportStatus,
    entry.provenance,
    entry.updatedAt,
    [...(entry.topics ?? [])].sort(),
    [...(entry.verificationMethods ?? [])].sort(),
    // Which frameworks a member exports to, not the code it exports: the code
    // differs at every width by construction, and the framework control filters
    // on the variant's status alone.
    entry.codeVariants.map((variant) => `${variant.framework}:${variant.status}`).sort(),
    stance ?? "",
  ]);
}

/**
 * Strike a member's own width off its title.
 *
 * Both locales publish `<label><separator><width><unit>`: `GHZ chain benchmark
 * · 4 qubits` and `GHZチェーン・ベンチマーク・4量子ビット`. Removing the width
 * the *slug* declares — rather than any trailing number — is what keeps this
 * from mangling a title that legitimately ends in a figure, and it is why a
 * disagreement here is worth reporting: it means the slug and the title are
 * making different claims about the same record.
 *
 * Deliberately not a longest-common-prefix: a family published only at 12 and
 * 16 qubits shares the prefix `… · 1`, and "GHZ chain benchmark · 1" is a label
 * that looks authored and is wrong.
 */
export function stripWidthFromTitle(title: string, width: number): string {
  const pattern = new RegExp(`[\\s·・]*${width}\\s*(?:qubits?|量子ビット)\\s*$`);
  return title.replace(pattern, "").trim();
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Read the width families out of a corpus.
 *
 * A stem with one member is not a family — one record published at one width is
 * simply that record, and folding it would put a switcher with a single pill on
 * a card for no reason.
 */
export function deriveWidthFamilies(
  entries: readonly FamilyCandidate[],
  stanceOf: (entry: FamilyCandidate) => string | undefined = () => undefined,
): FamilyDerivation {
  const byStem = new Map<string, Array<{ entry: FamilyCandidate; width: number }>>();
  const order: string[] = [];
  for (const entry of entries) {
    const parsed = parseWidthSlug(entry.slug);
    if (!parsed) continue;
    const bucket = byStem.get(parsed.stem);
    if (bucket) bucket.push({ entry, width: parsed.width });
    else {
      byStem.set(parsed.stem, [{ entry, width: parsed.width }]);
      order.push(parsed.stem);
    }
  }

  const families: WidthFamily[] = [];
  const refused: FamilyRefusal[] = [];
  for (const stem of order) {
    const bucket = byStem.get(stem)!;
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.width - b.width);
    const slugs = bucket.map((item) => item.entry.slug);

    const invariants = distinct(
      bucket.map((item) => familyInvariant(item.entry, stanceOf(item.entry))),
    );
    if (invariants.length > 1) {
      refused.push({ key: stem, slugs, reason: "facets-disagree", detail: invariants });
      continue;
    }

    const labels = distinct(bucket.map((item) => stripWidthFromTitle(item.entry.title, item.width)));
    const labelsJa = distinct(
      bucket.map((item) => stripWidthFromTitle(item.entry.titleJa, item.width)),
    );
    if (labels.length > 1 || labelsJa.length > 1 || !labels[0] || !labelsJa[0]) {
      refused.push({
        key: stem,
        slugs,
        reason: "titles-disagree",
        detail: [...labels, ...labelsJa],
      });
      continue;
    }

    families.push({
      key: stem,
      label: labels[0],
      labelJa: labelsJa[0],
      members: bucket.map((item) => ({ slug: item.entry.slug, width: item.width })),
    });
  }
  return { families, refused };
}

// ---------------------------------------------------------------------------
// Folding a display list into rows
// ---------------------------------------------------------------------------

/** A cluster of slugs the browse list renders as one card. */
export interface RowGroup {
  key: string;
  label: string;
  labelJa: string;
  /** Members in the order the switcher should list them. */
  slugs: readonly string[];
  /** Short per-member pill text, when the full title would only repeat itself. */
  memberLabels?: Readonly<Record<string, string>>;
}

export type FoldedRow<T> =
  | { kind: "single"; entry: T }
  | {
      kind: "group";
      group: RowGroup;
      /** Surviving members, in the group's declared order. */
      members: T[];
      /**
       * The member whose position in the incoming list the row took.
       *
       * The list is ordered before it is folded, so a group sits where its
       * first-encountered member sits — under "deepest first" that is its
       * deepest member, under "shallowest first" its shallowest. The card
       * therefore opens on *that* member: `renderCostChip` already refuses to
       * "display one number and sort on another", and a card ranked by its
       * 16-qubit circuit while showing its 2-qubit one is the same defect.
       */
      placedBy: string;
    };

/**
 * Collapse clusters into single rows, preserving each cluster's first
 * appearance in `entries`.
 *
 * Lives here rather than in the browser component because it is a rule with a
 * refusal in it — a cluster with one surviving member after filtering renders
 * as a plain entry, never as a switcher with one pill — and `/repository` does
 * not hydrate, so a rule that only runs inside the component is one no test and
 * no no-JS reader ever exercises.
 */
export function foldRows<T extends { slug: string }>(
  entries: readonly T[],
  groupOf: (slug: string) => RowGroup | undefined,
): Array<FoldedRow<T>> {
  const bySlug = new Map<string, T>();
  for (const entry of entries) bySlug.set(entry.slug, entry);

  const rows: Array<FoldedRow<T>> = [];
  const emitted = new Set<string>();
  for (const entry of entries) {
    const group = groupOf(entry.slug);
    if (!group) {
      rows.push({ kind: "single", entry });
      continue;
    }
    if (emitted.has(group.key)) continue;
    emitted.add(group.key);
    const members = group.slugs
      .map((slug) => bySlug.get(slug))
      .filter((member): member is T => Boolean(member));
    if (members.length <= 1) rows.push({ kind: "single", entry: members[0] ?? entry });
    else rows.push({ kind: "group", group, members, placedBy: entry.slug });
  }
  return rows;
}

/** The width family as a `RowGroup`, with each pill reading just its width. */
export function widthFamilyGroup(family: WidthFamily, locale: "en" | "ja"): RowGroup {
  const memberLabels: Record<string, string> = {};
  for (const member of family.members) {
    memberLabels[member.slug] = locale === "ja" ? `${member.width}量子ビット` : `${member.width} q`;
  }
  return {
    key: family.key,
    label: family.label,
    labelJa: family.labelJa,
    slugs: family.members.map((member) => member.slug),
    memberLabels,
  };
}
