// The repository's browsable hierarchy: category, then algorithm family, then topic.
//
// ## Whose shape this is
//
// The owner described a folder navigation for the repository at some point and only
// somebody's paraphrase of it got written down. He was asked to say it himself rather
// than have it guessed, and picked the obvious default:
//
// > *"let's go with option 1. there may be exceptions as we find more and more
// > algorithms and circuits, but this is a good overall structure. we could even have
// > different schemas depending on what the user works on."*
// > — owner, github.com/EshMis/ai-ops/issues/15, 2026-08-12
//
// Option 1 was *category → algorithm family → topics*. The second sentence is a
// different question — several trees over one corpus, chosen by what the reader works
// on — and is asked back separately rather than half-built here. This module is the one
// tree he named, and it is written so that a second ordering would be another
// `FolderSchema` beside `CATEGORY_FAMILY_TOPIC` rather than a rewrite.
//
// ## The three facts that make this more than a group-by
//
// **1. A slug collision merges two folders and nothing complains.** Family names are
// free text authored per record — `Quantum differential equations · linear`,
// `QAOA / MaxCut`, `Block encoding · LCU`. Slugged naively, two of them can land on the
// same segment, and the result is one folder holding both families' records under one
// of their names. That is invisible: the page renders, the count is plausible, and the
// missing family is simply not in the list. So collisions are **returned as refusals**,
// the way `families.ts` returns a candidate it declines to fold, and
// `scripts/check-repository-data.mjs` fails on a non-empty list. Resolution then goes
// through the built index rather than by re-slugging the URL, so even a hypothetical
// collision cannot silently route a reader into the wrong folder.
//
// **2. The third level is not a partition, and the counts say so.** A record carries one
// `role` topic, usually a `method` topic and sometimes a `domain` topic — so it appears
// under more than one topic folder, and the topic counts under a family sum to *more*
// than the family holds. A tree whose child counts do not add up to the parent's is
// either a bug or a fact, and the only way a reader can tell is if the surface says
// which. `FolderNode.records` is the parent's own count and is always the honest one.
//
// **3. Every record must be reachable.** A record whose family is blank, or which
// carries no topic at all, would exist in the corpus and appear in no folder — the
// browse list would show 323 and the tree would walk to fewer, with nothing failing.
// `unreachable` counts exactly that, and it is a refusal too. It is empty today because
// `topics.ts` makes `role` exhaustive, which is a property of that file and not of this
// one; the day someone relaxes it, this is what says so.
//
// Explicit `.ts` on every value import: this module is reachable from a `node --test`
// entry point, which strips types but resolves paths literally. Same convention as the
// rest of lib/repository.
import { isTopicId, TOPICS_BY_ID, type Topic, type TopicId } from "./topics.ts";

/** Everything a record has to carry to be placed in the tree. */
export interface FolderRecord {
  slug: string;
  title: string;
  titleJa: string;
  category: string;
  categoryLabel: string;
  categoryLabelJa: string;
  algorithmFamily: string;
  topics?: readonly string[];
}

/** How deep a location sits. The tree is exactly three levels under its root. */
export type FolderLevel = "root" | "category" | "family" | "topic";

/**
 * One folder.
 *
 * `records` is the count of *distinct records* held at or under this node — the
 * honest number, and not the sum of the children's, which double-counts at the
 * topic level. See the header, fact 2.
 */
export interface FolderNode {
  /** The URL segment. Unique among its siblings, and checked to be. */
  segment: string;
  label: string;
  labelJa: string;
  /**
   * One line saying what this folder holds, where the vocabulary defines one.
   * Topics carry a definition in `topics.ts`; categories and families do not,
   * and an invented sentence is worse than none.
   */
  note?: string;
  noteJa?: string;
  records: number;
  children: readonly FolderNode[];
}

/** A family the tree declines to place, with the reason. */
export interface FolderRefusal {
  kind: "slug-collision" | "no-family" | "no-topic";
  /** The category the trouble is in, or `""` where it is not category-scoped. */
  category: string;
  /** The colliding segment, or the offending record's slug. */
  subject: string;
  detail: string[];
}

