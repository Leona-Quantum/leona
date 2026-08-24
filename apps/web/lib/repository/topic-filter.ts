// Filtering the browse list by a topic, and building the control that offers it (R2).
//
// A pure module rather than a condition inside the component. Session 77 gave
// the reason as "React does not hydrate /repository in either browser surface,
// so the control cannot be driven by automation" — **that premise is false**,
// measured on production in s81; it came from `next dev` in an agent browser
// pane, whose CSP blocks the `eval()` dev-mode React needs.
//
// The conclusion outlives the premise, on better grounds: a filter rule inside
// a component body can only be exercised by rendering that component, which
// makes verifying it cost a browser and a hydration. Here it costs a `node
// --test` run. Since s91 the control offering these options is a list of links
// rather than a `<select>`, so the rule is also reachable by reading the HTML.
//
// The counts are the honest half of this file. A control that offers
// "Optimization" with no number beside it invites the reader to assume the
// corpus has as much of it as they need; "Optimization (10)" does not.

import { PUBLIC_REPOSITORY_TOPICS, TOPICS_BY_ID, type TopicFacet, type TopicId } from "./topics.ts";

/** What the filter reads. Anything carrying topics can be filtered. */
export interface TopicFilterable {
  topics?: TopicId[];
}

export interface TopicOption {
  id: TopicId;
  facet: TopicFacet;
  label: string;
  /** How many of the entries offered to `topicOptions` carry it. Never zero. */
  count: number;
}

export interface TopicOptionGroup {
  facet: TopicFacet;
  options: TopicOption[];
}

/**
 * Topics the browse control does not offer, because the category tabs on the
 * same page already own the word — and answer it with a different number.
 *
 * ## The collision
 *
 * `/repository` carries two controls that classify a record by what kind of
 * thing it is, and four of the five `role` topics are the tab's word with a
 * different count beside it (measured over the 369-record corpus, 2026-08-14):
 *
 * | word        | category tab (record kind) | `role` topic |
 * | ----------- | -------------------------- | ------------ |
 * | Gates       | 29                         | 27           |
 * | Operators   | 60                         | 62           |
 * | States      | 13                         | 12           |
 * | Algorithms  | 267                        | 148          |
 *
 * In Japanese the labels are not merely close, they are **identical strings** —
 * ゲート, 演算子, 状態, アルゴリズム are both the tab and the topic. A reader
 * cannot tell the two controls apart at all, and reads the gap as a bug.
 *
 * ## Why the topic yields the word rather than the tab
 *
 * Owner ruling, ai-ops#75: *"reconcile them to one number and drop whichever
 * slice matters less."* The record kind is the structural one — it is
 * `PUBLIC_REPOSITORY_CATEGORY_IDS`, the first level of the folder tree, the
 * `?category=` param, the four-kind model `check-repository-data.mjs` validates,
 * and the axis `?fits=` already agrees with (transform 29 = gates 29,
 * observable 60 = operators 60), including the "See all 29" a gate record's
 * interface panel prints. The third pair this used to quote — "source 13 =
 * states 13" — was measured when `states` held 13; it holds 12, and the pair is
 * dropped rather than restated, because the argument does not rest on it. The `role` facet is one tag group inside a
 * collapsed rail. So the tabs keep the words, and this control stops offering a
 * second answer to their question.
 *
 * The numbers are **not** reconciled by reclassifying records: the three that
 * disagree do so for good reasons — `pauli-y-gate` and `pauli-z-gate` are filed
 * under `gates` but their family is `Pauli operator`, and
 * `quantum-teleportation` is filed under `states` but is a protocol. Deriving
 * the role from the category instead would file a protocol as an object on the
 * Ingredients shelf and split the three Pauli records that shelf deliberately
 * keeps together. That is a physics classification, not a copy fix.
 *
 * ## What survives, and why
 *
 * `benchmark-circuit` **used to be** the exception, and the sentence that
 * justified it was *"no category word collides with it"* — true when written and
 * false since leona 760, which split `basic-circuits` out of `algorithms` as a
 * fifth tab holding exactly the 30 records this role names. Two controls, the
 * same 30 records, and — because the sets are identical rather than merely
 * overlapping — the same number printed beside each. That is the worst case for
 * ai-ops#75's confusion, not an edge of it: a reader meets *Basic circuits (30)*
 * as a tab and *Benchmark circuit (30)* as a topic with nothing telling them the
 * two are one thing. Measured on production before this fix.
 *
 * The old sentence also said the role "splits the 267 `algorithms` into 120
 * published yardsticks and the rest". Both figures are stale: the corpus is 279
 * records, `algorithms` is 148 after the split, and the role names 30.
 *
 * So it joins the others, on the same ruling and for the same reason. Nothing is
 * lost that the tabs cannot say — that was the argument for keeping it, and the
 * tab now says it.
 *
 * Nothing is removed from the vocabulary. These five still classify every
 * record, still drive `roleOf`, `OBJECT_ROLES` and the Ingredients shelf, and
 * `?topic=gate-primitive` still filters — a bookmark made before this keeps
 * working. They are simply no longer *offered*, and no surface links to them.
 *
 * Held here rather than in `topics.ts` because it is a fact about a control on
 * one page, not about the vocabulary; and because `topics.ts` cannot import the
 * category list from `types.ts` without a cycle.
 */