export interface FolderTree {
  root: readonly FolderNode[];
  refused: readonly FolderRefusal[];
  /** Records placed in at least one leaf. The denominator a sweep should quote. */
  placed: number;
  /** Records the walk cannot reach. Always report with `placed`. */
  unreachable: readonly string[];
}

/**
 * A URL segment from a free-text label.
 *
 * Deliberately lossy — `·`, `/`, `+` and case all go — which is exactly why the caller
 * has to check for collisions rather than trust the output. Latin letters and digits
 * only: the corpus's family names are English, and a transliteration scheme for the day
 * they are not would be a guess about a convention nobody has chosen.
 */
export function folderSegment(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so `é` becomes `e` rather than vanishing with its letter.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Sort children the same way every time: biggest first, then by label.
 *
 * Not corpus order. Two runs over the same corpus must produce the same page, or a
 * diff of two renders is noise and the readback probe cannot pin anything.
 */
function byWeightThenLabel(a: FolderNode, b: FolderNode): number {
  return b.records - a.records || a.label.localeCompare(b.label) || a.segment.localeCompare(b.segment);
}

function topicNode(topic: Topic, records: number): FolderNode {
  return {
    segment: topic.id,
    label: topic.label,
    labelJa: topic.labelJa,
    note: topic.definition,
    noteJa: topic.definitionJa,
    records,
    children: [],
  };
}

/**
 * Build the whole tree from the corpus.
 *
 * Pure, and takes the records rather than importing the corpus, for the reason every
 * other module in this directory does: the corpus is not importable from `node --test`,
 * and a rule that can only be exercised against the real thing is a rule with no unit
 * test and no fixture for the case that has not happened yet.
 */
export function buildFolderTree(records: readonly FolderRecord[]): FolderTree {
  const refused: FolderRefusal[] = [];
  const unreachable: string[] = [];

  // category -> family label -> records
  const byCategory = new Map<string, { label: string; labelJa: string; families: Map<string, FolderRecord[]> }>();
  for (const record of records) {
    const family = record.algorithmFamily.trim();
    if (family === "") {
      refused.push({
        kind: "no-family",
        category: record.category,
        subject: record.slug,
        detail: ["algorithmFamily is empty, so the record has no second-level folder"],
      });
      unreachable.push(record.slug);
      continue;
    }
    const known = (record.topics ?? []).filter((id) => isTopicId(id));
    if (known.length === 0) {
      // Not fatal to placement — the record still sits under its family — but it is
      // unreachable at the third level, which is where a reader walking topics ends up.
      refused.push({
        kind: "no-topic",
        category: record.category,
        subject: record.slug,
        detail: ["carries no topic in the closed vocabulary, so no topic folder holds it"],
      });
      unreachable.push(record.slug);
      continue;
    }
    let bucket = byCategory.get(record.category);
    if (!bucket) {
      bucket = {
        label: record.categoryLabel,
        labelJa: record.categoryLabelJa,
        families: new Map(),
      };
      byCategory.set(record.category, bucket);
    }
    bucket.families.set(family, [...(bucket.families.get(family) ?? []), record]);
  }

  const root: FolderNode[] = [];
  let placed = 0;
  for (const [category, bucket] of byCategory) {
    // Segments are claimed within a category, not globally: `Pauli operator` is a
    // family under both `gates` and `operators`, and those are two different folders
    // holding different records. Scoping the check to siblings is what lets that be
    // true without being a collision.
    const claimed = new Map<string, string>();
    const familyNodes: FolderNode[] = [];
    for (const [family, held] of bucket.families) {
      const segment = folderSegment(family);
      const previous = claimed.get(segment);
      if (previous !== undefined) {
        refused.push({
          kind: "slug-collision",
          category,
          subject: segment,
          detail: [previous, family],
        });
        for (const record of held) unreachable.push(record.slug);
        continue;
      }
      claimed.set(segment, family);

      const perTopic = new Map<TopicId, number>();
      for (const record of held) {
        for (const id of record.topics ?? []) {
          // An id the closed vocabulary does not carry is skipped rather than folded
          // into an "other" bucket: `topics.ts` is the vocabulary, and a folder named
          // for a string it does not define is a folder whose meaning nothing states.
          if (!isTopicId(id)) continue;
          perTopic.set(id, (perTopic.get(id) ?? 0) + 1);
        }
      }
      const topicNodes = [...perTopic.entries()]
        .map(([id, count]) => topicNode(TOPICS_BY_ID.get(id)!, count))
        .sort(byWeightThenLabel);

      placed += held.length;
      familyNodes.push({
        segment,
        // No `labelJa`: `algorithmFamily` is authored once, in English, on the record.
        // Rendering the same string in both locales is what the browse list already
        // does with it, and a translation invented here would be a second name for a
        // family that has one.
        label: family,
        labelJa: family,
        records: held.length,
        children: topicNodes,
      });
    }
    if (familyNodes.length === 0) continue;
    root.push({
      segment: category,
      label: bucket.label,
      labelJa: bucket.labelJa,
      records: familyNodes.reduce((total, node) => total + node.records, 0),
      children: familyNodes.sort(byWeightThenLabel),
    });
  }

  return {
    root: root.sort(byWeightThenLabel),
    refused,
    placed,
    unreachable: [...unreachable].sort(),
  };
}

/** Where a reader is, once a URL path has been resolved against the tree. */
export interface FolderLocation {
  level: FolderLevel;
  /** Root → here. Empty at the root. */
  trail: readonly FolderNode[];
  /** The folders offered from here. */
  children: readonly FolderNode[];
  /** The records held here, in the order the tree fixed. Empty above the family level. */
  records: readonly FolderRecord[];
}

/**
 * A URL path → a place in the tree, or `null`.
 *
 * **`null` means 404, and that is deliberately the opposite of `browse-params.ts`.**
 * That module resolves an unrecognised `?topic=` to *no filter*, because a stale
 * bookmark should show the catalogue rather than a blank page that reads as "we have
 * nothing like this". A path segment is not a filter — it is an identity — and
 * answering `/repository/folders/algorithms/made-up` with the whole of `algorithms`
 * tells the reader a folder exists that does not. The two rules disagree because the
 * two things are different, and the disagreement is written down here so the next
 * session does not "fix" one of them into the other.
 *
 * Matching is against the segments the tree built, never a re-slug of the input: a
 * segment is looked up, not recomputed. See the header, fact 1.
 */
export function resolveFolderPath(
  tree: FolderTree,
  records: readonly FolderRecord[],
  path: readonly string[],
): FolderLocation | null {
  if (path.length === 0) {
    return { level: "root", trail: [], children: tree.root, records: [] };
  }
  if (path.length > 3) return null;

  const trail: FolderNode[] = [];
  let level: readonly FolderNode[] = tree.root;
  for (const segment of path) {
    const node = level.find((candidate) => candidate.segment === segment);
    if (!node) return null;
    trail.push(node);
    level = node.children;
  }

  const [category, family, topic] = trail;
  const held = records.filter((record) => {
    if (record.category !== category!.segment) return false;
    if (family && folderSegment(record.algorithmFamily.trim()) !== family.segment) return false;
    if (topic && !(record.topics ?? []).includes(topic.segment)) return false;
    return true;
  });

  return {
    level: (["category", "family", "topic"] as const)[trail.length - 1]!,
    trail,
    children: trail[trail.length - 1]!.children,
    // A category holds hundreds; listing them under the folder list would bury it.
    // From the family down the largest holding is 50, so the list is the page.
    records: trail.length === 1 ? [] : held,
  };
}

// ---------------------------------------------------------------------------
// The second scheme: kind of algorithm → kind of record → family (ai-ops#45)
// ---------------------------------------------------------------------------
//
// > *"one scheme is good, option 2 as a secondary one if the user interface
// > doesn't get extremely complicated and loading times don't spike because of
// > it"*
// > — owner, github.com/EshMis/ai-ops/issues/45
//
// Option 2 was *"By the kind of algorithm — variational, oracle-based, quantum
// walk, phase estimation, block encoding, sampling"*, pitched to him as
// *"nearly free: this is already recorded on most records"*.
//
// ## Additive, exactly as promised
//
// A second pair of functions beside the first rather than a parameter on it.
// `buildFolderTree` and `resolveFolderPath` are untouched, so the scheme the
// owner already picked cannot regress, and `check-repository-data.mjs` goes on
// asserting on its refusals alone. This is the shape the module header promised
// in session 112 — *"a second ordering would be another `FolderSchema` beside
// `CATEGORY_FAMILY_TOPIC` rather than a rewrite"*.
//
// ## What "most records" turned out to mean, measured
//
// **263 of 346 records carry a method topic; 83 do not** (2026-08-13). So the
// tree reaches 76% of the corpus, and the pitch's "most" is true — but the
// remainder is a fifth of the catalogue and it is the same criticism option 1
// was rejected on, one notch smaller. 27 of the 83 are gates, which carry no
// method by design and are exactly where the owner has said they should be.
//
// **The unplaced records are returned, not hidden.** `unreachable` carries every
// one of them and the page prints the count beside the placed count, because a
// tree that silently reaches three quarters of a catalogue looks exactly like a
// tree that reaches all of it.
//
// ## Why the levels are in this order
//
// The reader this scheme is for knows which technique they want. So the
// technique is first. What they need next is which *kind* of thing the
// catalogue has for it — a reference, a yardstick, an operator — because that
// decides whether the answer is something to read or something to run, and that
// distinction is the one `topics.ts` calls exhaustive. Family is last, where it
// separates records inside an already narrow set.

/** The two levels below a method, in order. Named so the page can label a trail. */
export const METHOD_SCHEME_LEVELS = ["method", "category", "family"] as const;

/**
 * Build the method-first tree.
 *
 * A record with several method topics appears under each, which is the same
 * non-partition the first scheme has at its topic level and is stated the same
 * way: `FolderNode.records` is always the honest count of distinct records held
 * at or under that node, and sibling counts under the root therefore sum to
 * more than the corpus.
 */
export function buildMethodFolderTree(records: readonly FolderRecord[]): FolderTree {
  const refused: FolderRefusal[] = [];
  const unreachable: string[] = [];
  // method -> category -> family -> records
  const byMethod = new Map<
    TopicId,
    Map<string, { label: string; labelJa: string; families: Map<string, FolderRecord[]> }>
  >();

  const placedSlugs = new Set<string>();
  for (const record of records) {
    const family = record.algorithmFamily.trim();
    const methods = (record.topics ?? []).filter(
      (id): id is TopicId => isTopicId(id) && TOPICS_BY_ID.get(id)?.facet === "method",
    );
    if (methods.length === 0) {
      refused.push({
        kind: "no-topic",
        category: record.category,
        subject: record.slug,
        detail: [
          "carries no topic in the `method` facet, so this scheme has no first-level folder for it",
        ],
      });
      unreachable.push(record.slug);
      continue;
    }
    if (family === "") {
      refused.push({
        kind: "no-family",
        category: record.category,
        subject: record.slug,
        detail: ["algorithmFamily is empty, so the record has no third-level folder"],
      });
      unreachable.push(record.slug);
      continue;
    }
    placedSlugs.add(record.slug);
    for (const method of methods) {
      let categories = byMethod.get(method);
      if (!categories) {
        categories = new Map();
        byMethod.set(method, categories);
      }
      let bucket = categories.get(record.category);
      if (!bucket) {
        bucket = { label: record.categoryLabel, labelJa: record.categoryLabelJa, families: new Map() };
        categories.set(record.category, bucket);
      }
      bucket.families.set(family, [...(bucket.families.get(family) ?? []), record]);
    }
  }

  const root: FolderNode[] = [];
  for (const [method, categories] of byMethod) {
    const categoryNodes: FolderNode[] = [];
    for (const [category, bucket] of categories) {
      // Claimed within a category *within a method*, for the reason the first
      // scheme claims within a category: the same family string under two
      // different parents is two different folders holding different records.
      const claimed = new Map<string, string>();
      const familyNodes: FolderNode[] = [];
      for (const [family, held] of bucket.families) {
        const segment = folderSegment(family);
        const previous = claimed.get(segment);
        if (previous !== undefined) {
          refused.push({ kind: "slug-collision", category, subject: segment, detail: [previous, family] });
          for (const record of held) unreachable.push(record.slug);
          continue;
        }
        claimed.set(segment, family);
        familyNodes.push({
          segment,
          // English in both locales, same as the first scheme and for the same
          // reason: `algorithmFamily` is authored once, in English, on the record.
          label: family,
          labelJa: family,
          records: held.length,
          children: [],
        });
      }
      if (familyNodes.length === 0) continue;
      categoryNodes.push({
        segment: category,
        label: bucket.label,
        labelJa: bucket.labelJa,
        records: familyNodes.reduce((total, node) => total + node.records, 0),
        children: familyNodes.sort(byWeightThenLabel),
      });
    }
    if (categoryNodes.length === 0) continue;
    const topic = TOPICS_BY_ID.get(method)!;
    root.push({
      segment: topic.id,
      label: topic.label,
      labelJa: topic.labelJa,
      // The definition the vocabulary already carries. A first-level folder with
      // no sentence saying what it holds is the thing `topicNode` exists to avoid.
      note: topic.definition,
      noteJa: topic.definitionJa,
      records: categoryNodes.reduce((total, node) => total + node.records, 0),
      children: categoryNodes.sort(byWeightThenLabel),
    });
  }

  return {
    root: root.sort(byWeightThenLabel),
    refused,
    // **Distinct records, not the sum of the roots.** A record under three
    // methods is one record placed, and a `placed` that counted it three times
    // would report a corpus larger than the corpus.
    placed: placedSlugs.size,
    unreachable: [...new Set(unreachable)].sort(),
  };
}

/**
 * A URL path → a place in the method-first tree, or `null`.
 *
 * Same `null`-means-404 rule as `resolveFolderPath`, and the argument for it is
 * that function's: a path segment is an identity, not a filter.
 */
export function resolveMethodFolderPath(
  tree: FolderTree,
  records: readonly FolderRecord[],
  path: readonly string[],
): FolderLocation | null {
  if (path.length === 0) {
    return { level: "root", trail: [], children: tree.root, records: [] };
  }
  if (path.length > 3) return null;

  const trail: FolderNode[] = [];
  let level: readonly FolderNode[] = tree.root;
  for (const segment of path) {
    const node = level.find((candidate) => candidate.segment === segment);
    if (!node) return null;
    trail.push(node);
    level = node.children;
  }

  const [method, category, family] = trail;
  const held = records.filter((record) => {
    if (!(record.topics ?? []).includes(method!.segment)) return false;
    if (category && record.category !== category.segment) return false;
    if (family && folderSegment(record.algorithmFamily.trim()) !== family.segment) return false;
    return true;
  });

  return {
    // The level *names* differ from the first scheme's — this tree's second
    // level is a category and its third is a family — but `FolderLevel` is a
    // depth vocabulary the view uses for layout, and reusing it keeps one
    // renderer. The trail's own labels are what a reader sees.
    level: (["category", "family", "topic"] as const)[trail.length - 1]!,
    trail,
    children: trail[trail.length - 1]!.children,
    // A whole method holds up to 75; listing them under the folder list would
    // bury it, the same way a category does in the first scheme.
    records: trail.length === 1 ? [] : held,
  };
}