export const TOPICS_A_CATEGORY_TAB_OWNS: ReadonlySet<TopicId> = new Set<TopicId>([
  "gate-primitive",
  "state",
  "operator",
  "algorithm-reference",
  "benchmark-circuit",
]);

/**
 * The options a control may offer, grouped by facet and counted against the
 * entries in hand.
 *
 * **A topic no entry in this set carries is not offered.** Selecting it would
 * empty the list, and an empty list reads as "the corpus has nothing like this"
 * when the truth is narrower — nothing *here*, under the filters already
 * applied. The vocabulary is closed but the control is not the vocabulary.
 *
 * **A topic a category tab already owns is not offered either** — see
 * `TOPICS_A_CATEGORY_TAB_OWNS` for which four, and for the owner ruling that
 * says the tab is the one that keeps the word.
 */
export function topicOptions(
  entries: readonly TopicFilterable[],
  locale: "en" | "ja",
): TopicOptionGroup[] {
  const counts = new Map<TopicId, number>();
  for (const entry of entries) {
    // Deduplicated per entry, because `filterByTopic` returns each entry once
    // and these two numbers have to be the same number. `deriveTopics` cannot
    // emit a duplicate and CI refuses one in the corpus, but this function is
    // also fed records straight from the API, where `topics` is shape-checked
    // and nothing more — and the failure is a label promising more rows than
    // the filter it labels will return.
    for (const topic of new Set(entry.topics ?? [])) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  const groups = new Map<TopicFacet, TopicOption[]>();
  for (const topic of PUBLIC_REPOSITORY_TOPICS) {
    if (TOPICS_A_CATEGORY_TAB_OWNS.has(topic.id)) continue;
    const count = counts.get(topic.id) ?? 0;
    if (count === 0) continue;
    const option: TopicOption = {
      id: topic.id,
      facet: topic.facet,
      label: locale === "ja" ? topic.labelJa : topic.label,
      count,
    };
    const bucket = groups.get(topic.facet);
    if (bucket) bucket.push(option);
    else groups.set(topic.facet, [option]);
  }
  // Facet order is the vocabulary's, not insertion order, so the control reads
  // the same whatever the corpus happens to contain.
  return (["role", "method", "domain"] as const)
    .filter((facet) => groups.has(facet))
    .map((facet) => ({ facet, options: groups.get(facet) ?? [] }));
}

/**
 * Entries carrying `topic`, or all of them when nothing is selected.
 *
 * `""` rather than null for "no filter" because that is what an unselected
 * `<select>` yields, and translating it in the component is one more place the
 * empty case can be got wrong. An unknown id filters to nothing rather than to
 * everything: a stale bookmark naming a retired topic should show a reader an
 * empty list, not silently the whole corpus under a heading that says otherwise.
 */
export function filterByTopic<T extends TopicFilterable>(
  entries: readonly T[],
  topic: TopicId | "",
): T[] {
  if (!topic) return [...entries];
  return entries.filter((entry) => (entry.topics ?? []).includes(topic));
}

/** The label a control shows for one option, count included. */
export function topicOptionLabel(option: TopicOption): string {
  return `${option.label} (${option.count})`;
}

/** The definition to put under a selected topic, or null when none is selected. */
export function topicDefinition(topic: TopicId | "", locale: "en" | "ja"): string | null {
  if (!topic) return null;
  const found = TOPICS_BY_ID.get(topic);
  if (!found) return null;
  return locale === "ja" ? found.definitionJa : found.definition;
}
